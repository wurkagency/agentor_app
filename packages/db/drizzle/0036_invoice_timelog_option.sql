-- F5 "Vedhæft tidslog": Superadmin chooses whether a support draft prints its time log.
CREATE OR REPLACE FUNCTION app.platform_finance_timelog(
  p_tenant_id uuid, p_invoice_id uuid, p_attach boolean, p_actor text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_prev text := current_setting('app.tenant_id', true); v_n int;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE invoices SET attach_timelog = p_attach
   WHERE id = p_invoice_id AND kind = 'support' AND status = 'draft' AND approved_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_finance_timelog(uuid, uuid, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_finance_timelog(uuid, uuid, boolean, text) TO agentor_web;
