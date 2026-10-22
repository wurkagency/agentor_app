-- Profile dashboard (README decision 25, PLAN-2026-10-21 M3): own profile rows, achievements as
-- data, and the figures the profile shows, computed from existing tables only. Nothing here tracks
-- anything new. PostgreSQL 12 compatible.

-- Each user reads and writes only their own profile row ---------------------------------------------
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_profiles_own ON user_profiles
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON user_profiles TO agentor_web;
--> statement-breakpoint
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_achievements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_achievements_own ON user_achievements
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON user_achievements TO agentor_web;
--> statement-breakpoint
GRANT SELECT ON achievement_definitions TO agentor_web;
--> statement-breakpoint

-- The six staff and six customer achievements drawn on PR1 and D15. Metrics without data are off:
-- satisfaction is never recorded, reuse of archived answers isn't tracked, and response deadlines
-- are still a placeholder (README decision 17).
INSERT INTO achievement_definitions (key, audience, icon, metric, threshold, window_days, sort_order, enabled) VALUES
  ('cases_100',        'staff',    'trophy',        'cases_resolved_total',        100, NULL, 1, true),
  ('fast_replies',     'staff',    'zap',           'weeks_median_reply_under_45',   4, 28,   2, true),
  ('customer_favorite','staff',    'heart',         'satisfaction_pct',             90, 30,   3, false),
  ('knowledge_sharer', 'staff',    'book-open',     'archive_reuse',                10, NULL, 4, false),
  ('no_missed_deadlines','staff',  'calendar-check','days_without_missed_deadline', 30, NULL, 5, false),
  ('team_player',      'staff',    'users',         'colleagues_helped',             5, NULL, 6, true),
  ('first_flow_live',  'customer', 'rocket',        'flows_live',                    1, NULL, 1, true),
  ('records_1000_day', 'customer', 'database',      'max_records_one_day',        1000, NULL, 2, true),
  ('team_assembled',   'customer', 'users',         'invitations_sent',              3, NULL, 3, true),
  ('quick_fixer',      'customer', 'zap',           'errors_fixed_within_hour',      5, NULL, 4, true),
  ('clean_week',       'customer', 'scale',         'days_without_failed_records',   7, NULL, 5, true),
  ('team_two_factor',  'customer', 'shield-check',  'members_with_two_factor',       1, NULL, 6, true);
--> statement-breakpoint

-- /api/avatar: the key of a user's avatar when the viewer may see it: themselves, a colleague in a
-- company they share, or staff seeing staff. Support access never opens another user's profile.
CREATE OR REPLACE FUNCTION app.avatar_key_for(p_target uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me uuid := app.current_user_id();
  v_prev_tenant text := current_setting('app.tenant_id', true);
  v_ok boolean := false;
  v_key text;
  t record;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;
  IF p_target = v_me THEN
    v_ok := true;
  ELSIF EXISTS (SELECT 1 FROM platform.staff s WHERE s.user_id = v_me AND s.disabled_at IS NULL)
        AND EXISTS (SELECT 1 FROM platform.staff s WHERE s.user_id = p_target) THEN
    v_ok := true;
  ELSE
    -- The caller's own companies (allowed without a tenant), then the target in each of them.
    PERFORM set_config('app.tenant_id', '', true);
    FOR t IN SELECT m.tenant_id FROM memberships m WHERE m.user_id = v_me LOOP
      PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
      IF EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = p_target) THEN
        v_ok := true;
        EXIT;
      END IF;
    END LOOP;
    PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  END IF;
  IF NOT v_ok THEN RETURN NULL; END IF;
  -- The row is RLS-scoped to its owner: read it as the target, then put the caller back.
  PERFORM set_config('app.user_id', p_target::text, true);
  SELECT p.avatar_key INTO v_key FROM user_profiles p WHERE p.user_id = p_target;
  PERFORM set_config('app.user_id', v_me::text, true);
  RETURN v_key;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.avatar_key_for(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.avatar_key_for(uuid) TO agentor_web;
--> statement-breakpoint

-- D15/MA36: the signed-in customer's figures in the current company, from existing tables only
-- (runs, run_records, flows, the audit log, memberships). The caller must be a member.
CREATE OR REPLACE FUNCTION app.profile_customer_stats(p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me uuid := app.current_user_id();
  v_tenant uuid := app.current_tenant_id();
  v_out jsonb;
BEGIN
  IF v_me IS NULL OR v_tenant IS NULL
     OR NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = v_tenant AND m.user_id = v_me) THEN
    RAISE EXCEPTION 'NOT_MEMBER' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'records7d', (SELECT coalesce(sum(r.records_ok), 0) FROM runs r
                   WHERE r.tenant_id = v_tenant AND r.kind <> 'test' AND r.started_at >= p_now - interval '7 days'),
    'recordsTotal', (SELECT coalesce(sum(r.records_ok), 0) FROM runs r
                      WHERE r.tenant_id = v_tenant AND r.kind <> 'test'),
    'runs30', (SELECT count(*) FROM runs r WHERE r.tenant_id = v_tenant AND r.kind <> 'test'
                 AND r.started_at >= p_now - interval '30 days' AND r.status IN ('ok', 'partial', 'failed')),
    'runsOk30', (SELECT count(*) FROM runs r WHERE r.tenant_id = v_tenant AND r.kind <> 'test'
                   AND r.started_at >= p_now - interval '30 days' AND r.status = 'ok'),
    'flowsLive', (SELECT count(*) FROM flows f WHERE f.tenant_id = v_tenant
                    AND f.published_version_id IS NOT NULL AND f.paused_at IS NULL),
    'firstLiveFlow', (SELECT f.name FROM flows f WHERE f.tenant_id = v_tenant
                        AND f.published_version_id IS NOT NULL ORDER BY f.created_at LIMIT 1),
    'flowsCreated', (SELECT count(*) FROM audit_log a WHERE a.tenant_id = v_tenant
                       AND a.actor_user_id = v_me AND a.action = 'flow.created'),
    'draftFlows', (SELECT count(*) FROM flows f WHERE f.tenant_id = v_tenant AND f.published_version_id IS NULL),
    'invitationsSent', (SELECT count(*) FROM audit_log a WHERE a.tenant_id = v_tenant
                          AND a.actor_user_id = v_me AND a.action = 'member.invited'),
    'maxRecordsDay', (SELECT coalesce(max(d.n), 0) FROM (
                        SELECT sum(r.records_ok) AS n FROM runs r
                         WHERE r.tenant_id = v_tenant AND r.kind <> 'test'
                         GROUP BY (r.started_at AT TIME ZONE 'Europe/Copenhagen')::date) d),
    -- Failed records that were resolved within an hour of a retry this user started.
    'errorsFixed', (SELECT count(DISTINCT rr.id) FROM audit_log a
                      JOIN run_records rr ON rr.tenant_id = a.tenant_id AND rr.flow_id::text = a.object_id::text
                     WHERE a.tenant_id = v_tenant AND a.actor_user_id = v_me AND a.action = 'flow.retried'
                       AND rr.outcome = 'failed' AND rr.resolved_at IS NOT NULL
                       AND rr.resolved_at BETWEEN a.created_at AND a.created_at + interval '1 hour'
                       AND a.created_at >= p_now - interval '30 days'),
    -- Retries by this user that fixed a failure less than an hour old.
    'fixedWithinHour', (SELECT count(DISTINCT a.id) FROM audit_log a
                          JOIN run_records rr ON rr.tenant_id = a.tenant_id AND rr.flow_id::text = a.object_id::text
                         WHERE a.tenant_id = v_tenant AND a.actor_user_id = v_me AND a.action = 'flow.retried'
                           AND rr.outcome = 'failed' AND rr.resolved_at IS NOT NULL
                           AND rr.created_at >= a.created_at - interval '1 hour'
                           AND rr.resolved_at BETWEEN a.created_at AND a.created_at + interval '1 hour'),
    -- Days (Copenhagen) that had failed records, newest first, for the clean-days streak.
    'failedDays', (SELECT coalesce(jsonb_agg(d ORDER BY d DESC), '[]'::jsonb) FROM (
                     SELECT DISTINCT (rr.created_at AT TIME ZONE 'Europe/Copenhagen')::date AS d
                       FROM run_records rr WHERE rr.tenant_id = v_tenant AND rr.outcome = 'failed'
                        AND rr.created_at >= p_now - interval '400 days') x),
    'firstRunDay', (SELECT (min(r.started_at) AT TIME ZONE 'Europe/Copenhagen')::date FROM runs r
                     WHERE r.tenant_id = v_tenant AND r.kind <> 'test'),
    'members', (SELECT count(*) FROM memberships m WHERE m.tenant_id = v_tenant),
    'membersTwoFactor', (SELECT count(*) FROM memberships m JOIN auth.users u ON u.id = m.user_id
                          WHERE m.tenant_id = v_tenant AND u.two_factor_enabled),
    -- When connections broke (system entries in the audit log), for "dage uden afbrudte forbindelser".
    'connectionBreaks', (SELECT coalesce(jsonb_agg(a.created_at ORDER BY a.created_at), '[]'::jsonb)
                           FROM audit_log a WHERE a.tenant_id = v_tenant AND a.action = 'connection.broken'),
    'brokenNow', (SELECT count(*) FROM connections c WHERE c.tenant_id = v_tenant AND c.status = 'broken'),
    'tenantCreatedAt', (SELECT t.created_at FROM tenants t WHERE t.id = v_tenant),
    'memberSince', (SELECT m.created_at FROM memberships m WHERE m.tenant_id = v_tenant AND m.user_id = v_me),
    -- The 12-week activity map: this user's runs, retries and settings changes per day.
    'activity', (SELECT coalesce(jsonb_object_agg(d, n), '{}'::jsonb) FROM (
                   SELECT (a.created_at AT TIME ZONE 'Europe/Copenhagen')::date::text AS d, count(*) AS n
                     FROM audit_log a
                    WHERE a.tenant_id = v_tenant AND a.actor_user_id = v_me AND a.actor_kind = 'user'
                      AND a.created_at >= p_now - interval '84 days'
                      AND a.action IN ('flow.run_requested', 'flow.retried', 'flow.paused', 'flow.resumed',
                                       'flow.route_paused', 'flow.published', 'flow.created',
                                       'security.updated', 'notifications.updated', 'company.updated',
                                       'connection.created', 'connection.reauthorized',
                                       'member.invited', 'member.role_changed')
                    GROUP BY 1) x)
  ) INTO v_out;
  RETURN v_out;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.profile_customer_stats(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.profile_customer_stats(timestamptz) TO agentor_web;
--> statement-breakpoint
-- Whether the signed-in user must keep two-step login on: all Agentor staff, and members of a
-- company that requires it for everyone (D12). Used to refuse turning TOTP off. Only ever about the
-- caller, so it can't be used to find out who is staff.
CREATE OR REPLACE FUNCTION app.must_keep_two_factor()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  p_user uuid := app.current_user_id();
  v_prev_tenant text := current_setting('app.tenant_id', true);
  v_must boolean := false;
  t record;
BEGIN
  IF p_user IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM platform.staff s WHERE s.user_id = p_user) THEN RETURN true; END IF;
  -- The user's own companies (readable before a company is chosen), then each company's rule.
  PERFORM set_config('app.tenant_id', '', true);
  FOR t IN SELECT m.tenant_id FROM memberships m WHERE m.user_id = p_user LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    IF EXISTS (SELECT 1 FROM tenants x WHERE x.id = t.tenant_id AND x.require_mfa_all) THEN
      v_must := true;
      EXIT;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  RETURN v_must;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.must_keep_two_factor() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.must_keep_two_factor() TO agentor_web;
