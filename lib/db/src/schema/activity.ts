// Canonical table: activity_events
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case.
//
// Raw endpoint telemetry as reported by an enrolled agent. One row per event.
// This is the input the v0 rule engine evaluates to produce detections.
//
// Deviation from 008_DATA_MODEL section 4: the canonical design keeps event
// content in ClickHouse and stores only pointers in Postgres. activity_events
// lands content in Postgres so the v0 rule engine can evaluate synchronously on
// ingest without a second datastore. metadata therefore carries Tier 3 content
// (captured_text) and must stay behind the same visibility-tier controls as
// evidence. When ClickHouse lands, this table becomes the pointer table.

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenantsTable } from "./tenants.js";
import { sitesTable } from "./sites.js";
import { usersTable } from "./users.js";
import { agentsTable } from "./endpoints.js";

// Shape of the metadata blob the agent reports. Kept as jsonb rather than
// columns because the agent's telemetry surface is still expanding.
export interface ActivityEventMetadata {
  keystrokeCount?: number;
  activeWindowTitle?: string;
  capturedText?: string;
  // screenshot_capture fields (see routes/v1/agent-events.ts). ocrText is
  // local-Tesseract (or on-device OCR) output, or null when OCR wasn't
  // available. screenshotImageBase64 is accepted on ingest (the wire
  // contract every agent already speaks) but is never persisted here —
  // agent-events.ts decodes it, writes it to encrypted-at-rest evidence
  // storage (see lib/evidence-storage.ts on the api-server, and the
  // evidence_images table), and stores only evidenceImageId below. Kept as
  // an optional field on this type purely so the ingest route's Zod schema
  // and this type can share one shape; a stored activity_events row's
  // metadata will not actually contain this key.
  ocrText?: string | null;
  screenshotImageBase64?: string;
  screenshotWidth?: number;
  screenshotHeight?: number;
  // Pointer to the evidence_images row holding the actual encrypted image
  // bytes for this screenshot_capture event, once persisted by
  // agent-events.ts. Absent if evidence storage write failed (see the
  // catch block there) or for event types that never capture an image.
  evidenceImageId?: string;
  // Optional opaque session/broadcast identifier (see routes/v1/agent-events.ts).
  // Not persisted in metadata (moved onto evidence_images.sessionId instead)
  // but declared here so the shared Zod schema for the wire payload can
  // reuse this type.
  sessionId?: string;
  // app_usage_session fields (see routes/v1/agent-events.ts). Active
  // application / website usage tracking: a discrete usage session for one
  // (processName, windowTitle) pair, closed out when the foreground window
  // changes. windowTitle is the raw foreground window title only — this is
  // a best-effort "website usage" signal (browsers often put the page title
  // there), NOT real per-URL tracking, which is out of scope. isBrowser is
  // a best-effort flag based on a known-browser process name list.
  processName?: string;
  windowTitle?: string;
  isBrowser?: boolean;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  [key: string]: unknown;
}

export const activityEventsTable = pgTable("activity_events", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sitesTable.id),
  // The monitored person the event was captured from.
  subjectUserId: uuid("subject_user_id")
    .notNull()
    .references(() => usersTable.id),
  sourceAgentId: uuid("source_agent_id")
    .notNull()
    .references(() => agentsTable.id),
  // Free-form agent-defined discriminator, e.g. "keystroke_batch", "window_focus".
  eventType: text("event_type").notNull(),
  // When the activity happened on the endpoint, not when we received it.
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<ActivityEventMetadata>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActivityEvent = typeof activityEventsTable.$inferSelect;
export type InsertActivityEvent = typeof activityEventsTable.$inferInsert;
