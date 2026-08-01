// Approvals routes — 009_API_SURFACE section 9.
//
// Routes:
//   GET  /v1/approvals/:approvalId              — read (oidcBearer)
//   POST /v1/approvals/:approvalId/grant        — audited + step-up (§13)
//   POST /v1/approvals/:approvalId/deny         — audited, NO step-up (§13)
//
// Only the designated approver (approvals.approver_user_id) may act on an approval.
// This is enforced here at the API layer; the DB CHECK enforces no-self-approval at write time.
//
// Granting is step-up protected: it is a privilege-granting act equivalent in severity to
// evidence view and key shred (009_API_SURFACE section 13, CANON section 9).
// Denying is NOT step-up protected: denial is not privilege-granting, same rationale as
// "denial is not a privilege-granting action" stated explicitly in 009_API_SURFACE section 9.
//
// After all approvals for a tier_escalation subject are granted, bheka-case updates
// case.current_tier and emits bheka.case.tier_escalated.v1. The gateway does not do this
// directly — tier escalation must remain request-then-approve (009_API_SURFACE §9, AI constraint §4).

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { approvalsTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireStepUp } from "../../middleware/require-stepup.js";
import { uuidv7 } from "uuidv7";
import { publishEvent, type ApprovalSubjectType } from "@workspace/nats-client";

const router: IRouter = Router();

// ── GET /v1/approvals ────────────────────────────────────────────────────────
// Cursor-paginated tenant-scoped list. Optional filters: status, caseId.
// Read-only and not role-gated, matching GET /v1/cases and GET /v1/detections:
// approvals carry no evidence content, only workflow state.

router.get(
  "/v1/approvals",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;
    const filterStatus = req.query.status as string | undefined;
    const filterCaseId = req.query.caseId as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(approvalsTable)
        .where(
          and(
            eq(approvalsTable.tenantId, tenantId),
            cursor ? gt(approvalsTable.id, cursor) : undefined,
            filterStatus
              ? sql`${approvalsTable.status} = ${filterStatus}::approval_status`
              : undefined,
            filterCaseId ? eq(approvalsTable.caseId, filterCaseId) : undefined,
          ),
        )
        .orderBy(approvalsTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((a) => ({
        id: a.id,
        tenantId: a.tenantId,
        caseId: a.caseId,
        subjectType: a.subjectType,
        approverUserId: a.approverUserId,
        requestedByUserId: a.requestedByUserId,
        status: a.status,
        isInformationOfficerApproval: a.isInformationOfficerApproval,
        expiresAt: a.expiresAt,
        decisionAt: a.decisionAt,
        decisionNotes: a.decisionNotes,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── GET /v1/approvals/:approvalId ────────────────────────────────────────────

router.get(
  "/v1/approvals/:approvalId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const approvalId = req.params.approvalId as string;

    const [approval] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(approvalsTable)
        .where(
          and(
            eq(approvalsTable.id, approvalId),
            eq(approvalsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!approval) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: approval.id,
      tenantId: approval.tenantId,
      caseId: approval.caseId,
      subjectType: approval.subjectType,
      approverUserId: approval.approverUserId,
      requestedByUserId: approval.requestedByUserId,
      status: approval.status,
      isInformationOfficerApproval: approval.isInformationOfficerApproval,
      expiresAt: approval.expiresAt,
      decisionAt: approval.decisionAt,
      decisionNotes: approval.decisionNotes,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
    });
  },
);

// ── POST /v1/approvals/:approvalId/grant ─────────────────────────────────────

const GrantBody = z.object({
  decisionNotes: z.string().max(2000).optional(),
});

router.post(
  "/v1/approvals/:approvalId/grant",
  requireSession,
  requireStepUp,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const approvalId = req.params.approvalId as string;
    const actorId = req.session!.userId;

    const parsed = GrantBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(parsed.error.message));
      return;
    }

    const [approval] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(approvalsTable)
        .where(
          and(
            eq(approvalsTable.id, approvalId),
            eq(approvalsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!approval) {
      sendProblem(res, Problems.notFound());
      return;
    }

    // Only the designated approver may grant.
    if (approval.approverUserId !== actorId) {
      sendProblem(res, Problems.forbidden("Only the designated approver may grant this approval"));
      return;
    }

    if (approval.status !== "pending") {
      sendProblem(res, Problems.validationFailed(
        `Approval is already in status '${approval.status}' and cannot be granted`,
      ));
      return;
    }

    const now = new Date();
    if (approval.expiresAt < now) {
      sendProblem(res, Problems.validationFailed("Approval window has expired"));
      return;
    }

    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(approvalsTable)
        .set({
          status: "granted",
          decisionAt: now,
          updatedAt: now,
          ...(parsed.data.decisionNotes !== undefined
            ? { decisionNotes: parsed.data.decisionNotes }
            : {}),
        })
        .where(
          and(
            eq(approvalsTable.id, approvalId),
            eq(approvalsTable.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "approval.granted",
      targetType: "approval",
      targetId: approvalId,
      requestId: String(req.headers["idempotency-key"] ?? req.headers["x-request-id"] ?? ""),
      metadata: { caseId: approval.caseId, subjectType: approval.subjectType },
    });

    // bheka-case subscribes to this event and — once all approvals for a
    // tier_escalation subject are granted — updates case.current_tier and
    // emits bheka.case.tier_escalated.v1. The gateway does not perform the
    // tier update directly (009_API_SURFACE section 9).
    await publishEvent({
      event_id: uuidv7(),
      schema_version: "bheka.approval.granted.v1",
      occurred_at: new Date().toISOString(),
      producer: "bheka-case",
      data: {
        approval_id: updated!.id,
        case_id: updated!.caseId,
        tenant_id: tenantId,
        subject_type: updated!.subjectType as ApprovalSubjectType,
        approver_user_id: actorId,
        is_information_officer_approval: updated!.isInformationOfficerApproval,
        decision_notes: parsed.data?.decisionNotes,
      },
    });

    res.json({
      id: updated!.id,
      caseId: updated!.caseId,
      subjectType: updated!.subjectType,
      approverUserId: updated!.approverUserId,
      status: updated!.status,
      isInformationOfficerApproval: updated!.isInformationOfficerApproval,
      decisionAt: updated!.decisionAt,
      decisionNotes: updated!.decisionNotes,
      updatedAt: updated!.updatedAt,
    });
  },
);

// ── POST /v1/approvals/:approvalId/deny ──────────────────────────────────────
// Audited but NO step-up: denial is not a privilege-granting action (§13).

const DenyBody = z.object({
  decisionNotes: z.string().max(2000).optional(),
});

router.post(
  "/v1/approvals/:approvalId/deny",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const approvalId = req.params.approvalId as string;
    const actorId = req.session!.userId;

    const parsed = DenyBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(parsed.error.message));
      return;
    }

    const [approval] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(approvalsTable)
        .where(
          and(
            eq(approvalsTable.id, approvalId),
            eq(approvalsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!approval) {
      sendProblem(res, Problems.notFound());
      return;
    }

    // Only the designated approver may deny.
    if (approval.approverUserId !== actorId) {
      sendProblem(res, Problems.forbidden("Only the designated approver may deny this approval"));
      return;
    }

    if (approval.status !== "pending") {
      sendProblem(res, Problems.validationFailed(
        `Approval is already in status '${approval.status}' and cannot be denied`,
      ));
      return;
    }

    const now = new Date();

    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(approvalsTable)
        .set({
          status: "denied",
          decisionAt: now,
          updatedAt: now,
          ...(parsed.data.decisionNotes !== undefined
            ? { decisionNotes: parsed.data.decisionNotes }
            : {}),
        })
        .where(
          and(
            eq(approvalsTable.id, approvalId),
            eq(approvalsTable.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "approval.denied",
      targetType: "approval",
      targetId: approvalId,
      requestId: String(req.headers["idempotency-key"] ?? req.headers["x-request-id"] ?? ""),
      metadata: { caseId: approval.caseId, subjectType: approval.subjectType },
    });

    res.json({
      id: updated!.id,
      caseId: updated!.caseId,
      subjectType: updated!.subjectType,
      approverUserId: updated!.approverUserId,
      status: updated!.status,
      decisionAt: updated!.decisionAt,
      decisionNotes: updated!.decisionNotes,
      updatedAt: updated!.updatedAt,
    });
  },
);

export default router;
