-- Billing and onboarding: RLS, privileges and SECURITY DEFINER paths (M4).

ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions  FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE addons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE addons         FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices       FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON usage_counters
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON addons
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

-- Web role: everyone in the tenant sees the plan and usage (secondary-nav meter); invoices and
-- plan changes are for owners only (produktspecifikation §6: "Abonnement · Ejer").
CREATE POLICY invoices_owner_read ON invoices AS RESTRICTIVE FOR SELECT TO agentor_web
  USING (app.is_tenant_owner());
CREATE POLICY subscriptions_owner_update ON subscriptions AS RESTRICTIVE FOR UPDATE TO agentor_web
  USING (app.is_tenant_owner()) WITH CHECK (app.is_tenant_owner());
CREATE POLICY addons_owner_insert ON addons AS RESTRICTIVE FOR INSERT TO agentor_web
  WITH CHECK (app.is_tenant_owner());
--> statement-breakpoint
GRANT SELECT ON subscriptions, usage_counters, addons, invoices TO agentor_web;
GRANT UPDATE (plan_id, provider_subscription_id, updated_at) ON subscriptions TO agentor_web;
GRANT INSERT ON addons TO agentor_web;
-- Worker: billing jobs (charges, callbacks) and usage counting (M8).
GRANT SELECT, INSERT, UPDATE ON subscriptions, usage_counters, addons, invoices TO agentor_worker;
--> statement-breakpoint

-- Private indexes resolvable without tenant context -------------------------------------------------
-- Billing schedule: lets the scheduler find due subscriptions across tenants without reading them.
CREATE TABLE app.billing_schedule (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  status text NOT NULL,
  next_charge_at timestamptz
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_billing_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO app.billing_schedule (tenant_id, status, next_charge_at)
  VALUES (NEW.tenant_id, NEW.status, NEW.current_period_end)
  ON CONFLICT (tenant_id) DO UPDATE SET status = excluded.status, next_charge_at = excluded.next_charge_at;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER subscriptions_billing_schedule AFTER INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.sync_billing_schedule();
--> statement-breakpoint
-- Payment-provider references (QuickPay order_id ↔ tenant), registered within a tenant context.
CREATE TABLE app.billing_refs (
  order_id text PRIMARY KEY CHECK (order_id ~ '^[A-Za-z0-9]{4,20}$'),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('subscription', 'invoice')),
  ref_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE app.invoice_number_seq START 1000;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.register_billing_ref(p_order_id text, p_kind text, p_ref_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'tenant context missing' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.billing_refs (order_id, tenant_id, kind, ref_id)
  VALUES (p_order_id, app.current_tenant_id(), p_kind, p_ref_id);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_billing_ref(p_order_id text)
RETURNS TABLE (tenant_id uuid, kind text, ref_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$ SELECT r.tenant_id, r.kind, r.ref_id FROM app.billing_refs r WHERE r.order_id = p_order_id $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.due_subscriptions(p_now timestamptz) RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT s.tenant_id FROM app.billing_schedule s
   WHERE s.status IN ('active', 'past_due') AND s.next_charge_at IS NOT NULL AND s.next_charge_at <= p_now
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.next_invoice_number() RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT 'AG-' || to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'YYYY') || '-' || lpad(nextval('app.invoice_number_seq')::text, 4, '0') $$;
--> statement-breakpoint

-- Onboarding: a signed-in user without a company creates one and becomes its owner (D14).
CREATE OR REPLACE FUNCTION app.create_tenant(
  p_name text,
  p_cvr text,
  p_address_line text,
  p_postal_code text,
  p_city text,
  p_billing_email text,
  p_locale text,
  p_time_zone text,
  p_orders_per_month text
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
  -- Abuse guard: one account can't spin up unlimited companies.
  SELECT count(*) INTO v_owned FROM memberships m WHERE m.user_id = v_user AND m.role = 'owner';
  IF v_owned >= 10 THEN
    RAISE EXCEPTION 'TENANT_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  INSERT INTO tenants (id, name, cvr, address_line, postal_code, city, billing_email, locale, time_zone, orders_per_month)
  VALUES (v_tenant, trim(p_name), nullif(p_cvr, ''), nullif(p_address_line, ''), nullif(p_postal_code, ''),
          nullif(p_city, ''), nullif(lower(p_billing_email), ''), coalesce(p_locale, 'da'),
          coalesce(p_time_zone, 'Europe/Copenhagen'), nullif(p_orders_per_month, ''));
  INSERT INTO memberships (tenant_id, user_id, role, flow_scope) VALUES (v_tenant, v_user, 'owner', 'all');
  INSERT INTO subscriptions (tenant_id, plan_id, status) VALUES (v_tenant, 'business', 'incomplete');
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  SELECT v_tenant, v_user, 'user', u.name, 'company.created', 'tenant', v_tenant, jsonb_build_object('name', trim(p_name), 'cvr', p_cvr)
    FROM auth.users u WHERE u.id = v_user;
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_tenant;
END
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.sync_billing_schedule() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.register_billing_ref(text, text, uuid), app.resolve_billing_ref(text),
  app.due_subscriptions(timestamptz), app.next_invoice_number(),
  app.create_tenant(text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_billing_ref(text, text, uuid) TO agentor_web, agentor_worker;
GRANT EXECUTE ON FUNCTION app.resolve_billing_ref(text), app.due_subscriptions(timestamptz),
  app.next_invoice_number() TO agentor_worker;
GRANT EXECUTE ON FUNCTION app.create_tenant(text, text, text, text, text, text, text, text, text) TO agentor_web;
