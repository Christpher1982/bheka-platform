// Canonical tables: evidence, evidence_access_grants, evidence_views
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case.
// 008_DATA_MODEL section 5 narrative; CANON section 6 for crypto-shred mechanism.
// evidence is sealed once captured: no updated_at, no deletedAt.
// evidence_views has no UPDATE grant — view records are insert-only (enforced via RLS SQL).
// Hash-chained fields (prev_hash, row_hash) mirror the audit_log pattern for tamper detection.

import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenantsTable } from "./tenants.js";
import { usersTable } from "./users.js";
import { casesTable } from "./cases.js";

// Evidence is sealed at capture and never mutated.
// crypto_shredded becomes true when eride-vault destroys the key version covering this evidence.
// s3_key / sealed_dek_b64 / key_version: form the full envelope for evidence retrieval.
// hash_sha256: content hash of the plaintext evidence, computed at seal time.
// prev_hash + row_hash: hash-chain linking evidence rows per case for tamper detection.
export const evidenceTable = pgTable("evidence", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  caseId: uuid("case_id")
    .notNull()
    .references(() => casesTable.id),
  // Nullable: not all evidence is governed by a schedule at capture time.
  retentionScheduleId: uuid("retention_schedule_id"),
  // Visibility tier at which this evidence was collected (1/2/3).
  tier: integer("tier").notNull(),
  // MIME type of the encrypted payload.
  contentType: text("content_type").notNull(),
  // S3 object location (af-south-1 primary, CANON section 2).
  s3Bucket: text("s3_bucket").notNull(),
  s3Key: text("s3_key").notNull(),
  // HPKE-sealed AES-256 DEK; unwrapped by eride-vault on evidence view (CANON section 6).
  sealedDekB64: text("sealed_dek_b64").notNull(),
  keyVersion: text("key_version").notNull(),
  // SHA-256 of plaintext content before encryption; used to verify integrity on view.
  hashSha256: text("hash_sha256").notNull(),
  // Hash-chain fields — same pattern as audit_log.
  prevHash: text("prev_hash"),
  rowHash: text("row_hash").notNull(),
  // Set to true when eride-vault destroys the covering key version (CANON section 6).
  cryptoShredded: boolean("crypto_shredded").notNull().default(false),
  shredAt: timestamp("shred_at", { withTimezone: true }),
  // No updated_at — evidence is immutable after sealing (008_DATA_MODEL section 5).
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Governs which users may view specific evidence items.
// Access grants are created as part of the approval workflow for Tier 3 evidence.
export const evidenceAccessGrantsTable = pgTable("evidence_access_grants", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => evidenceTable.id),
  grantedToUserId: uuid("granted_to_user_id")
    .notNull()
    .references(() => usersTable.id),
  grantedByUserId: uuid("granted_by_user_id")
    .notNull()
    .references(() => usersTable.id),
  // Time-bounded access: grant expires even if not explicitly revoked.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Every actual view of evidence content is recorded here.
// No UPDATE grant: rows are insert-only — a view cannot be edited after the fact.
// This is what makes four-eyes evidence viewing auditable (008_DATA_MODEL section 5).
// The RLS policy for this table withholds UPDATE/DELETE at the PostgreSQL level.
export const evidenceViewsTable = pgTable("evidence_views", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => evidenceTable.id),
  viewerUserId: uuid("viewer_user_id")
    .notNull()
    .references(() => usersTable.id),
  // Session that viewed this evidence — links to the Redis session token hash.
  sessionId: text("session_id"),
  // No updated_at — insert-only by design.
  viewedAt: timestamp("viewed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Evidence = typeof evidenceTable.$inferSelect;
export type InsertEvidence = typeof evidenceTable.$inferInsert;
export type EvidenceAccessGrant = typeof evidenceAccessGrantsTable.$inferSelect;
export type InsertEvidenceAccessGrant =
  typeof evidenceAccessGrantsTable.$inferInsert;
export type EvidenceView = typeof evidenceViewsTable.$inferSelect;
export type InsertEvidenceView = typeof evidenceViewsTable.$inferInsert;
