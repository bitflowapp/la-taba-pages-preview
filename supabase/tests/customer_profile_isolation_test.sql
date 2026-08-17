-- TABA2 · Memoria del cliente · AISLAMIENTO Y INVARIANTES
--
-- Los contratos de perfil y direcciones del cliente existen desde la migracion
-- 20260728090000, pero no tenian una sola prueba de base. Esta suite fija lo
-- que no se puede romper:
--
--   1. El cliente A ve y modifica SOLO lo suyo. El cliente B, cero. No alcanza
--      con que la RPC use auth.uid(): se prueba tambien contra la tabla, con el
--      rol `authenticated` de verdad, porque una RPC prolija con una tabla
--      abierta sigue siendo una tabla abierta.
--   2. "Una sola direccion predeterminada" es un invariante de la TABLA, no una
--      cortesia de la RPC ni del navegador. Se prueba forzando dos por UPDATE
--      directo y comprobando que la base lo rechaza.
--   3. La sesion anonima de Supabase —la que usa el cliente que compra— es una
--      identidad como cualquier otra a estos efectos: tiene su propio perfil y
--      no ve el de nadie.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- ── Fixture: tres identidades ──────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('c1000000-0000-4000-8000-0000000000a1','authenticated','authenticated','cust-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-0000000000a2','authenticated','authenticated','cust-b@example.invalid','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-0000000000a3','authenticated','authenticated',null,'',null,'{}','{}',now(),now());

create or replace function pg_temp.as_customer(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)::void;
$$;

create or replace function pg_temp.as_anonymous(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', true)::text, true)::void;
$$;

create or replace function pg_temp.as_nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;

-- ══ 1. SIN IDENTIDAD NO HAY PERFIL ═════════════════════════════════════════
select pg_temp.as_nobody();
select throws_ok(
  $$ select public.get_current_customer_profile() $$,
  '42501',
  null,
  'sin sesion, leer el perfil propio es 42501');
select throws_ok(
  $$ select public.upsert_current_customer_profile('Alguien','2996000000') $$,
  '42501',
  null,
  'sin sesion, guardar un perfil es 42501');

-- ══ 2. EL PERFIL PROPIO ════════════════════════════════════════════════════
select pg_temp.as_customer('c1000000-0000-4000-8000-0000000000a1');

select is(
  public.get_current_customer_profile() -> 'profile',
  'null'::jsonb,
  'un cliente nuevo todavia no tiene perfil');
select is(
  public.get_current_customer_profile() -> 'addresses',
  '[]'::jsonb,
  'ni direcciones');

select is(
  public.upsert_current_customer_profile('Marco Perez', '+54 299 600 0001') ->> 'name',
  'Marco Perez',
  'A guarda su nombre');

-- La identidad no se elige: la fila nace con el uid del token, y no hay ningun
-- parametro por donde pedir otra.
select is(
  (select count(*) from public.customers where id = 'c1000000-0000-4000-8000-0000000000a1'),
  1::bigint,
  'el perfil se escribio sobre el uid del token, no sobre uno elegido');
select is(
  (select count(*) from public.customers where id <> 'c1000000-0000-4000-8000-0000000000a1'),
  0::bigint,
  'y no toco ninguna otra identidad');

-- ══ 3. DIRECCIONES Y LA PREDETERMINADA ═════════════════════════════════════
select is(
  public.upsert_current_customer_address(
    '{"label":"Casa","street":"San Martin","streetNumber":"100","city":"Neuquen"}'::jsonb
  ) -> 'address' ->> 'isDefault',
  'true',
  'la primera direccion queda predeterminada sola');

select is(
  public.upsert_current_customer_address(
    '{"label":"Trabajo","street":"Belgrano","streetNumber":"250","city":"Neuquen"}'::jsonb
  ) -> 'address' ->> 'isDefault',
  'false',
  'la segunda no se roba la predeterminada por existir');

select is(
  (select count(*) from public.customer_addresses
    where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and is_default and deleted_at is null),
  1::bigint,
  'sigue habiendo exactamente una predeterminada');

-- Cambiar la predeterminada apaga la anterior en la misma operacion.
select is(
  public.set_current_customer_default_address(
    (select id from public.customer_addresses
      where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and label = 'Trabajo')
  ) ->> 'isDefault',
  'true',
  'A cambia su direccion predeterminada');
select is(
  (select count(*) from public.customer_addresses
    where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and is_default and deleted_at is null),
  1::bigint,
  'y sigue habiendo exactamente una');
select is(
  (select label from public.customer_addresses
    where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and is_default and deleted_at is null),
  'Trabajo',
  'la que corresponde');

-- ══ 4. LA INVARIANTE VIVE EN LA TABLA ══════════════════════════════════════
-- Esta es la prueba que importa: no se pregunta si la RPC se porta bien, se
-- fuerza el estado prohibido por UPDATE directo, como superusuario, saltandose
-- toda la logica. Si la base lo acepta, el invariante no existe.
select throws_ok(
  $$ update public.customer_addresses
        set is_default = true
      where customer_id = 'c1000000-0000-4000-8000-0000000000a1'
        and deleted_at is null $$,
  '23505',
  null,
  'dos direcciones predeterminadas las rechaza el indice unico, no la aplicacion');

-- ══ 5. DUPLICADOS ══════════════════════════════════════════════════════════
select is(
  public.upsert_current_customer_address(
    '{"label":"Casa otra vez","street":"San Martin","streetNumber":"100","city":"Neuquen"}'::jsonb
  ) ->> 'code',
  'duplicate',
  'la misma direccion escrita de nuevo se avisa como duplicada');
select is(
  (select count(*) from public.customer_addresses
    where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and deleted_at is null),
  2::bigint,
  'y no crea una tercera fila');

-- ══ 6. BAJA DE DIRECCION ═══════════════════════════════════════════════════
select is(
  public.archive_current_customer_address(
    (select id from public.customer_addresses
      where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and label = 'Trabajo')
  ) ->> 'archived',
  'true',
  'A borra la direccion que tenia predeterminada');
select is(
  (select count(*) from public.customer_addresses
    where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and is_default and deleted_at is null),
  1::bigint,
  'la predeterminada se muda sola a la que queda: nunca cero');
select is(
  (select label from public.customer_addresses
    where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and is_default and deleted_at is null),
  'Casa',
  'y es la que quedaba');
select is(
  jsonb_array_length(public.get_current_customer_profile() -> 'addresses'),
  1,
  'la direccion borrada ya no aparece en el perfil');

-- ══ 7. EL CLIENTE B NO VE NI TOCA NADA DE A ════════════════════════════════
select pg_temp.as_customer('c1000000-0000-4000-8000-0000000000a2');

select is(
  public.get_current_customer_profile() -> 'profile',
  'null'::jsonb,
  'B no ve el perfil de A');
select is(
  public.get_current_customer_profile() -> 'addresses',
  '[]'::jsonb,
  'B no ve las direcciones de A');

select throws_ok(
  format($$ select public.set_current_customer_default_address(%L::uuid) $$,
    (select id from public.customer_addresses where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and deleted_at is null limit 1)),
  '42501',
  null,
  'B no puede elegir la predeterminada de A');

select throws_ok(
  format($$ select public.archive_current_customer_address(%L::uuid) $$,
    (select id from public.customer_addresses where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and deleted_at is null limit 1)),
  '42501',
  null,
  'B no puede borrar una direccion de A');

-- Guardar una direccion exige perfil propio primero; B no hereda el de A.
select throws_ok(
  $$ select public.upsert_current_customer_address(
       '{"label":"Casa","street":"Roca","streetNumber":"1","city":"Neuquen"}'::jsonb) $$,
  '22023',
  null,
  'B sin perfil propio no puede guardar direcciones');

-- B se da de alta de verdad. A partir de aca ya no lo frena la falta de perfil,
-- asi que lo unico que puede negarle la direccion de A es la pertenencia.
select public.upsert_current_customer_profile('Ana Gomez', '2996000002');

-- Enviar el id de una direccion ajena en el payload es el intento directo de
-- BOLA: se responde igual que si no existiera.
select throws_ok(
  format($$ select public.upsert_current_customer_address(
    jsonb_build_object('id', %L, 'label','Robada','street','X','streetNumber','1','city','Y')) $$,
    (select id::text from public.customer_addresses where customer_id = 'c1000000-0000-4000-8000-0000000000a1' and deleted_at is null limit 1)),
  '42501',
  null,
  'B con perfil propio tampoco puede editar una direccion de A pasando su id');

-- ══ 8. LA TABLA, CON EL ROL DE VERDAD ══════════════════════════════════════
-- Hasta aca corrio todo como postgres, que contesta que si a todo. Estas
-- corren como `authenticated`, que es el rol con el que llega PostgREST.
set local role authenticated;
select is(
  (select count(*) from public.customers),
  1::bigint,
  'como authenticated con claims de B, la tabla customers muestra una sola fila');
select is(
  (select count(*) from public.customers where id = 'c1000000-0000-4000-8000-0000000000a1'),
  0::bigint,
  'y esa fila no es la de A: A no existe para B');
select is(
  (select count(*) from public.customer_addresses),
  0::bigint,
  'B no ve ninguna direccion, y las de A siguen ahi');
reset role;

select pg_temp.as_customer('c1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(
  (select count(*) from public.customers),
  1::bigint,
  'con claims de A, A se ve a si mismo');
select is(
  (select count(*) from public.customers where id = 'c1000000-0000-4000-8000-0000000000a2'),
  0::bigint,
  'y no ve a B');
select is(
  (select count(*) from public.customer_addresses),
  1::bigint,
  'y ve su direccion viva');
reset role;

-- ══ 9. GRANTS: LECTURA SI, ESCRITURA NUNCA ═════════════════════════════════
-- El cliente escribe por RPC. Si algun dia alguien agrega un INSERT directo,
-- estas cuatro lo dicen.
select ok(has_table_privilege('authenticated','public.customers','SELECT'),
  'authenticated puede leer su propio perfil por RLS');
select ok(not has_table_privilege('authenticated','public.customers','INSERT'),
  'authenticated NO puede insertar en customers');
select ok(not has_table_privilege('authenticated','public.customers','UPDATE'),
  'authenticated NO puede actualizar customers');
select ok(not has_table_privilege('authenticated','public.customers','DELETE'),
  'authenticated NO puede borrar customers');
select ok(not has_table_privilege('authenticated','public.customer_addresses','INSERT'),
  'authenticated NO puede insertar direcciones');
select ok(not has_table_privilege('authenticated','public.customer_addresses','UPDATE'),
  'authenticated NO puede actualizar direcciones');
select ok(not has_table_privilege('authenticated','public.customer_addresses','DELETE'),
  'authenticated NO puede borrar direcciones');
select ok(not has_table_privilege('anon','public.customers','SELECT'),
  'anon no lee customers ni siquiera con RLS');
select ok(not has_table_privilege('anon','public.customer_addresses','SELECT'),
  'anon no lee direcciones');

-- ══ 10. LA SESION ANONIMA ES UNA IDENTIDAD MAS ═════════════════════════════
-- El cliente que compra entra con sesion anonima de GoTrue. Su memoria tiene
-- que funcionar igual —es la UX vigente— y aislarse igual.
select pg_temp.as_anonymous('c1000000-0000-4000-8000-0000000000a3');
select is(
  public.upsert_current_customer_profile('Visitante', '2996000003') ->> 'name',
  'Visitante',
  'una identidad anonima tambien puede guardar su perfil');
select is(
  public.get_current_customer_profile() -> 'addresses',
  '[]'::jsonb,
  'y arranca sin direcciones, sin ver las de nadie');
select is(
  (select count(*) from public.customers where id = 'c1000000-0000-4000-8000-0000000000a3'),
  1::bigint,
  'su perfil cuelga de su propio uid anonimo');

select * from finish();
rollback;
