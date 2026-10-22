CREATE TABLE "credit_note_lines" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"source_index" integer NOT NULL,
	"text" text NOT NULL,
	"detail" text,
	"unit" text NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit_price_ore" integer,
	"amount_ore" integer NOT NULL,
	CONSTRAINT "credit_note_lines_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "credit_note_lines_amount_check" CHECK ("credit_note_lines"."amount_ore" < 0 and "credit_note_lines"."quantity_milli" <= 0),
	CONSTRAINT "credit_note_lines_unit_check" CHECK ("credit_note_lines"."unit" in ('hours', 'pieces'))
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_issued_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"refund_method" text NOT NULL,
	"refund_state" text DEFAULT 'none' NOT NULL,
	"refund_payment_id" text,
	"refunded_at" timestamp with time zone,
	"offset_invoice_id" uuid,
	"net_ore" integer NOT NULL,
	"vat_ore" integer NOT NULL,
	"created_by_user_id" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "credit_notes_number_key" UNIQUE("number"),
	CONSTRAINT "credit_notes_amounts_check" CHECK ("credit_notes"."net_ore" < 0 and "credit_notes"."vat_ore" <= 0),
	CONSTRAINT "credit_notes_refund_method_check" CHECK ("credit_notes"."refund_method" in ('card', 'offset')),
	CONSTRAINT "credit_notes_refund_state_check" CHECK ("credit_notes"."refund_state" in ('none', 'pending', 'done', 'failed')),
	CONSTRAINT "credit_notes_number_format" CHECK ("credit_notes"."number" ~ '^K-[0-9]{4}-[0-9]{4,}$')
);
--> statement-breakpoint
-- Customer numbers ("Kundenr. K-1042" on I01/I02) come from a sequence; existing companies are
-- renumbered in creation order below.
CREATE SEQUENCE app.customer_number_seq START 1001;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "customer_number" integer DEFAULT nextval('app.customer_number_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_tenant_id_credit_note_id_credit_notes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","credit_note_id") REFERENCES "public"."credit_notes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_invoice_id_invoices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("tenant_id","invoice_id");
--> statement-breakpoint

-- Invoices and credit notes as documents (PLAN-EMAILS-PDF §6–7, boards I01/I02).
-- PostgreSQL 12 compatible. Superadmin works through SECURITY DEFINER functions that check the
-- role; customers (owners) read their own credit notes through RLS like their invoices.

-- Customer numbers: existing companies in creation order, then unique ---------------------------
ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
UPDATE tenants t SET customer_number = s.n
  FROM (SELECT id, 1000 + row_number() OVER (ORDER BY created_at, id) AS n FROM tenants) s
 WHERE s.id = t.id;
SELECT setval('app.customer_number_seq', greatest(1000, coalesce((SELECT max(customer_number) FROM tenants), 1000)));
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE tenants ADD CONSTRAINT tenants_customer_number_key UNIQUE (customer_number);
--> statement-breakpoint

-- Credit notes: tenant isolation; owners read them as they read invoices ------------------------
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_notes
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON credit_note_lines
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY credit_notes_owner_read ON credit_notes AS RESTRICTIVE FOR SELECT TO agentor_web
  USING (app.is_tenant_owner());
CREATE POLICY credit_note_lines_owner_read ON credit_note_lines AS RESTRICTIVE FOR SELECT TO agentor_web
  USING (app.is_tenant_owner());
GRANT SELECT ON credit_notes, credit_note_lines TO agentor_web;
-- The worker sets a credit off against the next invoice (prepareCharge).
GRANT SELECT, UPDATE (offset_invoice_id) ON credit_notes TO agentor_worker;
GRANT SELECT ON credit_note_lines TO agentor_worker;
--> statement-breakpoint

-- K-ÅÅÅÅ-nnnn without gaps: one counter row per year, taken under a row lock in the same
-- transaction as the credit note. A rolled-back credit note gives its number back.
CREATE TABLE app.credit_note_counters (
  year integer PRIMARY KEY,
  last integer NOT NULL CHECK (last > 0)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.next_credit_note_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year integer := extract(year FROM now() AT TIME ZONE 'Europe/Copenhagen')::integer;
  v_n integer;
BEGIN
  INSERT INTO app.credit_note_counters AS c (year, last) VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE SET last = c.last + 1
  RETURNING c.last INTO v_n;
  RETURN 'K-' || v_year || '-' || CASE WHEN v_n < 10000 THEN lpad(v_n::text, 4, '0') ELSE v_n::text END;
END
$$;
--> statement-breakpoint
-- Only app.create_credit_note() takes numbers; nobody else may use one up.
REVOKE EXECUTE ON FUNCTION app.next_credit_note_number() FROM PUBLIC, agentor_worker;
DROP SEQUENCE IF EXISTS app.credit_note_number_seq;
--> statement-breakpoint

-- Who may read an invoice or credit note: Superadmin, or an owner of that company.
CREATE OR REPLACE FUNCTION app.can_read_billing(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT app.is_superadmin() OR (p_tenant = app.current_tenant_id() AND app.is_tenant_owner())
$$;
GRANT EXECUTE ON FUNCTION app.can_read_billing(uuid) TO agentor_web;
--> statement-breakpoint

-- The invoice's lines as printed (I01): a subscription invoice's plan line first (what is left
-- after the extra lines), then the extra lines; a support invoice's case lines. Indexes are what
-- credit notes refer to. Runs in the invoice's tenant context.
CREATE OR REPLACE FUNCTION app.invoice_lines(p_invoice uuid)
RETURNS TABLE (idx integer, text text, detail text, unit text, quantity_milli integer,
               unit_price_ore integer, amount_ore integer, case_number integer,
               registered_minutes integer, billed_minutes integer, log jsonb)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  i record;
  v_extra integer;
  v_base integer;
BEGIN
  SELECT * INTO i FROM invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum((l ->> 'amountOre')::integer), 0) INTO v_extra
    FROM jsonb_array_elements(i.lines) l;
  v_base := CASE WHEN i.kind = 'subscription' THEN 1 ELSE 0 END;
  IF i.kind = 'subscription' AND i.amount_ore - v_extra <> 0 THEN
    RETURN QUERY SELECT 0, i.description, NULL::text, 'pieces'::text, 1000,
                        i.amount_ore - v_extra, i.amount_ore - v_extra,
                        NULL::integer, NULL::integer, NULL::integer, NULL::jsonb;
  END IF;
  RETURN QUERY
    SELECT (o.n - 1 + v_base)::integer,
           l ->> 'text',
           l ->> 'detail',
           CASE WHEN l ? 'billedMinutes' THEN 'hours' ELSE 'pieces' END,
           CASE WHEN l ? 'billedMinutes' THEN ((l ->> 'billedMinutes')::integer * 1000 / 60) ELSE 1000 END,
           CASE WHEN l ? 'rateOre' THEN (l ->> 'rateOre')::integer ELSE (l ->> 'amountOre')::integer END,
           (l ->> 'amountOre')::integer,
           (l ->> 'caseNumber')::integer,
           (l ->> 'registeredMinutes')::integer,
           (l ->> 'billedMinutes')::integer,
           l -> 'log'
      FROM jsonb_array_elements(i.lines) WITH ORDINALITY AS o(l, n);
END
$$;
--> statement-breakpoint

-- Per line: the amount, what has been credited so far and what is left (I02 "delvis kredit").
-- Only money the customer paid can be credited: negative lines (a discount, a set-off credit
-- note) are taken off the first positive lines, and lines left at 0 are not creditable.
CREATE OR REPLACE FUNCTION app.invoice_credit_state(p_invoice uuid)
RETURNS TABLE (idx integer, text text, detail text, unit text, quantity_milli integer,
               unit_price_ore integer, amount_ore integer, credited_ore integer,
               credited_milli integer)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_less integer;
  v_take integer;
  r record;
BEGIN
  SELECT coalesce(-sum(x.amount_ore), 0) INTO v_less
    FROM app.invoice_lines(p_invoice) x WHERE x.amount_ore < 0;
  FOR r IN
    SELECT l.idx AS i, l.text AS t, l.detail AS d, l.unit AS u, l.quantity_milli AS q,
           l.unit_price_ore AS p, l.amount_ore AS a,
           coalesce(-sum(cl.amount_ore), 0)::integer AS ca,
           coalesce(-sum(cl.quantity_milli), 0)::integer AS cq
      FROM app.invoice_lines(p_invoice) l
      LEFT JOIN credit_note_lines cl ON cl.source_index = l.idx
           AND cl.credit_note_id IN (SELECT c.id FROM credit_notes c WHERE c.invoice_id = p_invoice)
     WHERE l.amount_ore > 0
     GROUP BY l.idx, l.text, l.detail, l.unit, l.quantity_milli, l.unit_price_ore, l.amount_ore
     ORDER BY l.idx
  LOOP
    v_take := least(v_less, r.a);
    v_less := v_less - v_take;
    CONTINUE WHEN r.a - v_take <= 0;
    idx := r.i; text := r.t; detail := r.d; unit := r.u; quantity_milli := r.q;
    amount_ore := r.a - v_take;
    -- A reduced line of pieces is priced at what was paid for it.
    unit_price_ore := CASE WHEN v_take > 0 AND r.u = 'pieces' THEN amount_ore * 1000 / r.q ELSE r.p END;
    credited_ore := r.ca; credited_milli := r.cq;
    RETURN NEXT;
  END LOOP;
END
$$;
--> statement-breakpoint

-- Superadmin: the lines of one invoice with what can still be credited (the "Kreditér" sheet).
CREATE OR REPLACE FUNCTION app.platform_invoice_credit_state(p_tenant uuid, p_invoice uuid)
RETURNS TABLE (idx integer, text text, detail text, unit text, quantity_milli integer,
               unit_price_ore integer, amount_ore integer, credited_ore integer,
               credited_milli integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  RETURN QUERY SELECT * FROM app.invoice_credit_state(p_invoice);
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- Creates a credit note (I02). p_lines: null for a full credit of what is left, otherwise
-- [{"idx": 0, "quantityMilli": 500, "amountOre": 32000}] with positive numbers to credit.
-- The sum can never exceed what is still uncredited, per line and in total; the invoice is
-- locked while this runs, so two credit notes at once can't both pass the check.
CREATE OR REPLACE FUNCTION app.create_credit_note(
  p_tenant uuid, p_invoice uuid, p_lines jsonb, p_reason text, p_refund text, p_staff_name text
) RETURNS TABLE (id uuid, number text, net_ore integer, vat_ore integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  v_user uuid := app.current_user_id();
  i record;
  l record;
  req jsonb;
  v_id uuid;
  v_number text;
  v_net integer := 0;
  v_vat integer;
  v_credited_net integer;
  v_credited_vat integer;
  v_amount integer;
  v_qty integer;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_reason), '') = '' OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_refund NOT IN ('card', 'offset') THEN
    RAISE EXCEPTION 'REFUND_METHOD_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT * INTO i FROM invoices inv WHERE inv.id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF i.status NOT IN ('open', 'paid', 'failed') OR i.number IS NULL THEN
    RAISE EXCEPTION 'INVOICE_NOT_ISSUED' USING ERRCODE = '22023';
  END IF;
  IF p_refund = 'card' AND (i.status <> 'paid' OR i.provider_payment_id IS NULL
                            OR i.payment_method NOT IN ('card', 'mobilepay')) THEN
    RAISE EXCEPTION 'REFUND_NOT_POSSIBLE' USING ERRCODE = '22023';
  END IF;

  FOR l IN SELECT * FROM app.invoice_credit_state(p_invoice) LOOP
    IF p_lines IS NULL THEN
      v_amount := l.amount_ore - l.credited_ore;
      v_qty := l.quantity_milli - l.credited_milli;
    ELSE
      req := NULL;
      SELECT r INTO req FROM jsonb_array_elements(p_lines) r WHERE (r ->> 'idx')::integer = l.idx LIMIT 1;
      IF req IS NULL THEN CONTINUE; END IF;
      v_amount := (req ->> 'amountOre')::integer;
      v_qty := (req ->> 'quantityMilli')::integer;
      IF v_amount IS NULL OR v_amount <= 0 OR v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'LINE_INVALID' USING ERRCODE = '22023';
      END IF;
      IF v_amount > l.amount_ore - l.credited_ore OR v_qty > l.quantity_milli - l.credited_milli THEN
        RAISE EXCEPTION 'CREDIT_EXCEEDS_INVOICE' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_amount <= 0 THEN CONTINUE; END IF;
    v_net := v_net + v_amount;
    v_lines := v_lines || jsonb_build_object(
      'idx', l.idx, 'text', l.text, 'detail', l.detail, 'unit', l.unit,
      'quantityMilli', -greatest(v_qty, 0), 'unitPriceOre', l.unit_price_ore, 'amountOre', -v_amount);
  END LOOP;
  IF p_lines IS NOT NULL AND jsonb_array_length(v_lines) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'LINE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_net <= 0 THEN RAISE EXCEPTION 'NOTHING_TO_CREDIT' USING ERRCODE = '22023'; END IF;

  -- Totals across earlier credit notes: never more than the invoice, net or VAT.
  SELECT coalesce(-sum(c.net_ore), 0), coalesce(-sum(c.vat_ore), 0)
    INTO v_credited_net, v_credited_vat
    FROM credit_notes c WHERE c.invoice_id = p_invoice;
  IF v_credited_net + v_net > i.amount_ore THEN
    RAISE EXCEPTION 'CREDIT_EXCEEDS_INVOICE' USING ERRCODE = '22023';
  END IF;
  -- VAT in proportion; what is left when the whole net is credited, so the cents add up.
  v_vat := CASE WHEN v_credited_net + v_net = i.amount_ore THEN i.vat_ore - v_credited_vat
                WHEN i.amount_ore = 0 THEN 0
                ELSE least(i.vat_ore - v_credited_vat, round(v_net::numeric * i.vat_ore / i.amount_ore)::integer) END;

  v_number := app.next_credit_note_number();
  INSERT INTO credit_notes (tenant_id, number, invoice_id, invoice_number, invoice_issued_at, reason,
                            refund_method, net_ore, vat_ore, created_by_user_id, created_by_name)
  VALUES (p_tenant, v_number, p_invoice, i.number, coalesce(i.issued_at, i.period_start), btrim(p_reason),
          p_refund, -v_net, -v_vat, v_user, p_staff_name)
  RETURNING credit_notes.id INTO v_id;
  INSERT INTO credit_note_lines (tenant_id, credit_note_id, source_index, text, detail, unit,
                                 quantity_milli, unit_price_ore, amount_ore)
  SELECT p_tenant, v_id, (x ->> 'idx')::integer, x ->> 'text', x ->> 'detail', x ->> 'unit',
         (x ->> 'quantityMilli')::integer, (x ->> 'unitPriceOre')::integer, (x ->> 'amountOre')::integer
    FROM jsonb_array_elements(v_lines) x;
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (p_tenant, v_user, 'support', p_staff_name, 'credit_note.created', 'credit_note', v_id,
          jsonb_build_object('number', v_number, 'invoice', i.number, 'netOre', -v_net, 'vatOre', -v_vat,
                             'refund', p_refund, 'full', p_lines IS NULL));
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN QUERY SELECT v_id, v_number, -v_net, -v_vat;
END
$$;
--> statement-breakpoint

-- Card refunds: claimed once (none/failed → pending) before QuickPay is called, so a double
-- click or a retry never refunds twice; marked done only on QuickPay's confirmation.
CREATE OR REPLACE FUNCTION app.credit_note_refund_claim(p_tenant uuid, p_id uuid)
RETURNS TABLE (payment_id text, gross_ore integer, number text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  RETURN QUERY
    UPDATE credit_notes c SET refund_state = 'pending'
      FROM invoices i
     WHERE c.id = p_id AND c.refund_method = 'card' AND c.refund_state IN ('none', 'failed')
       AND i.id = c.invoice_id
    RETURNING i.provider_payment_id, -(c.net_ore + c.vat_ore), c.number;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.credit_note_refund_result(
  p_tenant uuid, p_id uuid, p_ok boolean, p_refund_id text, p_staff_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  UPDATE credit_notes SET refund_state = CASE WHEN p_ok THEN 'done' ELSE 'failed' END,
         refund_payment_id = coalesce(p_refund_id, refund_payment_id),
         refunded_at = CASE WHEN p_ok THEN now() ELSE refunded_at END
   WHERE id = p_id AND refund_state = 'pending';
  IF NOT FOUND THEN
    PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
    RETURN;
  END IF;
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (p_tenant, app.current_user_id(), 'support', p_staff_name,
          CASE WHEN p_ok THEN 'credit_note.refunded' ELSE 'credit_note.refund_failed' END,
          'credit_note', p_id, jsonb_build_object('refund', p_refund_id));
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- Superadmin's list of credit notes across companies (F4, F6).
CREATE OR REPLACE FUNCTION app.platform_finance_credit_notes()
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
    RETURN QUERY SELECT to_jsonb(c) || jsonb_build_object('tenant_name', t.name) FROM credit_notes c;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- Agentor's own details for the documents (Administration › Produkt, Superadmin edits them).
-- They are printed on every invoice, so any reader of an invoice may read them here.
CREATE OR REPLACE FUNCTION app.billing_seller() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    FROM platform.settings s
   WHERE s.key IN ('companyName', 'companyAddress', 'companyPostalCity', 'companyCvr',
                   'companyEmail', 'bankReg', 'bankAccount', 'bankIban')
$$;
--> statement-breakpoint

-- Everything one invoice PDF needs, for Superadmin or an owner of the company; null otherwise.
CREATE OR REPLACE FUNCTION app.invoice_document(p_tenant uuid, p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  v jsonb;
BEGIN
  IF NOT app.can_read_billing(p_tenant) THEN RETURN NULL; END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT jsonb_build_object(
           'invoice', to_jsonb(i) - 'lines',
           'lines', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.idx) FROM app.invoice_lines(i.id) l), '[]'::jsonb),
           'tenant', jsonb_build_object('name', tn.name, 'addressLine', tn.address_line,
                                        'postalCode', tn.postal_code, 'city', tn.city, 'cvr', tn.cvr,
                                        'billingEmail', tn.billing_email, 'customerNumber', tn.customer_number),
           'subscription', (SELECT jsonb_build_object('cardBrand', s.card_brand, 'cardLast4', s.card_last4,
                                                      'ean', s.ean, 'interval', s.interval, 'plan', p.name)
                              FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id LIMIT 1),
           'seller', app.billing_seller())
    INTO v
    FROM invoices i JOIN tenants tn ON tn.id = i.tenant_id
   WHERE i.id = p_invoice AND i.status <> 'draft';
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v;
END
$$;
--> statement-breakpoint

-- Everything one credit note PDF needs, for Superadmin or an owner of the company.
CREATE OR REPLACE FUNCTION app.credit_note_document(p_tenant uuid, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  v jsonb;
BEGIN
  IF NOT app.can_read_billing(p_tenant) THEN RETURN NULL; END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT jsonb_build_object(
           'creditNote', to_jsonb(c),
           'lines', coalesce((SELECT jsonb_agg(to_jsonb(cl) ORDER BY cl.source_index) FROM credit_note_lines cl
                               WHERE cl.credit_note_id = c.id), '[]'::jsonb),
           'invoice', jsonb_build_object('grossOre', i.amount_ore + i.vat_ore, 'paymentMethod', i.payment_method),
           'creditedGrossOre', (SELECT -coalesce(sum(x.net_ore + x.vat_ore), 0) FROM credit_notes x
                                 WHERE x.invoice_id = c.invoice_id AND x.created_at <= c.created_at),
           'tenant', jsonb_build_object('name', tn.name, 'addressLine', tn.address_line,
                                        'postalCode', tn.postal_code, 'city', tn.city, 'cvr', tn.cvr,
                                        'billingEmail', tn.billing_email, 'customerNumber', tn.customer_number),
           'subscription', (SELECT jsonb_build_object('cardBrand', s.card_brand, 'cardLast4', s.card_last4)
                              FROM subscriptions s LIMIT 1),
           'seller', app.billing_seller())
    INTO v
    FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id JOIN tenants tn ON tn.id = c.tenant_id
   WHERE c.id = p_id;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
  RETURN v;
END
$$;
--> statement-breakpoint

-- Rendered PDFs (PLAN-EMAILS-PDF §6.3): one immutable file per document and state, kept in
-- object storage with its SHA-256. A paid invoice gets its own file next to the open one.
CREATE TABLE app.documents (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  ref_id uuid NOT NULL,
  variant text NOT NULL CHECK (length(variant) BETWEEN 1 AND 40),
  storage_key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer NOT NULL CHECK (bytes > 0),
  filename text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, ref_id, variant)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.document_find(p_tenant uuid, p_kind text, p_ref uuid, p_variant text)
RETURNS TABLE (id uuid, storage_key text, sha256 text, filename text)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT app.can_read_billing(p_tenant) THEN RETURN; END IF;
  RETURN QUERY SELECT d.id, d.storage_key, d.sha256, d.filename FROM app.documents d
    WHERE d.tenant_id = p_tenant AND d.kind = p_kind AND d.ref_id = p_ref AND d.variant = p_variant;
END
$$;
--> statement-breakpoint
-- Saves the first rendering; a second one for the same state keeps the first (immutable).
CREATE OR REPLACE FUNCTION app.document_save(
  p_tenant uuid, p_kind text, p_ref uuid, p_variant text, p_key text, p_sha text, p_bytes integer,
  p_filename text
) RETURNS TABLE (id uuid, storage_key text, sha256 text, filename text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT app.can_read_billing(p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  INSERT INTO app.documents (tenant_id, kind, ref_id, variant, storage_key, sha256, bytes, filename)
  VALUES (p_tenant, p_kind, p_ref, p_variant, p_key, p_sha, p_bytes, p_filename)
  ON CONFLICT (tenant_id, kind, ref_id, variant) DO NOTHING;
  RETURN QUERY SELECT d.id, d.storage_key, d.sha256, d.filename FROM app.documents d
    WHERE d.tenant_id = p_tenant AND d.kind = p_kind AND d.ref_id = p_ref AND d.variant = p_variant;
END
$$;
--> statement-breakpoint
-- The signed download link (/api/documents/<id>?exp&sig) carries the proof; this only resolves
-- the id to the stored file.
CREATE OR REPLACE FUNCTION app.document_by_id(p_id uuid)
RETURNS TABLE (storage_key text, sha256 text, filename text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$ SELECT d.storage_key, d.sha256, d.filename FROM app.documents d WHERE d.id = p_id $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.invoice_lines(uuid), app.invoice_credit_state(uuid),
  app.platform_invoice_credit_state(uuid, uuid),
  app.create_credit_note(uuid, uuid, jsonb, text, text, text),
  app.credit_note_refund_claim(uuid, uuid),
  app.credit_note_refund_result(uuid, uuid, boolean, text, text),
  app.platform_finance_credit_notes(), app.billing_seller(), app.invoice_document(uuid, uuid),
  app.credit_note_document(uuid, uuid), app.document_find(uuid, text, uuid, text),
  app.document_save(uuid, text, uuid, text, text, text, integer, text),
  app.document_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_invoice_credit_state(uuid, uuid),
  app.create_credit_note(uuid, uuid, jsonb, text, text, text),
  app.credit_note_refund_claim(uuid, uuid),
  app.credit_note_refund_result(uuid, uuid, boolean, text, text),
  app.platform_finance_credit_notes(), app.invoice_document(uuid, uuid),
  app.credit_note_document(uuid, uuid), app.document_find(uuid, text, uuid, text),
  app.document_save(uuid, text, uuid, text, text, text, integer, text),
  app.document_by_id(uuid) TO agentor_web;
-- The worker sets credits off against the next invoice inside the tenant context.
GRANT EXECUTE ON FUNCTION app.invoice_lines(uuid) TO agentor_worker;
