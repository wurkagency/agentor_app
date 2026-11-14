-- Access to the identity schema and pre-tenant visibility (ADR 0004).

-- Only the web role (Better Auth runs in agentor-app) may touch auth.*.
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO agentor_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO agentor_web;
--> statement-breakpoint

-- Before a tenant is chosen (login, "Skift virksomhed"), a user may list their own
-- memberships and the tenants they belong to, and nothing else. As soon as a tenant context is
-- set, only tenant_isolation applies, so a shared (agency) user never sees another tenant.
CREATE POLICY own_memberships_without_tenant ON memberships FOR SELECT
  USING (app.current_tenant_id() IS NULL AND user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY own_tenants_without_tenant ON tenants FOR SELECT
  USING (
    app.current_tenant_id() IS NULL
    AND EXISTS (
      SELECT 1 FROM memberships m WHERE m.tenant_id = tenants.id AND m.user_id = app.current_user_id()
    )
  );
