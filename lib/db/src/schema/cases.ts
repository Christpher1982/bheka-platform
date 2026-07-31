// Canonical tables: cases, case_participants, approvals
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case, soft delete via deleted_at.
// 008_DATA_MODEL section 5 narrative; CANON section 4 dual-authorisation model.
// 007_RBAC_AND_IDENTITY section 5 separation-of-duties rules apply to approvals.
// approvals table is generic across all approval subject types (008_DATA_MODEL section 5).

import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { tenantsTable } from "./tenants.js";
import { usersTable } from "./users.js";

// Case lifecycle status.
export const caseStatusEnum = pgEnum("case_status", [
  "open",
  "closed",
  "archived",
]);

// Role a participant plays within a case.
export const caseParticipantRoleEnum = pgEnum("case_participant_role", [
  "investigator",
  "subject",
  "witness",
]);

// Subject type for an approval request (008_DATA_MODEL section 5).
export const approvalSubjectTypeEnum = pgEnum("approval_subject_type", [
  "tier_escalation",
  "evidence_export",
  "evidence_reidentification",
  "legal_hold_override",
  "tenant_key_shred",
]);

// Approval decision status.
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "granted",
  "denied",
  "expired",
]);

// The unit of investigation. One case per subject per incident.
// Tier 3 activation is gated by approvals (009_API_SURFACE section 9, CANON section 4).
export const casesTable = pgTable("cases", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  // The person being investigated.
  subjectUserId: uuid("subject_user_id")
    .notNull()
    .references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  status: caseStatusEnum("status").notNull().default("open"),
  // Current collection tier (starts at 1; escalation requires approvals workflow).
  currentTier: integer("current_tier").notNull().default(1),
  openedByUserId: uuid("opened_by_user_id")
    .notNull()
    .references(() => usersTable.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedByUserId: uuid("closed_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// People involved in a case. Role determines what they can see and do.
export const caseParticipantsTable = pgTable("case_participants", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  caseId: uuid("case_id")
    .notNull()
    .references(() => casesTable.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  role: caseParticipantRoleEnum("role").notNull(),
  addedByUserId: uuid("added_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Generic approval record across all subject types (008_DATA_MODEL section 5).
// A bounded, time-limited window is enforced: expires_at is NOT NULL.
// is_information_officer_approval: distinguishes the mandatory IO role approval from
// the "second approver" approval in a Tier 3 dual-auth pair (007_RBAC section 5.2).
// Separation-of-duties checks (requester cannot be approver, reporting-line exclusion)
// are enforced at the bheka-case application layer (007_RBAC section 5.1 and 5.3).
export const approvalsTable = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => casesTable.id),
    subjectType: approvalSubjectTypeEnum("subject_type").notNull(),
    // The user being asked to approve.
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => usersTable.id),
    // The user who requested this approval.
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    status: approvalStatusEnum("status").notNull().default("pending"),
    // Whether this specific approval slot must be filled by an Information Officer.
    isInformationOfficerApproval: boolean("is_information_officer_approval")
      .notNull()
      .default(false),
    // Step-up assertion that authorized the grant (required per CANON section 9).
    webauthnAssertionId: uuid("webauthn_assertion_id"),
    // Bounded window: approvals must expire (008_DATA_MODEL section 5).
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    // Optional supplementary context the approver may provide.
    decisionNotes: text("decision_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Requester cannot be the approver — structural DB constraint as an extra defence.
    // The application layer also enforces this (007_RBAC section 5.1).
    check(
      "approvals_no_self_approval_ck",
      sql`${t.approverUserId} != ${t.requestedByUserId}`,
    ),
  ],
);

export type Case = typeof casesTable.$inferSelect;
export type InsertCase = typeof casesTable.$inferInsert;
export type CaseParticipant = typeof caseParticipantsTable.$inferSelect;
export type InsertCaseParticipant = typeof caseParticipantsTable.$inferInsert;
export type Approval = typeof approvalsTable.$inferSelect;
export type InsertApproval = typeof approvalsTable.$inferInsert;
