-- ============================================================================
--  La prueba que el resto de la suite NO puede hacer: el rol de sesión real
-- ============================================================================
--
--  POR QUÉ EXISTE
--  --------------
--  pgTAP corre por una conexión de `psql -U postgres`. Ahí `set local role
--  authenticated` cambia `current_user`, pero **`session_user` sigue siendo
--  `postgres`**. Y hay guardas en este esquema —la de la capa de identidad sobre
--  `business_members`, sin ir más lejos— que dejan pasar cuando
--  `session_user in ('postgres','supabase_admin')`, porque así distinguen una
--  migración o un fixture de una llamada del navegador.
--
--  Resultado: una RPC que en staging muere con `insufficient_privilege` pasa
--  verde en la suite. Pasó de verdad. La primera versión de
--  `set_commercial_settings_delegation` escribía `business_members`, la suite
--  daba 128/128, y por una conexión real moría con
--  «identity: las membresias se administran por RPC de identidad».
--
--  Este archivo se conecta como `authenticator` —el rol con el que PostgREST
--  entra de verdad, que puede loguearse y NO es superusuario— y recién ahí
--  cambia a `authenticated`. Es la única forma de que `session_user` sea el que
--  va a ser en producción.
--
--  Se corre por separado, con su propia conexión. No es pgTAP: cada
--  comprobación aborta la transacción si falla.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(p_condicion boolean, p_nombre text, p_detalle text default '')
returns void
language plpgsql as $$
begin
  if p_condicion then
    raise notice 'OK    %  %', rpad(p_nombre, 58, '.'), p_detalle;
  else
    raise exception 'FALLA: % — %', p_nombre, p_detalle;
  end if;
end;
$$;

begin;

select pg_temp.ok(
  session_user = 'authenticator',
  '0 · la conexión entra como PostgREST',
  'session_user=' || session_user);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';

select pg_temp.ok(
  current_user = 'authenticated' and session_user = 'authenticator',
  '0b · y opera como authenticated sin ser postgres',
  'current_user=' || current_user || ' session_user=' || session_user);

-- ── El owner delega en un staff ─────────────────────────────────────────────
select pg_temp.ok(
  (public.set_commercial_settings_delegation(
     'e2000000-0000-4000-8000-000000000001',
     'e1000000-0000-4000-8000-000000000002', true) ->> 'ok')::boolean,
  '1 · el owner delega por una conexión real',
  'acá moría la versión anterior');

select pg_temp.ok(
  (select count(*) from public.business_commercial_managers
    where business_id = 'e2000000-0000-4000-8000-000000000001'
      and user_id = 'e1000000-0000-4000-8000-000000000002') = 1,
  '1b · la delegación quedó guardada');

-- ── Y el staff delegado ya puede configurar ─────────────────────────────────
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}';

select pg_temp.ok(
  public.can_manage_commercial_settings('e2000000-0000-4000-8000-000000000001'),
  '2 · el staff delegado tiene autoridad comercial');

select pg_temp.ok(
  (public.upsert_delivery_zone('e2000000-0000-4000-8000-000000000001',
    '{"name":"Zona por conexion real","match_kind":"declared_area","delivery_fee":"1500"}'::jsonb) ->> 'ok')::boolean,
  '2b · y crea una zona');

-- ── Un ajeno no ─────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.upsert_delivery_zone('e2000000-0000-4000-8000-000000000001',
    '{"name":"Zona del ajeno","match_kind":"declared_area"}'::jsonb);
  raise exception 'FALLA: un ajeno creo una zona por conexion real';
exception when sqlstate '42501' then
  perform pg_temp.ok(true, '3 · un ajeno recibe 42501 por conexión real');
end;
$$;

-- ── Este paquete no le escribe una sola fila a business_members ─────────────
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  update public.business_members set is_active = true
   where business_id = 'e2000000-0000-4000-8000-000000000001';
  raise exception 'FALLA: se pudo escribir business_members desde una conexion de navegador';
exception when sqlstate '42501' then
  perform pg_temp.ok(true,
    '4 · business_members sigue cerrada al navegador',
    'la guarda de identidad manda, y este paquete no la toca');
end;
$$;

rollback;
