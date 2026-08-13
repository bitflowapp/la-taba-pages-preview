-- A signed team token is not enough: every operational session must first be
-- present in identity_sessions so it can be audited and revoked individually.
-- The registration RPC has a deliberately narrower bootstrap path that checks
-- membership, user security and token age before creating that row. All other
-- RLS/RPC authorization continues through identity_member_role and therefore
-- fails closed when the row is missing.

create or replace function public.identity_member_role(target_business_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_valid_from timestamptz;
  v_disabled timestamptz;
  v_session uuid;
  v_revoked timestamptz;
  v_issued timestamptz;
begin
  if v_user is null or target_business_id is null or public.identity_is_anonymous() then
    return null;
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = target_business_id
     and bm.user_id = v_user
     and bm.is_active = true;
  if v_role is null then return null; end if;

  select s.sessions_valid_from, s.disabled_at
    into v_valid_from, v_disabled
    from public.identity_user_security s
   where s.business_id = target_business_id
     and s.user_id = v_user;
  if v_disabled is not null then return null; end if;

  -- Real GoTrue team tokens carry session_id. Missing, foreign, unregistered
  -- and revoked sessions all have the same authorization result: no role.
  v_session := public.identity_session_id();
  if v_session is null then return null; end if;

  select ise.revoked_at into v_revoked
    from public.identity_sessions ise
   where ise.session_id = v_session
     and ise.user_id = v_user
     and ise.business_id = target_business_id;
  if not found or v_revoked is not null then return null; end if;

  v_valid_from := coalesce(v_valid_from, '-infinity'::timestamptz);
  if v_valid_from > '-infinity'::timestamptz then
    v_issued := public.identity_token_issued_at();
    if v_issued is null or v_issued < v_valid_from then return null; end if;
  end if;

  return v_role;
end;
$$;

create or replace function public.identity_register_session(
  p_business_id uuid,
  p_client text default 'unknown',
  p_device_label text default null,
  p_device_key_hash text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_session uuid := public.identity_session_id();
  v_client text := coalesce(nullif(btrim(p_client), ''), 'unknown');
  v_inserted boolean := false;
  v_valid_from timestamptz;
  v_disabled timestamptz;
  v_issued timestamptz;
begin
  if v_user is null or p_business_id is null or public.identity_is_anonymous() or v_session is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = v_user
     and bm.is_active = true;
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select s.sessions_valid_from, s.disabled_at
    into v_valid_from, v_disabled
    from public.identity_user_security s
   where s.business_id = p_business_id
     and s.user_id = v_user;
  if v_disabled is not null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  v_valid_from := coalesce(v_valid_from, '-infinity'::timestamptz);
  if v_valid_from > '-infinity'::timestamptz then
    v_issued := public.identity_token_issued_at();
    if v_issued is null or v_issued < v_valid_from then
      return jsonb_build_object('ok', false, 'code', 'not_authorized');
    end if;
  end if;

  if v_client not in ('rider_android', 'panel_web', 'unknown') then
    v_client := 'unknown';
  end if;

  insert into public.identity_sessions as ise (
    session_id, user_id, business_id, role_at_login, client,
    device_label, device_key_hash, app_version
  ) values (
    v_session, v_user, p_business_id, v_role, v_client,
    nullif(btrim(p_device_label), ''),
    lower(nullif(btrim(p_device_key_hash), '')),
    nullif(btrim(p_app_version), '')
  )
  on conflict (session_id) do update
     set last_seen_at = now(),
         role_at_login = excluded.role_at_login,
         device_label = coalesce(excluded.device_label, ise.device_label),
         device_key_hash = coalesce(excluded.device_key_hash, ise.device_key_hash),
         app_version = coalesce(excluded.app_version, ise.app_version)
   where ise.user_id = excluded.user_id
     and ise.business_id = excluded.business_id
     and ise.revoked_at is null
  returning (xmax = 0) into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if v_inserted then
    perform public.identity_record_audit_event(
      p_event_type => 'session_opened',
      p_business_id => p_business_id,
      p_actor_user_id => v_user,
      p_actor_role => v_role,
      p_subject_user_id => v_user,
      p_session_id => v_session,
      p_metadata => jsonb_build_object('client', v_client, 'app_version', nullif(btrim(p_app_version), ''))
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'registered',
    'role', v_role,
    'session_id', v_session,
    'new_session', v_inserted
  );
end;
$$;

revoke execute on function public.identity_member_role(uuid) from public, anon;
revoke execute on function public.identity_register_session(uuid, text, text, text, text) from public, anon;
grant execute on function public.identity_member_role(uuid) to authenticated;
grant execute on function public.identity_register_session(uuid, text, text, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
