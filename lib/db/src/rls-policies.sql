-- Row Level Security policies for Bheka PostgreSQL database.
-- Per CANON section 8: all tenant-scoped tables enforce RLS via current_tenant_id().
-- Per 008_DATA_MODEL section 10: queries that do not set tenant context return zero rows.
-- Per 008_DATA_MODEL section 6: audit_log is immutable — mutation trigger below.
--
-- Apply this file ONCE after schema push:
--   psql $DATABASE_URL -f lib/db/src/rls-policies.sql
--
-- The application sets tenant context per-transaction:
--   SELECT set_config('app.current_tenant_id', '<uuid>', true);
-- withTenantContext() in lib/tenant-context.ts wraps every DB operation with this.

-- ============================================================
-- Application role (used for RLS policies)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bheka_app') THEN
    CREATE ROLE bheka_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bheka_migrator') THEN
    CREATE ROLE bheka_migrator;
  END IF;
END
$$;

-- Helper function: returns the current tenant ID from session GUC.
-- Returns NULL (not an error) when no tenant context is set.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT current_setting('app.current_tenant_id', true)::uuid;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- tenants: each row is its own "tenant" — RLS allows a session
-- to see only the row whose id matches the current tenant context.
-- ============================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (id = current_tenant_id());

-- ============================================================
-- key_custody_config
-- ============================================================
ALTER TABLE key_custody_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_custody_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS key_custody_config_isolation ON key_custody_config;
CREATE POLICY key_custody_config_isolation ON key_custody_config
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- tenant_keys
-- ============================================================
ALTER TABLE tenant_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_keys_isolation ON tenant_keys;
CREATE POLICY tenant_keys_isolation ON tenant_keys
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- sites
-- ============================================================
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_isolation ON sites;
CREATE POLICY sites_isolation ON sites
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- users
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_isolation ON users;
CREATE POLICY users_isolation ON users
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- role_assignments
-- ============================================================
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_assignments_isolation ON role_assignments;
CREATE POLICY role_assignments_isolation ON role_assignments
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- oidc_config
-- ============================================================
ALTER TABLE oidc_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE oidc_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oidc_config_isolation ON oidc_config;
CREATE POLICY oidc_config_isolation ON oidc_config
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- audit_log: tenant-scoped RLS + immutability trigger.
-- Per 008_DATA_MODEL section 6: mutation is blocked at two layers.
-- ============================================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_isolation ON audit_log;
CREATE POLICY audit_log_isolation ON audit_log
  AS PERMISSIVE FOR ALL TO bheka_app
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL);

-- Immutability trigger: rejects UPDATE and DELETE on audit_log.
CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows are immutable — UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_mutation ON audit_log;
CREATE TRIGGER audit_log_no_mutation
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

-- ============================================================
-- updated_at auto-trigger (applied to every table that has the column)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- roles: system table, no RLS (not tenant-scoped).
-- Grant SELECT to bheka_app; no INSERT/UPDATE from app layer (seed-only).
-- ============================================================
GRANT SELECT ON roles TO bheka_app;

-- ============================================================
-- Seed: nine canonical roles per 007_RBAC_AND_IDENTITY section 1.
-- ============================================================
-- UUIDs generated via gen_random_uuid() because $defaultFn is a Drizzle layer
-- construct and does not produce a PostgreSQL column default.
INSERT INTO roles (id, name, display_name, description) VALUES
  (gen_random_uuid(), 'tenant_owner',              'Tenant Owner',              'Commercial and billing owner. Manages tenant config, key custody tier, and user provisioning.'),
  (gen_random_uuid(), 'security_administrator',    'Security Administrator',    'Configures policies, detection rules, integrations, and enrolment. Opens cases.'),
  (gen_random_uuid(), 'investigator',              'Investigator',              'Works assigned cases. Requests evidence access. Can request Tier 3 escalation as requester.'),
  (gen_random_uuid(), 'case_approver',             'Case Approver',             'Authorised to serve as second approver for Tier 3 activation alongside an Information Officer.'),
  (gen_random_uuid(), 'popia_information_officer', 'POPIA Information Officer', 'POPIA s55 duties. Required second approver for every Tier 3 activation and evidence access grant.'),
  (gen_random_uuid(), 'hr_partner',                'HR Partner',                'Read access to case outcomes and Tier 1/2 evidence relevant to an open disciplinary process.'),
  (gen_random_uuid(), 'auditor',                   'Auditor',                   'Read-only access to audit_log, approvals, evidence_access_grants, transparency_notices, data_subject_requests.'),
  (gen_random_uuid(), 'employee',                  'Employee',                  'Data subject. Receives transparency notices and submits data subject access requests.'),
  (gen_random_uuid(), 'eride_support_engineer',    'Eride Support Engineer',    'Eride-side break-glass access. No standing evidence-view or key-unwrap capability.')
ON CONFLICT (name) DO NOTHING;
