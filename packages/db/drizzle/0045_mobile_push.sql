CREATE TABLE "push_subscriptions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"events" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("tenant_id","user_id","endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_https" CHECK ("push_subscriptions"."endpoint" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Mobile and PWA (PLAN-MOBILE M3): Web Push subscriptions, the push queue, and the customer's
-- running support total (MA15). Works on PostgreSQL 12 (production) and 16.

-- Subscriptions: tenant isolation, and each user sees and changes only their own devices --------
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_subscriptions
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY push_subscriptions_own ON push_subscriptions AS RESTRICTIVE TO agentor_web
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO agentor_web;
-- The worker sends and removes subscriptions the push service has dropped (404/410).
GRANT SELECT, DELETE ON push_subscriptions TO agentor_worker;
--> statement-breakpoint

-- Push queue: a private index the worker drains across tenants (FORCE RLS hides notifications
-- from definer functions, the same pattern as app.flow_schedule). Ids only, no message content.
CREATE TABLE app.push_queue (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('new', 'resolved')),
  not_before timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, kind)
);
CREATE INDEX push_queue_due_idx ON app.push_queue (not_before);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.queue_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app.push_queue (tenant_id, notification_id, user_id, kind)
    VALUES (NEW.tenant_id, NEW.id, NEW.user_id, 'new')
    ON CONFLICT DO NOTHING;
  ELSIF NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL AND NEW.needs_action THEN
    -- "Fejlen er løst" (MA14) for problems the user was told about.
    INSERT INTO app.push_queue (tenant_id, notification_id, user_id, kind)
    VALUES (NEW.tenant_id, NEW.id, NEW.user_id, 'resolved')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER notifications_push AFTER INSERT OR UPDATE OF resolved_at ON notifications
  FOR EACH ROW EXECUTE FUNCTION app.queue_push();
--> statement-breakpoint
-- Due pushes, oldest first. Entries older than a day are dropped: a late push misleads.
CREATE OR REPLACE FUNCTION app.due_pushes(p_now timestamptz)
RETURNS TABLE (id bigint, tenant_id uuid, notification_id uuid, user_id uuid, kind text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM app.push_queue q WHERE q.created_at < p_now - interval '1 day';
  RETURN QUERY
    SELECT q.id, q.tenant_id, q.notification_id, q.user_id, q.kind FROM app.push_queue q
     WHERE q.not_before <= p_now
     ORDER BY q.created_at
     LIMIT 200;
END
$$;
CREATE OR REPLACE FUNCTION app.push_done(p_id bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ DELETE FROM app.push_queue WHERE id = p_id $$;
-- Quiet hours: hold the push until the morning (MA11 "fejl samles til morgen").
CREATE OR REPLACE FUNCTION app.push_defer(p_id bigint, p_until timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ UPDATE app.push_queue SET not_before = p_until WHERE id = p_id $$;
REVOKE EXECUTE ON FUNCTION app.due_pushes(timestamptz), app.push_done(bigint),
  app.push_defer(bigint, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.due_pushes(timestamptz), app.push_done(bigint),
  app.push_defer(bigint, timestamptz) TO agentor_worker;
-- The worker reads the notification, the user's quiet hours and locale under tenant context.
GRANT SELECT ON notifications, notification_settings TO agentor_worker;
--> statement-breakpoint

-- MA15 "Support i oktober": this company's support time in the current month, as it will be
-- invoiced (decision 18, B1): billable time on cases, each entry rounded up to 15 minutes, at the
-- platform rate. Only the totals leave the platform schema; no staff names, notes or cases.
CREATE OR REPLACE FUNCTION app.customer_support_month()
RETURNS TABLE (registered_minutes integer, billed_minutes integer, rate_ore integer)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    coalesce(sum(t.minutes), 0)::integer,
    coalesce(sum(((t.minutes + 14) / 15) * 15), 0)::integer,
    coalesce((SELECT (s.value #>> '{}')::integer FROM platform.settings s WHERE s.key = 'hourlyRateOre'), 64000)
  FROM platform.time_entries t
  WHERE t.tenant_id = app.current_tenant_id() AND app.is_tenant_owner()
    AND t.billable AND t.case_id IS NOT NULL AND t.invoice_id IS NULL
    AND t.work_date >= date_trunc('month', now() AT TIME ZONE 'Europe/Copenhagen')::date
$$;
REVOKE EXECUTE ON FUNCTION app.customer_support_month() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.customer_support_month() TO agentor_web;
