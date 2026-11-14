-- Agentor Platform sitemap v2 (README decision 24, PLAN-2026-10-21 M1). PostgreSQL 12 compatible.

-- Support › Fejl (S7) with a from/to period: failures per error code and destination system in
-- [p_from, p_to), and the same counts in the window before it [p_prev_from, p_from) for the trend.
-- Counts only, never customer data.
CREATE OR REPLACE FUNCTION app.platform_error_codes_range(p_prev_from timestamptz, p_from timestamptz,
                                                          p_to timestamptz)
RETURNS TABLE (error_code text, connector_id text, tenant_id uuid, records_now integer,
               records_prev integer, first_seen timestamptz, last_seen timestamptz)
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
      SELECT r.error_code, coalesce(c.connector_id, '–'), t.tenant_id,
             (count(*) FILTER (WHERE r.created_at >= p_from))::int,
             (count(*) FILTER (WHERE r.created_at < p_from))::int,
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
       WHERE r.outcome = 'failed' AND r.error_code IS NOT NULL
         AND r.created_at >= p_prev_from AND r.created_at < p_to
         AND ru.kind <> 'test'
       GROUP BY r.error_code, c.connector_id;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- Support › Adgange (S9, MP24): every staff member's grants from the last 60 days, so the page can
-- show Mine/Alle and compare 30 days with the 30 before. Superadmin's direct openings are only
-- listed for Superadmin themselves. The action count is the support actions in the customer's
-- audit log during the grant ("4 · Se log"); no customer data beyond the names already on P1/P2.
CREATE OR REPLACE FUNCTION app.platform_grants()
RETURNS TABLE (grant_id uuid, tenant_id uuid, tenant_name text, tenant_cvr text,
               staff_user_id uuid, staff_name text, case_id uuid, case_ref text,
               case_number integer, case_title text, scope text, state text,
               approved_by_name text, requested_at timestamptz, approved_at timestamptz,
               expires_at timestamptz, closed_at timestamptz, extension_requested_at timestamptz,
               actions integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT d.tenant_id, d.name, d.cvr FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY
      SELECT g.id, g.tenant_id, t.name, t.cvr, g.staff_user_id,
             (SELECT su.name FROM auth.users su WHERE su.id = g.staff_user_id),
             g.case_id, g.case_ref, pc.number, pc.title, g.scope,
             CASE
               WHEN g.denied_at IS NOT NULL THEN 'denied'
               WHEN g.revoked_at IS NOT NULL THEN 'revoked'
               WHEN g.ended_at IS NOT NULL THEN 'ended'
               WHEN g.expires_at <= now() THEN 'expired'
               WHEN g.approved_at IS NULL THEN 'pending'
               ELSE 'active'
             END,
             (SELECT u.name FROM auth.users u WHERE u.id = g.approved_by),
             g.created_at, g.approved_at, g.expires_at,
             coalesce(g.ended_at, g.revoked_at, g.denied_at,
                      CASE WHEN g.expires_at <= now() THEN g.expires_at END),
             g.extension_requested_at,
             (SELECT count(*)::int FROM audit_log a
               WHERE a.actor_kind = 'support' AND a.actor_user_id = g.staff_user_id
                 AND g.approved_at IS NOT NULL
                 AND a.created_at >= g.approved_at
                 AND a.created_at <= least(coalesce(g.ended_at, g.revoked_at, g.expires_at), now()))
        FROM support_access_grants g
        LEFT JOIN platform.cases pc ON pc.id = g.case_id
       WHERE g.created_at > now() - interval '60 days'
         AND (NOT g.superadmin OR g.staff_user_id = app.current_user_id());
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION
  app.platform_error_codes_range(timestamptz, timestamptz, timestamptz), app.platform_grants()
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.platform_error_codes_range(timestamptz, timestamptz, timestamptz), app.platform_grants()
TO agentor_web;
