// Canonical tables: roles, users, role_assignments
// Per CANON section 8: UUIDv7 IDs, timestamptz, snake_case, soft delete via deleted_at.
// Nine standing roles per 007_RBAC_AND_IDENTITY section 1 — system-wide, not per-tenant.
// role_assignments are tenant-scoped: user X holds role Y within tenant T.
// See 007_RBAC_AND_IDENTITY and 008_DATA_MODEL section 2 for narrative.

import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { tenantsTable } from "./tenants.js";

// Canonical role names per 007_RBAC_AND_IDENTITY section 1.
// Do not add or rename values without an ADR — role names are referenced by policy logic.
export const roleNameEnum = pgEnum("role_name", [
  "tenant_owner",
  "security_administrator",
  "investigator",
  "case_approver",
  "popia_information_officer",
  "hr_partner",
  "auditor",
  "employee",
  "eride_support_engineer",
]);

// System-defined roles. Not tenant-scoped. Seeded at bootstrap.
// Permissions are enforced in middleware, not stored here (007_RBAC_AND_IDENTITY section 2).
export const rolesTable = pgTable("roles", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  name: roleNameEnum("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Users within a tenant. Covers both admin/security users and monitored employees.
// Employees (data subjects) use this for the transparency portal (CANON section 16).
// manager_id is self-referential: used by reporting-line separation-of-duties checks
// in 007_RBAC_AND_IDENTITY section 5.3.
export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    email: text("email").notNull(),
    givenName: text("given_name"),
    familyName: text("family_name"),
    // IdP subject claim (OIDC sub) or SCIM externalId.
    externalId: text("external_id"),
    // Provisioning channel: oidc (JIT), scim, or manual.
    provisionedVia: text("provisioned_via").notNull().default("manual"),
    // Self-referential for reporting-line SOD checks (007_RBAC section 5.3).
    managerId: uuid("manager_id"),
    // True once the user has enrolled at least one WebAuthn authenticator.
    // Required before Tier 3 actions can be taken (007_RBAC section 6).
    webauthnEnrolled: boolean("webauthn_enrolled").notNull().default(false),
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
  (t) => [unique("users_tenant_email_unique").on(t.tenantId, t.email)],
);

// Binds a user to a role within a tenant scope.
// A tenant owner may assign multiple roles to one person, subject to SOD rules
// enforced at the application layer (007_RBAC_AND_IDENTITY section 5).
export const roleAssignmentsTable = pgTable(
  "role_assignments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id),
    assignedBy: uuid("assigned_by"),
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
    unique("role_assignments_user_role_unique").on(
      t.tenantId,
      t.userId,
      t.roleId,
    ),
  ],
);

export type Role = typeof rolesTable.$inferSelect;
export type InsertRole = typeof rolesTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
export type RoleAssignment = typeof roleAssignmentsTable.$inferSelect;
export type InsertRoleAssignment = typeof roleAssignmentsTable.$inferInsert;
