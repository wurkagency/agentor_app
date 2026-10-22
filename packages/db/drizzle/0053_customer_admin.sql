-- Customer administration in Platform (Superadmin only): edit the company's details, send the
-- owner a new invitation, suspend and reactivate, and delete a customer that has never been
-- invoiced. Every change is written to the customer's audit log; the app writes platform.audit.
-- PostgreSQL 12 compatible.

-- Company details as on P2. The name is required; empty fields are cleared.
CREATE OR REPLACE FUNCTION app.platform_customer_update(
  p_tenant uuid, p_name text, p_cvr text, p_address_line text, p_postal_code text, p_city text,
  p_billing_email text, p_staff_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_before jsonb;
  v_email text := nullif(lower(trim(p_billing_email)), '');
BEGIN
  IF NOT app.is_superadmin() THEN
    RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'TENANT_NAME_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'BILLING_EMAIL_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT jsonb_build_object('name', name, 'cvr', cvr, 'addressLine', address_line,
                            'postalCode', postal_code, 'city', city, 'billingEmail', billing_email)
    INTO v_before FROM tenants WHERE id = p_tenant;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  UPDATE tenants SET name = trim(p_name), cvr = nullif(trim(p_cvr), ''),
         address_line = nullif(trim(p_address_line), ''), postal_code = nullif(trim(p_postal_code), ''),
         city = nullif(trim(p_city), ''), billing_email = v_email, updated_at = now()
   WHERE id = p_tenant;
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, before, after)
  VALUES (p_tenant, v_user, 'support', p_staff_name, 'company.updated_by_staff', 'tenant', p_tenant, v_before,
          jsonb_build_object('name', trim(p_name), 'cvr', nullif(trim(p_cvr), ''),
                             'addressLine', nullif(trim(p_address_line), ''),
                             'postalCode', nullif(trim(p_postal_code), ''), 'city', nullif(trim(p_city), ''),
                             'billingEmail', v_email));
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_customer_update(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_customer_update(uuid, text, text, text, text, text, text, text) TO agentor_web;
--> statement-breakpoint

-- Suspend (no one in the company can use the app, no scheduled runs) or reactivate.
CREATE OR REPLACE FUNCTION app.platform_customer_set_status(
  p_tenant uuid, p_status text, p_reason text, p_staff_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_before text;
BEGIN
  IF NOT app.is_superadmin() THEN
    RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'STATUS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'suspended' AND coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT status INTO v_before FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_before <> p_status THEN
    UPDATE tenants SET status = p_status, updated_at = now() WHERE id = p_tenant;
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, before, after)
    VALUES (p_tenant, v_user, 'support', p_staff_name,
            CASE WHEN p_status = 'suspended' THEN 'company.suspended' ELSE 'company.reactivated' END,
            'tenant', p_tenant, jsonb_build_object('status', v_before),
            jsonb_build_object('status', p_status, 'reason', nullif(trim(p_reason), '')));
  END IF;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_customer_set_status(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_customer_set_status(uuid, text, text, text) TO agentor_web;
--> statement-breakpoint

-- A new owner invitation (14 days) while the company has no owner yet: the earlier ones are
-- revoked. The e-mail can be corrected; empty keeps the last invited address. Returns the address.
CREATE OR REPLACE FUNCTION app.platform_customer_resend_owner_invitation(
  p_tenant uuid, p_email text, p_token_hash text, p_staff_name text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_email text := nullif(lower(trim(p_email)), '');
BEGIN
  IF NOT app.is_superadmin() THEN
    RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_token_hash, '') !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'TOKEN_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM memberships WHERE tenant_id = p_tenant AND role = 'owner') THEN
    RAISE EXCEPTION 'HAS_OWNER' USING ERRCODE = 'P0001';
  END IF;
  IF v_email IS NULL THEN
    SELECT email INTO v_email FROM invitations
     WHERE tenant_id = p_tenant AND role = 'owner' ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'OWNER_EMAIL_INVALID' USING ERRCODE = '22023';
  END IF;
  UPDATE invitations SET revoked_at = now()
   WHERE tenant_id = p_tenant AND role = 'owner' AND accepted_at IS NULL AND revoked_at IS NULL;
  INSERT INTO invitations (tenant_id, email, role, flow_scope, token_hash, expires_at, invited_by)
  VALUES (p_tenant, v_email, 'owner', 'all', p_token_hash, now() + interval '14 days', v_user);
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (p_tenant, v_user, 'support', p_staff_name, 'invitation.resent_by_staff', 'tenant', p_tenant,
          jsonb_build_object('email', v_email, 'role', 'owner'));
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_email;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_customer_resend_owner_invitation(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_customer_resend_owner_invitation(uuid, text, text, text) TO agentor_web;
--> statement-breakpoint

-- Deletes a customer and everything that belongs to it (all references cascade). Only one that has
-- never been invoiced: issued invoices must be kept (bogføringsloven); suspend those instead. The
-- name must be typed to confirm. User accounts stay; they just lose the membership.
CREATE OR REPLACE FUNCTION app.platform_customer_delete(p_tenant uuid, p_confirm_name text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT app.is_superadmin() THEN
    RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT name INTO v_name FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_name)) THEN
    RAISE EXCEPTION 'CONFIRM_NAME_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE tenant_id = p_tenant AND number IS NOT NULL) THEN
    RAISE EXCEPTION 'HAS_INVOICES' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM tenants WHERE id = p_tenant;
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_name;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_customer_delete(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_customer_delete(uuid, text) TO agentor_web;
--> statement-breakpoint

-- What P2's administration needs: status, whether it can be deleted, and the owner invitation.
CREATE OR REPLACE FUNCTION app.platform_customer_admin_info(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT app.is_superadmin() THEN
    RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  SELECT jsonb_build_object(
    'status', t.status,
    'signupState', t.signup_state,
    'name', t.name, 'cvr', t.cvr, 'addressLine', t.address_line, 'postalCode', t.postal_code,
    'city', t.city, 'billingEmail', t.billing_email,
    'invoices', (SELECT count(*) FROM invoices i WHERE i.tenant_id = t.id AND i.number IS NOT NULL),
    'hasOwner', EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = t.id AND m.role = 'owner'),
    'ownerInvite', (SELECT jsonb_build_object('email', v.email, 'expiresAt', v.expires_at,
                                              'open', v.accepted_at IS NULL AND v.revoked_at IS NULL
                                                      AND v.expires_at > now())
                      FROM invitations v WHERE v.tenant_id = t.id AND v.role = 'owner'
                     ORDER BY v.created_at DESC LIMIT 1))
    INTO v_out FROM tenants t WHERE t.id = p_tenant;
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_out;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.platform_customer_admin_info(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_customer_admin_info(uuid) TO agentor_web;
