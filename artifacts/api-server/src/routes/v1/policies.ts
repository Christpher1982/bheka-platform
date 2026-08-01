// Policies routes — 009_API_SURFACE section 7.
//
// Routes:
//   GET  /v1/policies                        — cursor-paginated list (oidcBearer)
//   POST /v1/policies                        — create policy (audited)
//   GET  /v1/policies/:policyId              — single policy (oidcBearer)
//   PATCH /v1/policies/:policyId             — update policy (audited)
//   POST /v1/policies/:policyId/rules        — add rule to policy (audited)
//
// All writes are audited. No WebAuthn step-up on policy editing itself — step-up
// attaches to the consequence of a Tier 3-targeted rule (a case tier escalation
// and its approval), not to authoring the rule (009_API_SURFACE section 7).
//
// DB-level CHECK on policy_rules enforces requires_dual_authorisation = true for
// any Tier 3 rule; the gateway does not duplicate that check (section 7, 008_DATA_MODEL §4).
// A CHECK violation surfaces as a 400 Problem.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, policiesTable, policyRulesTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";

const router: IRouter = Router();

// ── GET /v1/policies ────────────────────────────────────────────────────────

router.get(
  "/v1/policies",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(policiesTable)
        .where(
          and(
            eq(policiesTable.tenantId, tenantId),
            cursor ? gt(policiesTable.id, cursor) : undefined,
            sql`${policiesTable.deletedAt} IS NULL`,
          ),
        )
        .orderBy(policiesTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((p) => ({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        description: p.description,
        active: p.active,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── POST /v1/policies ───────────────────────────────────────────────────────

const CreatePolicyBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  active: z.boolean().default(true),
});

router.post(
  "/v1/policies",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreatePolicyBody.safeParse(req.body);
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

    const [policy] = await withTenantContext(tenantId, (tx) =>
      tx
        .insert(policiesTable)
        .values({ tenantId, ...parsed.data })
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "policy.created",
      targetType: "policy",
      targetId: policy!.id,
      requestId: String(idempotencyKey),
      metadata: { name: parsed.data.name },
    });

    res.status(201).json({
      id: policy!.id,
      tenantId: policy!.tenantId,
      name: policy!.name,
      description: policy!.description,
      active: policy!.active,
      createdAt: policy!.createdAt,
      updatedAt: policy!.updatedAt,
    });
  },
);

// ── GET /v1/policies/:policyId ──────────────────────────────────────────────

router.get(
  "/v1/policies/:policyId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const policyId = req.params.policyId as string;

    const [policy] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(policiesTable)
        .where(
          and(
            eq(policiesTable.id, policyId),
            eq(policiesTable.tenantId, tenantId),
            sql`${policiesTable.deletedAt} IS NULL`,
          ),
        )
        .limit(1),
    );

    if (!policy) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: policy.id,
      tenantId: policy.tenantId,
      name: policy.name,
      description: policy.description,
      active: policy.active,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    });
  },
);

// ── PATCH /v1/policies/:policyId ────────────────────────────────────────────

const PatchPolicyBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

router.patch(
  "/v1/policies/:policyId",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const policyId = req.params.policyId as string;

    const parsed = PatchPolicyBody.safeParse(req.body);
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

    if (Object.keys(parsed.data).length === 0) {
      sendProblem(res, Problems.validationFailed("Request body must contain at least one field to update"));
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "policy.updated",
      targetType: "policy",
      targetId: policyId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { fields: Object.keys(parsed.data) },
    });

    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(policiesTable)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(policiesTable.id, policyId),
            eq(policiesTable.tenantId, tenantId),
            sql`${policiesTable.deletedAt} IS NULL`,
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
      name: updated.name,
      description: updated.description,
      active: updated.active,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  },
);

// ── POST /v1/policies/:policyId/rules ───────────────────────────────────────
// Adds a rule to an existing policy.
// conditionJson is opaque to the gateway — bheka-policy evaluates it against
// its rule DSL (schemas/policies/rule-dsl.schema.json). The gateway stores it
// as-is and surfaces DB-level CHECK violations (e.g. Tier 3 without
// requires_dual_authorisation = true) as 400 Problems.

const CreateRuleBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  // 1 = Baseline, 2 = Elevated, 3 = Investigation (CANON section 4).
  targetTier: z.number().int().min(1).max(3),
  // Must be true when targetTier = 3. DB CHECK enforces this structurally.
  requiresDualAuthorisation: z.boolean().default(false),
  // Opaque rule DSL evaluated by bheka-policy. Must be a non-empty object.
  conditionJson: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, {
    message: "conditionJson must be a non-empty object",
  }),
  active: z.boolean().default(true),
});

router.post(
  "/v1/policies/:policyId/rules",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const policyId = req.params.policyId as string;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreateRuleBody.safeParse(req.body);
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

    // Enforce Tier 3 dual-authorisation requirement at the API layer as well as DB.
    // The DB CHECK is the structural guarantee; this gives a clearer error message.
    if (parsed.data.targetTier === 3 && !parsed.data.requiresDualAuthorisation) {
      sendProblem(res, Problems.tierEscalationDenied());
      return;
    }

    // Verify the policy exists in this tenant before inserting the rule.
    const [policy] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({ id: policiesTable.id })
        .from(policiesTable)
        .where(
          and(
            eq(policiesTable.id, policyId),
            eq(policiesTable.tenantId, tenantId),
            sql`${policiesTable.deletedAt} IS NULL`,
          ),
        )
        .limit(1),
    );

    if (!policy) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const [rule] = await withTenantContext(tenantId, (tx) =>
      tx
        .insert(policyRulesTable)
        .values({ tenantId, policyId, ...parsed.data })
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "policy_rule.created",
      targetType: "policy_rule",
      targetId: rule!.id,
      requestId: String(idempotencyKey),
      metadata: { policyId, name: parsed.data.name, targetTier: parsed.data.targetTier },
    });

    res.status(201).json({
      id: rule!.id,
      tenantId: rule!.tenantId,
      policyId: rule!.policyId,
      name: rule!.name,
      description: rule!.description,
      targetTier: rule!.targetTier,
      requiresDualAuthorisation: rule!.requiresDualAuthorisation,
      conditionJson: rule!.conditionJson,
      active: rule!.active,
      createdAt: rule!.createdAt,
      updatedAt: rule!.updatedAt,
    });
  },
);

export default router;
