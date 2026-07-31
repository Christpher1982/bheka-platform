// Canonical tables: policies, policy_rules
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case, soft delete via deleted_at.
// 008_DATA_MODEL section 4 narrative; 016_DETECTION_AND_POLICY_ENGINE for rule semantics.
// Critical: policy_rules CHECK constraint enforces requires_dual_authorisation = true
// for any Tier 3-targeted rule (008_DATA_MODEL section 4, 009_API_SURFACE section 7).
// This makes the dual-authorisation requirement structural, not just application logic.

import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { tenantsTable } from "./tenants.js";

// A named collection of detection rules authored by a Security Administrator.
// Policies group related rules but do not themselves carry tier or condition logic.
export const policiesTable = pgTable("policies", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Individual detection rule within a policy.
// target_tier: which visibility tier (1/2/3) the matched event comes from.
// condition_json: rule expression evaluated by bheka-policy against telemetry.
// requires_dual_authorisation: CHECK forces true for any Tier 3 rule.
// This check makes it impossible to save a Tier 3 rule without dual-auth enabled —
// even a future code change that forgets the check cannot bypass it (008_DATA_MODEL §4).
export const policyRulesTable = pgTable(
  "policy_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policiesTable.id),
    name: text("name").notNull(),
    description: text("description"),
    // Visibility tier this rule targets (1/2/3 per CANON section 4).
    targetTier: integer("target_tier").notNull(),
    // Must be true for any Tier 3 rule. Enforced by check constraint below.
    requiresDualAuthorisation: boolean("requires_dual_authorisation")
      .notNull()
      .default(false),
    // Rule expression evaluated by bheka-policy. Schema is internal to bheka-policy.
    conditionJson: jsonb("condition_json").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // DB-level enforcement of Tier 3 dual-authorisation (008_DATA_MODEL section 4).
    // A Tier 3 rule cannot be saved without requires_dual_authorisation = true.
    check(
      "policy_rules_tier3_dual_auth_ck",
      sql`${t.targetTier} != 3 OR ${t.requiresDualAuthorisation} = true`,
    ),
    // Valid tiers are 1, 2, 3 (CANON section 4).
    check(
      "policy_rules_target_tier_ck",
      sql`${t.targetTier} IN (1, 2, 3)`,
    ),
  ],
);

export type Policy = typeof policiesTable.$inferSelect;
export type InsertPolicy = typeof policiesTable.$inferInsert;
export type PolicyRule = typeof policyRulesTable.$inferSelect;
export type InsertPolicyRule = typeof policyRulesTable.$inferInsert;
