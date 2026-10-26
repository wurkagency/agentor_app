ALTER TABLE "invitations" DROP CONSTRAINT "invitations_role_check";--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('owner', 'admin', 'developer', 'reader'));--> statement-breakpoint

-- An owner invitation is made only by app.platform_create_customer (runs as the table owner):
-- a tenant admin inviting through RLS can never hand out the owner role.
CREATE OR REPLACE FUNCTION app.guard_owner_invitation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE v_owner oid := (SELECT c.relowner FROM pg_class c WHERE c.oid = 'public.invitations'::regclass);
BEGIN
  IF NEW.role <> 'owner' OR (TG_OP = 'UPDATE' AND OLD.role = 'owner') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND (r.oid = v_owner OR r.rolsuper))
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'OWNER_INVITATION_PROTECTED' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
CREATE TRIGGER invitations_guard_owner BEFORE INSERT OR UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION app.guard_owner_invitation();
--> statement-breakpoint

-- Superadmin creates a customer from /platform/customers: the company with its plan, waiting for
-- payment, and an owner invitation (14 days). The owner accepts, accepts the terms and pays by
-- card on SU5; only the verified QuickPay callback activates it, as for self-service signup. Not
-- in app.pending_signups, so the 24-hour purge leaves it alone.
CREATE OR REPLACE FUNCTION app.platform_create_customer(
  p_name text, p_cvr text, p_address_line text, p_postal_code text, p_city text,
  p_billing_email text, p_owner_email text, p_plan_id text, p_interval text,
  p_token_hash text, p_staff_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_tenant uuid := app.uuid_v7();
  v_email text := lower(trim(p_owner_email));
BEGIN
  IF NOT app.is_superadmin() THEN
    RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'TENANT_NAME_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'OWNER_EMAIL_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_interval NOT IN ('month', 'year') OR NOT EXISTS (SELECT 1 FROM plans WHERE id = p_plan_id) THEN
    RAISE EXCEPTION 'PLAN_INVALID' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_token_hash, '') !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'TOKEN_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  INSERT INTO tenants (id, name, cvr, address_line, postal_code, city, billing_email, signup_state)
  VALUES (v_tenant, trim(p_name), nullif(trim(p_cvr), ''), nullif(trim(p_address_line), ''),
          nullif(trim(p_postal_code), ''), nullif(trim(p_city), ''),
          coalesce(nullif(lower(trim(p_billing_email)), ''), v_email), 'pending_payment');
  INSERT INTO subscriptions (tenant_id, plan_id, interval, status)
  VALUES (v_tenant, p_plan_id, p_interval, 'incomplete');
  INSERT INTO invitations (tenant_id, email, role, flow_scope, token_hash, expires_at, invited_by)
  VALUES (v_tenant, v_email, 'owner', 'all', p_token_hash, now() + interval '14 days', v_user);
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (v_tenant, v_user, 'support', p_staff_name, 'company.created_by_staff', 'tenant', v_tenant,
          jsonb_build_object('name', trim(p_name), 'plan', p_plan_id, 'interval', p_interval, 'owner', v_email));
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_tenant;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_create_customer(text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_create_customer(text, text, text, text, text, text, text, text, text, text, text) TO agentor_web;
