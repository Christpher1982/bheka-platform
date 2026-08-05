// Agent telemetry ingest — machine-to-machine, no user session.
//
// Routes:
//   POST /v1/agent/events    — ingest one activity event (X-Agent-Token)
//
// The agent posts a single activity event. We persist it, run the v0 rule engine
// (src/rules/evaluate.ts) synchronously, and persist a detection if a rule fires.
//
// Synchronous evaluation is a v0 choice: it keeps the agent's feedback loop
// simple and avoids standing up a queue. It also means ingest latency is bounded
// by rule cost, so rules must stay cheap and side-effect free. When rules need
// history or correlation this moves behind NATS and bheka-policy.
//
// Tenant is taken from the request body rather than from the caller's identity
// because the shared ingest token is not tenant-scoped. Every referenced entity
// is therefore re-checked against the resolved tenant below — without that, a
// token holder could stitch one tenant's site onto another tenant's user.
//
// Dedupe/cooldown: a noisy agent can call this endpoint very frequently (e.g.
// once a minute) while a single ongoing situation (like being off-hours)
// keeps matching the same rule. Before inserting a new detection for a match,
// we look up the most recent existing detection for the same tenant + ruleName
// + subject (subjectUserId, since that is required on both activity_events and
// detections today; sourceAgentId would be the fallback if a rule ever needed
// to key off an agent instead, but no activity event lacks a subjectUserId in
// the current schema). If that detection's occurredAt is within
// ruleConfig.dedupeCooldownMinutes of the current event's occurredAt, we skip
// creating a new detection — the activity event itself is still stored either
// way. This is generic across all rules, not specific to off_hours_activity.

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  db,
  activityEventsTable,
  agentsTable,
  detectionsTable,
  evidenceImagesTable,
  sitesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { withTenantContext } from "../../lib/tenant-context.js";
import { sendProblem, Problems } from "../../lib/problem.js";
import { requireAgentToken } from "../../middleware/require-agent-token.js";
import { evaluateEvent, ruleConfig } from "../../rules/evaluate.js";
import { writeEvidenceImage } from "../../lib/evidence-storage.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

// A few MB is generous for a quality~55 JPEG downscaled to max width 1280px
// (typically tens to a few hundred KB before base64, ~33% larger after) —
// this caps pathological/malicious payloads while leaving normal screenshots
// comfortable headroom. Exceeding it is a clean 400, not a crash.
const MAX_SCREENSHOT_BASE64_LENGTH = 8_000_000;

// Additive: keystroke_batch's capturedText/keystrokeCount fields are kept as
// they were; screenshot_capture's fields are new and all optional so both
// event types validate against one shared shape. app_usage_session's fields
// (processName/windowTitle/isBrowser/startedAt/endedAt/durationSeconds) are
// likewise new and additive — see rules/evaluate.ts (no rule reads these
// yet, by design) and lib/db ActivityEventMetadata.
const EventMetadata = z
  .object({
    keystrokeCount: z.number().int().nonnegative().optional(),
    activeWindowTitle: z.string().max(2000).optional(),
    capturedText: z.string().max(100_000).optional(),
    // screenshot_capture fields — see rules/evaluate.ts (sensitiveKeyword
    // also reads ocrText) and lib/db ActivityEventMetadata.
    ocrText: z.string().max(100_000).nullable().optional(),
    screenshotImageBase64: z
      .string()
      .max(MAX_SCREENSHOT_BASE64_LENGTH)
      .optional(),
    screenshotWidth: z.number().int().positive().optional(),
    screenshotHeight: z.number().int().positive().optional(),
    // Opaque session/broadcast identifier, reported by agents that have one
    // (iOS RPBroadcastSampleHandler lifetime, Android MediaProjection
    // session). Optional and additive — Windows and older agent builds omit
    // it. Used only to group evidence_images for display; never required for
    // ingest to succeed.
    sessionId: z.string().max(200).optional(),
    // app_usage_session fields — active application / website usage
    // tracking. windowTitle is the raw foreground window title only (a
    // best-effort "website usage" signal, not real per-URL tracking).
    // processName/isBrowser/startedAt/endedAt/durationSeconds together
    // describe one discrete usage session, as emitted by the agent's
    // third capture thread.
    processName: z.string().max(260).optional(),
    windowTitle: z.string().max(500).optional(),
    isBrowser: z.boolean().optional(),
    // Kept as validated ISO datetime strings (not coerced to Date) so the
    // stored jsonb metadata matches the ActivityEventMetadata `string` type
    // exactly — unlike the top-level `occurredAt` column, these live inside
    // the free-form metadata blob.
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    durationSeconds: z.number().positive().optional(),
  })
  .passthrough();

const IngestEventBody = z
  .object({
    tenantSlug: z.string().min(1),
    siteId: z.string().uuid(),
    subjectUserId: z.string().uuid(),
    sourceAgentId: z.string().uuid(),
    eventType: z.string().min(1).max(200),
    occurredAt: z.coerce.date(),
    metadata: EventMetadata,
  })
  // The shared EventMetadata shape above keeps every field optional so all
  // event types validate against one object (existing convention for
  // keystroke_batch/screenshot_capture). app_usage_session, however, does
  // have real required fields (processName, isBrowser, startedAt, endedAt,
  // durationSeconds) — enforced here, conditionally on eventType, so a
  // malformed app_usage_session event still gets a clean 400 instead of
  // silently persisting with missing data. keystroke_batch and
  // screenshot_capture are untouched by this refinement.
  .superRefine((body, ctx) => {
    if (body.eventType !== "app_usage_session") return;
    const { metadata } = body;
    if (typeof metadata.processName !== "string" || metadata.processName.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "processName"],
        message: "processName is required for app_usage_session events.",
      });
    }
    if (typeof metadata.isBrowser !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "isBrowser"],
        message: "isBrowser is required for app_usage_session events.",
      });
    }
    if (typeof metadata.startedAt !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "startedAt"],
        message: "startedAt is required for app_usage_session events.",
      });
    }
    if (typeof metadata.endedAt !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "endedAt"],
        message: "endedAt is required for app_usage_session events.",
      });
    }
    if (typeof metadata.durationSeconds !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "durationSeconds"],
        message: "durationSeconds is required for app_usage_session events.",
      });
    }
  });

router.post(
  "/v1/agent/events",
  requireAgentToken,
  async (req, res): Promise<void> => {
    const parsed = IngestEventBody.safeParse(req.body);
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

    const {
      tenantSlug,
      siteId,
      subjectUserId,
      sourceAgentId,
      eventType,
      occurredAt,
      metadata,
    } = parsed.data;

    // Resolved outside withTenantContext: we do not have a tenant id yet, and
    // the tenants lookup is by unique slug.
    const [tenant] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, tenantSlug))
      .limit(1);

    if (!tenant) {
      sendProblem(res, Problems.notFound());
      return;
    }

    const tenantId = tenant.id;

    const result = await withTenantContext(tenantId, async (tx) => {
      // All three must belong to the resolved tenant. A mismatch means the
      // caller supplied an id from another tenant, so it is a 404, not a 500.
      // Sequential, not Promise.all: these share one transaction connection.
      const [site] = await tx
        .select({ id: sitesTable.id })
        .from(sitesTable)
        .where(and(eq(sitesTable.id, siteId), eq(sitesTable.tenantId, tenantId)))
        .limit(1);

      const [subject] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, subjectUserId),
            eq(usersTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      const [agent] = await tx
        .select({ id: agentsTable.id, active: agentsTable.active })
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.id, sourceAgentId),
            eq(agentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!site || !subject || !agent?.active) return null;

      // screenshot_capture's screenshotImageBase64 no longer lands in this
      // jsonb column (see lib/evidence-storage.ts and evidence-images.ts for
      // the read/write path this replaces the old inline-base64 stopgap
      // with). We persist the decoded bytes to encrypted-at-rest evidence
      // storage first, then store only a pointer (evidenceImageId) plus the
      // display fields (dimensions, ocrText) in metadata — the same fields
      // the console already reads, minus the heavy base64 payload.
      let storedMetadata = metadata;
      let evidenceImageId: string | null = null;
      if (eventType === "screenshot_capture" && metadata.screenshotImageBase64) {
        const { screenshotImageBase64, sessionId, ...rest } = metadata;
        try {
          const plaintext = Buffer.from(screenshotImageBase64, "base64");
          evidenceImageId = uuidv7();
          const stored = await writeEvidenceImage({
            tenantId,
            id: evidenceImageId,
            occurredAt,
            plaintext,
          });
          await tx.insert(evidenceImagesTable).values({
            id: evidenceImageId,
            tenantId,
            siteId,
            subjectUserId,
            sourceAgentId,
            sessionId: sessionId ?? null,
            contentType: "image/jpeg",
            width: metadata.screenshotWidth ?? null,
            height: metadata.screenshotHeight ?? null,
            ocrText: metadata.ocrText ?? null,
            storageKey: stored.storageKey,
            ivBase64: stored.ivBase64,
            authTagBase64: stored.authTagBase64,
            keyVersion: stored.keyVersion,
            contentHashSha256: stored.contentHashSha256,
            byteSize: stored.byteSize,
            occurredAt,
          });
          storedMetadata = { ...rest, evidenceImageId };
        } catch (err) {
          // Evidence storage failure must not silently drop the screenshot's
          // OCR text / metadata — but it also must not pretend the image was
          // stored. Log and fall through to storing metadata without the
          // image pointer; the base64 itself is discarded either way (never
          // re-persisted into the jsonb column, to avoid resurrecting the
          // stopgap this change removes).
          logger.error({ err }, "Failed to write evidence image — storing event without image");
          const { screenshotImageBase64: _dropped, sessionId: _sid, ...rest } = metadata;
          storedMetadata = rest;
        }
      }

      const [event] = await tx
        .insert(activityEventsTable)
        .values({
          tenantId,
          siteId,
          subjectUserId,
          sourceAgentId,
          eventType,
          occurredAt,
          metadata: storedMetadata,
        })
        .returning({ id: activityEventsTable.id });

      // Backfill the evidence_images row's sourceEventId now that the
      // activity_events row exists (evidence_images is written first so its
      // id is available to embed in activity_events.metadata above).
      if (evidenceImageId) {
        await tx
          .update(evidenceImagesTable)
          .set({ sourceEventId: event!.id })
          .where(eq(evidenceImagesTable.id, evidenceImageId));
      }

      const match = evaluateEvent({ eventType, occurredAt, metadata });
      if (!match) return { eventId: event!.id, detectionId: null };

      // Dedupe subject: prefer subjectUserId, falling back to sourceAgentId if
      // it were ever null (see comment at the top of this file).
      const dedupeSubjectUserId = subjectUserId ?? null;

      // Cooldown lower bound: detections at or after this instant count as
      // "recent" for dedupe purposes.
      const cooldownWindowStart = new Date(
        occurredAt.getTime() - ruleConfig.dedupeCooldownMinutes * 60_000,
      );

      const [recentDetection] = await tx
        .select({ id: detectionsTable.id, occurredAt: detectionsTable.occurredAt })
        .from(detectionsTable)
        .where(
          and(
            eq(detectionsTable.tenantId, tenantId),
            eq(detectionsTable.ruleName, match.ruleName),
            dedupeSubjectUserId
              ? eq(detectionsTable.subjectUserId, dedupeSubjectUserId)
              : eq(detectionsTable.subjectUserId, sourceAgentId),
            gte(detectionsTable.occurredAt, cooldownWindowStart),
          ),
        )
        .orderBy(desc(detectionsTable.occurredAt))
        .limit(1);

      if (recentDetection) {
        // Still within the cooldown window for this rule + subject: the
        // activity event is stored above, but we do not raise a second
        // detection for what is really the same ongoing situation.
        return { eventId: event!.id, detectionId: null };
      }

      const [detection] = await tx
        .insert(detectionsTable)
        .values({
          tenantId,
          siteId,
          subjectUserId,
          ruleName: match.ruleName,
          severity: match.severity,
          summary: match.summary,
          tier: match.tier,
          sourceEventId: event!.id,
          occurredAt,
        })
        .returning({ id: detectionsTable.id });

      return { eventId: event!.id, detectionId: detection!.id };
    });

    if (!result) {
      sendProblem(res, Problems.notFound());
      return;
    }

    res.status(201).json({
      eventId: result.eventId,
      detectionCreated: result.detectionId !== null,
      ...(result.detectionId ? { detectionId: result.detectionId } : {}),
    });
  },
);

export default router;
