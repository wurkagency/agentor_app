-- Engine scheduling and notifications (M6).

-- Published, unpaused flows whose next poll is due, across tenants. Like due_subscriptions it
-- reveals only ids; the worker re-enters each tenant to do the work.
CREATE OR REPLACE FUNCTION app.due_flows(p_now timestamptz)
RETURNS TABLE (tenant_id uuid, flow_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT f.tenant_id, f.id FROM flows f
   WHERE f.published_version_id IS NOT NULL AND f.paused_at IS NULL
     AND (f.next_run_at IS NULL OR f.next_run_at <= p_now)
   ORDER BY f.next_run_at NULLS FIRST
   LIMIT 500
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.due_flows(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.due_flows(timestamptz) TO agentor_worker;
--> statement-breakpoint
-- The worker applies each member's in-app preferences when it notifies.
GRANT SELECT ON notification_prefs TO agentor_worker;
