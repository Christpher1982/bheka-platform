// SCIM 2.0 provisioning endpoints for enterprise customers.
// GUIDE-01 section 6: /scim/v2/Users for customer-IdP-driven user lifecycle.
// 007_RBAC_AND_IDENTITY section 4: SCIM keeps users and role assignments in sync.
// Authentication: long-lived bearer token per tenant, stored Argon2id-hashed.
// Deprovisioning is always soft-delete (active=false, deleted_at) per CANON section 8.
// Every write writes to audit_log before returning per CANON section 9.

import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import {
  db,
  oidcConfigTable,
  usersTable,
  type User,
} from "@workspace/db";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { logger } from "../../lib/logger.js";

// Verify the SCIM bearer token against the Argon2id hash stored in oidc_config.
async function resolveScimTenant(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!token) return null;

  const configs = await db
    .select({ tenantId: oidcConfigTable.tenantId, hash: oidcConfigTable.scimBearerTokenHash })
    .from(oidcConfigTable)
    .where(and(eq(oidcConfigTable.scimEnabled, true)));

  for (const cfg of configs) {
    if (!cfg.hash) continue;
    const match = await argon2Verify(cfg.hash, token).catch(() => false);
    if (match) return cfg.tenantId;
  }
  return null;
}

const requireScimToken: RequestHandler = async (req, res, next) => {
  const tenantId = await resolveScimTenant(req.headers.authorization).catch(
    (err: Error) => {
      logger.error({ err }, "SCIM bearer token verification failed");
      return null;
    },
  );

  if (!tenantId) {
    res
      .status(401)
      .json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        detail: "Invalid or missing SCIM bearer token",
        status: "401",
      });
    return;
  }

  req.scimTenantId = tenantId;
  next();
};

function toScimUser(row: User) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: row.id,
    externalId: row.externalId ?? undefined,
    userName: row.email,
    name: {
      givenName: row.givenName ?? undefined,
      familyName: row.familyName ?? undefined,
    },
    active: row.active,
    meta: { resourceType: "User" },
  };
}

const ScimUserCreate = z.object({
  schemas: z.array(z.string()),
  userName: z.string().email(),
  name: z
    .object({
      givenName: z.string().optional(),
      familyName: z.string().optional(),
    })
    .optional(),
  active: z.boolean().default(true),
  externalId: z.string().optional(),
});

const ScimPatch = z.object({
  Operations: z.array(
    z.object({
      op: z.enum(["replace", "add", "remove"]),
      path: z.string().optional(),
      value: z.unknown(),
    }),
  ),
});

const router: IRouter = Router();

// POST /scim/v2/Users — provision a new user
router.post("/scim/v2/Users", requireScimToken, async (req, res): Promise<void> => {
  const parsed = ScimUserCreate.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: parsed.error.message,
      status: "400",
    });
    return;
  }

  const tenantId = req.scimTenantId!;
  const { userName, name, active, externalId } = parsed.data;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.email, userName)))
    .limit(1);

  if (existing) {
    res.status(409).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User already exists",
      status: "409",
    });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      tenantId,
      email: userName,
      givenName: name?.givenName ?? null,
      familyName: name?.familyName ?? null,
      active,
      externalId: externalId ?? null,
      provisionedVia: "scim",
    })
    .returning();

  await writeAuditLog({
    tenantId,
    actorType: "scim_client",
    action: "user.provisioned",
    targetType: "user",
    targetId: user.id,
    metadata: { source: "scim", externalId: externalId ?? null },
  });

  res.status(201).json(toScimUser(user));
});

// PATCH /scim/v2/Users/:id — partial update (primary use: deprovisioning)
router.patch("/scim/v2/Users/:id", requireScimToken, async (req, res): Promise<void> => {
  const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const tenantId = req.scimTenantId!;

  const parsed = ScimPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: parsed.error.message,
      status: "400",
    });
    return;
  }

  const deactivate = parsed.data.Operations.some(
    (op) => op.path === "active" && op.value === false,
  );

  if (deactivate) {
    await db
      .update(usersTable)
      .set({ active: false, deletedAt: new Date() })
      .where(
        and(eq(usersTable.id, idParam), eq(usersTable.tenantId, tenantId)),
      );

    await writeAuditLog({
      tenantId,
      actorType: "scim_client",
      action: "user.deprovisioned",
      targetType: "user",
      targetId: idParam,
      metadata: { source: "scim" },
    });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, idParam), eq(usersTable.tenantId, tenantId)))
    .limit(1);

  if (!user) {
    sendProblem(res, Problems.notFound());
    return;
  }

  res.json(toScimUser(user));
});

// GET /scim/v2/Users — list users
router.get("/scim/v2/Users", requireScimToken, async (req, res): Promise<void> => {
  const tenantId = req.scimTenantId!;

  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.tenantId, tenantId));

  res.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: rows.length,
    Resources: rows.map(toScimUser),
  });
});

export { argon2Hash };
export default router;
