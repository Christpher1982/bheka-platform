// Cases, participants, and tier-escalations — 009_API_SURFACE section 9.
//
// Routes:
//   GET  /v1/cases                                   — cursor-paginated (oidcBearer)
//   POST /v1/cases                                   — audited
//   GET  /v1/cases/:caseId                           — (oidcBearer)
//   PATCH /v1/cases/:caseId                          — audited
//   GET  /v1/cases/:caseId/participants              — (oidcBearer)
//   POST /v1/cases/:caseId/participants              — audited
//   POST /v1/cases/:caseId/tier-escalations          — audited + step-up
//
// Tier escalation is intentionally request-then-approve, never a single call that
// immediately raises the tier (009_API_SURFACE section 9, AI constraint §4).
// This endpoint creates approval rows and emits bheka.approval.requested.v1;
// bheka-case updates case.current_tier only after all approvals are granted.
//
// Self-approval: forbidden by DB CHECK (approvals_no_self_approval_ck) and API layer.
// Tier 3 dual-auth: requires exactly 2 approvers, one holding popia_information_officer.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, sql, inArray } from "drizzle-orm";
import {
  db,
  casesTable,
  caseParticipantsTable,
  approvalsTable,
  roleAssignmentsTable,
  rolesTable,
  usersTable,
} from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";
import { requireStepUp } from "../../middleware/require-stepup.js";
import { uuidv7 } from "uuidv7";
import { publishEvent } from "@workspace/nats-client";

const router: IRouter = Router();

// ── GET /v1/cases ────────────────────────────────────────────────────────────

router.get(
  "/v1/cases",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;
    const filterStatus = req.query.status as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(casesTable)
        .where(
          and(
            eq(casesTable.tenantId, tenantId),
            cursor ? gt(casesTable.id, cursor) : undefined,
            filterStatus
              ? sql`${casesTable.status} = ${filterStatus}::case_status`
              : undefined,
            sql`${casesTable.deletedAt} IS NULL`,
          ),
        )
        .orderBy(casesTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        subjectUserId: c.subjectUserId,
        title: c.title,
        description: c.description,
        status: c.status,
        currentTier: c.currentTier,
        openedByUserId: c.openedByUserId,
        closedAt: c.closedAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── POST /v1/cases ───────────────────────────────────────────────────────────

const CreateCaseBody = z.object({
  subjectUserId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(4000).optional(),
});

router.post(
  "/v1/cases",
  requireSession,
  requireRole("security_administrator", "investigator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const actorId = req.session!.userId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreateCaseBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(
        parsed.error.message,
        parsed.error.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message })),
      ));
      return;
    }

    const [kase] = await withTenantContext(tenantId, (tx) =>
      tx
        .insert(casesTable)
        .values({ tenantId, openedByUserId: actorId, ...parsed.data })
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "case.opened",
      targetType: "case",
      targetId: kase!.id,
      requestId: String(idempotencyKey),
      metadata: { subjectUserId: parsed.data.subjectUserId, title: parsed.data.title },
    });

    await publishEvent({
      event_id: uuidv7(),
      schema_version: "bheka.case.opened.v1",
      occurred_at: new Date().toISOString(),
      producer: "bheka-case",
      data: {
        case_id: kase!.id,
        tenant_id: kase!.tenantId,
        subject_user_id: kase!.subjectUserId,
        opened_by_user_id: kase!.openedByUserId,
        initial_tier: 1,
        title: kase!.title ?? undefined,
      },
    });

    res.status(201).json({
      id: kase!.id,
      tenantId: kase!.tenantId,
      subjectUserId: kase!.subjectUserId,
      title: kase!.title,
      description: kase!.description,
      status: kase!.status,
      currentTier: kase!.currentTier,
      openedByUserId: kase!.openedByUserId,
      createdAt: kase!.createdAt,
      updatedAt: kase!.updatedAt,
    });
  },
);

// ── GET /v1/cases/:caseId ────────────────────────────────────────────────────

router.get(
  "/v1/cases/:caseId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const caseId = req.params.caseId as string;

    const [kase] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
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

    res.json({
      id: kase.id,
      tenantId: kase.tenantId,
      subjectUserId: kase.subjectUserId,
      title: kase.title,
      description: kase.description,
      status: kase.status,
      currentTier: kase.currentTier,
      openedByUserId: kase.openedByUserId,
      closedAt: kase.closedAt,
      closedByUserId: kase.closedByUserId,
      createdAt: kase.createdAt,
      updatedAt: kase.updatedAt,
    });
  },
);

// ── PATCH /v1/cases/:caseId ──────────────────────────────────────────────────

const PatchCaseBody = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(["open", "closed", "archived"]).optional(),
});

router.patch(
  "/v1/cases/:caseId",
  requireSession,
  requireRole("security_administrator", "investigator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const caseId = req.params.caseId as string;
    const actorId = req.session!.userId;

    const parsed = PatchCaseBody.safeParse(req.body);
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
    const extraFields = parsed.data.status === "closed"
      ? { closedAt: now, closedByUserId: actorId }
      : {};

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "case.updated",
      targetType: "case",
      targetId: caseId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { fields: Object.keys(parsed.data) },
    });

    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(casesTable)
        .set({ ...parsed.data, ...extraFields, updatedAt: now })
        .where(
          and(
            eq(casesTable.id, caseId),
            eq(casesTable.tenantId, tenantId),
            sql`${casesTable.deletedAt} IS NULL`,
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
      subjectUserId: updated.subjectUserId,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      currentTier: updated.currentTier,
      openedByUserId: updated.openedByUserId,
      closedAt: updated.closedAt,
      updatedAt: updated.updatedAt,
    });
  },
);

// ── GET /v1/cases/:caseId/participants ───────────────────────────────────────

router.get(
  "/v1/cases/:caseId/participants",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const caseId = req.params.caseId as string;

    const participants = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(caseParticipantsTable)
        .where(
          and(
            eq(caseParticipantsTable.caseId, caseId),
            eq(caseParticipantsTable.tenantId, tenantId),
          ),
        )
        .orderBy(caseParticipantsTable.id),
    );

    res.json({
      items: participants.map((p) => ({
        id: p.id,
        caseId: p.caseId,
        userId: p.userId,
        role: p.role,
        addedByUserId: p.addedByUserId,
        createdAt: p.createdAt,
      })),
    });
  },
);

// ── POST /v1/cases/:caseId/participants ──────────────────────────────────────

const AddParticipantBody = z.object({
  userId: z.string().uuid(),
  role: z.enum(["investigator", "subject", "witness"]),
});

router.post(
  "/v1/cases/:caseId/participants",
  requireSession,
  requireRole("security_administrator", "investigator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const caseId = req.params.caseId as string;
    const actorId = req.session!.userId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = AddParticipantBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(
        parsed.error.message,
        parsed.error.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message })),
      ));
      return;
    }

    const [participant] = await withTenantContext(tenantId, (tx) =>
      tx
        .insert(caseParticipantsTable)
        .values({ tenantId, caseId, addedByUserId: actorId, ...parsed.data })
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "case.participant_added",
      targetType: "case",
      targetId: caseId,
      requestId: String(idempotencyKey),
      metadata: { participantId: participant!.id, userId: parsed.data.userId, role: parsed.data.role },
    });

    res.status(201).json({
      id: participant!.id,
      caseId: participant!.caseId,
      userId: participant!.userId,
      role: participant!.role,
      addedByUserId: participant!.addedByUserId,
      createdAt: participant!.createdAt,
    });
  },
);

// ── POST /v1/cases/:caseId/tier-escalations ──────────────────────────────────
// Entry point for the Tier 3 dual-authorisation workflow (CANON section 4).
// Step-up required: tier escalation is an irreversible privilege-granting act (§13).
// Creates pending approval rows; does NOT immediately raise the tier.
// bheka-case updates case.current_tier once all approvals are granted.
// Tier 3: 2 approvers required — exactly 1 must hold popia_information_officer.
// Tier 2: 1 approver required.

const ApproverEntry = z.object({
  userId: z.string().uuid(),
  isInformationOfficer: z.boolean(),
});

const TierEscalationBody = z.object({
  targetTier: z.number().int().min(2).max(3),
  approvers: z.array(ApproverEntry).min(1).max(2),
  escalationReason: z.string().min(1).max(2000),
  expiresInHours: z.number().int().min(1).max(168).default(48),
});

router.post(
  "/v1/cases/:caseId/tier-escalations",
  requireSession,
  requireRole("security_administrator", "investigator"),
  requireStepUp,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const caseId = req.params.caseId as string;
    const actorId = req.session!.userId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = TierEscalationBody.safeParse(req.body);
    if (!parsed.success) {
      sendProblem(res, Problems.validationFailed(
        parsed.error.message,
        parsed.error.issues.map((i) => ({ field: i.path.join("."), code: i.code, message: i.message })),
      ));
      return;
    }

    const { targetTier, approvers, escalationReason, expiresInHours } = parsed.data;

    // Tier 3 requires exactly 2 approvers, exactly 1 of which is the IO.
    if (targetTier === 3) {
      const ioCount = approvers.filter((a) => a.isInformationOfficer).length;
      if (approvers.length !== 2 || ioCount !== 1) {
        sendProblem(res, Problems.tierEscalationDenied());
        return;
      }
    }

    const [kase] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({ id: casesTable.id, currentTier: casesTable.currentTier })
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

    if (targetTier <= kase.currentTier) {
      sendProblem(res, Problems.validationFailed(
        `targetTier (${targetTier}) must be greater than the case's current tier (${kase.currentTier})`,
      ));
      return;
    }

    // No approver can be the requester (DB CHECK + API defence-in-depth).
    if (approvers.some((a) => a.userId === actorId)) {
      sendProblem(res, Problems.forbidden("The requester cannot be one of the approvers"));
      return;
    }

    // For IO-designated approval slots, verify the specified user holds that role.
    const ioApprovers = approvers.filter((a) => a.isInformationOfficer);
    if (ioApprovers.length > 0) {
      const ioRole = await db
        .select({ id: rolesTable.id })
        .from(rolesTable)
        .where(eq(rolesTable.name, "popia_information_officer"))
        .limit(1);

      if (ioRole.length > 0) {
        const ioRoleId = ioRole[0]!.id;
        const ioUserIds = ioApprovers.map((a) => a.userId);
        const assignments = await db
          .select({ userId: roleAssignmentsTable.userId })
          .from(roleAssignmentsTable)
          .where(
            and(
              eq(roleAssignmentsTable.tenantId, tenantId),
              inArray(roleAssignmentsTable.userId, ioUserIds),
              eq(roleAssignmentsTable.roleId, ioRoleId),
            ),
          );

        if (assignments.length !== ioUserIds.length) {
          sendProblem(res, Problems.forbidden(
            "The designated Information Officer approver does not hold the popia_information_officer role",
          ));
          return;
        }
      }
    }

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const createdApprovals = await withTenantContext(tenantId, (tx) =>
      Promise.all(
        approvers.map((a) =>
          tx
            .insert(approvalsTable)
            .values({
              tenantId,
              caseId,
              subjectType: "tier_escalation",
              approverUserId: a.userId,
              requestedByUserId: actorId,
              isInformationOfficerApproval: a.isInformationOfficer,
              expiresAt,
            })
            .returning()
            .then(([row]) => row!),
        ),
      ),
    );

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "case.tier_escalation_requested",
      targetType: "case",
      targetId: caseId,
      requestId: String(idempotencyKey),
      metadata: {
        targetTier,
        escalationReason,
        approvalIds: createdApprovals.map((a) => a.id),
      },
    });

    await Promise.all(
      createdApprovals.map((a) =>
        publishEvent({
          event_id: uuidv7(),
          schema_version: "bheka.approval.requested.v1",
          occurred_at: new Date().toISOString(),
          producer: "bheka-case",
          data: {
            approval_id: a.id,
            case_id: a.caseId,
            tenant_id: tenantId,
            subject_type: "tier_escalation",
            approver_user_id: a.approverUserId,
            requested_by_user_id: actorId,
            is_information_officer_approval: a.isInformationOfficerApproval,
            expires_at: a.expiresAt!.toISOString(),
          },
        }),
      ),
    );

    res.status(201).json({
      caseId,
      targetTier,
      escalationReason,
      expiresAt,
      approvals: createdApprovals.map((a) => ({
        id: a.id,
        approverUserId: a.approverUserId,
        isInformationOfficerApproval: a.isInformationOfficerApproval,
        status: a.status,
        expiresAt: a.expiresAt,
      })),
    });
  },
);

export default router;
