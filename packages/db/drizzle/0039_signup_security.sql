-- Self-service signup (PLAN-SIGNUP §3, S1): tenant signup state, only active tenants can work,
-- terms acceptances, recommendation data and the 24-hour clean-up of unfinished signups (B1).
-- PostgreSQL 12 compatible.

-- Recommendation data: SU3's order intervals and the number of systems a plan suits (§3.4).
-- Backfill: the migration runs as the owner, which FORCE RLS would otherwise hide all rows from.
ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
UPDATE tenants SET orders_per_month = CASE orders_per_month
  WHEN '0-200' THEN 'lt100' WHEN '200-1000' THEN '100-1000' WHEN '1000+' THEN 'gt1000'
  ELSE orders_per_month END;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE plan_entitlements SET value = CASE plan_id
  WHEN 'startup' THEN '["lt100"]'::jsonb WHEN 'business' THEN '["100-1000"]'::jsonb
  ELSE '["gt1000"]'::jsonb END
 WHERE key = 'recommended_for_orders';
--> statement-breakpoint
INSERT INTO plan_entitlements (plan_id, key, value) VALUES
  ('startup', 'recommended_for_systems', '3'),
  ('business', 'recommended_for_systems', '3'),
  ('enterprise', 'recommended_for_systems', 'null')
ON CONFLICT (plan_id, key) DO NOTHING;
--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_orders_per_month_check
  CHECK (orders_per_month IS NULL OR orders_per_month IN ('lt100', '100-1000', 'gt1000'));
--> statement-breakpoint

-- Superadmin may edit the new key like the other limits.
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
                 'recommended_for_systems') THEN
      RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023';
    END IF;
    INSERT INTO plan_entitlements (plan_id, key, value) VALUES (p_plan_id, k, p_values -> k)
    ON CONFLICT (plan_id, key) DO UPDATE SET value = excluded.value;
  END LOOP;
END
$$;
--> statement-breakpoint

-- Signup state can only change inside the app.signup_* functions (they run as the table owner).
-- A bug in app code that writes signup_state directly fails here instead of activating a tenant.
-- The owner (migrations, seeds, definer functions) and superusers (test fixtures) may.
CREATE OR REPLACE FUNCTION app.guard_signup_state() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE v_owner oid := (SELECT c.relowner FROM pg_class c WHERE c.oid = 'public.tenants'::regclass);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND (r.oid = v_owner OR r.rolsuper))
  THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.signup_state <> 'pending_plan' THEN
    RAISE EXCEPTION 'SIGNUP_STATE_PROTECTED' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.signup_state IS DISTINCT FROM OLD.signup_state THEN
    RAISE EXCEPTION 'SIGNUP_STATE_PROTECTED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenants_guard_signup_state BEFORE INSERT OR UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.guard_signup_state();
--> statement-breakpoint

-- Only active tenants create connections, flows and runs (PLAN-SIGNUP §3.1). Restrictive, for
-- every role, on top of tenant_isolation: a skipped guard in app code still fails in the database.
CREATE OR REPLACE FUNCTION app.tenant_is_active() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((SELECT t.signup_state = 'active' FROM tenants t WHERE t.id = app.current_tenant_id()), false)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.tenant_is_active() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.tenant_is_active() TO agentor_web, agentor_worker, agentor_support;
--> statement-breakpoint
CREATE POLICY active_tenant_insert ON connections AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.tenant_is_active());
--> statement-breakpoint
CREATE POLICY active_tenant_insert ON connection_secrets AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.tenant_is_active());
--> statement-breakpoint
CREATE POLICY active_tenant_insert ON flows AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.tenant_is_active());
--> statement-breakpoint
CREATE POLICY active_tenant_insert ON flow_versions AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.tenant_is_active());
--> statement-breakpoint
CREATE POLICY active_tenant_insert ON runs AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.tenant_is_active());
--> statement-breakpoint

-- Terms acceptances: append-only, readable in the tenant ----------------------------------------
ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE terms_acceptances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON terms_acceptances FOR SELECT
  USING (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_isolation_insert ON terms_acceptances FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY terms_owner_insert ON terms_acceptances AS RESTRICTIVE FOR INSERT TO agentor_web
  WITH CHECK (app.is_tenant_owner());
--> statement-breakpoint
GRANT SELECT, INSERT ON terms_acceptances TO agentor_web;
--> statement-breakpoint
GRANT SELECT ON terms_acceptances TO agentor_worker;
--> statement-breakpoint

-- Unfinished signups, resolvable without tenant context (like app.billing_schedule) ---------------
CREATE TABLE app.pending_signups (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Last time a payment was started or QuickPay reported on it: an in-flight payment is never purged.
  payment_activity_at timestamptz
);
--> statement-breakpoint

-- SU3: the verified user creates the company and becomes its owner, in pending_plan.
DROP FUNCTION IF EXISTS app.create_tenant(text, text, text, text, text, text, text, text, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.create_tenant(
  p_name text,
  p_cvr text,
  p_address_line text,
  p_postal_code text,
  p_city text,
  p_billing_email text,
  p_locale text,
  p_time_zone text,
  p_orders_per_month text,
  p_chosen_connectors text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_tenant uuid := app.uuid_v7();
  v_owned integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'user context missing' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'TENANT_NAME_REQUIRED' USING ERRCODE = '22023';
  END IF;
  -- Abuse guard: one account can't spin up unlimited companies, and only one unpaid at a time.
  SELECT count(*) INTO v_owned FROM memberships m WHERE m.user_id = v_user AND m.role = 'owner';
  IF v_owned >= 10 THEN
    RAISE EXCEPTION 'TENANT_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM memberships m JOIN tenants t ON t.id = m.tenant_id
   WHERE m.user_id = v_user AND m.role = 'owner' AND t.signup_state <> 'active';
  IF FOUND THEN
    RAISE EXCEPTION 'SIGNUP_PENDING' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  INSERT INTO tenants (id, name, cvr, address_line, postal_code, city, billing_email, locale, time_zone,
                       orders_per_month, chosen_connectors, signup_state, signup_state_at)
  VALUES (v_tenant, trim(p_name), nullif(p_cvr, ''), nullif(p_address_line, ''), nullif(p_postal_code, ''),
          nullif(p_city, ''), nullif(lower(p_billing_email), ''), coalesce(p_locale, 'da'),
          coalesce(p_time_zone, 'Europe/Copenhagen'), nullif(p_orders_per_month, ''),
          coalesce(p_chosen_connectors, '{}'::text[]), 'pending_plan', now());
  INSERT INTO memberships (tenant_id, user_id, role, flow_scope) VALUES (v_tenant, v_user, 'owner', 'all');
  INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES (v_tenant, 'business', 'incomplete');
  INSERT INTO app.pending_signups (tenant_id) VALUES (v_tenant);
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  SELECT v_tenant, v_user, 'user', u.name, 'company.created', 'tenant', v_tenant, jsonb_build_object('name', trim(p_name), 'cvr', p_cvr)
    FROM auth.users u WHERE u.id = v_user;
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_tenant;
END
$$;
--> statement-breakpoint

-- SU4: plan and period chosen (written by the app under RLS); the tenant waits for payment.
CREATE OR REPLACE FUNCTION app.signup_plan_chosen() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF app.current_tenant_id() IS NULL OR NOT app.is_tenant_owner() THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501';
  END IF;
  UPDATE tenants SET signup_state = 'pending_payment', signup_state_at = now(), updated_at = now()
   WHERE id = app.current_tenant_id() AND signup_state = 'pending_plan';
END
$$;
--> statement-breakpoint

-- A payment was started or QuickPay reported on it: not purged while it's in flight.
CREATE OR REPLACE FUNCTION app.signup_payment_activity() RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE app.pending_signups SET payment_activity_at = now() WHERE tenant_id = app.current_tenant_id()
$$;
--> statement-breakpoint

-- Worker, after a verified Payment callback: the tenant's first subscription invoice is paid, so
-- the tenant becomes active. Returns true only for the call that made the change (idempotent).
CREATE OR REPLACE FUNCTION app.signup_activate(p_invoice_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_tenant uuid := app.current_tenant_id(); v_done integer;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant context missing' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM invoices i
   WHERE i.id = p_invoice_id AND i.tenant_id = v_tenant AND i.kind = 'subscription' AND i.status = 'paid';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE tenants SET signup_state = 'active', signup_state_at = now(), onboarding_step = 'webshop',
                     updated_at = now()
   WHERE id = v_tenant AND signup_state = 'pending_payment';
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done = 0 THEN RETURN false; END IF;
  DELETE FROM app.pending_signups WHERE tenant_id = v_tenant;
  UPDATE auth.users u SET signup_started_at = NULL
    FROM memberships m WHERE m.tenant_id = v_tenant AND m.role = 'owner' AND u.id = m.user_id;
  INSERT INTO audit_log (tenant_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (v_tenant, 'system', 'Agentor', 'tenant.activated', 'tenant', v_tenant,
          jsonb_build_object('invoiceId', p_invoice_id));
  RETURN true;
END
$$;
--> statement-breakpoint

-- Clean-up after 24 hours (B1) ---------------------------------------------------------------------
-- Candidates: unpaid companies older than 24 hours with no payment in flight in the last hour.
-- The worker cancels each QuickPay subscription first, then purges the tenant.
CREATE OR REPLACE FUNCTION app.signup_purge_candidates(p_now timestamptz)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p.tenant_id FROM app.pending_signups p
   WHERE p.created_at <= p_now - interval '24 hours'
     AND (p.payment_activity_at IS NULL OR p.payment_activity_at <= p_now - interval '1 hour')
   ORDER BY p.created_at
   LIMIT 200
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.signup_purge_tenant(p_tenant_id uuid, p_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_done integer;
BEGIN
  PERFORM 1 FROM app.pending_signups p
   WHERE p.tenant_id = p_tenant_id AND p.created_at <= p_now - interval '24 hours'
     AND (p.payment_activity_at IS NULL OR p.payment_activity_at <= p_now - interval '1 hour');
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  -- Child rows go with the tenant (ON DELETE CASCADE), including its audit rows and acceptances.
  DELETE FROM tenants WHERE id = p_tenant_id AND signup_state <> 'active';
  GET DIAGNOSTICS v_done = ROW_COUNT;
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_done > 0;
END
$$;
--> statement-breakpoint
-- Accounts from self-service signup that never reached an active company and belong to none.
CREATE OR REPLACE FUNCTION app.signup_purge_users(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_user uuid; v_count integer := 0;
BEGIN
  FOR v_user IN
    SELECT u.id FROM auth.users u
     WHERE u.signup_started_at IS NOT NULL AND u.signup_started_at <= p_now - interval '24 hours'
     ORDER BY u.signup_started_at LIMIT 500
  LOOP
    -- memberships and staff are RLS-filtered to the user in context (own_memberships_without_tenant).
    PERFORM set_config('app.tenant_id', '', true);
    PERFORM set_config('app.user_id', v_user::text, true);
    PERFORM 1 FROM memberships m WHERE m.user_id = v_user;
    IF NOT FOUND AND NOT app.is_staff() THEN
      DELETE FROM auth.verifications v
       WHERE v.identifier IN (SELECT 'email-verification-otp-' || u.email FROM auth.users u WHERE u.id = v_user);
      DELETE FROM auth.users WHERE id = v_user;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  PERFORM set_config('app.user_id', '', true);
  RETURN v_count;
END
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.create_tenant(text, text, text, text, text, text, text, text, text, text[]),
  app.signup_plan_chosen(), app.signup_payment_activity(), app.signup_activate(uuid),
  app.signup_purge_candidates(timestamptz), app.signup_purge_tenant(uuid, timestamptz),
  app.signup_purge_users(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_tenant(text, text, text, text, text, text, text, text, text, text[]),
  app.signup_plan_chosen(), app.signup_payment_activity() TO agentor_web;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.signup_payment_activity(), app.signup_activate(uuid),
  app.signup_purge_candidates(timestamptz), app.signup_purge_tenant(uuid, timestamptz),
  app.signup_purge_users(timestamptz) TO agentor_worker;
