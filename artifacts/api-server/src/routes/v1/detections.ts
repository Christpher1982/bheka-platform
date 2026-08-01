// Detections and risk scores routes — 009_API_SURFACE section 8.
//
// Routes:
//   GET   /v1/detections                        — cursor-paginated list (oidcBearer)
//   GET   /v1/detections/:detectionId           — single detection (oidcBearer)
//   PATCH /v1/detections/:detectionId           — triage state change (audited)
//   GET   /v1/users/:userId/risk-scores         — read-only, cursor-paginated (oidcBearer)
//
// Detections and risk_scores are NEVER created by a console-facing REST call —
// they are produced by bheka-policy reacting to telemetry (009_API_SURFACE
// section 8) or by the v0 rule engine on agent ingest (see v1/agent-events.ts).
// The PATCH endpoint is the only write here; it updates triage state only.
//
// No WebAuthn step-up required for any route in this group.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db, detectionsTable, riskScoresTable, usersTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";

const router: IRouter = Router();

// ── GET /v1/detections ──────────────────────────────────────────────────────
// Newest first. IDs are UUIDv7, so descending id order is descending time order
// and the cursor stays a single opaque id.
// Optional filters: status, subjectUserId, tier

router.get(
  "/v1/detections",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;
    const filterStatus = req.query.status as string | undefined;
    const filterSubjectUserId = req.query.subjectUserId as string | undefined;
    const filterTier = req.query.tier ? Number(req.query.tier) : undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(detectionsTable)
        .where(
          and(
            eq(detectionsTable.tenantId, tenantId),
            cursor ? lt(detectionsTable.id, cursor) : undefined,
            filterStatus
              ? sql`${detectionsTable.status} = ${filterStatus}::detection_status`
              : undefined,
            filterSubjectUserId
              ? eq(detectionsTable.subjectUserId, filterSubjectUserId)
              : undefined,
            filterTier
              ? eq(detectionsTable.tier, filterTier)
              : undefined,
          ),
        )
        .orderBy(desc(detectionsTable.id))
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((d) => ({
        id: d.id,
        tenantId: d.tenantId,
        siteId: d.siteId,
        policyRuleId: d.policyRuleId,
        ruleName: d.ruleName,
        severity: d.severity,
        summary: d.summary,
        subjectUserId: d.subjectUserId,
        caseId: d.caseId,
        tier: d.tier,
        status: d.status,
        sourceEventIds: d.sourceEventIds,
        sourceEventId: d.sourceEventId,
        occurredAt: d.occurredAt,
        triagedAt: d.triagedAt,
        triagedBy: d.triagedBy,
        resolvedAt: d.resolvedAt,
        resolvedBy: d.resolvedBy,
        notes: d.notes,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── GET /v1/detections/:detectionId ────────────────────────────────────────

router.get(
  "/v1/detections/:detectionId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const detectionId = req.params.detectionId as string;

    const [detection] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(detectionsTable)
        .where(
          and(
            eq(detectionsTable.id, detectionId),
            eq(detectionsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!detection) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: detection.id,
      tenantId: detection.tenantId,
      siteId: detection.siteId,
      policyRuleId: detection.policyRuleId,
      ruleName: detection.ruleName,
      severity: detection.severity,
      summary: detection.summary,
      subjectUserId: detection.subjectUserId,
      caseId: detection.caseId,
      tier: detection.tier,
      status: detection.status,
      sourceEventIds: detection.sourceEventIds,
      sourceEventId: detection.sourceEventId,
      occurredAt: detection.occurredAt,
      triagedAt: detection.triagedAt,
      triagedBy: detection.triagedBy,
      resolvedAt: detection.resolvedAt,
      resolvedBy: detection.resolvedBy,
      notes: detection.notes,
      createdAt: detection.createdAt,
      updatedAt: detection.updatedAt,
    });
  },
);

// ── PATCH /v1/detections/:detectionId ──────────────────────────────────────
// Triage state transitions. Audited per 009_API_SURFACE section 8.
// Valid transitions: new → triaged, new/triaged → resolved, any → false_positive.
// Setting triagedAt/resolvedBy timestamps is done here, not by bheka-policy.

const TriageStatuses = ["triaged", "resolved", "false_positive"] as const;

const PatchDetectionBody = z.object({
  status: z.enum(TriageStatuses),
  notes: z.string().max(4000).optional(),
});

router.patch(
  "/v1/detections/:detectionId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const detectionId = req.params.detectionId as string;
    const actorId = req.session!.userId;

    const parsed = PatchDetectionBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(
        res,
        Problems.validationFailed(parsed.error.message, parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          code: i.code,
          message: i.message,
        }))),
      );
      return;
    }

    const now = new Date();
    const { status, notes } = parsed.data;

    // Build a typed update shape. All fields are optional on detectionsTable.
    const triageFields =
      status === "triaged"
        ? { triagedAt: now, triagedBy: actorId }
        : status === "resolved" || status === "false_positive"
          ? { resolvedAt: now, resolvedBy: actorId }
          : {};

    // Write audit log before the update so the log is always present even if
    // the update fails part-way through a future transaction (defence-in-depth).
    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "detection.triaged",
      targetType: "detection",
      targetId: detectionId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { status },
    });

    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(detectionsTable)
        .set({
          status,
          updatedAt: now,
          ...(notes !== undefined ? { notes } : {}),
          ...triageFields,
        })
        .where(
          and(
            eq(detectionsTable.id, detectionId),
            eq(detectionsTable.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    if (!updated) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: updated.id,
      tenantId: updated.tenantId,
      policyRuleId: updated.policyRuleId,
      subjectUserId: updated.subjectUserId,
      tier: updated.tier,
      status: updated.status,
      triagedAt: updated.triagedAt,
      triagedBy: updated.triagedBy,
      resolvedAt: updated.resolvedAt,
      resolvedBy: updated.resolvedBy,
      notes: updated.notes,
      updatedAt: updated.updatedAt,
    });
  },
);

// ── GET /v1/users/:userId/risk-scores ───────────────────────────────────────
// Read-only. Cursor-paginated by id (append-only table; id order = insertion order).
// Subject user must belong to the authenticated tenant.

router.get(
  "/v1/users/:userId/risk-scores",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const userId = req.params.userId as string;

    // Verify the subject user belongs to this tenant before returning their scores.
    const [user] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, userId),
            eq(usersTable.tenantId, tenantId),
            sql`${usersTable.deletedAt} IS NULL`,
          ),
        )
        .limit(1),
    );

    if (!user) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(riskScoresTable)
        .where(
          and(
            eq(riskScoresTable.userId, userId),
            eq(riskScoresTable.tenantId, tenantId),
            cursor ? gt(riskScoresTable.id, cursor) : undefined,
          ),
        )
        .orderBy(riskScoresTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      userId,
      items: items.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        userId: r.userId,
        score: r.score,
        contributingSignals: r.contributingSignals,
        scoredAt: r.scoredAt,
        createdAt: r.createdAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

export default router;
