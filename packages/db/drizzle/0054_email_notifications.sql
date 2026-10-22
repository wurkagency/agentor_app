ALTER TABLE "usage_counters" ADD COLUMN "quota_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."cases" ADD COLUMN "reply_token" text;--> statement-breakpoint
ALTER TABLE "platform"."cases" ADD CONSTRAINT "cases_reply_token_key" UNIQUE("reply_token");
--> statement-breakpoint

-- E-mails (PLAN-EMAILS-PDF §5, README decision 26): the notification e-mail queue (E19–E22),
-- one-click unsubscribe (E22) and replies to a resolved case by e-mail (E12). Only ids and keys
-- are stored; mail content is built when it is sent. PostgreSQL 12 compatible.

-- The queue the worker drains across tenants, like app.push_queue. One row per recipient and
-- event key: the key makes every e-mail idempotent (a notification id, "quota:2026-10",
-- "week:2026-W42"). Sent rows stay as the record that the e-mail went out.
CREATE TABLE app.email_queue (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('connection_broken', 'systematic_error', 'quota', 'weekly_summary')),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  notification_id uuid,
  not_before timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  message_id text,
  UNIQUE (tenant_id, user_id, event, dedupe_key)
);
CREATE INDEX email_queue_due_idx ON app.email_queue (not_before) WHERE sent_at IS NULL;
--> statement-breakpoint
-- Called inside the tenant's context (worker notify(), scheduler weekly job): queues for that
-- tenant only. Returns false when the key was queued before (nothing is sent twice).
CREATE OR REPLACE FUNCTION app.queue_email(
  p_tenant uuid, p_user uuid, p_event text, p_key text, p_notification uuid, p_not_before timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN
    RAISE EXCEPTION 'TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.email_queue (tenant_id, user_id, event, dedupe_key, notification_id, not_before)
  VALUES (p_tenant, p_user, p_event, p_key, p_notification, coalesce(p_not_before, now()))
  ON CONFLICT (tenant_id, user_id, event, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END
$$;
--> statement-breakpoint
-- Due e-mails, oldest first. Unsent rows older than two days are dropped: a late alert misleads.
-- After five failed attempts a row stays unsent and is no longer returned.
CREATE OR REPLACE FUNCTION app.due_emails(p_now timestamptz)
RETURNS TABLE (id bigint, tenant_id uuid, user_id uuid, event text, dedupe_key text,
               notification_id uuid, attempts integer, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM app.email_queue q WHERE q.sent_at IS NULL AND q.created_at < p_now - interval '2 days';
  RETURN QUERY
    SELECT q.id, q.tenant_id, q.user_id, q.event, q.dedupe_key, q.notification_id, q.attempts, q.created_at
      FROM app.email_queue q
     WHERE q.sent_at IS NULL AND q.not_before <= p_now AND q.attempts < 5
     ORDER BY q.created_at
     LIMIT 100;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.email_sent(p_id bigint, p_message_id text) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ UPDATE app.email_queue SET sent_at = now(), message_id = left(p_message_id, 300) WHERE id = p_id $$;
--> statement-breakpoint
-- Not sent and not to be: the recipient turned e-mail off or left the company, or the row was
-- merged into another e-mail (quiet hours). Marked done without a message id; never retried.
CREATE OR REPLACE FUNCTION app.email_skip(p_id bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ UPDATE app.email_queue SET sent_at = now(), message_id = NULL WHERE id = p_id $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.email_defer(p_id bigint, p_until timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ UPDATE app.email_queue SET not_before = p_until WHERE id = p_id $$;
--> statement-breakpoint
-- A failed send: try again after 1, 4, 9 and 16 minutes.
CREATE OR REPLACE FUNCTION app.email_failed(p_id bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE app.email_queue
     SET attempts = attempts + 1, not_before = now() + make_interval(mins => (attempts + 1) * (attempts + 1))
   WHERE id = p_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.queue_email(uuid, uuid, text, text, uuid, timestamptz),
  app.due_emails(timestamptz), app.email_sent(bigint, text), app.email_skip(bigint),
  app.email_defer(bigint, timestamptz), app.email_failed(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.queue_email(uuid, uuid, text, text, uuid, timestamptz),
  app.due_emails(timestamptz), app.email_sent(bigint, text), app.email_skip(bigint),
  app.email_defer(bigint, timestamptz), app.email_failed(bigint) TO agentor_worker;
-- The worker reads the recipient's preferences and the usage counter, and marks E21 as sent.
GRANT SELECT ON notification_prefs, usage_counters TO agentor_worker;
GRANT UPDATE (quota_notified_at) ON usage_counters TO agentor_worker;
--> statement-breakpoint

-- One-click unsubscribe (E22, RFC 8058): a random token per recipient and event. The page and
-- the List-Unsubscribe POST need no login; the token is the proof.
CREATE TABLE app.unsubscribe_tokens (
  token text PRIMARY KEY CHECK (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('weekly_summary')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, event)
);
--> statement-breakpoint
-- The recipient's token, created with the caller's random value the first time.
CREATE OR REPLACE FUNCTION app.unsubscribe_token(p_tenant uuid, p_user uuid, p_event text, p_new text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text;
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN
    RAISE EXCEPTION 'TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.unsubscribe_tokens (token, tenant_id, user_id, event)
  VALUES (p_new, p_tenant, p_user, p_event)
  ON CONFLICT (tenant_id, user_id, event) DO NOTHING;
  SELECT t.token INTO v FROM app.unsubscribe_tokens t
   WHERE t.tenant_id = p_tenant AND t.user_id = p_user AND t.event = p_event;
  RETURN v;
END
$$;
--> statement-breakpoint
-- What the unsubscribe page shows: the company and whether the e-mail is still on.
CREATE OR REPLACE FUNCTION app.unsubscribe_info(p_token text)
RETURNS TABLE (tenant_name text, event text, active boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t record;
BEGIN
  SELECT u.tenant_id, u.user_id, u.event INTO t FROM app.unsubscribe_tokens u WHERE u.token = p_token;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
  RETURN QUERY
    SELECT tn.name::text, t.event::text,
           coalesce((SELECT p.email FROM notification_prefs p
                      WHERE p.user_id = t.user_id AND p.event = t.event), false)
      FROM tenants tn WHERE tn.id = t.tenant_id;
END
$$;
--> statement-breakpoint
-- Turns the e-mail off and writes the change to the company's audit log as the user's own.
CREATE OR REPLACE FUNCTION app.unsubscribe_apply(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t record;
  v_name text;
BEGIN
  SELECT u.tenant_id, u.user_id, u.event INTO t FROM app.unsubscribe_tokens u WHERE u.token = p_token;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
  INSERT INTO notification_prefs (tenant_id, user_id, event, in_app, email, push, sms)
  VALUES (t.tenant_id, t.user_id, t.event, false, false, false, false)
  ON CONFLICT (tenant_id, user_id, event) DO UPDATE SET email = false, updated_at = now();
  SELECT us.name INTO v_name FROM auth.users us WHERE us.id = t.user_id;
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (t.tenant_id, t.user_id, 'user', coalesce(v_name, ''), 'notifications.unsubscribed', 'user', t.user_id,
          jsonb_build_object('event', t.event, 'channel', 'email', 'via', 'unsubscribe_link'));
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.unsubscribe_token(uuid, uuid, text, text),
  app.unsubscribe_info(text), app.unsubscribe_apply(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.unsubscribe_token(uuid, uuid, text, text) TO agentor_worker;
GRANT EXECUTE ON FUNCTION app.unsubscribe_info(text), app.unsubscribe_apply(text) TO agentor_web;
--> statement-breakpoint

-- A reply to a resolved case by e-mail (E12, S8). agentor-ingest receives the inbound mail and
-- calls this with the token from the address (sag+<token>@…) and the sender. Only a member of
-- the case's company can reply; the message reopens the case within 14 days (trigger
-- case_events_customer). A bare "Ja"/"Nej" answers the satisfaction question without reopening.
CREATE OR REPLACE FUNCTION app.case_reply_by_email(p_token text, p_from text, p_body text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c record;
  u record;
  v_body text := left(btrim(coalesce(p_body, '')), 5000);
  v_yes boolean;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9]{20,64}$' THEN RETURN 'unknown'; END IF;
  SELECT pc.id, pc.tenant_id, pc.status, pc.resolved_at INTO c
    FROM platform.cases pc WHERE pc.reply_token = p_token;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF v_body = '' THEN RETURN 'empty'; END IF;
  PERFORM set_config('app.tenant_id', c.tenant_id::text, true);
  SELECT us.id, us.name INTO u
    FROM auth.users us JOIN memberships m ON m.user_id = us.id AND m.tenant_id = c.tenant_id
   WHERE us.email = lower(btrim(p_from))
   LIMIT 1;
  IF NOT FOUND THEN RETURN 'not_member'; END IF;
  IF c.status = 'closed' OR (c.status = 'resolved' AND c.resolved_at <= now() - interval '14 days') THEN
    RETURN 'archived';
  END IF;
  IF c.status = 'resolved' AND v_body ~* '^(ja|nej|yes|no)[[:space:][:punct:]]*$' THEN
    v_yes := v_body ~* '^(ja|yes)';
    UPDATE platform.cases SET satisfied = v_yes, updated_at = now() WHERE id = c.id;
    INSERT INTO platform.case_events (case_id, tenant_id, kind, author_user_id, author_name, body, meta)
    VALUES (c.id, c.tenant_id, 'status', u.id, u.name,
            CASE WHEN v_yes THEN 'Kunden var tilfreds med hjælpen.' ELSE 'Kunden var ikke tilfreds med hjælpen.' END,
            jsonb_build_object('via', 'email', 'satisfied', v_yes));
    RETURN 'satisfaction';
  END IF;
  INSERT INTO platform.case_events (case_id, tenant_id, kind, author_user_id, author_name, body, meta)
  VALUES (c.id, c.tenant_id, 'customer_message', u.id, u.name, v_body, jsonb_build_object('via', 'email'));
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (c.tenant_id, u.id, 'user', u.name, 'case.replied_by_email', 'case', c.id,
          jsonb_build_object('reopened', c.status IN ('resolved', 'waiting')));
  RETURN CASE WHEN c.status IN ('resolved', 'waiting') THEN 'reopened' ELSE 'added' END;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.case_reply_by_email(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.case_reply_by_email(text, text, text) TO agentor_web;
