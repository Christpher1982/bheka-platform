// Canonical table: audit_log
// Per CANON section 9: every privileged endpoint writes here before returning.
// Per 008_DATA_MODEL section 6: immutable — UPDATE and DELETE are blocked by a
// PostgreSQL trigger (reject_audit_log_mutation) and withheld grants.
// Hash-chained: prev_hash and row_hash link consecutive rows for tamper detection.
// See rls-policies.sql for the trigger definition and grant restrictions.

import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

// Actor types for audit entries.
export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "user",
  "scim_client",
  "agent",
  "eride_support_engineer",
  "system",
]);

// audit_log has no updated_at — rows are never updated.
// tenant_id is nullable to accommodate system-level events (e.g. Eride support access).
// metadata must never contain evidence content or key material (API_STANDARD section 7).
export const auditLogTable = pgTable("audit_log", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id"),
  actorId: uuid("actor_id"),
  actorType: auditActorTypeEnum("actor_type").notNull(),
  // Verb.noun format: "user.provisioned", "case.opened", "evidence.viewed".
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  requestId: text("request_id"),
  metadata: jsonb("metadata"),
  prevHash: text("prev_hash"),
  rowHash: text("row_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
export type InsertAuditLog = typeof auditLogTable.$inferInsert;
