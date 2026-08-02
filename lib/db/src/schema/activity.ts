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
  // local-Tesseract output (or null when OCR wasn't available on the
  // agent's machine); screenshotImageBase64 is a JPEG data payload stored
  // directly in this jsonb column as a PoC-stage stopgap — see the comment
  // in agent-events.ts for why this isn't in object storage yet.
  ocrText?: string | null;
  screenshotImageBase64?: string;
  screenshotWidth?: number;
  screenshotHeight?: number;
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
