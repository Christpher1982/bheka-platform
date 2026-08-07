// Canonical table: evidence_images
//
// Real object storage for screenshot_capture images captured by the
// Windows/Android/iOS agents (routes/v1/agent-events.ts). Until this table
// existed, screenshotImageBase64 was stored inline in activity_events.metadata
// (a jsonb column) as an accepted PoC-stage stopgap — see the comment in
// agent-events.ts. This table + lib/evidence-storage.ts on the api-server
// replace that stopgap with encrypted-at-rest files on disk plus a metadata
// row per image, without requiring the full Eride Vault gRPC service
// (lib/vault-client) to be deployed first.
//
// Design notes:
//   - One row per captured screenshot. Linked 1:1 to the activity_events row
//     that reported it via sourceEventId (nullable so a future direct-upload
//     path that skips /v1/agent/events entirely is not precluded).
//   - storageKey is a relative path under EVIDENCE_STORAGE_DIR
//     (see api-server/src/lib/evidence-storage.ts) — never an absolute path,
//     so the storage root can move between environments without a data
//     migration.
//   - Encrypted at rest with AES-256-GCM using a key derived per-tenant from
//     EVIDENCE_MASTER_KEY (see evidence-storage.ts deriveTenantKey). keyVersion
//     is carried on the row now so that when the real Vault-issued
//     per-tenant DEK scheme (lib/vault-client, evidence.ts's sealedDekB64/
//     keyVersion columns) lands, existing rows can be migrated by decrypting
//     with the local scheme and re-encrypting under a Vault-issued DEK without
//     a schema change — the column shape already matches that target design.
//   - iv/authTag are AES-GCM parameters, base64-encoded; contentHashSha256 is
//     computed over the *plaintext* image bytes at write time so integrity
//     can be verified after decryption, same pattern as evidence.hashSha256.
//   - No updated_at: images are immutable once captured, matching evidence.ts.

import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenantsTable } from "./tenants.js";
import { sitesTable } from "./sites.js";
import { usersTable } from "./users.js";
import { agentsTable } from "./endpoints.js";
import { activityEventsTable } from "./activity.js";

export const evidenceImagesTable = pgTable("evidence_images", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sitesTable.id),
  // The monitored person this screenshot was captured from.
  subjectUserId: uuid("subject_user_id")
    .notNull()
    .references(() => usersTable.id),
  sourceAgentId: uuid("source_agent_id")
    .notNull()
    .references(() => agentsTable.id),
  // The activity_events row this image was reported alongside (screenshot_capture
  // event). Nullable defensively, but agent-events.ts always sets it today.
  // onDelete: "set null" because evidence images are the retained artifact of
  // record and may legitimately outlive their originating activity_events row
  // (e.g. shorter activity-log retention windows) — the image must not be
  // silently dropped just because the event log entry that reported it aged
  // out. This mirrors how detections.sourceEventId is treated as advisory
  // provenance rather than a hard lifetime dependency.
  sourceEventId: uuid("source_event_id").references(() => activityEventsTable.id, {
    onDelete: "set null",
  }),
  // Opaque per-broadcast/session identifier reported by the mobile agents
  // (iOS RPBroadcastSampleHandler lifetime, Android MediaProjection session).
  // Windows has no equivalent concept, so this stays nullable.
  sessionId: text("session_id"),
  contentType: text("content_type").notNull().default("image/jpeg"),
  width: integer("width"),
  height: integer("height"),
  // OCR text extracted on-device, copied here so the gallery/lightbox can
  // display it without re-fetching the full activity_events row.
  ocrText: text("ocr_text"),
  // Relative path under EVIDENCE_STORAGE_DIR. See evidence-storage.ts.
  storageKey: text("storage_key").notNull(),
  // AES-256-GCM parameters for the encrypted file at storageKey.
  ivBase64: text("iv_base64").notNull(),
  authTagBase64: text("auth_tag_base64").notNull(),
  // Identifies which tenant-key derivation produced the encryption key, so a
  // future key rotation can support decrypting older rows under an earlier
  // version. See evidence-storage.ts deriveTenantKey.
  keyVersion: text("key_version").notNull().default("v1"),
  // SHA-256 of the plaintext image bytes, computed before encryption.
  contentHashSha256: text("content_hash_sha256").notNull(),
  // Size of the plaintext image in bytes (for display; the on-disk file is
  // slightly larger due to the GCM auth tag).
  byteSize: integer("byte_size").notNull(),
  // When the screenshot was captured on the endpoint (mirrors
  // activity_events.occurredAt for this same event).
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EvidenceImage = typeof evidenceImagesTable.$inferSelect;
export type InsertEvidenceImage = typeof evidenceImagesTable.$inferInsert;
