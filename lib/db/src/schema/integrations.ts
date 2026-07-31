// Canonical tables: integrations, webhooks
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case.
// 008_DATA_MODEL section 9 narrative.
// webhooks enforce https:// URLs only via check constraint.
// Integration secrets / webhook signing secrets are never returned via GET
// (009_API_SURFACE section 12) — secret_hash stores an Argon2id hash of the actual secret.

import {
  boolean,
  check,
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

// Supported external integration providers (CANON section 2, 008_DATA_MODEL section 9).
export const integrationProviderEnum = pgEnum("integration_provider", [
  "entra_id",
  "okta",
  "google_workspace",
  "hris",
  "siem",
  "ticketing",
  "whatsapp",
  "mdm",
]);

// Records a configured connection to an external system.
// config_json: provider-specific configuration (client IDs, endpoints, etc.).
// Sensitive fields within config_json (client secrets, API keys) are stored encrypted
// via the application secrets layer (see artifacts/api-server/src/lib/secrets.ts).
export const integrationsTable = pgTable("integrations", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  provider: integrationProviderEnum("provider").notNull(),
  name: text("name").notNull(),
  // Provider-specific config. Sensitive values within are encrypted at rest.
  configJson: jsonb("config_json").notNull().default(sql`'{}'::jsonb`),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Tenant-configured outbound event delivery targets.
// Webhook events carry bheka event payloads to systems outside Eride's control.
// KEY stream events (key.rotated, key.shredded) are never eligible for webhook delivery
// (010_EVENT_BUS_AND_TOPICS section 1).
// secret_hash: Argon2id hash of the signing secret, never exposed via GET.
// The check constraint for https:// is a database-level enforcement matching
// 008_DATA_MODEL section 9's note that only https URLs are allowed.
export const webhooksTable = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    // HTTPS endpoint receiving the event payloads.
    url: text("url").notNull(),
    // Argon2id hash of the webhook signing secret. Write-only: never returned by GET.
    secretHash: text("secret_hash").notNull(),
    // Array of bheka event topic names this webhook subscribes to.
    events: text("events").array().notNull().default(sql`ARRAY[]::text[]`),
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
    // Enforce https:// only (008_DATA_MODEL section 9, 009_API_SURFACE section 12).
    check("webhooks_https_url_ck", sql`${t.url} LIKE 'https://%'`),
  ],
);

export type Integration = typeof integrationsTable.$inferSelect;
export type InsertIntegration = typeof integrationsTable.$inferInsert;
export type Webhook = typeof webhooksTable.$inferSelect;
export type InsertWebhook = typeof webhooksTable.$inferInsert;
