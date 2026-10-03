-- TABA · LA TRAZA DE UN PEDIDO
--
-- Diagnosticar un pedido pedía la clave de servicio y unir a mano unas quince
-- tablas con datos personales. Acá se prueba `get_order_trace` y su variante de
-- soporte sobre CUATRO historias reales, construidas por las mismas funciones
-- que usa la tienda (ninguna fila de pedido se inserta a mano):
--
--   A  pedido en efectivo con envío, de punta a punta: aceptado, armado, cobrado,
--      ofrecido a un repartidor que lo rechaza y a otro que lo acepta, retirado,
--      en camino, incidencia, llegada, un código de entrega equivocado y el bueno;
--   B  pedido pagado por Mercado Pago (checkout, reserva, preferencia, aviso
--      firmado, pago aprobado, pedido);
--   C  pedido en efectivo que el empleado acepta y la dueña cancela con un motivo
--      escrito a mano (cancelar pide el permiso `orders.cancel`);
--   D  checkout que vence sin pagar: la reserva se libera y no hay pedido.
--
-- Se comprueba: que cualquier identificador llega al mismo documento, que la
-- línea de tiempo tiene todas las etapas y está ordenada, que el estado actual
-- es el de las tablas, que NINGÚN dato personal del fixture aparece en el texto
-- del documento, que otro negocio recibe lo mismo que por una referencia que no
-- existe, quién puede llamar a cada puerta, y los topes.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table trace_ids (name text primary key, value text not null) on commit drop;
create temporary table trace_docs (name text primary key, doc jsonb not null) on commit drop;

create function pg_temp.as_user(p_user uuid, p_session uuid default null) returns void language sql as $$
  select set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_user, 'role', 'authenticated')
      || case when p_session is null then '{}'::jsonb else jsonb_build_object('session_id', p_session) end)::text, true)::void;
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select value::uuid from trace_ids where name = p_name $$;
create function pg_temp.val(p_name text) returns text language sql as $$ select value from trace_ids where name = p_name $$;
create function pg_temp.rev(p_order uuid) returns bigint language sql as $$ select revision from public.orders where id = p_order $$;
create function pg_temp.doc(p_name text) returns jsonb language sql as $$ select doc from trace_docs where name = p_name $$;

-- La puerta del negocio vista por una persona: devuelve el documento o el SQLSTATE.
create function pg_temp.trace_as(p_user text, p_session uuid, p_business text, p_reference text)
returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
  perform pg_temp.as_user(pg_temp.id(p_user), p_session);
  begin
    v_result := public.get_order_trace(pg_temp.id(p_business), p_reference);
  exception when others then
    v_result := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end;
$$;

-- Los eventos de la línea de tiempo, en orden.
create function pg_temp.events(p_doc jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e.value ->> 'event' order by e.position), '{}'::text[])
    from jsonb_array_elements(p_doc -> 'timeline') with ordinality as e(value, position);
$$;
create function pg_temp.entry(p_doc jsonb, p_event text) returns jsonb language sql as $$
  select e.value from jsonb_array_elements(p_doc -> 'timeline') with ordinality as e(value, position)
   where e.value ->> 'event' = p_event order by e.position limit 1;
$$;

do $fixture$
declare
  v_business uuid := 'b9000000-0000-4000-8000-0000000000a1';
  v_other uuid := 'b9000000-0000-4000-8000-0000000000a2';
  v_product uuid := 'c9000000-0000-4000-8000-0000000000a1';
  v_owner uuid := 'a9000000-0000-4000-8000-000000000001';
  v_staff uuid := 'a9000000-0000-4000-8000-000000000002';
  v_rider1 uuid := 'a9000000-0000-4000-8000-000000000003';
  v_rider2 uuid := 'a9000000-0000-4000-8000-000000000004';
  v_customer uuid := 'a9000000-0000-4000-8000-000000000005';
  v_other_owner uuid := 'a9000000-0000-4000-8000-000000000006';
  v_customer2 uuid := 'a9000000-0000-4000-8000-000000000007';
  v_staff_session uuid := 'e9000000-0000-4000-8000-000000000002';
  v_address uuid;
  v_res jsonb; v_order uuid; v_offer uuid; v_session uuid; v_intent uuid; v_prepare jsonb;
  v_token text := 'tok_TRAZA_' || repeat('Zx9', 12);
  v_token2 text := 'tok_ROTADO_' || repeat('Qw7', 12);
  v_delivery_code text; v_receipt uuid; v_order_b uuid; v_order_c uuid; v_expired uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (v_owner,'authenticated','authenticated','traza-owner@example.invalid','',now(),'{}','{"display_name":"Duena Traza"}',now(),now()),
    (v_staff,'authenticated','authenticated','traza-staff@example.invalid','',now(),'{}','{"display_name":"Staff Traza"}',now(),now()),
    (v_rider1,'authenticated','authenticated','traza-rider1@example.invalid','',now(),'{}','{"display_name":"Rider Uno"}',now(),now()),
    (v_rider2,'authenticated','authenticated','traza-rider2@example.invalid','',now(),'{}','{"display_name":"Rider Dos"}',now(),now()),
    (v_customer,'authenticated','authenticated','traza-cliente-pii@example.invalid','',now(),'{}','{}',now(),now()),
    (v_other_owner,'authenticated','authenticated','traza-ajeno@example.invalid','',now(),'{}','{}',now(),now()),
    (v_customer2,'authenticated','authenticated','traza-cliente-dos@example.invalid','',now(),'{}','{}',now(),now());

  insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal)
  values
    (v_business, 'TABA traza', 'taba-traza', 'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, true, 1500.00, 0.00),
    (v_other, 'TABA ajeno', 'taba-traza-ajeno', 'open', true, true, true, clock_timestamp(), v_other_owner, 'ARS', true, false, 0.00, 0.00);
  insert into public.business_members (business_id, user_id, role, is_active) values
    (v_business, v_owner, 'owner', true), (v_business, v_staff, 'staff', true),
    (v_business, v_rider1, 'rider', true), (v_business, v_rider2, 'rider', true),
    (v_other, v_other_owner, 'owner', true);
  insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
    ('e9000000-0000-4000-8000-000000000001', v_owner, v_business, 'owner', 'panel_web'),
    (v_staff_session, v_staff, v_business, 'staff', 'panel_web'),
    ('e9000000-0000-4000-8000-000000000003', v_rider1, v_business, 'rider', 'rider_android'),
    ('e9000000-0000-4000-8000-000000000004', v_rider2, v_business, 'rider', 'rider_android'),
    ('e9000000-0000-4000-8000-000000000006', v_other_owner, v_other, 'owner', 'panel_web');

  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata Traza','Gaseosas','Cola',12345,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    50,true,true,false,'{}',true,now(),v_owner,'traza-sku','traza-sku','commercial',1);
  insert into public.business_payment_settings (business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at)
  values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-traza', 'app-traza', clock_timestamp(), clock_timestamp());
  -- El vendedor conectado por OAuth: sin él la autoridad V2 no deja asentar la preferencia.
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business, 'test', 'collector-traza', 'app-traza', 'connected', 'ciphertext-only-local-fixture', now() + interval '2 days');
  insert into public.local_devices(id, business_id, device_name, status, secret_hash)
  -- Hash propio de esta prueba: es único en la tabla y la base del gate ya trae uno con repeat('a', 64).
  values ('f9000000-0000-4000-8000-000000000001', v_business, 'Caja traza', 'active',
    encode(digest('order-trace-test:caja-traza', 'sha256'), 'hex'));
  insert into public.business_print_settings(business_id, auto_print_enabled, kitchen_ticket_on, order_ticket_on)
  values (v_business, true, 'accepted', 'submitted');

  insert into trace_ids values ('business', v_business), ('other', v_other), ('product', v_product), ('owner', v_owner),
    ('staff', v_staff), ('rider1', v_rider1), ('rider2', v_rider2), ('customer', v_customer), ('other_owner', v_other_owner),
    ('customer2', v_customer2), ('token', v_token), ('token2', v_token2);

  -- ── A · efectivo con envío, de punta a punta ──────────────────────────────
  perform pg_temp.as_user(v_customer);
  perform public.upsert_current_customer_profile('Zulema Pii Traza', '2996209137');
  v_address := (public.upsert_current_customer_address(jsonb_build_object(
    'label','Casa','street','Calle Secreta Traza','streetNumber','4321','city','Neuquen','neighborhood','Barrio Reservado',
    'reference','Porton verde con campana',
    'latitude',-38.951673,'longitude',-68.059127,'geolocationAccuracy',10,'source','gps',
    'locationSource','map_pin','locationConfirmedAt',clock_timestamp(),'isDefault',true)) -> 'address' ->> 'id')::uuid;
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.77"}', true);
  v_res := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'traza-manual-0001',
    'tracking_token', v_token,
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'customer_name', 'Zulema Pii Traza', 'customer_phone', '2996209137',
    'customer_notes', 'Tocar timbre tres veces nota privada',
    'delivery_mode', 'delivery', 'payment_method', 'cash',
    'customer_address_id', v_address));
  perform set_config('request.headers', '', true);
  v_order := (v_res ->> 'id')::uuid;
  insert into trace_ids values ('order_a', v_order);

  perform pg_temp.as_user(v_staff, v_staff_session);
  perform public.transition_order(v_order, pg_temp.rev(v_order), 'accepted', 'traza-aceptar-01');
  perform public.transition_order(v_order, pg_temp.rev(v_order), 'preparing', 'traza-preparar-01');
  perform public.start_packing_session(v_order, pg_temp.rev(v_order), 'traza-packing-01');
  perform public.confirm_manual_order_payment(v_order, pg_temp.rev(v_order), 'cash', 'traza-cobro-0001');
  perform public.transition_order(v_order, pg_temp.rev(v_order), 'ready', 'traza-listo-0001');

  perform public.offer_order_to_rider(v_order, 'ready', null, v_rider1);
  select id into v_offer from public.rider_order_offers where order_id = v_order and status = 'pending';
  perform pg_temp.as_user(v_rider1, 'e9000000-0000-4000-8000-000000000003');
  perform public.reject_rider_order_offer(v_offer, 1, 'too_far', 'traza-rechazo-01');
  perform pg_temp.as_user(v_staff, v_staff_session);
  perform public.offer_order_to_rider(v_order, 'ready', null, v_rider2);
  select id into v_offer from public.rider_order_offers where order_id = v_order and status = 'pending';
  perform pg_temp.as_user(v_rider2, 'e9000000-0000-4000-8000-000000000004');
  perform public.accept_rider_order_offer(v_offer, 1, 'traza-acepta-001');
  perform public.mark_delivery_picked_up(v_order, pg_temp.rev(v_order), 'traza-retiro-001');
  perform public.start_rider_delivery(v_order, pg_temp.rev(v_order), 'traza-camino-001');
  perform public.report_rider_delivery_issue(v_order, pg_temp.rev(v_order), 'customer_unavailable', 'traza-incid-0001');
  perform public.mark_rider_arrived(v_order, pg_temp.rev(v_order), 'traza-llego-0001');

  perform pg_temp.as_user(v_customer);
  v_res := public.recover_order_tracking_access(v_order, v_token2);
  v_delivery_code := v_res ->> 'delivery_code';
  insert into trace_ids values ('delivery_code', v_delivery_code);
  perform pg_temp.as_user(v_rider2, 'e9000000-0000-4000-8000-000000000004');
  perform public.confirm_delivery_code(v_order, pg_temp.rev(v_order),
    case when v_delivery_code = '1000' then '1001' else '1000' end, 'traza-codmal-001');
  perform public.confirm_delivery_code(v_order, pg_temp.rev(v_order), v_delivery_code, 'traza-codbien-01');

  -- ── B · pagado por Mercado Pago, retiro ───────────────────────────────────
  v_res := public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'TRAZA-CLIENTE-KEY-0002',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 3)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Zulema Pii Traza', 'phone', '5492996209137'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_res ->> 'checkout_session_id')::uuid;
  -- Mismo camino que la función Edge: prepara y asienta por V2, con la autoridad leída en el momento.
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  perform public.record_mercadopago_preference_created_v2(
    v_business, 'test', v_session, v_customer, (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer,
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-TRAZA-0002', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=traza',
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=traza',
    encode(gen_random_bytes(32), 'hex'), 'req-traza-0002');
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  v_res := public.record_mercadopago_webhook_receipt('test', 'evt-traza-0002', 'payment', '77700012345', true, 'rq-traza-0002', repeat('d', 64));
  v_receipt := (v_res ->> 'receipt_id')::uuid;
  perform public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', '77700012345',
      'external_reference', 'taba2:checkout:' || v_session::text,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-TRAZA', 'collector_id', ps.collector_id, 'currency', 'ARS',
      'transaction_amount', cs.total::text, 'status', 'approved',
      'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
      'payer_email_hash', encode(digest('traza-cliente-pii@example.invalid', 'sha256'), 'hex'),
      'raw_response_hash', encode(gen_random_bytes(32), 'hex'))
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
    where pi.id = v_intent), 'webhook', v_receipt);
  v_res := public.finalize_paid_checkout_session(v_session);
  v_order_b := (v_res ->> 'order_id')::uuid;
  insert into trace_ids values ('session_b', v_session), ('intent_b', v_intent), ('order_b', v_order_b), ('receipt_b', v_receipt),
    ('attempt_b', v_prepare ->> 'payment_attempt_id');

  -- ── C · efectivo, cancelado por el local con un motivo escrito a mano ─────
  perform pg_temp.as_user(v_customer);
  v_res := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'traza-manual-0003',
    'tracking_token', 'tok_CANCELADO_' || repeat('Lm4', 12),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 4)),
    'customer_name', 'Zulema Pii Traza', 'customer_phone', '2996209137',
    'delivery_mode', 'pickup', 'payment_method', 'cash'));
  v_order_c := (v_res ->> 'id')::uuid;
  perform pg_temp.as_user(v_staff, v_staff_session);
  perform public.transition_order(v_order_c, pg_temp.rev(v_order_c), 'accepted', 'traza-aceptar-c1');
  -- Cancela la dueña: cancelar pide el permiso `orders.cancel`, que el empleado no tiene.
  perform pg_temp.as_user(v_owner, 'e9000000-0000-4000-8000-000000000001');
  perform public.cancel_order(v_order_c, pg_temp.rev(v_order_c), 'El cliente Zulema llamo para cancelar', 'traza-cancel-001');
  insert into trace_ids values ('order_c', v_order_c);

  -- ── D · checkout que vence sin pagar ──────────────────────────────────────
  v_res := public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'TRAZA-CLIENTE-KEY-0004',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Zulema Pii Traza', 'phone', '5492996209137'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_expired := (v_res ->> 'checkout_session_id')::uuid;
  update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' where id = v_expired;
  update public.inventory_reservations set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' where checkout_session_id = v_expired;
  perform public.sweep_expired_checkout_sessions();
  insert into trace_ids values ('session_d', v_expired);

  -- ── Otro cliente usa LA MISMA clave de checkout que B: la clave sola es ambigua ──
  v_res := public.create_checkout_session(v_customer2, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'TRAZA-CLIENTE-KEY-0002',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Otro Cliente Dos', 'phone', '5492994000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
  insert into trace_ids values ('session_twin', v_res ->> 'checkout_session_id');

  -- ── Avisos de un pago que ningún checkout registró (firmas rechazadas) ────
  perform public.record_mercadopago_webhook_receipt('test', 'evt-huerfano-1', 'payment', '55500099911', false, 'rq-huerfano-1', repeat('e', 64));
  perform public.record_mercadopago_webhook_receipt('test', 'evt-huerfano-2', 'payment', '55500099911', true, 'rq-huerfano-2', repeat('f', 64));

  perform set_config('request.jwt.claims', '', true);
end
$fixture$;

insert into trace_ids
select 'code_' || x.k, o.public_code from (values ('a', 'order_a'), ('b', 'order_b'), ('c', 'order_c')) x(k, name)
  join public.orders o on o.id = pg_temp.id(x.name);
insert into trace_ids
select 'token_id_a', t.id::text from public.order_public_tokens t where t.order_id = pg_temp.id('order_a') limit 1;
insert into trace_ids
select 'correlation_' || x.k, o.correlation_id::text from (values ('a', 'order_a'), ('b', 'order_b')) x(k, name)
  join public.orders o on o.id = pg_temp.id(x.name);

insert into trace_docs values
  ('a', public.get_order_trace_service(pg_temp.val('order_a'))),
  ('b', public.get_order_trace_service(pg_temp.val('order_b'))),
  ('c', public.get_order_trace_service(pg_temp.val('order_c'))),
  ('d', public.get_order_trace_service(pg_temp.val('session_d'))),
  ('missing', pg_temp.trace_as('owner', 'e9000000-0000-4000-8000-000000000001', 'business', 'referencia-que-no-existe')),
  ('owner_a', pg_temp.trace_as('owner', 'e9000000-0000-4000-8000-000000000001', 'business', pg_temp.val('code_a'))),
  ('staff_b', pg_temp.trace_as('staff', 'e9000000-0000-4000-8000-000000000002', 'business', pg_temp.val('code_b'))),
  ('orphan', public.get_order_trace_service('55500099911'));

-- ── 1 · Quién puede llamar a cada puerta ───────────────────────────────────
select ok(
  has_function_privilege('authenticated', 'public.get_order_trace(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.get_order_trace(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'public.get_order_trace(uuid,text)', 'execute'),
  'get_order_trace: sólo authenticated (la puerta del negocio exige un miembro)');
select ok(
  has_function_privilege('service_role', 'public.get_order_trace_service(text,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_order_trace_service(text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_order_trace_service(text,uuid)', 'execute'),
  'get_order_trace_service: sólo service_role');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'order_trace%'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'las piezas privadas de la traza no las ejecuta ningún rol de la API');
select is(
  (select array_agg(p.proname::text || ':' || p.provolatile::text || ':' || p.prosecdef::text order by p.proname)
     from pg_proc p where p.oid in ('public.get_order_trace(uuid,text)'::regprocedure,
                                    'public.get_order_trace_service(text,uuid)'::regprocedure)),
  array['get_order_trace:s:true', 'get_order_trace_service:s:true'],
  'las dos puertas son de sólo lectura (STABLE) y SECURITY DEFINER');
select ok(
  (select bool_and(p.proconfig::text like '%search_path=pg_catalog%') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and p.proname in ('get_order_trace', 'get_order_trace_service'))
      or (n.nspname = 'private' and p.proname like 'order_trace%')),
  'todas fijan su search_path');

select is(pg_temp.doc('owner_a') ->> 'found', 'true', 'la dueña traza un pedido de su negocio por el código público');
select is(pg_temp.doc('staff_b') #>> '{identifiers,order_id}', pg_temp.val('order_b'), 'el personal también');
select is(
  pg_temp.trace_as('rider2', 'e9000000-0000-4000-8000-000000000004', 'business', pg_temp.val('code_a')),
  '{"error": "42501"}'::jsonb, 'un repartidor del negocio no: 42501');
select is(
  pg_temp.trace_as('customer', null, 'business', pg_temp.val('code_a')),
  '{"error": "42501"}'::jsonb, 'el cliente dueño del pedido tampoco: 42501');
select is(
  pg_temp.trace_as('other_owner', 'e9000000-0000-4000-8000-000000000006', 'business', pg_temp.val('code_a')),
  '{"error": "42501"}'::jsonb, 'la dueña de OTRO negocio no entra pidiendo por este negocio: 42501');
select throws_ok(
  $$select public.get_order_trace(null, 'LT-0001')$$, '42501', 'operador no autorizado',
  'sin negocio no hay traza por la puerta del negocio: NULL no significa todos');

-- ── 2 · Otro negocio = no existe ───────────────────────────────────────────
select is(pg_temp.doc('missing'), '{"found": false, "reason": "not_found"}'::jsonb,
  'una referencia que no existe contesta found=false, sin nada más');
select is(
  (select count(*)::integer
     from unnest(array[
       pg_temp.val('order_a'), pg_temp.val('code_a'), 'traza-manual-0001', pg_temp.val('token_id_a'),
       pg_temp.val('correlation_a'), pg_temp.val('order_b'), 'TRAZA-CLIENTE-KEY-0002', pg_temp.val('session_b'),
       pg_temp.val('intent_b'), '77700012345', 'taba2:checkout:' || pg_temp.val('session_b'), 'PREF-TRAZA-0002',
       pg_temp.val('attempt_b'), pg_temp.val('correlation_b'), 'MO-TRAZA', pg_temp.val('session_d'), '55500099911'
     ]) as r(reference)
    where pg_temp.trace_as('other_owner', 'e9000000-0000-4000-8000-000000000006', 'other', r.reference)
          is distinct from pg_temp.doc('missing')),
  0, 'diecisiete referencias reales de otro negocio contestan EXACTAMENTE lo mismo que una que no existe');
select is(
  public.get_order_trace_service(pg_temp.val('order_a'), pg_temp.id('other')),
  '{"found": false, "reason": "not_found"}'::jsonb,
  'la variante de servicio acotada a otro negocio tampoco lo encuentra');

-- ── 3 · Cualquier identificador llega al mismo pedido ──────────────────────
select is(
  (select array_agg(public.get_order_trace_service(r.reference) ->> 'resolved_by' order by r.n)
     from unnest(array[
       pg_temp.val('order_a'), pg_temp.val('code_a'), lower(pg_temp.val('code_a')), 'traza-manual-0001',
       pg_temp.val('token_id_a'), pg_temp.val('correlation_a')]) with ordinality as r(reference, n)),
  array['order_id', 'public_code', 'public_code', 'order_client_request_id', 'tracking_token_id', 'correlation_id'],
  'pedido A: id, código (también en minúsculas), clave de idempotencia, id del token y correlación se resuelven cada uno por su criterio');
select is(
  (select count(distinct public.get_order_trace_service(r.reference) #>> '{identifiers,order_id}')::integer
          + count(*) filter (where public.get_order_trace_service(r.reference) #>> '{identifiers,order_id}'
                                   is distinct from pg_temp.val('order_a'))::integer
     from unnest(array[
       pg_temp.val('order_a'), pg_temp.val('code_a'), 'traza-manual-0001',
       pg_temp.val('token_id_a'), pg_temp.val('correlation_a')]) as r(reference)),
  1, 'y los cinco llegan al mismo pedido');
select is(
  (select array_agg(coalesce(public.get_order_trace_service(r.reference, pg_temp.id('business')) ->> 'resolved_by', '-') order by r.n)
     from unnest(array[
       pg_temp.val('order_b'), pg_temp.val('session_b'), pg_temp.val('intent_b'), pg_temp.val('attempt_b'),
       pg_temp.val('correlation_b'), 'mp_' || replace(pg_temp.val('session_b'), '-', ''), '77700012345',
       'taba2:checkout:' || pg_temp.val('session_b'), 'PREF-TRAZA-0002', 'MO-TRAZA']) with ordinality as r(reference, n)),
  array['order_id', 'checkout_session_id', 'payment_intent_id', 'payment_attempt_id', 'correlation_id',
        'order_client_request_id', 'provider_payment_id', 'external_reference', 'preference_id', 'merchant_order_id'],
  'pedido B: pedido, sesión, intento, intento de preferencia, correlación, clave mp_, id de pago, referencia externa, preferencia y orden del proveedor');
select is(
  (select count(*)::integer
     from unnest(array[
       pg_temp.val('order_b'), pg_temp.val('session_b'), pg_temp.val('intent_b'), pg_temp.val('attempt_b'),
       pg_temp.val('correlation_b'), 'mp_' || replace(pg_temp.val('session_b'), '-', ''), '77700012345',
       'taba2:checkout:' || pg_temp.val('session_b'), 'PREF-TRAZA-0002', 'MO-TRAZA']) as r(reference)
    where public.get_order_trace_service(r.reference) -> 'identifiers' is distinct from pg_temp.doc('b') -> 'identifiers'),
  0, 'y los diez devuelven los mismos identificadores, ya unidos');

-- La clave que eligió el cliente no está en el pedido: era la búsqueda que fallaba.
select is(
  (select count(*)::integer from public.orders o where o.client_request_id = 'TRAZA-CLIENTE-KEY-0002'),
  0, 'control: buscar el pedido por la clave del cliente en orders sigue dando cero');
select is(
  public.get_order_trace_service('TRAZA-CLIENTE-KEY-0002'),
  jsonb_build_object('found', false, 'reason', 'ambiguous', 'matched_by', 'checkout_client_request_id',
    'candidates', (
      select jsonb_agg(jsonb_build_object('checkout_session_id', cs.id, 'business_id', cs.business_id, 'created_at', cs.created_at)
                       order by to_jsonb(cs.created_at) #>> '{}')
        from public.checkout_sessions cs where cs.client_request_id = 'TRAZA-CLIENTE-KEY-0002')),
  'dos clientes con la misma clave de checkout: contesta ambiguous con los dos candidatos, no elige uno');
select is(
  (pg_temp.trace_as('owner', 'e9000000-0000-4000-8000-000000000001', 'business', 'TRAZA-CLIENTE-KEY-0002')
     -> 'candidates' -> 0) ? 'business_id',
  false, 'por la puerta del negocio los candidatos no repiten el negocio');
select is(
  public.get_order_trace_service('TRAZA-CLIENTE-KEY-0004') #>> '{identifiers,checkout_session_id}',
  pg_temp.val('session_d'), 'una clave de checkout que no es ambigua llega a su sesión');

-- ── 4 · Identificadores ────────────────────────────────────────────────────
select is(
  (pg_temp.doc('b') -> 'identifiers') - 'tracking_tokens',
  (select jsonb_build_object(
            'business_id', o.business_id, 'order_id', o.id, 'public_code', o.public_code,
            'client_request_id', 'mp_' || replace(cs.id::text, '-', ''),
            'checkout_session_id', cs.id, 'checkout_client_request_id', 'TRAZA-CLIENTE-KEY-0002',
            'payment_intent_id', pi.id, 'provider_payment_id', '77700012345',
            'external_reference', 'taba2:checkout:' || cs.id::text, 'preference_id', 'PREF-TRAZA-0002',
            'merchant_order_id', 'MO-TRAZA', 'correlation_id', o.correlation_id)
     from public.orders o
     join public.checkout_sessions cs on cs.completed_order_id = o.id
     join public.payment_intents pi on pi.checkout_session_id = cs.id
    where o.id = pg_temp.id('order_b')),
  'B: pedido, código, las dos claves de idempotencia, sesión, intento, pago, referencia externa, preferencia y correlación REAL');
select is(
  pg_temp.doc('a') #> '{identifiers,tracking_tokens}',
  (select jsonb_agg(jsonb_build_object('id', t.id, 'created_at', t.created_at, 'expires_at', t.expires_at,
            'expired', false, 'revoked', t.revoked_at is not null, 'revoked_at', t.revoked_at))
     from public.order_public_tokens t where t.order_id = pg_temp.id('order_a')),
  'A: el token de seguimiento figura por id, con vencimiento y si está revocado');
select is(
  (pg_temp.doc('d') -> 'identifiers') ->> 'order_id', null, 'D: un checkout sin pedido no inventa un pedido');

-- ── 5 · Estado actual ──────────────────────────────────────────────────────
select is(
  jsonb_build_object(
    'status', pg_temp.doc('a') #> '{state,order,status}', 'revision', pg_temp.doc('a') #> '{state,order,revision}',
    'fulfillment', pg_temp.doc('a') #> '{state,order,fulfillment_type}',
    'payment', pg_temp.doc('a') #> '{state,payment,state}', 'method', pg_temp.doc('a') #> '{state,payment,method}',
    'released', pg_temp.doc('a') #> '{state,stock,released}', 'units', pg_temp.doc('a') #> '{state,stock,order_units}'),
  (select jsonb_build_object('status', 'delivered', 'revision', o.revision, 'fulfillment', 'delivery',
            'payment', 'manual_confirmed', 'method', 'cash', 'released', false, 'units', 2.000)
     from public.orders o where o.id = pg_temp.id('order_a')),
  'A: entregado, su revisión, envío, cobro manual confirmado, stock no devuelto');
select is(
  jsonb_build_object(
    'payment', pg_temp.doc('b') #> '{state,payment,state}', 'provider', pg_temp.doc('b') #> '{state,payment,provider_status}',
    'paid', pg_temp.doc('b') #> '{state,payment,paid_amount}', 'checkout', pg_temp.doc('b') #> '{state,checkout,status}',
    'reservations', pg_temp.doc('b') #> '{state,stock,reservations}'),
  '{"payment": "completed", "provider": "approved", "paid": 37035.00, "checkout": "completed",
    "reservations": {"active": 0, "released": 0, "converted": 1, "active_past_expiry": 0}}'::jsonb,
  'B: pago completo y aprobado, checkout completo, reserva convertida');
select is(
  jsonb_build_object('status', pg_temp.doc('c') #> '{state,order,status}', 'released', pg_temp.doc('c') #> '{state,stock,released}',
    'payment', pg_temp.doc('c') #> '{state,payment,state}'),
  '{"status": "cancelled", "released": true, "payment": "manual_pending"}'::jsonb,
  'C: cancelado y con el stock devuelto');
select is(
  jsonb_build_object('order', pg_temp.doc('d') #> '{state,order}', 'checkout', pg_temp.doc('d') #> '{state,checkout,status}',
    'payment', pg_temp.doc('d') #> '{state,payment,state}', 'reservations', pg_temp.doc('d') #> '{state,stock,reservations}'),
  '{"order": null, "checkout": "expired", "payment": "expired",
    "reservations": {"active": 0, "released": 1, "converted": 0, "active_past_expiry": 0}}'::jsonb,
  'D: sin pedido, checkout y pago vencidos, reserva liberada');
select is(
  (pg_temp.doc('a') #> '{state,delivery_handoff}') - 'issued_at' - 'expires_at' - 'confirmed_at',
  '{"code_issued": true, "code_required": true, "failed_attempts": 0, "locked_until": null,
    "attempts": {"incorrect_code": 1, "confirmed": 1}}'::jsonb,
  'A: entrega con código emitido, un intento equivocado y el bueno');
select is(
  (pg_temp.doc('a') #> '{state,rider}') - 'assigned_rider_ref' - 'location_reports',
  '{"assigned": true, "offers": {"accepted": 1, "rejected": 1}, "issues": 1}'::jsonb,
  'A: repartidor asignado, una oferta rechazada y una aceptada, una incidencia');

-- ── 6 · La línea de tiempo tiene todas las etapas ──────────────────────────
select ok(
  pg_temp.events(pg_temp.doc('a')) @> array[
    'intake.admitted', 'order.created', 'stock.order_item_committed', 'order.received', 'order.status_changed',
    'order.manual_payment_confirmed', 'command.transition_order', 'command.confirm_manual_order_payment',
    'packing.started', 'tracking.token_issued', 'order.tracking_access_recovered',
    'notification.new_order', 'print.job_order_ticket', 'print.job_kitchen_ticket', 'print.queued',
    'rider.offer_sent', 'rider.offer_rejected', 'rider.offer_accepted', 'order.rider_offered',
    'order.rider_rejected_offer', 'order.rider_accepted_offer',
    'rider.operation_accept_offer', 'rider.operation_picked_up', 'rider.operation_start_route',
    'rider.issue_reported', 'rider.operation_arrived', 'rider.operation_confirm_code',
    'handoff.code_issued', 'handoff.attempt_incorrect_code', 'handoff.attempt_confirmed', 'handoff.confirmed',
    'handoff.outbox_delivery_confirmed'],
  'A: admisión, pedido, stock, cobro manual, comandos, armado, seguimiento, aviso, impresión, repartidor y entrega con código');
select is(
  (select array_agg(distinct e.value ->> 'stage' order by e.value ->> 'stage')
     from jsonb_array_elements(pg_temp.doc('a') -> 'timeline') e(value)),
  array['delivery_handoff', 'intake', 'notification', 'order', 'payment', 'print', 'rider', 'stock', 'tracking'],
  'A: nueve etapas distintas en una sola línea de tiempo');
select is(
  (select array_agg(e.value #>> '{details,next_status}' order by e.position)
     from jsonb_array_elements(pg_temp.doc('a') -> 'timeline') with ordinality as e(value, position)
    where e.value ->> 'event' = 'order.status_changed'),
  array['accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'delivered'],
  'A: las transiciones salen en el orden en que pasaron');
select is(
  pg_temp.entry(pg_temp.doc('a'), 'stock.order_item_committed') -> 'details',
  jsonb_build_object('product_id', pg_temp.id('product'), 'quantity', 2.000, 'stock_effect', 'decremented_at_order_creation'),
  'A: el renglón dice qué producto, cuánto, y que el stock se descontó al nacer el pedido');
select is(
  pg_temp.entry(pg_temp.doc('a'), 'intake.admitted') -> 'details',
  '{"channel": "manual", "units": 2, "network_fingerprint_present": true}'::jsonb,
  'A: del guardián de admisión sale el canal, las unidades y SI hubo huella de red; nunca la huella');
select ok(
  pg_temp.events(pg_temp.doc('b')) @> array[
    'checkout.session_created', 'intake.admitted', 'stock.reserved', 'payment.intent_created',
    'payment.attempt_preference', 'webhook.received', 'payment.outbox_payment', 'payment.approved',
    'stock.reservation_converted', 'payment.intent_completed', 'checkout.session_completed',
    'payment.order_completed', 'order.created', 'stock.order_item_committed', 'order.received',
    'tracking.token_issued', 'notification.new_order', 'print.job_order_ticket'],
  'B: checkout, admisión, reserva, intento, preferencia, aviso, cola, pago aprobado, reserva convertida, pedido');
select is(
  jsonb_build_object(
    'webhook', pg_temp.entry(pg_temp.doc('b'), 'webhook.received') -> 'details',
    'item', pg_temp.entry(pg_temp.doc('b'), 'stock.order_item_committed') #> '{details,stock_effect}',
    'approved_by', pg_temp.entry(pg_temp.doc('b'), 'payment.approved') -> 'actor_role',
    'approved_receipt', pg_temp.entry(pg_temp.doc('b'), 'payment.approved') #> '{details,receipt_id}'),
  jsonb_build_object(
    'webhook', jsonb_build_object('receipt_id', pg_temp.id('receipt_b'), 'topic', 'payment', 'signature_valid', true,
      'processing_status', 'queued', 'attempt_count', 0, 'has_error', false),
    'item', 'covered_by_converted_reservation',
    'approved_by', 'provider',
    'approved_receipt', pg_temp.id('receipt_b')),
  'B: el aviso figura por id y estado, el pago aprobado nombra su aviso, y el stock salió de la reserva');
select ok(
  pg_temp.events(pg_temp.doc('c')) @> array['order.created', 'order.status_changed', 'business_cancel_reason',
    'command.cancel_order', 'stock.released_to_shelf', 'print.cancelled_with_order']
  and pg_temp.entry(pg_temp.doc('c'), 'stock.released_to_shelf') #> '{details,units}' = to_jsonb(4.000)
  and pg_temp.entry(pg_temp.doc('c'), 'business_cancel_reason') -> 'details' = '{"has_free_text_reason": true}'::jsonb,
  'C: cancelación, devolución de las 4 unidades e impresión anulada; del motivo sólo se dice que existe');
select ok(
  pg_temp.events(pg_temp.doc('d')) @> array['checkout.session_created', 'stock.reserved', 'payment.intent_created',
    'stock.reservation_released', 'checkout.session_expired', 'payment.intent_expired']
  and pg_temp.entry(pg_temp.doc('d'), 'stock.reservation_released') #>> '{details,reason}' = 'checkout_expired'
  and not (pg_temp.events(pg_temp.doc('d')) && array['order.created', 'order.received']),
  'D: reserva, vencimiento y liberación con su motivo; ningún evento de pedido');

-- ── 7 · Forma y orden ──────────────────────────────────────────────────────
select is(
  (select count(*)::integer
     from trace_docs d, jsonb_array_elements(d.doc -> 'timeline') e(value)
    where not (e.value ?& array['at', 'stage', 'source', 'event', 'actor_role', 'details'])
       or (e.value ->> 'actor_role') not in ('customer', 'business', 'rider', 'system', 'provider', 'device', 'service')
       or jsonb_typeof(e.value -> 'details') <> 'object'),
  0, 'cada entrada lleva at, stage, source, event, actor_role y details; el actor es un rol');
select is(
  (select count(*)::integer
     from trace_docs d,
          lateral (select (e.value ->> 'at')::timestamptz as at,
                          lag((e.value ->> 'at')::timestamptz) over (order by e.position) as previous
                     from jsonb_array_elements(d.doc -> 'timeline') with ordinality as e(value, position)) t
    where t.previous > t.at),
  0, 'la línea de tiempo está ordenada: ninguna entrada es anterior a la que la precede');
select is(
  (select bool_and((d.doc ->> 'timeline_rows')::integer = jsonb_array_length(d.doc -> 'timeline')
                   and (d.doc ->> 'truncated') = 'false' and d.doc -> 'sources_at_cap' = '[]'::jsonb
                   and (d.doc ->> 'timeline_omitted') = '0')
     from trace_docs d where d.doc ->> 'found' = 'true'),
  true, 'sin recorte: timeline_rows es el largo de la línea, truncated es false y no se omite nada');
select is(
  public.get_order_trace_service(pg_temp.val('order_a')) - 'generated_at',
  pg_temp.doc('a') - 'generated_at',
  'es estable: dos lecturas seguidas devuelven el mismo documento');

-- ── 8 · Lo que no se pudo unir ─────────────────────────────────────────────
select is(
  (select array_agg(g.value ->> 'code' order by g.value ->> 'code') from jsonb_array_elements(pg_temp.doc('a') -> 'gaps') g(value)),
  array['checkout_not_applicable', 'stock_ledger_has_no_rows'],
  'A: un pedido manual dice que no tiene checkout y que el libro de stock no lo nombra');
select is(
  (select array_agg(g.value ->> 'code' order by g.value ->> 'code') from jsonb_array_elements(pg_temp.doc('b') -> 'gaps') g(value)),
  array['checkout_transitions_not_recorded', 'stock_ledger_has_no_rows'],
  'B: cadena completa; sólo avisa lo que la base no guarda');
select is(
  (select array_agg(g.value ->> 'code' order by g.value ->> 'code') from jsonb_array_elements(pg_temp.doc('d') -> 'gaps') g(value)),
  array['checkout_transitions_not_recorded', 'order_not_created', 'provider_payment_not_recorded', 'stock_ledger_has_no_rows'],
  'D: dice que no hay pedido y que el proveedor nunca informó un pago');
select is(
  jsonb_build_object(
    'resolved_by', pg_temp.doc('orphan') -> 'resolved_by',
    'payment', pg_temp.doc('orphan') #> '{identifiers,provider_payment_id}',
    'events', to_jsonb(pg_temp.events(pg_temp.doc('orphan'))),
    'signatures', (select jsonb_agg(e.value #> '{details,signature_valid}' order by e.position)
                     from jsonb_array_elements(pg_temp.doc('orphan') -> 'timeline') with ordinality as e(value, position)
                    where e.value ->> 'event' = 'webhook.received'),
    'gaps', (select jsonb_agg(g.value -> 'code') from jsonb_array_elements(pg_temp.doc('orphan') -> 'gaps') g(value))),
  '{"resolved_by": "webhook_resource_id", "payment": "55500099911",
    "events": ["webhook.received", "webhook.received", "payment.outbox_payment"],
    "signatures": [false, true], "gaps": ["payment_not_linked_to_checkout"]}'::jsonb,
  'un id de pago que ningún checkout registró: soporte ve sus avisos (uno rechazado, uno válido), su trabajo en cola y que no está unido');
select is(
  pg_temp.trace_as('owner', 'e9000000-0000-4000-8000-000000000001', 'business', '55500099911'),
  '{"found": false, "reason": "not_found"}'::jsonb,
  'esos avisos no tienen negocio: por la puerta del negocio no existen');

-- ── 9 · Ningún dato personal ───────────────────────────────────────────────
select is(
  (select count(*)::integer
     from trace_docs d,
          unnest(array[
            'Zulema', 'Pii Traza', '2996209137', '5492996209137', 'Calle Secreta', 'Barrio Reservado',
            'Porton verde', 'Tocar timbre', 'nota privada', 'llamo para cancelar', 'Neuquen',
            '38.951673', '68.059127', 'traza-cliente-pii', 'example.invalid', '203.0.113.77',
            'tok_TRAZA_', 'tok_ROTADO_', 'tok_CANCELADO_', 'Otro Cliente', '5492994000000',
            'Duena Traza', 'Staff Traza', 'Rider Uno', 'Rider Dos', 'Lata Traza',
            'https://www.mercadopago.com', 'sandbox.mercadopago.com'
          ]) as secret(value)
    where position(lower(secret.value) in lower(d.doc::text)) > 0),
  0, 'ni nombre, teléfono, domicilio, referencia, notas, motivo, coordenadas, correo, IP, token ni enlace de pago aparecen en ningún documento');
select is(
  (select count(*)::integer
     from trace_docs d,
          unnest(array['customer', 'staff', 'rider1', 'rider2', 'owner', 'other_owner', 'customer2']) as person(name)
    where position(pg_temp.val(person.name) in d.doc::text) > 0),
  0, 'ningún id de usuario (cliente, personal, repartidor, dueña) aparece crudo');
select is(
  (select count(*)::integer
     from trace_docs d, jsonb_path_query(d.doc, 'strict $.**') leaf(value)
    where jsonb_typeof(leaf.value) = 'string' and leaf.value #>> '{}' = pg_temp.val('delivery_code')),
  0, 'el código de entrega no es el valor de ningún campo');
select is(
  (select coalesce(array_agg(distinct k.key order by k.key), '{}'::text[])
     from trace_docs d, jsonb_path_query(d.doc, 'strict $.** ? (@.type() == "object").keyvalue()') kv(value),
          lateral (select kv.value ->> 'key' as key) k
    where k.key ~* '(name|phone|whatsapp|address|street|neighborhood|notes|latitude|longitude|lat$|lng$|email|token$|token_hash|code_hash|ciphertext|fingerprint_hash|user_id|customer_id|payer|init_point|idempotency|request_hash|contact|snapshot)'),
  '{}'::text[], 'ninguna clave del documento tiene nombre de dato personal o de secreto');
select ok(
  (select bool_and(length(t.token) > 20) from public.order_public_tokens t where t.order_id = pg_temp.id('order_c'))
  is not false
  and position(encode((select t.token_hash from public.order_public_tokens t where t.order_id = pg_temp.id('order_a') limit 1), 'hex')
               in pg_temp.doc('a')::text) = 0,
  'el hash del token tampoco sale');

-- El personal figura con rol y una referencia derivada, estable y por negocio.
select ok(
  pg_temp.entry(pg_temp.doc('a'), 'command.transition_order') ->> 'actor_ref' ~ '^op_[0-9a-f]{12}$'
  and pg_temp.entry(pg_temp.doc('a'), 'command.transition_order') ->> 'actor_ref'
      = pg_temp.entry(pg_temp.doc('c'), 'command.transition_order') ->> 'actor_ref'
  and pg_temp.entry(pg_temp.doc('a'), 'command.transition_order') ->> 'actor_ref'
      = private.order_trace_actor_ref(pg_temp.id('business'), pg_temp.id('staff'))
  and pg_temp.entry(pg_temp.doc('c'), 'command.cancel_order') ->> 'actor_ref'
      = private.order_trace_actor_ref(pg_temp.id('business'), pg_temp.id('owner'))
  and private.order_trace_actor_ref(pg_temp.id('business'), pg_temp.id('staff'))
      <> private.order_trace_actor_ref(pg_temp.id('other'), pg_temp.id('staff')),
  'la misma persona tiene la misma referencia en dos pedidos del negocio y otra distinta en otro negocio; quien cancela figura con la suya');
select is(
  pg_temp.entry(pg_temp.doc('a'), 'rider.offer_accepted') ->> 'actor_ref',
  pg_temp.doc('a') #>> '{state,rider,assigned_rider_ref}',
  'el repartidor que aceptó es el asignado, dicho con la misma referencia');
select is(
  (select count(*)::integer
     from trace_docs d, jsonb_array_elements(d.doc -> 'timeline') e(value)
    where e.value ->> 'actor_role' = 'customer' and e.value ? 'actor_ref'),
  0, 'el cliente nunca lleva referencia: sólo su rol');

-- Las dos trabas de los JSON libres, probadas directo.
select is(
  private.order_trace_safe_details(
    '{"next_status": "accepted", "reason": "El cliente Zulema llamo", "amount": 12.5, "ok": true,
      "nested": {"customer_name": "Zulema"}, "customer_name": "Zulema", "rider_user_id": "a9000000-0000-4000-8000-000000000003"}'::jsonb,
    array['next_status', 'reason', 'amount', 'ok', 'nested']),
  '{"next_status": "accepted", "amount": 12.5, "ok": true}'::jsonb,
  'de un JSON libre sale sólo la lista cerrada, y un texto con espacios no pasa ni bajo una clave permitida');
select is(
  array[private.order_trace_uuid('A9000000-0000-4000-8000-000000000003')::text, private.order_trace_uuid(repeat('-', 36))::text,
        private.order_trace_uuid('a9000000-0000-4000-8000-00000000000g')::text, private.order_trace_uuid('no es un uuid')::text,
        private.order_trace_uuid(null)::text],
  array['a9000000-0000-4000-8000-000000000003', null, null, null, null]::text[],
  'un uuid pasa (en mayúsculas también); 36 guiones, un carácter que no es hexadecimal, un texto o NULL dan NULL y no levantan');
select is(
  array[private.order_trace_code('approved_after_reservation_expired'), private.order_trace_code('texto con espacios'),
        private.order_trace_code(null)],
  array['approved_after_reservation_expired', null, null]::text[],
  'un código pasa; un texto libre no');

-- ── 10 · Bordes ────────────────────────────────────────────────────────────
select is(
  array[public.get_order_trace_service(null), public.get_order_trace_service('   '),
        public.get_order_trace_service(repeat('x', 201)), public.get_order_trace_service('00000000-0000-4000-8000-00000000dead')],
  array['{"found": false, "reason": "not_found"}'::jsonb, '{"found": false, "reason": "not_found"}'::jsonb,
        '{"found": false, "reason": "not_found"}'::jsonb, '{"found": false, "reason": "not_found"}'::jsonb],
  'referencia nula, vacía, de más de 200 caracteres o un uuid que no es de nadie: not_found');

-- Un error de la cola de cobros sale como código, o sólo como «hay error». Hoy el
-- procesador guarda un código; acá se guarda a propósito un mensaje con datos de
-- una persona, que es lo que un proveedor podría devolver mañana.
update public.payment_outbox
   set status = 'retry_wait', attempts = 2,
       last_error = 'Payer Zulema Pii Traza traza-cliente-pii@example.invalid dni 30123456 tel +54 299 620-9137 calle Secreta 4321'
 where resource_id = '55500099911';
select is(
  (select jsonb_build_object(
            'details', (pg_temp.entry(x.doc, 'payment.outbox_payment') -> 'details') - 'job_id' - 'receipt_id' - 'next_attempt_at',
            'leaks', (select count(*)::integer
                        from unnest(array['Zulema', 'Pii Traza', 'example.invalid', '30123456', '620-9137', 'Secreta', 'Payer']) w(value)
                       where position(lower(w.value) in lower(x.doc::text)) > 0))
     from (select public.get_order_trace_service('55500099911') as doc) x),
  '{"details": {"status": "retry_wait", "attempts": 2, "has_error": true}, "leaks": 0}'::jsonb,
  'un mensaje de error con nombre, correo, documento, teléfono y calle NO sale: la traza sólo dice que hay un error');
update public.payment_outbox set last_error = 'provider_timeout' where resource_id = '55500099911';
select is(
  pg_temp.entry(public.get_order_trace_service('55500099911'), 'payment.outbox_payment') #> '{details,last_error_code}',
  '"provider_timeout"'::jsonb, 'y cuando el error es un código, sale el código');

-- Un id mal formado adentro de un JSON libre no tira la traza: se ignora.
insert into public.order_events (order_id, business_id, type, event_type, actor_role, metadata)
values (pg_temp.id('order_c'), pg_temp.id('business'), 'order.rider_reassigned', 'order.rider_reassigned', 'system',
  jsonb_build_object('rider_user_id', repeat('-', 36), 'previous_rider_user_id', 'a9000000-0000-4000-8000-00000000000g',
                     'next_rider_user_id', pg_temp.val('rider1')));
select is(
  pg_temp.entry(public.get_order_trace_service(pg_temp.val('order_c')), 'order.rider_reassigned') -> 'details',
  jsonb_build_object('next_rider_ref', private.order_trace_actor_ref(pg_temp.id('business'), pg_temp.id('rider1'))),
  'un id de repartidor mal formado en los metadatos de un evento se ignora (antes, 36 guiones tiraban la traza entera); el bien formado sale como referencia');

-- Un token revocado se dice revocado.
update public.order_public_tokens set revoked_at = clock_timestamp() where order_id = pg_temp.id('order_c');
select ok(
  (public.get_order_trace_service(pg_temp.val('order_c')) #> '{identifiers,tracking_tokens,0,revoked}') = 'true'::jsonb
  and pg_temp.events(public.get_order_trace_service(pg_temp.val('order_c'))) @> array['tracking.token_revoked'],
  'un token revocado figura revocado y deja su evento');

-- Una alerta operativa que nombra al pedido entra en su línea de tiempo.
insert into public.operational_alerts(business_id, fingerprint, severity, alert_code, subject_type, subject_id, status, summary, required_action)
values (pg_temp.id('business'), repeat('c', 64), 'ACTION_REQUIRED', 'ORDER_NOT_ACCEPTED', 'order', pg_temp.id('order_b'), 'open',
        'Pedido sin aceptar', 'Aceptar o cancelar el pedido');
select is(
  pg_temp.entry(public.get_order_trace_service(pg_temp.val('order_b')), 'alert.ORDER_NOT_ACCEPTED') #> '{details,severity}',
  '"ACTION_REQUIRED"'::jsonb, 'la alerta abierta sobre el pedido aparece con su severidad');

-- Topes: 260 intentos de código, 260 incidencias y 260 avisos de entrega. Cada
-- fuente aporta sus 200 filas más nuevas.
insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, attempted_at, result)
select pg_temp.id('business'), pg_temp.id('order_a'), pg_temp.id('rider2'), 'traza-tope-a-' || lpad(g::text, 4, '0'),
       clock_timestamp() + make_interval(secs => g), 'incorrect_code'
  from generate_series(1, 260) g;
insert into public.rider_delivery_issues(business_id, order_id, rider_id, issue_type, request_id, reported_at)
select pg_temp.id('business'), pg_temp.id('order_a'), pg_temp.id('rider2'), 'other', 'traza-tope-i-' || lpad(g::text, 4, '0'),
       clock_timestamp() + make_interval(secs => g)
  from generate_series(1, 260) g;
insert into public.delivery_outbox(business_id, order_id, event_type, event_key, created_at)
select pg_temp.id('business'), pg_temp.id('order_a'), 'rider_issue_reported', 'traza-tope-o-' || lpad(g::text, 4, '0'),
       clock_timestamp() + make_interval(secs => g)
  from generate_series(1, 260) g;
insert into trace_docs values ('capped', public.get_order_trace_service(pg_temp.val('order_a')));
select is(
  jsonb_build_object('timeline', jsonb_array_length(pg_temp.doc('capped') -> 'timeline'),
    'limit', pg_temp.doc('capped') -> 'timeline_limit', 'truncated', pg_temp.doc('capped') -> 'truncated',
    'more_than_limit', (pg_temp.doc('capped') ->> 'timeline_rows')::integer > 500,
    'omitted_is_the_rest', (pg_temp.doc('capped') ->> 'timeline_omitted')::integer
                           = (pg_temp.doc('capped') ->> 'timeline_rows')::integer - 500,
    'at_cap', pg_temp.doc('capped') -> 'sources_at_cap'),
  '{"timeline": 500, "limit": 500, "truncated": true, "more_than_limit": true, "omitted_is_the_rest": true,
    "at_cap": ["delivery_confirmation_attempts", "delivery_outbox", "rider_delivery_issues"]}'::jsonb,
  'con una historia desmedida devuelve 500 entradas, dice truncated, cuántas omitió y qué fuentes llegaron al tope');
select is(
  (pg_temp.events(pg_temp.doc('capped')))[1:3], (pg_temp.events(pg_temp.doc('a')))[1:3],
  'conserva el principio de la historia');
select is(
  jsonb_build_object(
    'last_is_newest', (pg_temp.doc('capped') -> 'timeline' -> -1 ->> 'at')::timestamptz = greatest(
      (select max(t.attempted_at) from public.delivery_confirmation_attempts t where t.order_id = pg_temp.id('order_a')),
      (select max(q.reported_at) from public.rider_delivery_issues q where q.order_id = pg_temp.id('order_a')),
      (select max(x.created_at) from public.delivery_outbox x where x.order_id = pg_temp.id('order_a'))),
    'oldest_capped_dropped', (select count(*)::integer
       from jsonb_array_elements(pg_temp.doc('capped') -> 'timeline') e(value)
      where e.value ->> 'source' = 'rider_delivery_issues'
        and (e.value ->> 'at')::timestamptz <= (
          select q.reported_at from public.rider_delivery_issues q
           where q.order_id = pg_temp.id('order_a') and q.request_id = 'traza-tope-i-0060'))),
  '{"last_is_newest": true, "oldest_capped_dropped": 0}'::jsonb,
  'y conserva el final: la última entrada es la fila más nueva, y de una fuente topada se van las 60 más viejas, no las más nuevas');

-- ── 11 · No escribe y los índices existen ──────────────────────────────────
select is(
  (select count(*)::integer from pg_indexes
    where schemaname = 'public'
      and indexname in ('checkout_sessions_completed_order_idx', 'payment_intents_order_idx',
                        'payment_webhook_receipts_resource_idx', 'inventory_movements_reference_idx')),
  4, 'existen los cuatro índices del vínculo');
select is(
  (select array_agg(p.provolatile::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'order_trace%'),
  array['i', 'i', 's', 'i', 'i'],
  'ninguna pieza es VOLATILE: la traza no puede escribir');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where ((n.nspname = 'public' and p.proname in ('get_order_trace', 'get_order_trace_service'))
         or (n.nspname = 'private' and p.proname like 'order_trace%'))
       and p.prosrc ~* 'to_jsonb\s*\(\s*(o|cs|pi|v_order|v_session|v_intent)\s*\)|row_to_json|select\s+\*'),
  'ninguna pieza vuelca una fila entera: cada columna que sale está escrita');

-- La puerta del negocio, llamada de verdad con el rol de la API.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e9000000-0000-4000-8000-000000000001"}';
select is(
  public.get_order_trace('b9000000-0000-4000-8000-0000000000a1', 'traza-manual-0001') #>> '{state,order,status}',
  'delivered', 'con el rol authenticated y la sesión de la dueña, la traza responde');
select throws_ok(
  $$select public.get_order_trace_service('traza-manual-0001')$$, '42501', null,
  'y la variante de servicio le está cerrada');
select throws_ok(
  $$select count(*) from public.payment_intents$$, '42501', null,
  'las tablas de pagos siguen cerradas para authenticated: la traza no abrió nada');
reset role;

-- El rastro del guardián de admisión es de otra migración: si no está, la traza lo
-- dice y sigue. (La tabla vuelve con el rollback de esta prueba.)
drop table private.order_intake_log;
select ok(
  (select d.doc ->> 'found' = 'true'
      and d.doc -> 'gaps' @> '[{"code": "intake_log_unavailable"}]'::jsonb
      and not (pg_temp.events(d.doc) && array['intake.admitted'])
      and pg_temp.events(d.doc) @> array['order.created', 'handoff.confirmed']
     from (select public.get_order_trace_service(pg_temp.val('order_a')) as doc) d),
  'sin la tabla del guardián de admisión la traza responde igual y lo anota como faltante');

select * from finish();
rollback;
