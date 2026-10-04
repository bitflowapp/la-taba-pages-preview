-- TABA · LA PANTALLA DEL PAGO NO SE ROMPE DESPUÉS DE RECUPERAR EL SEGUIMIENTO (20261002063000, TRACK-01)
--
-- Un pedido de Mercado Pago con entrega, pagado y en camino; el cliente recupera su seguimiento (eso crea el
-- código de entrega cifrado con el token nuevo) y vuelve a pedir el estado de su pago. Antes: 39000 y la
-- respuesta entera fallaba. Ahora: responde, sin código (como antes de recuperar); el código se ve por el
-- seguimiento.
-- Todo transaccional (rollback). Ids aleatorios: corre igual sobre la base del gate, que nunca está vacía.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create temporary table tr_ids (k text primary key, id uuid not null) on commit drop;
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select id from tr_ids where k = p_key $$;
create function pg_temp.rev(p_order uuid) returns bigint language sql stable as $$ select revision from public.orders where id = p_order $$;
create function pg_temp.as_user(p_key text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_key), 'role', 'authenticated', 'session_id', pg_temp.id('s_' || p_key))::text, true)::void;
$$;
create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('customer'), 'role', 'authenticated', 'is_anonymous', true)::text, true)::void;
$$;

do $fixture$
declare
  v_business uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_slug text := 'tracking-recovery-' || right(replace(v_business::text, '-', ''), 10);
  v_res jsonb; v_session uuid; v_intent uuid; v_prepare jsonb; v_order uuid; v_status text;
  v_actor record;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values
    (v_owner,'authenticated','authenticated',v_slug || '-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_staff,'authenticated','authenticated',v_slug || '-staff@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_customer,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
  insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at,
    ordering_verified_by, currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode)
  values (v_business, 'TABA recuperar seguimiento', v_slug, 'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00, 'off');
  insert into public.business_members(business_id,user_id,role,is_active) values
    (v_business, v_owner, 'owner', true), (v_business, v_staff, 'staff', true);
  insert into tr_ids values ('business', v_business), ('owner', v_owner), ('staff', v_staff), ('customer', v_customer), ('product', v_product);
  for v_actor in select * from (values ('owner', v_owner, 'owner'), ('staff', v_staff, 'staff')) t(k, user_id, member_role) loop
    insert into tr_ids values ('s_' || v_actor.k, gen_random_uuid());
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values (pg_temp.id('s_' || v_actor.k), v_actor.user_id, v_business, v_actor.member_role, 'panel_web');
  end loop;
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata recuperar seguimiento','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',100,true,true,false,'{}',true,now(),v_owner,v_slug || '-lata',v_slug || '-lata','commercial',1);
  insert into public.business_payment_settings (business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at)
  values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-' || v_slug, 'app-' || v_slug, clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business, 'test', 'collector-' || v_slug, 'app-' || v_slug, 'connected', 'ciphertext-only-local-fixture', now() + interval '2 days');

  perform set_config('request.jwt.claims', '', true);
  v_res := public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'tr_' || md5(v_slug),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'fulfillment_type', 'delivery',
    'address', jsonb_build_object('street', 'Calle Prueba', 'street_number', '100', 'city', 'Neuquen', 'neighborhood', 'Centro',
      'latitude', '-38.9516', 'longitude', '-68.0591', 'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text),
    'contact', jsonb_build_object('name', 'Cliente Prueba', 'phone', '5492994000111'),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_res ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  perform public.record_mercadopago_preference_created_v2(
    v_business, 'test', v_session, v_customer, (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer,
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-' || v_slug, 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || v_slug,
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || v_slug,
    encode(digest('pref-' || v_slug, 'sha256'), 'hex'), 'req-' || v_slug);
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  perform public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', 'PAY-' || v_slug, 'external_reference', pi.external_reference,
      'preference_id', pi.preference_id, 'merchant_order_id', 'MO-' || v_slug, 'collector_id', ps.collector_id,
      'currency', 'ARS', 'transaction_amount', cs.total::text, 'status', 'approved', 'status_detail', 'accredited',
      'payment_method', 'visa', 'live_mode', false, 'provider_occurred_at', clock_timestamp()::text,
      'refunded_amount', '0.00', 'payer_email_hash', encode(digest('payer-' || v_slug, 'sha256'), 'hex'),
      'raw_response_hash', encode(digest('snapshot-' || v_slug, 'sha256'), 'hex'))
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
    where pi.id = v_intent), 'reconciliation', null);
  v_res := public.finalize_paid_checkout_session(v_session);
  v_order := (v_res ->> 'order_id')::uuid;
  insert into tr_ids values ('o_mp', v_order), ('mp_session', v_session);

  perform pg_temp.as_user('staff');
  foreach v_status in array array['accepted', 'preparing', 'ready'] loop
    perform public.transition_order(v_order, pg_temp.rev(v_order), v_status, 'tr-' || left(md5(v_slug || v_status), 20));
  end loop;
  perform pg_temp.as_user('owner');
  perform public.transition_order(v_order, pg_temp.rev(v_order), 'on_the_way', 'tr-' || left(md5(v_slug || 'dispatch'), 20));
  perform set_config('request.jwt.claims', '', true);
end
$fixture$;

set constraints all immediate;
set constraints all deferred;

-- ── El caso real ──────────────────────────────────────────────────────────
select is((select status from public.orders where id = pg_temp.id('o_mp')), 'on_the_way',
  'precondición: el pedido de Mercado Pago con entrega está en camino');
select is(public.checkout_session_customer_payload(pg_temp.id('mp_session'), pg_temp.id('customer')) ->> 'delivery_code', null,
  'antes de recuperar el seguimiento la pantalla del pago responde, sin código');

select pg_temp.as_customer();
select is((public.recover_order_tracking_access(pg_temp.id('o_mp'), md5('tracking-recovery') || md5(pg_temp.id('o_mp')::text)) ->> 'ok')::boolean, true,
  'el cliente recupera su seguimiento (eso crea el código cifrado con el token nuevo)');
select set_config('request.jwt.claims', '', true);
select is((select count(*)::integer from public.order_delivery_handoffs h where h.order_id = pg_temp.id('o_mp') and h.confirmed_at is null), 1,
  'el pedido tiene ahora un código de entrega vigente');
select lives_ok(
  format($$select public.checkout_session_customer_payload(%L, %L)$$, pg_temp.id('mp_session'), pg_temp.id('customer')),
  'después de recuperar, la pantalla del pago sigue respondiendo (antes: 39000 y toda la respuesta fallaba)');
select is(public.checkout_session_customer_payload(pg_temp.id('mp_session'), pg_temp.id('customer')) ->> 'delivery_code', null,
  'y responde sin código, como antes de recuperar: el código se ve por el seguimiento');

-- ── La función auxiliar ───────────────────────────────────────────────────
select is(private.handoff_code_or_null(pgp_sym_encrypt('123456', 'clave-buena', 'cipher-algo=aes256,compress-algo=0'), 'clave-buena'), '123456',
  'con la clave del cifrado devuelve el código');
select is(private.handoff_code_or_null(pgp_sym_encrypt('123456', 'clave-buena', 'cipher-algo=aes256,compress-algo=0'), 'otra-clave'), null,
  'con otra clave devuelve null en vez de romper');

-- ── Permisos y texto ──────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'private.handoff_code_or_null(bytea,text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.handoff_code_or_null(bytea,text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('service_role', 'private.handoff_code_or_null(bytea,text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('public', 'private.handoff_code_or_null(bytea,text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', 'public.checkout_session_customer_payload(uuid,uuid)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.checkout_session_customer_payload(uuid,uuid)'::regprocedure, 'EXECUTE'),
  'la auxiliar no la ejecuta ningún rol de cliente, y la respuesta sigue cerrada a anon y authenticated');
select ok(
  (select position('private.handoff_code_or_null(h.code_ciphertext, s.id::text)' in p.prosrc) > 0
      and position('pgp_sym_decrypt(' in p.prosrc) = 0
     from pg_proc p where p.oid = 'public.checkout_session_customer_payload(uuid,uuid)'::regprocedure),
  'la respuesta descifra con la auxiliar');

select * from finish();
rollback;
