// Endpoints and Agents routes — 009_API_SURFACE section 6.
//
// Routes:
//   GET  /v1/endpoints                                  — fleet view (oidcBearer)
//   GET  /v1/endpoints/:endpointId                      — single endpoint (oidcBearer)
//   POST /v1/agents/enrol                               — enrolmentToken, audited
//   POST /v1/agents/:agentId/heartbeat                  — agentMutualTLS, NOT audited
//   GET  /v1/agents/:agentId                            — single agent (oidcBearer)
//   GET  /v1/agent-versions                             — system-wide list (oidcBearer)
//   POST /v1/agent-versions/:agentVersionId/advance-ring — audited, security_administrator
//
// Heartbeat is intentionally not audited: high-frequency telemetry, not a privileged
// action. The deliberate exception is documented in 009_API_SURFACE section 14.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { createHash } from "node:crypto";
import {
  db,
  endpointsTable,
  agentsTable,
  agentVersionsTable,
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

    // TODO: emit bheka.agent.enrolled.v1 to NATS JetStream (AGENT stream).
    // Deferred until bheka-nats client is built (010_EVENT_BUS_AND_TOPICS section 2).

    res.status(201).json({
      agentId: agent.id,
      endpointId: endpoint.id,
      certificatePem: certPem,
      tenantPublicKeyX25519B64: tenantPublicKeyB64,
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

    // TODO: emit bheka.agent.heartbeat.v1 to NATS JetStream (AGENT stream).
    // Deferred until bheka-nats client is built (010_EVENT_BUS_AND_TOPICS section 2).

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
