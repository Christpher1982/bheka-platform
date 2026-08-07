// Canonical tables: detections, risk_scores
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case.
// 008_DATA_MODEL section 4 narrative.
// Detections are written by bheka-policy and by the v0 rule engine that runs on
// agent telemetry ingest. They are never created by a console-facing REST call
// (009_API_SURFACE section 8) — the only console write is triage state.
// Risk scores are appended-only (no updated_at) — each row is an immutable scored point
// in time with contributing_signals for explainability (008_DATA_MODEL section 4).

import {
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
import { sitesTable } from "./sites.js";
import { usersTable } from "./users.js";
import { casesTable } from "./cases.js";
import { policyRulesTable } from "./policies.js";
import { activityEventsTable } from "./activity.js";

// Lifecycle state of a detection.
export const detectionStatusEnum = pgEnum("detection_status", [
  "new",
  "triaged",
  "resolved",
  "false_positive",
]);

// Analyst-facing urgency. Set by the rule that produced the detection.
export const detectionSeverityEnum = pgEnum("detection_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

// Written by bheka-policy when a rule matches incoming telemetry.
// source_event_ids: array of ClickHouse row identifiers for the matching events.
// Detections never carry event content, only pointers into ClickHouse.
// This maintains the visibility-tier boundary: a Tier 1-scoped user with access
// to the detections table cannot recover Tier 3 content from it alone (008_DATA_MODEL §4).
export const detectionsTable = pgTable("detections", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  siteId: uuid("site_id").references(() => sitesTable.id),
  // Nullable: v0 rules (src/rules/evaluate.ts in bheka-gateway) are code-defined
  // and have no policy_rules row. Set only for detections raised by bheka-policy.
  policyRuleId: uuid("policy_rule_id").references(() => policyRulesTable.id),
  // Identifier of the rule that fired, e.g. "sensitive_keyword". Stable across
  // both code-defined v0 rules and policy_rules-backed rules.
  ruleName: text("rule_name"),
  severity: detectionSeverityEnum("severity"),
  // Short analyst-readable explanation of why the rule fired.
  summary: text("summary"),
  subjectUserId: uuid("subject_user_id")
    .notNull()
    .references(() => usersTable.id),
  // Set when an investigator attaches this detection to a case.
  caseId: uuid("case_id").references(() => casesTable.id),
  // Pointers into ClickHouse. Never store event content here.
  sourceEventIds: text("source_event_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  // The activity_events row that triggered a v0 rule. Null for bheka-policy
  // detections, which point into ClickHouse via source_event_ids instead.
  sourceEventId: uuid("source_event_id").references(() => activityEventsTable.id),
  // When the triggering activity happened, not when the detection was written.
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  // Visibility tier of the telemetry that triggered this detection.
  tier: integer("tier").notNull(),
  status: detectionStatusEnum("status").notNull().default("new"),
  triagedAt: timestamp("triaged_at", { withTimezone: true }),
  triagedBy: uuid("triaged_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Immutable risk score snapshot. Appended by bheka-policy on recalculation.
// Never updated in place — each row is one scored moment in time.
// contributing_signals: array of detection IDs and weights, kept for explainability.
// This is the "explainable risk scoring" position (CANON section 5, refusal 6 context).
export const riskScoresTable = pgTable("risk_scores", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  // Normalised score 0–100.
  score: integer("score").notNull(),
  // Array of { detectionId, weight, reason } objects for transparency.
  contributingSignals: jsonb("contributing_signals").notNull(),
  scoredAt: timestamp("scored_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // No updated_at: rows are immutable (008_DATA_MODEL section 4).
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Detection = typeof detectionsTable.$inferSelect;
export type InsertDetection = typeof detectionsTable.$inferInsert;
export type RiskScore = typeof riskScoresTable.$inferSelect;
export type InsertRiskScore = typeof riskScoresTable.$inferInsert;
