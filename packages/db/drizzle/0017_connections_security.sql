-- Connections, webhooks and the key box (M5): RLS, privileges and the ingest path.

ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON inbound_events
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

-- Who may manage connections (produktspecifikation §6, PLAN Q: developers may create them).
CREATE OR REPLACE FUNCTION app.can_manage_connections() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = app.current_user_id() AND m.role IN ('owner', 'admin', 'developer')
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.can_manage_connections() TO agentor_web;
--> statement-breakpoint
-- Everyone in the tenant can see connections (status, account); only managers can change them.
CREATE POLICY connections_manage_insert ON connections AS RESTRICTIVE FOR INSERT TO agentor_web
  WITH CHECK (app.can_manage_connections());
CREATE POLICY connections_manage_update ON connections AS RESTRICTIVE FOR UPDATE TO agentor_web
  USING (app.can_manage_connections()) WITH CHECK (app.can_manage_connections());
CREATE POLICY connections_manage_delete ON connections AS RESTRICTIVE FOR DELETE TO agentor_web
  USING (app.can_manage_connections());
--> statement-breakpoint
-- The worker records test results and webhook times; web never reads inbound payloads.
GRANT SELECT, UPDATE ON connections TO agentor_worker;
GRANT SELECT, UPDATE, DELETE ON inbound_events TO agentor_worker;
--> statement-breakpoint

-- Webhook routes: unguessable token per connection, stored as SHA-256. Resolvable without tenant
-- context (the request carries no session), so it is a private index like invitation tokens.
CREATE TABLE app.webhook_routes (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES connections (tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.register_webhook(p_token_hash text, p_connection_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'tenant context missing' USING ERRCODE = '42501';
  END IF;
  -- The connection must exist in the caller's tenant (and be visible to the caller).
  IF NOT EXISTS (SELECT 1 FROM connections c
                 WHERE c.id = p_connection_id AND c.tenant_id = app.current_tenant_id()) THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = '42501';
  END IF;
  DELETE FROM app.webhook_routes WHERE connection_id = p_connection_id
    AND tenant_id = app.current_tenant_id();
  INSERT INTO app.webhook_routes (token_hash, tenant_id, connection_id)
  VALUES (p_token_hash, app.current_tenant_id(), p_connection_id);
END
$$;
--> statement-breakpoint
-- Called by agentor-ingest (database role agentor_web, no session): stores the raw event for an
-- existing route and returns its id. Unknown tokens return nothing, so ingest answers 404.
CREATE OR REPLACE FUNCTION app.ingest_webhook(p_token_hash text, p_headers jsonb, p_body bytea)
RETURNS TABLE (event_id uuid, tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  r app.webhook_routes%ROWTYPE;
  v_id uuid;
BEGIN
  IF length(p_body) > 1048576 THEN
    RAISE EXCEPTION 'body too large' USING ERRCODE = '54000';
  END IF;
  SELECT * INTO r FROM app.webhook_routes w WHERE w.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM set_config('app.tenant_id', r.tenant_id::text, true);
  INSERT INTO inbound_events (tenant_id, connection_id, headers, body)
  VALUES (r.tenant_id, r.connection_id, p_headers, p_body)
  RETURNING id INTO v_id;
  PERFORM set_config('app.tenant_id', '', true);
  event_id := v_id;
  tenant_id := r.tenant_id;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.register_webhook(text, uuid), app.ingest_webhook(text, jsonb, bytea)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_webhook(text, uuid) TO agentor_web;
GRANT EXECUTE ON FUNCTION app.ingest_webhook(text, jsonb, bytea) TO agentor_web;
