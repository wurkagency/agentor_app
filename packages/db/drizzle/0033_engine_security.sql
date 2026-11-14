-- Sync engine (produktspecifikation §4.1): RLS and grants for the new tables, automatic retries
-- in the scheduler's private index, the stale-run sweep and the retention sweep.

ALTER TABLE sync_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_items    FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors  FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_payloads FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_links  FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON sync_items
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON sync_cursors
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON sync_payloads
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON entity_links
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
-- Only the worker runs the engine; the web role never reads payloads or the engine's state.
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_items, sync_cursors, sync_payloads, entity_links
  TO agentor_worker;
--> statement-breakpoint

-- Automatic retries: the flow's next_retry_at joins the private schedule -------------------------
ALTER TABLE app.flow_schedule ADD COLUMN next_retry_at timestamptz;
--> statement-breakpoint
CREATE INDEX flow_schedule_retry_idx ON app.flow_schedule (next_retry_at) WHERE active;
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
  INSERT INTO app.flow_schedule (flow_id, tenant_id, next_run_at, next_retry_at, active)
  VALUES (NEW.id, NEW.tenant_id, NEW.next_run_at, NEW.next_retry_at,
          NEW.published_version_id IS NOT NULL AND NEW.paused_at IS NULL)
  ON CONFLICT (flow_id) DO UPDATE SET next_run_at = excluded.next_run_at,
    next_retry_at = excluded.next_retry_at, active = excluded.active;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP FUNCTION app.due_flows(timestamptz);
--> statement-breakpoint
-- Due polls and due retries, across tenants, without reading any flow.
CREATE FUNCTION app.due_flows(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, flow_id uuid, kind text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  (SELECT s.tenant_id, s.flow_id, 'scheduled' FROM app.flow_schedule s
    WHERE s.active AND (s.next_run_at IS NULL OR s.next_run_at <= p_now)
    ORDER BY s.next_run_at NULLS FIRST LIMIT 500)
  UNION ALL
  (SELECT s.tenant_id, s.flow_id, 'retry' FROM app.flow_schedule s
    WHERE s.active AND s.next_retry_at IS NOT NULL AND s.next_retry_at <= p_now
    ORDER BY s.next_retry_at LIMIT 500)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.due_flows(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.due_flows(timestamptz) TO agentor_worker;
--> statement-breakpoint

-- Stale runs: a worker that died mid-run leaves it "running"; mark it failed so the flow moves on.
CREATE OR REPLACE FUNCTION app.fail_stale_runs(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
  v_n integer := 0;
  v_c integer;
BEGIN
  FOR t IN SELECT d.tenant_id FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    UPDATE runs SET status = 'failed', finished_at = now()
     WHERE status IN ('running', 'queued') AND started_at < p_before;
    GET DIAGNOSTICS v_c = ROW_COUNT;
    v_n := v_n + v_c;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v_n;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.fail_stale_runs(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.fail_stale_runs(timestamptz) TO agentor_worker;
--> statement-breakpoint

-- Retention (produktspecifikation §9.6, decided by Charlie 19 Oct 2026): payloads with personal
-- data 30 days, run and record history 13 months, audit log 24 months. Values come from each
-- customer's plan (plan_entitlements), so they can differ per plan later.
CREATE OR REPLACE FUNCTION app.retention_sweep(p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
  v_plan text;
  v_payload_days integer;
  v_history_months integer;
  v_audit_months integer;
  v_c integer;
  v_payloads integer := 0;
  v_records integer := 0;
  v_runs integer := 0;
  v_events integer := 0;
  v_audit integer := 0;
BEGIN
  FOR t IN SELECT d.tenant_id FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    SELECT s.plan_id INTO v_plan FROM subscriptions s LIMIT 1;
    SELECT coalesce(max(CASE WHEN e.key = 'payload_retention_days' THEN (e.value #>> '{}')::int END), 30),
           coalesce(max(CASE WHEN e.key = 'run_history_months' THEN (e.value #>> '{}')::int END), 13),
           coalesce(max(CASE WHEN e.key = 'audit_retention_months' THEN (e.value #>> '{}')::int END), 24)
      INTO v_payload_days, v_history_months, v_audit_months
      FROM plan_entitlements e WHERE e.plan_id = coalesce(v_plan, 'startup');

    -- Personal data: fetched payloads, the developer view's request/response and the record
    -- preview (customer name and address), webhook bodies.
    DELETE FROM sync_payloads WHERE created_at < p_now - make_interval(days => v_payload_days);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_payloads := v_payloads + v_c;
    UPDATE run_records SET preview = NULL, debug = NULL
     WHERE created_at < p_now - make_interval(days => v_payload_days)
       AND (preview IS NOT NULL OR debug IS NOT NULL);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_payloads := v_payloads + v_c;
    DELETE FROM inbound_events WHERE received_at < p_now - make_interval(days => v_payload_days);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_events := v_events + v_c;

    -- History without personal data.
    DELETE FROM run_records WHERE created_at < p_now - make_interval(months => v_history_months);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_records := v_records + v_c;
    DELETE FROM runs WHERE started_at < p_now - make_interval(months => v_history_months);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_runs := v_runs + v_c;
    DELETE FROM sync_items WHERE created_at < p_now - make_interval(months => v_history_months);

    -- Audit log: append-only for every runtime role; only this sweep removes old entries.
    DELETE FROM audit_log WHERE created_at < p_now - make_interval(months => v_audit_months);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_audit := v_audit + v_c;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN jsonb_build_object('payloads', v_payloads, 'records', v_records, 'runs', v_runs,
                            'events', v_events, 'audit', v_audit);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.retention_sweep(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.retention_sweep(timestamptz) TO agentor_worker;
