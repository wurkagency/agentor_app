-- System Status (A1, MP25): per customer and connector, how many connections there are and how many
-- are broken. Counts only (the app sums them per connector), Superadmin only. PostgreSQL 12 compatible.
CREATE OR REPLACE FUNCTION app.platform_connector_status()
RETURNS TABLE (connector_id text, connections integer, broken integer, checking integer,
               last_checked_at timestamptz, broken_since timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev text := current_setting('app.tenant_id', true);
  t record;
BEGIN
  IF NOT app.is_superadmin() THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  FOR t IN SELECT d.tenant_id FROM app.tenant_directory d LOOP
    PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
    RETURN QUERY
      SELECT c.connector_id, count(*)::int,
             (count(*) FILTER (WHERE c.status = 'broken'))::int,
             (count(*) FILTER (WHERE c.status = 'checking'))::int,
             max(c.last_checked_at), min(c.broken_since)
        FROM connections c GROUP BY c.connector_id;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_connector_status() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_connector_status() TO agentor_web;
