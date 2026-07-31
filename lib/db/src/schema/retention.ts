// Canonical table: retention_schedules
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case.
// 008_DATA_MODEL section 8 narrative.
// retention_schedules governs how long evidence and other tenant data are kept.
// Disposition may include crypto-shred, which is the POPIA s14 enforcement mechanism.
// The actual destructive act is eride-vault destroying the tenant root key, not a DELETE.

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

// What happens to data at the end of the retention period.
export const dispositionActionEnum = pgEnum("disposition_action", [
  "delete",        // Logical deletion (soft delete, then hard delete after grace period)
  "crypto_shred",  // Destroy the covering key version via eride-vault (POPIA s14)
  "archive",       // Move to S3 Glacier equivalent; no destruction
]);

// A retention schedule governs one or more evidence rows via evidence.retention_schedule_id.
// retention_days: how many days from evidence creation until disposition triggers.
// The actual disposition is scheduled and executed by bheka-case.
export const retentionSchedulesTable = pgTable(
  "retention_schedules",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    name: text("name").notNull(),
    description: text("description"),
    // Number of days from evidence creation until disposition.
    retentionDays: integer("retention_days").notNull(),
    dispositionAction: dispositionActionEnum("disposition_action").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Retention must be a positive number of days.
    check("retention_schedules_days_ck", sql`${t.retentionDays} > 0`),
  ],
);

export type RetentionSchedule = typeof retentionSchedulesTable.$inferSelect;
export type InsertRetentionSchedule =
  typeof retentionSchedulesTable.$inferInsert;
