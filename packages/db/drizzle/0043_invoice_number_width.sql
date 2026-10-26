-- Invoice numbers are INV/YYYY/XXXXX, credit notes CRED/YYYY/XXXXX: two unbroken series, at least
-- five digits and never truncated (the old lpad(n, 4) cut 10003 to "1000" and collided).
-- Numbers already issued keep their old form. The series run on across years.
CREATE OR REPLACE FUNCTION app.next_invoice_number() RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT 'INV/' || to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'YYYY') || '/' ||
         CASE WHEN n < 100000 THEN lpad(n::text, 5, '0') ELSE n::text END
    FROM (SELECT nextval('app.invoice_number_seq') AS n) s
$$;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS app.credit_note_number_seq START 1;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.next_credit_note_number() RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT 'CRED/' || to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'YYYY') || '/' ||
         CASE WHEN n < 100000 THEN lpad(n::text, 5, '0') ELSE n::text END
    FROM (SELECT nextval('app.credit_note_number_seq') AS n) s
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.next_credit_note_number() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.next_credit_note_number() TO agentor_worker;
