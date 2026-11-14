-- Superadmin opens any customer's app directly (decided by Charlie, 19 Oct 2026; replaces the
-- "no standing access, Superadmin included" part of README decision 16). It reuses the grant
-- machinery so every database check and the audit log work as for support: the grant is
-- approved at once, lasts 24 hours, and is marked `superadmin`. The customer gets no request
-- and no notification; the access and every action show in the customer's audit log only.
-- Supporters still need a case, a reason and (when the customer requires it) approval.

CREATE OR REPLACE FUNCTION app.platform_superadmin_open(p_tenant_id uuid, p_staff_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  v_grant uuid;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM 1 FROM tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT g.id INTO v_grant FROM support_access_grants g
   WHERE g.staff_user_id = app.current_user_id() AND g.superadmin
     AND g.ended_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > now() + interval '10 minutes'
   ORDER BY g.expires_at DESC LIMIT 1;
  IF v_grant IS NULL THEN
    INSERT INTO support_access_grants
      (tenant_id, case_ref, reason, support_name, staff_user_id, scope, hours, approved_at,
       expires_at, superadmin)
    VALUES (p_tenant_id, 'Superadmin', 'Superadmin', p_staff_name, app.current_user_id(), 'help', 24,
            now(), now() + interval '24 hours', true)
    RETURNING id INTO v_grant;
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
    VALUES (p_tenant_id, app.current_user_id(), 'support', p_staff_name, 'support.superadmin_opened',
            'support_access', v_grant, jsonb_build_object('scope', 'help', 'hours', 24));
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v_grant;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_superadmin_open(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_superadmin_open(uuid, text) TO agentor_web;
--> statement-breakpoint

-- Superadmin sees the customer's contact people at any time ("adgang til alt").
CREATE OR REPLACE FUNCTION app.platform_customer_contacts(p_tenant_id uuid)
RETURNS TABLE (role text, name text, email text)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  IF app.is_superadmin() OR app.support_scope() IS NOT NULL THEN
    RETURN QUERY SELECT m.role, u.name, u.email FROM memberships m JOIN auth.users u ON u.id = m.user_id
                  WHERE m.role IN ('owner', 'admin') ORDER BY m.role DESC, u.name;
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- The staff member's grants now say whether they were opened directly as Superadmin.
DROP FUNCTION app.platform_my_grants();
--> statement-breakpoint
CREATE FUNCTION app.platform_my_grants()
RETURNS TABLE (grant_id uuid, tenant_id uuid, tenant_name text, case_id uuid, case_ref text,
               scope text, state text, approved_by_name text, requested_at timestamptz,
               approved_at timestamptz, expires_at timestamptz, superadmin boolean)
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
             g.created_at, g.approved_at, g.expires_at, g.superadmin
        FROM support_access_grants g
       WHERE g.staff_user_id = app.current_user_id()
         AND g.created_at > now() - interval '30 days';
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_my_grants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_my_grants() TO agentor_web;
