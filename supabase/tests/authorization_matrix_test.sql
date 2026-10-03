-- TABA · LA MATRIZ DE AUTORIZACIÓN DE LOS COMANDOS
--
-- Quién puede ejecutar cada comando del e-commerce, medido celda por celda con cambio
-- real de rol y con los claims que arma la API. Cada celda afirma ALLOW o DENY con el
-- resultado real: lo que devolvió el comando (el estado al que llevó el pedido, la fila
-- que escribió) o el SQLSTATE con que fue rechazado.
--
-- Es la continuación de ecommerce_rls_matrix_test.sql, que mide lecturas, tablas y una
-- parte de los comandos. Una celda que ya está afirmada allá NO se repite acá: se cita.
-- De esas filas, acá sólo están los actores que aquella matriz no tiene.
--
-- ACTORES (los roles del modelo son owner / admin / staff / rider; no hay otros)
--
--   anon       sin sesión (rol `anon`)
--   cliente    comprador con sesión anónima de Auth; dueño de los pedidos de la matriz
--   cliente2   otro comprador
--   owner      dueño del comercio A
--   admin      encargado del comercio A
--   staff      empleado del comercio A, con sesión del Panel. No tiene `orders.cancel`
--   caja       el CAJERO: no es un rol. Es un empleado (`staff`) cuya sesión es la de la
--              caja del local (`caja_clara_windows`, atada a su equipo). Opera los pedidos
--              por las mismas funciones que el Panel, con los permisos de un empleado
--   delegado   empleado al que el dueño le delegó la configuración comercial
--              (`set_commercial_settings_delegation`): la única autoridad que hoy se da
--              por persona. No le da ningún permiso sobre pedidos
--   rider      repartidor del comercio A, asignado a los pedidos en reparto de la matriz
--   rider2     otro repartidor del comercio A, sin esos pedidos
--   ajeno      dueño de OTRO comercio (B), con su sesión
--   baja       encargado de A dado de baja (`identity_set_member_active(false)`); conserva
--              su token. Antes de la baja tenía todos los permisos de un encargado
--   revocado   encargado de A al que el dueño le revocó la sesión; conserva su token
--
--   El EMPLEADO CON `orders.cancel` no existe como persona: el catálogo da permisos por
--   rol (rol, permiso) y no hay forma de dárselo a un solo empleado. La sección 8 mide lo
--   que sí existe: con la fila ('staff', 'orders.cancel') cancelan todos los empleados, y
--   sin ella ninguno.
--
-- CÓMO SE MIDE
--
--   Cada celda es un ENSAYO: el comando corre de verdad con el rol y los claims del
--   actor, se corren las restricciones diferidas como en el COMMIT, se anota lo que
--   devolvió y se deshace. Así todos los actores prueban sobre el mismo pedido en el mismo
--   estado y ninguna celda depende de otra. Lo que tiene que quedar escrito (o no quedar)
--   después de un comando se comprueba aparte, sin deshacer, en
--   order_cancel_follows_permission_catalog_test.sql.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(796);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table ids (k text primary key, id uuid not null) on commit drop;
create temporary table textos (k text primary key, v text not null) on commit drop;
create temporary table actores (actor text primary key, db_role text not null, claims text not null) on commit drop;
grant select on ids, textos to anon, authenticated;

do $fixture$
declare
  v_a uuid := 'b19a0000-0000-4000-8000-00000000000a';
  v_b uuid := 'b19a0000-0000-4000-8000-00000000000b';
  v_owner uuid := 'a19a0000-0000-4000-8000-000000000001';
  v_admin uuid := 'a19a0000-0000-4000-8000-000000000002';
  v_staff uuid := 'a19a0000-0000-4000-8000-000000000003';
  v_till uuid := 'a19a0000-0000-4000-8000-000000000004';
  v_delegate uuid := 'a19a0000-0000-4000-8000-000000000005';
  v_rider uuid := 'a19a0000-0000-4000-8000-000000000006';
  v_rider2 uuid := 'a19a0000-0000-4000-8000-000000000007';
  v_disabled uuid := 'a19a0000-0000-4000-8000-000000000008';
  v_revoked uuid := 'a19a0000-0000-4000-8000-000000000009';
  v_foreign uuid := 'a19a0000-0000-4000-8000-00000000000a';
  v_c1 uuid := 'a19a0000-0000-4000-8000-0000000000c1';
  v_c2 uuid := 'a19a0000-0000-4000-8000-0000000000c2';
  v_p1 uuid := 'c19a0000-0000-4000-8000-000000000001';
  v_p2 uuid := 'c19a0000-0000-4000-8000-000000000002';
  v_actor record;
  v_result jsonb;
  v_addr1 uuid;
  v_addr2 uuid;
  v_order uuid;
  v_rev bigint;
  v_key text;
  v_status text;
  v_checkout uuid;
  v_intent uuid;
  v_prepare jsonb;
  v_offer uuid;
begin
  -- Personas. Los correos llevan el nombre de este archivo: la base del gate no está vacía.
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values
    (v_owner,'authenticated','authenticated','authorization-matrix-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_admin,'authenticated','authenticated','authorization-matrix-admin@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_staff,'authenticated','authenticated','authorization-matrix-staff@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_till,'authenticated','authenticated','authorization-matrix-caja@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_delegate,'authenticated','authenticated','authorization-matrix-delegado@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_rider,'authenticated','authenticated','authorization-matrix-rider@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_rider2,'authenticated','authenticated','authorization-matrix-rider2@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_disabled,'authenticated','authenticated','authorization-matrix-baja@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_revoked,'authenticated','authenticated','authorization-matrix-revocado@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_foreign,'authenticated','authenticated','authorization-matrix-ajeno@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_c1,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
    (v_c2,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

  -- Comercios. El guardián de admisión se apaga: acá se prueba autorización, no cupos.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
    currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode,
    operating_timezone, address
  ) values
    (v_a, 'Matriz de comandos A', 'authorization-matrix-test-a', 'open', true, true, true, clock_timestamp(), v_owner,
     'ARS', true, true, 500.00, 0.00, 'off', 'America/Argentina/Buenos_Aires', 'Calle de la Matriz 100, Neuquen'),
    (v_b, 'Matriz de comandos B ajeno', 'authorization-matrix-test-b', 'open', true, true, true, clock_timestamp(), v_foreign,
     'ARS', true, false, 0.00, 0.00, 'off', 'America/Argentina/Buenos_Aires', 'Calle Ajena 200, Neuquen');

  insert into public.business_members(business_id,user_id,role,is_active)
  values
    (v_a, v_owner, 'owner', true), (v_a, v_admin, 'admin', true), (v_a, v_staff, 'staff', true),
    (v_a, v_till, 'staff', true), (v_a, v_delegate, 'staff', true),
    (v_a, v_rider, 'rider', true), (v_a, v_rider2, 'rider', true),
    (v_a, v_disabled, 'admin', true), (v_a, v_revoked, 'admin', true),
    (v_b, v_foreign, 'owner', true);

  -- Los actores: rol de base y claims del token, como los arma la API. Cada persona
  -- del equipo tiene su sesión registrada y la lleva en el claim. La del cajero es la
  -- de la caja del local, atada al equipo por su hash.
  insert into actores values ('anon', 'anon', '{"role":"anon"}');
  for v_actor in
    select * from (values
      ('owner', v_owner, v_a, 'owner', 'panel_web', 'e19a0000-0000-4000-8000-000000000001'::uuid),
      ('admin', v_admin, v_a, 'admin', 'panel_web', 'e19a0000-0000-4000-8000-000000000002'::uuid),
      ('staff', v_staff, v_a, 'staff', 'panel_web', 'e19a0000-0000-4000-8000-000000000003'::uuid),
      ('caja', v_till, v_a, 'staff', 'caja_clara_windows', 'e19a0000-0000-4000-8000-000000000004'::uuid),
      ('delegado', v_delegate, v_a, 'staff', 'panel_web', 'e19a0000-0000-4000-8000-000000000005'::uuid),
      ('rider', v_rider, v_a, 'rider', 'rider_android', 'e19a0000-0000-4000-8000-000000000006'::uuid),
      ('rider2', v_rider2, v_a, 'rider', 'rider_android', 'e19a0000-0000-4000-8000-000000000007'::uuid),
      ('baja', v_disabled, v_a, 'admin', 'panel_web', 'e19a0000-0000-4000-8000-000000000008'::uuid),
      ('revocado', v_revoked, v_a, 'admin', 'panel_web', 'e19a0000-0000-4000-8000-000000000009'::uuid),
      ('ajeno', v_foreign, v_b, 'owner', 'panel_web', 'e19a0000-0000-4000-8000-00000000000a'::uuid)
    ) as t(actor, user_id, business_id, member_role, client, session_id)
  loop
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client,device_key_hash)
    values (v_actor.session_id, v_actor.user_id, v_actor.business_id, v_actor.member_role, v_actor.client,
      case when v_actor.client = 'caja_clara_windows'
           then encode(extensions.digest('authorization_matrix_test-caja-1', 'sha256'), 'hex') end);
    insert into actores values (v_actor.actor, 'authenticated',
      json_build_object('sub', v_actor.user_id, 'role', 'authenticated', 'session_id', v_actor.session_id)::text);
  end loop;
  insert into actores values
    ('cliente', 'authenticated', json_build_object('sub', v_c1, 'role', 'authenticated', 'is_anonymous', true,
      'session_id', 'e19a0000-0000-4000-8000-0000000000c1')::text),
    ('cliente2', 'authenticated', json_build_object('sub', v_c2, 'role', 'authenticated', 'is_anonymous', true,
      'session_id', 'e19a0000-0000-4000-8000-0000000000c2')::text);

  -- Catálogo: uno publicado y uno oculto por el comercio en A.
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values
    (v_p1,v_a,'Lata Matriz Comandos','Gaseosas','Cola',1000,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',1000,true,true,false,'{}',true,now(),v_owner,
     'authorization-matrix-lata','authorization-matrix-lata','commercial',1),
    (v_p2,v_a,'Botella Matriz Comandos','Gaseosas','Cola',900,'confirmed',true,'Marca',
     'Botella','Botella',500,'ml','500 ml','botella',50,false,false,false,'{}',true,now(),v_owner,
     'authorization-matrix-botella','authorization-matrix-botella','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_a, true, 'test', 'checkout_pro', 'ARS', true, 'authorization-matrix-collector', 'authorization-matrix-app',
    clock_timestamp(), clock_timestamp());
  -- El vendedor conectado por OAuth: sin él la autoridad V2 no deja asentar la preferencia.
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_a, 'test', 'authorization-matrix-collector', 'authorization-matrix-app', 'connected',
    'ciphertext-only-local-fixture', now() + interval '2 days');
  insert into ids values ('a', v_a), ('b', v_b), ('p1', v_p1), ('p2', v_p2),
    ('owner', v_owner), ('admin', v_admin), ('staff', v_staff), ('caja', v_till), ('delegado', v_delegate),
    ('rider', v_rider), ('rider2', v_rider2), ('baja', v_disabled), ('revocado', v_revoked), ('ajeno', v_foreign),
    ('cliente', v_c1), ('cliente2', v_c2);

  -- Perfil y dirección confirmada de cada cliente, por el contrato de la tienda.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente'), true);
  perform public.upsert_current_customer_profile('Carla Comandos', '2994111119');
  v_addr1 := (public.upsert_current_customer_address(jsonb_build_object(
    'label', 'Casa', 'street', 'Calle Reservada Uno', 'streetNumber', '111', 'city', 'Neuquen', 'province', 'Neuquen',
    'neighborhood', 'Centro', 'latitude', -38.9516, 'longitude', -68.0591, 'geolocationAccuracy', 10,
    'source', 'gps', 'locationSource', 'map_pin', 'locationConfirmedAt', clock_timestamp(), 'isDefault', true
  )) -> 'address' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente2'), true);
  perform public.upsert_current_customer_profile('Dario Comandos', '2994222229');
  v_addr2 := (public.upsert_current_customer_address(jsonb_build_object(
    'label', 'Casa', 'street', 'Calle Reservada Dos', 'streetNumber', '222', 'city', 'Neuquen', 'province', 'Neuquen',
    'neighborhood', 'Oeste', 'latitude', -38.9416, 'longitude', -68.0691, 'geolocationAccuracy', 10,
    'source', 'gps', 'locationSource', 'map_pin', 'locationConfirmedAt', clock_timestamp(), 'isDefault', true
  )) -> 'address' ->> 'id')::uuid;
  insert into ids values ('dir_cliente', v_addr1), ('dir_cliente2', v_addr2);

  -- Pedidos del cliente en A, uno por cada estado desde el que se ensaya. Retiros en
  -- efectivo: recibido (dos: uno se cobra), aceptado, en preparación y listo.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente'), true);
  for v_key in select unnest(array['o_recibido', 'o_cobrado', 'o_aceptado', 'o_preparando', 'o_listo_retiro']) loop
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', v_a, 'client_request_id', 'authz-' || replace(v_key, '_', '-') || '-0001',
      'tracking_token', md5(v_key) || md5(v_key || 'authorization-matrix'),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1)),
      'customer_name', 'Carla Comandos', 'customer_phone', '2994111119',
      'delivery_mode', 'pickup', 'payment_method', 'cash'));
    insert into ids values (v_key, (v_result ->> 'id')::uuid);
  end loop;
  -- Envíos en efectivo: listo sin repartidor (dos: uno sale con reparto propio), ofrecido,
  -- asignado, retirado y en camino.
  for v_key in select unnest(array['o_listo_envio', 'o_reparto_propio', 'o_oferta', 'o_asignado', 'o_retirado', 'o_en_camino']) loop
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', v_a, 'client_request_id', 'authz-' || replace(v_key, '_', '-') || '-0001',
      'tracking_token', md5(v_key) || md5(v_key || 'authorization-matrix'),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1)),
      'customer_name', 'Carla Comandos', 'customer_phone', '2994111119',
      'delivery_mode', 'delivery', 'payment_method', 'cash', 'customer_address_id', v_addr1));
    insert into ids values (v_key, (v_result ->> 'id')::uuid);
  end loop;

  -- Un pedido pagado por Mercado Pago (del cliente), para el pedido de reembolso.
  perform set_config('request.jwt.claims', '', true);
  v_result := public.create_checkout_session(v_c1, jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'authz-pago-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 3)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Carla Comandos', 'phone', '5492994111119'),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_checkout := (v_result ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_checkout, v_c1, false);
  perform public.record_mercadopago_preference_created_v2(
    v_a, 'test', v_checkout, v_c1, (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(v_a, 'test', v_checkout, v_c1,
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-AUTHZ-MATRIX-0001', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=authz-matrix',
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=authz-matrix',
    encode(extensions.gen_random_bytes(32), 'hex'), 'req-authz-matrix');
  select id into v_intent from public.payment_intents where checkout_session_id = v_checkout;
  perform public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', 'PAY-AUTHZ-MATRIX-0001', 'external_reference', 'taba2:checkout:' || v_checkout::text,
      'preference_id', pi.preference_id, 'merchant_order_id', 'MO-AUTHZ-MATRIX', 'collector_id', ps.collector_id,
      'currency', 'ARS', 'transaction_amount', cs.total::text, 'status', 'approved', 'status_detail', 'accredited',
      'payment_method', 'visa', 'live_mode', false, 'provider_occurred_at', clock_timestamp()::text,
      'refunded_amount', '0.00', 'payer_email_hash', encode(extensions.gen_random_bytes(32), 'hex'),
      'raw_response_hash', encode(extensions.gen_random_bytes(32), 'hex'))
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
    where pi.id = v_intent), 'reconciliation', null);
  v_result := public.finalize_paid_checkout_session(v_checkout);
  insert into ids values ('o_pago', (v_result ->> 'order_id')::uuid), ('pago', v_intent);

  -- El dueño lleva cada pedido a su estado.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'owner'), true);
  select id into v_order from ids where k = 'o_cobrado';
  perform public.confirm_manual_order_payment(v_order, (select revision from public.orders where id = v_order), 'cash', 'authz-fixture-cobro-01');
  for v_actor in
    select * from (values
      ('o_aceptado', array['accepted']), ('o_preparando', array['accepted', 'preparing']),
      ('o_listo_retiro', array['accepted', 'preparing', 'ready']),
      ('o_listo_envio', array['accepted', 'preparing', 'ready']), ('o_reparto_propio', array['accepted', 'preparing', 'ready', 'on_the_way']),
      ('o_oferta', array['accepted', 'preparing', 'ready']), ('o_asignado', array['accepted', 'preparing', 'ready']),
      ('o_retirado', array['accepted', 'preparing', 'ready']), ('o_en_camino', array['accepted', 'preparing', 'ready'])
    ) as t(k, pasos)
  loop
    select id into v_order from ids where k = v_actor.k;
    foreach v_status in array v_actor.pasos loop
      select revision into v_rev from public.orders where id = v_order;
      perform public.transition_order(v_order, v_rev, v_status, 'authz-fixture-' || replace(v_actor.k, '_', '-') || '-' || v_status);
    end loop;
  end loop;

  -- La oferta que queda viva va primero: el repartidor todavía no tiene nada asignado.
  perform public.offer_order_to_rider((select id from ids where k = 'o_oferta'), 'ready', null, v_rider);
  -- Los tres pedidos del repartidor: asignado, retirado y en camino.
  for v_key in select unnest(array['o_asignado', 'o_retirado', 'o_en_camino']) loop
    select id into v_order from ids where k = v_key;
    perform set_config('request.jwt.claims', (select claims from actores where actor = 'owner'), true);
    perform public.offer_order_to_rider(v_order, 'ready', null, v_rider);
    select o.id into v_offer from public.rider_order_offers o where o.order_id = v_order and o.status = 'pending';
    perform set_config('request.jwt.claims', (select claims from actores where actor = 'rider'), true);
    perform public.accept_rider_order_offer(v_offer, 1, 'authz-fixture-aceptar-' || replace(v_key, '_', '-'));
    if v_key in ('o_retirado', 'o_en_camino') then
      perform public.mark_delivery_picked_up(v_order, (select revision from public.orders where id = v_order), 'authz-fixture-retirar-' || replace(v_key, '_', '-'));
    end if;
    if v_key = 'o_en_camino' then
      perform public.start_rider_delivery(v_order, (select revision from public.orders where id = v_order), 'authz-fixture-ruta-en-camino');
    end if;
  end loop;

  -- Configuración del comercio que los comandos de ajustes necesitan encontrar: una
  -- zona, una excepción de horario, la delegación del empleado y un lote de catálogo.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'owner'), true);
  v_result := public.upsert_delivery_zone(v_a, jsonb_build_object('name', 'Centro Matriz', 'match_kind', 'declared_area',
    'area', 'Centro', 'delivery_fee', '500', 'minimum_subtotal', '0'));
  insert into ids values ('zona', (v_result ->> 'zone_id')::uuid);
  v_result := public.set_business_service_exception(v_a, 'all', date '2031-01-01', true, null, null, 'Feriado de la matriz');
  insert into ids values ('excepcion', (v_result ->> 'exception_id')::uuid);
  perform public.set_commercial_settings_delegation(v_a, v_delegate, true);
  perform public.apply_commercial_catalog_batch(v_a, jsonb_build_array(jsonb_build_object('sku', 'authorization-matrix-botella', 'price', '950')));
  insert into ids select 'lote', b.id from public.catalog_change_batches b where b.business_id = v_a order by b.created_at desc limit 1;

  -- Los dos «revocados», los dos por mano del dueño: una baja de miembro y una sesión
  -- revocada. Las dos personas conservan su token.
  perform public.identity_set_member_active(v_a, v_disabled, false, 'baja de prueba');
  perform public.identity_revoke_session('e19a0000-0000-4000-8000-000000000009');
  perform set_config('request.jwt.claims', '', true);

  insert into textos
  select 'codigo_' || i.k, o.public_code from ids i join public.orders o on o.id = i.id where i.k like 'o\_%';
end
$fixture$;

-- Lo que el COMMIT de las altas habría verificado.
set constraints all immediate;
set constraints all deferred;

-- ── Herramientas de la matriz ──────────────────────────────────────────────
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select id from ids where k = p_key $$;
create function pg_temp.txt(p_key text) returns text language sql stable as $$ select v from textos where k = p_key $$;
-- Revisión vigente y oferta viva, leídas como dueño de la base: quien llama a un comando
-- con el dato correcto tiene que ser rechazado por su rol, no por un dato viejo.
create function pg_temp.rev(p_order uuid) returns bigint language sql stable security definer as $$
  select o.revision from public.orders o where o.id = p_order $$;
create function pg_temp.oferta(p_order uuid) returns uuid language sql stable security definer as $$
  select o.id from public.rider_order_offers o where o.order_id = p_order and o.status = 'pending' order by o.created_at desc limit 1 $$;

-- Un ensayo: ejecuta la consulta con el rol de base y los claims del actor, corre lo que
-- haría el COMMIT (las restricciones diferidas), anota lo que devolvió (un escalar) o el
-- SQLSTATE con que fue rechazada, y deshace todo lo que hizo.
create function pg_temp.ensayo(p_actor text, p_sql text) returns text
language plpgsql as $$
declare
  v_actor actores%rowtype;
  v_out text;
begin
  select * into strict v_actor from actores where actor = p_actor;
  begin
    perform set_config('request.jwt.claims', v_actor.claims, true);
    execute format('set local role %I', v_actor.db_role);
    execute replace(p_sql, '%ACTOR%', p_actor) into v_out;
    set constraints all immediate;
    raise exception using errcode = 'TR1AL', message = coalesce(v_out, 'NULL');
  exception
    when sqlstate 'TR1AL' then v_out := sqlerrm;
    when others then v_out := sqlstate;
  end;
  execute 'reset role';
  set constraints all deferred;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$$;

-- Una fila de la matriz: una afirmación por actor. `p_esperado` lleva, por actor,
-- «VEREDICTO resultado»; el veredicto va a la descripción y el resultado se compara.
create function pg_temp.matriz(p_celda text, p_sql text, p_esperado jsonb)
returns setof text language sql as $$
  select is(
           pg_temp.ensayo(o.actor, p_sql),
           substr(p_esperado ->> o.actor, strpos(p_esperado ->> o.actor, ' ') + 1),
           p_celda || ' · ' || o.actor || ' · ' || split_part(p_esperado ->> o.actor, ' ', 1))
    from unnest(array['anon', 'cliente', 'cliente2', 'owner', 'admin', 'staff', 'caja', 'delegado', 'rider', 'rider2', 'ajeno', 'baja', 'revocado'])
         with ordinality as o(actor, n)
   where p_esperado ? o.actor
   order by o.n;
$$;
-- Todos los actores con el mismo resultado, salvo los que se nombran.
create function pg_temp.salvo(p_resto text, p_excepciones jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_object_agg(a, p_resto) || p_excepciones
    from unnest(array['anon', 'cliente', 'cliente2', 'owner', 'admin', 'staff', 'caja', 'delegado', 'rider', 'rider2', 'ajeno', 'baja', 'revocado']) a $$;
-- El equipo del Panel (dueño, encargado y los tres empleados) con un resultado; el resto, 42501.
create function pg_temp.panel(p_resultado text, p_excepciones jsonb default '{}') returns jsonb language sql immutable as $$
  select pg_temp.salvo('DENY 42501', jsonb_build_object('owner', p_resultado, 'admin', p_resultado, 'staff', p_resultado,
    'caja', p_resultado, 'delegado', p_resultado) || p_excepciones) $$;
-- Sólo el dueño y el encargado con un resultado; el resto, 42501.
create function pg_temp.direccion(p_resultado text, p_excepciones jsonb default '{}') returns jsonb language sql immutable as $$
  select pg_temp.salvo('DENY 42501', jsonb_build_object('owner', p_resultado, 'admin', p_resultado) || p_excepciones) $$;

-- ══ 0 · EL FIXTURE ES EL QUE LA MATRIZ SUPONE ═══════════════════════════════
select is(
  (select string_agg(i.k || '=' || o.status || case when o.assigned_rider_user_id is not null then '+rider' else '' end, ' ' order by i.k)
     from ids i join public.orders o on o.id = i.id where i.k like 'o\_%'),
  'o_aceptado=accepted o_asignado=assigned+rider o_cobrado=received o_en_camino=on_the_way+rider o_listo_envio=ready '
  || 'o_listo_retiro=ready o_oferta=ready o_pago=received o_preparando=preparing o_recibido=received '
  || 'o_reparto_propio=on_the_way o_retirado=picked_up+rider',
  'fixture · cada pedido esta en el estado desde el que se ensaya');
select is(
  (select jsonb_object_agg(a.actor, coalesce(pg_temp.ensayo(a.actor, $q$select coalesce(public.identity_member_role(pg_temp.id('a')), 'sin-rol')$q$), '?'))
     from actores a where a.actor <> 'anon'),
  '{"owner":"owner","admin":"admin","staff":"staff","caja":"staff","delegado":"staff","rider":"rider","rider2":"rider",
    "cliente":"sin-rol","cliente2":"sin-rol","ajeno":"sin-rol","baja":"sin-rol","revocado":"sin-rol"}'::jsonb,
  'fixture · el rol vigente de cada actor en A: el cajero y el delegado son empleados; la baja y el revocado no tienen rol');
select is(
  (select jsonb_object_agg(a.actor, pg_temp.ensayo(a.actor, $q$select public.identity_has_permission(pg_temp.id('a'), 'orders.cancel')::text$q$))
     from actores a where a.actor in ('owner', 'admin', 'staff', 'caja', 'delegado', 'rider', 'baja', 'revocado')),
  '{"owner":"true","admin":"true","staff":"false","caja":"false","delegado":"false","rider":"false","baja":"false","revocado":"false"}'::jsonb,
  'fixture · quien tiene hoy el permiso orders.cancel segun el catalogo: el dueno y el encargado');

-- ══ 1 · CANCELAR Y RECHAZAR ═════════════════════════════════════════════════
-- Piden el permiso `orders.cancel` del catálogo (20261002050000). Rechazar no tiene un
-- permiso propio: es el mismo acto.
--
-- `cancel_order` para anon, cliente, cliente2, staff, admin, owner, rider, rider2 y ajeno
-- ya está en ecommerce_rls_matrix_test.sql («pedidos · cancelar un pedido»): el empleado
-- DENY 42501; el dueño y el encargado ALLOW. Acá, los actores que aquella no tiene.
select pg_temp.matriz('cancelar · cancel_order sobre un pedido recibido',
  $q$select public.cancel_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'cancelacion de prueba', 'authz-cancelar-%ACTOR%') ->> 'status'$q$,
  '{"caja":"DENY 42501","delegado":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('cancelar · transition_order a cancelled sobre un pedido recibido',
  $q$select public.transition_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'cancelled', 'authz-a-cancelado-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('ALLOW cancelled'));

select pg_temp.matriz('rechazar · transition_order a rejected sobre un pedido recibido',
  $q$select public.transition_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'rejected', 'authz-a-rechazado-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('ALLOW rejected'));

-- Cancelar es el mismo permiso en cualquier etapa. Con el pedido en la calle la
-- transición existe para el comercio (no devuelve stock): la decide el mismo permiso.
select pg_temp.matriz('cancelar · transition_order a cancelled con el pedido en camino',
  $q$select public.transition_order(pg_temp.id('o_en_camino'), pg_temp.rev(pg_temp.id('o_en_camino')),
       'cancelled', 'authz-cancelar-en-camino-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('ALLOW cancelled'));

-- Rechazar un pedido ya aceptado no es una arista de la máquina de estados. Quien tiene
-- el permiso se entera (23514); quien no lo tiene recibe la negativa de permisos antes.
select pg_temp.matriz('rechazar · transition_order a rejected sobre un pedido ya aceptado',
  $q$select public.transition_order(pg_temp.id('o_aceptado'), pg_temp.rev(pg_temp.id('o_aceptado')),
       'rejected', 'authz-rechazar-aceptado-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('DENY 23514'));

-- Un pedido cobrado: el dueño y el encargado llegan hasta la regla del cobro (55000);
-- el empleado no llega: su negativa es la de permisos.
select pg_temp.matriz('cancelar · cancel_order sobre un pedido pagado por Mercado Pago sin reembolso',
  $q$select public.cancel_order(pg_temp.id('o_pago'), pg_temp.rev(pg_temp.id('o_pago')),
       'cancelacion de prueba', 'authz-cancelar-pago-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('DENY 55000'));
select pg_temp.matriz('cancelar · transition_order a cancelled con el cobro en efectivo confirmado',
  $q$select public.transition_order(pg_temp.id('o_cobrado'), pg_temp.rev(pg_temp.id('o_cobrado')),
       'cancelled', 'authz-cancelar-cobrado-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('DENY 55000'));

-- El repartidor no cancela, tampoco el pedido que tiene asignado: las dos puertas son del
-- Panel y lo frena la línea de membresía de siempre («operador no autorizado»). El
-- comercio sí lo cancela con el reparto asignado, con el mismo permiso.
select pg_temp.matriz('cancelar · cancel_order sobre el pedido asignado al repartidor',
  $q$select public.cancel_order(pg_temp.id('o_asignado'), pg_temp.rev(pg_temp.id('o_asignado')),
       'cancelacion de prueba', 'authz-cancelar-asignado-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('ALLOW cancelled'));
select pg_temp.matriz('cancelar · transition_order a cancelled sobre el pedido asignado al repartidor',
  $q$select public.transition_order(pg_temp.id('o_asignado'), pg_temp.rev(pg_temp.id('o_asignado')),
       'cancelled', 'authz-a-cancelado-asignado-%ACTOR%') ->> 'status'$q$,
  pg_temp.direccion('ALLOW cancelled'));

-- ══ 2 · LAS DEMÁS TRANSICIONES ══════════════════════════════════════════════
-- No piden nada nuevo: las hace todo el equipo del Panel, también el empleado.
--
-- «aceptar» para los once actores de la otra matriz ya está allá («panel · aceptar un
-- pedido (transition_order)»). Acá, los que faltan.
select pg_temp.matriz('transicion · a accepted desde recibido',
  $q$select public.transition_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'accepted', 'authz-aceptar-%ACTOR%') ->> 'status'$q$,
  '{"caja":"ALLOW accepted","delegado":"ALLOW accepted","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('transicion · a preparing desde aceptado',
  $q$select public.transition_order(pg_temp.id('o_aceptado'), pg_temp.rev(pg_temp.id('o_aceptado')),
       'preparing', 'authz-preparar-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('ALLOW preparing'));

select pg_temp.matriz('transicion · a ready desde en preparacion',
  $q$select public.transition_order(pg_temp.id('o_preparando'), pg_temp.rev(pg_temp.id('o_preparando')),
       'ready', 'authz-listo-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('ALLOW ready'));

select pg_temp.matriz('transicion · a delivered un retiro listo',
  $q$select public.transition_order(pg_temp.id('o_listo_retiro'), pg_temp.rev(pg_temp.id('o_listo_retiro')),
       'delivered', 'authz-entregar-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('ALLOW delivered'));

select pg_temp.matriz('transicion · a on_the_way un envio listo sin repartidor (reparto propio)',
  $q$select public.transition_order(pg_temp.id('o_listo_envio'), pg_temp.rev(pg_temp.id('o_listo_envio')),
       'on_the_way', 'authz-despachar-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('ALLOW on_the_way'));

-- Los estados del repartidor no son destinos de esta puerta: el comercio pasa la
-- autorización y lo frena la máquina de estados (23514); el repartidor, aunque el
-- pedido sea suyo, no usa esta puerta (tiene sus propios comandos).
select pg_temp.matriz('transicion · a assigned un envio listo',
  $q$select public.transition_order(pg_temp.id('o_listo_envio'), pg_temp.rev(pg_temp.id('o_listo_envio')),
       'assigned', 'authz-asignar-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('DENY 23514'));

select pg_temp.matriz('transicion · a picked_up un pedido asignado al repartidor',
  $q$select public.transition_order(pg_temp.id('o_asignado'), pg_temp.rev(pg_temp.id('o_asignado')),
       'picked_up', 'authz-retirar-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('DENY 23514'));

select pg_temp.matriz('transicion · a arrived un pedido en camino con repartidor',
  $q$select public.transition_order(pg_temp.id('o_en_camino'), pg_temp.rev(pg_temp.id('o_en_camino')),
       'arrived', 'authz-llegar-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('DENY 23514'));

-- Entregar un envío no es una transición: el cierre pide el código del cliente.
select pg_temp.matriz('transicion · a delivered un envio en camino con repartidor',
  $q$select public.transition_order(pg_temp.id('o_en_camino'), pg_temp.rev(pg_temp.id('o_en_camino')),
       'delivered', 'authz-entregar-envio-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('DENY 23514'));

-- «Recibido» no es un destino: el equipo pasa la autorización y la transición lo rechaza.
select pg_temp.matriz('transicion · a received un pedido aceptado (no es un destino)',
  $q$select public.transition_order(pg_temp.id('o_aceptado'), pg_temp.rev(pg_temp.id('o_aceptado')),
       'received', 'authz-a-recibido-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('DENY 22023'));

-- Las dos autoridades de adentro no son puertas: ningún cliente las ejecuta. Es lo que
-- hace que alcance con preguntar el permiso en las dos puertas de arriba. (La
-- `transition_order` de tres argumentos ya está en la otra matriz.)
select pg_temp.matriz('transicion · change_order_status directo (no es una puerta)',
  $q$select public.change_order_status(pg_temp.id('o_recibido'), 'received', 'cancelled') ->> 'status'$q$,
  pg_temp.salvo('DENY 42501'));

-- ══ 3 · LOS OTROS COMANDOS DEL PANEL SOBRE UN PEDIDO ════════════════════════
-- acknowledge_order, confirm_manual_order_payment, reverse_manual_order_payment y
-- prepare_payment_refund_v2 ya están en la otra matriz para sus once actores. Acá, los
-- que faltan: el cajero y el delegado son empleados; la baja y el revocado, nadie.
select pg_temp.matriz('panel · acusar recibo (acknowledge_order)',
  $q$select (public.acknowledge_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'authz-acusar-%ACTOR%') is not null)::text$q$,
  '{"caja":"ALLOW true","delegado":"ALLOW true","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · confirmar el cobro en efectivo (confirm_manual_order_payment)',
  $q$select public.confirm_manual_order_payment(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'cash', 'authz-cobrar-%ACTOR%') ->> 'manual_payment_status'$q$,
  '{"caja":"ALLOW confirmed","delegado":"ALLOW confirmed","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('reembolsos · devolver un cobro en efectivo (reverse_manual_order_payment)',
  $q$select public.reverse_manual_order_payment(pg_temp.id('o_cobrado'), pg_temp.rev(pg_temp.id('o_cobrado')),
       'reversa de prueba', 'authz-revertir-%ACTOR%') ->> 'manual_payment_status'$q$,
  '{"caja":"DENY 42501","delegado":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('reembolsos · pedir el reembolso de un pago de Mercado Pago (prepare_payment_refund_v2)',
  $q$select (public.prepare_payment_refund_v2(pg_temp.id('pago'), 1000, 'f19a0000-0000-4000-8000-000000000001',
       'reembolso de prueba') ? 'refund_id')::text$q$,
  '{"caja":"DENY 42501","delegado":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · estimar la preparacion (set_preparation_estimate)',
  $q$select public.set_preparation_estimate(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       25, 'authz-estimar-%ACTOR%') ->> 'preparation_estimate_minutes'$q$,
  pg_temp.panel('ALLOW 25'));

-- El comercio cierra su propio reparto con el código del cliente. Con un código mal
-- formado (dos dígitos: no puede coincidir con ninguno) el equipo pasa la autorización
-- y recibe el rechazo del trámite, que no es un error.
select pg_temp.matriz('panel · cerrar el reparto propio con un codigo mal formado (confirm_business_delivery_code)',
  $q$select coalesce(r ->> 'code', r ->> 'status')
       from public.confirm_business_delivery_code(pg_temp.id('o_reparto_propio'), pg_temp.rev(pg_temp.id('o_reparto_propio')),
         '12', 'authz-cerrar-reparto-%ACTOR%') r$q$,
  pg_temp.panel('ALLOW invalid_format'));

select pg_temp.matriz('panel · la traza de un pedido (get_order_trace)',
  $q$select (public.get_order_trace(pg_temp.id('a'), pg_temp.txt('codigo_o_recibido')) #>> '{identifiers,order_id}'
       = pg_temp.id('o_recibido')::text)::text$q$,
  pg_temp.panel('ALLOW true'));

-- ══ 4 · ESCRITURAS DE CATÁLOGO ══════════════════════════════════════════════
-- El lote comercial (precio, stock, publicación): dueño y encargado. Para todos los
-- demás la negativa es 42501 (20261002051000; antes salía sin código, P0001).
select pg_temp.matriz('catalogo · aplicar un lote comercial (apply_commercial_catalog_batch)',
  $q$select count(*) from public.apply_commercial_catalog_batch(pg_temp.id('a'),
       '[{"sku":"authorization-matrix-botella","price":"980"}]'::jsonb)$q$,
  pg_temp.direccion('ALLOW 1'));

select pg_temp.matriz('catalogo · deshacer un lote comercial (rollback_commercial_catalog_batch)',
  $q$select public.rollback_commercial_catalog_batch(pg_temp.id('a'), pg_temp.id('lote')) ->> 'ok'$q$,
  pg_temp.direccion('ALLOW true'));

-- El plan comercial (altas y cambios en una transacción), con un solo cambio de precio.
select pg_temp.matriz('catalogo · aplicar un plan comercial (apply_commercial_catalog_plan)',
  $q$select public.apply_commercial_catalog_plan(pg_temp.id('a'), '[]'::jsonb,
       '[{"sku":"authorization-matrix-botella","price":"990"}]'::jsonb) ->> 'updated'$q$,
  pg_temp.direccion('ALLOW 1'));

-- El alta por lote con un lote vacío: quien pasa la autorización se detiene en la
-- validación (P0001: «entre 1 y 500»); quien no la pasa recibe 42501.
select pg_temp.matriz('catalogo · alta por lote, vacio (import_catalog_batch: pasar la autorizacion = P0001 de validacion)',
  $q$select count(*) from public.import_catalog_batch(pg_temp.id('a'), '[]'::jsonb, '[]'::jsonb)$q$,
  pg_temp.direccion('ALLOW P0001'));

-- Publicar por la puerta del alta un producto sin foto aprobada: quien pasa la
-- autorización se detiene en la validación de la foto (P0001).
select pg_temp.matriz('catalogo · publicar por el alta (publish_catalog_product: pasar la autorizacion = P0001 de validacion)',
  $q$select count(*) from public.publish_catalog_product(pg_temp.id('a'), 'authorization-matrix-botella', false)$q$,
  pg_temp.direccion('ALLOW P0001'));

select pg_temp.matriz('catalogo · despublicar (unpublish_catalog_product)',
  $q$select public.unpublish_catalog_product(pg_temp.id('a'), 'authorization-matrix-lata')::text$q$,
  pg_temp.direccion('ALLOW true'));

-- set_commercial_product_publication y apply_inventory_movement ya están en la otra
-- matriz. Acá, los actores que faltan: mover stock lo hace el empleado; publicar, no.
select pg_temp.matriz('catalogo · publicar por RPC (set_commercial_product_publication)',
  $q$select count(*) from public.set_commercial_product_publication(pg_temp.id('a'), 'authorization-matrix-lata', true)$q$,
  '{"caja":"DENY 42501","delegado":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('stock · registrar un movimiento (apply_inventory_movement)',
  $q$select (public.apply_inventory_movement(pg_temp.id('a'), pg_temp.id('p1'), null, 'purchase_receipt', 1, 1, null, null, null,
       'authz-movimiento-%ACTOR%')).quantity_delta::text$q$,
  '{"caja":"ALLOW 1","delegado":"ALLOW 1","baja":"DENY 42501","revocado":"DENY 42501"}');

-- ══ 5 · AJUSTES DEL COMERCIO ════════════════════════════════════════════════
-- La configuración comercial (horarios, excepciones, zonas, envío, exigencias, formas
-- de entrega, dirección): dueño, encargado y el empleado al que se la delegaron. Es la
-- única autoridad que se da por persona; el catálogo de permisos no la conoce.
create function pg_temp.comercial(p_resultado text) returns jsonb language sql immutable as $$
  select pg_temp.salvo('DENY 42501', jsonb_build_object('owner', p_resultado, 'admin', p_resultado, 'delegado', p_resultado)) $$;

select pg_temp.matriz('ajustes · horarios de atencion (set_business_service_hours)',
  $q$select public.set_business_service_hours(pg_temp.id('a'), 'pickup',
       '[{"weekday":1,"opens_at":"09:00","closes_at":"18:00"}]'::jsonb) ->> 'count'$q$,
  pg_temp.comercial('ALLOW 1'));

select pg_temp.matriz('ajustes · excepcion de horario (set_business_service_exception)',
  $q$select public.set_business_service_exception(pg_temp.id('a'), 'pickup', date '2031-05-01', true, null, null, 'Feriado') ->> 'ok'$q$,
  pg_temp.comercial('ALLOW true'));

select pg_temp.matriz('ajustes · borrar una excepcion de horario (delete_business_service_exception)',
  $q$select public.delete_business_service_exception(pg_temp.id('a'), pg_temp.id('excepcion')) ->> 'ok'$q$,
  pg_temp.comercial('ALLOW true'));

select pg_temp.matriz('ajustes · crear una zona de entrega (upsert_delivery_zone)',
  $q$select public.upsert_delivery_zone(pg_temp.id('a'), '{"name":"Oeste Matriz","match_kind":"declared_area","area":"Oeste",
       "delivery_fee":"700","minimum_subtotal":"0"}'::jsonb) ->> 'ok'$q$,
  pg_temp.comercial('ALLOW true'));

select pg_temp.matriz('ajustes · apagar una zona de entrega (set_delivery_zone_active)',
  $q$select public.set_delivery_zone_active(pg_temp.id('a'), pg_temp.id('zona'), false) ->> 'is_active'$q$,
  pg_temp.comercial('ALLOW false'));

select pg_temp.matriz('ajustes · borrar una zona de entrega (delete_delivery_zone)',
  $q$select public.delete_delivery_zone(pg_temp.id('a'), pg_temp.id('zona')) ->> 'ok'$q$,
  pg_temp.comercial('ALLOW true'));

select pg_temp.matriz('ajustes · exigir horarios y cobertura (set_service_enforcement)',
  $q$select public.set_service_enforcement(pg_temp.id('a'), null, true, null, null) ->> 'delivery_zone_enforced'$q$,
  pg_temp.comercial('ALLOW true'));

select pg_temp.matriz('ajustes · formas de entrega (set_business_fulfillment)',
  $q$select public.set_business_fulfillment(pg_temp.id('a'), true, true) ->> 'delivery_enabled'$q$,
  pg_temp.comercial('ALLOW true'));

select pg_temp.matriz('ajustes · direccion del local (set_business_address)',
  $q$select public.set_business_address(pg_temp.id('a'), 'Avenida de la Matriz 250, Neuquen') ->> 'ok'$q$,
  pg_temp.comercial('ALLOW true'));

-- set_delivery_pricing ya está en la otra matriz. Acá, los que faltan: al delegado se
-- lo deja; al cajero, que es un empleado sin delegación, no.
select pg_temp.matriz('ajustes · costo de envio (set_delivery_pricing)',
  $q$select (public.set_delivery_pricing(pg_temp.id('a'), 600, 0, null) is not null)::text$q$,
  '{"caja":"DENY 42501","delegado":"ALLOW true","baja":"DENY 42501","revocado":"DENY 42501"}');

-- Abrir, pausar y cerrar. Abrir y pausar los hace todo el equipo del Panel aunque el
-- catálogo diga que `business.settings` es del dueño y del encargado (AUTHZ-04, decisión
-- pendiente: no se cambió). Cerrar, sólo dueño y encargado; la delegación comercial no
-- lo alcanza. Pausar y cerrar para los once actores de la otra matriz ya están allá.
select pg_temp.matriz('ajustes · abrir el comercio (set_business_open_state open)',
  $q$select public.set_business_open_state(pg_temp.id('a'), 'open') ->> 'status'$q$,
  pg_temp.panel('ALLOW open'));
select pg_temp.matriz('ajustes · pausar el comercio (set_business_open_state paused)',
  $q$select public.set_business_open_state(pg_temp.id('a'), 'paused') ->> 'status'$q$,
  '{"caja":"ALLOW paused","delegado":"ALLOW paused","baja":"DENY 42501","revocado":"DENY 42501"}');
select pg_temp.matriz('ajustes · cerrar el comercio (set_business_open_state closed)',
  $q$select public.set_business_open_state(pg_temp.id('a'), 'closed') ->> 'status'$q$,
  '{"caja":"DENY 42501","delegado":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

-- Lo que es sólo del dueño y del encargado: el contacto público, la política de
-- presencia de repartidores y repartir la delegación (que no se delega).
select pg_temp.matriz('ajustes · WhatsApp del comercio (set_business_whatsapp_contact)',
  $q$select w.whatsapp_phone from public.set_business_whatsapp_contact(pg_temp.id('a'), '5492994000019', false) w$q$,
  pg_temp.direccion('ALLOW 5492994000019'));

select pg_temp.matriz('ajustes · exigir presencia de repartidores (set_business_rider_presence_policy)',
  $q$select public.set_business_rider_presence_policy(pg_temp.id('a'), true) ->> 'required'$q$,
  pg_temp.direccion('ALLOW true'));

select pg_temp.matriz('ajustes · delegar la configuracion comercial (set_commercial_settings_delegation)',
  $q$select public.set_commercial_settings_delegation(pg_temp.id('a'), pg_temp.id('staff'), true) ->> 'can_manage_commercial_settings'$q$,
  pg_temp.direccion('ALLOW true'));

-- ══ 6 · REPARTO ═════════════════════════════════════════════════════════════
-- Despachar es del equipo del Panel. offer_order_to_rider ya está en la otra matriz;
-- acá, los actores que faltan y los dos comandos que aquella no tiene.
select pg_temp.matriz('reparto · ofrecer un pedido a un repartidor (offer_order_to_rider)',
  $q$select public.offer_order_to_rider(pg_temp.id('o_listo_envio'), 'ready', null, pg_temp.id('rider2')) ->> 'code'$q$,
  '{"caja":"ALLOW offered","delegado":"ALLOW offered","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('reparto · retirar una oferta (withdraw_rider_order_offer)',
  $q$select public.withdraw_rider_order_offer(pg_temp.oferta(pg_temp.id('o_oferta'))) ->> 'ok'$q$,
  pg_temp.panel('ALLOW true'));

select pg_temp.matriz('reparto · asignar un repartidor sin oferta (assign_order_rider)',
  $q$select public.assign_order_rider(pg_temp.id('o_listo_envio'), 'ready', null, pg_temp.id('rider2')) ->> 'status'$q$,
  pg_temp.panel('ALLOW assigned'));

-- Los comandos del repartidor: sólo un repartidor del comercio, y sobre su pedido. El
-- dueño no los usa aunque el catálogo le dé `delivery.operate`. Aceptar una oferta,
-- retirar, tomar por código y entregar con código ya están en la otra matriz.
select pg_temp.matriz('rider · rechazar una oferta dirigida a rider (reject_rider_order_offer)',
  $q$select coalesce(r ->> 'outcome', r ->> 'code')
       from public.reject_rider_order_offer(pg_temp.oferta(pg_temp.id('o_oferta')), 1, 'too_far', 'authz-rechazar-oferta-%ACTOR%') r$q$,
  pg_temp.salvo('DENY P0002', '{"anon":"DENY 42501","rider":"ALLOW rejected"}'));

select pg_temp.matriz('rider · salir a repartir el pedido retirado (start_rider_delivery)',
  $q$select coalesce(r ->> 'outcome', r ->> 'code')
       from public.start_rider_delivery(pg_temp.id('o_retirado'), pg_temp.rev(pg_temp.id('o_retirado')), 'authz-salir-%ACTOR%') r$q$,
  pg_temp.salvo('DENY 42501', '{"rider":"ALLOW route_started","rider2":"DENY not_assigned"}'));

select pg_temp.matriz('rider · avisar que llego (mark_rider_arrived)',
  $q$select coalesce(r ->> 'outcome', r ->> 'code')
       from public.mark_rider_arrived(pg_temp.id('o_en_camino'), pg_temp.rev(pg_temp.id('o_en_camino')), 'authz-llegue-%ACTOR%') r$q$,
  pg_temp.salvo('DENY 42501', '{"rider":"ALLOW arrived","rider2":"DENY not_assigned"}'));

select pg_temp.matriz('rider · reportar una incidencia (report_rider_delivery_issue)',
  $q$select coalesce(r ->> 'outcome', r ->> 'code')
       from public.report_rider_delivery_issue(pg_temp.id('o_asignado'), pg_temp.rev(pg_temp.id('o_asignado')), 'other', 'authz-incidencia-%ACTOR%') r$q$,
  pg_temp.salvo('DENY 42501', '{"rider":"ALLOW issue_reported","rider2":"DENY not_assigned"}'));

select pg_temp.matriz('rider · publicar la ubicacion del pedido en camino (publish_rider_location_receipt)',
  $q$select r ->> 'code'
       from public.publish_rider_location_receipt(pg_temp.id('o_en_camino'), pg_temp.rev(pg_temp.id('o_en_camino')),
         -38.9516, -68.0591, 10, null, null, clock_timestamp(), 'authz-ubicacion-%ACTOR%', false) r$q$,
  pg_temp.salvo('DENY 42501', '{"rider":"ALLOW accepted","rider2":"DENY not_assigned"}'));

select pg_temp.matriz('rider · declararse disponible (set_rider_availability)',
  $q$select public.set_rider_availability(pg_temp.id('a'), true, 0, 'authz-disponible-%ACTOR%') ->> 'available'$q$,
  pg_temp.salvo('DENY 42501', '{"rider":"ALLOW true","rider2":"ALLOW true"}'));

select pg_temp.matriz('rider · latido de disponibilidad (heartbeat_rider_availability)',
  $q$select (public.heartbeat_rider_availability(pg_temp.id('a')) ? 'version')::text$q$,
  pg_temp.salvo('DENY 42501', '{"rider":"ALLOW true","rider2":"ALLOW true"}'));

-- ══ 7 · COMANDOS DEL CLIENTE ════════════════════════════════════════════════
-- El cliente cancela SU pedido sin atender por su propia puerta. No es el permiso del
-- comercio: ni el dueño cancela por acá un pedido que no hizo él, y para cualquiera
-- que no sea su dueño el pedido contesta igual que uno que no existe (P0002).
select pg_temp.matriz('cliente · cancelar el pedido propio sin atender (cancel_own_order)',
  $q$select public.cancel_own_order(pg_temp.id('o_recibido'), 'authz-propio-%ACTOR%', 'me arrepenti') ->> 'status'$q$,
  pg_temp.salvo('DENY P0002', '{"anon":"DENY 42501","cliente":"ALLOW cancelled"}'));

-- La libreta de direcciones es de cada persona: no hay permiso del comercio que la abra.
-- Guardar una dirección pide tener perfil de cliente; el equipo del fixture no lo tiene.
select pg_temp.matriz('cliente · guardar una direccion nueva propia (upsert_current_customer_address)',
  $q$select (public.upsert_current_customer_address(jsonb_build_object('label', 'Trabajo', 'street', 'Calle Reservada Tres',
       'streetNumber', '333', 'city', 'Neuquen', 'province', 'Neuquen')) -> 'address' ->> 'id' is not null)::text$q$,
  pg_temp.salvo('DENY 22023', '{"anon":"DENY 42501","cliente":"ALLOW true","cliente2":"ALLOW true"}'));

-- Editar y archivar la dirección de cliente2: anon, cliente, staff, owner, rider y ajeno
-- ya están en la otra matriz («perfil · editar la direccion de cliente2 por su id»,
-- «perfil · archivar la direccion de cliente2»). Acá, su dueña y los actores que faltan.
select pg_temp.matriz('cliente · editar la direccion de cliente2 por su id',
  $q$select ((public.upsert_current_customer_address(jsonb_build_object('id', pg_temp.id('dir_cliente2'), 'label', 'Casa nueva',
       'street', 'Calle Reservada Dos', 'streetNumber', '222', 'city', 'Neuquen')) -> 'address' ->> 'id')::uuid
       = pg_temp.id('dir_cliente2'))::text$q$,
  '{"cliente2":"ALLOW true","admin":"DENY 22023","caja":"DENY 22023","delegado":"DENY 22023","rider2":"DENY 22023",
    "baja":"DENY 22023","revocado":"DENY 22023"}');
select pg_temp.matriz('cliente · archivar la direccion de cliente2',
  $q$select (public.archive_current_customer_address(pg_temp.id('dir_cliente2')) is not null)::text$q$,
  '{"cliente2":"ALLOW true","admin":"DENY 42501","caja":"DENY 42501","delegado":"DENY 42501","rider2":"DENY 42501",
    "baja":"DENY 42501","revocado":"DENY 42501"}');
select pg_temp.matriz('cliente · marcar como predeterminada la direccion de cliente2 (set_current_customer_default_address)',
  $q$select public.set_current_customer_default_address(pg_temp.id('dir_cliente2')) ->> 'id'$q$,
  pg_temp.salvo('DENY 42501', jsonb_build_object('cliente2', 'ALLOW ' || pg_temp.id('dir_cliente2')::text)));

-- ══ 8 · EL PERMISO DE CANCELAR LO DA EL CATÁLOGO, POR ROL ═══════════════════
-- No existe una forma de darle `orders.cancel` a UN empleado: el catálogo es
-- (rol, permiso). Lo que sí se puede medir es que las dos puertas siguen al catálogo:
-- con la fila ('staff', 'orders.cancel') cancelan y rechazan TODOS los empleados —el del
-- Panel, el cajero y el delegado—, y sin ella ninguno.
insert into public.identity_role_permissions(role, permission) values ('staff', 'orders.cancel');

select pg_temp.matriz('con orders.cancel para el rol staff · cancel_order',
  $q$select public.cancel_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'cancelacion de prueba', 'authz-con-permiso-cancelar-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('ALLOW cancelled'));
select pg_temp.matriz('con orders.cancel para el rol staff · transition_order a cancelled',
  $q$select public.transition_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'cancelled', 'authz-con-permiso-a-cancelado-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('ALLOW cancelled'));
select pg_temp.matriz('con orders.cancel para el rol staff · transition_order a rejected',
  $q$select public.transition_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'rejected', 'authz-con-permiso-a-rechazado-%ACTOR%') ->> 'status'$q$,
  pg_temp.panel('ALLOW rejected'));

-- El repartidor nunca cancela, ni aunque el catálogo le diera el permiso: las dos
-- puertas son del Panel.
insert into public.identity_role_permissions(role, permission) values ('rider', 'orders.cancel');
select pg_temp.matriz('con orders.cancel para el rol rider · cancel_order del pedido que tiene asignado',
  $q$select public.cancel_order(pg_temp.id('o_asignado'), pg_temp.rev(pg_temp.id('o_asignado')),
       'cancelacion de prueba', 'authz-rider-cancela-%ACTOR%') ->> 'status'$q$,
  '{"rider":"DENY 42501","rider2":"DENY 42501"}');
select pg_temp.matriz('con orders.cancel para el rol rider · transition_order a cancelled del pedido que tiene asignado',
  $q$select public.transition_order(pg_temp.id('o_asignado'), pg_temp.rev(pg_temp.id('o_asignado')),
       'cancelled', 'authz-rider-a-cancelado-%ACTOR%') ->> 'status'$q$,
  '{"rider":"DENY 42501","rider2":"DENY 42501"}');

-- Y al revés: si el catálogo le saca el permiso al encargado, deja de cancelar. El
-- dueño sigue.
delete from public.identity_role_permissions where permission = 'orders.cancel' and role in ('staff', 'rider', 'admin');
select pg_temp.matriz('sin orders.cancel para staff ni admin · cancel_order',
  $q$select public.cancel_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'cancelacion de prueba', 'authz-sin-permiso-cancelar-%ACTOR%') ->> 'status'$q$,
  '{"owner":"ALLOW cancelled","admin":"DENY 42501","staff":"DENY 42501","caja":"DENY 42501","delegado":"DENY 42501"}');
select pg_temp.matriz('sin orders.cancel para staff ni admin · transition_order a rejected',
  $q$select public.transition_order(pg_temp.id('o_recibido'), pg_temp.rev(pg_temp.id('o_recibido')),
       'rejected', 'authz-sin-permiso-a-rechazado-%ACTOR%') ->> 'status'$q$,
  '{"owner":"ALLOW rejected","admin":"DENY 42501","staff":"DENY 42501","caja":"DENY 42501","delegado":"DENY 42501"}');
insert into public.identity_role_permissions(role, permission) values ('admin', 'orders.cancel');

-- ══ 9 · NADA DE LO ANTERIOR QUEDÓ ESCRITO ═══════════════════════════════════
select is(
  (select string_agg(i.k || '=' || o.status || case when o.assigned_rider_user_id is not null then '+rider' else '' end, ' ' order by i.k)
     from ids i join public.orders o on o.id = i.id where i.k like 'o\_%'),
  'o_aceptado=accepted o_asignado=assigned+rider o_cobrado=received o_en_camino=on_the_way+rider o_listo_envio=ready '
  || 'o_listo_retiro=ready o_oferta=ready o_pago=received o_preparando=preparing o_recibido=received '
  || 'o_reparto_propio=on_the_way o_retirado=picked_up+rider',
  'los ensayos se deshicieron: cada pedido sigue en el estado del principio');
select is(
  (select string_agg(permission || '=' || roles, ' ' order by permission)
     from (select p.permission, string_agg(p.role, ',' order by p.role) as roles
             from public.identity_role_permissions p where p.permission = 'orders.cancel' group by p.permission) x),
  'orders.cancel=admin,owner', 'y el catalogo de permisos quedo como estaba: orders.cancel es del dueno y del encargado');

select * from finish();
rollback;
