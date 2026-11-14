-- Resuming an interrupted charge: the worker finds the order id it registered for an invoice,
-- within the tenant it is already working in (M4).
CREATE OR REPLACE FUNCTION app.resolve_invoice_order(p_invoice_id uuid) RETURNS TABLE (order_id text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT r.order_id FROM app.billing_refs r
   WHERE r.kind = 'invoice' AND r.ref_id = p_invoice_id AND r.tenant_id = app.current_tenant_id()
   ORDER BY r.created_at DESC LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.resolve_invoice_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_invoice_order(uuid) TO agentor_worker;
