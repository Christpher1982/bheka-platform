// Canonical tables: transparency_notices, data_subject_requests, consent_records
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case.
// 008_DATA_MODEL section 7 narrative; POPIA sections 23–25 (data subject rights).
// CANON section 5, refusal 8: monitoring is never silent.
// transparency_notices are generated for deployment, Tier 2/3 activation, policy changes,
// conclusion disclosures, and breach notices (018_NOTIFICATIONS_AND_TRANSPARENCY).

import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenantsTable } from "./tenants.js";
import { usersTable } from "./users.js";

// Enumerated notice kinds per 018_NOTIFICATIONS_AND_TRANSPARENCY.
export const noticeTypeEnum = pgEnum("notice_type", [
  "deployment",
  "tier_2_activation",
  "tier_3_activation",
  "conclusion_disclosure",
  "policy_change",
  "breach_notice",
  "data_subject_request_response",
]);

// Data subject request types per POPIA sections 23–25.
export const dsrTypeEnum = pgEnum("dsr_type", [
  "access",       // Section 23: right of access to personal information
  "correction",   // Section 24: right to correction of personal information
  "objection",    // Section 25: right to object to processing
  "deletion",     // Extension: right to erasure (crypto-shred pathway)
]);

// Data subject request status.
export const dsrStatusEnum = pgEnum("dsr_status", [
  "pending",
  "in_progress",
  "completed",
  "rejected",
]);

// Transparency notice delivered to the data subject (employee) for every monitoring event.
// issued_at: when the notice was generated (not when the subject acknowledged it).
// acknowledged_at: when the subject confirmed receipt in the transparency portal.
export const transparencyNoticesTable = pgTable("transparency_notices", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  // The user receiving this notice (the data subject).
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  noticeType: noticeTypeEnum("notice_type").notNull(),
  title: text("title").notNull(),
  // Notice body. Delivered in one of five official SA languages (CANON section 16).
  body: text("body").notNull(),
  // Language code (e.g. 'en', 'zu', 'af', 'st', 'xh') per CANON section 16.
  language: text("language").notNull().default("en"),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Tracks POPIA sections 23–25 access, correction, and objection requests
// as first-class records rather than support tickets (008_DATA_MODEL section 7).
// The Information Officer can query a complete, ordered history via GET /data-subject-requests.
export const dataSubjectRequestsTable = pgTable("data_subject_requests", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  // The data subject making the request.
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  requestType: dsrTypeEnum("request_type").notNull(),
  status: dsrStatusEnum("status").notNull().default("pending"),
  // Free-text description of what the subject is requesting.
  requestDetails: text("request_details"),
  // How the Information Officer resolved the request.
  resolutionNotes: text("resolution_notes"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: uuid("resolved_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Records consent to specific processing activities per tenant-specific requirements.
// consent_type: e.g. 'monitoring_tier_1', 'monitoring_tier_2', 'recording'.
// version: the version of the consent document accepted; changing the document
// creates a new version that requires fresh acceptance.
export const consentRecordsTable = pgTable("consent_records", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  consentType: text("consent_type").notNull(),
  version: text("version").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type TransparencyNotice = typeof transparencyNoticesTable.$inferSelect;
export type InsertTransparencyNotice =
  typeof transparencyNoticesTable.$inferInsert;
export type DataSubjectRequest = typeof dataSubjectRequestsTable.$inferSelect;
export type InsertDataSubjectRequest =
  typeof dataSubjectRequestsTable.$inferInsert;
export type ConsentRecord = typeof consentRecordsTable.$inferSelect;
export type InsertConsentRecord = typeof consentRecordsTable.$inferInsert;
