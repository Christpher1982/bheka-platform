// Raw activity feed — 009_API_SURFACE style cursor-paginated list + detail,
// mirroring the conventions in v1/detections.ts.
//
// Routes:
//   GET /v1/activity-events            — cursor-paginated list (requireSession)
//   GET /v1/activity-events/:eventId   — full raw event, audited (requireSession)
//
// activity_events stores every captured keystroke batch the agent reports,
// regardless of whether a rule fired on it (see v1/agent-events.ts). Until now
// the console only surfaced events that produced a detection. This file lets
// an investigator browse the full raw feed instead.
//
// The list response intentionally omits metadata.capturedText — same reason
// detections.ts keeps `summary` short in its list endpoint: avoid bulk-exposing
// raw Tier 3 content in a page-sized response. The detail endpoint returns the
// full metadata blob (including capturedText) and is audited before responding,
// exactly like GET /v1/detections/:detectionId/evidence.

import { Router, type IRouter } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, activityEventsTable, detectionsTable } from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { writeAuditLog } from "../../lib/audit-writer.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireSession } from "../../middleware/require-session.js";

const router: IRouter = Router();

// ── GET /v1/activity-events ─────────────────────────────────────────────────
// Newest first. IDs are UUIDv7, so descending id order is descending time
// order and the cursor stays a single opaque id — same pattern as
// GET /v1/detections.
// Optional filters: subjectUserId, siteId.

router.get(
  "/v1/activity-events",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const cursor = req.query.cursor as string | undefined;
    const filterSubjectUserId = req.query.subjectUserId as string | undefined;
    const filterSiteId = req.query.siteId as string | undefined;

    const rows = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(activityEventsTable)
        .where(
          and(
            eq(activityEventsTable.tenantId, tenantId),
            cursor ? lt(activityEventsTable.id, cursor) : undefined,
            filterSubjectUserId
              ? eq(activityEventsTable.subjectUserId, filterSubjectUserId)
              : undefined,
            filterSiteId
              ? eq(activityEventsTable.siteId, filterSiteId)
              : undefined,
          ),
        )
        .orderBy(desc(activityEventsTable.id))
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    // Optional hasDetection flag: cheap to compute with a single IN-style
    // lookup against detectionsTable.sourceEventId for the ids on this page,
    // scoped to the same tenant.
    const eventIds = items.map((e) => e.id);
    const linkedDetections =
      eventIds.length > 0
        ? await withTenantContext(tenantId, (tx) =>
            tx
              .select({
                sourceEventId: detectionsTable.sourceEventId,
              })
              .from(detectionsTable)
              .where(eq(detectionsTable.tenantId, tenantId)),
          )
        : [];
    const linkedEventIds = new Set(
      linkedDetections
        .map((d) => d.sourceEventId)
        .filter((id): id is string => id !== null),
    );

    res.json({
      items: items.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        siteId: e.siteId,
        subjectUserId: e.subjectUserId,
        sourceAgentId: e.sourceAgentId,
        keystrokeCount: e.metadata?.keystrokeCount ?? null,
        activeWindowTitle: e.metadata?.activeWindowTitle ?? null,
        hasDetection: linkedEventIds.has(e.id),
      })),
      pageInfo: { nextCursor, hasMore },
    });
  },
);

// ── GET /v1/activity-events/:eventId ────────────────────────────────────────
// Full detail, including metadata.capturedText. Read access is audited before
// responding — the underlying metadata can carry Tier 3 content, same as the
// detections evidence route.

router.get(
  "/v1/activity-events/:eventId",
  requireSession,
  async (req, res): Promise<void> => {
    const tenantId = req.session!.tenantId;
    const eventId = req.params.eventId as string;
    const actorId = req.session!.userId;

    const [event] = await withTenantContext(tenantId, (tx) =>
      tx
        .select()
        .from(activityEventsTable)
        .where(
          and(
            eq(activityEventsTable.id, eventId),
            eq(activityEventsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
    );

    if (!event) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const [detection] = await withTenantContext(tenantId, (tx) =>
      tx
        .select({
          id: detectionsTable.id,
          ruleName: detectionsTable.ruleName,
          severity: detectionsTable.severity,
          summary: detectionsTable.summary,
          status: detectionsTable.status,
        })
        .from(detectionsTable)
        .where(
          and(
            eq(detectionsTable.tenantId, tenantId),
            eq(detectionsTable.sourceEventId, eventId),
          ),
        )
        .limit(1),
    );

    // Write the audit entry before responding — no view of raw evidence
    // without a corresponding audit record (CANON section 9).
    await writeAuditLog({
      tenantId,
      actorId,
      actorType: "user",
      action: "activity_event.viewed",
      targetType: "activity_event",
      targetId: eventId,
      requestId: String(req.headers["x-request-id"] ?? ""),
      metadata: {},
    });

    res.json({
      eventId: event.id,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      siteId: event.siteId,
      subjectUserId: event.subjectUserId,
      sourceAgentId: event.sourceAgentId,
      metadata: event.metadata,
      ...(detection ? { detection } : {}),
    });
  },
);

export default router;
