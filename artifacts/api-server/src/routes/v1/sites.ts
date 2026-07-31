// Sites routes — 009_API_SURFACE section 4.
// GET /v1/sites, POST /v1/sites, GET /v1/sites/:siteId, PATCH /v1/sites/:siteId
// Audited writes (POST, PATCH). No WebAuthn step-up required (site metadata is
// operational configuration, not sensitive personal data or an irreversible action).
// Cursor-based pagination on GET /v1/sites per CANON section 9.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, sitesTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { requireRole } from "../../middleware/require-role.js";

const router: IRouter = Router();

// ── GET /v1/sites ───────────────────────────────────────────────────────────

router.get(
  "/v1/sites",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(sitesTable)
        .where(
          and(
            eq(sitesTable.tenantId, tenantId),
            cursor ? gt(sitesTable.id, cursor) : undefined,
            sql`${sitesTable.deletedAt} IS NULL`,
          ),
        )
        .orderBy(sitesTable.id)
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        name: s.name,
        description: s.description,
        timezone: s.timezone,
        lowBandwidthThresholdKbps: s.lowBandwidthThresholdKbps,
        active: s.active,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── POST /v1/sites ──────────────────────────────────────────────────────────

const CreateSiteBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  timezone: z.string().min(1).max(100).default("Africa/Johannesburg"),
  lowBandwidthThresholdKbps: z.number().int().min(1).max(1_000_000).default(512),
});

router.post(
  "/v1/sites",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      sendProblem(res, Problems.idempotencyKeyRequired());
      return;
    }

    const parsed = CreateSiteBody.safeParse(req.body);
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

    const [site] = await withTenantContext(tenantId, (tx) =>
      tx
        .insert(sitesTable)
        .values({ tenantId, ...parsed.data })
        .returning(),
    );

    await writeAuditLog({
      tenantId,
      actorId: req.session!.userId,
      actorType: "user",
      action: "site.created",
      targetType: "site",
      targetId: site!.id,
      requestId: String(idempotencyKey),
      metadata: { name: parsed.data.name },
    });

    res.status(201).json({
      id: site!.id,
      tenantId: site!.tenantId,
      name: site!.name,
      description: site!.description,
      timezone: site!.timezone,
      lowBandwidthThresholdKbps: site!.lowBandwidthThresholdKbps,
      active: site!.active,
      createdAt: site!.createdAt,
      updatedAt: site!.updatedAt,
    });
  },
);

// ── GET /v1/sites/:siteId ───────────────────────────────────────────────────

router.get(
  "/v1/sites/:siteId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const siteId = req.params.siteId as string;

    const [site] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(sitesTable)
        .where(
          and(
            eq(sitesTable.id, siteId),
            eq(sitesTable.tenantId, tenantId),
            sql`${sitesTable.deletedAt} IS NULL`,
          ),
        )
        .limit(1),
    );

    if (!site) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: site.id,
      tenantId: site.tenantId,
      name: site.name,
      description: site.description,
      timezone: site.timezone,
      lowBandwidthThresholdKbps: site.lowBandwidthThresholdKbps,
      active: site.active,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    });
  },
);

// ── PATCH /v1/sites/:siteId ─────────────────────────────────────────────────

const PatchSiteBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
  lowBandwidthThresholdKbps: z.number().int().min(1).max(1_000_000).optional(),
  active: z.boolean().optional(),
});

router.patch(
  "/v1/sites/:siteId",
  requireSession,
  requireRole("tenant_owner", "security_administrator"),
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const siteId = req.params.siteId as string;

    const parsed = PatchSiteBody.safeParse(req.body);
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
      action: "site.updated",
      targetType: "site",
      targetId: siteId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { fields: Object.keys(parsed.data) },
    });

    const [updated] = await withTenantContext(tenantId, (tx) =>
      tx
        .update(sitesTable)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(sitesTable.id, siteId),
            eq(sitesTable.tenantId, tenantId),
            sql`${sitesTable.deletedAt} IS NULL`,
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
      timezone: updated.timezone,
      lowBandwidthThresholdKbps: updated.lowBandwidthThresholdKbps,
      active: updated.active,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  },
);

export default router;
