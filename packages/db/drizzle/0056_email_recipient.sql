-- Notification e-mails (PLAN-EMAILS-PDF §5): the worker has no access to the auth schema, by
-- design. This returns exactly what an e-mail needs about one recipient (address, name and
-- language), and only for a member of the company the worker is working in. PostgreSQL 12.
CREATE OR REPLACE FUNCTION app.email_recipient(p_tenant uuid, p_user uuid)
RETURNS TABLE (email text, name text, locale text)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_tenant IS DISTINCT FROM app.current_tenant_id() THEN
    RAISE EXCEPTION 'TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.email::text, u.name::text, u.locale::text
      FROM auth.users u
     WHERE u.id = p_user
       AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = p_user AND m.tenant_id = p_tenant);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.email_recipient(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.email_recipient(uuid, uuid) TO agentor_worker;
