-- Finans (README decision 18, F1–F7): Superadmin reads subscriptions and invoices across
-- customers and acts on them only through these SECURITY DEFINER functions. Every change is
-- written to the customer's audit log with the staff member's name. Supporters get nothing here.

-- Private schedule: lets the scheduler find support invoices to send and failed charges to retry
-- without reading any customer's invoices.
CREATE TABLE app.invoice_schedule (
  invoice_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  status text NOT NULL,
  send_at timestamptz,
  next_retry_at timestamptz
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_invoice_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app.invoice_schedule WHERE invoice_id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO app.invoice_schedule (invoice_id, tenant_id, status, send_at, next_retry_at)
  VALUES (NEW.id, NEW.tenant_id, NEW.status,
          CASE WHEN NEW.status = 'draft' AND NEW.approved_at IS NOT NULL THEN NEW.send_at END,
          CASE WHEN NEW.status = 'failed' THEN NEW.next_retry_at END)
  ON CONFLICT (invoice_id) DO UPDATE SET status = excluded.status, send_at = excluded.send_at,
    next_retry_at = excluded.next_retry_at;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_schedule AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.sync_invoice_schedule();
--> statement-breakpoint
ALTER TABLE invoices NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO app.invoice_schedule (invoice_id, tenant_id, status, send_at, next_retry_at)
SELECT id, tenant_id, status, NULL, CASE WHEN status = 'failed' THEN next_retry_at END FROM invoices
ON CONFLICT (invoice_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON app.invoice_schedule FROM PUBLIC;
--> statement-breakpoint

-- Scheduler: approved support invoices due to be sent, and failed charges due for a retry.
CREATE OR REPLACE FUNCTION app.due_invoice_jobs(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, invoice_id uuid, job text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT s.tenant_id, s.invoice_id, 'send' FROM app.invoice_schedule s
   WHERE s.status = 'draft' AND s.send_at IS NOT NULL AND s.send_at <= p_now
  UNION ALL
  SELECT s.tenant_id, s.invoice_id, 'retry' FROM app.invoice_schedule s
   WHERE s.status = 'failed' AND s.next_retry_at IS NOT NULL AND s.next_retry_at <= p_now
$$;
--> statement-breakpoint

-- Reads (F1–F7): one JSON object per subscription or invoice, with the customer's name.
CREATE OR REPLACE FUNCTION app.platform_finance_subscriptions()
RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT * FROM app.tenant_directory d ORDER BY d.name LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY
      SELECT to_jsonb(s) || jsonb_build_object(
               'tenant_name', t.name, 'cvr', t.cvr,
               'billing_email', (SELECT tn.billing_email FROM tenants tn WHERE tn.id = t.tenant_id),
               'tenant_created_at', t.created_at)
        FROM subscriptions s;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.platform_finance_invoices(p_from timestamptz, p_to timestamptz)
RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT * FROM app.tenant_directory d ORDER BY d.name LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY
      SELECT to_jsonb(i) || jsonb_build_object('tenant_name', t.name, 'cvr', t.cvr)
        FROM invoices i
       WHERE coalesce(i.issued_at, i.created_at) >= p_from
         AND coalesce(i.issued_at, i.created_at) < p_to;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- Writes ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.platform_finance_audit(
  p_tenant_id uuid, p_actor text, p_action text, p_object_id uuid, p_after jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (p_tenant_id, app.current_user_id(), 'system', 'Agentor · ' || p_actor, p_action,
          CASE WHEN p_action LIKE 'subscription.%' THEN 'subscription' ELSE 'invoice' END,
          p_object_id, p_after)
$$;
--> statement-breakpoint
-- Support draft for one customer and month (F3, F5). Lines are computed by the app from the
-- billable time; the registrations are linked to the draft so they are never billed twice.
-- An approved, sent or paid invoice is never changed.
CREATE OR REPLACE FUNCTION app.platform_finance_save_draft(
  p_tenant_id uuid, p_period_start timestamptz, p_period_end timestamptz, p_description text,
  p_lines jsonb, p_net integer, p_vat integer, p_entry_ids uuid[], p_send_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  v_id uuid;
  v_status text;
  v_approved timestamptz;
  v_method text;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF p_net < 0 OR p_vat < 0 THEN RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  SELECT i.id, i.status, i.approved_at INTO v_id, v_status, v_approved FROM invoices i
   WHERE i.kind = 'support' AND i.period_start = p_period_start;
  IF v_id IS NOT NULL AND (v_status <> 'draft' OR v_approved IS NOT NULL) THEN
    PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
    RETURN v_id;
  END IF;
  SELECT s.payment_method INTO v_method FROM subscriptions s LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO invoices (tenant_id, kind, status, period_start, period_end, description, lines,
                          amount_ore, vat_ore, payment_method, send_at)
    VALUES (p_tenant_id, 'support', 'draft', p_period_start, p_period_end, p_description, p_lines,
            p_net, p_vat, coalesce(v_method, 'card'), p_send_at)
    RETURNING id INTO v_id;
  ELSE
    UPDATE invoices SET lines = p_lines, amount_ore = p_net, vat_ore = p_vat,
           description = p_description, payment_method = coalesce(v_method, 'card'), send_at = p_send_at
     WHERE id = v_id;
  END IF;
  UPDATE platform.time_entries SET invoice_id = NULL
   WHERE tenant_id = p_tenant_id AND invoice_id = v_id AND NOT (id = ANY (p_entry_ids));
  UPDATE platform.time_entries SET invoice_id = v_id
   WHERE tenant_id = p_tenant_id AND id = ANY (p_entry_ids) AND (invoice_id IS NULL OR invoice_id = v_id);
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v_id;
END
$$;
--> statement-breakpoint
-- Approve a support draft (F5 "Godkend"): it is numbered and sent at its send time.
CREATE OR REPLACE FUNCTION app.platform_finance_approve(p_tenant_id uuid, p_invoice_id uuid, p_actor text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true); v_n int;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE invoices SET approved_at = now(), approved_by_name = p_actor
   WHERE id = p_invoice_id AND kind = 'support' AND status = 'draft' AND approved_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.platform_finance_audit(p_tenant_id, p_actor, 'invoice.approved', p_invoice_id, '{}'::jsonb);
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- Reminder or payment link (F6): records it and returns where to send it.
CREATE OR REPLACE FUNCTION app.platform_finance_notify(
  p_tenant_id uuid, p_invoice_id uuid, p_kind text, p_actor text
) RETURNS TABLE (email text, tenant_name text, number text, amount_ore integer, due_at timestamptz,
                 reminders integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF p_kind NOT IN ('reminder', 'payment_link') THEN RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  IF p_kind = 'reminder' THEN
    UPDATE invoices SET reminders = invoices.reminders + 1, last_reminder_at = now()
     WHERE id = p_invoice_id AND status IN ('open', 'failed');
  END IF;
  RETURN QUERY
    SELECT tn.billing_email, tn.name, i.number, i.amount_ore + i.vat_ore, i.due_at, i.reminders
      FROM invoices i JOIN tenants tn ON tn.id = i.tenant_id
     WHERE i.id = p_invoice_id AND i.status IN ('open', 'failed');
  IF FOUND THEN
    PERFORM app.platform_finance_audit(p_tenant_id, p_actor,
      CASE p_kind WHEN 'reminder' THEN 'invoice.reminder_sent' ELSE 'invoice.payment_link_sent' END,
      p_invoice_id, '{}'::jsonb);
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
-- Discount on the plan price (F2 "Tilføj rabat").
CREATE OR REPLACE FUNCTION app.platform_finance_discount(
  p_tenant_id uuid, p_pct integer, p_until timestamptz, p_actor text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true); v_id uuid;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF p_pct IS NOT NULL AND (p_pct <= 0 OR p_pct > 100) THEN RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE subscriptions SET discount_pct = p_pct, discount_until = CASE WHEN p_pct IS NULL THEN NULL ELSE p_until END,
         updated_at = now()
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.platform_finance_audit(p_tenant_id, p_actor, 'subscription.discount', v_id,
    jsonb_build_object('pct', p_pct, 'until', p_until));
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.sync_invoice_schedule(), app.due_invoice_jobs(timestamptz),
  app.platform_finance_subscriptions(), app.platform_finance_invoices(timestamptz, timestamptz),
  app.platform_finance_audit(uuid, text, text, uuid, jsonb),
  app.platform_finance_save_draft(uuid, timestamptz, timestamptz, text, jsonb, integer, integer, uuid[], timestamptz),
  app.platform_finance_approve(uuid, uuid, text), app.platform_finance_notify(uuid, uuid, text, text),
  app.platform_finance_discount(uuid, integer, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.due_invoice_jobs(timestamptz) TO agentor_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_finance_subscriptions(),
  app.platform_finance_invoices(timestamptz, timestamptz),
  app.platform_finance_save_draft(uuid, timestamptz, timestamptz, text, jsonb, integer, integer, uuid[], timestamptz),
  app.platform_finance_approve(uuid, uuid, text), app.platform_finance_notify(uuid, uuid, text, text),
  app.platform_finance_discount(uuid, integer, timestamptz, text) TO agentor_web;
