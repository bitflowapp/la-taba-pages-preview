-- TABA · LA GERENCIA CIERRA UNA ENTREGA QUE YA SALIÓ, SIN EL CÓDIGO
--
-- Regresión de 20261002010000 (hallazgo OSM-04). Dos cosas opuestas a la vez:
--
--   1. que el dueño y el encargado pueden cerrar como entregado un pedido con envío
--      que ya salió del local cuando el código no aparece o el repartidor ya no puede
--      actuar, con huella durable, un evento propio y sin tocar el dinero;
--   2. que eso NO abrió la puerta que el código cierra: ni el empleado, ni el
--      repartidor (tampoco el que lleva el pedido), ni otro comercio, ni un encargado
--      dado de baja, ni un cliente pueden usarla; el código sigue rechazando uno
--      equivocado, y un UPDATE directo a `delivered` sigue fallando.
--
-- Los pedidos se crean y se mueven por las mismas funciones que usa la tienda
-- (ninguno se inserta a mano): efectivo y Mercado Pago, con repartidor y con reparto
-- propio. Sólo la matriz de estados fuerza el estado de una fila, y cada celda se
-- deshace entera.
--
-- Cada celda de autorización corre con el rol real (`anon`, `authenticated`) y los
-- claims que arma la API, y devuelve el resultado o el SQLSTATE del rechazo.
--
-- No depende de la hora ni de lo que ya haya en la base: los identificadores salen
-- del nombre de este archivo y ninguna cuenta mira una tabla entera.
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(162);

-- ── Herramientas ───────────────────────────────────────────────────────────
create temporary table ids (k text primary key, id uuid not null) on commit drop;
create temporary table textos (k text primary key, v text not null) on commit drop;
create temporary table actores (actor text primary key, db_role text not null, claims text not null) on commit drop;

-- Id determinista con forma de UUID v4 (create_checkout_session valida la forma),
-- derivado del nombre de este archivo: no puede chocar con una fila de otra prueba.
create function pg_temp.uid(p_label text) returns uuid language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
    from (select md5('complete_delivery_without_code_test:' || p_label) as h) x
$$;
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select id from ids where k = p_key $$;
create function pg_temp.txt(p_key text) returns text language sql stable as $$ select v from textos where k = p_key $$;
create function pg_temp.rev(p_order uuid) returns bigint language sql stable as $$ select revision from public.orders where id = p_order $$;
create function pg_temp.estado(p_key text) returns text language sql stable as $$ select status from public.orders where id = pg_temp.id(p_key) $$;
-- Sólo los claims, sin cambiar de rol: para armar el fixture y para los flujos que
-- después se miran como dueño de la base.
create function pg_temp.como(p_actor text) returns void language sql as $$
  select set_config('request.jwt.claims', (select claims from actores where actor = p_actor), true)::void;
$$;
create function pg_temp.nadie() returns void language sql as $$ select set_config('request.jwt.claims', '', true)::void $$;

-- Una celda: corre la consulta con el rol de base y los claims del actor y devuelve
-- lo que devolvió (un escalar) o el SQLSTATE del rechazo. Con p_deshacer, todo lo que
-- la consulta haya escrito se deshace: una celda no le cambia el mundo a la siguiente.
create function pg_temp.intento(p_actor text, p_sql text, p_deshacer boolean default true, p_headers text default '')
returns text language plpgsql as $$
declare
  v_actor actores%rowtype;
  v_out text;
begin
  select * into strict v_actor from actores where actor = p_actor;
  begin
    perform set_config('request.jwt.claims', v_actor.claims, true);
    perform set_config('request.headers', p_headers, true);
    execute format('set local role %I', v_actor.db_role);
    execute p_sql into v_out;
    v_out := coalesce(v_out, 'NULL');
    if p_deshacer then
      raise exception using errcode = 'WP110', message = 'deshacer la celda';
    end if;
  exception
    when sqlstate 'WP110' then null;
    when others then v_out := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end;
$$;

-- El comando, como texto, con la revisión vigente del pedido (o la que se pida).
create function pg_temp.cierre(p_order text, p_reason text, p_key text, p_note text default null,
  p_revision bigint default null, p_campo text default 'outcome')
returns text language sql stable as $$
  select format('select public.complete_delivery_without_code(%L, %s, %L, %L, %L) ->> %L',
    pg_temp.id(p_order), coalesce(p_revision, pg_temp.rev(pg_temp.id(p_order))), p_reason, p_key, p_note, p_campo)
$$;

-- Una celda de la matriz de estados: fuerza el estado (y el repartidor) de la fila,
-- deja que el dueño intente el cierre y deshace todo. Los disparadores se apagan
-- SÓLO para forzar el estado; el cierre corre con todos encendidos.
create function pg_temp.celda_estado(p_order text, p_status text, p_rider text) returns text language plpgsql as $$
declare
  v_out text;
begin
  begin
    alter table public.orders disable trigger user;
    update public.orders
       set status = p_status,
           assigned_rider_user_id = case when p_rider is null then null else pg_temp.id(p_rider) end
     where id = pg_temp.id(p_order);
    alter table public.orders enable trigger user;
    v_out := pg_temp.intento('owner', pg_temp.cierre(p_order, 'other', 'cdwc-estado-0001'), false);
    raise exception using errcode = 'WP110', message = 'deshacer la celda';
  exception when sqlstate 'WP110' then null;
  end;
  return v_out;
end;
$$;

-- Lo que dejó el cierre de un pedido: marcas, eventos propios y recibos del comando.
create function pg_temp.huella(p_order text) returns text language sql stable as $$
  select 'marcas=' || (select count(*) from public.order_delivery_overrides ov where ov.order_id = pg_temp.id(p_order))
      || ' eventos=' || (select count(*) from public.order_events e
                          where e.order_id = pg_temp.id(p_order) and e.event_type = 'order.delivered_without_code')
      || ' recibos=' || (select count(*) from public.business_command_receipts r
                          where r.order_id = pg_temp.id(p_order) and r.command_type = 'complete_delivery_without_code')
$$;

-- ── Fixture ────────────────────────────────────────────────────────────────
do $fixture$
declare
  v_a uuid := pg_temp.uid('negocio-a');
  v_b uuid := pg_temp.uid('negocio-b');
  v_owner uuid := pg_temp.uid('owner');
  v_admin uuid := pg_temp.uid('admin');
  v_staff uuid := pg_temp.uid('staff');
  v_rider uuid := pg_temp.uid('rider');
  v_rider2 uuid := pg_temp.uid('rider2');
  v_baja uuid := pg_temp.uid('baja');
  v_ajeno uuid := pg_temp.uid('ajeno');
  v_cliente uuid := pg_temp.uid('cliente');
  v_p uuid := pg_temp.uid('producto-a');
  v_pb uuid := pg_temp.uid('producto-b');
  v_actor record;
  v_address uuid;
  v_res jsonb;
  v_key text;
  v_order uuid;
  v_status text;
  v_offer uuid;
  v_session uuid;
  v_intent uuid;
  v_prepare jsonb;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values
    (v_owner,'authenticated','authenticated','complete-delivery-without-code-test-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_admin,'authenticated','authenticated','complete-delivery-without-code-test-admin@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_staff,'authenticated','authenticated','complete-delivery-without-code-test-staff@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_rider,'authenticated','authenticated','complete-delivery-without-code-test-rider@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_rider2,'authenticated','authenticated','complete-delivery-without-code-test-rider2@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_baja,'authenticated','authenticated','complete-delivery-without-code-test-baja@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_ajeno,'authenticated','authenticated','complete-delivery-without-code-test-ajeno@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_cliente,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

  -- El guardián de admisión se apaga: acá se prueba el cierre de entregas, no cupos.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
    currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values
    (v_a, 'Cierre sin codigo A', 'complete-delivery-without-code-test-a', 'open', true, true, true, clock_timestamp(), v_owner,
     'ARS', true, true, 500.00, 0.00, 'off'),
    (v_b, 'Cierre sin codigo B', 'complete-delivery-without-code-test-b', 'open', true, true, true, clock_timestamp(), v_ajeno,
     'ARS', true, true, 500.00, 0.00, 'off');
  insert into public.business_members(business_id,user_id,role,is_active) values
    (v_a, v_owner, 'owner', true), (v_a, v_admin, 'admin', true), (v_a, v_staff, 'staff', true),
    (v_a, v_rider, 'rider', true), (v_a, v_rider2, 'rider', true), (v_a, v_baja, 'admin', true),
    (v_b, v_ajeno, 'owner', true);

  insert into actores values ('anon', 'anon', '{"role":"anon"}');
  for v_actor in
    select * from (values
      ('owner', v_owner, v_a, 'owner', 'panel_web'), ('admin', v_admin, v_a, 'admin', 'panel_web'),
      ('staff', v_staff, v_a, 'staff', 'panel_web'), ('rider', v_rider, v_a, 'rider', 'rider_android'),
      ('rider2', v_rider2, v_a, 'rider', 'rider_android'), ('baja', v_baja, v_a, 'admin', 'panel_web'),
      ('ajeno', v_ajeno, v_b, 'owner', 'panel_web')
    ) as t(actor, user_id, business_id, member_role, client)
  loop
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values (pg_temp.uid('sesion-' || v_actor.actor), v_actor.user_id, v_actor.business_id, v_actor.member_role, v_actor.client);
    insert into actores values (v_actor.actor, 'authenticated',
      json_build_object('sub', v_actor.user_id, 'role', 'authenticated', 'session_id', pg_temp.uid('sesion-' || v_actor.actor))::text);
  end loop;
  insert into actores values ('cliente', 'authenticated',
    json_build_object('sub', v_cliente, 'role', 'authenticated', 'is_anonymous', true)::text);

  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values
    (v_p,v_a,'Lata Cierre','Gaseosas','Cola',1000,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',1000,true,true,false,'{}',true,now(),v_owner,
     'complete-delivery-without-code-test-lata','complete-delivery-without-code-test-lata','commercial',1),
    (v_pb,v_b,'Lata Ajena Cierre','Gaseosas','Cola',800,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',1000,true,true,false,'{}',true,now(),v_ajeno,
     'complete-delivery-without-code-test-ajena','complete-delivery-without-code-test-ajena','commercial',1);
  -- Mercado Pago en A: el vendedor conectado, sin el cual la autoridad V2 no asienta la preferencia.
  insert into public.business_payment_settings (business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at)
  values (v_a, true, 'test', 'checkout_pro', 'ARS', true, 'complete-delivery-without-code-test-collector',
    'complete-delivery-without-code-test-app', clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_a, 'test', 'complete-delivery-without-code-test-collector', 'complete-delivery-without-code-test-app', 'connected',
    'ciphertext-only-local-fixture', now() + interval '2 days');

  insert into ids values ('a', v_a), ('b', v_b), ('owner', v_owner), ('admin', v_admin), ('staff', v_staff),
    ('rider', v_rider), ('rider2', v_rider2), ('baja', v_baja), ('ajeno', v_ajeno), ('cliente', v_cliente),
    ('producto', v_p);

  -- El cliente, con su dirección confirmada, por el contrato de la vidriera.
  perform pg_temp.como('cliente');
  perform public.upsert_current_customer_profile('Zoe Cierre Privada', '2994555123');
  v_address := (public.upsert_current_customer_address(jsonb_build_object(
    'label', 'Casa', 'street', 'Pasaje Reservado', 'streetNumber', '777', 'city', 'Neuquen', 'province', 'Neuquen',
    'neighborhood', 'Centro', 'latitude', -38.9516, 'longitude', -68.0591, 'geolocationAccuracy', 10,
    'source', 'gps', 'locationSource', 'map_pin', 'locationConfirmedAt', clock_timestamp(), 'isDefault', true
  )) -> 'address' ->> 'id')::uuid;

  -- Pedidos en efectivo con envío. Cada uno guarda su token de seguimiento.
  --   o_puerta   repartidor en la puerta (arrived): el de la matriz de autoridad
  --   o_matriz   el de la matriz de estados
  --   o_propio   reparto propio, en camino: el cierre «de libro»
  --   o_bloq     repartidor en la puerta con el código bloqueado por intentos fallidos
  --   o_baja     retirado por un repartidor que después se da de baja
  --   o_vencido  reparto propio con el código vencido
  --   o_libre    reparto propio de un pedido que no exige código
  --   o_codigo   reparto propio que se cierra CON el código (el camino de siempre)
  --   o_rcodigo  repartidor que cierra CON el código
  --   o_guard    reparto propio para el UPDATE directo
  foreach v_key in array array['o_puerta', 'o_matriz', 'o_propio', 'o_bloq', 'o_baja', 'o_vencido', 'o_libre',
                               'o_codigo', 'o_rcodigo', 'o_guard'] loop
    perform pg_temp.como('cliente');
    insert into textos values ('token_' || v_key, md5('complete_delivery_without_code_test:' || v_key) || md5(v_key || ':token'));
    v_res := public.create_order_with_items(jsonb_build_object(
      'business_id', v_a, 'client_request_id', 'cdwc-test-' || replace(v_key, '_', '-') || '-0001',
      'tracking_token', (select v from textos where k = 'token_' || v_key),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 2)),
      'customer_name', 'Zoe Cierre Privada', 'customer_phone', '2994555123',
      'delivery_mode', 'delivery', 'payment_method', 'cash', 'customer_address_id', v_address));
    v_order := (v_res ->> 'id')::uuid;
    insert into ids values (v_key, v_order);
    perform pg_temp.como('staff');
    foreach v_status in array array['accepted', 'preparing', 'ready'] loop
      perform public.transition_order(v_order, pg_temp.rev(v_order), v_status, 'cdwc-test-' || replace(v_key, '_', '-') || '-' || v_status);
    end loop;
  end loop;

  -- Un retiro (para la matriz de estados) y un pedido de OTRO comercio.
  perform pg_temp.como('cliente');
  v_res := public.create_order_with_items(jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'cdwc-test-o-retiro-0001',
    'tracking_token', md5('complete_delivery_without_code_test:o_retiro') || md5('o_retiro:token'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 1)),
    'customer_name', 'Zoe Cierre Privada', 'customer_phone', '2994555123',
    'delivery_mode', 'pickup', 'payment_method', 'cash'));
  insert into ids values ('o_retiro', (v_res ->> 'id')::uuid);
  v_res := public.create_order_with_items(jsonb_build_object(
    'business_id', v_b, 'client_request_id', 'cdwc-test-o-ajeno-0001',
    'tracking_token', md5('complete_delivery_without_code_test:o_ajeno') || md5('o_ajeno:token'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_pb, 'quantity', 1)),
    'customer_name', 'Zoe Cierre Privada', 'customer_phone', '2994555123',
    'delivery_mode', 'delivery', 'payment_method', 'cash', 'customer_address_id', v_address));
  insert into ids values ('o_ajeno', (v_res ->> 'id')::uuid);
  perform pg_temp.como('ajeno');
  foreach v_status in array array['accepted', 'preparing', 'ready', 'on_the_way'] loop
    perform public.transition_order(pg_temp.id('o_ajeno'), pg_temp.rev(pg_temp.id('o_ajeno')), v_status, 'cdwc-test-o-ajeno-' || v_status);
  end loop;

  -- Un pedido pagado por Mercado Pago, con envío, por el camino V2 de las funciones Edge.
  perform pg_temp.nadie();
  v_res := public.create_checkout_session(v_cliente, jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'cdwc-test-o-mp-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 3)),
    'fulfillment_type', 'delivery',
    'address', jsonb_build_object('street', 'Pasaje Reservado', 'street_number', '777', 'city', 'Neuquen',
      'neighborhood', 'Centro', 'latitude', '-38.9516', 'longitude', '-68.0591',
      'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text),
    'contact', jsonb_build_object('name', 'Zoe Cierre Privada', 'phone', '5492994555123'),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_res ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_cliente, false);
  perform public.record_mercadopago_preference_created_v2(
    v_a, 'test', v_session, v_cliente, (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(v_a, 'test', v_session, v_cliente,
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-complete-delivery-without-code-test-0001',
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=cdwc',
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=cdwc',
    encode(digest('complete_delivery_without_code_test-pref-1', 'sha256'), 'hex'), 'req-complete-delivery-without-code-test');
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  perform public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', 'PAY-complete-delivery-without-code-test-0001',
      'external_reference', pi.external_reference, 'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-complete-delivery-without-code-test', 'collector_id', ps.collector_id,
      'currency', 'ARS', 'transaction_amount', cs.total::text, 'status', 'approved', 'status_detail', 'accredited',
      'payment_method', 'visa', 'live_mode', false, 'provider_occurred_at', clock_timestamp()::text,
      'refunded_amount', '0.00',
      'payer_email_hash', encode(digest('complete_delivery_without_code_test-payer', 'sha256'), 'hex'),
      'raw_response_hash', encode(digest('complete_delivery_without_code_test-snapshot-1', 'sha256'), 'hex'))
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
    where pi.id = v_intent), 'reconciliation', null);
  v_res := public.finalize_paid_checkout_session(v_session);
  insert into ids values ('o_mp', (v_res ->> 'order_id')::uuid), ('mp_intent', v_intent), ('mp_session', v_session);
  perform pg_temp.como('staff');
  foreach v_status in array array['accepted', 'preparing', 'ready'] loop
    perform public.transition_order(pg_temp.id('o_mp'), pg_temp.rev(pg_temp.id('o_mp')), v_status, 'cdwc-test-o-mp-' || v_status);
  end loop;

  -- Reparto propio: el comercio despacha lo suyo.
  perform pg_temp.como('owner');
  foreach v_key in array array['o_propio', 'o_vencido', 'o_libre', 'o_codigo', 'o_guard', 'o_mp'] loop
    perform public.transition_order(pg_temp.id(v_key), pg_temp.rev(pg_temp.id(v_key)), 'on_the_way',
      'cdwc-test-' || replace(v_key, '_', '-') || '-despacho');
  end loop;

  -- Con repartidor: `rider` lleva tres (el máximo) hasta la puerta; `rider2` retira uno.
  foreach v_key in array array['o_puerta', 'o_bloq', 'o_rcodigo'] loop
    perform pg_temp.como('staff');
    perform public.offer_order_to_rider(pg_temp.id(v_key), 'ready', null, v_rider);
    select o.id into v_offer from public.rider_order_offers o where o.order_id = pg_temp.id(v_key) and o.status = 'pending';
    perform pg_temp.como('rider');
    perform public.accept_rider_order_offer(v_offer, 1, 'cdwc-test-' || replace(v_key, '_', '-') || '-acepta');
    perform public.mark_delivery_picked_up(pg_temp.id(v_key), pg_temp.rev(pg_temp.id(v_key)), 'cdwc-test-' || replace(v_key, '_', '-') || '-retira');
    perform public.start_rider_delivery(pg_temp.id(v_key), pg_temp.rev(pg_temp.id(v_key)), 'cdwc-test-' || replace(v_key, '_', '-') || '-camino');
    perform public.mark_rider_arrived(pg_temp.id(v_key), pg_temp.rev(pg_temp.id(v_key)), 'cdwc-test-' || replace(v_key, '_', '-') || '-llega');
  end loop;
  perform pg_temp.como('staff');
  perform public.offer_order_to_rider(pg_temp.id('o_baja'), 'ready', null, v_rider2);
  select o.id into v_offer from public.rider_order_offers o where o.order_id = pg_temp.id('o_baja') and o.status = 'pending';
  perform pg_temp.como('rider2');
  perform public.accept_rider_order_offer(v_offer, 1, 'cdwc-test-o-baja-acepta');
  perform public.mark_delivery_picked_up(pg_temp.id('o_baja'), pg_temp.rev(pg_temp.id('o_baja')), 'cdwc-test-o-baja-retira');

  -- El encargado `baja` deja de serlo: el dueño lo da de baja. Conserva su token.
  perform pg_temp.como('owner');
  perform public.identity_set_member_active(v_a, v_baja, false, 'baja de prueba');
  perform pg_temp.nadie();
end
$fixture$;

-- Lo que el COMMIT de las altas habría verificado.
set constraints all immediate;
set constraints all deferred;

select is(
  (select string_agg(i.k || '=' || o.status || case when o.assigned_rider_user_id is null then '' else '+rider' end, ' ' order by i.k)
     from ids i join public.orders o on o.id = i.id where i.k like 'o\_%'),
  'o_ajeno=on_the_way o_baja=picked_up+rider o_bloq=arrived+rider o_codigo=on_the_way o_guard=on_the_way o_libre=on_the_way '
  || 'o_matriz=ready o_mp=on_the_way o_propio=on_the_way o_puerta=arrived+rider o_rcodigo=arrived+rider o_retiro=received o_vencido=on_the_way',
  'control: el fixture dejó cada pedido donde la prueba lo necesita');

-- ══ 1 · LA PUERTA ═══════════════════════════════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.complete_delivery_without_code(uuid,bigint,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.complete_delivery_without_code(uuid,bigint,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.complete_delivery_without_code(uuid,bigint,text,text,text)', 'execute')
  and not has_function_privilege('public', 'public.complete_delivery_without_code(uuid,bigint,text,text,text)', 'execute'),
  'complete_delivery_without_code: sólo authenticated');
select is(
  (select p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ';'), '')
     from pg_proc p where p.oid = 'public.complete_delivery_without_code(uuid,bigint,text,text,text)'::regprocedure),
  'true search_path=pg_catalog, public, extensions, pg_temp',
  'es SECURITY DEFINER y fija su search_path');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.order_delivery_overrides'::regclass)
  and not exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.table_name = 'order_delivery_overrides'
       and g.grantee in ('anon', 'authenticated', 'PUBLIC'))
  and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_delivery_overrides') = 0,
  'order_delivery_overrides: RLS encendida, sin permisos ni políticas para anon o authenticated');
select is(
  (select string_agg(g.privilege_type, ',' order by g.privilege_type)
     from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = 'order_delivery_overrides' and g.grantee = 'service_role'),
  'SELECT', 'la clave de servicio la lee y no la escribe: una marca no se fabrica por la API');
select is(
  pg_temp.intento('owner', $q$select count(*) from public.order_delivery_overrides$q$), '42501',
  'ni la dueña lee la tabla de marcas directo: la conoce por el evento del pedido');
select ok(
  not has_function_privilege('anon', 'public.prevent_unverified_delivery()', 'execute')
  and not has_function_privilege('authenticated', 'public.prevent_unverified_delivery()', 'execute')
  and not has_function_privilege('service_role', 'public.prevent_unverified_delivery()', 'execute')
  and exists (select 1 from pg_trigger t where t.tgrelid = 'public.orders'::regclass
               and t.tgname = 'orders_require_verified_delivery_code'
               and t.tgfoid = 'public.prevent_unverified_delivery()'::regprocedure and t.tgenabled = 'O'),
  'el resguardo del código conserva sus permisos y sigue atado a su disparador');

-- ══ 2 · QUIÉN PUEDE ═════════════════════════════════════════════════════════
-- El mismo pedido, con el repartidor en la puerta, para todos. Cada celda se deshace.
select is(
  pg_temp.intento(m.actor, pg_temp.cierre('o_puerta', 'rider_unavailable', 'cdwc-autoridad-' || m.actor)),
  m.esperado,
  'autoridad · ' || m.actor || ' · ' || m.veredicto)
from (values
  (1, 'anon', '42501', 'DENY sin sesión'),
  (2, 'cliente', '42501', 'DENY aunque el pedido sea suyo'),
  (3, 'staff', '42501', 'DENY el empleado no cierra sin código'),
  (4, 'rider', '42501', 'DENY el repartidor que LLEVA el pedido tampoco'),
  (5, 'rider2', '42501', 'DENY otro repartidor'),
  (6, 'ajeno', '42501', 'DENY la dueña de OTRO comercio'),
  (7, 'baja', '42501', 'DENY un encargado dado de baja, con su token'),
  (8, 'admin', 'completed_without_code', 'ALLOW el encargado'),
  (9, 'owner', 'completed_without_code', 'ALLOW la dueña')
) as m(n, actor, esperado, veredicto)
order by m.n;
select is(pg_temp.estado('o_puerta') || ' · ' || pg_temp.huella('o_puerta'), 'arrived · marcas=0 eventos=0 recibos=0',
  'las nueve celdas se deshicieron: el pedido sigue en la puerta y nadie dejó nada');

-- Un pedido de otro comercio y uno que no existe contestan como el cierre con código.
select is(pg_temp.intento('owner', pg_temp.cierre('o_ajeno', 'other', 'cdwc-ajeno-0001')), '42501',
  'la dueña de A no cierra un pedido del comercio B: 42501');
select is(pg_temp.intento('ajeno', pg_temp.cierre('o_ajeno', 'other', 'cdwc-ajeno-0002')), 'completed_without_code',
  'la dueña de B sí cierra el suyo (control)');
select is(
  pg_temp.intento('owner', format($q$select public.complete_delivery_without_code(%L, 1, 'other', 'cdwc-inexistente-01') ->> 'outcome'$q$,
    pg_temp.uid('pedido-que-no-existe'))),
  'P0002', 'un pedido que no existe: P0002, igual que confirm_business_delivery_code');
select is(
  pg_temp.intento('owner', format($q$select public.confirm_business_delivery_code(%L, 1, '1234', 'cdwc-inexistente-02') ->> 'outcome'$q$,
    pg_temp.uid('pedido-que-no-existe'))),
  'P0002', 'control: el comando hermano contesta lo mismo');

-- ══ 3 · EN QUÉ ESTADO ═══════════════════════════════════════════════════════
-- Los quince estados que admite `orders`, con envío (sin y con repartidor) y con retiro.
select is(
  pg_temp.celda_estado('o_matriz', m.estado, null), m.esperado,
  'estado · envío sin repartidor · ' || m.estado || ' -> ' || m.esperado)
from (values
  (1, 'draft', '23514'), (2, 'submitted', '23514'), (3, 'received', '23514'), (4, 'accepted', '23514'),
  (5, 'preparing', '23514'), (6, 'ready', '23514'), (7, 'assigned', '23514'),
  (8, 'picked_up', 'completed_without_code'), (9, 'on_the_way', 'completed_without_code'),
  (10, 'arrived', 'completed_without_code'), (11, 'arriving', 'completed_without_code'),
  (12, 'delivered', 'already_delivered'), (13, 'cancelled', '23514'), (14, 'canceled', '23514'), (15, 'rejected', '23514')
) as m(n, estado, esperado)
order by m.n;
select is(
  pg_temp.celda_estado('o_matriz', m.estado, 'rider2'), m.esperado,
  'estado · envío con repartidor · ' || m.estado || ' -> ' || m.esperado)
from (values
  (1, 'draft', '23514'), (2, 'submitted', '23514'), (3, 'received', '23514'), (4, 'accepted', '23514'),
  (5, 'preparing', '23514'), (6, 'ready', '23514'), (7, 'assigned', '23514'),
  (8, 'picked_up', 'completed_without_code'), (9, 'on_the_way', 'completed_without_code'),
  (10, 'arrived', 'completed_without_code'), (11, 'arriving', 'completed_without_code'),
  (12, 'delivered', 'already_delivered'), (13, 'cancelled', '23514'), (14, 'canceled', '23514'), (15, 'rejected', '23514')
) as m(n, estado, esperado)
order by m.n;
select is(
  pg_temp.celda_estado('o_retiro', m.estado, null), '42501',
  'estado · retiro · ' || m.estado || ' -> 42501: este cierre es sólo para pedidos con envío')
from (values
  (1, 'draft'), (2, 'submitted'), (3, 'received'), (4, 'accepted'), (5, 'preparing'), (6, 'ready'), (7, 'assigned'),
  (8, 'picked_up'), (9, 'on_the_way'), (10, 'arrived'), (11, 'arriving'), (12, 'delivered'), (13, 'cancelled'),
  (14, 'canceled'), (15, 'rejected')
) as m(n, estado)
order by m.n;
select is(pg_temp.estado('o_matriz') || ' · ' || pg_temp.estado('o_retiro') || ' · ' || pg_temp.huella('o_matriz'),
  'ready · received · marcas=0 eventos=0 recibos=0',
  'las cuarenta y cinco celdas se deshicieron: los dos pedidos quedaron como estaban');

-- ══ 4 · LO QUE SE PIDE ══════════════════════════════════════════════════════
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'porque si', 'cdwc-motivo-0001')), '22023',
  'un motivo fuera de la lista: 22023');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', '', 'cdwc-motivo-0002')), '22023',
  'un motivo vacío: 22023');
select is(
  pg_temp.intento('owner', format($q$select public.complete_delivery_without_code(%L, %s, null, 'cdwc-motivo-0003') ->> 'outcome'$q$,
    pg_temp.id('o_propio'), pg_temp.rev(pg_temp.id('o_propio')))),
  '22023', 'un motivo NULL: 22023');
select is(
  pg_temp.intento('owner', pg_temp.cierre('o_propio', m.motivo, 'cdwc-motivo-' || m.n)), 'completed_without_code',
  'motivo de la lista cerrada · ' || m.motivo)
from (values (1, 'customer_lost_code'), (2, 'customer_without_device'), (3, 'rider_unavailable'), (4, 'code_locked'), (5, 'other')
) as m(n, motivo)
order by m.n;
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', '  Customer_Lost_Code ', 'cdwc-motivo-0010', null, null, 'reason_code')),
  'customer_lost_code', 'el motivo se normaliza (espacios y mayúsculas) y vuelve en la respuesta');
select ok(
  (select bool_and(pg_get_constraintdef(c.oid) like '%' || m.motivo || '%')
     from pg_constraint c,
          (values ('customer_lost_code'), ('customer_without_device'), ('rider_unavailable'), ('code_locked'), ('other')) m(motivo)
    where c.conname = 'order_delivery_overrides_reason_code_check'),
  'la tabla de marcas admite exactamente esa misma lista');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'other', 'cdwc-nota-0001', repeat('x', 201))), '22023',
  'una nota de 201 caracteres: 22023');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'other', 'cdwc-nota-0002', '  ' || repeat('x', 200) || '  ')),
  'completed_without_code', 'una nota de 200 caracteres (recortada) entra');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'other', 'corta')), '22023',
  'una clave de idempotencia inválida: 22023');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'other', 'cdwc-revision-0001', null, 999)), 'PT409',
  'una revisión vieja: PT409');
select is(
  pg_temp.intento('owner', format($q$select public.complete_delivery_without_code(%L, null, 'other', 'cdwc-revision-0002') ->> 'outcome'$q$,
    pg_temp.id('o_propio'))),
  'PT409', 'una revisión NULL también: PT409, no «cualquier revisión»');
select is(pg_temp.estado('o_propio') || ' · ' || pg_temp.huella('o_propio'), 'on_the_way · marcas=0 eventos=0 recibos=0',
  'ningún rechazo escribió nada');

-- ══ 5 · EL CIERRE DE LIBRO: reparto propio, efectivo, el cliente perdió el código ══
insert into textos values ('nota', 'Lo recibio Ramona Quiroga del 3B tel 2995550199');
insert into textos
select 'antes_propio', (select h.failed_attempts::text || '|' || coalesce(h.confirmed_at::text, 'null') || '|' || coalesce(h.locked_until::text, 'null')
                          from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_propio'));
insert into textos values ('rev_propio', pg_temp.rev(pg_temp.id('o_propio'))::text);
insert into textos
select 'respuesta_propio', pg_temp.intento('owner',
  format($q$select public.complete_delivery_without_code(%L, %s, 'customer_lost_code', 'cdwc-propio-0001', %L)::text$q$,
    pg_temp.id('o_propio'), pg_temp.txt('rev_propio'), '  ' || pg_temp.txt('nota') || '  '), false);

select is(
  (select jsonb_build_object('ok', r -> 'ok', 'outcome', r -> 'outcome', 'code_verified', r -> 'code_verified',
            'reason_code', r -> 'reason_code', 'idempotent_replay', r -> 'idempotent_replay', 'status', r -> 'status',
            'revision', r -> 'revision')
     from (select pg_temp.txt('respuesta_propio')::jsonb as r) x),
  jsonb_build_object('ok', true, 'outcome', 'completed_without_code', 'code_verified', false,
    'reason_code', 'customer_lost_code', 'idempotent_replay', false, 'status', 'delivered',
    'revision', pg_temp.txt('rev_propio')::bigint + 1),
  'la dueña cierra el reparto propio: entregado, sin código verificado, con la revisión siguiente');
select is(
  (select o.status || '|' || (o.delivered_at is not null)::text || '|' || (o.revision = pg_temp.txt('rev_propio')::bigint + 1)::text
     from public.orders o where o.id = pg_temp.id('o_propio')),
  'delivered|true|true', 'la fila quedó entregada, con su fecha de entrega y UNA revisión más');
select is(pg_temp.huella('o_propio'), 'marcas=1 eventos=1 recibos=1', 'una marca, un evento, un recibo');
select is(
  (select to_jsonb(ov) - 'order_id' - 'business_id' - 'created_at'
     from public.order_delivery_overrides ov where ov.order_id = pg_temp.id('o_propio')),
  jsonb_build_object('order_revision', pg_temp.txt('rev_propio')::bigint, 'reason_code', 'customer_lost_code',
    'actor_user_id', pg_temp.id('owner'), 'actor_member_role', 'owner', 'previous_status', 'on_the_way',
    'rider_assigned', false, 'code_required', true, 'handoff_state', 'active', 'failed_attempts', 0),
  'la marca dice quién, con qué rol, por qué, desde qué estado y cómo estaba el código');
select is(
  (select jsonb_build_object('actor_role', e.actor_role, 'actor_user_id', e.actor_user_id, 'metadata', e.metadata, 'payload_igual', e.payload = e.metadata)
     from public.order_events e where e.order_id = pg_temp.id('o_propio') and e.event_type = 'order.delivered_without_code'),
  jsonb_build_object('actor_role', 'business', 'actor_user_id', pg_temp.id('owner'), 'payload_igual', true,
    'metadata', jsonb_build_object('previous_status', 'on_the_way', 'delivery_mode', 'delivery', 'reason_code', 'customer_lost_code',
      'code_verified', false, 'code_required', true, 'rider_assigned', false, 'handoff_state', 'active',
      'failed_attempts', 0, 'actor_member_role', 'owner')),
  'el evento propio: motivo, code_verified false, si había repartidor y el rol; nada más');
select is(
  (select string_agg(e.event_type || ':' || e.actor_role || ':' || coalesce(e.metadata ->> 'code_verified', '-'), ' ' order by e.sequence)
     from public.order_events e
    where e.order_id = pg_temp.id('o_propio')
      and e.sequence >= (select min(s.sequence) from public.order_events s
                          where s.order_id = pg_temp.id('o_propio') and s.metadata ->> 'next_status' = 'delivered')),
  'order.status_changed:business:- order.business_self_delivery:business:false order.delivered_without_code:business:false',
  'los eventos de siempre salieron igual, y el de reparto propio dice la verdad: code_verified false');
select is(
  (select e.message from public.order_events e
    where e.order_id = pg_temp.id('o_propio') and e.event_type = 'order.business_self_delivery'),
  'Entrega cerrada por el comercio, sin repartidor y sin codigo.',
  'la historia NO dice que se cerró con el código del cliente');
select is(
  (select h.failed_attempts::text || '|' || coalesce(h.confirmed_at::text, 'null') || '|' || coalesce(h.locked_until::text, 'null')
     from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_propio')),
  pg_temp.txt('antes_propio'),
  'la fila del código no se tocó: sigue sin confirmar');
select is(
  (select o.manual_payment_status || '|' || coalesce(o.manual_payment_method, '-') || '|' || o.total::text
     from public.orders o where o.id = pg_temp.id('o_propio')),
  'pending|-|2500.00', 'el dinero no se tocó: el efectivo sigue pendiente de cobro');

-- La nota: sólo en el recibo.
select ok(
  (select r.result ->> 'operator_note' = pg_temp.txt('nota') from public.business_command_receipts r
    where r.order_id = pg_temp.id('o_propio') and r.command_type = 'complete_delivery_without_code'),
  'la nota quedó en el recibo del comando, recortada');
select ok(position('Ramona' in pg_temp.txt('respuesta_propio')) = 0, 'la respuesta del comando no la devuelve');
select ok(
  not exists (select 1 from public.order_events e where e.order_id = pg_temp.id('o_propio')
               and (e.metadata::text || e.payload::text || coalesce(e.message, '')) like '%Ramona%'),
  'ningún evento del pedido la tiene');
select ok(
  not exists (select 1 from public.order_delivery_overrides ov where ov.order_id = pg_temp.id('o_propio') and to_jsonb(ov)::text like '%Ramona%'),
  'la marca tampoco');
insert into textos
select 'traza_propio', pg_temp.intento('owner',
  format($q$select public.get_order_trace(%L, %L)::text$q$, pg_temp.id('a'), pg_temp.id('o_propio')), false);
select ok(
  pg_temp.txt('traza_propio') like '{%' and position('Ramona' in pg_temp.txt('traza_propio')) = 0
  and position('2995550199' in pg_temp.txt('traza_propio')) = 0,
  'la traza del pedido no la muestra');
select ok(
  (select position('Ramona' in t) = 0 and position('2995550199' in t) = 0 and t like '%"status": "delivered"%'
     from (select pg_temp.intento('cliente', format($q$select public.get_public_order_tracking(%L)::text$q$, pg_temp.id('o_propio')),
                    false, json_build_object('x-order-token', pg_temp.txt('token_o_propio'))::text) as t) x),
  'el seguimiento público del cliente muestra el pedido entregado y no la nota');

-- La traza le muestra el cierre al comercio.
select is(
  (select t.value -> 'details' from jsonb_array_elements(pg_temp.txt('traza_propio')::jsonb -> 'timeline') t(value)
    where t.value ->> 'event' = 'order.delivered_without_code'),
  '{"reason_code": "customer_lost_code", "code_verified": false, "delivery_mode": "delivery", "failed_attempts": 0, "previous_status": "on_the_way"}'::jsonb,
  'get_order_trace muestra order.delivered_without_code con su motivo y code_verified false');
select is(
  (select count(*)::integer from jsonb_array_elements(pg_temp.txt('traza_propio')::jsonb -> 'timeline') t(value)
    where t.value ->> 'event' = 'handoff.confirmed'),
  0, 'y NO muestra handoff.confirmed: nadie confirmó un código');
select is(
  (pg_temp.txt('traza_propio')::jsonb #> '{state,delivery_handoff}') - 'issued_at' - 'expires_at',
  '{"attempts": {}, "code_issued": true, "confirmed_at": null, "locked_until": null, "code_required": true, "failed_attempts": 0}'::jsonb,
  'el estado del código en la traza: emitido, exigido y sin confirmar');
select ok(
  (select count(*) = 1 from jsonb_array_elements(pg_temp.txt('traza_propio')::jsonb -> 'timeline') t(value)
    where t.value ->> 'event' = 'command.complete_delivery_without_code' and t.value -> 'details' = '{}'::jsonb),
  'el recibo figura como comando, sin detalle');

-- Reintentos.
select is(
  (select (pg_temp.txt('respuesta_propio')::jsonb - 'idempotent_replay') = (r - 'idempotent_replay') and r ->> 'idempotent_replay' = 'true'
     from (select pg_temp.intento('owner',
             format($q$select public.complete_delivery_without_code(%L, %s, 'customer_lost_code', 'cdwc-propio-0001', %L)::text$q$,
               pg_temp.id('o_propio'), pg_temp.txt('rev_propio'), pg_temp.txt('nota')), false)::jsonb as r) x),
  true, 'la misma clave con el mismo pedido: el recibo guardado, con idempotent_replay true y sin la nota');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'other', 'cdwc-propio-0001', pg_temp.txt('nota'), pg_temp.txt('rev_propio')::bigint), false),
  '23505', 'la misma clave con otro motivo: 23505');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'customer_lost_code', 'cdwc-propio-0001', 'otra nota', pg_temp.txt('rev_propio')::bigint), false),
  '23505', 'la misma clave con otra nota: 23505');
select is(pg_temp.intento('owner', pg_temp.cierre('o_propio', 'customer_lost_code', 'cdwc-propio-0001', pg_temp.txt('nota'), 1), false),
  '23505', 'la misma clave con otra revisión: 23505');
select is(
  pg_temp.intento('owner', format($q$select public.confirm_business_delivery_code(%L, %s, '1234', 'cdwc-propio-0001') ->> 'outcome'$q$,
    pg_temp.id('o_propio'), pg_temp.txt('rev_propio')), false),
  '23505', 'la misma clave en OTRO comando del Panel: 23505');
select is(pg_temp.intento('admin', pg_temp.cierre('o_propio', 'other', 'cdwc-propio-0002', null, 1), false),
  'already_delivered', 'doble toque con otra clave sobre el pedido ya entregado: éxito, aunque la revisión sea vieja');
select is(pg_temp.huella('o_propio'), 'marcas=1 eventos=1 recibos=1',
  'ni el reintento, ni los rechazos, ni el doble toque dejaron otra marca, otro evento u otro recibo');
select is(pg_temp.intento('staff', pg_temp.cierre('o_propio', 'other', 'cdwc-propio-0003'), false), '42501',
  'un empleado tampoco pasa por el atajo del pedido ya entregado');

-- El efectivo se sigue cobrando por su comando de siempre.
select is(
  pg_temp.intento('staff', format($q$select public.confirm_manual_order_payment(%L, %s, 'cash', 'cdwc-propio-cobro-01') ->> 'manual_payment_status'$q$,
    pg_temp.id('o_propio'), pg_temp.rev(pg_temp.id('o_propio'))), false),
  'confirmed', 'después del cierre, el efectivo se cobra con confirm_manual_order_payment');

-- ══ 6 · CON REPARTIDOR EN LA PUERTA Y EL CÓDIGO BLOQUEADO ═══════════════════
-- El repartidor prueba cinco códigos equivocados: el quinto bloquea.
select pg_temp.como('rider');
select public.publish_rider_location_receipt(pg_temp.id('o_bloq'), pg_temp.rev(pg_temp.id('o_bloq')), -38.9516, -68.0591, 12,
  null, null, clock_timestamp(), 'cdwc-bloq-ubicacion-01', false);
select public.confirm_delivery_code(pg_temp.id('o_bloq'), pg_temp.rev(pg_temp.id('o_bloq')), '0000', 'cdwc-bloq-intento-' || n)
  from generate_series(1, 5) n;
select pg_temp.nadie();
select is(
  (select h.failed_attempts::text || '|' || (h.locked_until > clock_timestamp())::text
     from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_bloq')),
  '5|true', 'control: cinco intentos fallidos y el código bloqueado');
insert into textos
select 'antes_bloq', (select h.failed_attempts::text || '|' || h.locked_until::text || '|' || h.expires_at::text || '|' || coalesce(h.confirmed_at::text, 'null')
                        from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_bloq'));
insert into textos
select 'intentos_bloq', (select count(*)::text from public.delivery_confirmation_attempts t where t.order_id = pg_temp.id('o_bloq'));
select is(
  (select public.count_rider_active_orders(pg_temp.id('a'), pg_temp.id('rider'), null)), 3,
  'control: el repartidor lleva tres entregas activas, el máximo');
select is(
  (select count(*)::integer from public.rider_locations l where l.order_id = pg_temp.id('o_bloq')), 1,
  'control: hay una ubicación del repartidor guardada para este pedido');

select is(
  pg_temp.intento('admin', format($q$select public.confirm_business_delivery_code(%L, %s, '0000', 'cdwc-bloq-hermano-01') #>> '{}'$q$,
    pg_temp.id('o_bloq'), pg_temp.rev(pg_temp.id('o_bloq')))),
  '42501', 'control: el cierre con código del comercio sigue negándose con repartidor asignado');
select is(pg_temp.intento('admin', pg_temp.cierre('o_bloq', 'code_locked', 'cdwc-bloq-0001'), false), 'completed_without_code',
  'el encargado cierra la entrega aunque el código esté bloqueado');
select is(
  (select h.failed_attempts::text || '|' || h.locked_until::text || '|' || h.expires_at::text || '|' || coalesce(h.confirmed_at::text, 'null')
     from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_bloq')),
  pg_temp.txt('antes_bloq'), 'los intentos fallidos y el bloqueo quedan como estaban: no se resetean ni se confirma nada');
select is(
  (select count(*)::text from public.delivery_confirmation_attempts t where t.order_id = pg_temp.id('o_bloq')),
  pg_temp.txt('intentos_bloq'), 'el historial de intentos conserva sus filas y no gana ninguna');
select is(
  (select to_jsonb(ov) - 'order_id' - 'business_id' - 'created_at' - 'order_revision'
     from public.order_delivery_overrides ov where ov.order_id = pg_temp.id('o_bloq')),
  jsonb_build_object('reason_code', 'code_locked', 'actor_user_id', pg_temp.id('admin'), 'actor_member_role', 'admin',
    'previous_status', 'arrived', 'rider_assigned', true, 'code_required', true, 'handoff_state', 'locked', 'failed_attempts', 5),
  'la marca: encargado, desde la puerta, con repartidor, código bloqueado tras cinco intentos');
select is(
  (select e.metadata ->> 'rider_assigned' || '|' || (e.metadata ->> 'handoff_state') || '|' || (e.metadata ->> 'failed_attempts')
          || '|' || (e.metadata::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-')::text
     from public.order_events e where e.order_id = pg_temp.id('o_bloq') and e.event_type = 'order.delivered_without_code'),
  'true|locked|5|false', 'el evento dice que había repartidor y no lleva el id de nadie');
select is(
  (select count(*)::integer from public.order_events e
    where e.order_id = pg_temp.id('o_bloq') and e.event_type = 'order.business_self_delivery'),
  0, 'con repartidor asignado no se escribe el evento de reparto propio');
select is(
  (select public.count_rider_active_orders(pg_temp.id('a'), pg_temp.id('rider'), null)), 2,
  'el repartidor recupera su lugar: dos entregas activas');
select is(
  (select count(*)::integer from public.rider_locations l where l.order_id = pg_temp.id('o_bloq')), 0,
  'sus ubicaciones de este pedido se borraron, como en cualquier entrega');
select ok(
  (select bool_and(t.terminal_visible_until is not null and t.terminal_visible_until > clock_timestamp())
     from public.order_public_tokens t where t.order_id = pg_temp.id('o_bloq') and t.revoked_at is null),
  'el seguimiento del cliente quedó con su ventana de pedido terminado');
select is(
  (select count(*)::integer from public.delivery_outbox x where x.order_id = pg_temp.id('o_bloq')), 0,
  'no se encola un «delivery_confirmed»: ese aviso es del código confirmado');
select is(
  pg_temp.intento('rider', format($q$select public.confirm_delivery_code(%L, %s, '0000', 'cdwc-bloq-tarde-0001') ->> 'code'$q$,
    pg_temp.id('o_bloq'), pg_temp.rev(pg_temp.id('o_bloq')) - 1), false),
  'stale_revision', 'el repartidor que insiste después se entera de que el pedido cambió; no entrega dos veces');
select is(pg_temp.estado('o_bloq') || ' · ' || pg_temp.huella('o_bloq'), 'delivered · marcas=1 eventos=1 recibos=1',
  'un cierre, una marca, un evento, un recibo');

-- ══ 7 · EL REPARTIDOR YA NO PUEDE ACTUAR ════════════════════════════════════
select pg_temp.como('owner');
select public.identity_set_member_active(pg_temp.id('a'), pg_temp.id('rider2'), false, 'baja de prueba');
select pg_temp.nadie();
select is(
  pg_temp.intento('rider2', format($q$select public.start_rider_delivery(%L, %s, 'cdwc-baja-camino-0001') ->> 'code'$q$,
    pg_temp.id('o_baja'), pg_temp.rev(pg_temp.id('o_baja')))),
  '42501', 'control: el repartidor dado de baja ya no puede mover su pedido');
select is(pg_temp.intento('owner', pg_temp.cierre('o_baja', 'rider_unavailable', 'cdwc-baja-0001'), false), 'completed_without_code',
  'la dueña cierra el pedido que ese repartidor había retirado');
select is(
  (select ov.previous_status || '|' || ov.rider_assigned::text || '|' || ov.reason_code
     from public.order_delivery_overrides ov where ov.order_id = pg_temp.id('o_baja')),
  'picked_up|true|rider_unavailable', 'desde picked_up, con repartidor, por repartidor no disponible');

-- ══ 8 · MERCADO PAGO: el código nunca se emitió ═════════════════════════════
select is(
  (select o.payment_method || '|' || o.delivery_code_required::text || '|' ||
          (select count(*) from public.order_delivery_handoffs h where h.order_id = o.id)::text
     from public.orders o where o.id = pg_temp.id('o_mp')),
  'mercadopago|true|0', 'control: un pedido pagado por Mercado Pago exige código y no tiene ninguno emitido');
-- Los demás resguardos del mismo UPDATE siguen cortando. Con el pago ya devuelto el
-- pedido admite sólo la cancelación: el cierre sin código no lo saltea. La celda
-- deja el cobro como devuelto, intenta y se deshace entera.
create function pg_temp.celda_pago_devuelto() returns text language plpgsql as $$
declare
  v_out text;
begin
  begin
    update public.payment_intents set internal_status = 'refunded', refunded_amount = paid_amount
     where id = pg_temp.id('mp_intent');
    v_out := pg_temp.intento('owner', pg_temp.cierre('o_mp', 'other', 'cdwc-mp-devuelto-01'), false);
    raise exception using errcode = 'WP110', message = 'deshacer la celda';
  exception when sqlstate 'WP110' then null;
  end;
  return v_out;
end;
$$;
select is(pg_temp.celda_pago_devuelto(), '55000',
  'con el pago de Mercado Pago ya devuelto el cierre sin código falla con 55000, igual que cualquier otra entrega');
select is(pg_temp.estado('o_mp') || ' · ' || pg_temp.huella('o_mp'), 'on_the_way · marcas=0 eventos=0 recibos=0',
  'y no dejó nada: el pedido sigue en camino');
insert into textos
select 'pago_antes', (select to_jsonb(pi)::text from public.payment_intents pi where pi.id = pg_temp.id('mp_intent'));
select is(pg_temp.intento('admin', pg_temp.cierre('o_mp', 'customer_without_device', 'cdwc-mp-0001'), false), 'completed_without_code',
  'el encargado lo cierra igual');
select is(
  (select count(*)::integer from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_mp')), 0,
  'y NO se inventa una fila de código para un código que nunca existió');
select is(
  (select ov.handoff_state || '|' || ov.failed_attempts::text from public.order_delivery_overrides ov where ov.order_id = pg_temp.id('o_mp')),
  'not_issued|0', 'la marca lo dice: el código no estaba emitido');
select is(
  (select to_jsonb(pi)::text from public.payment_intents pi where pi.id = pg_temp.id('mp_intent')),
  pg_temp.txt('pago_antes'), 'el cobro de Mercado Pago no cambió en nada');
select is(
  (select count(*)::integer from public.payment_refunds r where r.payment_intent_id = pg_temp.id('mp_intent'))
  + (select count(*)::integer from public.payment_outbox o where o.payment_intent_id = pg_temp.id('mp_intent') and o.created_at >= transaction_timestamp()
        and o.topic in ('refund_reconcile', 'cancellation_reconcile')),
  0, 'ni un reembolso ni un trabajo de reembolso');
select is(
  (select t #>> '{state,delivery_handoff,code_issued}' || '|' || (t #>> '{state,order,status}') || '|' ||
          (select count(*) from jsonb_array_elements(t -> 'timeline') e(value) where e.value ->> 'event' = 'handoff.code_issued')::text
     from (select pg_temp.intento('owner', format($q$select public.get_order_trace(%L, %L)::text$q$, pg_temp.id('a'), pg_temp.id('o_mp')), false)::jsonb as t) x),
  'false|delivered|0', 'la traza sigue diciendo la verdad: entregado y sin código emitido');
select is(
  pg_temp.intento('anon', format($q$select public.checkout_session_customer_payload(%L, %L) ->> 'delivery_code'$q$,
    pg_temp.id('mp_session'), pg_temp.id('cliente'))),
  '42501', 'control: la pantalla de pago del cliente no es una puerta de anon');
select lives_ok(
  format($q$select public.checkout_session_customer_payload(%L, %L)$q$, pg_temp.id('mp_session'), pg_temp.id('cliente')),
  'y la pantalla de pago del cliente sigue respondiendo después del cierre');

-- ══ 9 · CÓDIGO VENCIDO, Y PEDIDO QUE NO EXIGE CÓDIGO ════════════════════════
update public.order_delivery_handoffs
   set created_at = clock_timestamp() - interval '3 days', expires_at = clock_timestamp() - interval '1 day'
 where order_id = pg_temp.id('o_vencido');
select is(
  pg_temp.intento('owner', format($q$select public.confirm_business_delivery_code(%L, %s, '1234', 'cdwc-vencido-hermano') ->> 'code'$q$,
    pg_temp.id('o_vencido'), pg_temp.rev(pg_temp.id('o_vencido')))),
  'code_unavailable', 'control: con el código vencido el cierre de siempre no tiene salida');
select is(pg_temp.intento('owner', pg_temp.cierre('o_vencido', 'customer_lost_code', 'cdwc-vencido-0001'), false), 'completed_without_code',
  'la dueña lo cierra');
select is(
  (select ov.handoff_state from public.order_delivery_overrides ov where ov.order_id = pg_temp.id('o_vencido')),
  'expired', 'la marca dice que el código estaba vencido');

update public.orders set delivery_code_required = false where id = pg_temp.id('o_libre');
select is(pg_temp.intento('owner', pg_temp.cierre('o_libre', 'other', 'cdwc-libre-0001', null, null, 'code_verified'), false), 'false',
  'un pedido que no exige código también se cierra por acá, y la respuesta no dice que se verificó');
select is(
  (select ov.code_required::text || '|' || ov.reason_code || '|' ||
          (select e.metadata ->> 'code_required' from public.order_events e
            where e.order_id = ov.order_id and e.event_type = 'order.delivered_without_code')
     from public.order_delivery_overrides ov where ov.order_id = pg_temp.id('o_libre')),
  'false|other|false', 'y deja igual su marca y su evento, con el motivo');

-- ══ 10 · EL CÓDIGO SIGUE VALIENDO LO MISMO ══════════════════════════════════
-- Reparto propio con el código del cliente.
insert into textos
select 'codigo_o_codigo', pg_temp.intento('cliente',
  format($q$select public.issue_order_delivery_code(%L, %L) ->> 'delivery_code'$q$, pg_temp.id('o_codigo'), pg_temp.txt('token_o_codigo')), false);
select ok(pg_temp.txt('codigo_o_codigo') ~ '^[0-9]{4}$', 'control: el cliente lee su código de cuatro dígitos');
select is(
  pg_temp.intento('staff', format($q$select public.confirm_business_delivery_code(%L, %s, %L, 'cdwc-codigo-mal-0001') ->> 'code'$q$,
    pg_temp.id('o_codigo'), pg_temp.rev(pg_temp.id('o_codigo')),
    case when pg_temp.txt('codigo_o_codigo') = '1000' then '1001' else '1000' end), false),
  'incorrect_code', 'un código equivocado sigue sin entregar nada');
select is(pg_temp.estado('o_codigo'), 'on_the_way', 'el pedido sigue en camino');
select is(
  pg_temp.intento('staff', format($q$select (public.confirm_business_delivery_code(%L, %s, %L, 'cdwc-codigo-bien-001') ->> 'outcome')
      || '|' || (public.confirm_business_delivery_code(%L, %s, %L, 'cdwc-codigo-bien-001') ->> 'code_verified')$q$,
    pg_temp.id('o_codigo'), pg_temp.rev(pg_temp.id('o_codigo')), pg_temp.txt('codigo_o_codigo'),
    pg_temp.id('o_codigo'), pg_temp.rev(pg_temp.id('o_codigo')), pg_temp.txt('codigo_o_codigo')), false),
  'confirmed|true', 'el empleado cierra con el código bueno, como siempre: code_verified true');
select is(
  (select (h.confirmed_at is not null)::text || '|' ||
          (select e.metadata ->> 'code_verified' from public.order_events e
            where e.order_id = h.order_id and e.event_type = 'order.business_self_delivery') || '|' || pg_temp.huella('o_codigo')
     from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_codigo')),
  'true|true|marcas=0 eventos=0 recibos=0',
  'ese cierre sí confirma el código, lo dice en la historia y no deja ninguna marca de cierre sin código');

-- El repartidor con el código del cliente.
insert into textos
select 'codigo_o_rcodigo', pg_temp.intento('cliente',
  format($q$select public.issue_order_delivery_code(%L, %L) ->> 'delivery_code'$q$, pg_temp.id('o_rcodigo'), pg_temp.txt('token_o_rcodigo')), false);
select is(
  pg_temp.intento('rider', format($q$select public.confirm_delivery_code(%L, %s, %L, 'cdwc-rcodigo-mal-001') ->> 'code'$q$,
    pg_temp.id('o_rcodigo'), pg_temp.rev(pg_temp.id('o_rcodigo')),
    case when pg_temp.txt('codigo_o_rcodigo') = '1000' then '1001' else '1000' end), false),
  'incorrect_code', 'el repartidor con un código equivocado: no entrega');
select is(
  pg_temp.intento('rider', format($q$select public.confirm_delivery_code(%L, %s, %L, 'cdwc-rcodigo-bien-01') ->> 'outcome'$q$,
    pg_temp.id('o_rcodigo'), pg_temp.rev(pg_temp.id('o_rcodigo')), pg_temp.txt('codigo_o_rcodigo')), false),
  'confirmed', 'el repartidor con el código bueno: entrega, como siempre');
select is(pg_temp.estado('o_rcodigo') || ' · ' || pg_temp.huella('o_rcodigo'), 'delivered · marcas=0 eventos=0 recibos=0',
  'sin ninguna marca de cierre sin código');

-- ══ 11 · EL RESGUARDO SIGUE CORTANDO ════════════════════════════════════════
select throws_ok(
  format($q$update public.orders set status = 'delivered' where id = %L$q$, pg_temp.id('o_guard')),
  '55000', 'codigo de entrega no confirmado',
  'un UPDATE directo a delivered, sin código confirmado y sin marca, sigue fallando');
select pg_temp.como('owner');
select set_config('taba.delivery_code_confirmed', 'true', true);
select throws_ok(
  format($q$update public.orders set status = 'delivered' where id = %L$q$, pg_temp.id('o_guard')),
  '55000', 'codigo de entrega no confirmado',
  'ni con el pase de transacción encendido y la sesión de la dueña: sin marca no pasa');
select set_config('taba.delivery_code_confirmed', '', true);
select pg_temp.nadie();
-- Una marca de OTRA revisión no le sirve de pase a nadie.
insert into public.order_delivery_overrides (order_id, order_revision, business_id, reason_code, actor_user_id, actor_member_role,
  previous_status, rider_assigned, code_required, handoff_state, failed_attempts)
values (pg_temp.id('o_guard'), pg_temp.rev(pg_temp.id('o_guard')) + 7, pg_temp.id('a'), 'other', pg_temp.id('owner'), 'owner',
  'on_the_way', false, true, 'active', 0);
select throws_ok(
  format($q$update public.orders set status = 'delivered' where id = %L$q$, pg_temp.id('o_guard')),
  '55000', 'codigo de entrega no confirmado',
  'una marca anotada para otra revisión del pedido no habilita la entrega');
select is(pg_temp.estado('o_guard'), 'on_the_way', 'el pedido sigue en camino');
-- La marca de la revisión exacta sí, y es lo único que la función escribe antes del UPDATE.
update public.order_delivery_overrides set order_revision = pg_temp.rev(pg_temp.id('o_guard')) where order_id = pg_temp.id('o_guard');
select lives_ok(
  format($q$update public.orders set status = 'delivered' where id = %L$q$, pg_temp.id('o_guard')),
  'con la marca de esa revisión exacta el resguardo deja pasar: es el único pase nuevo');
select throws_ok(
  $q$insert into public.order_delivery_overrides (order_id, order_revision, business_id, reason_code, actor_member_role,
       previous_status, rider_assigned, code_required, handoff_state)
     values (pg_temp.id('o_guard'), 999, pg_temp.id('a'), 'porque si', 'owner', 'on_the_way', false, true, 'active')$q$,
  '23514', null, 'la tabla rechaza un motivo fuera de la lista');
select throws_ok(
  $q$insert into public.order_delivery_overrides (order_id, order_revision, business_id, reason_code, actor_member_role,
       previous_status, rider_assigned, code_required, handoff_state)
     values (pg_temp.id('o_guard'), 999, pg_temp.id('a'), 'other', 'staff', 'on_the_way', false, true, 'active')$q$,
  '23514', null, 'y un rol que no es dueño ni encargado');

-- Lo que el COMMIT de todos estos cierres habría verificado.
select lives_ok('set constraints all immediate', 'los disparadores diferidos de los pedidos cerrados pasan');

select * from finish();
rollback;
