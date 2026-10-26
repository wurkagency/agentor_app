-- Flows, versions, runs, records and notifications (M6): RLS, flow ACL and privileges.

ALTER TABLE flow_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_versions      FORCE ROW LEVEL SECURITY;
ALTER TABLE runs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs               FORCE ROW LEVEL SECURITY;
ALTER TABLE run_records        ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_records        FORCE ROW LEVEL SECURITY;
ALTER TABLE record_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_links       FORCE ROW LEVEL SECURITY;
ALTER TABLE connection_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_lookups FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON flow_versions
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON runs
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON run_records
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON record_links
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON connection_lookups
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

-- Readers see status, runs and reconciliation but change nothing (D11-Team: Læser).
CREATE OR REPLACE FUNCTION app.can_edit_flows() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = app.current_user_id() AND m.role IN ('owner', 'admin', 'developer')
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.can_edit_flows() TO agentor_web;
--> statement-breakpoint

-- Web role, restrictive: per-flow access (flow grants) on everything that hangs off a flow,
-- and editing only for owners, admins and developers.
CREATE POLICY flows_edit_insert ON flows AS RESTRICTIVE FOR INSERT TO agentor_web
  WITH CHECK (app.can_edit_flows());
CREATE POLICY flows_edit_update ON flows AS RESTRICTIVE FOR UPDATE TO agentor_web
  USING (app.can_edit_flows()) WITH CHECK (app.can_edit_flows());
CREATE POLICY flows_edit_delete ON flows AS RESTRICTIVE FOR DELETE TO agentor_web
  USING (app.can_edit_flows());

CREATE POLICY flow_versions_acl ON flow_versions AS RESTRICTIVE TO agentor_web
  USING (app.has_flow_access(flow_id)) WITH CHECK (app.has_flow_access(flow_id));
CREATE POLICY flow_versions_edit_insert ON flow_versions AS RESTRICTIVE FOR INSERT TO agentor_web
  WITH CHECK (app.can_edit_flows());
-- Published versions are immutable: only the draft can be changed or discarded.
CREATE POLICY flow_versions_edit_update ON flow_versions AS RESTRICTIVE FOR UPDATE TO agentor_web
  USING (app.can_edit_flows() AND state = 'draft')
  WITH CHECK (app.can_edit_flows() AND state IN ('draft', 'published'));
CREATE POLICY flow_versions_edit_delete ON flow_versions AS RESTRICTIVE FOR DELETE TO agentor_web
  USING (app.can_edit_flows() AND state = 'draft');

CREATE POLICY runs_acl ON runs AS RESTRICTIVE TO agentor_web
  USING (app.has_flow_access(flow_id)) WITH CHECK (app.has_flow_access(flow_id));
CREATE POLICY runs_edit_insert ON runs AS RESTRICTIVE FOR INSERT TO agentor_web
  WITH CHECK (app.can_edit_flows());
CREATE POLICY run_records_acl ON run_records AS RESTRICTIVE TO agentor_web
  USING (app.has_flow_access(flow_id));

-- Notifications: each user sees and marks only their own.
CREATE POLICY notifications_own ON notifications AS RESTRICTIVE TO agentor_web
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON flow_versions TO agentor_web;
GRANT SELECT, INSERT ON runs TO agentor_web;
GRANT SELECT ON run_records, connection_lookups TO agentor_web;
GRANT SELECT, UPDATE (read_at, resolved_at) ON notifications TO agentor_web;
-- The engine and retention jobs.
GRANT SELECT, INSERT, UPDATE ON flow_versions TO agentor_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON runs, run_records, record_links, connection_lookups,
  notifications TO agentor_worker;
-- Flows may be read and updated by the worker (next_run_at, last_run_at), already granted.
