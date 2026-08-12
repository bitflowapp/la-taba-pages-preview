-- TABA2 · Capa de identidad, parte 6: la superficie de administracion.
--
-- Lo que el duenio necesita poder hacer sin abrir la base: ver quien tiene
-- acceso, ver desde que aparatos, cerrar una sesion, cerrarlas todas, dar de
-- baja a una persona y leer que paso. Todo pasa por permisos declarados y todo
-- deja rastro.
--
-- Aplicar despues de 20260812050000_identity_invitations.sql.

-- ===========================================================================
-- 1. Equipo
-- ===========================================================================

create or replace function public.identity_list_members(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.identity_require_permission(p_business_id, 'identity.members.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', bm.user_id,
             'role', bm.role,
             'is_active', bm.is_active,
             'full_name', coalesce(sp.full_name, rp.full_name),
             'profile_status', coalesce(sp.status, rp.status),
             'vehicle_kind', rp.vehicle_kind,
             'disabled_at', us.disabled_at,
             'sessions_valid_from', nullif(us.sessions_valid_from, '-infinity'::timestamptz),
             'active_sessions', (
               select count(*)
                 from public.identity_sessions s
                where s.user_id = bm.user_id
                  and s.business_id = bm.business_id
                  and s.revoked_at is null
             ),
             'member_since', bm.created_at
           ) order by
             case bm.role when 'owner' then 0 when 'admin' then 1 when 'staff' then 2 else 3 end,
             coalesce(sp.full_name, rp.full_name, ''))
      from public.business_members bm
      left join public.staff_profiles sp
        on sp.business_id = bm.business_id and sp.user_id = bm.user_id
      left join public.rider_profiles rp
        on rp.business_id = bm.business_id and rp.user_id = bm.user_id
      left join public.identity_user_security us
        on us.business_id = bm.business_id and us.user_id = bm.user_id
     where bm.business_id = p_business_id
  ), '[]'::jsonb);
end;
$$;

-- Un admin no puede tocar a un owner ni a otro admin. Un owner puede todo,
-- salvo dejar al comercio sin ningun owner activo.
create or replace function public.identity_assert_can_administer_member(
  p_business_id uuid,
  p_target_user_id uuid,
  p_permission text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_role text := public.identity_require_permission(p_business_id, p_permission);
  v_target_role text;
begin
  select bm.role into v_target_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = p_target_user_id;

  if v_target_role is null then
    raise exception 'identity: la persona no pertenece al comercio'
      using errcode = 'no_data_found';
  end if;

  if v_actor_role = 'admin' and v_target_role in ('owner', 'admin') then
    raise exception 'identity: no autorizado'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object('actor_role', v_actor_role, 'target_role', v_target_role);
end;
$$;

create or replace function public.identity_count_active_owners(p_business_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select count(*)::integer
    from public.business_members bm
    left join public.identity_user_security us
      on us.business_id = bm.business_id and us.user_id = bm.user_id
   where bm.business_id = p_business_id
     and bm.role = 'owner'
     and bm.is_active
     and us.disabled_at is null
$$;

-- ===========================================================================
-- 2. Cambio de rol
-- ===========================================================================

create or replace function public.identity_set_member_role(
  p_business_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_actor_role text;
  v_target_role text;
  v_check jsonb;
  v_revoked integer := 0;
begin
  if v_role not in ('owner', 'admin', 'staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;

  -- Otorgar owner o admin es un acto de conduccion: exige identity.roles.write,
  -- que solo tiene el owner. Mover a alguien entre staff y rider alcanza con
  -- identity.members.write.
  v_check := public.identity_assert_can_administer_member(
    p_business_id,
    p_user_id,
    case when v_role in ('owner', 'admin') then 'identity.roles.write' else 'identity.members.write' end
  );
  v_actor_role := v_check ->> 'actor_role';
  v_target_role := v_check ->> 'target_role';

  if v_target_role = v_role then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'role', v_role);
  end if;

  if v_target_role = 'owner' and v_role <> 'owner'
     and public.identity_count_active_owners(p_business_id) <= 1 then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end if;

  perform set_config('taba.identity_write', 'on', true);
  update public.business_members
     set role = v_role
   where business_id = p_business_id
     and user_id = p_user_id;
  perform set_config('taba.identity_write', 'off', true);

  -- El perfil sigue al rol: quien pasa a Rider no conserva su ficha de Panel.
  if v_role = 'rider' then
    delete from public.staff_profiles where business_id = p_business_id and user_id = p_user_id;
    insert into public.rider_profiles (business_id, user_id, full_name, created_by)
    select p_business_id, p_user_id,
           coalesce((select sp.full_name from public.staff_profiles sp
                      where sp.business_id = p_business_id and sp.user_id = p_user_id), 'Sin nombre'),
           v_actor
    on conflict (business_id, user_id) do update set status = 'active';
  else
    delete from public.rider_profiles where business_id = p_business_id and user_id = p_user_id;
    insert into public.staff_profiles (business_id, user_id, full_name, created_by)
    select p_business_id, p_user_id,
           coalesce((select rp.full_name from public.rider_profiles rp
                      where rp.business_id = p_business_id and rp.user_id = p_user_id), 'Sin nombre'),
           v_actor
    on conflict (business_id, user_id) do update set status = 'active';
  end if;

  -- Un cambio de rol invalida las sesiones abiertas: la persona vuelve a
  -- entrar y su cliente descarga los permisos nuevos desde cero.
  update public.identity_sessions
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'role_changed'
   where business_id = p_business_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  perform public.identity_kill_auth_sessions_for_user(p_user_id);

  perform public.identity_record_audit_event(
    p_event_type => 'member_role_changed',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('from', v_target_role, 'to', v_role, 'sessions_revoked', v_revoked)
  );

  return jsonb_build_object('ok', true, 'role', v_role, 'sessions_revoked', v_revoked);
end;
$$;

-- ===========================================================================
-- 3. Alta y baja de una persona
-- ===========================================================================

create or replace function public.identity_set_member_active(
  p_business_id uuid,
  p_user_id uuid,
  p_is_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_check jsonb := public.identity_assert_can_administer_member(
    p_business_id, p_user_id, 'identity.members.write');
  v_actor_role text := v_check ->> 'actor_role';
  v_target_role text := v_check ->> 'target_role';
  v_revoked integer := 0;
  v_killed boolean := false;
begin
  if p_is_active is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_state');
  end if;

  if not p_is_active
     and v_target_role = 'owner'
     and public.identity_count_active_owners(p_business_id) <= 1 then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end if;

  perform set_config('taba.identity_write', 'on', true);
  update public.business_members
     set is_active = p_is_active
   where business_id = p_business_id
     and user_id = p_user_id;
  perform set_config('taba.identity_write', 'off', true);

  insert into public.identity_user_security (business_id, user_id)
  values (p_business_id, p_user_id)
  on conflict (business_id, user_id) do nothing;

  if p_is_active then
    update public.identity_user_security
       set disabled_at = null, disabled_by = null, disabled_reason = null
     where business_id = p_business_id and user_id = p_user_id;
    update public.staff_profiles set status = 'active'
     where business_id = p_business_id and user_id = p_user_id;
    update public.rider_profiles set status = 'active'
     where business_id = p_business_id and user_id = p_user_id;
  else
    update public.identity_user_security
       set disabled_at = now(),
           disabled_by = v_actor,
           disabled_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           -- Corte por fecha: aunque exista un token de una sesion que nunca
           -- se registro, queda del lado viejo de la linea.
           sessions_valid_from = now()
     where business_id = p_business_id and user_id = p_user_id;
    update public.staff_profiles set status = 'suspended'
     where business_id = p_business_id and user_id = p_user_id;
    update public.rider_profiles set status = 'suspended'
     where business_id = p_business_id and user_id = p_user_id;

    update public.identity_sessions
       set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'member_disabled'
     where business_id = p_business_id
       and user_id = p_user_id
       and revoked_at is null;
    get diagnostics v_revoked = row_count;

    v_killed := public.identity_kill_auth_sessions_for_user(p_user_id);
  end if;

  perform public.identity_record_audit_event(
    p_event_type => case when p_is_active then 'member_activated' else 'member_disabled' end,
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object(
      'target_role', v_target_role,
      'sessions_revoked', v_revoked,
      'auth_sessions_killed', v_killed,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object('ok', true, 'is_active', p_is_active, 'sessions_revoked', v_revoked);
end;
$$;

-- ===========================================================================
-- 4. Sesiones y dispositivos
-- ===========================================================================

create or replace function public.identity_list_sessions(
  p_business_id uuid,
  p_user_id uuid default null,
  p_include_revoked boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.identity_require_permission(p_business_id, 'identity.sessions.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'session_id', s.session_id,
             'user_id', s.user_id,
             'full_name', coalesce(sp.full_name, rp.full_name),
             'role_at_login', s.role_at_login,
             'client', s.client,
             'device_label', s.device_label,
             'app_version', s.app_version,
             'first_seen_at', s.first_seen_at,
             'last_seen_at', s.last_seen_at,
             'revoked_at', s.revoked_at,
             'revoked_reason', s.revoked_reason
           ) order by s.last_seen_at desc)
      from public.identity_sessions s
      left join public.staff_profiles sp
        on sp.business_id = s.business_id and sp.user_id = s.user_id
      left join public.rider_profiles rp
        on rp.business_id = s.business_id and rp.user_id = s.user_id
     where s.business_id = p_business_id
       and (p_user_id is null or s.user_id = p_user_id)
       and (coalesce(p_include_revoked, false) or s.revoked_at is null)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.identity_revoke_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.identity_sessions%rowtype;
  v_check jsonb;
  v_actor_role text;
begin
  select * into v_session from public.identity_sessions where session_id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Cerrar la propia sesion no exige permiso de administracion.
  if v_session.user_id = v_actor then
    v_actor_role := public.identity_member_role(v_session.business_id);
  else
    v_check := public.identity_assert_can_administer_member(
      v_session.business_id, v_session.user_id, 'identity.sessions.revoke');
    v_actor_role := v_check ->> 'actor_role';
  end if;

  if v_session.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;

  update public.identity_sessions
     set revoked_at = now(),
         revoked_by = v_actor,
         revoked_reason = case when v_session.user_id = v_actor then 'self_logout' else 'owner_revoked' end
   where session_id = p_session_id;

  perform public.identity_kill_auth_session(p_session_id);

  perform public.identity_record_audit_event(
    p_event_type => 'session_revoked',
    p_business_id => v_session.business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => v_session.user_id,
    p_session_id => p_session_id,
    p_metadata => jsonb_build_object('client', v_session.client, 'device_label', v_session.device_label)
  );

  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

create or replace function public.identity_revoke_all_sessions(
  p_business_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_check jsonb;
  v_revoked integer := 0;
  v_killed boolean := false;
begin
  if p_user_id = v_actor then
    v_actor_role := public.identity_member_role(p_business_id);
    if v_actor_role is null then
      return jsonb_build_object('ok', false, 'code', 'not_authorized');
    end if;
  else
    v_check := public.identity_assert_can_administer_member(
      p_business_id, p_user_id, 'identity.sessions.revoke');
    v_actor_role := v_check ->> 'actor_role';
  end if;

  insert into public.identity_user_security (business_id, user_id)
  values (p_business_id, p_user_id)
  on conflict (business_id, user_id) do nothing;

  update public.identity_user_security
     set sessions_valid_from = now()
   where business_id = p_business_id and user_id = p_user_id;

  update public.identity_sessions
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'revoke_all'
   where business_id = p_business_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  v_killed := public.identity_kill_auth_sessions_for_user(p_user_id);

  perform public.identity_record_audit_event(
    p_event_type => 'sessions_revoked_all',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('sessions_revoked', v_revoked, 'auth_sessions_killed', v_killed)
  );

  return jsonb_build_object('ok', true, 'sessions_revoked', v_revoked);
end;
$$;

-- ===========================================================================
-- 5. Auditoria
-- ===========================================================================

create or replace function public.identity_list_audit_events(
  p_business_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  perform public.identity_require_permission(p_business_id, 'audit.read');
  return coalesce((
    select jsonb_agg(evento order by seq)
      from (
        select row_number() over (order by a.occurred_at desc, a.id desc) as seq,
               jsonb_build_object(
                 'occurred_at', a.occurred_at,
                 'event_type', a.event_type,
                 'actor_user_id', a.actor_user_id,
                 'actor_role', a.actor_role,
                 'subject_user_id', a.subject_user_id,
                 'session_id', a.session_id,
                 'metadata', a.metadata
               ) as evento
          from public.identity_audit_events a
         where a.business_id = p_business_id
         order by a.occurred_at desc, a.id desc
         limit v_limit
      ) ultimos
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- 6. Superficie
-- ===========================================================================

revoke execute on function public.identity_assert_can_administer_member(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.identity_count_active_owners(uuid) from public, anon, authenticated;

revoke execute on function public.identity_list_members(uuid) from public, anon;
revoke execute on function public.identity_set_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.identity_set_member_active(uuid, uuid, boolean, text) from public, anon;
revoke execute on function public.identity_list_sessions(uuid, uuid, boolean) from public, anon;
revoke execute on function public.identity_revoke_session(uuid) from public, anon;
revoke execute on function public.identity_revoke_all_sessions(uuid, uuid) from public, anon;
revoke execute on function public.identity_list_audit_events(uuid, integer) from public, anon;

grant execute on function public.identity_list_members(uuid) to authenticated;
grant execute on function public.identity_set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.identity_set_member_active(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.identity_list_sessions(uuid, uuid, boolean) to authenticated;
grant execute on function public.identity_revoke_session(uuid) to authenticated;
grant execute on function public.identity_revoke_all_sessions(uuid, uuid) to authenticated;
grant execute on function public.identity_list_audit_events(uuid, integer) to authenticated;
