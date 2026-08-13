-- TABA2 · Capa de identidad, parte 3: la compuerta de autorizacion.
--
-- Todo el backend ya preguntaba "¿este usuario tiene tal rol en tal comercio?"
-- a traves de dos funciones: public.is_business_member y
-- public.has_business_role. Estan cableadas en decenas de politicas RLS y de
-- RPC. En vez de agregar una segunda autoridad paralela, esta migracion mete
-- las reglas nuevas ADENTRO de esas dos funciones, conservando su firma. El
-- efecto es que una baja o una revocacion se hacen valer en todo lo ya escrito
-- sin tocar ninguna politica.
--
-- Reglas que agrega la compuerta, todas fail-closed:
--   * un usuario anonimo (el de los clientes que compran) nunca es equipo;
--   * una membresia inactiva no autoriza nada;
--   * una persona deshabilitada no autoriza nada;
--   * una sesion marcada como revocada no autoriza nada, aunque su access
--     token siga firmado y sin vencer;
--   * un token emitido antes de sessions_valid_from no autoriza nada; si el
--     token no se puede fechar y hay un corte vigente, tampoco.
--
-- Aplicar despues de 20260812020000_identity_sessions_and_audit.sql.

-- ===========================================================================
-- 1. Lectura segura de los claims
-- ===========================================================================

create or replace function public.identity_jwt_claims()
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_raw text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if v_raw is null then
    return null;
  end if;
  return v_raw::jsonb;
exception
  when others then
    -- Un claim ilegible se trata como ausencia de claim, nunca como permiso.
    return null;
end;
$$;

create or replace function public.identity_session_id()
returns uuid
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_value text := public.identity_jwt_claims() ->> 'session_id';
begin
  if v_value is null or v_value = '' then
    return null;
  end if;
  return v_value::uuid;
exception
  when others then
    return null;
end;
$$;

-- Los clientes que compran entran con sesion anonima de GoTrue. Un anonimo
-- puede ser duenio de su propio pedido, pero jamas parte del equipo.
create or replace function public.identity_is_anonymous()
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((public.identity_jwt_claims() ->> 'is_anonymous')::boolean, false)
$$;

create or replace function public.identity_token_issued_at()
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_value text := public.identity_jwt_claims() ->> 'iat';
begin
  if v_value is null or v_value = '' then
    return null;
  end if;
  return to_timestamp(v_value::double precision);
exception
  when others then
    return null;
end;
$$;

-- ===========================================================================
-- 2. La compuerta
-- ===========================================================================
-- Devuelve el rol vigente del usuario actual en el comercio, o null si no
-- tiene autoridad por cualquiera de los motivos de arriba. Es la unica
-- funcion que decide; todas las demas la consultan.

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
  if v_user is null or target_business_id is null then
    return null;
  end if;

  if public.identity_is_anonymous() then
    return null;
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = target_business_id
     and bm.user_id = v_user
     and bm.is_active = true;

  if v_role is null then
    return null;
  end if;

  select s.sessions_valid_from, s.disabled_at
    into v_valid_from, v_disabled
    from public.identity_user_security s
   where s.business_id = target_business_id
     and s.user_id = v_user;

  if v_disabled is not null then
    return null;
  end if;

  v_valid_from := coalesce(v_valid_from, '-infinity'::timestamptz);

  v_session := public.identity_session_id();
  if v_session is not null then
    select ise.revoked_at into v_revoked
      from public.identity_sessions ise
     where ise.session_id = v_session;
    if v_revoked is not null then
      return null;
    end if;
  end if;

  if v_valid_from > '-infinity'::timestamptz then
    v_issued := public.identity_token_issued_at();
    -- Un token que no se puede fechar no puede demostrar que es posterior al
    -- corte. Con un corte vigente, eso es un no.
    if v_issued is null or v_issued < v_valid_from then
      return null;
    end if;
  end if;

  return v_role;
end;
$$;

-- ===========================================================================
-- 3. Las dos funciones historicas, ahora sobre la compuerta
-- ===========================================================================
-- Misma firma, mismo tipo de retorno, misma semantica para el camino feliz.

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.identity_member_role(target_business_id) is not null
$$;

-- El coalesce final NO es decorativo. Sin el, quien no es del equipo obtiene
-- `null = any(...)` = NULL, y todo el backend pregunta en la forma
-- `if not public.has_business_role(...) then raise`: con NULL esa condicion no
-- es verdadera, no se levanta la excepcion y la llamada sigue de largo. Una
-- funcion de autorizacion que puede devolver NULL falla ABIERTA. Devuelve
-- siempre true o false.
create or replace function public.has_business_role(target_business_id uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    public.identity_member_role(target_business_id) = any (coalesce(roles, array[]::text[])),
    false
  )
$$;

-- is_assigned_rider miraba solo la columna del pedido: un Rider revocado o dado
-- de baja seguia siendo "el asignado". Ahora tambien pasa por la compuerta.
create or replace function public.is_assigned_rider(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and o.assigned_rider_user_id = auth.uid()
       and public.identity_member_role(o.business_id) = 'rider'
  )
$$;

-- ===========================================================================
-- 4. Permisos explicitos
-- ===========================================================================

create or replace function public.identity_has_permission(
  target_business_id uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.identity_role_permissions rp
     where rp.role = public.identity_member_role(target_business_id)
       and rp.permission = target_permission
  )
$$;

-- Version que corta la ejecucion. Las RPC de identidad la usan como primera
-- linea, de modo que el error sea el mismo siempre y no se filtre por que.
create or replace function public.identity_require_permission(
  target_business_id uuid,
  target_permission text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role text := public.identity_member_role(target_business_id);
begin
  if v_role is null or not exists (
    select 1
      from public.identity_role_permissions rp
     where rp.role = v_role
       and rp.permission = target_permission
  ) then
    raise exception 'identity: no autorizado'
      using errcode = 'insufficient_privilege';
  end if;
  return v_role;
end;
$$;

-- Lectura del propio contexto. Sirve al Panel y al Rider para saber que
-- pueden mostrar, sabiendo que la autoridad sigue siendo el backend.
create or replace function public.identity_current_context(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'business_id', p_business_id,
    'role', public.identity_member_role(p_business_id),
    'session_id', public.identity_session_id(),
    'is_anonymous', public.identity_is_anonymous(),
    'permissions', coalesce((
      select jsonb_agg(rp.permission order by rp.permission)
        from public.identity_role_permissions rp
       where rp.role = public.identity_member_role(p_business_id)
    ), '[]'::jsonb)
  )
$$;

-- ===========================================================================
-- 5. Superficie
-- ===========================================================================

-- PostgreSQL otorga EXECUTE a PUBLIC en cuanto se crea una funcion. Las que
-- leen claims son internas de la compuerta: las llama identity_member_role,
-- que es definer y corre como su duenio, asi que nadie mas necesita poder
-- ejecutarlas. Dejarlas abiertas no daba permisos, pero si una superficie de
-- lectura del token que no le hace falta a ningun cliente.
revoke execute on function public.identity_jwt_claims() from public, anon, authenticated;
revoke execute on function public.identity_session_id() from public, anon, authenticated;
revoke execute on function public.identity_is_anonymous() from public, anon, authenticated;
revoke execute on function public.identity_token_issued_at() from public, anon, authenticated;
revoke execute on function public.identity_require_permission(uuid, text) from public, anon, authenticated;
revoke execute on function public.identity_member_role(uuid) from public, anon;
revoke execute on function public.identity_has_permission(uuid, text) from public, anon;
revoke execute on function public.identity_current_context(uuid) from public, anon;

grant execute on function public.identity_member_role(uuid) to authenticated;
grant execute on function public.identity_has_permission(uuid, text) to authenticated;
grant execute on function public.identity_current_context(uuid) to authenticated;
