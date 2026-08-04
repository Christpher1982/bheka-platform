// Endpoints and Agents routes — 009_API_SURFACE section 6.
//
// Routes:
//   GET  /v1/endpoints                                  — fleet view (oidcBearer)
//   GET  /v1/endpoints/:endpointId                      — single endpoint (oidcBearer)
//   POST /v1/agents/enrol                               — enrolmentToken, audited
//   POST /v1/agents/mobile-enrol                        — enrolmentToken, audited, no CSR/mTLS
//   POST /v1/agents/mobile-enrol-token                  — requireSession, mints enrolmentToken
//   POST /v1/agents/:agentId/heartbeat                  — agentMutualTLS, NOT audited
//   GET  /v1/agents/:agentId                            — single agent (oidcBearer)
//   GET  /v1/agent-versions                             — system-wide list (oidcBearer)
//   POST /v1/agent-versions/:agentVersionId/advance-ring — audited, security_administrator
//
// Heartbeat is intentionally not audited: high-frequency telemetry, not a privileged
// action. The deliberate exception is documented in 009_API_SURFACE section 14.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { randomBytes, createHash } from "node:crypto";
import { publishEvent } from "@workspace/nats-client";
import {
  db,
  endpointsTable,
  agentsTable,
  agentVersionsTable,
  sitesTable,
  tenantsTable,
} from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";
import { requireAgentMTLS } from "../../middleware/require-agent-mtls.js";
import { vaultClient } from "@workspace/vault-client";
import {
  VaultNotDeployedError,
  VaultUnavailableError,
} from "@workspace/vault-client";
import { logger } from "../../lib/logger.js";
import { redis } from "../../lib/redis.js";

const router: IRouter = Router();

// Ring progression for advance-ring; ordered most-restricted to fully-released.
const RING_ORDER = ["canary", "ring_0", "ring_1", "ring_2", "ring_3"] as const;
type UpdateRing = (typeof RING_ORDER)[number];

function nextRing(current: UpdateRing): UpdateRing | null {
  const idx = RING_ORDER.indexOf(current);
  return idx === -1 || idx === RING_ORDER.length - 1 ? null : RING_ORDER[idx + 1]!;
}

// ── GET /v1/endpoints ───────────────────────────────────────────────────────

router.get(
  "/v1/endpoints",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(endpointsTable)
        .where(
          and(
            eq(endpointsTable.tenantId, tenantId),
            cursor ? gt(endpointsTable.id, cursor) : undefined,
            sql`${endpointsTable.deletedAt} IS NULL`,
          ),
        )
        .orderBy(endpointsTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((e) => ({
        id: e.id,
        tenantId: e.tenantId,
        siteId: e.siteId,
        name: e.name,
        hostname: e.hostname,
        isCorporateOwned: e.isCorporateOwned,
        updateRing: e.updateRing,
        active: e.active,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── GET /v1/endpoints/:endpointId ───────────────────────────────────────────

router.get(
  "/v1/endpoints/:endpointId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const endpointId = req.params.endpointId as string;

    const [endpoint] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(endpointsTable)
        .where(
          and(
            eq(endpointsTable.id, endpointId),
            eq(endpointsTable.tenantId, tenantId),
            sql`${endpointsTable.deletedAt} IS NULL`,
          ),
        )
        .limit(1),
    );

    if (!endpoint) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: endpoint.id,
      tenantId: endpoint.tenantId,
      siteId: endpoint.siteId,
      name: endpoint.name,
      hostname: endpoint.hostname,
      isCorporateOwned: endpoint.isCorporateOwned,
      updateRing: endpoint.updateRing,
      active: endpoint.active,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    });
  },
);

// ── POST /v1/agents/enrol ───────────────────────────────────────────────────
// Auth: single-use enrolment token validated from Redis.
// Creates endpoints + agents rows, issues mTLS cert via Vault, writes audit log.
// Token format stored in Redis: bheka:enrol_token:{token} → JSON payload.

const EnrolBody = z.object({
  tenantId: z.string().uuid(),
  enrolmentToken: z.string().min(1),
  csrPem: z.string().min(1),
  hostname: z.string().min(1).max(253),
  name: z.string().min(1).max(200),
  siteId: z.string().uuid(),
  // platform must match the agent binary that presented the CSR.
  // android/ios are not accepted here — mobile agents use the lighter-weight
  // POST /v1/agents/mobile-enrol flow instead (no CSR/mTLS support on device).
  platform: z.enum(["windows", "linux", "macos"]),
  agentVersionId: z.string().uuid(),
});

router.post(
  "/v1/agents/enrol",
  async (req, res): Promise<void> => {
    const parsed = EnrolBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(
        res,
        Problems.validationFailed(
          parsed.error.message,
          parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            code: i.code,
            message: i.message,
          })),
        ),
      );
      return;
    }

    const { tenantId, enrolmentToken, csrPem, hostname, name, siteId, platform, agentVersionId } =
      parsed.data;

    // Validate and atomically consume the single-use enrolment token.
    const tokenKey = `bheka:enrol_token:${enrolmentToken}`;
    const tokenPayload = await redis.getdel(tokenKey);
    if (!tokenPayload) {
      sendProblem(res, Problems.invalidEnrolmentToken());
      return;
    }

    let tokenData: { tenantId: string };
    try {
      tokenData = JSON.parse(tokenPayload) as { tenantId: string };
    } catch {
      sendProblem(res, Problems.invalidEnrolmentToken());
      return;
    }

    // Token must belong to the same tenant asserted in the body.
    if (tokenData.tenantId !== tenantId) {
      sendProblem(res, Problems.invalidEnrolmentToken());
      return;
    }

    const agentId = uuidv7();

    // Issue the mTLS certificate via Vault before writing any DB rows.
    // VaultNotDeployedError / VaultUnavailableError → 503.
    let certPem: string;
    let certFingerprint: string;
    try {
      const certResult = await vaultClient.issueAgentCert({ tenantId, agentId, csrPem });
      certPem = certResult.certificatePem;
      certFingerprint = certResult.certificateFingerprint;
    } catch (err) {
      if (err instanceof VaultNotDeployedError || err instanceof VaultUnavailableError) {
        sendProblem(res, Problems.vaultUnavailable());
        return;
      }
      logger.error({ err }, "Unexpected error issuing agent certificate");
      sendProblem(res, Problems.internalError());
      return;
    }

    // Hash the consumed token for the audit record (never store the raw token).
    const tokenHash = createHash("sha256").update(enrolmentToken).digest("hex");

    // Fetch the tenant public key so the agent can seal its first blobs immediately.
    let tenantPublicKeyB64: string;
    try {
      const pk = await vaultClient.getTenantPublicKey({ tenantId });
      tenantPublicKeyB64 = pk.publicKeyX25519B64;
    } catch (err) {
      if (err instanceof VaultNotDeployedError || err instanceof VaultUnavailableError) {
        sendProblem(res, Problems.vaultUnavailable());
        return;
      }
      logger.error({ err }, "Unexpected error fetching tenant public key");
      sendProblem(res, Problems.internalError());
      return;
    }

    // Write endpoint + agent rows inside a tenant-context transaction.
    const { endpoint, agent } = await withTenantContext(tenantId, async (tx) => {
      const [ep] = await tx
        .insert(endpointsTable)
        .values({ tenantId, siteId, name, hostname, isCorporateOwned: true })
        .onConflictDoNothing()
        .returning();

      // If onConflictDoNothing fired (hostname already exists), fetch existing row.
      const resolvedEp = ep ?? (
        await tx
          .select()
          .from(endpointsTable)
          .where(
            and(
              eq(endpointsTable.hostname, hostname),
              eq(endpointsTable.tenantId, tenantId),
            ),
          )
          .limit(1)
      )[0]!;

      const [ag] = await tx
        .insert(agentsTable)
        .values({
          id: agentId,
          tenantId,
          endpointId: resolvedEp.id,
          agentVersionId,
          certificateFingerprint: certFingerprint,
          enrolmentTokenHash: tokenHash,
        })
        .returning();

      return { endpoint: resolvedEp, agent: ag! };
    });

    await writeAuditLog({
      tenantId,
      actorId: agent.id,
      actorType: "agent",
      action: "agent.enrolled",
      targetType: "agent",
      targetId: agent.id,
      requestId: String(req.headers["idempotency-key"] ?? uuidv7()),
      metadata: { endpointId: endpoint.id, platform, agentVersionId },
    });

    await publishEvent({
      event_id: uuidv7(),
      schema_version: "bheka.agent.enrolled.v1",
      occurred_at: new Date().toISOString(),
      producer: "bheka-gateway",
      data: {
        agent_id: agent.id,
        endpoint_id: endpoint.id,
        tenant_id: tenantId,
        site_id: endpoint.siteId,
        platform,
        agent_version_id: agentVersionId,
        certificate_fingerprint: certFingerprint,
      },
    });

    res.status(201).json({
      agentId: agent.id,
      endpointId: endpoint.id,
      certificatePem: certPem,
      tenantPublicKeyX25519B64: tenantPublicKeyB64,
    });
  },
);

// ── POST /v1/agents/mobile-enrol ─────────────────────────────────────────────
// Auth: single-use enrolment token validated from Redis (same mechanism as
// /v1/agents/enrol) — no middleware, since the token in the body IS the auth.
//
// Lightweight enrolment for android/ios PoC-stage agents: no CSR, no Vault
// mTLS cert issuance, no endpoints row (mobile devices are not corporate-owned
// endpoints — CANON section 5 refusal 4 permanently forbids BYOD endpoints).
// The mobile app instead authenticates ingest calls with the same shared
// X-Agent-Token used by POST /api/v1/agent/events.
//
// Idempotent: re-installing the app resubmits the same device-generated
// deviceId, so a second call with the same (tenantId, deviceId) returns the
// existing agentId rather than creating a duplicate row.
const MobileEnrolBody = z.object({
  tenantId: z.string().uuid(),
  enrolmentToken: z.string().min(1),
  deviceId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  siteId: z.string().uuid(),
  platform: z.enum(["android", "ios"]),
  appVersion: z.string().max(50),
});

// Fallback agent_versions row used when no real release exists yet for a
// mobile platform. Keeps mobile-enrol usable before a proper mobile build
// pipeline publishes real agent_versions rows.
const MOBILE_PLACEHOLDER_VERSION_STRING = "mobile-1.0.0";

async function resolveMobileAgentVersionId(
  platform: "android" | "ios",
): Promise<string> {
  const [existing] = await db
    .select({ id: agentVersionsTable.id })
    .from(agentVersionsTable)
    .where(eq(agentVersionsTable.platform, platform))
    .orderBy(desc(agentVersionsTable.releasedAt))
    .limit(1);

  if (existing) return existing.id;

  // No agent_versions row exists yet for this platform — create a placeholder
  // so mobile-enrol does not hard-fail before a real mobile release pipeline
  // exists. onConflictDoNothing handles the race between concurrent enrolments.
  const [placeholder] = await db
    .insert(agentVersionsTable)
    .values({
      versionString: `${MOBILE_PLACEHOLDER_VERSION_STRING}-${platform}`,
      platform,
      artifactHash: "0".repeat(64),
      minimumRing: "ring_3",
      releasedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: agentVersionsTable.id });

  if (placeholder) return placeholder.id;

  // Lost the race — another request just inserted it; fetch it.
  const [afterRace] = await db
    .select({ id: agentVersionsTable.id })
    .from(agentVersionsTable)
    .where(
      eq(
        agentVersionsTable.versionString,
        `${MOBILE_PLACEHOLDER_VERSION_STRING}-${platform}`,
      ),
    )
    .limit(1);

  return afterRace!.id;
}

router.post(
  "/v1/agents/mobile-enrol",
  async (req, res): Promise<void> => {
    const parsed = MobileEnrolBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(
        res,
        Problems.validationFailed(
          parsed.error.message,
          parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            code: i.code,
            message: i.message,
          })),
        ),
      );
      return;
    }

    const { tenantId, enrolmentToken, deviceId, name, siteId, platform, appVersion } =
      parsed.data;

    // Validate and atomically consume the single-use enrolment token.
    const tokenKey = `bheka:enrol_token:${enrolmentToken}`;
    const tokenPayload = await redis.getdel(tokenKey);
    if (!tokenPayload) {
      sendProblem(res, Problems.invalidEnrolmentToken());
      return;
    }

    let tokenData: { tenantId: string };
    try {
      tokenData = JSON.parse(tokenPayload) as { tenantId: string };
    } catch {
      sendProblem(res, Problems.invalidEnrolmentToken());
      return;
    }

    // Token must belong to the same tenant asserted in the body.
    if (tokenData.tenantId !== tenantId) {
      sendProblem(res, Problems.invalidEnrolmentToken());
      return;
    }

    // siteId must belong to the resolved tenant.
    const [tenant] = await db
      .select({ id: tenantsTable.id, slug: tenantsTable.slug })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!tenant) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const [site] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({ id: sitesTable.id })
        .from(sitesTable)
        .where(and(eq(sitesTable.id, siteId), eq(sitesTable.tenantId, tenantId)))
        .limit(1),
    );

    if (!site) {
      sendProblem(res, Problems.notFound());
      return;
    }

    // Hash the consumed token for the audit record (never store the raw token).
    const tokenHash = createHash("sha256").update(enrolmentToken).digest("hex");

    const { agent, created } = await withTenantContext(tenantId, async (tx) => {
      // Idempotent re-enrolment: same device re-installs the app and resubmits
      // its stable deviceId — return the existing agent rather than duplicating.
      const [existingAgent] = await tx
        .select()
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.hostname, deviceId),
            eq(agentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (existingAgent) {
        return { agent: existingAgent, created: false };
      }

      const agentVersionId = await resolveMobileAgentVersionId(platform);

      const [inserted] = await tx
        .insert(agentsTable)
        .values({
          tenantId,
          siteId,
          name,
          hostname: deviceId,
          agentVersionId,
          active: true,
          enrolmentTokenHash: tokenHash,
        })
        // Guards the same race the SELECT-then-INSERT above cannot fully close.
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        return { agent: inserted, created: true };
      }

      // Lost the race to a concurrent enrolment of the same device — fetch it.
      const [afterRace] = await tx
        .select()
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.hostname, deviceId),
            eq(agentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      return { agent: afterRace!, created: false };
    });

    await writeAuditLog({
      tenantId,
      actorId: agent.id,
      actorType: "agent",
      action: created ? "agent.mobile_enrolled" : "agent.mobile_enrolled.idempotent_replay",
      targetType: "agent",
      targetId: agent.id,
      requestId: String(req.headers["idempotency-key"] ?? uuidv7()),
      metadata: { siteId, platform, appVersion, deviceId },
    });

    if (created) {
      await publishEvent({
        event_id: uuidv7(),
        schema_version: "bheka.agent.enrolled.v1",
        occurred_at: new Date().toISOString(),
        producer: "bheka-gateway",
        data: {
          agent_id: agent.id,
          endpoint_id: null,
          tenant_id: tenantId,
          site_id: siteId,
          platform,
          agent_version_id: agent.agentVersionId,
          certificate_fingerprint: null,
        },
      });
    }

    res.status(201).json({
      agentId: agent.id,
      tenantSlug: tenant.slug,
      siteId,
      // The mobile app learns its subjectUserId out-of-band (MDM config push or
      // QR code), not from this response — kept null here deliberately.
      subjectUserId: null,
    });
  },
);

// ── POST /v1/agents/mobile-enrol-token ───────────────────────────────────────
// Auth: requireSession (console user only). Generates a single-use enrolment
// token an IT admin can turn into a QR code or link for a mobile device to
// scan/open, consumed by POST /v1/agents/mobile-enrol above.

const MobileEnrolTokenBody = z.object({
  tenantId: z.string().uuid(),
  siteId: z.string().uuid(),
  ttlSeconds: z.number().int().positive().max(30 * 24 * 60 * 60).optional(),
});

const DEFAULT_MOBILE_ENROL_TOKEN_TTL_SECONDS = 3600;

router.post(
  "/v1/agents/mobile-enrol-token",
  requireSession,
  async (req, res): Promise<void> => {
    const parsed = MobileEnrolTokenBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(
        res,
        Problems.validationFailed(
          parsed.error.message,
          parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            code: i.code,
            message: i.message,
          })),
        ),
      );
      return;
    }

    const { tenantId, siteId, ttlSeconds } = parsed.data;
    const sessionTenantId = req.session!.tenantId;

    // Console users may only mint tokens for their own tenant.
    if (tenantId !== sessionTenantId) {
      sendProblem(res, Problems.forbidden("tenantId must match the caller's session tenant"));
      return;
    }

    // siteId must belong to the resolved tenant.
    const [site] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({ id: sitesTable.id })
        .from(sitesTable)
        .where(and(eq(sitesTable.id, siteId), eq(sitesTable.tenantId, tenantId)))
        .limit(1),
    );

    if (!site) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const ttl = ttlSeconds ?? DEFAULT_MOBILE_ENROL_TOKEN_TTL_SECONDS;
    const token = randomBytes(32).toString("hex");
    const tokenKey = `bheka:enrol_token:${token}`;

    await redis.setex(tokenKey, ttl, JSON.stringify({ tenantId }));

    res.status(201).json({
      token,
      expiresInSeconds: ttl,
    });
  },
);

// ── POST /v1/agents/:agentId/heartbeat ──────────────────────────────────────
// Auth: agentMutualTLS (X-Agent-Cert-Fingerprint header set by TLS proxy).
// NOT audited — high-frequency telemetry, not a privileged action (§6, §14).

const HeartbeatBody = z.object({
  currentTier: z.enum(["baseline", "elevated", "investigation"]).optional(),
  bufferUsedBytes: z.number().int().min(0).optional(),
  agentVersion: z.string().max(50).optional(),
}).optional();

router.post(
  "/v1/agents/:agentId/heartbeat",
  requireAgentMTLS,
  async (req, res): Promise<void> => {
    const agentId = req.params.agentId as string;

    // Verify the authenticated agent matches the URL param.
    if (req.agent!.id !== agentId) {
      sendProblem(res, Problems.forbidden("Agent certificate does not match agent ID in URL"));
      return;
    }

    const parsed = HeartbeatBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(parsed.error.message));
      return;
    }

    await db
      .update(agentsTable)
      .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(eq(agentsTable.id, agentId));

    await publishEvent({
      event_id: uuidv7(),
      schema_version: "bheka.agent.heartbeat.v1",
      occurred_at: new Date().toISOString(),
      producer: "bheka-gateway",
      data: {
        agent_id: req.agent!.id,
        tenant_id: req.agent!.tenantId,
        endpoint_id: req.agent!.endpointId,
        current_tier: parsed.data?.currentTier,
        buffer_used_bytes: parsed.data?.bufferUsedBytes,
        agent_version: parsed.data?.agentVersion,
      },
    });

    res.status(204).end();
  },
);

// ── GET /v1/agents/:agentId ─────────────────────────────────────────────────

router.get(
  "/v1/agents/:agentId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const agentId = req.params.agentId as string;

    const [agent] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.id, agentId),
            eq(agentsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!agent) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: agent.id,
      tenantId: agent.tenantId,
      endpointId: agent.endpointId,
      agentVersionId: agent.agentVersionId,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      enrolledAt: agent.enrolledAt,
      active: agent.active,
    });
  },
);

// ── GET /v1/agent-versions ──────────────────────────────────────────────────
// agent_versions is NOT tenant-scoped — shared across all tenants (system-wide).

router.get(
  "/v1/agent-versions",
  requireSession,
  async (req, res): Promise<void> => {
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;

    const rows = await db
      .select()
      .from(agentVersionsTable)
      .where(cursor ? gt(agentVersionsTable.id, cursor) : undefined)
      .orderBy(agentVersionsTable.id)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((v) => ({
        id: v.id,
        versionString: v.versionString,
        platform: v.platform,
        artifactHash: v.artifactHash,
        minimumRing: v.minimumRing,
        releasedAt: v.releasedAt,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── POST /v1/agent-versions/:agentVersionId/advance-ring ────────────────────
// Advances minimumRing one step toward ring_3 (canary→ring_0→ring_1→ring_2→ring_3).
// Audited — manual ring advancement is a supply-chain-traceable operator action
// (003_THREAT_MODEL T-SUPPLY-01, 009_API_SURFACE section 6).

router.post(
  "/v1/agent-versions/:agentVersionId/advance-ring",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const agentVersionId = req.params.agentVersionId as string;

    const [version] = await db
      .select()
      .from(agentVersionsTable)
      .where(eq(agentVersionsTable.id, agentVersionId))
      .limit(1);

    if (!version) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const next = nextRing(version.minimumRing as UpdateRing);
    if (!next) {
      sendProblem(res, Problems.ringAlreadyFinal());
      return;
    }

    const [updated] = await db
      .update(agentVersionsTable)
      .set({ minimumRing: next, updatedAt: new Date() })
      .where(eq(agentVersionsTable.id, agentVersionId))
      .returning();

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "agent_version.ring_advanced",
      targetType: "agent_version",
      targetId: agentVersionId,
      requestId: String(req.headers["idempotency-key"] ?? req.headers["x-request-id"] ?? ""),
      metadata: { from: version.minimumRing, to: next, versionString: version.versionString },
    });

    res.json({
      id: updated!.id,
      versionString: updated!.versionString,
      platform: updated!.platform,
      artifactHash: updated!.artifactHash,
      minimumRing: updated!.minimumRing,
      releasedAt: updated!.releasedAt,
      updatedAt: updated!.updatedAt,
    });
  },
);

export default router;
