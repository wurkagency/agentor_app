-- The owner can switch between monthly and yearly billing (D13 "Skift til årlig"); it applies
-- from the next renewal. The owner-only update policy on subscriptions covers it.
GRANT UPDATE (interval) ON subscriptions TO agentor_web;
--> statement-breakpoint

-- Superadmin edits plans: price and the limits customers see (P6 "Ændre planer, priser").
-- Only known keys can change; every change is in the platform audit log (written by the app).
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
                 'audit_retention_months', 'overage_price_ore_per_1000') THEN
      RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023';
    END IF;
    INSERT INTO plan_entitlements (plan_id, key, value) VALUES (p_plan_id, k, p_values -> k)
    ON CONFLICT (plan_id, key) DO UPDATE SET value = excluded.value;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_plan_update(text, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_plan_update(text, integer, jsonb) TO agentor_web;
