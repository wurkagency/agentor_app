-- Administration (PLAN-2026-10-21 M2): price versions for plans and support, incidents on System
-- Status, and the reason for non-billable time. PostgreSQL 12 compatible.

-- Plan price versions: global like plans, read-only for runtime roles ------------------------------
GRANT SELECT ON plan_price_versions TO agentor_web, agentor_worker;
--> statement-breakpoint
-- Today's price and limits become version 1 of each plan; every subscription keeps that version.
INSERT INTO plan_price_versions (plan_id, price_monthly_ore, entitlements, applies_to, effective_from,
                                 created_by_name)
SELECT p.id, p.price_monthly_ore,
       coalesce((SELECT jsonb_object_agg(e.key, e.value) FROM plan_entitlements e WHERE e.plan_id = p.id),
                '{}'::jsonb),
       'new', now(), 'Migration'
  FROM plans p;
--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_price_version_fk
  FOREIGN KEY (price_version_id) REFERENCES plan_price_versions(id);
--> statement-breakpoint
ALTER TABLE subscriptions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE subscriptions s SET price_version_id = v.id
  FROM plan_price_versions v WHERE v.plan_id = s.plan_id AND s.price_version_id IS NULL;
--> statement-breakpoint
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A new subscription, or one that changes plan, gets the plan's newest version in force. Signup and
-- plan change stay as they are; they never pick a version themselves.
CREATE OR REPLACE FUNCTION app.subscription_price_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.price_version_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.plan_id IS DISTINCT FROM OLD.plan_id) THEN
    NEW.price_version_id := (
      SELECT v.id FROM plan_price_versions v
       WHERE v.plan_id = NEW.plan_id AND v.effective_from <= now()
       ORDER BY v.effective_from DESC, v.created_at DESC LIMIT 1);
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER subscriptions_price_version BEFORE INSERT OR UPDATE OF plan_id ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.subscription_price_version();
--> statement-breakpoint
-- The plan's limits, now also the trial and the features Superadmin switches on A2.
CREATE OR REPLACE FUNCTION app.platform_plan_update(p_plan_id text, p_price_ore integer, p_values jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE k text;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF p_price_ore IS NOT NULL AND (p_price_ore < 0 OR p_price_ore > 10000000) THEN
    RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_price_ore IS NOT NULL THEN
    UPDATE plans SET price_monthly_ore = p_price_ore WHERE id = p_plan_id;
  END IF;
  FOR k IN SELECT jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) LOOP
    IF k NOT IN ('seats', 'transactions_per_month', 'integration_sets', 'destinations_per_flow',
                 'polling_interval_minutes', 'payload_retention_days', 'run_history_months',
                 'audit_retention_months', 'overage_price_ore_per_1000',
                 'recommended_for_systems', 'trial_days', 'features') THEN
      RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023';
    END IF;
    INSERT INTO plan_entitlements (plan_id, key, value) VALUES (p_plan_id, k, p_values -> k)
    ON CONFLICT (plan_id, key) DO UPDATE SET value = excluded.value;
  END LOOP;
END
$$;
--> statement-breakpoint
-- Saving a plan on A2: updates the plan (what new subscriptions get) and records a version with a
-- snapshot of its price and limits. "new": existing subscriptions keep their version.
-- "all_from_renewal": they move to it at their first renewal after the notice period (the app
-- e-mails the customers and stamps notice_sent_at).
CREATE OR REPLACE FUNCTION app.platform_price_version_create(p_plan_id text, p_price_ore integer,
                                                             p_values jsonb, p_applies_to text,
                                                             p_actor_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF p_applies_to NOT IN ('new', 'all_from_renewal') THEN
    RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM app.platform_plan_update(p_plan_id, p_price_ore, p_values);
  INSERT INTO plan_price_versions (plan_id, price_monthly_ore, entitlements, applies_to,
                                   effective_from, created_by, created_by_name)
  SELECT p.id, p.price_monthly_ore,
         coalesce((SELECT jsonb_object_agg(e.key, e.value) FROM plan_entitlements e WHERE e.plan_id = p.id),
                  '{}'::jsonb),
         p_applies_to, now(), app.current_user_id(), p_actor_name
    FROM plans p WHERE p.id = p_plan_id
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.platform_price_notice_sent(p_version_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  UPDATE plan_price_versions SET notice_sent_at = now()
   WHERE id = p_version_id AND applies_to = 'all_from_renewal' AND notice_sent_at IS NULL;
END
$$;
--> statement-breakpoint
-- The version a subscription is charged at a renewal starting p_at: its own, or the plan's newest
-- "all_from_renewal" version once the customer was told at least 30 days before p_at.
CREATE OR REPLACE FUNCTION app.subscription_version_at(p_sub_version uuid, p_plan_id text,
                                                       p_at timestamptz)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    (SELECT v.id FROM plan_price_versions v
      WHERE v.plan_id = p_plan_id AND v.applies_to = 'all_from_renewal'
        AND v.notice_sent_at IS NOT NULL AND v.notice_sent_at <= p_at - interval '30 days'
        AND v.effective_from <= p_at
        AND v.created_at > coalesce((SELECT o.created_at FROM plan_price_versions o
                                      WHERE o.id = p_sub_version), '-infinity'::timestamptz)
      ORDER BY v.created_at DESC LIMIT 1),
    p_sub_version)
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.subscription_version_at(uuid, text, timestamptz) TO agentor_web, agentor_worker;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_price_version_create(text, integer, jsonb, text, text),
  app.platform_price_notice_sent(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_price_version_create(text, integer, jsonb, text, text),
  app.platform_price_notice_sent(uuid) TO agentor_web;
--> statement-breakpoint

-- Support price versions: staff read (Tid pr. kunde shows the rate), Superadmin writes, the
-- worker reads when it drafts support invoices ------------------------------------------------------
ALTER TABLE platform.support_price_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_price_versions_read ON platform.support_price_versions FOR SELECT TO agentor_web
  USING (app.is_staff());
--> statement-breakpoint
CREATE POLICY support_price_versions_superadmin ON platform.support_price_versions FOR INSERT
  TO agentor_web WITH CHECK (app.is_superadmin());
--> statement-breakpoint
CREATE POLICY support_price_versions_worker ON platform.support_price_versions FOR SELECT
  TO agentor_worker USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.support_price_versions TO agentor_web;
--> statement-breakpoint
GRANT SELECT ON platform.support_price_versions TO agentor_worker;
--> statement-breakpoint
-- Version 1: today's rate (Platformindstillinger, else 640 kr. ex. VAT), 15 minutes, in force from
-- the beginning so every past month keeps its rate.
INSERT INTO platform.support_price_versions (rate_ore, rounding_minutes, non_billable, effective_from,
                                             created_by_name)
VALUES (
  coalesce((SELECT (s.value #>> '{}')::integer FROM platform.settings s WHERE s.key = 'hourlyRateOre'), 64000),
  15, '["agentor_error", "goodwill"]'::jsonb, '2000-01-01T00:00:00Z', 'Migration');
--> statement-breakpoint
-- The support price in force at p_at (the start of the month being billed).
CREATE OR REPLACE FUNCTION app.support_price_at(p_at timestamptz)
RETURNS TABLE (rate_ore integer, rounding_minutes integer)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT v.rate_ore, v.rounding_minutes FROM platform.support_price_versions v
   WHERE v.effective_from <= p_at
   ORDER BY v.effective_from DESC, v.created_at DESC LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.support_price_at(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.support_price_at(timestamptz) TO agentor_web, agentor_worker;
--> statement-breakpoint
-- MA15 "Support i oktober" now uses the version in force this month, with its rounding.
CREATE OR REPLACE FUNCTION app.customer_support_month()
RETURNS TABLE (registered_minutes integer, billed_minutes integer, rate_ore integer)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  WITH p AS (
    SELECT * FROM app.support_price_at(
      (date_trunc('month', now() AT TIME ZONE 'Europe/Copenhagen')) AT TIME ZONE 'Europe/Copenhagen')
  )
  SELECT
    coalesce(sum(t.minutes), 0)::integer,
    coalesce(sum(((t.minutes + p.rounding_minutes - 1) / p.rounding_minutes) * p.rounding_minutes), 0)::integer,
    (SELECT rate_ore FROM p)
  FROM platform.time_entries t, p
  WHERE t.tenant_id = app.current_tenant_id() AND app.is_tenant_owner()
    AND t.billable AND t.case_id IS NOT NULL AND t.invoice_id IS NULL
    AND t.work_date >= date_trunc('month', now() AT TIME ZONE 'Europe/Copenhagen')::date
$$;
--> statement-breakpoint

-- Incidents (A1, MP25): Superadmin only -----------------------------------------------------------
ALTER TABLE platform.incidents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY incidents_superadmin ON platform.incidents FOR ALL TO agentor_web
  USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON platform.incidents TO agentor_web;
--> statement-breakpoint

-- System Status (A1): runs in the last hour and webhooks today across customers. Counts only.
CREATE OR REPLACE FUNCTION app.platform_status_counts(p_since_runs timestamptz, p_since_hooks timestamptz)
RETURNS TABLE (runs integer, runs_failed integer, webhooks integer, webhooks_rejected integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
  x record;
  r integer := 0; rf integer := 0; w integer := 0; wr integer := 0;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT d.tenant_id FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    SELECT count(*)::int AS n, (count(*) FILTER (WHERE ru.status = 'failed'))::int AS f
      INTO x FROM runs ru WHERE ru.started_at >= p_since_runs AND ru.kind <> 'test';
    r := r + x.n; rf := rf + x.f;
    SELECT count(*)::int AS n, (count(*) FILTER (WHERE ie.status = 'rejected'))::int AS f
      INTO x FROM inbound_events ie WHERE ie.received_at >= p_since_hooks;
    w := w + x.n; wr := wr + x.f;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN QUERY SELECT r, rf, w, wr;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_status_counts(timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_status_counts(timestamptz, timestamptz) TO agentor_web;
