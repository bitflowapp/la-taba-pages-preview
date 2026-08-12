-- TABA2 · Ensayos hostiles de la capa de identidad.
--
--   TABA_LOCAL_IDENTITY_DB=1 node scripts/run-identity-rbac-drills.mjs
--
-- Cada intento se hace de verdad contra el motor, con los mismos claims que
-- pone PostgREST: `request.jwt.claims` con sub, role, session_id, iat, email e
-- is_anonymous, y `set local role authenticated`. No se simula la autorizacion:
-- se la ataca.
--
-- Este archivo es local y descartable. No habla con staging.

\set ON_ERROR_STOP on
set client_min_messages = warning;

drop schema if exists identity_drill cascade;
create schema identity_drill;

create table identity_drill.results (
  seq serial primary key,
  label text not null,
  ok boolean not null,
  detail text not null default ''
);

create table identity_drill.fixture (
  key text primary key,
  value text not null
);

create or replace function identity_drill.put(p_key text, p_value text)
returns void language sql as $$
  insert into identity_drill.fixture(key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
$$;

create or replace function identity_drill.get(p_key text)
returns text language sql stable as $$
  select value from identity_drill.fixture where key = p_key;
$$;

create or replace function identity_drill.check(p_label text, p_ok boolean, p_detail text default '')
returns void language sql as $$
  insert into identity_drill.results(label, ok, detail) values (p_label, coalesce(p_ok, false), coalesce(p_detail, ''));
$$;

-- Claims equivalentes a los que emite GoTrue. session_id e iat son los dos que
-- sostienen la revocacion.
create or replace function identity_drill.claims(
  p_user uuid,
  p_session uuid default null,
  p_iat timestamptz default null,
  p_email text default null,
  p_anonymous boolean default false,
  p_forged_role text default null
)
returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'sub', p_user::text,
    'aud', 'authenticated',
    'role', coalesce(p_forged_role, 'authenticated'),
    'session_id', p_session::text,
    'iat', case when p_iat is null then null else floor(extract(epoch from p_iat))::bigint end,
    'email', p_email,
    'is_anonymous', p_anonymous
  ));
$$;

-- Ejecuta una consulta como `authenticated` con esos claims y devuelve
-- {ok, result} o {ok:false, sqlstate, message}. Nunca propaga la excepcion:
-- que una llamada hostil falle es justamente el resultado que se mide.
create or replace function identity_drill.q(p_claims jsonb, p_sql text)
returns jsonb language plpgsql as $$
declare
  v_result text;
  v_state text;
  v_msg text;
begin
  begin
    perform set_config('request.jwt.claims', p_claims::text, true);
    execute 'set local role authenticated';
    execute p_sql into v_result;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('ok', true, 'result', v_result);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('ok', false, 'sqlstate', v_state, 'message', v_msg);
  end;
end;
$$;

-- Igual que q pero para sentencias que no devuelven fila.
create or replace function identity_drill.x(p_claims jsonb, p_sql text)
returns jsonb language plpgsql as $$
declare
  v_state text;
  v_msg text;
  v_rows bigint;
begin
  begin
    perform set_config('request.jwt.claims', p_claims::text, true);
    execute 'set local role authenticated';
    execute p_sql;
    get diagnostics v_rows = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('ok', true, 'rows', v_rows);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    begin execute 'reset role'; exception when others then null; end;
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('ok', false, 'sqlstate', v_state, 'message', v_msg);
  end;
end;
$$;

create or replace function identity_drill.new_user(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated', lower(p_email), '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  return v_id;
end;
$$;

-- ===========================================================================
-- Fixture
-- ===========================================================================

do $$
declare
  v_slug text := 'idt-' || right(replace(gen_random_uuid()::text, '-', ''), 10);
  v_business uuid := gen_random_uuid();
  v_owner uuid;
begin
  v_owner := identity_drill.new_user('owner-' || v_slug || '@taba.test');
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'Identidad ' || v_slug, v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00
  );

  -- Arranque: el primer owner lo crea la plataforma, no una invitacion.
  -- Es exactamente lo que hara el alta de PROD.
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true);
  insert into public.staff_profiles (business_id, user_id, full_name)
  values (v_business, v_owner, 'Duenia del comercio');
  insert into public.identity_user_security (business_id, user_id)
  values (v_business, v_owner);

  perform identity_drill.put('business', v_business::text);
  perform identity_drill.put('owner', v_owner::text);
  perform identity_drill.put('slug', v_slug);
  perform identity_drill.put('owner_email', 'owner-' || v_slug || '@taba.test');

  -- Un segundo comercio para probar el cruce entre negocios.
  declare
    v_other uuid := gen_random_uuid();
    v_other_owner uuid := identity_drill.new_user('otro-' || v_slug || '@taba.test');
  begin
    insert into public.businesses (id, name, slug, status, is_active, currency_code)
    values (v_other, 'Otro ' || v_slug, v_slug || '-otro', 'open', true, 'ARS');
    insert into public.business_members (business_id, user_id, role, is_active)
    values (v_other, v_other_owner, 'owner', true);
    perform identity_drill.put('other_business', v_other::text);
    perform identity_drill.put('other_owner', v_other_owner::text);
  end;

  -- Personas que todavia no son nadie en el comercio.
  perform identity_drill.put('admin', identity_drill.new_user('admin-' || v_slug || '@taba.test')::text);
  perform identity_drill.put('admin_email', 'admin-' || v_slug || '@taba.test');
  perform identity_drill.put('staff', identity_drill.new_user('staff-' || v_slug || '@taba.test')::text);
  perform identity_drill.put('staff_email', 'staff-' || v_slug || '@taba.test');
  perform identity_drill.put('rider', identity_drill.new_user('rider-' || v_slug || '@taba.test')::text);
  perform identity_drill.put('rider_email', 'rider-' || v_slug || '@taba.test');
  perform identity_drill.put('rider2', identity_drill.new_user('rider2-' || v_slug || '@taba.test')::text);
  perform identity_drill.put('rider2_email', 'rider2-' || v_slug || '@taba.test');
  perform identity_drill.put('outsider', identity_drill.new_user('afuera-' || v_slug || '@taba.test')::text);
  perform identity_drill.put('customer', identity_drill.new_user('cliente-' || v_slug || '@taba.test')::text);

  perform identity_drill.put('owner_session', gen_random_uuid()::text);
  perform identity_drill.put('admin_session', gen_random_uuid()::text);
  perform identity_drill.put('staff_session', gen_random_uuid()::text);
  perform identity_drill.put('rider_session', gen_random_uuid()::text);
end;
$$;

-- ===========================================================================
-- A · Alta por invitacion
-- ===========================================================================

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_owner uuid := identity_drill.get('owner')::uuid;
  v_owner_claims jsonb := identity_drill.claims(v_owner, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email'));
  v_res jsonb;
  v_token text;
begin
  -- El owner registra su sesion, que es lo que hara el Panel al entrar.
  v_res := identity_drill.q(v_owner_claims,
    format('select public.identity_register_session(%L, %L, %L, null, %L)::text', v_b, 'panel_web', 'Chrome · Windows', '1.0.0'));
  perform identity_drill.check(
    'el owner registra su sesion al entrar',
    (v_res ->> 'ok')::boolean and (v_res ->> 'result')::jsonb ->> 'code' = 'registered',
    coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 1. Invitacion de staff emitida por el owner.
  v_res := identity_drill.q(v_owner_claims,
    format('select public.identity_create_invitation(%L, %L, %L, %L)::text', v_b, identity_drill.get('staff_email'), 'staff', 'Persona de mostrador'));
  v_token := (v_res ->> 'result')::jsonb ->> 'token';
  perform identity_drill.put('staff_token', coalesce(v_token, ''));
  perform identity_drill.check(
    'el owner emite una invitacion de staff',
    (v_res ->> 'ok')::boolean and coalesce(length(v_token), 0) = 64,
    'token de ' || coalesce(length(v_token), 0) || ' caracteres, devuelto una sola vez');

  -- 2. El token nunca queda en claro en la base.
  perform identity_drill.check(
    'el token no queda guardado en claro',
    not exists (select 1 from public.identity_invitations where token_hash = v_token),
    'la tabla solo guarda sha256');

  -- 3. Un tercero sin membresia no puede invitar.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('outsider')::uuid, gen_random_uuid(), now(), 'afuera@taba.test'),
    format('select public.identity_create_invitation(%L, %L, %L, %L)::text', v_b, 'colado@taba.test', 'owner', 'Colado'));
  perform identity_drill.check(
    'un ajeno al comercio no puede invitar',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 4. El token no sirve en manos de otro correo.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, gen_random_uuid(), now(), identity_drill.get('rider_email')),
    format('select public.identity_accept_invitation(%L)::text', v_token));
  perform identity_drill.check(
    'una invitacion filtrada no sirve con otro correo',
    (v_res ->> 'ok')::boolean and (v_res ->> 'result')::jsonb ->> 'code' = 'invalid_token',
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));

  -- 5. La persona invitada la canjea.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, identity_drill.get('staff_session')::uuid, now(), identity_drill.get('staff_email')),
    format('select public.identity_accept_invitation(%L)::text', v_token));
  perform identity_drill.check(
    'la persona invitada canjea y nace la membresia',
    (v_res ->> 'ok')::boolean
      and ((v_res ->> 'result')::jsonb ->> 'ok')::boolean
      and exists (select 1 from public.business_members where business_id = v_b and user_id = identity_drill.get('staff')::uuid and role = 'staff' and is_active)
      and exists (select 1 from public.staff_profiles where business_id = v_b and user_id = identity_drill.get('staff')::uuid),
    'membresia y perfil de staff creados');

  -- 6. El mismo token no se canjea dos veces.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, gen_random_uuid(), now(), identity_drill.get('staff_email')),
    format('select public.identity_accept_invitation(%L)::text', v_token));
  perform identity_drill.check(
    'el token no se puede canjear dos veces',
    (v_res ->> 'result')::jsonb ->> 'code' = 'invalid_token',
    coalesce((v_res ->> 'result')::jsonb ->> 'code', '-'));
end;
$$;

-- Alta de admin y de riders, por la misma via.
do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_owner_claims jsonb := identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email'));
  v_res jsonb;
  v_token text;
begin
  for v_token in
    select unnest(array['admin', 'rider', 'rider2'])
  loop
    declare
      v_role text := case when v_token = 'admin' then 'admin' else 'rider' end;
      v_email text := identity_drill.get(v_token || '_email');
      v_created jsonb;
      v_t text;
    begin
      v_created := identity_drill.q(v_owner_claims,
        format('select public.identity_create_invitation(%L, %L, %L, %L)::text', v_b, v_email, v_role, 'Persona ' || v_token));
      v_t := (v_created ->> 'result')::jsonb ->> 'token';
      v_res := identity_drill.q(
        identity_drill.claims(identity_drill.get(v_token)::uuid, coalesce(identity_drill.get(v_token || '_session'), gen_random_uuid()::text)::uuid, now(), v_email),
        format('select public.identity_accept_invitation(%L)::text', v_t));
      perform identity_drill.check(
        'alta de ' || v_token || ' por invitacion',
        ((v_res ->> 'result')::jsonb ->> 'ok')::boolean,
        'rol ' || v_role);
    end;
  end loop;
end;
$$;

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_res jsonb;
  v_admin_claims jsonb := identity_drill.claims(identity_drill.get('admin')::uuid, identity_drill.get('admin_session')::uuid, now(), identity_drill.get('admin_email'));
begin
  -- 7. Un admin no arma la conduccion.
  v_res := identity_drill.q(v_admin_claims,
    format('select public.identity_create_invitation(%L, %L, %L, %L)::text', v_b, 'otro-owner@taba.test', 'owner', 'Otro duenio'));
  perform identity_drill.check(
    'un admin no puede invitar a un owner',
    (v_res ->> 'result')::jsonb ->> 'code' = 'role_above_actor',
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));

  -- 8. Un rider no invita a nadie.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now(), identity_drill.get('rider_email')),
    format('select public.identity_create_invitation(%L, %L, %L, %L)::text', v_b, 'amigo@taba.test', 'rider', 'Un amigo'));
  perform identity_drill.check(
    'un rider no puede invitar a nadie',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));
end;
$$;

-- ===========================================================================
-- B · RBAC hostil sobre las RPC que ya existian
-- ===========================================================================

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_res jsonb;
begin
  -- 9. Un rider llamando una RPC de mostrador.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now(), identity_drill.get('rider_email')),
    format('select public.set_business_open_state(%L, %L)::text', v_b, 'paused'));
  perform identity_drill.check(
    'un rider no puede cerrar el comercio',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 10. Un staff llamando una RPC reservada a owner/admin.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, identity_drill.get('staff_session')::uuid, now(), identity_drill.get('staff_email')),
    format('select public.authorize_arca_homologation(%L, %L)::text', v_b, 'AUTORIZO'));
  perform identity_drill.check(
    'un staff no puede firmar la homologacion fiscal',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 11. No regresion: el admin si puede operar el comercio.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('admin')::uuid, identity_drill.get('admin_session')::uuid, now(), identity_drill.get('admin_email')),
    format('select public.set_business_open_state(%L, %L)::text', v_b, 'open'));
  perform identity_drill.check(
    'el admin si puede operar el comercio (no regresion)',
    (v_res ->> 'ok')::boolean,
    coalesce(left(v_res ->> 'result', 60), v_res ->> 'message'));

  -- 12. Un staff no administra el equipo.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, identity_drill.get('staff_session')::uuid, now(), identity_drill.get('staff_email')),
    format('select public.identity_set_member_role(%L, %L, %L)::text', v_b, identity_drill.get('rider'), 'admin'));
  perform identity_drill.check(
    'un staff no puede cambiar roles',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 13. Un admin no fabrica otro owner.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('admin')::uuid, identity_drill.get('admin_session')::uuid, now(), identity_drill.get('admin_email')),
    format('select public.identity_set_member_role(%L, %L, %L)::text', v_b, identity_drill.get('staff'), 'owner'));
  perform identity_drill.check(
    'un admin no puede promover a owner',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 14. Un admin no toca a un owner.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('admin')::uuid, identity_drill.get('admin_session')::uuid, now(), identity_drill.get('admin_email')),
    format('select public.identity_set_member_active(%L, %L, false, %L)::text', v_b, identity_drill.get('owner'), 'prueba'));
  perform identity_drill.check(
    'un admin no puede dar de baja al owner',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 15. Un rider no ve el equipo.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now(), identity_drill.get('rider_email')),
    format('select public.identity_list_members(%L)::text', v_b));
  perform identity_drill.check(
    'un rider no puede listar el equipo',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 16. El owner si.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email')),
    format('select jsonb_array_length(public.identity_list_members(%L))::text', v_b));
  perform identity_drill.check(
    'el owner ve el equipo completo',
    (v_res ->> 'ok')::boolean and (v_res ->> 'result')::integer = 5,
    'integrantes: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 17 y 18. El ultimo owner no se puede quedar sin comercio.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email')),
    format('select public.identity_set_member_role(%L, %L, %L)::text', v_b, identity_drill.get('owner'), 'staff'));
  perform identity_drill.check(
    'el ultimo owner no puede degradarse',
    (v_res ->> 'result')::jsonb ->> 'code' = 'last_owner',
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));

  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email')),
    format('select public.identity_set_member_active(%L, %L, false, %L)::text', v_b, identity_drill.get('owner'), 'prueba'));
  perform identity_drill.check(
    'el ultimo owner no puede darse de baja',
    (v_res ->> 'result')::jsonb ->> 'code' = 'last_owner',
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));
end;
$$;

-- ===========================================================================
-- C · Escalada por manipulacion del cliente
-- ===========================================================================

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_res jsonb;
begin
  -- 19. authenticated ya no tiene escritura sobre las membresias.
  perform identity_drill.check(
    'authenticated no tiene insert/update/delete sobre business_members',
    not has_table_privilege('authenticated', 'public.business_members', 'insert')
      and not has_table_privilege('authenticated', 'public.business_members', 'update')
      and not has_table_privilege('authenticated', 'public.business_members', 'delete'),
    'solo queda select');

  -- 19 bis. La regresion que casi se cuela: una funcion de autorizacion que
  -- devuelve NULL falla ABIERTA. Todo el backend pregunta en la forma
  -- `if not has_business_role(...) then raise`, y con NULL esa condicion no es
  -- verdadera: la excepcion no se levanta y la llamada sigue. Se mide que
  -- devuelve exactamente false para quien no es del equipo, no null.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('outsider')::uuid, gen_random_uuid(), now(), 'afuera@taba.test'),
    format('select coalesce(public.has_business_role(%L, array[''owner'',''admin'',''staff''])::text, ''(NULL)'')', v_b));
  perform identity_drill.check(
    'has_business_role devuelve false, nunca null, para un ajeno',
    v_res ->> 'result' = 'false',
    'devolvio: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('outsider')::uuid, gen_random_uuid(), now(), 'afuera@taba.test'),
    format('select coalesce(public.is_business_member(%L)::text, ''(NULL)'')', v_b));
  perform identity_drill.check(
    'is_business_member devuelve false, nunca null, para un ajeno',
    v_res ->> 'result' = 'false',
    'devolvio: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 19 ter. La clave de servicio SI tiene que poder escribir membresias.
  --
  -- Es la unica via habilitada fuera de las RPC de identidad y existe para el
  -- arranque de un entorno nuevo: el primer owner no puede nacer de una
  -- invitacion porque todavia no hay nadie que pueda emitirla. El guard estuvo
  -- roto exactamente aca —era `security definer`, asi que `current_user` era el
  -- duenio de la funcion y nunca `service_role`— y eso dejaba sin arranque a
  -- PROD. Se mide el camino, no la intencion.
  declare
    v_alta_ok boolean := false;
    v_detalle text := '';
    -- Se resuelve ANTES de cambiar de rol: service_role no tiene permiso sobre
    -- el esquema del ensayo, y leerlo ahi adentro falsearia el resultado.
    v_ajeno uuid := identity_drill.get('outsider')::uuid;
  begin
    begin
      execute 'set local role service_role';
      insert into public.business_members (business_id, user_id, role, is_active)
      values (v_b, v_ajeno, 'staff', true);
      execute 'reset role';
      v_alta_ok := true;
    exception when others then
      begin execute 'reset role'; exception when others then null; end;
      v_detalle := sqlstate || ' ' || sqlerrm;
    end;
    perform identity_drill.check(
      'la clave de servicio puede crear membresias (arranque de un entorno)',
      v_alta_ok,
      case when v_alta_ok then 'sin esto no hay forma de crear el primer owner' else v_detalle end);
    perform set_config('taba.identity_write', 'on', true);
    delete from public.business_members where business_id = v_b and user_id = v_ajeno;
    perform set_config('taba.identity_write', 'off', true);
  end;

  -- 20. El rider intenta subirse el rol escribiendo su propia fila.
  v_res := identity_drill.x(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now(), identity_drill.get('rider_email')),
    format('update public.business_members set role = ''owner'' where business_id = %L and user_id = %L', v_b, identity_drill.get('rider')));
  perform identity_drill.check(
    'un rider no puede reescribir su propio rol',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 21. Un ajeno se inscribe solo.
  v_res := identity_drill.x(
    identity_drill.claims(identity_drill.get('outsider')::uuid, gen_random_uuid(), now(), 'afuera@taba.test'),
    format('insert into public.business_members (business_id, user_id, role, is_active) values (%L, %L, ''owner'', true)', v_b, identity_drill.get('outsider')));
  perform identity_drill.check(
    'un ajeno no puede inscribirse solo',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 22. El claim `role` del token no decide nada: la autoridad es la base.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now(), identity_drill.get('rider_email'), false, 'service_role'),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'falsificar el claim role no cambia el rol real',
    (v_res ->> 'ok')::boolean and v_res ->> 'result' = 'rider',
    'rol resuelto: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 23. Un anonimo con membresia activa sigue sin ser equipo.
  perform set_config('taba.identity_write', 'on', true);
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_b, identity_drill.get('customer')::uuid, 'owner', true);
  perform set_config('taba.identity_write', 'off', true);
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('customer')::uuid, gen_random_uuid(), now(), null, true),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'una sesion anonima nunca es equipo, aunque tenga membresia',
    (v_res ->> 'ok')::boolean and v_res ->> 'result' = '(ninguno)',
    'rol resuelto: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- Y esa misma persona, con sesion normal, si lo seria: la diferencia es el
  -- claim is_anonymous, no otra cosa.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('customer')::uuid, gen_random_uuid(), now(), 'cliente@taba.test', false),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'la unica diferencia medida es el claim is_anonymous',
    (v_res ->> 'ok')::boolean and v_res ->> 'result' = 'owner',
    'rol resuelto sin anonimato: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  perform set_config('taba.identity_write', 'on', true);
  delete from public.business_members where business_id = v_b and user_id = identity_drill.get('customer')::uuid;
  perform set_config('taba.identity_write', 'off', true);
end;
$$;

-- ===========================================================================
-- D · Acceso cruzado
-- ===========================================================================

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_res jsonb;
begin
  -- 24. Un staff no opera el comercio ajeno.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, identity_drill.get('staff_session')::uuid, now(), identity_drill.get('staff_email')),
    format('select public.set_business_open_state(%L, %L)::text', identity_drill.get('other_business'), 'closed'));
  perform identity_drill.check(
    'un staff no opera el comercio de al lado',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 25. El owner de otro comercio no ve este equipo.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('other_owner')::uuid, gen_random_uuid(), now(), 'otro@taba.test'),
    format('select public.identity_list_members(%L)::text', v_b));
  perform identity_drill.check(
    'el owner de otro comercio no ve este equipo',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 26. Un rider no puede revocar la sesion de otra persona.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now(), identity_drill.get('rider_email')),
    format('select public.identity_revoke_session(%L)::text', identity_drill.get('owner_session')));
  perform identity_drill.check(
    'un rider no puede cerrar la sesion del owner',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));
end;
$$;

-- ===========================================================================
-- E · Baja de cuenta y revocacion de sesion
-- ===========================================================================

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_owner_claims jsonb := identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email'));
  v_staff_claims jsonb := identity_drill.claims(identity_drill.get('staff')::uuid, identity_drill.get('staff_session')::uuid, now(), identity_drill.get('staff_email'));
  v_res jsonb;
begin
  -- El staff registra su sesion y opera con normalidad.
  v_res := identity_drill.q(v_staff_claims,
    format('select public.identity_register_session(%L, %L, %L, null, %L)::text', v_b, 'panel_web', 'Chrome · Windows', '1.0.0'));
  perform identity_drill.check(
    'el staff registra su sesion',
    ((v_res ->> 'result')::jsonb ->> 'ok')::boolean,
    coalesce((v_res ->> 'result')::jsonb ->> 'code', '-'));

  v_res := identity_drill.q(v_staff_claims,
    format('select public.set_business_open_state(%L, %L)::text', v_b, 'open'));
  perform identity_drill.check(
    'antes de la revocacion, el staff opera',
    (v_res ->> 'ok')::boolean,
    'linea de base');

  -- 27. Revocacion de esa sesion por el owner.
  v_res := identity_drill.q(v_owner_claims,
    format('select public.identity_revoke_session(%L)::text', identity_drill.get('staff_session')));
  perform identity_drill.check(
    'el owner revoca la sesion del staff',
    ((v_res ->> 'result')::jsonb ->> 'ok')::boolean,
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));

  -- 28. El MISMO token, sin vencer, ya no abre nada.
  v_res := identity_drill.q(v_staff_claims,
    format('select public.set_business_open_state(%L, %L)::text', v_b, 'open'));
  perform identity_drill.check(
    'una sesion revocada deja de operar de inmediato, con el token intacto',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 29. Y no se puede volver a registrar para revivirla.
  v_res := identity_drill.q(v_staff_claims,
    format('select public.identity_register_session(%L, %L, null, null, null)::text', v_b, 'panel_web'));
  perform identity_drill.check(
    'una sesion revocada no se resucita registrandola de nuevo',
    (v_res ->> 'result')::jsonb ->> 'code' = 'not_authorized',
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));

  -- 30. Con una sesion nueva la persona vuelve a trabajar: se revoco la
  -- sesion, no a la persona.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, gen_random_uuid(), now(), identity_drill.get('staff_email')),
    format('select public.set_business_open_state(%L, %L)::text', v_b, 'open'));
  perform identity_drill.check(
    'la persona vuelve a entrar con una sesion nueva',
    (v_res ->> 'ok')::boolean,
    'se revoco la sesion, no la persona');
end;
$$;

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_owner_claims jsonb := identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email'));
  v_res jsonb;
  v_cut timestamptz;
begin
  -- 31. Cerrar TODAS las sesiones del staff.
  v_res := identity_drill.q(v_owner_claims,
    format('select public.identity_revoke_all_sessions(%L, %L)::text', v_b, identity_drill.get('staff')));
  perform identity_drill.check(
    'el owner cierra todas las sesiones de una persona',
    ((v_res ->> 'result')::jsonb ->> 'ok')::boolean,
    'sesiones cerradas: ' || coalesce((v_res ->> 'result')::jsonb ->> 'sessions_revoked', '-'));

  select sessions_valid_from into v_cut
    from public.identity_user_security
   where business_id = v_b and user_id = identity_drill.get('staff')::uuid;

  if v_cut is null or v_cut = '-infinity'::timestamptz then
    perform identity_drill.check('la linea de corte quedo escrita', false,
      'sessions_valid_from sigue en ' || coalesce(v_cut::text, 'null'));
    return;
  end if;
  perform identity_drill.check('la linea de corte quedo escrita', true, v_cut::text);

  -- 32. Un token viejo que nunca se registro tampoco pasa: queda del lado
  -- viejo de la linea de corte.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, gen_random_uuid(), v_cut - interval '5 minutes', identity_drill.get('staff_email')),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'un token anterior al corte no autoriza, aunque su sesion sea desconocida',
    v_res ->> 'result' = '(ninguno)',
    'rol resuelto: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 33. Un token que no se puede fechar, con un corte vigente, tampoco.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, gen_random_uuid(), null, identity_drill.get('staff_email')),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'un token sin iat no puede probar que es posterior al corte',
    v_res ->> 'result' = '(ninguno)',
    'fail-closed');

  -- 34. Un login posterior al corte si trabaja.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, gen_random_uuid(), v_cut + interval '1 second', identity_drill.get('staff_email')),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'un login posterior al corte vuelve a trabajar',
    v_res ->> 'result' = 'staff',
    'rol resuelto: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));
end;
$$;

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_owner_claims jsonb := identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email'));
  v_res jsonb;
begin
  -- El rider abre su sesion como lo hace la app al entrar, para que la baja
  -- tenga algo que cerrar y el numero se pueda mirar.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now(), identity_drill.get('rider_email')),
    format('select public.identity_register_session(%L, %L, %L, null, %L)::text', v_b, 'rider_android', 'Moto G15 · Android 15', '1.0.0'));
  perform identity_drill.check(
    'el rider registra su sesion desde el telefono',
    ((v_res ->> 'result')::jsonb ->> 'ok')::boolean,
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));

  -- 35. Baja de la cuenta del rider.
  v_res := identity_drill.q(v_owner_claims,
    format('select public.identity_set_member_active(%L, %L, false, %L)::text', v_b, identity_drill.get('rider'), 'dejo el trabajo'));
  perform identity_drill.check(
    'dar de baja a un rider le cierra las sesiones abiertas',
    ((v_res ->> 'result')::jsonb ->> 'ok')::boolean
      and ((v_res ->> 'result')::jsonb ->> 'sessions_revoked')::integer >= 1,
    'sesiones cerradas: ' || coalesce((v_res ->> 'result')::jsonb ->> 'sessions_revoked', '-'));

  -- 36. La cuenta deshabilitada pierde toda autoridad, con token nuevo o viejo.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, gen_random_uuid(), now() + interval '1 hour', identity_drill.get('rider_email')),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'una cuenta deshabilitada no autoriza ni con un token recien emitido',
    v_res ->> 'result' = '(ninguno)',
    'rol resuelto: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 37. El perfil quedo suspendido, no borrado: el historial se conserva.
  perform identity_drill.check(
    'la baja suspende el perfil y conserva el historial',
    exists (select 1 from public.rider_profiles where business_id = v_b and user_id = identity_drill.get('rider')::uuid and status = 'suspended'),
    'rider_profiles.status = suspended');

  -- 38. Y se puede reactivar.
  v_res := identity_drill.q(v_owner_claims,
    format('select public.identity_set_member_active(%L, %L, true, null)::text', v_b, identity_drill.get('rider')));
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, gen_random_uuid(), now() + interval '2 hours', identity_drill.get('rider_email')),
    format('select coalesce(public.identity_member_role(%L), ''(ninguno)'')', v_b));
  perform identity_drill.check(
    'reactivar devuelve el acceso',
    v_res ->> 'result' = 'rider',
    'rol resuelto: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));
end;
$$;

-- ===========================================================================
-- F · Auditoria
-- ===========================================================================

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_res jsonb;
  v_types text[];
begin
  -- 39. La auditoria no se reescribe.
  begin
    update public.identity_audit_events set event_type = 'session_opened' where id > 0;
    perform identity_drill.check('la auditoria no se puede reescribir', false, 'el update paso');
  exception when others then
    perform identity_drill.check('la auditoria no se puede reescribir', sqlstate = '42501', 'SQLSTATE ' || sqlstate);
  end;

  -- 40. Ni se borra.
  begin
    delete from public.identity_audit_events where id > 0;
    perform identity_drill.check('la auditoria no se puede borrar', false, 'el delete paso');
  exception when others then
    perform identity_drill.check('la auditoria no se puede borrar', sqlstate = '42501', 'SQLSTATE ' || sqlstate);
  end;

  -- 41. Ni se lee directo desde el cliente.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email')),
    'select count(*)::text from public.identity_audit_events');
  perform identity_drill.check(
    'la auditoria no es legible por tabla, ni para el owner',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 42. Pero si por la RPC del owner.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email')),
    format('select jsonb_array_length(public.identity_list_audit_events(%L, 500))::text', v_b));
  perform identity_drill.check(
    'el owner lee la auditoria por RPC',
    (v_res ->> 'ok')::boolean and (v_res ->> 'result')::integer > 0,
    'eventos: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 43. Un staff no lee la auditoria.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('staff')::uuid, gen_random_uuid(), now() + interval '1 hour', identity_drill.get('staff_email')),
    format('select public.identity_list_audit_events(%L, 10)::text', v_b));
  perform identity_drill.check(
    'un staff no lee la auditoria',
    not (v_res ->> 'ok')::boolean and v_res ->> 'sqlstate' = '42501',
    'SQLSTATE ' || coalesce(v_res ->> 'sqlstate', '-'));

  -- 44. Estan los eventos que tienen que estar.
  select array_agg(distinct event_type order by event_type) into v_types
    from public.identity_audit_events where business_id = v_b;
  perform identity_drill.check(
    'la auditoria registro alta, baja, revocacion y sesiones',
    v_types @> array['member_invited', 'invitation_accepted', 'member_disabled', 'member_activated', 'session_opened', 'session_revoked', 'sessions_revoked_all'],
    'tipos: ' || array_to_string(v_types, ', '));

  -- 44 bis. La auditoria sobrevive al borrado de lo que audita.
  --
  -- El defecto aparecio en staging alojado: las claves foraneas de la
  -- auditoria declaraban `on delete set null`, y el UPDATE que dispara esa
  -- cascada lo rechazaba el propio trigger de solo-agregado. Neto: una vez
  -- auditado, un comercio o una cuenta ya no se podian borrar nunca.
  declare
    v_efimero uuid := gen_random_uuid();
    v_usuario uuid;
    v_error text := '';
  begin
    v_usuario := identity_drill.new_user('efimero-' || identity_drill.get('slug') || '@taba.test');
    insert into public.businesses (id, name, slug, status, is_active, currency_code)
    values (v_efimero, 'Efimero', identity_drill.get('slug') || '-efimero', 'open', true, 'ARS');
    perform public.identity_record_audit_event(
      p_event_type => 'session_opened',
      p_business_id => v_efimero,
      p_actor_user_id => v_usuario,
      p_subject_user_id => v_usuario);
    begin
      delete from public.businesses where id = v_efimero;
      delete from auth.users where id = v_usuario;
    exception when others then
      v_error := sqlstate || ' ' || sqlerrm;
    end;
    perform identity_drill.check(
      'borrar un comercio auditado no lo bloquea la auditoria',
      v_error = '' and not exists (select 1 from public.businesses where id = v_efimero),
      case when v_error = '' then 'borrado, y el evento sigue en la auditoria' else v_error end);
    perform identity_drill.check(
      'el evento sobrevive al borrado, con su identificador intacto',
      exists (select 1 from public.identity_audit_events where business_id = v_efimero),
      'una auditoria que pierde el id de lo que audita no sirve para nada');
  end;

  -- 45. Y no guardo ningun secreto.
  perform identity_drill.check(
    'la auditoria no guarda tokens ni correos completos',
    not exists (
      select 1 from public.identity_audit_events a
       where a.metadata::text like '%' || identity_drill.get('staff_token') || '%'
          or a.metadata::text like '%' || identity_drill.get('staff_email') || '%'),
    'ni el token de invitacion ni el correo aparecen en metadata');
end;
$$;

-- ===========================================================================
-- G · Higiene de la superficie
-- ===========================================================================

do $$
declare
  v_bad text[];
begin
  -- 46. Toda funcion definer de identidad fija su search_path.
  select array_agg(p.proname order by p.proname) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'identity\_%'
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%' and c like '%pg_catalog%' and c like '%pg\_temp%'
     );
  perform identity_drill.check(
    'toda funcion definer de identidad fija un search_path seguro',
    coalesce(array_length(v_bad, 1), 0) = 0,
    coalesce('sin search_path: ' || array_to_string(v_bad, ', '), 'todas fijadas'));

  -- 47. Ninguna funcion de identidad quedo otorgada a anon.
  select array_agg(p.proname order by p.proname) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'identity\_%'
     and has_function_privilege('anon', p.oid, 'execute');
  perform identity_drill.check(
    'ninguna funcion de identidad es ejecutable por anon',
    coalesce(array_length(v_bad, 1), 0) = 0,
    coalesce('otorgadas a anon: ' || array_to_string(v_bad, ', '), 'ninguna'));

  -- 48. Las tablas de identidad tienen RLS y no dan escritura a authenticated.
  select array_agg(c.relname order by c.relname) into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and (c.relname like 'identity\_%' or c.relname in ('staff_profiles', 'rider_profiles'))
     and (
       not c.relrowsecurity
       or has_table_privilege('authenticated', c.oid, 'insert')
       or has_table_privilege('authenticated', c.oid, 'update')
       or has_table_privilege('authenticated', c.oid, 'delete')
       or has_table_privilege('anon', c.oid, 'select')
     );
  perform identity_drill.check(
    'las tablas de identidad tienen RLS y ninguna escritura directa',
    coalesce(array_length(v_bad, 1), 0) = 0,
    coalesce('tablas abiertas: ' || array_to_string(v_bad, ', '), 'todas cerradas'));

  -- 49. Las funciones definer que ya existian y consultan la compuerta
  -- siguen siendo definer (si alguna dejara de serlo, la compuerta no se
  -- podria consultar y todo fallaria abierto o cerrado sin aviso).
  perform identity_drill.check(
    'los ayudantes historicos siguen siendo definer',
    (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('is_business_member', 'has_business_role', 'is_assigned_rider')),
    'is_business_member, has_business_role, is_assigned_rider');
end;
$$;

-- ===========================================================================
-- H · No regresion del Rider
-- ===========================================================================

do $$
declare
  v_b uuid := identity_drill.get('business')::uuid;
  v_res jsonb;
begin
  -- 50. El rider conserva su unico permiso y ninguno mas.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, gen_random_uuid(), now() + interval '3 hours', identity_drill.get('rider_email')),
    format('select (public.identity_current_context(%L) ->> ''permissions'')', v_b));
  perform identity_drill.check(
    'el rider tiene exactamente un permiso: operar su entrega',
    (v_res ->> 'ok')::boolean and (v_res ->> 'result')::jsonb = '["delivery.operate"]'::jsonb,
    'permisos: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 51. El owner tiene el catalogo completo.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('owner')::uuid, identity_drill.get('owner_session')::uuid, now(), identity_drill.get('owner_email')),
    format('select jsonb_array_length((public.identity_current_context(%L) -> ''permissions''))::text', v_b));
  perform identity_drill.check(
    'el owner tiene todos los permisos del catalogo',
    (v_res ->> 'result')::integer = (select count(*)::integer from public.identity_permissions),
    'permisos del owner: ' || coalesce(v_res ->> 'result', v_res ->> 'message'));

  -- 52. El rider puede cerrar su propia sesion sin permisos de administracion.
  v_res := identity_drill.q(
    identity_drill.claims(identity_drill.get('rider')::uuid, identity_drill.get('rider_session')::uuid, now() + interval '3 hours', identity_drill.get('rider_email')),
    format('select public.identity_close_own_session(%L)::text', v_b));
  perform identity_drill.check(
    'cualquiera puede cerrar su propia sesion',
    ((v_res ->> 'result')::jsonb ->> 'ok')::boolean,
    coalesce((v_res ->> 'result')::jsonb ->> 'code', v_res ->> 'message'));
end;
$$;

-- ===========================================================================
-- Resultado
-- ===========================================================================

select case when ok then 'OK    ' else 'FALLA ' end
       || rpad(label, 66, '.') || '  ' || detail
  from identity_drill.results
 order by seq;
