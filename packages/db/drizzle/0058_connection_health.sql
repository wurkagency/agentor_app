-- Connection health (PLAN-INTEGRATIONS-WOO-DINERO §4.5, §5.1): live connections are tested again
-- regularly, so expired OAuth tokens are refreshed and webhooks a shop disabled are switched back on.
-- Across tenants, returning only ids: the worker opens each connection under its own tenant.
CREATE FUNCTION app.due_connection_tests(p_before timestamptz, p_connectors text[])
RETURNS TABLE (tenant_id uuid, connection_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  FOR t IN SELECT d.tenant_id FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY
      SELECT c.tenant_id, c.id FROM connections c
       WHERE c.connector_id = ANY (p_connectors)
         AND c.status <> 'checking'
         AND (c.last_checked_at IS NULL OR c.last_checked_at < p_before)
       ORDER BY c.last_checked_at NULLS FIRST
       LIMIT 200;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.due_connection_tests(timestamptz, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.due_connection_tests(timestamptz, text[]) TO agentor_worker;
