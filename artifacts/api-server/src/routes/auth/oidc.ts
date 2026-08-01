// OIDC authorization code flow with PKCE for bheka-console human users.
// GUIDE-01 section 3: OIDC login, callback, and logout for bheka-gateway.
// Per-tenant OIDC configuration is read from the oidc_config table.
// Sessions are Redis-backed opaque tokens — never signed JWTs (GUIDE-01 section 3.4).

import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { Issuer, generators, type Client } from "openid-client";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  oidcConfigTable,
  usersTable,
  rolesTable,
  roleAssignmentsTable,
} from "@workspace/db";
import { getSecretValue } from "../../lib/secrets.js";
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "../../middleware/session.js";
import { requireSession } from "../../middleware/require-session.js";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { logger } from "../../lib/logger.js";

interface OidcTransaction {
  tenantId: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

// In-process OIDC client cache. Cleared on process restart.
const clientCache = new Map<string, Client>();

async function getOidcClient(tenantId: string): Promise<Client> {
  const cached = clientCache.get(tenantId);
  if (cached) return cached;

  const [cfg] = await db
    .select()
    .from(oidcConfigTable)
    .where(eq(oidcConfigTable.tenantId, tenantId))
    .limit(1);

  if (!cfg || !cfg.active) {
    throw new Error(`No active OIDC configuration for tenant ${tenantId}`);
  }

  const secretRef = cfg.clientSecretEnv ?? cfg.clientSecretArn;
  if (!secretRef) {
    throw new Error(`OIDC client secret not configured for tenant ${tenantId}`);
  }
  const clientSecret = await getSecretValue(secretRef);

  const issuer = await Issuer.discover(cfg.issuerUrl);
  const client = new issuer.Client({
    client_id: cfg.clientId,
    client_secret: clientSecret,
    redirect_uris: [cfg.redirectUri],
    response_types: ["code"],
  });

  clientCache.set(tenantId, client);
  return client;
}

async function resolveTenantBySlug(slug: string): Promise<string | null> {
  const [tenant] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1);
  return tenant?.id ?? null;
}

async function upsertUserFromClaims(
  tenantId: string,
  claims: Record<string, unknown>,
): Promise<{ id: string }> {
  const email = z.string().email().parse(claims.email);
  const externalId = z.string().parse(claims.sub);

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.externalId, externalId))
    .limit(1);

  if (existing) {
    await db
      .update(usersTable)
      .set({ updatedAt: new Date() })
      .where(eq(usersTable.id, existing.id));
    return existing;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      tenantId,
      email,
      givenName: (claims.given_name as string | undefined) ?? null,
      familyName: (claims.family_name as string | undefined) ?? null,
      externalId,
      provisionedVia: "oidc",
    })
    .returning({ id: usersTable.id });

  return created;
}

const LoginQuery = z.object({ tenant: z.string().min(1) });
const CallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const router: IRouter = Router();

// GET /api/v1/auth/login?tenant=<slug>
router.get("/v1/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginQuery.safeParse(req.query);
  if (!parsed.success) {
    sendProblem(res, Problems.validationFailed("Missing or invalid tenant parameter"));
    return;
  }

  const tenantId = await resolveTenantBySlug(parsed.data.tenant);
  if (!tenantId) {
    sendProblem(res, Problems.notFound());
    return;
  }

  try {
    const client = await getOidcClient(tenantId);
    const [cfg] = await db
      .select({ redirectUri: oidcConfigTable.redirectUri })
      .from(oidcConfigTable)
      .where(eq(oidcConfigTable.tenantId, tenantId))
      .limit(1);

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const nonce = generators.nonce();
    const state = randomBytes(32).toString("base64url");

    const tx: OidcTransaction = {
      tenantId,
      codeVerifier,
      nonce,
      returnTo: "/dashboard",
    };
    const { redis } = await import("../../lib/redis.js");
    await redis.set(`oidc:tx:${state}`, JSON.stringify(tx), "EX", 600);

    const authUrl = client.authorizationUrl({
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      redirect_uri: cfg!.redirectUri,
    });

    res.redirect(authUrl);
  } catch (err) {
    logger.error({ err }, "OIDC login initiation failed");
    sendProblem(res, Problems.internalError());
  }
});

// GET /api/v1/auth/callback
router.get("/v1/auth/callback", async (req, res): Promise<void> => {
  const parsed = CallbackQuery.safeParse(req.query);
  if (!parsed.success) {
    sendProblem(res, Problems.validationFailed("Invalid OIDC callback parameters"));
    return;
  }
  const { code, state } = parsed.data;

  const { redis } = await import("../../lib/redis.js");
  const raw = await redis.get(`oidc:tx:${state}`);
  if (!raw) {
    sendProblem(res, Problems.validationFailed("OIDC transaction not found or expired"));
    return;
  }
  await redis.del(`oidc:tx:${state}`);

  const tx = JSON.parse(raw) as OidcTransaction;

  try {
    const client = await getOidcClient(tx.tenantId);
    const [cfg] = await db
      .select({ redirectUri: oidcConfigTable.redirectUri })
      .from(oidcConfigTable)
      .where(eq(oidcConfigTable.tenantId, tx.tenantId))
      .limit(1);

    const tokenSet = await client.callback(
      cfg!.redirectUri,
      { code, state },
      { code_verifier: tx.codeVerifier, nonce: tx.nonce, state },
    );

    const claims = tokenSet.claims();
    const user = await upsertUserFromClaims(tx.tenantId, claims);

    await writeAuditLog({
      tenantId: tx.tenantId,
      actorId: user.id,
      actorType: "user",
      action: "user.authenticated",
      targetType: "user",
      targetId: user.id,
      metadata: { method: "oidc" },
    });

    const sid = await createSession({
      userId: user.id,
      tenantId: tx.tenantId,
      mfaSatisfied: true,
      stepUpSatisfiedAt: null,
    });

    res.cookie(SESSION_COOKIE, sid, SESSION_COOKIE_OPTIONS);
    res.redirect(tx.returnTo);
  } catch (err) {
    logger.error({ err }, "OIDC callback failed");
    sendProblem(res, Problems.internalError());
  }
});

// GET /api/v1/auth/session
// Identity of the caller behind the current bheka_sid cookie. The console calls
// this on boot to decide between the app shell and the login page, and to render
// the signed-in user. Returns the held role names so the UI can explain up front
// which actions the caller's roles do not permit.
router.get("/v1/auth/session", requireSession, async (req, res): Promise<void> => {
  const { userId, tenantId } = req.session!;

  const [user] = await withTenantContext(tenantId, (tx) =>
    tx
      .select({
        id: usersTable.id,
        email: usersTable.email,
        givenName: usersTable.givenName,
        familyName: usersTable.familyName,
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)))
      .limit(1),
  );

  if (!user) {
    sendProblem(res, Problems.authRequired());
    return;
  }

  const assignments = await withTenantContext(tenantId, (tx) =>
    tx
      .select({ roleName: rolesTable.name })
      .from(roleAssignmentsTable)
      .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
      .where(
        and(
          eq(roleAssignmentsTable.userId, userId),
          eq(roleAssignmentsTable.tenantId, tenantId),
          eq(roleAssignmentsTable.active, true),
        ),
      ),
  );

  res.json({
    userId: user.id,
    tenantId,
    email: user.email,
    givenName: user.givenName,
    familyName: user.familyName,
    roles: assignments.map((a) => a.roleName),
  });
});

// POST /api/v1/auth/logout
router.post("/v1/auth/logout", async (req, res): Promise<void> => {
  const cookies = req.cookies as Record<string, string | undefined>;
  const sid = cookies[SESSION_COOKIE];
  if (sid) {
    await destroySession(sid).catch(() => undefined);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).send();
});

export default router;
