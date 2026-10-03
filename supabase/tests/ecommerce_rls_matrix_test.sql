-- TABA · LA MATRIZ DE AUTORIZACIÓN DEL E-COMMERCE
--
-- Quién puede qué, medido celda por celda con cambio real de rol y con los claims que
-- arma PostgREST. Cada celda afirma ALLOW o DENY con el resultado real: las filas que
-- se ven, el valor que devuelve la RPC, o el SQLSTATE del rechazo.
--
-- ACTORES (el vocabulario de roles es owner / admin / staff / rider: no hay «manager»,
-- el encargado es `admin`)
--
--   anon       sin sesión (rol `anon`)
--   cliente    comprador con sesión anónima de Auth (rol `authenticated`); dueño de los
--              pedidos que se usan como objetivo
--   cliente2   otro comprador
--   staff      empleado del comercio A, con sesión de equipo registrada
--   admin      encargado del comercio A
--   owner      dueño del comercio A
--   rider      repartidor del comercio A (tiene un pedido asignado)
--   rider2     otro repartidor del comercio A (no tiene nada asignado)
--   ajeno      dueño de OTRO comercio (B), con su sesión
--   baja       empleado de A dado de baja con identity_set_member_active(false);
--              conserva su token
--   revocado   empleado de A al que el dueño le revocó la sesión; conserva su token
--
-- RECURSOS: catálogo, checkout, pedidos, perfil del cliente, pagos y reembolsos,
-- stock, Panel, repartidor y seguimiento público.
--
-- Algunas celdas dependen de un permiso que hoy existe y que otro cambio puede quitar
-- (UPDATE de `products.stock`, SELECT de las columnas internas de `orders`, SELECT de
-- `anon` sobre `orders` y `order_items`). Su valor esperado se deriva del permiso
-- vigente: afirman que la fila y el rol deciden lo mismo con o sin ese permiso, y no
-- hay que tocarlas cuando el permiso cambie.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(838);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- Dos comercios (A es el que se prueba, B es el ajeno), un equipo completo en A,
-- dos clientes con sesión anónima y pedidos creados por el contrato real.
create temporary table ids (k text primary key, id uuid not null) on commit drop;
create temporary table textos (k text primary key, v text not null) on commit drop;
create temporary table actores (actor text primary key, db_role text not null, claims text not null) on commit drop;
grant select on ids, textos to anon, authenticated;

do $fixture$
declare
  v_a uuid := 'b1000000-0000-4000-8000-00000000000a';
  v_b uuid := 'b1000000-0000-4000-8000-00000000000b';
  v_owner uuid := 'a1000000-0000-4000-8000-000000000001';
  v_admin uuid := 'a1000000-0000-4000-8000-000000000002';
  v_staff uuid := 'a1000000-0000-4000-8000-000000000003';
  v_rider uuid := 'a1000000-0000-4000-8000-000000000004';
  v_rider2 uuid := 'a1000000-0000-4000-8000-000000000005';
  v_disabled uuid := 'a1000000-0000-4000-8000-000000000006';
  v_revoked uuid := 'a1000000-0000-4000-8000-000000000007';
  v_foreign uuid := 'a1000000-0000-4000-8000-000000000008';
  v_c1 uuid := 'a1000000-0000-4000-8000-0000000000c1';
  v_c2 uuid := 'a1000000-0000-4000-8000-0000000000c2';
  v_p1 uuid := 'c1000000-0000-4000-8000-000000000001';
  v_p2 uuid := 'c1000000-0000-4000-8000-000000000002';
  v_pb uuid := 'c1000000-0000-4000-8000-00000000000b';
  v_combo uuid := 'c1000000-0000-4000-8000-0000000000c0';
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
  -- Personas.
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values
    (v_owner,'authenticated','authenticated','matriz-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_admin,'authenticated','authenticated','matriz-admin@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_staff,'authenticated','authenticated','matriz-staff@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_rider,'authenticated','authenticated','matriz-rider@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_rider2,'authenticated','authenticated','matriz-rider2@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_disabled,'authenticated','authenticated','matriz-baja@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_revoked,'authenticated','authenticated','matriz-revocado@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_foreign,'authenticated','authenticated','matriz-ajeno@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_c1,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
    (v_c2,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

  -- Comercios. El guardián de admisión se apaga: acá se prueba autorización, no cupos.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
    currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values
    (v_a, 'Matriz A', 'matriz-rls-a', 'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00, 'off'),
    (v_b, 'Matriz B ajeno', 'matriz-rls-b', 'open', true, true, true, clock_timestamp(), v_foreign, 'ARS', true, false, 0.00, 0.00, 'off');

  insert into public.business_members(business_id,user_id,role,is_active)
  values
    (v_a, v_owner, 'owner', true), (v_a, v_admin, 'admin', true), (v_a, v_staff, 'staff', true),
    (v_a, v_rider, 'rider', true), (v_a, v_rider2, 'rider', true),
    (v_a, v_disabled, 'staff', true), (v_a, v_revoked, 'staff', true),
    (v_b, v_foreign, 'owner', true);

  -- Los actores de la matriz: rol de base y claims del token, como los arma PostgREST.
  -- Cada persona del equipo tiene su sesión registrada y la lleva en el claim.
  insert into actores values ('anon', 'anon', '{"role":"anon"}');
  for v_actor in
    select * from (values
      ('owner', v_owner, v_a, 'owner', 'panel_web', 'e1000000-0000-4000-8000-000000000001'::uuid),
      ('admin', v_admin, v_a, 'admin', 'panel_web', 'e1000000-0000-4000-8000-000000000002'::uuid),
      ('staff', v_staff, v_a, 'staff', 'panel_web', 'e1000000-0000-4000-8000-000000000003'::uuid),
      ('rider', v_rider, v_a, 'rider', 'rider_android', 'e1000000-0000-4000-8000-000000000004'::uuid),
      ('rider2', v_rider2, v_a, 'rider', 'rider_android', 'e1000000-0000-4000-8000-000000000005'::uuid),
      ('baja', v_disabled, v_a, 'staff', 'panel_web', 'e1000000-0000-4000-8000-000000000006'::uuid),
      ('revocado', v_revoked, v_a, 'staff', 'panel_web', 'e1000000-0000-4000-8000-000000000007'::uuid),
      ('ajeno', v_foreign, v_b, 'owner', 'panel_web', 'e1000000-0000-4000-8000-000000000008'::uuid)
    ) as t(actor, user_id, business_id, member_role, client, session_id)
  loop
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values (v_actor.session_id, v_actor.user_id, v_actor.business_id, v_actor.member_role, v_actor.client);
    insert into actores values (v_actor.actor, 'authenticated',
      json_build_object('sub', v_actor.user_id, 'role', 'authenticated', 'session_id', v_actor.session_id)::text);
  end loop;
  insert into actores values
    ('cliente', 'authenticated', json_build_object('sub', v_c1, 'role', 'authenticated', 'is_anonymous', true,
      'session_id', 'e1000000-0000-4000-8000-0000000000c1')::text),
    ('cliente2', 'authenticated', json_build_object('sub', v_c2, 'role', 'authenticated', 'is_anonymous', true,
      'session_id', 'e1000000-0000-4000-8000-0000000000c2')::text);

  -- Catálogo: uno publicado y un borrador en A; uno publicado en B. Y un combo que
  -- todavía no fue aprobado.
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values
    (v_p1,v_a,'Lata Matriz','Gaseosas','Cola',1000,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',1000,true,true,false,'{}',true,now(),v_owner,'matriz-lata','matriz-lata','commercial',1),
    (v_p2,v_a,'Borrador Matriz','Gaseosas','Cola',900,'pending',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',5,false,true,false,'{}',false,null,null,'matriz-borrador','matriz-borrador','commercial',1),
    (v_pb,v_b,'Lata Ajena','Gaseosas','Cola',800,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',1000,true,true,false,'{}',true,now(),v_foreign,'matriz-ajena','matriz-ajena','commercial',1);
  insert into public.product_combos(id,business_id,combo_id,name,discount_percentage,approval_status,is_active)
  values (v_combo, v_a, 'matriz-promo-pendiente', 'Promo Pendiente Matriz', 10, 'PENDIENTE_APROBACION_COMERCIAL', true);
  insert into public.product_combo_components(combo_id,product_id,quantity) values (v_combo, v_p1, 1), (v_combo, v_p2, 1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_a, true, 'test', 'checkout_pro', 'ARS', true, 'collector-matriz', 'app-matriz', clock_timestamp(), clock_timestamp());
  -- El vendedor conectado por OAuth: sin él la autoridad V2 no deja asentar la preferencia.
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_a, 'test', 'collector-matriz', 'app-matriz', 'connected', 'ciphertext-only-local-fixture', now() + interval '2 days');
  insert into ids values ('a', v_a), ('b', v_b), ('p1', v_p1), ('p2', v_p2), ('pb', v_pb),
    ('owner', v_owner), ('admin', v_admin), ('staff', v_staff), ('rider', v_rider), ('rider2', v_rider2),
    ('baja', v_disabled), ('revocado', v_revoked), ('ajeno', v_foreign), ('cliente', v_c1), ('cliente2', v_c2);

  -- Perfil y dirección confirmada de cada cliente, por el contrato de la vidriera.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente'), true);
  perform public.upsert_current_customer_profile('Carla Cliente', '2994111111');
  v_addr1 := (public.upsert_current_customer_address(jsonb_build_object(
    'label', 'Casa', 'street', 'Calle Privada Uno', 'streetNumber', '111', 'city', 'Neuquen', 'province', 'Neuquen',
    'neighborhood', 'Centro', 'latitude', -38.9516, 'longitude', -68.0591, 'geolocationAccuracy', 10,
    'source', 'gps', 'locationSource', 'map_pin', 'locationConfirmedAt', clock_timestamp(), 'isDefault', true
  )) -> 'address' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente2'), true);
  perform public.upsert_current_customer_profile('Dario Cliente', '2994222222');
  v_addr2 := (public.upsert_current_customer_address(jsonb_build_object(
    'label', 'Casa', 'street', 'Calle Privada Dos', 'streetNumber', '222', 'city', 'Neuquen', 'province', 'Neuquen',
    'neighborhood', 'Oeste', 'latitude', -38.9416, 'longitude', -68.0691, 'geolocationAccuracy', 10,
    'source', 'gps', 'locationSource', 'map_pin', 'locationConfirmedAt', clock_timestamp(), 'isDefault', true
  )) -> 'address' ->> 'id')::uuid;
  insert into ids values ('dir_cliente', v_addr1), ('dir_cliente2', v_addr2);

  -- Pedidos del cliente en A: siete retiros y un delivery. Cada operador del Panel
  -- tiene un pedido propio sobre el que ejercer lo que SÍ puede (`o_<rol>`) y otro
  -- para cancelar (`o_x_<rol>`; el del empleado queda sin cancelar: no tiene el
  -- permiso `orders.cancel`); `o_cliente` no lo toca nadie con éxito.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente'), true);
  for v_key in select unnest(array['o_cliente', 'o_staff', 'o_admin', 'o_owner', 'o_x_staff', 'o_x_admin', 'o_x_owner']) loop
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', v_a, 'client_request_id', 'matriz-' || replace(v_key, '_', '-') || '-0001',
      'tracking_token', md5(v_key) || md5(v_key || 'matriz'),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1)),
      'customer_name', 'Carla Cliente', 'customer_phone', '2994111111',
      'delivery_mode', 'pickup', 'payment_method', 'cash'));
    insert into ids values (v_key, (v_result ->> 'id')::uuid);
  end loop;
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'matriz-o-track-0001',
    'tracking_token', md5('o_track') || md5('o_track' || 'matriz'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 2)),
    'customer_name', 'Carla Cliente', 'customer_phone', '2994111111', 'customer_notes', 'Timbre roto, golpear',
    'delivery_mode', 'delivery', 'payment_method', 'cash', 'customer_address_id', v_addr1));
  insert into ids values ('o_track', (v_result ->> 'id')::uuid);

  -- Pedidos del cliente2: un retiro y cuatro delivery en A, y un retiro en B.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente2'), true);
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'matriz-o-cliente2-0001',
    'tracking_token', md5('o_cliente2') || md5('o_cliente2' || 'matriz'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1)),
    'customer_name', 'Dario Cliente', 'customer_phone', '2994222222',
    'delivery_mode', 'pickup', 'payment_method', 'cash'));
  insert into ids values ('o_cliente2', (v_result ->> 'id')::uuid);
  for v_key in select unnest(array['o_of_staff', 'o_of_admin', 'o_of_owner', 'o_libre']) loop
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', v_a, 'client_request_id', 'matriz-' || replace(v_key, '_', '-') || '-0001',
      'tracking_token', md5(v_key) || md5(v_key || 'matriz'),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1)),
      'customer_name', 'Dario Cliente', 'customer_phone', '2994222222',
      'delivery_mode', 'delivery', 'payment_method', 'cash', 'customer_address_id', v_addr2));
    insert into ids values (v_key, (v_result ->> 'id')::uuid);
  end loop;
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_b, 'client_request_id', 'matriz-o-ajeno-0001',
    'tracking_token', md5('o_ajeno') || md5('o_ajeno' || 'matriz'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_pb, 'quantity', 1)),
    'customer_name', 'Dario Cliente', 'customer_phone', '2994222222',
    'delivery_mode', 'pickup', 'payment_method', 'cash'));
  insert into ids values ('o_ajeno', (v_result ->> 'id')::uuid);

  -- Un pedido pagado por Mercado Pago (del cliente) y un checkout suyo todavía sin pagar.
  perform set_config('request.jwt.claims', '', true);
  v_result := public.create_checkout_session(v_c1, jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'matriz-pago-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 3)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Carla Cliente', 'phone', '5492994111111'),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_checkout := (v_result ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_checkout, v_c1, false);
  perform public.record_mercadopago_preference_created_v2(
    v_a, 'test', v_checkout, v_c1, (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(v_a, 'test', v_checkout, v_c1,
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-MATRIZ-0001', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=matriz',
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=matriz',
    encode(extensions.gen_random_bytes(32), 'hex'), 'req-matriz');
  select id into v_intent from public.payment_intents where checkout_session_id = v_checkout;
  perform public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', 'PAY-MATRIZ-0001', 'external_reference', 'taba2:checkout:' || v_checkout::text,
      'preference_id', pi.preference_id, 'merchant_order_id', 'MO-MATRIZ', 'collector_id', ps.collector_id,
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
  v_result := public.create_checkout_session(v_c1, jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'matriz-pendiente-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Carla Cliente', 'phone', '5492994111111'),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  insert into ids values ('checkout', (v_result ->> 'checkout_session_id')::uuid);

  -- El Panel deja listos los cinco delivery; uno queda asignado al repartidor.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'staff'), true);
  for v_key in select unnest(array['o_track', 'o_of_staff', 'o_of_admin', 'o_of_owner', 'o_libre']) loop
    select id into v_order from ids where k = v_key;
    foreach v_status in array array['accepted', 'preparing', 'ready'] loop
      select revision into v_rev from public.orders where id = v_order;
      perform public.transition_order(v_order, v_rev, v_status, 'matriz-' || replace(v_key, '_', '-') || '-' || v_status);
    end loop;
  end loop;
  perform public.offer_order_to_rider((select id from ids where k = 'o_track'), 'ready', null, v_rider);
  select o.id into v_offer from public.rider_order_offers o where o.order_id = (select id from ids where k = 'o_track');
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'rider'), true);
  perform public.accept_rider_order_offer(v_offer, 1, 'matriz-aceptar-track-01');

  -- Un movimiento de stock, para que el libro tenga algo que leer.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'staff'), true);
  perform public.apply_inventory_movement(v_a, v_p1, null, 'purchase_receipt', 5, 1, null, null, null, 'matriz-ingreso-0001');

  -- Los dos «revocados», los dos por mano del dueño: una baja de miembro y una
  -- sesión revocada. Las dos personas conservan su token.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'owner'), true);
  perform public.identity_set_member_active(v_a, v_disabled, false, 'baja de prueba');
  perform public.identity_revoke_session('e1000000-0000-4000-8000-000000000007');
  perform set_config('request.jwt.claims', '', true);

  insert into textos
  select 'codigo_' || i.k, o.public_code from ids i join public.orders o on o.id = i.id where i.k like 'o\_%';
  insert into textos values
    ('token_track', md5('o_track') || md5('o_track' || 'matriz')),
    ('token_cliente2', md5('o_cliente2') || md5('o_cliente2' || 'matriz')),
    ('token_nuevo', md5('rotado') || md5('rotado' || 'matriz'));
end
$fixture$;

-- Lo que el COMMIT de las altas habría verificado.
set constraints all immediate;
set constraints all deferred;

-- ── Herramientas de la matriz ──────────────────────────────────────────────
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select id from ids where k = p_key $$;
create function pg_temp.txt(p_key text) returns text language sql stable as $$ select v from textos where k = p_key $$;
-- El pedido sobre el que actúa cada actor: los tres operadores del Panel tienen uno
-- propio por prefijo (`o_staff`, `o_x_admin`, `o_of_owner`...); todos los demás
-- apuntan al pedido de referencia.
create function pg_temp.obj(p_prefix text, p_actor text, p_fallback text) returns uuid language sql stable as $$
  select id from ids
   where k = case when p_actor in ('staff', 'admin', 'owner') then p_prefix || p_actor else p_fallback end $$;
-- Revisión vigente y oferta viva, leídas como dueño de la base: quien llama a una RPC
-- con el dato correcto tiene que ser rechazado por su rol, no por un dato viejo.
create function pg_temp.rev(p_order uuid) returns bigint language sql stable security definer as $$
  select o.revision from public.orders o where o.id = p_order $$;
create function pg_temp.oferta(p_order uuid) returns uuid language sql stable security definer as $$
  select o.id from public.rider_order_offers o where o.order_id = p_order order by o.created_at desc limit 1 $$;

-- Una celda: ejecuta la consulta con el rol de base y los claims del actor y devuelve
-- lo que devolvió (un escalar) o el SQLSTATE con que fue rechazada.
create function pg_temp.celda(p_actor text, p_sql text, p_headers text default '') returns text
language plpgsql as $$
declare
  v_actor actores%rowtype;
  v_out text;
begin
  select * into strict v_actor from actores where actor = p_actor;
  begin
    perform set_config('request.jwt.claims', v_actor.claims, true);
    perform set_config('request.headers', p_headers, true);
    execute format('set local role %I', v_actor.db_role);
    execute replace(p_sql, '%ACTOR%', p_actor) into v_out;
    v_out := coalesce(v_out, 'NULL');
  exception when others then
    v_out := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end;
$$;

-- Una fila de la matriz: una afirmación por actor. `p_esperado` lleva, por actor,
-- «VEREDICTO resultado»; el veredicto va a la descripción y el resultado se compara.
create function pg_temp.matriz(p_celda text, p_sql text, p_esperado jsonb, p_headers text default '')
returns setof text language sql as $$
  select is(
           pg_temp.celda(o.actor, p_sql, p_headers),
           substr(p_esperado ->> o.actor, strpos(p_esperado ->> o.actor, ' ') + 1),
           p_celda || ' · ' || o.actor || ' · ' || split_part(p_esperado ->> o.actor, ' ', 1))
    from unnest(array['anon', 'cliente', 'cliente2', 'staff', 'admin', 'owner', 'rider', 'rider2', 'ajeno', 'baja', 'revocado'])
         with ordinality as o(actor, n)
   where p_esperado ? o.actor
   order by o.n;
$$;
-- El mismo resultado esperado para todos los actores.
create function pg_temp.todos(p_valor text) returns jsonb language sql immutable as $$
  select jsonb_object_agg(a, p_valor)
    from unnest(array['anon', 'cliente', 'cliente2', 'staff', 'admin', 'owner', 'rider', 'rider2', 'ajeno', 'baja', 'revocado']) a $$;

-- Lo que ve `anon` al leer una tabla por la que hoy tiene SELECT y RLS no le muestra
-- nada: cero filas. Si ese permiso se retira (hallazgo AUTHZ-07) el mismo intento
-- termina en 42501. Las dos respuestas son DENY; la celda afirma la que corresponde al
-- permiso vigente y no hay que tocarla cuando cambie.
create function pg_temp.anon_segun_permiso(p_tabla text, p_esperado jsonb) returns jsonb language sql stable as $$
  select case when has_table_privilege('anon', p_tabla, 'SELECT') then p_esperado
              else p_esperado || jsonb_build_object('anon', 'DENY 42501') end $$;

-- ══ 1 · CATÁLOGO ════════════════════════════════════════════════════════════
select pg_temp.matriz('catalogo · leer productos de A (1 publicado + 1 borrador)',
  $q$select count(*) from public.products where business_id = pg_temp.id('a')$q$,
  '{"anon":"ALLOW 1","cliente":"ALLOW 1","cliente2":"ALLOW 1","staff":"ALLOW 2","admin":"ALLOW 2","owner":"ALLOW 2",
    "rider":"ALLOW 1","rider2":"ALLOW 1","ajeno":"ALLOW 1","baja":"ALLOW 1","revocado":"ALLOW 1"}');

select pg_temp.matriz('catalogo · leer un producto sin publicar',
  $q$select count(*) from public.products where id = pg_temp.id('p2')$q$,
  '{"anon":"DENY 0","cliente":"DENY 0","cliente2":"DENY 0","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}');

select pg_temp.matriz('catalogo · leer el costo (unit_cost)',
  $q$select count(unit_cost) from public.products where business_id = pg_temp.id('a')$q$,
  pg_temp.todos('DENY 42501'));

select pg_temp.matriz('catalogo · cambiar un precio por tabla',
  $q$with u as (update public.products set price = price where id = pg_temp.id('p1') returning 1) select count(*) from u$q$,
  pg_temp.todos('DENY 42501'));

select pg_temp.matriz('catalogo · insertar un producto por tabla',
  $q$with i as (insert into public.products(business_id, name, price) values (pg_temp.id('a'), 'x', 1) returning 1) select count(*) from i$q$,
  pg_temp.todos('DENY 42501'));

select pg_temp.matriz('catalogo · borrar un producto por tabla',
  $q$with d as (delete from public.products where id = pg_temp.id('p2') returning 1) select count(*) from d$q$,
  pg_temp.todos('DENY 42501'));

select pg_temp.matriz('catalogo · publicar por RPC (set_commercial_product_publication)',
  $q$select count(*) from public.set_commercial_product_publication(pg_temp.id('a'), 'matriz-lata', true)$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('catalogo · resolver un combo todavia sin aprobar (exists)',
  $q$select public.resolve_business_combo(pg_temp.id('a'), 'matriz-promo-pendiente', 1) ->> 'exists'$q$,
  '{"anon":"DENY false","cliente":"DENY false","cliente2":"DENY false","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY false","rider2":"DENY false","ajeno":"DENY false","baja":"DENY false","revocado":"DENY false"}');

-- ══ 2 · STOCK ═══════════════════════════════════════════════════════════════
select pg_temp.matriz('stock · leer el libro de movimientos (hay filas)',
  $q$select (count(*) > 0)::text from public.inventory_movements where business_id = pg_temp.id('a')$q$,
  '{"anon":"DENY 42501","cliente":"DENY false","cliente2":"DENY false","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY false","rider2":"DENY false","ajeno":"DENY false","baja":"DENY false","revocado":"DENY false"}');

select pg_temp.matriz('stock · registrar un movimiento (apply_inventory_movement)',
  $q$select (public.apply_inventory_movement(pg_temp.id('a'), pg_temp.id('p1'), null, 'purchase_receipt', 1, 1, null, null, null,
       'matriz-mov-%ACTOR%')).quantity_delta::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

-- Escribir `products.stock` directo, sin pasar por el libro. Hoy `authenticated` tiene
-- ese permiso de columna (hallazgo AUTHZ-02, parte de productos: lo cierra el paquete
-- de stock). Con el permiso, decide RLS: el equipo actualiza y el resto no toca filas.
-- Sin el permiso, nadie pasa del 42501. La celda vale en los dos mundos.
select pg_temp.matriz('stock · escribir products.stock directo, sin libro',
  $q$with u as (update public.products set stock = stock where id = pg_temp.id('p1') returning 1) select count(*) from u$q$,
  case when has_column_privilege('authenticated', 'public.products', 'stock', 'UPDATE') then
    '{"anon":"DENY 42501","cliente":"DENY 0","cliente2":"DENY 0","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
      "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'::jsonb
  else pg_temp.todos('DENY 42501') end);

-- ══ 3 · CHECKOUT ════════════════════════════════════════════════════════════
select pg_temp.matriz('checkout · leer la tabla checkout_sessions',
  $q$select count(*) from public.checkout_sessions$q$, pg_temp.todos('DENY 42501'));

select pg_temp.matriz('checkout · leer la sesion del cliente por RPC',
  $q$select (public.get_checkout_session_for_customer(pg_temp.id('checkout')) is not null)::text$q$,
  '{"anon":"DENY 42501","cliente":"ALLOW true","cliente2":"DENY 42501","staff":"DENY 42501","admin":"DENY 42501","owner":"DENY 42501",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('checkout · crear una sesion (RPC solo de servicio)',
  $q$select public.create_checkout_session(pg_temp.id('cliente'), '{}'::jsonb)::text$q$, pg_temp.todos('DENY 42501'));

-- ══ 4 · PEDIDOS: LECTURA ════════════════════════════════════════════════════
select pg_temp.matriz('pedidos · cuantos pedidos de A ve (hay 14)',
  $q$select count(*) from public.orders where business_id = pg_temp.id('a')$q$,
  pg_temp.anon_segun_permiso('public.orders', '{"anon":"DENY 0","cliente":"ALLOW 9","cliente2":"ALLOW 5","staff":"ALLOW 14","admin":"ALLOW 14","owner":"ALLOW 14",
    "rider":"ALLOW 1","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'));

select pg_temp.matriz('pedidos · leer el pedido del cliente por id',
  $q$select count(*) from public.orders where id = pg_temp.id('o_cliente')$q$,
  pg_temp.anon_segun_permiso('public.orders', '{"anon":"DENY 0","cliente":"ALLOW 1","cliente2":"DENY 0","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'));

select pg_temp.matriz('pedidos · leer el pedido del cliente por su codigo publico',
  $q$select count(*) from public.orders where public_code = pg_temp.txt('codigo_o_cliente')$q$,
  pg_temp.anon_segun_permiso('public.orders', '{"anon":"DENY 0","cliente":"ALLOW 1","cliente2":"DENY 0","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'));

select pg_temp.matriz('pedidos · leer los renglones del pedido del cliente',
  $q$select count(*) from public.order_items where order_id = pg_temp.id('o_cliente')$q$,
  pg_temp.anon_segun_permiso('public.order_items', '{"anon":"DENY 0","cliente":"ALLOW 1","cliente2":"DENY 0","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'));

select pg_temp.matriz('pedidos · leer el telefono de cliente2 en su pedido',
  $q$select count(customer_phone) from public.orders where id = pg_temp.id('o_cliente2')$q$,
  pg_temp.anon_segun_permiso('public.orders', '{"anon":"DENY 0","cliente":"DENY 0","cliente2":"ALLOW 1","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'));

select pg_temp.matriz('pedidos · leer los pedidos del comercio B',
  $q$select count(*) from public.orders where business_id = pg_temp.id('b')$q$,
  pg_temp.anon_segun_permiso('public.orders', '{"anon":"DENY 0","cliente":"DENY 0","cliente2":"ALLOW 1","staff":"DENY 0","admin":"DENY 0","owner":"DENY 0",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"ALLOW 1","baja":"DENY 0","revocado":"DENY 0"}'));

select pg_temp.matriz('pedidos · leer la bitacora del pedido (hay eventos)',
  $q$select (count(*) > 0)::text from public.order_events where order_id = pg_temp.id('o_track')$q$,
  '{"anon":"DENY 42501","cliente":"DENY false","cliente2":"DENY false","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY false","rider2":"DENY false","ajeno":"DENY false","baja":"DENY false","revocado":"DENY false"}');

select pg_temp.matriz('pedidos · cambiar un pedido por tabla',
  $q$with u as (update public.orders set status = 'delivered' where id = pg_temp.id('o_cliente') returning 1) select count(*) from u$q$,
  pg_temp.todos('DENY 42501'));

select pg_temp.matriz('pedidos · borrar un pedido por tabla',
  $q$with d as (delete from public.orders where id = pg_temp.id('o_cliente') returning 1) select count(*) from d$q$,
  pg_temp.todos('DENY 42501'));

select pg_temp.matriz('pedidos · cambiar un renglon por tabla',
  $q$with u as (update public.order_items set unit_price = 1 where order_id = pg_temp.id('o_cliente') returning 1) select count(*) from u$q$,
  pg_temp.todos('DENY 42501'));

-- Las columnas internas del pedido propio. Hoy el permiso de lectura es de tabla
-- (hallazgo AUTHZ-07, que queda abierto: el cliente web pide `select('*')` y un permiso
-- por columna lo rompería). Mientras exista, quien ve la fila ve esas columnas.
select pg_temp.matriz('pedidos · leer columnas internas (huella anti-abuso, operadores) de un pedido visible',
  $q$select count(*) from (
       select abuse_fingerprint_hash, client_request_fingerprint, correlation_id, acknowledged_by,
              manual_payment_confirmed_by, manual_payment_reversed_by, origin_reason
         from public.orders where id = pg_temp.id('o_cliente')) x$q$,
  case when has_column_privilege('authenticated', 'public.orders', 'abuse_fingerprint_hash', 'SELECT') then
    '{"cliente":"ALLOW 1","cliente2":"DENY 0","staff":"ALLOW 1","rider":"DENY 0","ajeno":"DENY 0"}'::jsonb
  else
    '{"cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","rider":"DENY 42501","ajeno":"DENY 42501"}'::jsonb
  end);

-- ══ 5 · PERFIL DEL CLIENTE (IDOR) ═══════════════════════════════════════════
select pg_temp.matriz('perfil · cuantas filas de customers ve',
  $q$select count(*) from public.customers$q$,
  '{"anon":"DENY 42501","cliente":"ALLOW 1","cliente2":"ALLOW 1","staff":"DENY 0","admin":"DENY 0","owner":"DENY 0",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}');

select pg_temp.matriz('perfil · telefono que devuelve get_current_customer_profile',
  $q$select public.get_current_customer_profile() -> 'profile' ->> 'phone'$q$,
  '{"anon":"DENY 42501","cliente":"ALLOW 2994111111","cliente2":"ALLOW 2994222222","staff":"DENY NULL","owner":"DENY NULL","ajeno":"DENY NULL"}');

select pg_temp.matriz('perfil · leer las direcciones de cliente2',
  $q$select count(*) from public.customer_addresses where customer_id = pg_temp.id('cliente2')$q$,
  '{"anon":"DENY 42501","cliente":"DENY 0","cliente2":"ALLOW 1","staff":"DENY 0","admin":"DENY 0","owner":"DENY 0",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}');

select pg_temp.matriz('perfil · editar la direccion de cliente2 por su id',
  $q$select ((public.upsert_current_customer_address(jsonb_build_object('id', pg_temp.id('dir_cliente2'), 'label', 'Tomada',
       'street', 'Calle Tomada', 'streetNumber', '1', 'city', 'Neuquen')) -> 'address' ->> 'id')::uuid
       = pg_temp.id('dir_cliente2'))::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","staff":"DENY 22023","owner":"DENY 22023","rider":"DENY 22023","ajeno":"DENY 22023"}');

select pg_temp.matriz('perfil · archivar la direccion de cliente2',
  $q$select public.archive_current_customer_address(pg_temp.id('dir_cliente2'))::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","staff":"DENY 42501","owner":"DENY 42501","rider":"DENY 42501","ajeno":"DENY 42501"}');

select pg_temp.matriz('perfil · pedir un delivery a la direccion de cliente2',
  $q$select public.create_order_with_items(jsonb_build_object('business_id', pg_temp.id('a'),
       'client_request_id', 'matriz-idor-dir-%ACTOR%', 'tracking_token', repeat('z', 40),
       'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('p1'), 'quantity', 1)),
       'customer_name', 'Intruso', 'customer_phone', '2994333333', 'delivery_mode', 'delivery', 'payment_method', 'cash',
       'customer_address_id', pg_temp.id('dir_cliente2'))) ->> 'id'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","staff":"DENY 42501","rider":"DENY 42501","ajeno":"DENY 42501"}');

select is(
  (select a.label || '|' || a.street from public.customer_addresses a where a.id = pg_temp.id('dir_cliente2')),
  'Casa|Calle Privada Dos', 'perfil · la direccion de cliente2 quedo intacta despues de todos los intentos');

-- ══ 6 · PAGOS Y REEMBOLSOS ══════════════════════════════════════════════════
select pg_temp.matriz('pagos · leer la tabla payment_intents',
  $q$select count(*) from public.payment_intents$q$, pg_temp.todos('DENY 42501'));
select pg_temp.matriz('pagos · leer la tabla payment_refunds',
  $q$select count(*) from public.payment_refunds$q$, pg_temp.todos('DENY 42501'));
select pg_temp.matriz('pagos · leer la tabla payment_events',
  $q$select count(*) from public.payment_events$q$, pg_temp.todos('DENY 42501'));

select pg_temp.matriz('pagos · listar los pagos del comercio (list_business_payments)',
  $q$select (count(*) > 0)::text from public.list_business_payments(pg_temp.id('a'))$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('reembolsos · preparar el reembolso de un pago de Mercado Pago',
  $q$select (public.prepare_payment_refund_v2(pg_temp.id('pago'), 1000, 'f1000000-0000-4000-8000-000000000001',
       'reembolso de prueba') ? 'refund_id')::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select is(
  (select count(*)::integer from public.payment_refunds r where r.payment_intent_id = pg_temp.id('pago')),
  1, 'reembolsos · los dos autorizados prepararon el MISMO reembolso (idempotente): hay una sola fila');

-- ══ 7 · PANEL ═══════════════════════════════════════════════════════════════
select pg_temp.matriz('panel · rol efectivo en A (identity_member_role)',
  $q$select coalesce(public.identity_member_role(pg_temp.id('a')), 'sin-rol')$q$,
  '{"anon":"DENY 42501","cliente":"DENY sin-rol","cliente2":"DENY sin-rol","staff":"ALLOW staff","admin":"ALLOW admin","owner":"ALLOW owner",
    "rider":"ALLOW rider","rider2":"ALLOW rider","ajeno":"DENY sin-rol","baja":"DENY sin-rol","revocado":"DENY sin-rol"}');

select pg_temp.matriz('panel · bandeja operativa (list_operational_pipeline devuelve filas)',
  $q$select (count(*) > 0)::text from public.list_operational_pipeline(pg_temp.id('a'), true)$q$,
  '{"anon":"DENY 42501","cliente":"DENY false","cliente2":"DENY false","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY false","rider2":"DENY false","ajeno":"DENY false","baja":"DENY false","revocado":"DENY false"}');

select pg_temp.matriz('panel · acusar recibo de un pedido (acknowledge_order)',
  $q$select (public.acknowledge_order(pg_temp.obj('o_', '%ACTOR%', 'o_cliente'), pg_temp.rev(pg_temp.obj('o_', '%ACTOR%', 'o_cliente')),
       'matriz-acusar-%ACTOR%') is not null)::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · aceptar un pedido (transition_order)',
  $q$select public.transition_order(pg_temp.obj('o_', '%ACTOR%', 'o_cliente'), pg_temp.rev(pg_temp.obj('o_', '%ACTOR%', 'o_cliente')),
       'accepted', 'matriz-aceptar-%ACTOR%') ->> 'status'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW accepted","admin":"ALLOW accepted","owner":"ALLOW accepted",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · la transicion interna de 3 argumentos (sin idempotencia)',
  $q$select public.transition_order(pg_temp.id('o_cliente'), pg_temp.rev(pg_temp.id('o_cliente')), 'accepted') ->> 'status'$q$,
  pg_temp.todos('DENY 42501'));

select pg_temp.matriz('panel · confirmar el cobro en efectivo (confirm_manual_order_payment)',
  $q$select public.confirm_manual_order_payment(pg_temp.obj('o_', '%ACTOR%', 'o_cliente'), pg_temp.rev(pg_temp.obj('o_', '%ACTOR%', 'o_cliente')),
       'cash', 'matriz-cobrar-%ACTOR%') ->> 'manual_payment_status'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW confirmed","admin":"ALLOW confirmed","owner":"ALLOW confirmed",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('reembolsos · devolver un cobro en efectivo (reverse_manual_order_payment)',
  $q$select public.reverse_manual_order_payment(pg_temp.obj('o_', '%ACTOR%', 'o_cliente'), pg_temp.rev(pg_temp.obj('o_', '%ACTOR%', 'o_cliente')),
       'reversa de prueba', 'matriz-revertir-%ACTOR%') ->> 'manual_payment_status'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW reversed","owner":"ALLOW reversed",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('pedidos · cancelar un pedido (cancel_order)',
  $q$select public.cancel_order(pg_temp.obj('o_x_', '%ACTOR%', 'o_cliente'), pg_temp.rev(pg_temp.obj('o_x_', '%ACTOR%', 'o_cliente')),
       'cancelacion de prueba', 'matriz-cancelar-%ACTOR%') ->> 'status'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW cancelled","owner":"ALLOW cancelled",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select is(
  (select o.status || ':' || coalesce(o.manual_payment_status, '-') from public.orders o where o.id = pg_temp.id('o_cliente')),
  'received:pending', 'pedidos · el pedido de referencia sigue intacto: nadie sin rol lo acepto, cobro ni cancelo');

select pg_temp.matriz('panel · leer el equipo (identity_list_members)',
  $q$select jsonb_array_length(public.identity_list_members(pg_temp.id('a')))$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW 7","owner":"ALLOW 7",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · leer la auditoria de identidad (hay eventos)',
  $q$select (jsonb_array_length(public.identity_list_audit_events(pg_temp.id('a'), 50)) > 0)::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · preparacion para abrir (get_store_opening_readiness)',
  $q$select (public.get_store_opening_readiness(pg_temp.id('a'), 1) is not null)::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · escribir businesses directo (PATCH)',
  $q$with u as (update public.businesses set phone = '299400%ACTOR%' where id = pg_temp.id('a') returning 1) select count(*) from u$q$,
  '{"anon":"DENY 42501","cliente":"DENY 0","cliente2":"DENY 0","staff":"DENY 0","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}');

select pg_temp.matriz('panel · cambiar el costo de envio (set_delivery_pricing)',
  $q$select (public.set_delivery_pricing(pg_temp.id('a'), 600, 0, null) is not null)::text$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · leer la auditoria de configuracion (hay filas)',
  $q$select (count(*) > 0)::text from public.business_config_audit where business_id = pg_temp.id('a')$q$,
  '{"anon":"DENY 42501","cliente":"DENY false","cliente2":"DENY false","staff":"DENY false","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY false","rider2":"DENY false","ajeno":"DENY false","baja":"DENY false","revocado":"DENY false"}');

-- AUTHZ-04: el catálogo de permisos (`identity_role_permissions`, lo que el Panel le
-- muestra a cada rol) y lo que las RPC exigen no decían lo mismo en tres lugares.
-- Cancelar ya sigue al catálogo (20261002050000, decisión del dueño: celda «cancelar un
-- pedido»). Los otros dos siguen pendientes de una decisión; la matriz fija lo que pasa
-- HOY de los dos lados y, cuando se decida cuál manda, cambian estas celdas junto con el
-- código.
--
--   orders.cancel      catálogo: owner y admin    RPC: owner y admin (las dos preguntan el permiso)
--   fiscal.authorize   catálogo: owner            RPC: owner y admin
--   business.settings  catálogo: owner y admin    RPC: staff puede abrir y pausar (celda de abajo)
--
-- El comercio de la matriz no tiene perfil fiscal: quien pasa la autorización se detiene
-- en P0002 («perfil fiscal inexistente») y no cambia nada; quien no la pasa recibe 42501.
select pg_temp.matriz('fiscal · autorizar la homologacion de ARCA (pasar la autorizacion = P0002: no hay perfil fiscal)',
  $q$select public.authorize_arca_homologation(pg_temp.id('a'), 'I_AUTHORIZE_ARCA_HOMOLOGATION') ->> 'ok'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW P0002","owner":"ALLOW P0002",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select is(
  (select jsonb_object_agg(x.permission, x.roles)
     from (select p.permission, string_agg(p.role, ',' order by p.role) as roles
             from public.identity_role_permissions p
            where p.permission in ('fiscal.authorize', 'orders.cancel', 'business.settings')
            group by p.permission) x),
  '{"fiscal.authorize": "owner", "orders.cancel": "admin,owner", "business.settings": "admin,owner"}'::jsonb,
  'AUTHZ-04 · lo que dice el catalogo para estos tres permisos: cancelar ya lo sigue; fiscal y ajustes, decision pendiente');

select pg_temp.matriz('panel · pausar el comercio (set_business_open_state paused)',
  $q$select public.set_business_open_state(pg_temp.id('a'), 'paused') ->> 'status'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW paused","admin":"ALLOW paused","owner":"ALLOW paused",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('panel · cerrar el comercio (set_business_open_state closed)',
  $q$select public.set_business_open_state(pg_temp.id('a'), 'closed') ->> 'status'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"ALLOW closed","owner":"ALLOW closed",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

-- Con el comercio cerrado la góndola deja de ser pública; el equipo la sigue viendo.
select pg_temp.matriz('catalogo · leer productos de A con el comercio cerrado',
  $q$select count(*) from public.products where business_id = pg_temp.id('a')$q$,
  '{"anon":"DENY 0","cliente":"DENY 0","staff":"ALLOW 2","owner":"ALLOW 2","rider":"DENY 0","ajeno":"DENY 0","revocado":"DENY 0"}');

select is(pg_temp.celda('owner', $q$select public.set_business_open_state(pg_temp.id('a'), 'open') ->> 'status'$q$),
  'open', 'panel · el dueno vuelve a abrir');

-- ══ 8 · REPARTIDOR ══════════════════════════════════════════════════════════
select pg_temp.matriz('rider · tablero propio (get_rider_delivery_board)',
  $q$select jsonb_typeof(public.get_rider_delivery_board())$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"DENY 42501","owner":"DENY 42501",
    "rider":"ALLOW object","rider2":"ALLOW object","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('rider · cola de pedidos listos sin asignar (devuelve filas)',
  $q$select (count(*) > 0)::text from public.list_available_rider_orders(pg_temp.id('a'))$q$,
  '{"anon":"DENY 42501","cliente":"DENY false","cliente2":"DENY false","staff":"DENY false","admin":"DENY false","owner":"DENY false",
    "rider":"ALLOW true","rider2":"ALLOW true","ajeno":"DENY false","baja":"DENY false","revocado":"DENY false"}');

select is(
  pg_temp.celda('rider2', $q$select (string_agg(q::text, ' ') ~ 'Calle Privada|2994|Dario|Carla|Timbre')::text
                                from public.list_available_rider_orders(pg_temp.id('a')) q$q$),
  'false', 'rider · la cola no lleva calle, telefono, nombre ni notas del cliente');

select pg_temp.matriz('rider · leer por tabla el pedido ASIGNADO al rider',
  $q$select count(*) from public.orders where id = pg_temp.id('o_track')$q$,
  pg_temp.anon_segun_permiso('public.orders', '{"anon":"DENY 0","cliente":"ALLOW 1","cliente2":"DENY 0","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"ALLOW 1","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'));

select pg_temp.matriz('rider · leer por tabla un pedido listo que nadie le ofrecio ni asigno',
  $q$select count(*) from public.orders where id = pg_temp.id('o_libre')$q$,
  pg_temp.anon_segun_permiso('public.orders', '{"anon":"DENY 0","cliente":"DENY 0","cliente2":"ALLOW 1","staff":"ALLOW 1","admin":"ALLOW 1","owner":"ALLOW 1",
    "rider":"DENY 0","rider2":"DENY 0","ajeno":"DENY 0","baja":"DENY 0","revocado":"DENY 0"}'));

-- El teléfono del cliente en el pedido asignado. El contrato del repartidor
-- (`rider_active_delivery_payload`) no lo lleva, pero el permiso de tabla sí lo deja
-- leer (AUTHZ-07, decisión de producto pendiente).
select pg_temp.matriz('rider · leer por tabla el telefono del cliente del pedido asignado',
  $q$select count(customer_phone) from public.orders where id = pg_temp.id('o_track')$q$,
  case when has_column_privilege('authenticated', 'public.orders', 'customer_phone', 'SELECT') then
    '{"rider":"ALLOW 1","rider2":"DENY 0"}'::jsonb
  else '{"rider":"DENY 42501","rider2":"DENY 42501"}'::jsonb end);

select pg_temp.matriz('rider · leer la tabla de ubicaciones (rider_locations)',
  $q$select count(*) from public.rider_locations$q$, pg_temp.todos('DENY 42501'));
select pg_temp.matriz('rider · leer la tabla de ofertas (rider_order_offers)',
  $q$select count(*) from public.rider_order_offers$q$, pg_temp.todos('DENY 42501'));

select pg_temp.matriz('rider · ofrecer un pedido a un repartidor (offer_order_to_rider)',
  $q$select public.offer_order_to_rider(pg_temp.obj('o_of_', '%ACTOR%', 'o_libre'), 'ready', null, pg_temp.id('rider')) ->> 'code'$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"ALLOW offered","admin":"ALLOW offered","owner":"ALLOW offered",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select is(pg_temp.celda('rider', $q$select count(*) from public.orders where id = pg_temp.id('o_of_staff')$q$),
  '0', 'rider · con la oferta viva y sin aceptar, el repartidor todavia NO lee el pedido por tabla');

-- La oferta de `o_of_staff` es para `rider`. Para cualquier otro es indistinguible de
-- una inexistente (P0002); el destinatario la acepta.
select pg_temp.matriz('rider · aceptar una oferta dirigida a rider (accept_rider_order_offer)',
  $q$select public.accept_rider_order_offer(pg_temp.oferta(pg_temp.id('o_of_staff')), 1, 'matriz-aceptar-%ACTOR%') ->> 'code'$q$,
  '{"anon":"DENY 42501","cliente":"DENY P0002","cliente2":"DENY P0002","staff":"DENY P0002","admin":"DENY P0002","owner":"DENY P0002",
    "rider2":"DENY P0002","ajeno":"DENY P0002","baja":"DENY P0002","revocado":"DENY P0002"}');
select is(pg_temp.celda('rider', $q$select public.accept_rider_order_offer(pg_temp.oferta(pg_temp.id('o_of_staff')), 1,
    'matriz-aceptar-rider') ->> 'code'$q$),
  'accepted', 'rider · aceptar una oferta dirigida a rider · rider · ALLOW');
select is(pg_temp.celda('rider', $q$select count(*) from public.orders where id = pg_temp.id('o_of_staff')$q$),
  '1', 'rider · recien despues de aceptar lee el pedido');

-- Operar un pedido que está asignado a OTRO repartidor.
select pg_temp.matriz('rider · retirar el pedido asignado a rider (mark_delivery_picked_up)',
  $q$select coalesce(r ->> 'outcome', r ->> 'code')
       from public.mark_delivery_picked_up(pg_temp.id('o_track'), pg_temp.rev(pg_temp.id('o_track')), 'matriz-retirar-%ACTOR%') r$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"DENY 42501","owner":"DENY 42501",
    "rider2":"DENY not_assigned","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');
select is(pg_temp.celda('rider', $q$select coalesce(r ->> 'outcome', r ->> 'code')
    from public.mark_delivery_picked_up(pg_temp.id('o_track'), pg_temp.rev(pg_temp.id('o_track')), 'matriz-retirar-rider') r$q$),
  'picked_up', 'rider · retirar el pedido asignado a rider · rider · ALLOW');

select pg_temp.matriz('rider · confirmar la entrega de un pedido que no tiene asignado (confirm_delivery_code)',
  $q$select coalesce(r ->> 'outcome', r ->> 'code')
       from public.confirm_delivery_code(pg_temp.id('o_track'), pg_temp.rev(pg_temp.id('o_track')), '1234', 'matriz-entregar-%ACTOR%') r$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"DENY 42501","owner":"DENY 42501",
    "rider2":"DENY not_assigned","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

-- Tomar un pedido listo por su código público. Para un repartidor del comercio es un
-- camino previsto (auto-asignación); para cualquier otro, conocer el código no alcanza.
select pg_temp.matriz('rider · tomar un pedido listo conociendo su codigo publico (claim_delivery_order)',
  $q$select coalesce(r ->> 'outcome', r ->> 'code')
       from public.claim_delivery_order(pg_temp.id('a'), pg_temp.txt('codigo_o_libre'), pg_temp.rev(pg_temp.id('o_libre')),
         'matriz-claim-%ACTOR%') r$q$,
  '{"anon":"DENY 42501","cliente":"DENY 42501","cliente2":"DENY 42501","staff":"DENY 42501","admin":"DENY 42501","owner":"DENY 42501",
    "ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');
select is(pg_temp.celda('rider2', $q$select coalesce(r ->> 'outcome', r ->> 'code')
    from public.claim_delivery_order(pg_temp.id('a'), pg_temp.txt('codigo_o_libre'), pg_temp.rev(pg_temp.id('o_libre')),
      'matriz-claim-rider2') r$q$),
  'claimed', 'rider · tomar un pedido listo conociendo su codigo publico · rider2 · ALLOW (previsto)');

-- ══ 9 · SEGUIMIENTO PÚBLICO ═════════════════════════════════════════════════
-- El seguimiento no mira quién llama: mira el token. Con el token correcto lo ve
-- cualquiera que lo tenga; sin él, nadie —ni el cliente dueño ni el equipo— por esta vía.
select pg_temp.matriz('tracking · con el token correcto (por id)',
  $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
  pg_temp.todos('ALLOW picked_up'), json_build_object('x-order-token', pg_temp.txt('token_track'))::text);

select pg_temp.matriz('tracking · con el token correcto (por codigo publico)',
  $q$select public.get_public_order_tracking(pg_temp.txt('codigo_o_track')) ->> 'status'$q$,
  '{"anon":"ALLOW picked_up","cliente2":"ALLOW picked_up"}', json_build_object('x-order-token', pg_temp.txt('token_track'))::text);

select pg_temp.matriz('tracking · con un token incorrecto',
  $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
  pg_temp.todos('DENY NULL'), json_build_object('x-order-token', repeat('x', 64))::text);

select pg_temp.matriz('tracking · con el token de OTRO pedido',
  $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
  pg_temp.todos('DENY NULL'), json_build_object('x-order-token', pg_temp.txt('token_cliente2'))::text);

select pg_temp.matriz('tracking · sin token',
  $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
  pg_temp.todos('DENY NULL'));

select pg_temp.matriz('tracking · enumerar por codigo publico, sin token',
  $q$select public.get_public_order_tracking(pg_temp.txt('codigo_o_track')) ->> 'status'$q$,
  pg_temp.todos('DENY NULL'));

select pg_temp.matriz('tracking · enumerar por codigo publico con un token ajeno',
  $q$select public.get_public_order_tracking(pg_temp.txt('codigo_o_track')) ->> 'status'$q$,
  '{"anon":"DENY NULL","cliente2":"DENY NULL","rider2":"DENY NULL"}',
  json_build_object('x-order-token', pg_temp.txt('token_cliente2'))::text);

-- Lo que el DTO entrega a quien tiene el token.
select is(
  pg_temp.celda('anon', $q$select (public.get_public_order_tracking(pg_temp.id('o_track')::text)::text
      ~* 'Calle Privada|2994111111|Carla|Timbre|Centro|a1000000-0000-4000-8000')::text$q$,
    json_build_object('x-order-token', pg_temp.txt('token_track'))::text),
  'false', 'tracking · el DTO no lleva telefono, direccion, barrio, nombre, notas ni ids de personas');
select is(
  pg_temp.celda('anon', $q$select coalesce(string_agg(k, ',' order by k), 'ninguna')
      from jsonb_object_keys(public.get_public_order_tracking(pg_temp.id('o_track')::text)) k
     where k not in ('public_code', 'delivery_mode', 'status', 'revision', 'created_at', 'updated_at', 'accepted_at',
       'preparing_at', 'ready_at', 'dispatched_at', 'arrived_at', 'delivered_at', 'cancelled_at', 'rejected_at',
       'is_delivered', 'terminal_visible_until', 'location_quality', 'estimated_arrival_at', 'estimated_arrival_source',
       'estimated_arrival_updated_at', 'estimated_minutes', 'rider_location')$q$,
    json_build_object('x-order-token', pg_temp.txt('token_track'))::text),
  'ninguna', 'tracking · el DTO no tiene ninguna clave fuera del contrato publico');

select pg_temp.matriz('tracking · leer la tabla de tokens (order_public_tokens)',
  $q$select count(*) from public.order_public_tokens$q$, pg_temp.todos('DENY 42501'));
select pg_temp.matriz('tracking · leer la tabla de codigos de entrega (order_delivery_handoffs)',
  $q$select count(*) from public.order_delivery_handoffs$q$, pg_temp.todos('DENY 42501'));

select pg_temp.matriz('tracking · pedir el codigo de entrega (issue_order_delivery_code)',
  $q$select (public.issue_order_delivery_code(pg_temp.id('o_track'), pg_temp.txt('token_track')) ? 'delivery_code')::text$q$,
  '{"anon":"DENY 42501","cliente":"ALLOW true","cliente2":"DENY 42501","staff":"DENY 42501","admin":"DENY 42501","owner":"DENY 42501",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select pg_temp.matriz('tracking · recuperar el acceso rotando el token (recover_order_tracking_access)',
  $q$select (public.recover_order_tracking_access(pg_temp.id('o_track'), pg_temp.txt('token_nuevo')) ? 'delivery_code')::text$q$,
  '{"anon":"DENY 42501","cliente":"ALLOW true","cliente2":"DENY 42501","staff":"DENY 42501","admin":"DENY 42501","owner":"DENY 42501",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');

select is(
  pg_temp.celda('anon', $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
    json_build_object('x-order-token', pg_temp.txt('token_track'))::text),
  'NULL', 'tracking · despues de rotar, el token viejo ya no abre nada');
select is(
  pg_temp.celda('anon', $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
    json_build_object('x-order-token', pg_temp.txt('token_nuevo'))::text),
  'picked_up', 'tracking · y el nuevo si');

-- El reparto termina por el contrato real: en camino, llegó, y el código que sólo
-- tiene el cliente.
do $entrega$
declare
  v_order uuid := pg_temp.id('o_track');
  v_code text;
begin
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente'), true);
  v_code := public.issue_order_delivery_code(v_order, pg_temp.txt('token_nuevo')) ->> 'delivery_code';
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'rider'), true);
  perform public.start_rider_delivery(v_order, pg_temp.rev(v_order), 'matriz-ruta-rider-01');
  perform public.mark_rider_arrived(v_order, pg_temp.rev(v_order), 'matriz-llego-rider-01');
  perform public.confirm_delivery_code(v_order, pg_temp.rev(v_order), v_code, 'matriz-entrega-rider-01');
  perform set_config('request.jwt.claims', '', true);
end
$entrega$;

select is((select o.status from public.orders o where o.id = pg_temp.id('o_track')), 'delivered',
  'rider · el repartidor asignado entrega con el codigo del cliente');
select pg_temp.matriz('rider · leer por tabla el pedido ya ENTREGADO',
  $q$select count(*) from public.orders where id = pg_temp.id('o_track')$q$,
  '{"cliente":"ALLOW 1","staff":"ALLOW 1","rider":"DENY 0","rider2":"DENY 0"}');
select is(
  pg_temp.celda('anon', $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
    json_build_object('x-order-token', pg_temp.txt('token_nuevo'))::text),
  'delivered', 'tracking · el pedido entregado se sigue viendo con su token durante la ventana terminal');
select is(
  pg_temp.celda('cliente', $q$select (public.recover_order_tracking_access(pg_temp.id('o_track'), repeat('n', 40)) is not null)::text$q$),
  '42501', 'tracking · sobre un pedido entregado ya no se rota el token');

-- Revocar: el cliente dueño y el equipo del comercio. El repartidor asignado, no.
select pg_temp.matriz('tracking · revocar el seguimiento (revoke_public_tracking)',
  $q$select public.revoke_public_tracking(pg_temp.obj('o_', '%ACTOR%', 'o_track'))::text$q$,
  '{"anon":"DENY 42501","cliente":"ALLOW true","cliente2":"DENY 42501","staff":"ALLOW true","admin":"ALLOW true","owner":"ALLOW true",
    "rider":"DENY 42501","rider2":"DENY 42501","ajeno":"DENY 42501","baja":"DENY 42501","revocado":"DENY 42501"}');
select is(
  pg_temp.celda('anon', $q$select public.get_public_order_tracking(pg_temp.id('o_track')::text) ->> 'status'$q$,
    json_build_object('x-order-token', pg_temp.txt('token_nuevo'))::text),
  'NULL', 'tracking · despues de revocar, el token deja de abrir el pedido');

-- ══ 10 · LOS REVOCADOS NO VUELVEN A ENTRAR CON EL MISMO TOKEN ═══════════════
select pg_temp.matriz('identidad · registrar otra vez la sesion (identity_register_session)',
  $q$select public.identity_register_session(pg_temp.id('a'), 'panel_web', 'Panel de prueba', null, '1') ->> 'code'$q$,
  '{"anon":"DENY 42501","cliente":"DENY not_authorized","ajeno":"DENY not_authorized","baja":"DENY not_authorized",
    "revocado":"DENY not_authorized","staff":"ALLOW registered"}');

select pg_temp.matriz('identidad · rol de Panel en A despues de intentar registrarse (has_business_role)',
  $q$select public.has_business_role(pg_temp.id('a'), array['owner', 'admin', 'staff', 'rider'])::text$q$,
  '{"cliente":"DENY false","ajeno":"DENY false","baja":"DENY false","revocado":"DENY false","staff":"ALLOW true"}');

-- Cerrar la propia sesión nombrando al comercio A no escribe en su auditoría (AUTHZ-03).
select set_config('taba.test_eventos_a',
  (select count(*)::text from public.identity_audit_events e where e.business_id = pg_temp.id('a')), true);
select pg_temp.matriz('identidad · cerrar la propia sesion nombrando al comercio A (identity_close_own_session)',
  $q$select public.identity_close_own_session(pg_temp.id('a')) ->> 'code'$q$,
  '{"anon":"DENY 42501","cliente":"ALLOW closed","cliente2":"ALLOW closed","ajeno":"ALLOW closed","baja":"ALLOW closed","revocado":"ALLOW closed"}');
select is(
  (select count(*)::text from public.identity_audit_events e where e.business_id = pg_temp.id('a')),
  current_setting('taba.test_eventos_a'),
  'identidad · y ninguno de ellos dejo un evento en la auditoria del comercio A');
select is(
  (select s.revoked_reason from public.identity_sessions s where s.session_id = 'e1000000-0000-4000-8000-000000000008'),
  'self_logout', 'identidad · el dueno de B cerro SU sesion (la de B), no una de A');

select * from finish();
rollback;
