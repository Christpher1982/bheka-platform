// Development-only seed script for bheka-platform.
//
// Inserts:
//   - the 9 canonical roles (system-wide, per lib/db/src/schema/users.ts)
//   - 1 tenant ("Eride Technologies")
//   - 1 site under that tenant
//   - 1 admin user, assigned the tenant_owner and investigator roles
//   - 1 inactive OIDC config stub for the tenant (so tenant-slug resolution
//     in GET /api/v1/auth/login?tenant=... doesn't 404 before a real IdP is wired up)
//
// Idempotent — safe to re-run. Existing rows are matched on their unique keys
// and left untouched (roles, tenant) or skipped (site, user, role assignments, oidc config).
//
// Usage:
//   pnpm --filter @workspace/scripts run seed:dev
//
// Requires DATABASE_URL (already required by @workspace/db — see lib/db/src/index.ts).
//
// NOTE on role names: an earlier planning doc referenced a "system_admin" role.
// That value does not exist in the role_name enum. The canonical enum
// (lib/db/src/schema/users.ts) is: tenant_owner, security_administrator,
// investigator, case_approver, popia_information_officer, hr_partner, auditor,
// employee, eride_support_engineer. tenant_owner is the closest equivalent to
// a top-level admin and is what this script assigns, alongside investigator.

import { eq } from "drizzle-orm";
import {
  db,
  tenantsTable,
  sitesTable,
  rolesTable,
  usersTable,
  roleAssignmentsTable,
  oidcConfigTable,
} from "@workspace/db";

const TENANT_SLUG = "eride-technologies";
const TENANT_NAME = "Eride Technologies";
const ADMIN_EMAIL = "admin@eride-technologies.test";
const DEV_LOCAL_ORIGIN = "http://localhost:8080";

// Roles held by the seeded admin user.
const ADMIN_ROLES = ["tenant_owner", "investigator"] as const;

// Canonical role_name enum values (lib/db/src/schema/users.ts) — do not rename
// without an ADR, per that file's own comment.
const CANONICAL_ROLES = [
  {
    name: "tenant_owner" as const,
    displayName: "Tenant Owner",
    description:
      "Full administrative control over the tenant, including billing, key custody configuration, and role assignment.",
  },
  {
    name: "security_administrator" as const,
    displayName: "Security Administrator",
    description:
      "Manages endpoints, policies, and integrations. Cannot assign the tenant_owner role.",
  },
  {
    name: "investigator" as const,
    displayName: "Investigator",
    description:
      "Investigates detections and builds cases. Requires WebAuthn step-up to view evidence.",
  },
  {
    name: "case_approver" as const,
    displayName: "Case Approver",
    description:
      "Approves case escalations and evidence export requests. Subject to separation-of-duties checks against the requesting investigator.",
  },
  {
    name: "popia_information_officer" as const,
    displayName: "POPIA Information Officer",
    description:
      "Oversees data subject transparency requests and retention / crypto-shred compliance.",
  },
  {
    name: "hr_partner" as const,
    displayName: "HR Partner",
    description:
      "Coordinates with investigators on employee-related cases. Read access to case status, not raw evidence.",
  },
  {
    name: "auditor" as const,
    displayName: "Auditor",
    description: "Read-only access to the audit log across the tenant.",
  },
  {
    name: "employee" as const,
    displayName: "Employee",
    description:
      "Standard monitored user. Access limited to their own transparency portal.",
  },
  {
    name: "eride_support_engineer" as const,
    displayName: "Eride Support Engineer",
    description:
      "Eride staff support role for cross-tenant diagnostics. Heavily audited.",
  },
];

async function main() {
  console.log(`Seeding dev data for tenant "${TENANT_NAME}"...\n`);

  // 1. Roles — system-wide, not tenant-scoped.
  for (const role of CANONICAL_ROLES) {
    await db.insert(rolesTable).values(role).onConflictDoNothing({
      target: rolesTable.name,
    });
  }
  console.log(`  \u2713 ${CANONICAL_ROLES.length} canonical roles ensured`);

  // 2. Tenant.
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ slug: TENANT_SLUG, name: TENANT_NAME, displayName: TENANT_NAME })
    .onConflictDoUpdate({
      target: tenantsTable.slug,
      set: { name: TENANT_NAME, displayName: TENANT_NAME },
    })
    .returning();
  console.log(`  \u2713 Tenant "${tenant.name}" (${tenant.id})`);

  // 3. Site.
  const [existingSite] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.tenantId, tenant.id))
    .limit(1);
  const site =
    existingSite ??
    (
      await db
        .insert(sitesTable)
        .values({
          tenantId: tenant.id,
          name: "Head Office",
          description: "Default seeded site",
        })
        .returning()
    )[0];
  console.log(`  \u2713 Site "${site.name}" (${site.id})`);

  // 4. Admin user.
  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, ADMIN_EMAIL))
    .limit(1);
  const adminUser =
    existingUser ??
    (
      await db
        .insert(usersTable)
        .values({
          tenantId: tenant.id,
          email: ADMIN_EMAIL,
          givenName: "Dev",
          familyName: "Admin",
          provisionedVia: "manual",
        })
        .returning()
    )[0];
  console.log(`  \u2713 Admin user ${adminUser.email} (${adminUser.id})`);

  // 5. Role assignments: admin user -> tenant_owner + investigator.
  // investigator is granted alongside tenant_owner because POST /v1/cases is
  // gated by requireRole("security_administrator", "investigator") \u2014 without it
  // the seeded admin can't exercise case creation in the investigator console.
  for (const roleName of ADMIN_ROLES) {
    const [role] = await db
      .select()
      .from(rolesTable)
      .where(eq(rolesTable.name, roleName))
      .limit(1);
    await db
      .insert(roleAssignmentsTable)
      .values({
        tenantId: tenant.id,
        userId: adminUser.id,
        roleId: role.id,
      })
      .onConflictDoNothing({
        target: [
          roleAssignmentsTable.tenantId,
          roleAssignmentsTable.userId,
          roleAssignmentsTable.roleId,
        ],
      });
    console.log(`  \u2713 Role assignment: ${adminUser.email} -> ${roleName}`);
  }

  // 6. OIDC config stub — inactive until Phase 2 supplies real IdP values
  // (OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET). Its presence lets
  // GET /api/v1/auth/login?tenant=eride-technologies resolve the tenant instead
  // of 404ing; the OIDC flow itself won't complete until this row is activated
  // with real issuer/client values. Use POST /api/v1/auth/dev-login for local
  // testing in the meantime (NODE_ENV=development only).
  const [existingOidc] = await db
    .select()
    .from(oidcConfigTable)
    .where(eq(oidcConfigTable.tenantId, tenant.id))
    .limit(1);
  if (!existingOidc) {
    await db.insert(oidcConfigTable).values({
      tenantId: tenant.id,
      issuerUrl: "https://REPLACE_ME.example.com",
      clientId: "REPLACE_ME",
      clientSecretEnv: "OIDC_CLIENT_SECRET",
      redirectUri: `${DEV_LOCAL_ORIGIN}/api/v1/auth/callback`,
      scimEnabled: false,
      active: false,
    });
  }
  console.log(
    `  \u2713 OIDC config stub for tenant "${tenant.slug}" (inactive — replace with real IdP values in Phase 2)`,
  );

  console.log("\nDone.");
  console.log(`  Tenant slug:  ${tenant.slug}`);
  console.log(`  Admin email:  ${ADMIN_EMAIL}`);
  console.log(
    `  Dev login:    curl -i -X POST ${DEV_LOCAL_ORIGIN}/api/v1/auth/dev-login -H "Content-Type: application/json" -d '{"email":"${ADMIN_EMAIL}"}'`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
