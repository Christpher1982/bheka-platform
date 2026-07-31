// Canonical table: sites
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case, soft delete via deleted_at.
// Sites represent physical or logical locations within a tenant.
// Relevant to the Africa module's low-bandwidth mode (CANON section 16).
// See 008_DATA_MODEL section 2 for narrative.

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

export const sitesTable = pgTable("sites", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  // IANA timezone identifier. Defaults to South African Standard Time.
  timezone: text("timezone").notNull().default("Africa/Johannesburg"),
  // Below this kbps, agents at this site enter low-bandwidth mode (CANON section 16).
  lowBandwidthThresholdKbps: integer("low_bandwidth_threshold_kbps")
    .notNull()
    .default(512),
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

export type Site = typeof sitesTable.$inferSelect;
export type InsertSite = typeof sitesTable.$inferInsert;
