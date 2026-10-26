-- Publishing a flow draft (M7, produktspecifikation §5.4). Published versions are immutable for
-- the web role, so archiving the previous version and promoting the draft happen here, in one
-- transaction, after the same checks the policies make.
CREATE OR REPLACE FUNCTION app.publish_flow_version(
  p_flow_id uuid,
  p_draft_id uuid,
  p_change_summary jsonb,
  p_author text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
  v_user uuid := app.current_user_id();
  v_number integer;
  v_flow_name text;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'context missing' USING ERRCODE = '42501';
  END IF;
  IF NOT (app.can_edit_flows() AND app.has_flow_access(p_flow_id)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM flow_versions v
   WHERE v.id = p_draft_id AND v.flow_id = p_flow_id AND v.tenant_id = v_tenant AND v.state = 'draft'
     AND (v.locked_by IS NULL OR v.locked_by = v_user)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(max(number), 0) + 1 INTO v_number
    FROM flow_versions WHERE flow_id = p_flow_id AND tenant_id = v_tenant;
  UPDATE flow_versions SET state = 'archived', updated_at = now()
   WHERE flow_id = p_flow_id AND tenant_id = v_tenant AND state = 'published';
  UPDATE flow_versions
     SET state = 'published', number = v_number, published_at = now(), published_by_name = p_author,
         change_summary = p_change_summary, locked_by = NULL, locked_by_name = NULL, locked_at = NULL,
         updated_at = now()
   WHERE id = p_draft_id AND tenant_id = v_tenant;
  UPDATE flows SET published_version_id = p_draft_id, next_run_at = now() + interval '1 minute',
                   updated_at = now()
   WHERE id = p_flow_id AND tenant_id = v_tenant
   RETURNING name INTO v_flow_name;
  INSERT INTO audit_log (tenant_id, actor_user_id, actor_kind, actor_name, action, object_type, object_id, after)
  VALUES (v_tenant, v_user, 'user', p_author, 'flow.published', 'flow', p_flow_id,
          jsonb_build_object('version', v_number, 'changes', jsonb_array_length(coalesce(p_change_summary, '[]'::jsonb))));
  -- Tell the rest of the team (D2-Notifikationer "Jonas Krag publicerede v7").
  INSERT INTO notifications (tenant_id, user_id, event, needs_action, message_key, params, href, flow_id)
  SELECT v_tenant, m.user_id, 'connector_update', false, 'published',
         jsonb_build_object('name', p_author, 'number', v_number, 'flow', v_flow_name),
         '/integrations/' || p_flow_id || '?tab=settings', p_flow_id
    FROM memberships m WHERE m.tenant_id = v_tenant AND m.user_id <> v_user;
  RETURN v_number;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.publish_flow_version(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_flow_version(uuid, uuid, jsonb, text) TO agentor_web;
