-- TABA · UNA NEGATIVA POR PERMISOS CONTESTA 42501
--
-- Cinco funciones del catálogo y del contacto del comercio rechazaban a quien no es dueño
-- ni encargado con un `raise exception` sin código: P0001, que la API contesta 400, lo
-- mismo que un dato mal escrito. Sus hermanas contestan 42501 (403). Desde
-- 20261002051000 las cinco contestan 42501, con el mismo mensaje.
--
-- Acá se prueba, con cambio real de rol:
--
--   · la negativa de cada una, para cada actor sin autoridad: 42501 y el mensaje de antes;
--   · que ningún intento escribió nada;
--   · que lo demás no cambió: las validaciones siguen siendo validaciones (22023 / P0002
--     desde 20261002091000; antes salían sin código, P0001), el
--     dueño y el encargado siguen pasando, y las cinco conservan seguridad, permisos y
--     comentario;
--   · que no queda ninguna función ejecutable por un cliente con el mismo defecto.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table ids (k text primary key, id uuid not null) on commit drop;
create temporary table actores (actor text primary key, db_role text not null, claims text not null) on commit drop;
grant select on ids to anon, authenticated;

do $fixture$
declare
  v_a uuid := 'b19c0000-0000-4000-8000-00000000000a';
  v_b uuid := 'b19c0000-0000-4000-8000-00000000000b';
  v_owner uuid := 'a19c0000-0000-4000-8000-000000000001';
  v_admin uuid := 'a19c0000-0000-4000-8000-000000000002';
  v_staff uuid := 'a19c0000-0000-4000-8000-000000000003';
  v_rider uuid := 'a19c0000-0000-4000-8000-000000000004';
  v_disabled uuid := 'a19c0000-0000-4000-8000-000000000005';
  v_foreign uuid := 'a19c0000-0000-4000-8000-00000000000a';
  v_c1 uuid := 'a19c0000-0000-4000-8000-0000000000c1';
  v_actor record;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values
    (v_owner,'authenticated','authenticated','authorization-refusals-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_admin,'authenticated','authenticated','authorization-refusals-admin@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_staff,'authenticated','authenticated','authorization-refusals-staff@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_rider,'authenticated','authenticated','authorization-refusals-rider@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_disabled,'authenticated','authenticated','authorization-refusals-baja@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_foreign,'authenticated','authenticated','authorization-refusals-ajeno@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_c1,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

  insert into public.businesses (id, name, slug, status, is_active, currency_code, pickup_enabled, delivery_enabled, order_intake_guard_mode)
  values
    (v_a, 'Negativas 42501 A', 'authorization-refusals-test-a', 'open', true, 'ARS', true, false, 'off'),
    (v_b, 'Negativas 42501 B', 'authorization-refusals-test-b', 'open', true, 'ARS', true, false, 'off');
  insert into public.business_members(business_id,user_id,role,is_active)
  values (v_a, v_owner, 'owner', true), (v_a, v_admin, 'admin', true), (v_a, v_staff, 'staff', true),
    (v_a, v_rider, 'rider', true), (v_a, v_disabled, 'admin', true), (v_b, v_foreign, 'owner', true);

  insert into actores values ('anon', 'anon', '{"role":"anon"}');
  for v_actor in
    select * from (values
      ('owner', v_owner, v_a, 'owner', 'panel_web', 'e19c0000-0000-4000-8000-000000000001'::uuid),
      ('admin', v_admin, v_a, 'admin', 'panel_web', 'e19c0000-0000-4000-8000-000000000002'::uuid),
      ('staff', v_staff, v_a, 'staff', 'panel_web', 'e19c0000-0000-4000-8000-000000000003'::uuid),
      ('rider', v_rider, v_a, 'rider', 'rider_android', 'e19c0000-0000-4000-8000-000000000004'::uuid),
      ('baja', v_disabled, v_a, 'admin', 'panel_web', 'e19c0000-0000-4000-8000-000000000005'::uuid),
      ('ajeno', v_foreign, v_b, 'owner', 'panel_web', 'e19c0000-0000-4000-8000-00000000000a'::uuid)
    ) as t(actor, user_id, business_id, member_role, client, session_id)
  loop
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values (v_actor.session_id, v_actor.user_id, v_actor.business_id, v_actor.member_role, v_actor.client);
    insert into actores values (v_actor.actor, 'authenticated',
      json_build_object('sub', v_actor.user_id, 'role', 'authenticated', 'session_id', v_actor.session_id)::text);
  end loop;
  insert into actores values
    ('cliente', 'authenticated', json_build_object('sub', v_c1, 'role', 'authenticated', 'is_anonymous', true,
      'session_id', 'e19c0000-0000-4000-8000-0000000000c1')::text);

  -- Un producto comercial publicado, sin foto: lo que las cinco funciones tocarían.
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values ('c19c0000-0000-4000-8000-000000000001',v_a,'Lata Negativas','Gaseosas','Cola',1000,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',40,true,true,false,'{}',true,now(),v_owner,
     'authorization-refusals-lata','authorization-refusals-lata','commercial',1);
  insert into ids values ('a', v_a), ('b', v_b), ('lata', 'c19c0000-0000-4000-8000-000000000001');

  -- La baja, por mano del dueño: el encargado conserva su token.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'owner'), true);
  perform public.identity_set_member_active(v_a, v_disabled, false, 'baja de prueba');
  perform set_config('request.jwt.claims', '', true);
end
$fixture$;

-- ── Herramientas ───────────────────────────────────────────────────────────
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select id from ids where k = p_key $$;

-- Ejecuta la consulta con el rol de base y los claims del actor, sin deshacerla. Devuelve
-- «ok <valor>» o «<SQLSTATE> <mensaje>».
create function pg_temp.hacer(p_actor text, p_sql text) returns text
language plpgsql as $$
declare
  v_actor actores%rowtype;
  v_out text;
begin
  select * into strict v_actor from actores where actor = p_actor;
  begin
    perform set_config('request.jwt.claims', v_actor.claims, true);
    execute format('set local role %I', v_actor.db_role);
    execute p_sql into v_out;
    v_out := 'ok ' || coalesce(v_out, 'NULL');
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$$;

-- Una función contra los seis actores sin autoridad sobre el catálogo del comercio A: un
-- cliente, un empleado, un repartidor, el dueño de otro comercio, un encargado dado de
-- baja y nadie.
create function pg_temp.negativas(p_funcion text, p_sql text, p_mensaje text) returns setof text language sql as $$
  select is(
           pg_temp.hacer(a.actor, p_sql),
           case when a.actor = 'anon' then '42501 permission denied for function ' || p_funcion else '42501 ' || p_mensaje end,
           p_funcion || ' · ' || a.actor || ' · DENY 42501')
    from unnest(array['anon', 'cliente', 'staff', 'rider', 'ajeno', 'baja']) with ordinality as a(actor, n)
   order by a.n;
$$;

-- Lo que las cinco funciones podrían haber escrito.
create function pg_temp.foto() returns text language sql stable as $$
  select format('lata: precio=%s stock=%s publicada=%s verificada=%s | whatsapp=%s verificado=%s | lotes=%s activos=%s productos=%s',
    p.price, p.stock, p.available::text, p.is_verified::text,
    coalesce(b.whatsapp_phone, '-'), b.whatsapp_verified::text,
    (select count(*) from public.catalog_change_batches c where c.business_id = b.id),
    (select count(*) from public.catalog_assets c where c.business_id = b.id),
    (select count(*) from public.products x where x.business_id = b.id))
    from public.businesses b join public.products p on p.id = pg_temp.id('lata')
   where b.id = pg_temp.id('a') $$;
select set_config('taba.test_negativas_antes', pg_temp.foto(), true);

-- ══ 1 · LA NEGATIVA DE CADA UNA ═════════════════════════════════════════════
select pg_temp.negativas('apply_commercial_catalog_batch',
  $q$select count(*) from public.apply_commercial_catalog_batch(pg_temp.id('a'), '[{"sku":"authorization-refusals-lata","price":"1"}]'::jsonb)$q$,
  'Only an active owner/admin can apply commercial catalog values.');

select pg_temp.negativas('import_catalog_batch',
  $q$select count(*) from public.import_catalog_batch(pg_temp.id('a'), '[]'::jsonb, '[]'::jsonb)$q$,
  'Only an active owner/admin can import a catalog batch.');

select pg_temp.negativas('publish_catalog_product',
  $q$select count(*) from public.publish_catalog_product(pg_temp.id('a'), 'authorization-refusals-lata', true)$q$,
  'Only an active owner/admin can publish catalog products.');

select pg_temp.negativas('unpublish_catalog_product',
  $q$select public.unpublish_catalog_product(pg_temp.id('a'), 'authorization-refusals-lata')::text$q$,
  'Only an active owner/admin can unpublish catalog products.');

select pg_temp.negativas('set_business_whatsapp_contact',
  $q$select w.whatsapp_phone from public.set_business_whatsapp_contact(pg_temp.id('a'), '5492994000029', true) w$q$,
  'Only an active owner/admin can authorize the business contact channel.');

-- Las hermanas que ya contestaban 42501: la misma persona recibe ahora el mismo código
-- en toda la familia.
select is(
  pg_temp.hacer('staff', $q$select count(*) from public.set_commercial_product_publication(pg_temp.id('a'), 'authorization-refusals-lata', false)$q$),
  '42501 Only an active owner/admin can publish or hide a commercial product.',
  'set_commercial_product_publication ya contestaba 42501 al empleado');
select is(
  pg_temp.hacer('staff', $q$select public.rollback_commercial_catalog_batch(pg_temp.id('a'), '00000000-0000-4000-8000-000000000019')::text$q$),
  '42501 Only an active owner/admin can roll back a commercial catalog batch.',
  'y rollback_commercial_catalog_batch tambien');

-- ══ 2 · NINGÚN INTENTO ESCRIBIÓ NADA ════════════════════════════════════════
select is(pg_temp.foto(), current_setting('taba.test_negativas_antes'),
  'despues de los treinta intentos el producto, el contacto y los lotes del comercio estan como antes');
select is(current_setting('taba.test_negativas_antes'),
  'lata: precio=1000.00 stock=40 publicada=true verificada=true | whatsapp=- verificado=false | lotes=0 activos=0 productos=1',
  'y «como antes» es: la lata publicada a 1000, sin contacto, sin lotes');

-- ══ 3 · LAS VALIDACIONES NO CAMBIARON ═══════════════════════════════════════
-- (20261002091000 les dio a estas validaciones el SQLSTATE de lo que significan: 22023 un dato mal
-- escrito, P0002 algo que no existe; antes salían sin código, P0001.)
-- Para quien SÍ tiene autoridad, un dato mal escrito sigue siendo una validación (no 42501,
-- que la API contesta 400): eso es una validación, no un permiso.
select is(
  pg_temp.hacer('owner', $q$select count(*) from public.apply_commercial_catalog_batch(pg_temp.id('a'), '[]'::jsonb)$q$),
  '22023 Commercial rows must be a JSON array with 1 to 500 entries.', 'un lote comercial vacio: 22023');
select is(
  pg_temp.hacer('owner', $q$select count(*) from public.apply_commercial_catalog_batch(pg_temp.id('a'), '[{"sku":"authorization-refusals-no-existe","price":"10"}]'::jsonb)$q$),
  'P0002 Unknown sku authorization-refusals-no-existe for this business. Commercial import never creates products.',
  'un SKU que no existe: P0002');
select is(
  pg_temp.hacer('admin', $q$select count(*) from public.import_catalog_batch(pg_temp.id('a'), '[]'::jsonb, '[]'::jsonb)$q$),
  '22023 Catalog import must contain 1 to 500 assets and products.', 'un alta vacia: 22023');
select is(
  pg_temp.hacer('owner', $q$select count(*) from public.publish_catalog_product(pg_temp.id('a'), 'authorization-refusals-no-existe', true)$q$),
  'P0002 Catalog product not found.', 'publicar un producto que no existe: P0002');
select is(
  pg_temp.hacer('admin', $q$select w.whatsapp_phone from public.set_business_whatsapp_contact(pg_temp.id('a'), '123', false) w$q$),
  '22023 WhatsApp phone must contain between 8 and 15 digits.', 'un WhatsApp de tres digitos: 22023');
-- La autorización se pregunta antes que la validación: el empleado con un dato mal escrito
-- recibe la negativa de permisos.
select is(
  pg_temp.hacer('staff', $q$select count(*) from public.apply_commercial_catalog_batch(pg_temp.id('a'), '[]'::jsonb)$q$),
  '42501 Only an active owner/admin can apply commercial catalog values.',
  'el empleado con un lote vacio recibe la negativa de permisos, no la validacion');

-- ══ 4 · EL DUEÑO Y EL ENCARGADO SIGUEN PASANDO ══════════════════════════════
select is(
  pg_temp.hacer('owner', $q$select string_agg(b.applied_sku || ':' || b.applied_price || ':' || b.applied_available::text, ',')
    from public.apply_commercial_catalog_batch(pg_temp.id('a'), '[{"sku":"authorization-refusals-lata","price":"1200"}]'::jsonb) b$q$),
  'ok authorization-refusals-lata:1200.00:true', 'el dueno aplica un precio por el lote comercial');
select is(
  pg_temp.hacer('admin', $q$select public.unpublish_catalog_product(pg_temp.id('a'), 'authorization-refusals-lata')::text$q$),
  'ok true', 'el encargado despublica un producto');
select is(
  pg_temp.hacer('owner', $q$select w.whatsapp_phone || ':' || w.whatsapp_verified::text from public.set_business_whatsapp_contact(pg_temp.id('a'), '5492994000029', true) w$q$),
  'ok 5492994000029:true', 'el dueno carga y verifica el WhatsApp del comercio');
select is(pg_temp.foto(),
  'lata: precio=1200.00 stock=40 publicada=false verificada=false | whatsapp=5492994000029 verificado=true | lotes=2 activos=0 productos=1',
  'los tres cambios quedaron escritos: precio nuevo, producto despublicado, contacto verificado y dos lotes en el rastro (el precio y la despublicacion)');
-- El dueño de otro comercio manda en el suyo, no en este.
select is(
  pg_temp.hacer('ajeno', $q$select w.whatsapp_phone from public.set_business_whatsapp_contact(pg_temp.id('b'), '5492994000039', false) w$q$),
  'ok 5492994000039', 'el dueno del comercio B carga el WhatsApp de B');

-- ══ 5 · LAS CINCO CONSERVAN SEGURIDAD, PERMISOS Y COMENTARIO ════════════════
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
            || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
            || ':' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
            || ':' || (obj_description(p.oid, 'pg_proc') is not null)::text, ' | ' order by p.proname)
     from pg_proc p
    where p.oid in ('public.apply_commercial_catalog_batch(uuid,jsonb)'::regprocedure,
                    'public.import_catalog_batch(uuid,jsonb,jsonb)'::regprocedure,
                    'public.publish_catalog_product(uuid,text,boolean)'::regprocedure,
                    'public.unpublish_catalog_product(uuid,text)'::regprocedure,
                    'public.set_business_whatsapp_contact(uuid,text,boolean)'::regprocedure)),
  'apply_commercial_catalog_batch:true:search_path=pg_catalog, public, extensions, pg_temp:true:false:true | '
  || 'import_catalog_batch:true:search_path=pg_catalog, public, extensions, pg_temp:true:false:true | '
  || 'publish_catalog_product:true:search_path=pg_catalog, public, extensions, pg_temp:true:false:true | '
  || 'set_business_whatsapp_contact:true:search_path=pg_catalog, public, extensions, pg_temp:true:false:true | '
  || 'unpublish_catalog_product:true:search_path=pg_catalog, public, extensions, pg_temp:true:false:false',
  'SECURITY DEFINER, search_path fijo, ejecutables por authenticated y no por anon, y el comentario que cada una tenia');

-- ══ 6 · NO QUEDA OTRA CON EL MISMO DEFECTO ══════════════════════════════════
-- La forma exacta del defecto: una pregunta de autoridad y, pegado a ella, un
-- `raise exception` sin `errcode`. Se busca en el código de toda función de `public`
-- que un cliente (anon o authenticated) pueda ejecutar. Si una función nueva lo repite,
-- esta afirmación la nombra. (Un `;` dentro del mensaje de un rechazo haría saltar esta
-- afirmación sin que haya defecto: es una alarma, se mira a mano.)
select is(
  (select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
          ~* '(has_business_role|is_business_member|identity_has_permission|identity_member_role|can_manage_commercial_settings|auth\.uid\(\)\s+is\s+null)[^;]*?\mthen\s+raise\s+exception\s+(?![^;]*errcode)[^;]*;'),
  null, 'ninguna funcion ejecutable por un cliente rechaza por permisos sin codigo');
-- Las dos que conservan esa línea no son puertas: sólo las llama import_catalog_batch,
-- que rechaza antes. Si algún día se le da EXECUTE a un cliente, hay que ponerles el
-- código primero.
select is(
  (select string_agg(p.proname || ':' || (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE'))::text, ' ' order by p.proname)
     from pg_proc p
    where p.oid in ('public.register_catalog_assets(uuid,jsonb)'::regprocedure, 'public.stage_catalog_products(uuid,jsonb)'::regprocedure)),
  'register_catalog_assets:false stage_catalog_products:false',
  'register_catalog_assets y stage_catalog_products, que tienen la misma linea, no son ejecutables por ningun cliente');

select * from finish();
rollback;
