ALTER TABLE "tenants" ADD COLUMN "signup_receipt_sent_at" timestamp with time zone;--> statement-breakpoint

-- Receipt for the first payment (PLAN-SIGNUP Q20): the web app mails it once, the first time a page
-- sees the company as active. Claiming sets the marker; only the call that set it gets the invoice,
-- so two requests at once send one mail. Tenants activated before this (B8 backfill, seed) have no
-- signup_state_at and never get one.
CREATE OR REPLACE FUNCTION app.claim_signup_receipt() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_tenant uuid := app.current_tenant_id(); v_invoice uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant context missing' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM memberships m WHERE m.tenant_id = v_tenant AND m.user_id = app.current_user_id();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT i.id INTO v_invoice FROM invoices i
   WHERE i.tenant_id = v_tenant AND i.kind = 'subscription' AND i.status = 'paid'
   ORDER BY i.period_start, i.id LIMIT 1;
  IF v_invoice IS NULL THEN RETURN NULL; END IF;
  UPDATE tenants SET signup_receipt_sent_at = now()
   WHERE id = v_tenant AND signup_state = 'active' AND signup_state_at IS NOT NULL
     AND signup_receipt_sent_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_invoice;
END
$$;
--> statement-breakpoint
-- The mail could not be sent: the next page view tries again.
CREATE OR REPLACE FUNCTION app.release_signup_receipt() RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE tenants SET signup_receipt_sent_at = NULL WHERE id = app.current_tenant_id()
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.claim_signup_receipt(), app.release_signup_receipt() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.claim_signup_receipt(), app.release_signup_receipt() TO agentor_web;
