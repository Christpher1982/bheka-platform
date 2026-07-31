// Canonical tables: tenants, key_custody_config, tenant_keys
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case, soft delete via deleted_at.
// RLS policies for these tables are applied via lib/db/src/rls-policies.sql.
// See 008_DATA_MODEL section 2 and 008_DATA_MODEL section 8 for narrative.

import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

// PostgreSQL native enum for key custody tier (CANON section 6, ADR-004).
export const keyCustodyTierEnum = pgEnum("key_custody_tier", ["a", "b", "c"]);

// Central tenant record. Every other tenant-scoped table foreign-keys to this.
// data_residency_region defaults to af-south-1 (CANON section 2, 002_SYSTEM_ARCHITECTURE section 7).
export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  displayName: text("display_name"),
  dataResidencyRegion: text("data_residency_region")
    .notNull()
    .default("af-south-1"),
  keyCustodyTier: keyCustodyTierEnum("key_custody_tier").notNull().default("a"),
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

// Records which of the three custody tiers a tenant uses and the key material references.
// kmsKeyArn: used by Tier A (Eride's KMS) and Tier B (customer's KMS).
// vaultEndpoint / vaultTlsCaCert: used by Tier C (customer-hosted Vault).
// See 004_KEY_CUSTODY_AND_CRYPTOGRAPHY for the full cryptographic flow.
export const keyCustodyConfigTable = pgTable("key_custody_config", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id)
    .unique(),
  tier: keyCustodyTierEnum("tier").notNull(),
  kmsKeyArn: text("kms_key_arn"),
  customerKmsEndpoint: text("customer_kms_endpoint"),
  vaultEndpoint: text("vault_endpoint"),
  vaultTlsCaCert: text("vault_tls_ca_cert"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Per-tenant encryption key lifecycle.
// public_key_x25519_b64: the agent holds only this to seal payloads.
// shred_at non-null = crypto-shred has been executed (POPIA s14 retention mechanism).
// See CANON section 6 and 008_DATA_MODEL section 8 for the crypto-shred mechanism.
export const tenantKeysTable = pgTable("tenant_keys", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  keyVersion: text("key_version").notNull(),
  publicKeyX25519B64: text("public_key_x25519_b64").notNull(),
  wrappedPrivateKeyB64: text("wrapped_private_key_b64"),
  kmsKeyId: text("kms_key_id"),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  shredAt: timestamp("shred_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Tenant = typeof tenantsTable.$inferSelect;
export type InsertTenant = typeof tenantsTable.$inferInsert;
export type KeyCustodyConfig = typeof keyCustodyConfigTable.$inferSelect;
export type InsertKeyCustodyConfig = typeof keyCustodyConfigTable.$inferInsert;
export type TenantKey = typeof tenantKeysTable.$inferSelect;
export type InsertTenantKey = typeof tenantKeysTable.$inferInsert;
