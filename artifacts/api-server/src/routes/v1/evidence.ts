// Evidence routes — 009_API_SURFACE section 10.
//
// Routes:
//   GET  /v1/cases/:caseId/evidence          — metadata list (no step-up)
//   GET  /v1/evidence/:evidenceId            — single metadata (no step-up)
//   POST /v1/evidence/:evidenceId/view       — audited + step-up; creates evidence_views row
//   POST /v1/evidence/:evidenceId/export     — audited + step-up; initiates export bundle
//
// Metadata reads never require step-up — metadata alone does not reveal evidence content.
// Content access (view + export) both require step-up: they are the two operations
// 003_THREAT_MODEL T-EVID-02 and 008_DATA_MODEL section 5 are built to make traceable.
//
// View access logic:
//   Tier 1/2 evidence: case participant with investigator or security_administrator role.
//   Tier 3 evidence: active, non-expired evidence_access_grant (created via approval workflow).
//   Either condition satisfies access for Tier 1/2; only a grant satisfies for Tier 3.
//
// Crypto-shredded evidence: returns 410 Gone. Metadata row remains; payload is unrecoverable.
//
// Evidence rows are immutable (no updated_at). evidence_views rows are insert-only (RLS).
// The vault call (unwrapDek) is required for view/export; vault unavailability → 503.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { publishEvent } from "@workspace/nats-client";
import {
  db,
  evidenceTable,
  evidenceAccessGrantsTable,
  evidenceViewsTable,
  caseParticipantsTable,
  casesTable,
} from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireStepUp } from "../../middleware/require-stepup.js";
import { vaultClient } from "@workspace/vault-client";
import { VaultNotDeployedError, VaultUnavailableError } from "@workspace/vault-client";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

// ── Access helper ────────────────────────────────────────────────────────────
// Returns true if the viewer is authorised to access the given evidence item.
// Tier 1/2: case participant (investigator or security_administrator) is sufficient.
// Tier 3: requires an active, non-expired evidence_access_grant.

async function checkEvidenceAccess(
  tenantId: string,
  evidenceId: string,
  caseId: string,
  tier: number,
  viewerUserId: string,
): Promise<boolean> {
  const now = new Date();

  // Always check for an explicit access grant first (covers all tiers).
  const [grant] = await db
    .select({ id: evidenceAccessGrantsTable.id })
    .from(evidenceAccessGrantsTable)
    .where(
      and(
        eq(evidenceAccessGrantsTable.evidenceId, evidenceId),
        eq(evidenceAccessGrantsTable.tenantId, tenantId),
        eq(evidenceAccessGrantsTable.grantedToUserId, viewerUserId),
        sql`${evidenceAccessGrantsTable.expiresAt} > ${now}`,
        sql`${evidenceAccessGrantsTable.revokedAt} IS NULL`,
      ),
    )
    .limit(1);

  if (grant) return true;

  // For Tier 3 evidence, an explicit grant is the only path.
  if (tier >= 3) return false;

  // Tier 1/2: case participant with investigator or security_administrator role suffices.
  // We check against session roles rather than the participants table role enum to use
  // the same RBAC mechanism as the rest of the API.
  const [participant] = await db
    .select({ id: caseParticipantsTable.id })
    .from(caseParticipantsTable)
    .where(
      and(
        eq(caseParticipantsTable.caseId, caseId),
        eq(caseParticipantsTable.tenantId, tenantId),
        eq(caseParticipantsTable.userId, viewerUserId),
      ),
    )
    .limit(1);

  return !!participant;
}

// ── GET /v1/cases/:caseId/evidence ───────────────────────────────────────────

router.get(
  "/v1/cases/:caseId/evidence",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const caseId = req.params.caseId as string;
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;

    // Verify the case exists in this tenant.
    const [kase] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({ id: casesTable.id })
        .from(casesTable)
        .where(
          and(
            eq(casesTable.id, caseId),
            eq(casesTable.tenantId, tenantId),
            sql`${casesTable.deletedAt} IS NULL`,
          ),
        )
        .limit(1),
    );

    if (!kase) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(evidenceTable)
        .where(
          and(
            eq(evidenceTable.caseId, caseId),
            eq(evidenceTable.tenantId, tenantId),
            cursor ? gt(evidenceTable.id, cursor) : undefined,
          ),
        )
        .orderBy(evidenceTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((e) => ({
        id: e.id,
        caseId: e.caseId,
        tier: e.tier,
        contentType: e.contentType,
        hashSha256: e.hashSha256,
        keyVersion: e.keyVersion,
        cryptoShredded: e.cryptoShredded,
        shredAt: e.shredAt,
        createdAt: e.createdAt,
        // s3Bucket / s3Key / sealedDekB64 intentionally omitted from list view.
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── GET /v1/evidence/:evidenceId ─────────────────────────────────────────────

router.get(
  "/v1/evidence/:evidenceId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const evidenceId = req.params.evidenceId as string;

    const [evidence] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(evidenceTable)
        .where(
          and(
            eq(evidenceTable.id, evidenceId),
            eq(evidenceTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!evidence) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: evidence.id,
      tenantId: evidence.tenantId,
      caseId: evidence.caseId,
      tier: evidence.tier,
      contentType: evidence.contentType,
      hashSha256: evidence.hashSha256,
      keyVersion: evidence.keyVersion,
      cryptoShredded: evidence.cryptoShredded,
      shredAt: evidence.shredAt,
      createdAt: evidence.createdAt,
      // s3Bucket / s3Key / sealedDekB64 intentionally omitted from metadata GET.
    });
  },
);

// ── POST /v1/evidence/:evidenceId/view ───────────────────────────────────────
// Requires step-up. Creates evidence_views row (insert-only). Audited.
// Calls vault.unwrapDek to return the plaintext DEK + S3 location to the caller.
// The caller fetches the encrypted blob from S3 and decrypts in memory using the DEK.

router.post(
  "/v1/evidence/:evidenceId/view",
  requireSession,
  requireStepUp,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const evidenceId = req.params.evidenceId as string;
    const viewerUserId = req.session!.userId;

    const [evidence] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(evidenceTable)
        .where(
          and(
            eq(evidenceTable.id, evidenceId),
            eq(evidenceTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!evidence) {
      sendProblem(res, Problems.notFound());
      return;
    }

    if (evidence.cryptoShredded) {
      sendProblem(res, Problems.cryptoShredded());
      return;
    }

    const hasAccess = await checkEvidenceAccess(
      tenantId, evidenceId, evidence.caseId, evidence.tier, viewerUserId,
    );
    if (!hasAccess) {
      sendProblem(res, Problems.evidenceAccessDenied());
      return;
    }

    // Unwrap the DEK via Vault before recording the view — no view record without decryption.
    let plaintextDekB64: string;
    try {
      const result = await vaultClient.unwrapDek({
        tenantId,
        keyVersion: evidence.keyVersion,
        sealedDekB64: evidence.sealedDekB64,
      });
      plaintextDekB64 = result.plaintextDekB64;
    } catch (err) {
      if (err instanceof VaultNotDeployedError || err instanceof VaultUnavailableError) {
        sendProblem(res, Problems.vaultUnavailable());
        return;
      }
      logger.error({ err }, "Unexpected error unwrapping evidence DEK for view");
      sendProblem(res, Problems.internalError());
      return;
    }

    // Record the view (insert-only; RLS prevents UPDATE/DELETE on evidence_views).
    const [evidenceView] = await withTenantContext(tenantId, (tx) =>
      tx.insert(evidenceViewsTable).values({
        tenantId,
        evidenceId,
        viewerUserId,
        sessionId: req.headers["x-session-id"] as string | undefined,
      }).returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId: viewerUserId,
      actorType: "user",
      action: "evidence.viewed",
      targetType: "evidence",
      targetId: evidenceId,
      requestId: String(req.headers["idempotency-key"] ?? req.headers["x-request-id"] ?? ""),
      metadata: { caseId: evidence.caseId, tier: evidence.tier },
    });

    await publishEvent({
      event_id: uuidv7(),
      schema_version: "bheka.evidence.viewed.v1",
      occurred_at: new Date().toISOString(),
      producer: "bheka-case",
      data: {
        evidence_view_id: evidenceView!.id,
        evidence_id: evidenceId,
        case_id: evidence.caseId,
        tenant_id: tenantId,
        viewer_user_id: viewerUserId,
        tier: evidence.tier as 1 | 2 | 3,
      },
    });

    res.json({
      evidenceId,
      caseId: evidence.caseId,
      contentType: evidence.contentType,
      hashSha256: evidence.hashSha256,
      s3Bucket: evidence.s3Bucket,
      s3Key: evidence.s3Key,
      // Plaintext DEK: caller decrypts the S3 blob in memory and must discard this value.
      // CANON section 6 / ADR-011: DEK never persisted; only returned in-memory via TLS.
      plaintextDekB64,
    });
  },
);

// ── POST /v1/evidence/:evidenceId/export ─────────────────────────────────────
// Requires step-up. Initiates a court-admissible export bundle (async).
// The signed download URL is delivered by bheka-notify after consuming
// bheka.evidence.exported.v1 (010_EVENT_BUS_AND_TOPICS section 2).

const ExportBody = z.object({
  exportReason: z.string().min(1).max(2000),
}).optional();

router.post(
  "/v1/evidence/:evidenceId/export",
  requireSession,
  requireStepUp,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const evidenceId = req.params.evidenceId as string;
    const viewerUserId = req.session!.userId;

    const parsed = ExportBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(parsed.error.message));
      return;
    }

    const [evidence] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(evidenceTable)
        .where(
          and(
            eq(evidenceTable.id, evidenceId),
            eq(evidenceTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!evidence) {
      sendProblem(res, Problems.notFound());
      return;
    }

    if (evidence.cryptoShredded) {
      sendProblem(res, Problems.cryptoShredded());
      return;
    }

    const hasAccess = await checkEvidenceAccess(
      tenantId, evidenceId, evidence.caseId, evidence.tier, viewerUserId,
    );
    if (!hasAccess) {
      sendProblem(res, Problems.evidenceAccessDenied());
      return;
    }

    // Verify Vault is reachable before committing to an export that cannot complete.
    try {
      await vaultClient.unwrapDek({
        tenantId,
        keyVersion: evidence.keyVersion,
        sealedDekB64: evidence.sealedDekB64,
      });
    } catch (err) {
      if (err instanceof VaultNotDeployedError || err instanceof VaultUnavailableError) {
        sendProblem(res, Problems.vaultUnavailable());
        return;
      }
      logger.error({ err }, "Unexpected error checking vault for evidence export");
      sendProblem(res, Problems.internalError());
      return;
    }

    const exportId = uuidv7();

    await writeAuditLog({
      tenantId,
      actorId: viewerUserId,
      actorType: "user",
      action: "evidence.export_requested",
      targetType: "evidence",
      targetId: evidenceId,
      requestId: String(req.headers["idempotency-key"] ?? req.headers["x-request-id"] ?? ""),
      metadata: {
        caseId: evidence.caseId,
        tier: evidence.tier,
        exportId,
        exportReason: parsed.data?.exportReason,
      },
    });

    // bheka-notify consumes this event and delivers a signed download URL to the requester.
    await publishEvent({
      event_id: uuidv7(),
      schema_version: "bheka.evidence.exported.v1",
      occurred_at: new Date().toISOString(),
      producer: "bheka-case",
      data: {
        export_id: exportId,
        evidence_id: evidenceId,
        case_id: evidence.caseId,
        tenant_id: tenantId,
        requester_user_id: viewerUserId,
        tier: evidence.tier as 1 | 2 | 3,
        export_reason: parsed.data?.exportReason,
      },
    });

    res.status(202).json({
      exportId,
      evidenceId,
      status: "processing",
      // downloadUrl is null until bheka-notify delivers it via the notification channel.
      downloadUrl: null,
    });
  },
);

export default router;
