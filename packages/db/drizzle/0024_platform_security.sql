-- Agentor Platform (M8, README decisions 16–17): staff roles, support access in the customer's
-- app, support cases and time. Rules (produktspecifikation §9.7): no standing access to customer
-- data, not even for Superadmin; access per case with a reason, at most 24 hours, approved by the
-- customer when they require it; never keys, team or subscription; every action in the
-- customer's audit log with the staff member's name.

-- Schema and privileges ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO agentor_web, agentor_worker;
GRANT USAGE ON SEQUENCE platform.case_number_seq TO agentor_web;
CREATE UNIQUE INDEX cases_number_key ON platform.cases (number);
--> statement-breakpoint

-- Private indexes the definer functions can read across tenants -------------------------------------
-- FORCE RLS applies to the table owner too, so cross-tenant reads go through small private
-- indexes kept current by triggers (the same pattern as app.billing_schedule).
CREATE TABLE app.tenant_directory (
  tenant_id uuid PRIMARY KEY,
  name text NOT NULL,
  cvr text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.flow_schedule (
  flow_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  next_run_at timestamptz,
  active boolean NOT NULL
);
CREATE INDEX flow_schedule_due_idx ON app.flow_schedule (next_run_at) WHERE active;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_tenant_directory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.tenant_directory WHERE tenant_id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO app.tenant_directory (tenant_id, name, cvr, created_at)
  VALUES (NEW.id, NEW.name, NEW.cvr, NEW.created_at)
  ON CONFLICT (tenant_id) DO UPDATE SET name = excluded.name, cvr = excluded.cvr;
  RETURN NEW;
END
$$;
CREATE TRIGGER tenants_directory AFTER INSERT OR UPDATE OR DELETE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.sync_tenant_directory();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_flow_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.flow_schedule WHERE flow_id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO app.flow_schedule (flow_id, tenant_id, next_run_at, active)
  VALUES (NEW.id, NEW.tenant_id, NEW.next_run_at,
          NEW.published_version_id IS NOT NULL AND NEW.paused_at IS NULL)
  ON CONFLICT (flow_id) DO UPDATE SET next_run_at = excluded.next_run_at, active = excluded.active;
  RETURN NEW;
END
$$;
CREATE TRIGGER flows_schedule AFTER INSERT OR UPDATE OR DELETE ON flows
  FOR EACH ROW EXECUTE FUNCTION app.sync_flow_schedule();
--> statement-breakpoint
-- Backfill: the migration runs as the owner, which FORCE RLS would otherwise hide all rows from.
ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE flows NO FORCE ROW LEVEL SECURITY;
INSERT INTO app.tenant_directory (tenant_id, name, cvr, created_at)
  SELECT id, name, cvr, created_at FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO app.flow_schedule (flow_id, tenant_id, next_run_at, active)
  SELECT id, tenant_id, next_run_at, published_version_id IS NOT NULL AND paused_at IS NULL FROM flows
  ON CONFLICT DO NOTHING;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE flows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Scheduled polls: due_flows read flows directly and so saw nothing under FORCE RLS.
CREATE OR REPLACE FUNCTION app.due_flows(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, flow_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT s.tenant_id, s.flow_id FROM app.flow_schedule s
   WHERE s.active AND (s.next_run_at IS NULL OR s.next_run_at <= p_now)
   ORDER BY s.next_run_at NULLS FIRST
   LIMIT 500
$$;
--> statement-breakpoint
REVOKE ALL ON app.tenant_directory, app.flow_schedule FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.sync_tenant_directory(), app.sync_flow_schedule() FROM PUBLIC;
--> statement-breakpoint

-- Staff -----------------------------------------------------------------------------------------
-- Owner-only reads (no FORCE on platform tables): these definer functions see the staff table,
-- the web role sees it only through the policies below.
CREATE OR REPLACE FUNCTION app.staff_role() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT s.role FROM platform.staff s
   WHERE s.user_id = app.current_user_id() AND s.disabled_at IS NULL
$$;
CREATE OR REPLACE FUNCTION app.is_staff() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT app.staff_role() IS NOT NULL $$;
CREATE OR REPLACE FUNCTION app.is_superadmin() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$ SELECT coalesce(app.staff_role() = 'superadmin', false) $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.staff_role(), app.is_staff(), app.is_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.staff_role(), app.is_staff(), app.is_superadmin() TO agentor_web, agentor_worker;
--> statement-breakpoint

-- Support scope in the customer's tenant ------------------------------------------------------------
-- An approved, unexpired, unended grant for this staff member in the current tenant. 'help'
-- edits flows like an Admin; 'view' only reads. Never connections, team, billing or settings.
CREATE OR REPLACE FUNCTION app.support_scope() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT g.scope FROM support_access_grants g
   WHERE g.tenant_id = app.current_tenant_id()
     AND g.staff_user_id = app.current_user_id()
     AND g.approved_at IS NOT NULL AND g.denied_at IS NULL AND g.revoked_at IS NULL
     AND g.ended_at IS NULL AND g.expires_at > now()
     AND app.is_staff()
   ORDER BY (g.scope = 'help') DESC
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION app.support_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.support_scope() TO agentor_web;
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
  ) OR app.support_scope() IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION app.can_edit_flows() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = app.current_user_id() AND m.role IN ('owner', 'admin', 'developer')
  ) OR coalesce(app.support_scope() = 'help', false)
$$;
--> statement-breakpoint

-- Support grants from the platform side -------------------------------------------------------------
-- Staff create, list and end their own grants through these; the table stays admin-only for
-- the web role inside a tenant (support_grants_admin).
CREATE OR REPLACE FUNCTION app.platform_request_access(
  p_tenant_id uuid,
  p_staff_name text,
  p_case_id uuid,
  p_case_ref text,
  p_reason text,
  p_hours integer,
  p_scope text
) RETURNS TABLE (grant_id uuid, auto_approved boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  v_requires boolean;
  v_grant uuid;
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  IF p_hours NOT IN (1, 8, 24) THEN RAISE EXCEPTION 'SUPPORT_HOURS' USING ERRCODE = '22023'; END IF;
  IF p_scope NOT IN ('view', 'help') THEN RAISE EXCEPTION 'SUPPORT_SCOPE' USING ERRCODE = '22023'; END IF;
  IF coalesce(trim(p_reason), '') = '' OR coalesce(trim(p_case_ref), '') = '' THEN
    RAISE EXCEPTION 'SUPPORT_CASE_AND_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  SELECT support_requires_approval INTO v_requires FROM tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO support_access_grants
    (tenant_id, case_ref, reason, support_name, staff_user_id, case_id, scope, hours,
     approved_at, expires_at)
  VALUES (p_tenant_id, p_case_ref, trim(p_reason), p_staff_name, app.current_user_id(), p_case_id,
          p_scope, p_hours, CASE WHEN v_requires THEN NULL ELSE now() END,
          now() + make_interval(hours => p_hours))
  RETURNING id INTO v_grant;
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (p_tenant_id, app.current_user_id(), 'support', p_staff_name, 'support.requested',
          'support_access', v_grant,
          jsonb_build_object('caseRef', p_case_ref, 'reason', trim(p_reason), 'hours', p_hours,
                             'scope', p_scope, 'autoApproved', NOT v_requires));
  -- Owners and admins hear about it at once and can approve from the bell or Sikkerhed.
  INSERT INTO notifications (tenant_id, user_id, event, needs_action, message_key, params, href)
  SELECT p_tenant_id, m.user_id, 'support_requested', v_requires,
         CASE WHEN v_requires THEN 'supportRequested' ELSE 'supportOpened' END,
         jsonb_build_object('name', p_staff_name, 'hours', p_hours, 'reason', trim(p_reason)),
         '/settings/security#support'
    FROM memberships m WHERE m.role IN ('owner', 'admin');
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN QUERY SELECT v_grant, NOT v_requires;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.platform_end_access(p_tenant_id uuid, p_grant_id uuid, p_staff_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE support_access_grants SET ended_at = now()
   WHERE id = p_grant_id AND staff_user_id = app.current_user_id() AND ended_at IS NULL;
  IF FOUND THEN
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id)
    VALUES (p_tenant_id, app.current_user_id(), 'support', p_staff_name, 'support.ended',
            'support_access', p_grant_id);
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.platform_request_extension(p_tenant_id uuid, p_grant_id uuid, p_staff_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE support_access_grants SET extension_requested_at = now()
   WHERE id = p_grant_id AND staff_user_id = app.current_user_id() AND ended_at IS NULL;
  IF FOUND THEN
    INSERT INTO notifications (tenant_id, user_id, event, needs_action, message_key, params, href)
    SELECT p_tenant_id, m.user_id, 'support_requested', true, 'supportExtension',
           jsonb_build_object('name', p_staff_name), '/settings/security#support'
      FROM memberships m WHERE m.role IN ('owner', 'admin');
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- The staff member's own grants across customers (P1 "Mine adgange", P5 switcher).
CREATE OR REPLACE FUNCTION app.platform_my_grants()
RETURNS TABLE (grant_id uuid, tenant_id uuid, tenant_name text, case_id uuid, case_ref text,
               scope text, state text, approved_by_name text, requested_at timestamptz,
               approved_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT d.tenant_id, d.name FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY
      SELECT g.id, g.tenant_id, t.name, g.case_id, g.case_ref, g.scope,
             CASE
               WHEN g.denied_at IS NOT NULL THEN 'denied'
               WHEN g.revoked_at IS NOT NULL THEN 'revoked'
               WHEN g.ended_at IS NOT NULL THEN 'ended'
               WHEN g.expires_at <= now() THEN 'expired'
               WHEN g.approved_at IS NULL THEN 'pending'
               ELSE 'active'
             END,
             (SELECT u.name FROM auth.users u WHERE u.id = g.approved_by),
             g.created_at, g.approved_at, g.expires_at
        FROM support_access_grants g
       WHERE g.staff_user_id = app.current_user_id()
         AND g.created_at > now() - interval '30 days';
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- Customer list (P1): name, CVR, plan and counts only, never records -----------------------------------
CREATE OR REPLACE FUNCTION app.platform_customers()
RETURNS TABLE (tenant_id uuid, name text, cvr text, plan_id text, created_at timestamptz,
               flows integer, paused_flows integer, broken_connections integer,
               open_failures integer, errors_today integer, last_run_at timestamptz,
               active_grants integer, requires_approval boolean)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT * FROM app.tenant_directory d ORDER BY d.name LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY SELECT
      t.tenant_id, t.name, t.cvr,
      (SELECT s.plan_id FROM subscriptions s LIMIT 1),
      t.created_at,
      (SELECT count(*)::int FROM flows),
      (SELECT count(*)::int FROM flows f WHERE f.paused_at IS NOT NULL),
      (SELECT count(*)::int FROM connections c WHERE c.status = 'broken'),
      (SELECT count(*)::int FROM run_records r WHERE r.outcome = 'failed' AND r.resolved_at IS NULL),
      (SELECT count(*)::int FROM run_records r
        WHERE r.outcome = 'failed' AND r.created_at >= date_trunc('day', now())),
      (SELECT max(f.last_run_at) FROM flows f),
      (SELECT count(*)::int FROM support_access_grants g
        WHERE g.approved_at IS NOT NULL AND g.ended_at IS NULL AND g.revoked_at IS NULL
          AND g.expires_at > now()),
      (SELECT tn.support_requires_approval FROM tenants tn WHERE tn.id = t.tenant_id);
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- The customer's contact people and plan for the customer page (P2): only while the staff member
-- holds an active grant there.
CREATE OR REPLACE FUNCTION app.platform_customer_contacts(p_tenant_id uuid)
RETURNS TABLE (role text, name text, email text)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  IF app.support_scope() IS NOT NULL THEN
    RETURN QUERY SELECT m.role, u.name, u.email FROM memberships m JOIN auth.users u ON u.id = m.user_id
                  WHERE m.role IN ('owner', 'admin') ORDER BY m.role DESC, u.name;
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- Adgangslog (P2): support activity in the customer's audit log. Staff names and actions only.
CREATE OR REPLACE FUNCTION app.platform_access_log(p_tenant_id uuid)
RETURNS TABLE (at timestamptz, actor_name text, actor_kind text, action text, after jsonb)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  RETURN QUERY SELECT a.created_at, a.actor_name, a.actor_kind, a.action, a.after FROM audit_log a
                WHERE a.action LIKE 'support.%' OR a.actor_kind = 'support'
                ORDER BY a.created_at DESC LIMIT 100;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- Fejl på tværs (S7): failures grouped by error code and destination system. Counts only.
CREATE OR REPLACE FUNCTION app.platform_error_codes(p_since timestamptz)
RETURNS TABLE (error_code text, connector_id text, tenant_id uuid, records integer,
               first_seen timestamptz, last_seen timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT d.tenant_id FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY
      SELECT r.error_code, coalesce(c.connector_id, '–'), t.tenant_id, count(*)::int,
             min(r.created_at), max(r.created_at)
        FROM run_records r
        JOIN runs ru ON ru.id = r.run_id
        JOIN flow_versions v ON v.id = ru.version_id
        LEFT JOIN LATERAL (
          SELECT n->>'connectionId' AS connection_id
            FROM jsonb_array_elements(v.definition->'routes') rt
            JOIN jsonb_array_elements(v.definition->'nodes') n ON n->>'id' = rt->>'to'
           WHERE rt->>'id' = r.route_id LIMIT 1
        ) dest ON true
        LEFT JOIN connections c ON c.id::text = dest.connection_id
       WHERE r.outcome = 'failed' AND r.error_code IS NOT NULL AND r.created_at >= p_since
         AND ru.kind <> 'test'
       GROUP BY r.error_code, c.connector_id;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION
  app.platform_request_access(uuid, text, uuid, text, text, integer, text),
  app.platform_end_access(uuid, uuid, text), app.platform_request_extension(uuid, uuid, text),
  app.platform_my_grants(), app.platform_customers(), app.platform_customer_contacts(uuid),
  app.platform_access_log(uuid), app.platform_error_codes(timestamptz)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.platform_request_access(uuid, text, uuid, text, text, integer, text),
  app.platform_end_access(uuid, uuid, text), app.platform_request_extension(uuid, uuid, text),
  app.platform_my_grants(), app.platform_customers(), app.platform_customer_contacts(uuid),
  app.platform_access_log(uuid), app.platform_error_codes(timestamptz)
TO agentor_web;
--> statement-breakpoint

-- Platform tables: RLS for the web role ------------------------------------------------------------
-- Not FORCEd: the owner (definer functions above) reads them; the web role always goes through
-- these policies. Staff see platform data; customers see only their own cases and the
-- customer-facing part of the timeline.
ALTER TABLE platform.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.timers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_read ON platform.staff FOR SELECT TO agentor_web USING (app.is_staff());
CREATE POLICY staff_superadmin ON platform.staff FOR ALL TO agentor_web
  USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());
CREATE POLICY settings_read ON platform.settings FOR SELECT TO agentor_web USING (app.is_staff());
CREATE POLICY settings_superadmin ON platform.settings FOR ALL TO agentor_web
  USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());
CREATE POLICY settings_worker ON platform.settings FOR SELECT TO agentor_worker USING (true);
--> statement-breakpoint
-- A member of the customer (any role) sees and opens the customer's cases.
CREATE OR REPLACE FUNCTION app.is_member_of(p_tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT p_tenant_id = app.current_tenant_id()
     AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = app.current_user_id())
$$;
GRANT EXECUTE ON FUNCTION app.is_member_of(uuid) TO agentor_web;
--> statement-breakpoint
CREATE POLICY cases_staff ON platform.cases FOR ALL TO agentor_web
  USING (app.is_staff()) WITH CHECK (app.is_staff());
CREATE POLICY cases_customer_read ON platform.cases FOR SELECT TO agentor_web
  USING (app.is_member_of(tenant_id));
CREATE POLICY cases_customer_open ON platform.cases FOR INSERT TO agentor_web
  WITH CHECK (app.is_member_of(tenant_id) AND status = 'new' AND created_by_user_id = app.current_user_id()
              AND created_via = 'customer' AND assignee_id IS NULL);
CREATE POLICY case_events_staff ON platform.case_events FOR ALL TO agentor_web
  USING (app.is_staff()) WITH CHECK (app.is_staff());
CREATE POLICY case_events_customer_read ON platform.case_events FOR SELECT TO agentor_web
  USING (app.is_member_of(tenant_id) AND kind IN ('customer_message', 'reply', 'status'));
CREATE POLICY case_events_customer_write ON platform.case_events FOR INSERT TO agentor_web
  WITH CHECK (app.is_member_of(tenant_id) AND kind = 'customer_message'
              AND author_user_id = app.current_user_id()
              AND EXISTS (SELECT 1 FROM platform.cases c WHERE c.id = case_id AND c.tenant_id = case_events.tenant_id));
CREATE POLICY case_followers_staff ON platform.case_followers FOR ALL TO agentor_web
  USING (app.is_staff()) WITH CHECK (app.is_staff());
CREATE POLICY customer_notes_staff ON platform.customer_notes FOR ALL TO agentor_web
  USING (app.is_staff()) WITH CHECK (app.is_staff());
CREATE POLICY support_sessions_own ON platform.support_sessions FOR ALL TO agentor_web
  USING (app.is_staff() AND (staff_user_id = app.current_user_id() OR app.is_superadmin()))
  WITH CHECK (app.is_staff() AND staff_user_id = app.current_user_id());
CREATE POLICY time_entries_staff_read ON platform.time_entries FOR SELECT TO agentor_web USING (app.is_staff());
CREATE POLICY time_entries_own_write ON platform.time_entries FOR INSERT TO agentor_web
  WITH CHECK (app.is_staff() AND staff_user_id = app.current_user_id());
CREATE POLICY time_entries_own_change ON platform.time_entries FOR UPDATE TO agentor_web
  USING (app.is_staff() AND staff_user_id = app.current_user_id() AND invoice_id IS NULL)
  WITH CHECK (app.is_staff() AND staff_user_id = app.current_user_id() AND invoice_id IS NULL);
CREATE POLICY time_entries_own_delete ON platform.time_entries FOR DELETE TO agentor_web
  USING (app.is_staff() AND staff_user_id = app.current_user_id() AND invoice_id IS NULL);
-- The worker bills a customer's billable time on its invoice, inside that customer's context.
CREATE POLICY time_entries_worker ON platform.time_entries FOR ALL TO agentor_worker
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY timers_own ON platform.timers FOR ALL TO agentor_web
  USING (app.is_staff() AND staff_user_id = app.current_user_id())
  WITH CHECK (app.is_staff() AND staff_user_id = app.current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.staff, platform.settings, platform.case_followers,
  platform.customer_notes, platform.support_sessions, platform.time_entries, platform.timers
  TO agentor_web;
GRANT SELECT, INSERT, UPDATE ON platform.cases, platform.case_events TO agentor_web;
GRANT SELECT ON platform.settings TO agentor_worker;
GRANT SELECT, UPDATE ON platform.time_entries TO agentor_worker;
--> statement-breakpoint
-- A customer's message reopens a waiting case, or a resolved one within 14 days (S8).
CREATE OR REPLACE FUNCTION app.case_customer_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind = 'customer_message' THEN
    UPDATE platform.cases SET status = 'in_progress', updated_at = now(), resolved_at = NULL
     WHERE id = NEW.case_id
       AND (status = 'waiting' OR (status = 'resolved' AND resolved_at > now() - interval '14 days'));
    UPDATE platform.cases SET updated_at = now() WHERE id = NEW.case_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER case_events_customer AFTER INSERT ON platform.case_events
  FOR EACH ROW EXECUTE FUNCTION app.case_customer_message();
REVOKE EXECUTE ON FUNCTION app.case_customer_message() FROM PUBLIC;
--> statement-breakpoint
-- Support grants carry the case and scope; the customer's approval stays with owners and admins.
ALTER TABLE support_access_grants ADD CONSTRAINT support_grant_scope_check CHECK (scope IN ('view', 'help'));
ALTER TABLE support_access_grants ADD CONSTRAINT support_grant_hours_check CHECK (hours BETWEEN 1 AND 24);
