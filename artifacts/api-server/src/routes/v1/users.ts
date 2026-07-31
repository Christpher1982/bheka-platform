// Users, roles, and role-assignments routes — 009_API_SURFACE section 5.
// GET /v1/users, POST /v1/users, GET /v1/users/:userId
// POST /v1/users/:userId/reidentify — audited + step-up (009_API_SURFACE section 13)
// GET /v1/roles — read-only system role list
// GET /v1/users/:userId/role-assignments
// POST /v1/users/:userId/role-assignments — audited
//
// Information Officer singleton constraint is enforced at DB layer
// (trigger in rls-policies.sql). Routes surface the resulting error via Problem schema.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  roleAssignmentsTable,
} from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";
import { requireStepUp } from "../../middleware/require-stepup.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

// ── GET /v1/roles ───────────────────────────────────────────────────────────
// System-defined roles are not tenant-scoped; no RLS context needed.

router.get(
  "/v1/roles",
  requireSession,
  async (_req, res): Promise<void> => {
    const roles = await db
      .select({
        id: rolesTable.id,
        name: rolesTable.name,
        displayName: rolesTable.displayName,
        description: rolesTable.description,
      })
      .from(rolesTable)
      .orderBy(rolesTable.name);

    res.json({ items: roles });
  },
);

// ── GET /v1/users ───────────────────────────────────────────────────────────

router.get(
  "/v1/users",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select({
          id: usersTable.id,
          tenantId: usersTable.tenantId,
          email: usersTable.email,
          givenName: usersTable.givenName,
          familyName: usersTable.familyName,
          externalId: usersTable.externalId,
          provisionedVia: usersTable.provisionedVia,
          webauthnEnrolled: usersTable.webauthnEnrolled,
          active: usersTable.active,
          createdAt: usersTable.createdAt,
          updatedAt: usersTable.updatedAt,
        })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.tenantId, tenantId),
            cursor ? gt(usersTable.id, cursor) : undefined,
            sql`${usersTable.deletedAt} IS NULL`,
          ),
        )
        .orderBy(usersTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({ items, pageInfo: { nextCursor, hasMore } });
  },
);

// ── POST /v1/users ──────────────────────────────────────────────────────────

const CreateUserBody = z.object({
  email: z.string().email().max(320),
  givenName: z.string().min(1).max(200).optional(),
  familyName: z.string().min(1).max(200).optional(),
  externalId: z.string().max(500).optional(),
  provisionedVia: z.enum(["manual", "scim", "oidc"]).default("manual"),
});

router.post(
  "/v1/users",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreateUserBody.safeParse(req.body);
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

    let user: typeof usersTable.$inferSelect;
    try {
      const [inserted] = await withTenantContext(tenantId, (tx) =>
        tx
          .insert(usersTable)
          .values({ tenantId, ...parsed.data })
          .returning(),
      );
      user = inserted!;
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("users_tenant_email_unique")) {
        sendProblem(
          res,
          Problems.validationFailed(`A user with email "${parsed.data.email}" already exists in this tenant`),
        );
        return;
      }
      logger.error({ err, tenantId }, "Unexpected error creating user");
      sendProblem(res, Problems.internalError());
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      requestId: String(idempotencyKey),
      metadata: { email: user.email, provisionedVia: user.provisionedVia },
    });

    res.status(201).json({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
      externalId: user.externalId,
      provisionedVia: user.provisionedVia,
      webauthnEnrolled: user.webauthnEnrolled,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  },
);

// ── GET /v1/users/:userId ───────────────────────────────────────────────────

router.get(
  "/v1/users/:userId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const userId = req.params.userId as string;

    const [user] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({
          id: usersTable.id,
          tenantId: usersTable.tenantId,
          email: usersTable.email,
          givenName: usersTable.givenName,
          familyName: usersTable.familyName,
          externalId: usersTable.externalId,
          provisionedVia: usersTable.provisionedVia,
          managerId: usersTable.managerId,
          webauthnEnrolled: usersTable.webauthnEnrolled,
          active: usersTable.active,
          createdAt: usersTable.createdAt,
          updatedAt: usersTable.updatedAt,
        })
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

    res.json(user);
  },
);

// ── POST /v1/users/:userId/reidentify ───────────────────────────────────────
// Break-glass reidentification — reverses pseudonymity for a data subject.
// Audited + WebAuthn step-up required per 009_API_SURFACE section 13.
// Requires Information Officer role per 007_RBAC_AND_IDENTITY section 1.

router.post(
  "/v1/users/:userId/reidentify",
  requireSession,
  requireRole("popia_information_officer"),
  requireStepUp,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const userId = req.params.userId as string;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const [user] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
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

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "user.reidentified",
      targetType: "user",
      targetId: userId,
      requestId: String(idempotencyKey),
      metadata: { email: user.email },
    });

    // Return full identity fields including any that are pseudonymised in normal responses.
    res.json({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      givenName: user.givenName,
      familyName: user.familyName,
      externalId: user.externalId,
      managerId: user.managerId,
      provisionedVia: user.provisionedVia,
      active: user.active,
      createdAt: user.createdAt,
    });
  },
);

// ── GET /v1/users/:userId/role-assignments ──────────────────────────────────

router.get(
  "/v1/users/:userId/role-assignments",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const userId = req.params.userId as string;

    const assignments = await withTenantContext(tenantId, (tx) =>
      tx
        .select({
          id: roleAssignmentsTable.id,
          tenantId: roleAssignmentsTable.tenantId,
          userId: roleAssignmentsTable.userId,
          roleId: roleAssignmentsTable.roleId,
          roleName: rolesTable.name,
          roleDisplayName: rolesTable.displayName,
          assignedBy: roleAssignmentsTable.assignedBy,
          active: roleAssignmentsTable.active,
          createdAt: roleAssignmentsTable.createdAt,
        })
        .from(roleAssignmentsTable)
        .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
        .where(
          and(
            eq(roleAssignmentsTable.userId, userId),
            eq(roleAssignmentsTable.tenantId, tenantId),
            eq(roleAssignmentsTable.active, true),
            sql`${roleAssignmentsTable.deletedAt} IS NULL`,
          ),
        ),
    );

    res.json({ items: assignments });
  },
);

// ── POST /v1/users/:userId/role-assignments ─────────────────────────────────
// Assigns a role to a user within the tenant. Audited per 009_API_SURFACE section 5.
// Information Officer singleton constraint is enforced by a DB trigger.
// If the constraint fires, the resulting error is mapped to a 409 Problem.

const CreateRoleAssignmentBody = z.object({
  roleId: z.string().uuid(),
});

router.post(
  "/v1/users/:userId/role-assignments",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const userId = req.params.userId as string;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreateRoleAssignmentBody.safeParse(req.body);
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

    // Verify the target user exists within this tenant.
    const [targetUser] = await withTenantContext(tenantId, (tx) =>
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

    if (!targetUser) {
      sendProblem(res, Problems.notFound());
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "role_assignment.created",
      targetType: "user",
      targetId: userId,
      requestId: String(idempotencyKey),
      metadata: { roleId: parsed.data.roleId },
    });

    let assignment: typeof roleAssignmentsTable.$inferSelect;
    try {
      const [inserted] = await withTenantContext(tenantId, (tx) =>
        tx
          .insert(roleAssignmentsTable)
          .values({
            tenantId,
            userId,
            roleId: parsed.data.roleId,
            assignedBy: req.session!.userId,
          })
          .onConflictDoUpdate({
            target: [
              roleAssignmentsTable.tenantId,
              roleAssignmentsTable.userId,
              roleAssignmentsTable.roleId,
            ],
            set: { active: true, updatedAt: new Date() },
          })
          .returning(),
      );
      assignment = inserted!;
    } catch (err: unknown) {
      const msg = String(err);
      // Information Officer singleton constraint fires from rls-policies.sql trigger.
      if (msg.includes("information_officer_singleton")) {
        sendProblem(res, {
          type: "https://docs.bheka.io/errors/information-officer-singleton",
          title: "Information Officer role already assigned",
          status: 409,
          detail:
            "Only one active Information Officer assignment is permitted per tenant. " +
            "Revoke the existing assignment before creating a new one (POPIA requirement).",
        });
        return;
      }
      logger.error({ err, tenantId, userId }, "Unexpected error creating role assignment");
      sendProblem(res, Problems.internalError());
      return;
    }

    res.status(201).json({
      id: assignment.id,
      tenantId: assignment.tenantId,
      userId: assignment.userId,
      roleId: assignment.roleId,
      assignedBy: assignment.assignedBy,
      active: assignment.active,
      createdAt: assignment.createdAt,
    });
  },
);

export default router;
