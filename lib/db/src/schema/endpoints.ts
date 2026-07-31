// Canonical tables: agent_versions, endpoints, agents
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case, soft delete via deleted_at.
// 008_DATA_MODEL section 3 narrative; update ring model CANON section 11.
// Note: agent_versions is NOT tenant-scoped (shared across all tenants).
// endpoints enforces is_corporate_owned = true via check constraint — no BYOD (CANON section 5).

import {
  boolean,
  check,
  integer,
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

// Platform enum for agent binaries.
export const agentPlatformEnum = pgEnum("agent_platform", [
  "windows",
  "linux",
  "macos",
]);

// Update ring enum per CANON section 11.
// canary = Eride internal fleet; rings 0-3 = progressive external rollout.
export const updateRingEnum = pgEnum("update_ring", [
  "canary",
  "ring_0",
  "ring_1",
  "ring_2",
  "ring_3",
]);

// System-wide agent release catalogue. Not tenant-scoped.
// artifact_hash is the SHA-256 of the signed installer for integrity verification.
export const agentVersionsTable = pgTable("agent_versions", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  versionString: text("version_string").notNull().unique(),
  platform: agentPlatformEnum("platform").notNull(),
  artifactHash: text("artifact_hash").notNull(),
  // Minimum ring an endpoint must be in to receive this version.
  minimumRing: updateRingEnum("minimum_ring").notNull().default("ring_3"),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// A physical or virtual machine within a site.
// Permanent product refusal: no BYOD (CANON section 5, refusal 4).
// is_corporate_owned check constraint makes this structural, not policy.
export const endpointsTable = pgTable(
  "endpoints",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sitesTable.id),
    name: text("name").notNull(),
    hostname: text("hostname").notNull(),
    // Always true; check constraint enforces BYOD permanent refusal.
    isCorporateOwned: boolean("is_corporate_owned").notNull().default(true),
    // Current update ring assignment. Changes drive which agent_versions the
    // endpoint is eligible to receive (CANON section 11).
    updateRing: updateRingEnum("update_ring").notNull().default("ring_3"),
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
    // Enforce permanent BYOD refusal at DB layer (CANON section 5, refusal 4).
    check("endpoints_corporate_owned_ck", sql`${t.isCorporateOwned} = true`),
  ],
);

// One active agent per endpoint at a time. Tied to a specific agent_versions row.
// certificate_fingerprint: SHA-256 of the per-agent mTLS cert issued at enrolment.
// last_heartbeat_at: updated by bheka-ingest on each heartbeat, not by gateway directly.
export const agentsTable = pgTable("agents", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  endpointId: uuid("endpoint_id")
    .notNull()
    .references(() => endpointsTable.id),
  agentVersionId: uuid("agent_version_id")
    .notNull()
    .references(() => agentVersionsTable.id),
  // SHA-256 fingerprint of the per-agent mTLS certificate (007_RBAC section 3).
  certificateFingerprint: text("certificate_fingerprint").notNull().unique(),
  // Enrolment token used; stored for audit; single-use token itself expires on use.
  enrolmentTokenHash: text("enrolment_token_hash"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AgentVersion = typeof agentVersionsTable.$inferSelect;
export type InsertAgentVersion = typeof agentVersionsTable.$inferInsert;
export type Endpoint = typeof endpointsTable.$inferSelect;
export type InsertEndpoint = typeof endpointsTable.$inferInsert;
export type Agent = typeof agentsTable.$inferSelect;
export type InsertAgent = typeof agentsTable.$inferInsert;
