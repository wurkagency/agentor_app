-- Team, settings and support access: RLS, write restrictions and SECURITY DEFINER paths (M3).

-- RLS on the new tenant tables ------------------------------------------------------------------
ALTER TABLE invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations           FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_prefs    FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON notification_prefs
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON notification_settings
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_isolation ON support_access_grants
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

-- Helper: owner check (is_tenant_admin() exists since 0002) ----------------------------------------
CREATE OR REPLACE FUNCTION app.is_tenant_owner() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = app.current_user_id() AND m.role = 'owner'
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_tenant_owner() TO agentor_web;
--> statement-breakpoint

-- Write restrictions for the web role (RESTRICTIVE: on top of tenant isolation) --------------------
-- Only owners and admins change the team; only owners touch owner memberships (§6).
CREATE POLICY memberships_admin_insert ON memberships AS RESTRICTIVE FOR INSERT TO agentor_web
  WITH CHECK (app.is_tenant_admin() AND (role <> 'owner' OR app.is_tenant_owner()));
CREATE POLICY memberships_admin_update ON memberships AS RESTRICTIVE FOR UPDATE TO agentor_web
  USING (app.is_tenant_admin() AND (role <> 'owner' OR app.is_tenant_owner()))
  WITH CHECK (app.is_tenant_admin() AND (role <> 'owner' OR app.is_tenant_owner()));
CREATE POLICY memberships_admin_delete ON memberships AS RESTRICTIVE FOR DELETE TO agentor_web
  USING (app.is_tenant_admin() AND (role <> 'owner' OR app.is_tenant_owner()));
--> statement-breakpoint
-- Company settings: owners and admins only.
CREATE POLICY tenants_admin_update ON tenants AS RESTRICTIVE FOR UPDATE TO agentor_web
  USING (app.is_tenant_admin()) WITH CHECK (app.is_tenant_admin());
--> statement-breakpoint
-- New tenants are created only through onboarding's SECURITY DEFINER function (M4).
REVOKE INSERT ON tenants FROM agentor_web, agentor_worker;
--> statement-breakpoint
-- Invitations: owners and admins only, read and write.
CREATE POLICY invitations_admin ON invitations AS RESTRICTIVE TO agentor_web
  USING (app.is_tenant_admin()) WITH CHECK (app.is_tenant_admin());
--> statement-breakpoint
-- Notification preferences and settings: each user manages their own.
CREATE POLICY notification_prefs_own ON notification_prefs AS RESTRICTIVE TO agentor_web
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
CREATE POLICY notification_settings_own ON notification_settings AS RESTRICTIVE TO agentor_web
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
-- Support grants: visible to and decided by owners and admins.
CREATE POLICY support_grants_admin ON support_access_grants AS RESTRICTIVE TO agentor_web
  USING (app.is_tenant_admin()) WITH CHECK (app.is_tenant_admin());
--> statement-breakpoint
-- Audit log: everyone in the tenant can append; only owners and admins can read it (D12).
CREATE POLICY audit_log_admin_read ON audit_log AS RESTRICTIVE FOR SELECT TO agentor_web
  USING (app.is_tenant_admin());
--> statement-breakpoint

-- Table privileges ----------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON invitations TO agentor_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_prefs, notification_settings TO agentor_web;
GRANT SELECT ON notification_prefs, notification_settings TO agentor_worker;
GRANT SELECT, UPDATE ON support_access_grants TO agentor_web;
GRANT SELECT ON support_access_grants TO agentor_worker;
--> statement-breakpoint

-- Invitation tokens: an owner-only index in the private app schema ----------------------------------
-- The invitee has no tenant context yet, so the token must be resolvable without RLS. Only the
-- SECURITY DEFINER functions below read this table; runtime roles have no privileges on it.
CREATE TABLE app.invitation_tokens (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  FOREIGN KEY (tenant_id, invitation_id) REFERENCES invitations (tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sync_invitation_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO app.invitation_tokens (token_hash, tenant_id, invitation_id)
  VALUES (NEW.token_hash, NEW.tenant_id, NEW.id)
  ON CONFLICT (token_hash) DO NOTHING;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invitations_token_index AFTER INSERT ON invitations
  FOR EACH ROW EXECUTE FUNCTION app.sync_invitation_token();
--> statement-breakpoint

-- What the invite page may show before sign-in: no ids, no other invitations.
CREATE OR REPLACE FUNCTION app.invitation_preview(p_token_hash text)
RETURNS TABLE (tenant_name text, email text, role text, state text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t app.invitation_tokens%ROWTYPE;
BEGIN
  SELECT * INTO t FROM app.invitation_tokens WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
  RETURN QUERY
    SELECT tn.name, i.email, i.role,
           CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                WHEN i.accepted_at IS NOT NULL THEN 'accepted'
                WHEN i.expires_at <= now() THEN 'expired'
                ELSE 'open' END
      FROM invitations i JOIN tenants tn ON tn.id = i.tenant_id
     WHERE i.tenant_id = t.tenant_id AND i.id = t.invitation_id;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
--> statement-breakpoint

-- Accept: the signed-in user (app.user_id) joins the tenant with the invited role and flows.
CREATE OR REPLACE FUNCTION app.accept_invitation(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t app.invitation_tokens%ROWTYPE;
  inv invitations%ROWTYPE;
  v_user uuid := app.current_user_id();
  v_email text;
  v_name text;
  v_membership uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'user context missing' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM app.invitation_tokens WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('app.tenant_id', t.tenant_id::text, true);
  SELECT * INTO inv FROM invitations WHERE tenant_id = t.tenant_id AND id = t.invitation_id FOR UPDATE;
  IF inv.revoked_at IS NOT NULL OR inv.accepted_at IS NOT NULL OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  SELECT lower(u.email), u.name INTO v_email, v_name FROM auth.users u WHERE u.id = v_user;
  IF v_email IS DISTINCT FROM inv.email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM memberships WHERE tenant_id = inv.tenant_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'ALREADY_MEMBER' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO memberships (tenant_id, user_id, role, flow_scope, is_external)
  VALUES (inv.tenant_id, v_user, inv.role, inv.flow_scope, inv.is_external)
  RETURNING id INTO v_membership;

  IF inv.flow_scope = 'selected' THEN
    INSERT INTO flow_grants (tenant_id, membership_id, flow_id, expires_at)
    SELECT inv.tenant_id, v_membership, f.id, inv.access_expires_at
      FROM flows f WHERE f.tenant_id = inv.tenant_id AND f.id = ANY (inv.flow_ids);
  END IF;

  UPDATE invitations SET accepted_at = now() WHERE tenant_id = inv.tenant_id AND id = inv.id;
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (inv.tenant_id, v_user, 'user', v_name, 'invitation.accepted', 'membership', v_membership,
          jsonb_build_object('role', inv.role, 'flowScope', inv.flow_scope));
  PERFORM set_config('app.tenant_id', '', true);
  RETURN inv.tenant_id;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.sync_invitation_token() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.invitation_preview(text), app.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_preview(text), app.accept_invitation(text) TO agentor_web;
--> statement-breakpoint

-- Break-glass (produktspecifikation §9.7, PLAN Q8) ---------------------------------------------------
-- agentor_support has no table privileges; it can only request access through this audited path.
CREATE OR REPLACE FUNCTION app.support_request_access(
  p_tenant_id uuid,
  p_support_name text,
  p_case_ref text,
  p_reason text,
  p_hours integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_requires_approval boolean;
  v_grant uuid;
BEGIN
  IF p_hours < 1 OR p_hours > 24 THEN
    RAISE EXCEPTION 'SUPPORT_HOURS_OUT_OF_RANGE' USING ERRCODE = '22023';
  END IF;
  IF coalesce(trim(p_case_ref), '') = '' OR coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'SUPPORT_CASE_AND_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  SELECT support_requires_approval INTO v_requires_approval FROM tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO support_access_grants (tenant_id, case_ref, reason, support_name, approved_at, expires_at)
  VALUES (p_tenant_id, p_case_ref, p_reason, p_support_name,
          CASE WHEN v_requires_approval THEN NULL ELSE now() END,
          now() + make_interval(hours => p_hours))
  RETURNING id INTO v_grant;
  INSERT INTO audit_log (tenant_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (p_tenant_id, 'support', p_support_name, 'support.requested', 'support_access', v_grant,
          jsonb_build_object('caseRef', p_case_ref, 'reason', p_reason, 'hours', p_hours,
                             'autoApproved', NOT v_requires_approval));
  PERFORM set_config('app.tenant_id', '', true);
  RETURN v_grant;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.support_request_access(uuid, text, text, text, integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO agentor_support;
GRANT EXECUTE ON FUNCTION app.support_request_access(uuid, text, text, text, integer) TO agentor_support;
