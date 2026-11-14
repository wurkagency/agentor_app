-- Agentor Platform (M8), part 2: the platform audit log, case recipients and grant counts.

ALTER TABLE platform.audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_superadmin_read ON platform.audit FOR SELECT TO agentor_web USING (app.is_superadmin());
CREATE POLICY audit_staff_append ON platform.audit FOR INSERT TO agentor_web
  WITH CHECK (app.is_staff() AND actor_user_id = app.current_user_id());
GRANT SELECT, INSERT ON platform.audit TO agentor_web;
--> statement-breakpoint

-- "Løs sag og send forløb" (S8): the customer's users a staff member may send the case history to.
-- Only for a customer that has a case, and only names and e-mail addresses.
CREATE OR REPLACE FUNCTION app.platform_case_recipients(p_case_id uuid)
RETURNS TABLE (user_id uuid, name text, email text, role text)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  v_tenant uuid;
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  SELECT c.tenant_id INTO v_tenant FROM platform.cases c WHERE c.id = p_case_id;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  RETURN QUERY SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN auth.users u ON u.id = m.user_id
                ORDER BY (m.role = 'owner') DESC, (m.role = 'admin') DESC, u.name;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- "Aktive kundeadgange" per staff member (P6) and the total on P1.
CREATE OR REPLACE FUNCTION app.platform_active_grants()
RETURNS TABLE (staff_user_id uuid, tenant_id uuid, expires_at timestamptz)
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
    RETURN QUERY SELECT g.staff_user_id, g.tenant_id, g.expires_at FROM support_access_grants g
                  WHERE g.staff_user_id IS NOT NULL AND g.approved_at IS NOT NULL AND g.denied_at IS NULL
                    AND g.revoked_at IS NULL AND g.ended_at IS NULL AND g.expires_at > now();
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_case_recipients(uuid), app.platform_active_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_case_recipients(uuid), app.platform_active_grants() TO agentor_web;
