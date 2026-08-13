-- TABA2 · Capa de identidad, parte 4: alta de sesion, cierre propio y cierre
-- de la escritura directa de membresias.
--
-- Aplicar despues de 20260812030000_identity_authorization_gate.sql.

-- ===========================================================================
-- 1. Matar la sesion en el emisor de tokens
-- ===========================================================================
-- Borrar la fila de auth.sessions hace que el proximo refresh reciba
-- refresh_token_not_found. Medido contra GoTrue v2.193. Es la mitad lenta de la
-- revocacion: cierra la cadena de renovacion. La mitad rapida es la compuerta,
-- que rechaza el access token que ya estaba emitido.
--
-- Si el rol duenio de la funcion no tuviera permiso sobre el esquema auth, la
-- revocacion NO se vuelve permisiva: sigue valiendo la marca en
-- identity_sessions y el corte por sessions_valid_from. Solo se pierde el
-- cierre inmediato del refresh, y eso queda dicho en la deuda del informe.

create or replace function public.identity_kill_auth_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_session_id is null or to_regclass('auth.sessions') is null then
    return false;
  end if;
  execute 'delete from auth.sessions where id = $1' using p_session_id;
  return true;
exception
  when insufficient_privilege or undefined_table then
    return false;
end;
$$;

create or replace function public.identity_kill_auth_sessions_for_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_user_id is null or to_regclass('auth.sessions') is null then
    return false;
  end if;
  execute 'delete from auth.sessions where user_id = $1' using p_user_id;
  return true;
exception
  when insufficient_privilege or undefined_table then
    return false;
end;
$$;

-- ===========================================================================
-- 2. Alta de sesion
-- ===========================================================================
-- El session_id NO se recibe por parametro: se lee del claim del token que
-- hizo la llamada. Un cliente no puede registrar, tocar ni resucitar la sesion
-- de otro porque no tiene forma de nombrarla.

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
  v_role text := public.identity_member_role(p_business_id);
  v_session uuid := public.identity_session_id();
  v_client text := coalesce(nullif(btrim(p_client), ''), 'unknown');
  v_inserted boolean := false;
begin
  if v_user is null or v_role is null then
    -- Misma respuesta para "no hay sesion", "no sos del equipo", "estas dado
    -- de baja" y "tu sesion esta revocada". El cliente no necesita el motivo y
    -- el atacante tampoco.
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if v_client not in ('rider_android', 'panel_web', 'unknown') then
    v_client := 'unknown';
  end if;

  if v_session is null then
    -- Token sin claim de sesion (por ejemplo una llamada con clave de
    -- servicio). No hay nada que registrar y tampoco es un error.
    return jsonb_build_object('ok', true, 'code', 'no_session_claim', 'role', v_role);
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
   where ise.revoked_at is null
  returning (xmax = 0) into v_inserted;

  if v_inserted is null then
    -- El ON CONFLICT no actualizo nada: la fila existe y esta revocada.
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

-- Latido barato: solo mueve last_seen_at para que la lista de dispositivos del
-- duenio diga la verdad. Pasa por la compuerta igual que todo lo demas.
create or replace function public.identity_touch_session(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role text := public.identity_member_role(p_business_id);
  v_session uuid := public.identity_session_id();
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if v_session is not null then
    update public.identity_sessions
       set last_seen_at = now()
     where session_id = v_session
       and revoked_at is null;
  end if;
  return jsonb_build_object('ok', true, 'role', v_role);
end;
$$;

-- ===========================================================================
-- 3. Cierre de la propia sesion
-- ===========================================================================
-- El logout explicito del Rider y del Panel. Cierra la cadena de refresh en el
-- emisor y marca la sesion, para que el listado del duenio muestre que se
-- cerro sola y no que se la cerraron.

create or replace function public.identity_close_own_session(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.identity_session_id();
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = v_user;

  if v_session is not null then
    update public.identity_sessions
       set revoked_at = now(),
           revoked_by = v_user,
           revoked_reason = 'self_logout'
     where session_id = v_session
       and user_id = v_user
       and revoked_at is null;

    perform public.identity_kill_auth_session(v_session);

    perform public.identity_record_audit_event(
      p_event_type => 'session_closed',
      p_business_id => p_business_id,
      p_actor_user_id => v_user,
      p_actor_role => v_role,
      p_subject_user_id => v_user,
      p_session_id => v_session
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'closed');
end;
$$;

-- ===========================================================================
-- 4. Las membresias dejan de ser escribibles desde el cliente
-- ===========================================================================
-- Hasta ahora `authenticated` tenia insert/update/delete sobre
-- public.business_members y lo unico que lo contenia eran las politicas RLS.
-- Una politica mal escrita en el futuro alcanzaba para que alguien se subiera
-- el rol. A partir de aca la unica via de escritura son las RPC de identidad,
-- que auditan y que aplican las reglas de quien puede otorgar que.

revoke insert, update, delete on table public.business_members from authenticated;

create or replace function public.identity_guard_membership_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_is_local_admin boolean;
begin
  -- Las RPC de identidad marcan la transaccion antes de escribir.
  if coalesce(current_setting('taba.identity_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  -- Migraciones, semillas y fixtures corren como el rol de la conexion directa.
  select coalesce(bool_or(r.rolsuper), false) or session_user in ('postgres', 'supabase_admin')
    into v_is_local_admin
    from pg_catalog.pg_roles r
   where r.rolname = session_user;

  if v_is_local_admin then
    return coalesce(new, old);
  end if;

  -- Tareas de plataforma con clave de servicio.
  if current_user = 'service_role' then
    return coalesce(new, old);
  end if;

  raise exception 'identity: las membresias se administran por RPC de identidad'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists business_members_identity_guard on public.business_members;
create trigger business_members_identity_guard
before insert or update or delete on public.business_members
for each row execute function public.identity_guard_membership_write();

-- ===========================================================================
-- 5. Superficie
-- ===========================================================================

revoke execute on function public.identity_kill_auth_session(uuid) from public, anon, authenticated;
revoke execute on function public.identity_kill_auth_sessions_for_user(uuid) from public, anon, authenticated;
revoke execute on function public.identity_guard_membership_write() from public, anon, authenticated;

revoke execute on function public.identity_register_session(uuid, text, text, text, text) from public, anon;
revoke execute on function public.identity_touch_session(uuid) from public, anon;
revoke execute on function public.identity_close_own_session(uuid) from public, anon;

grant execute on function public.identity_register_session(uuid, text, text, text, text) to authenticated;
grant execute on function public.identity_touch_session(uuid) to authenticated;
grant execute on function public.identity_close_own_session(uuid) to authenticated;
