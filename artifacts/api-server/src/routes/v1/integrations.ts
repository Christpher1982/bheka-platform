// Integrations routes — 009_API_SURFACE section 12.
//
// Routes:
//   GET    /v1/integrations                      — list (oidcBearer)
//   POST   /v1/integrations                      — create (security_administrator)
//   GET    /v1/integrations/:integrationId        — single
//   PATCH  /v1/integrations/:integrationId        — update (security_administrator)
//   DELETE /v1/integrations/:integrationId        — deactivate (security_administrator)
//
// configJson is opaque to the gateway; sensitive subfields are encrypted at
// the application-secrets layer (lib/secrets.ts) before storage. The gateway
// never inspects or redacts configJson fields — that is the caller's responsibility.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { integrationsTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";

const router: IRouter = Router();

// ── GET /v1/integrations ─────────────────────────────────────────────────────

router.get(
  "/v1/integrations",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(integrationsTable)
        .where(eq(integrationsTable.tenantId, tenantId))
        .orderBy(integrationsTable.id),
    );

    res.json({
      items: rows.map((i) => ({
        id: i.id,
        provider: i.provider,
        name: i.name,
        active: i.active,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        // configJson intentionally omitted from list view; access via GET by ID.
      })),
    });
  },
);

// ── POST /v1/integrations ────────────────────────────────────────────────────

const CreateIntegrationBody = z.object({
  provider: z.enum([
    "entra_id",
    "okta",
    "google_workspace",
    "hris",
    "siem",
    "ticketing",
    "whatsapp",
    "mdm",
  ]),
  name: z.string().min(1).max(255),
  configJson: z.record(z.unknown()).optional().default({}),
});

router.post(
  "/v1/integrations",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const actorId = req.session!.userId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreateIntegrationBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(
        parsed.error.message,
        parsed.error.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message })),
      ));
      return;
    }

    const [integration] = await withTenantContext(tenantId, (tx) =>
      tx
        .insert(integrationsTable)
        .values({ tenantId, ...parsed.data })
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "integration.created",
      targetType: "integration",
      targetId: integration!.id,
      requestId: String(idempotencyKey),
      metadata: { provider: parsed.data.provider, name: parsed.data.name },
    });

    res.status(201).json({
      id: integration!.id,
      tenantId: integration!.tenantId,
      provider: integration!.provider,
      name: integration!.name,
      configJson: integration!.configJson,
      active: integration!.active,
      createdAt: integration!.createdAt,
      updatedAt: integration!.updatedAt,
    });
  },
);

// ── GET /v1/integrations/:integrationId ──────────────────────────────────────

router.get(
  "/v1/integrations/:integrationId",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const integrationId = req.params.integrationId as string;

    const [integration] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(integrationsTable)
        .where(
          and(
            eq(integrationsTable.id, integrationId),
            eq(integrationsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!integration) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: integration.id,
      tenantId: integration.tenantId,
      provider: integration.provider,
      name: integration.name,
      configJson: integration.configJson,
      active: integration.active,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    });
  },
);

// ── PATCH /v1/integrations/:integrationId ────────────────────────────────────

const PatchIntegrationBody = z.object({
  name: z.string().min(1).max(255).optional(),
  configJson: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});

router.patch(
  "/v1/integrations/:integrationId",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const actorId = req.session!.userId;
    const integrationId = req.params.integrationId as string;

    const parsed = PatchIntegrationBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(
        parsed.error.message,
        parsed.error.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message })),
      ));
      return;
    }

    if (Object.keys(parsed.data).length === 0) {
      sendProblem(res, Problems.validationFailed("Request body must contain at least one field to update"));
      return;
    }

    const now = new Date();
    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(integrationsTable)
        .set({ ...parsed.data, updatedAt: now })
        .where(
          and(
            eq(integrationsTable.id, integrationId),
            eq(integrationsTable.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    if (!updated) {
      sendProblem(res, Problems.notFound());
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "integration.updated",
      targetType: "integration",
      targetId: integrationId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { fields: Object.keys(parsed.data) },
    });

    res.json({
      id: updated.id,
      provider: updated.provider,
      name: updated.name,
      configJson: updated.configJson,
      active: updated.active,
      updatedAt: updated.updatedAt,
    });
  },
);

// ── DELETE /v1/integrations/:integrationId ───────────────────────────────────
// Deactivates rather than hard-deletes; integrations are referenced by audit history.

router.delete(
  "/v1/integrations/:integrationId",
  requireSession,
  requireRole("security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const actorId = req.session!.userId;
    const integrationId = req.params.integrationId as string;

    const now = new Date();
    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(integrationsTable)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            eq(integrationsTable.id, integrationId),
            eq(integrationsTable.tenantId, tenantId),
          ),
        )
        .returning({ id: integrationsTable.id }),
    );

    if (!updated) {
      sendProblem(res, Problems.notFound());
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "integration.deactivated",
      targetType: "integration",
      targetId: integrationId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: {},
    });

    res.status(204).end();
  },
);

export default router;
