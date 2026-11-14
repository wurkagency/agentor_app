-- E22 "Ugentlig opsummering" (PLAN-EMAILS-PDF §5): who has the weekly e-mail on, as a private
-- index the scheduler can read across tenants (FORCE RLS hides notification_prefs from definer
-- functions, the same pattern as app.flow_schedule). Ids only. PostgreSQL 12 compatible.
CREATE TABLE app.weekly_optins (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_weekly_optin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.event = 'weekly_summary' THEN
    DELETE FROM app.weekly_optins WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.event = 'weekly_summary' AND NEW.email THEN
    INSERT INTO app.weekly_optins (tenant_id, user_id) VALUES (NEW.tenant_id, NEW.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION app.sync_weekly_optin() FROM PUBLIC;
CREATE TRIGGER notification_prefs_weekly AFTER INSERT OR UPDATE OR DELETE ON notification_prefs
  FOR EACH ROW EXECUTE FUNCTION app.sync_weekly_optin();
--> statement-breakpoint
-- Backfill: the migration runs as the owner, which FORCE RLS would otherwise hide all rows from.
ALTER TABLE notification_prefs NO FORCE ROW LEVEL SECURITY;
INSERT INTO app.weekly_optins (tenant_id, user_id)
  SELECT tenant_id, user_id FROM notification_prefs WHERE event = 'weekly_summary' AND email
  ON CONFLICT DO NOTHING;
ALTER TABLE notification_prefs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Monday 08:00: everyone who has it on. The worker re-checks membership and the preference.
CREATE OR REPLACE FUNCTION app.weekly_summary_recipients()
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$ SELECT w.tenant_id, w.user_id FROM app.weekly_optins w ORDER BY w.tenant_id $$;
REVOKE EXECUTE ON FUNCTION app.weekly_summary_recipients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.weekly_summary_recipients() TO agentor_worker;
