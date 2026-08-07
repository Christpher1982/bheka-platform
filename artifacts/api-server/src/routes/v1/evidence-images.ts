// Evidence images routes — real storage/read path for screenshot_capture
// images, replacing the previous 503 stub / inline-base64 stopgap.
//
// Routes:
//   GET /v1/evidence-images                  — cursor-paginated list, filterable
//                                               by siteId / subjectUserId / sourceAgentId
//   GET /v1/evidence-images/:id               — single metadata row (no image bytes)
//   GET /v1/evidence-images/:id/image         — decrypted image bytes, audited
//
// This is deliberately a lighter-weight sibling of v1/evidence.ts (which
// models the full case-bound, tiered, Vault-DEK evidence design from
// evidence.ts / lib/vault-client). evidence_images exists one layer below
// that: it is the direct output of the ingest pipeline
// (routes/v1/agent-events.ts) for every screenshot_capture event, whether or
// not that event is ever attached to a case. The console's new Evidence page
// browses this table directly. Metadata reads (list + single) do not
// require step-up, matching v1/evidence.ts's reasoning: metadata alone does
// not reveal image content. Reading the actual decrypted bytes is audited
// (every /image fetch writes an audit_log row) but does not require WebAuthn
// step-up here — unlike v1/evidence.ts's Tier 3 content, screenshot_capture
// images are Tier 1/2 telemetry already visible in the Activity feed's
// existing (unauthenticated-beyond-session) detail view. If Tier 3 gating is
// ever needed for a specific tenant/site, add a requireStepUp here the same
// way v1/evidence.ts does — no schema change required.

import { Router, type IRouter } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, evidenceImagesTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";
import { readEvidenceImage } from "../../lib/evidence-storage.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

// ── GET /v1/evidence-images ──────────────────────────────────────────────────
// Newest first (UUIDv7 ids sort chronologically). Optional filters: siteId,
// subjectUserId, sourceAgentId — the three axes the Evidence page's filter
// bar exposes. contentHashSha256/storageKey/iv/authTag are intentionally
// omitted from both list and single responses: they are storage-layer
// implementation detail, not something the console ever needs client-side.

router.get(
  "/v1/evidence-images",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;
    const filterSiteId = req.query.siteId as string | undefined;
    const filterSubjectUserId = req.query.subjectUserId as string | undefined;
    const filterSourceAgentId = req.query.sourceAgentId as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(evidenceImagesTable)
        .where(
          and(
            eq(evidenceImagesTable.tenantId, tenantId),
            cursor ? lt(evidenceImagesTable.id, cursor) : undefined,
            filterSiteId ? eq(evidenceImagesTable.siteId, filterSiteId) : undefined,
            filterSubjectUserId
              ? eq(evidenceImagesTable.subjectUserId, filterSubjectUserId)
              : undefined,
            filterSourceAgentId
              ? eq(evidenceImagesTable.sourceAgentId, filterSourceAgentId)
              : undefined,
          ),
        )
        .orderBy(desc(evidenceImagesTable.id))
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    res.json({
      items: items.map((img) => ({
        id: img.id,
        tenantId: img.tenantId,
        siteId: img.siteId,
        subjectUserId: img.subjectUserId,
        sourceAgentId: img.sourceAgentId,
        sourceEventId: img.sourceEventId,
        sessionId: img.sessionId,
        contentType: img.contentType,
        width: img.width,
        height: img.height,
        ocrText: img.ocrText,
        byteSize: img.byteSize,
        occurredAt: img.occurredAt,
        createdAt: img.createdAt,
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── GET /v1/evidence-images/:id ──────────────────────────────────────────────

router.get(
  "/v1/evidence-images/:id",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const id = req.params.id as string;

    const [img] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(evidenceImagesTable)
        .where(and(eq(evidenceImagesTable.id, id), eq(evidenceImagesTable.tenantId, tenantId)))
        .limit(1),
    );

    if (!img) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.json({
      id: img.id,
      tenantId: img.tenantId,
      siteId: img.siteId,
      subjectUserId: img.subjectUserId,
      sourceAgentId: img.sourceAgentId,
      sourceEventId: img.sourceEventId,
      sessionId: img.sessionId,
      contentType: img.contentType,
      width: img.width,
      height: img.height,
      ocrText: img.ocrText,
      byteSize: img.byteSize,
      occurredAt: img.occurredAt,
      createdAt: img.createdAt,
    });
  },
);

// ── GET /v1/evidence-images/:id/image ────────────────────────────────────────
// Decrypts and streams the raw image bytes. Audited before responding, same
// pattern as GET /v1/activity-events/:eventId and GET /v1/evidence/:id/view.

router.get(
  "/v1/evidence-images/:id/image",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const id = req.params.id as string;
    const actorId = req.session!.userId;

    const [img] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(evidenceImagesTable)
        .where(and(eq(evidenceImagesTable.id, id), eq(evidenceImagesTable.tenantId, tenantId)))
        .limit(1),
    );

    if (!img) {
      sendProblem(res, Problems.notFound());
      return;
    }

    let plaintext: Buffer;
    try {
      plaintext = await readEvidenceImage({
        tenantId,
        storageKey: img.storageKey,
        ivBase64: img.ivBase64,
        authTagBase64: img.authTagBase64,
        keyVersion: img.keyVersion,
      });
    } catch (err) {
      logger.error({ err, evidenceImageId: id }, "Failed to read/decrypt evidence image");
      sendProblem(res, Problems.internalError());
      return;
    }

    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "evidence_image.viewed",
      targetType: "evidence_image",
      targetId: id,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: { siteId: img.siteId, subjectUserId: img.subjectUserId },
    });

    res.contentType(img.contentType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(plaintext);
  },
);

export default router;
