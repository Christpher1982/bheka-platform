// Authentication implementation tables: oidc_config, webauthn_credentials
// These are not in the CANON 27 core tables but are required by GUIDE-01.
// oidc_config: per-tenant OIDC discovery and client configuration (GUIDE-01 section 3.2).
// webauthn_credentials: per-user passkeys for Tier 3 step-up (GUIDE-01 section 5).
// Both tables carry tenant_id and RLS (oidc_config via tenant_id, webauthn_credentials
// via user -> tenant join — enforced in the application layer for now).

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

// Per-tenant OIDC relying-party configuration.
// client_secret_arn: production secret reference in AWS Secrets Manager.
// client_secret_env: development-only env var name for the secret value.
// Only one of the two should be set per deployment.
// scim_bearer_token_hash: Argon2id hash of the tenant's SCIM provisioning bearer token.
export const oidcConfigTable = pgTable("oidc_config", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenantsTable.id)
    .unique(),
  issuerUrl: text("issuer_url").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretArn: text("client_secret_arn"),
  clientSecretEnv: text("client_secret_env"),
  redirectUri: text("redirect_uri").notNull(),
  scimEnabled: boolean("scim_enabled").notNull().default(false),
  scimBearerTokenHash: text("scim_bearer_token_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Per-user WebAuthn / passkey credentials.
// Required for Tier 3 evidence viewing and approval step-up (CANON section 9, GUIDE-01 section 5).
// credential_id: base64url-encoded authenticator credential ID.
// public_key: base64url-encoded COSE public key.
// sign_count: monotonically increasing counter for cloning detection.
export const webauthnCredentialsTable = pgTable("webauthn_credentials", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  signCount: integer("sign_count").notNull().default(0),
  aaguid: text("aaguid"),
  friendlyName: text("friendly_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type OidcConfig = typeof oidcConfigTable.$inferSelect;
export type InsertOidcConfig = typeof oidcConfigTable.$inferInsert;
export type WebauthnCredential = typeof webauthnCredentialsTable.$inferSelect;
export type InsertWebauthnCredential =
  typeof webauthnCredentialsTable.$inferInsert;
