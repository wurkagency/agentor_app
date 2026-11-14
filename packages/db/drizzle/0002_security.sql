-- Row-Level Security, grants and security functions (produktspecifikation §9.1–§9.2, §10.3).
--
-- Rules enforced here and verified by scripts/check-rls.ts and the isolation suite:
--   * every table in public is a tenant table with ENABLE + FORCE RLS, unless listed as
--     global in src/tables.ts (plans, plan_entitlements: read-only for runtime roles);
--   * tenant policies compare tenant_id to app.current_tenant_id() in USING and WITH CHECK;
--   * runtime roles own nothing and never get BYPASSRLS;
--   * agentor_web cannot SELECT connection_secrets or tenant_keys.

-- Schema access ------------------------------------------------------------------------
-- New functions are not executable by PUBLIC by default; every grant below is explicit.
ALTER DEFAULT PRIVILEGES FOR ROLE agentor_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO agentor_web, agentor_worker, agentor_readonly_ops;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO agentor_web, agentor_worker;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.current_tenant_id(), app.current_user_id()
  TO agentor_web, agentor_worker;
--> statement-breakpoint

-- Enable and force RLS on every tenant table ----------------------------------------------
ALTER TABLE tenants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants            FORCE ROW LEVEL SECURITY;
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships        FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          FORCE ROW LEVEL SECURITY;
ALTER TABLE flows              ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows              FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_grants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_grants        FORCE ROW LEVEL SECURITY;
ALTER TABLE connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections        FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_keys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_keys        FORCE ROW LEVEL SECURITY;
ALTER TABLE connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_secrets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Tenant isolation policies ----------------------------------------------------------------
CREATE POLICY tenant_isolation ON tenants
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_log FOR SELECT
  USING (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation_insert ON audit_log FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON flows
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON flow_grants
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON connections
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_keys
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation ON connection_secrets
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

-- Users: global identity, visible only to yourself and to members of the current tenant.
CREATE POLICY users_visible ON users FOR SELECT
  USING (
    id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)
  );
--> statement-breakpoint
CREATE POLICY users_self_insert ON users FOR INSERT
  WITH CHECK (id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY users_self_update ON users FOR UPDATE
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());
--> statement-breakpoint

-- Per-flow access (produktspecifikation §6, §9.1) --------------------------------------------
-- Evaluated as the calling role, so memberships and flow_grants are already tenant-filtered.
CREATE OR REPLACE FUNCTION app.is_tenant_admin() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = app.current_user_id() AND m.role IN ('owner', 'admin')
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.has_flow_access(p_flow_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = app.current_user_id()
      AND (
        m.role IN ('owner', 'admin')
        OR m.flow_scope = 'all'
        OR EXISTS (
          SELECT 1 FROM flow_grants g
          WHERE g.membership_id = m.id
            AND g.flow_id = p_flow_id
            AND (g.expires_at IS NULL OR g.expires_at > now())
        )
      )
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_tenant_admin(), app.has_flow_access(uuid) TO agentor_web;
--> statement-breakpoint

-- Restrictive: applies on top of tenant_isolation, only for the user-facing web role.
-- Workers act on behalf of the tenant, not a user, so they are not limited by flow grants.
-- New flows: has_flow_access() is false for 'selected' users, so they can't create flows.
CREATE POLICY flow_acl ON flows AS RESTRICTIVE TO agentor_web
  USING (app.has_flow_access(id))
  WITH CHECK (app.has_flow_access(id));
--> statement-breakpoint
CREATE POLICY flow_grants_acl ON flow_grants AS RESTRICTIVE TO agentor_web
  USING (
    app.is_tenant_admin()
    OR membership_id IN (SELECT m.id FROM memberships m WHERE m.user_id = app.current_user_id())
  )
  WITH CHECK (app.is_tenant_admin());
--> statement-breakpoint

-- Table privileges ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON tenants TO agentor_web, agentor_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users TO agentor_web;
--> statement-breakpoint
GRANT SELECT ON users TO agentor_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships, flows, flow_grants, connections
  TO agentor_web, agentor_worker;
--> statement-breakpoint
-- Audit log is append-only for every runtime role (retention purge comes as an owner function).
GRANT SELECT, INSERT ON audit_log TO agentor_web, agentor_worker;
--> statement-breakpoint
-- Key box: only the worker can read keys and secrets.
GRANT SELECT, INSERT, UPDATE ON tenant_keys TO agentor_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON connection_secrets TO agentor_worker;
--> statement-breakpoint
-- Global, read-only catalogue.
GRANT SELECT ON plans, plan_entitlements TO agentor_web, agentor_worker, agentor_readonly_ops;
--> statement-breakpoint

-- Insert-only path for the web role (produktspecifikation §9.2) ---------------------------------
-- SECURITY DEFINER runs as agentor_owner, which is still subject to FORCE RLS, so the row can
-- only land in the caller's current tenant. It never returns anything.
CREATE OR REPLACE FUNCTION app.insert_connection_secret(
  p_connection_id uuid,
  p_format text,
  p_key_id uuid,
  p_nonce bytea,
  p_ciphertext bytea
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'tenant context missing' USING ERRCODE = '42501';
  END IF;
  INSERT INTO connection_secrets (tenant_id, connection_id, format, key_id, nonce, ciphertext)
  VALUES (app.current_tenant_id(), p_connection_id, p_format, p_key_id, p_nonce, p_ciphertext);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.insert_connection_secret(uuid, text, uuid, bytea, bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.insert_connection_secret(uuid, text, uuid, bytea, bytea)
  TO agentor_web, agentor_worker;
