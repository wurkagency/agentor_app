-- Agentor support under a help grant manages the customer's connections like a Developer, so it
-- can support and test integrations (26 Oct 2026): add, test, reconnect, change and delete.
-- Keys stay sealed with the KEK's public half, which the web can't open; every change is logged
-- as support in the customer's audit log. A view grant still only reads. This replaces the
-- "never connections" of 0024's support_scope(); team, billing and settings stay closed.
CREATE OR REPLACE FUNCTION app.can_manage_connections() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = app.current_user_id() AND m.role IN ('owner', 'admin', 'developer')
  ) OR coalesce(app.support_scope() = 'help', false)
$$;
