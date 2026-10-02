-- TABA · UNA CANCELACIÓN CONFIRMADA ES FINAL, Y LA PREFERENCIA NO PROMETE UNA LIBERACIÓN QUE NO HACE
--
-- Los asientos de la cancelación de un cobro no tenían estado terminal ni
-- idempotencia: una marca «dudosa» tardía degradaba una cancelación confirmada y
-- encolaba otro trabajo, una respuesta contradictoria la pisaba, y cada respuesta
-- repetida escribía un evento más. Acá se prueba que:
--
--   · `cancelled` y `rejected` son finales;
--   · la misma respuesta dos veces es idempotente, sin evento repetido;
--   · una respuesta distinta sobre un resultado final se rechaza (55000);
--   · el trabajo de conciliación no se duplica mientras haya uno activo;
--   · la cancelación confirmada sigue liberando el stock, una vez.
--
-- Y sobre `prepare_mercadopago_preference_v2`: la liberación «al usar» de un
-- checkout vencido la deshacía su propia excepción. Se quitó la llamada; el
-- contrato de error es el mismo y quien libera es el barrido.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table caso (
  k text primary key, business_id uuid, product_id uuid,
  owner_id uuid, customer_id uuid, session_id uuid, intent_id uuid
) on commit drop;

create function pg_temp.usuario(p_tag text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated',p_tag || '-' || replace(v_id::text,'-','') || '@example.invalid','',now(),'{}','{}',now(),now());
  return v_id;
end;
$$;

-- Un negocio, su dueño con sesión registrada, un producto (stock 10) y un
-- checkout de Mercado Pago de 2 unidades. El guardián de admisión se apaga.
create function pg_temp.armar(p_k text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('pc-owner-' || p_k);
  v_customer uuid := pg_temp.usuario('pc-cliente-' || p_k);
  v_session uuid;
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values (
    v_business, 'TABA cancelacion ' || p_k, 'taba-cancelacion-' || p_k, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
  values (v_owner, v_owner, v_business, 'owner', 'panel_web');
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-pc-' || p_k, 'app-pc-' || p_k, clock_timestamp(), clock_timestamp());
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata cancelacion','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    10,true,true,false,'{}',true,now(),v_owner,'pc-' || p_k,'pc-' || p_k,'commercial',1);
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'pc-' || p_k || '-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Cancelacion', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  insert into caso values (p_k, v_business, v_product, v_owner, v_customer, v_session,
    (select id from public.payment_intents where checkout_session_id = v_session));
end;
$$;

create function pg_temp.sid(p_k text) returns uuid language sql as $$ select session_id from caso where k = p_k $$;
create function pg_temp.iid(p_k text) returns uuid language sql as $$ select intent_id from caso where k = p_k $$;
create function pg_temp.hash() returns text language sql as $$ select encode(gen_random_bytes(32), 'hex') $$;

-- El pago quedó pendiente en Mercado Pago y el dueño pide cancelarlo.
create function pg_temp.pendiente_y_pedir_cancelacion(p_k text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform pg_temp.armar(p_k);
  perform public.record_mercadopago_payment_snapshot(pg_temp.iid(p_k), (
    select jsonb_build_object(
      'provider_payment_id', 'PAY-' || right(replace(c.session_id::text, '-', ''), 12),
      'external_reference', 'taba2:checkout:' || c.session_id::text,
      'preference_id', pi.preference_id, 'merchant_order_id', 'MO-' || right(replace(c.session_id::text, '-', ''), 8),
      'collector_id', ps.collector_id, 'currency', 'ARS',
      'transaction_amount', pi.expected_amount::text, 'status', 'pending',
      'status_detail', 'pending_waiting_payment', 'payment_method', 'rapipago', 'live_mode', false,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0',
      'payer_email_hash', pg_temp.hash(), 'raw_response_hash', pg_temp.hash())
      from caso c
      join public.payment_intents pi on pi.id = c.intent_id
      join public.business_payment_settings ps on ps.business_id = c.business_id and ps.provider = 'mercadopago'
     where c.k = p_k), 'webhook', null);
  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated', 'session_id', owner_id)::text, true) from caso where k = p_k;
  v_id := (public.prepare_payment_cancellation(pg_temp.iid(p_k), gen_random_uuid()) ->> 'cancellation_id')::uuid;
  perform set_config('request.jwt.claims', '', true);
  return v_id;
end;
$$;

create function pg_temp.cancelacion(p_k text) returns public.payment_cancellations language sql as $$
  select c.* from public.payment_cancellations c where c.payment_intent_id = pg_temp.iid(p_k);
$$;
create function pg_temp.trabajos(p_k text) returns integer language sql as $$
  select count(*)::integer from public.payment_outbox o
   where o.payment_intent_id = pg_temp.iid(p_k) and o.topic = 'cancellation_reconcile';
$$;
create function pg_temp.eventos(p_k text) returns text language sql as $$
  select coalesce(string_agg(replace(e.event_type, 'payment.cancellation_', ''), ',' order by e.sequence), 'ninguno')
    from public.payment_events e
   where e.payment_intent_id = pg_temp.iid(p_k) and e.event_type like 'payment.cancellation\_%';
$$;
create function pg_temp.stock(p_k text) returns integer language sql as $$
  select p.stock from public.products p join caso c on p.id = c.product_id where c.k = p_k;
$$;
create function pg_temp.reserva(p_k text) returns text language sql as $$
  select string_agg(r.status, ',') from public.inventory_reservations r where r.checkout_session_id = pg_temp.sid(p_k);
$$;

-- ══ 1 · CONTRATO Y PRIVILEGIOS ══════════════════════════════════════════════
select ok(
  has_function_privilege('service_role', 'public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_payment_cancellation_response(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_payment_cancellation_response(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_payment_cancellation_response(uuid,text,text)', 'EXECUTE'),
  'los dos asientos de cancelacion siguen siendo solo del servicio');
select ok(
  has_function_privilege('service_role', 'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)', 'EXECUTE'),
  'prepare_mercadopago_preference_v2 conserva sus privilegios');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('mark_payment_cancellation_ambiguous', 'record_payment_cancellation_response', 'prepare_mercadopago_preference_v2')
      and p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  3, 'las tres siguen siendo SECURITY DEFINER con search_path fijado');

-- ══ 2 · CANCELACIÓN CONFIRMADA ═══════════════════════════════════════════════
select pg_temp.pendiente_y_pedir_cancelacion('c1');
select is((pg_temp.cancelacion('c1')).status || ' stock=' || pg_temp.stock('c1'), 'requested stock=8',
  'C1: cancelacion pedida, el stock sigue reservado');
-- El PUT venció: queda dudosa, con UN trabajo de conciliación.
select public.mark_payment_cancellation_ambiguous((pg_temp.cancelacion('c1')).id, pg_temp.hash(), 'network_or_timeout');
select is((pg_temp.cancelacion('c1')).status || '/' || pg_temp.trabajos('c1'), 'ambiguous/1', 'C1: dudosa con un trabajo');
select public.mark_payment_cancellation_ambiguous((pg_temp.cancelacion('c1')).id, pg_temp.hash(), 'http_502');
select is(pg_temp.trabajos('c1'), 1, 'C1: marcarla dudosa otra vez no encola un segundo trabajo activo');
-- La conciliación confirma la cancelación.
create temporary table h_c1 on commit drop as select pg_temp.hash() as h;
select is(
  (public.record_payment_cancellation_response((pg_temp.cancelacion('c1')).id, 'cancelled', (select h from h_c1)) ->> 'idempotent'),
  'false', 'C1: la cancelacion confirmada se asienta');
select is((pg_temp.cancelacion('c1')).status || ' ' || (select internal_status from public.payment_intents where id = pg_temp.iid('c1')),
  'cancelled cancelled', 'C1: solicitud y cobro cancelados');
select is(pg_temp.stock('c1') || ' ' || pg_temp.reserva('c1'), '10 released', 'C1: y el stock vuelve, como antes');
select ok((pg_temp.cancelacion('c1')).completed_at is not null, 'C1: con su fecha de cierre');
select is(pg_temp.eventos('c1'), 'cancelled', 'C1: un evento');

select is(
  (public.record_payment_cancellation_response((pg_temp.cancelacion('c1')).id, 'cancelled', pg_temp.hash()) ->> 'idempotent'),
  'true', 'C1: la misma respuesta otra vez es idempotente');
select is(pg_temp.eventos('c1') || ' stock=' || pg_temp.stock('c1'), 'cancelled stock=10',
  'C1: sin evento repetido y sin tocar stock');
select is(public.mark_payment_cancellation_ambiguous((pg_temp.cancelacion('c1')).id, pg_temp.hash(), 'network_or_timeout'), true,
  'C1: una marca dudosa tardia se acepta sin error');
select is((pg_temp.cancelacion('c1')).status || '/' || pg_temp.trabajos('c1'), 'cancelled/1',
  'C1: pero no degrada la cancelacion confirmada ni encola otro trabajo');
select is((pg_temp.cancelacion('c1')).raw_response_hash, (select h from h_c1),
  'C1: ni pisa la evidencia de la respuesta confirmada');
select throws_ok(format('select public.record_payment_cancellation_response(%L, %L, %L)', (pg_temp.cancelacion('c1')).id, 'rejected', pg_temp.hash()),
  '55000', 'resultado de cancelacion ya confirmado', 'C1: una respuesta contradictoria se rechaza');
select throws_ok(format('select public.record_payment_cancellation_response(%L, %L, %L)', (pg_temp.cancelacion('c1')).id, 'ambiguous', pg_temp.hash()),
  '55000', 'resultado de cancelacion ya confirmado', 'C1: y una dudosa tambien');
select is((pg_temp.cancelacion('c1')).status || ' ' || pg_temp.eventos('c1'), 'cancelled cancelled',
  'C1: la fila y sus eventos no cambiaron');

-- ══ 3 · CANCELACIÓN RECHAZADA ════════════════════════════════════════════════
select pg_temp.pendiente_y_pedir_cancelacion('c2');
select public.record_payment_cancellation_response((pg_temp.cancelacion('c2')).id, 'rejected', pg_temp.hash());
select is((pg_temp.cancelacion('c2')).status || ' stock=' || pg_temp.stock('c2') || ' ' || pg_temp.reserva('c2'),
  'rejected stock=8 active', 'C2: el rechazo del proveedor no libera stock (no cambia)');
select throws_ok(format('select public.record_payment_cancellation_response(%L, %L, %L)', (pg_temp.cancelacion('c2')).id, 'cancelled', pg_temp.hash()),
  '55000', 'resultado de cancelacion ya confirmado', 'C2: un rechazo confirmado tampoco se pisa con una cancelacion');
select public.mark_payment_cancellation_ambiguous((pg_temp.cancelacion('c2')).id, pg_temp.hash(), 'network_or_timeout');
select is((pg_temp.cancelacion('c2')).status || '/' || pg_temp.trabajos('c2') || ' stock=' || pg_temp.stock('c2'), 'rejected/0 stock=8',
  'C2: ni se degrada, ni se encola, ni se mueve stock');

-- ══ 4 · RESPUESTA NO FINAL REPETIDA ══════════════════════════════════════════
select pg_temp.pendiente_y_pedir_cancelacion('c3');
create temporary table h_c3 on commit drop as select pg_temp.hash() as h;
select public.record_payment_cancellation_response((pg_temp.cancelacion('c3')).id, 'ambiguous', (select h from h_c3));
select is(
  (public.record_payment_cancellation_response((pg_temp.cancelacion('c3')).id, 'ambiguous', (select h from h_c3)) ->> 'idempotent'),
  'true', 'C3: la misma respuesta no final (mismo hash) es idempotente');
select is(pg_temp.eventos('c3'), 'ambiguous', 'C3: un solo evento');
select is(
  (public.record_payment_cancellation_response((pg_temp.cancelacion('c3')).id, 'cancelled', pg_temp.hash()) ->> 'idempotent'),
  'false', 'C3: y despues puede resolverse como cancelada');
select is((pg_temp.cancelacion('c3')).status || ' ' || pg_temp.eventos('c3') || ' stock=' || pg_temp.stock('c3'),
  'cancelled ambiguous,cancelled stock=10', 'C3: cancelada, con sus dos eventos y el stock devuelto');

-- ══ 5 · LOS ERRORES DE SIEMPRE ═══════════════════════════════════════════════
select throws_ok(format('select public.record_payment_cancellation_response(%L, %L, %L)', (pg_temp.cancelacion('c3')).id, 'cancelled', 'no-es-un-hash'),
  '22023', 'respuesta de cancelacion invalida', 'una respuesta mal formada sigue dando 22023');
select throws_ok(format('select public.record_payment_cancellation_response(%L, null, %L)', (pg_temp.cancelacion('c1')).id, pg_temp.hash()),
  '22023', 'respuesta de cancelacion invalida', 'una respuesta sin estado sobre una cancelacion confirmada no pasa por idempotente');
select throws_ok(format('select public.record_payment_cancellation_response(%L, %L, %L)', gen_random_uuid(), 'cancelled', pg_temp.hash()),
  'P0002', 'cancelacion inexistente', 'una cancelacion inexistente sigue dando P0002');
select throws_ok(format('select public.mark_payment_cancellation_ambiguous(%L, %L, %L)', gen_random_uuid(), pg_temp.hash(), 'x'),
  'P0002', 'cancelacion inexistente', 'y marcar dudosa una inexistente tambien');

-- ══ 6 · LA PREFERENCIA SOBRE UN CHECKOUT VENCIDO ═════════════════════════════
select ok(
  position('preference_expired' in (select p.prosrc from pg_proc p where p.oid = 'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)'::regprocedure)) = 0,
  'la V2 ya no contiene la liberacion que su propia excepcion deshacia');
select ok(
  position('preference_expired' in (select p.prosrc from pg_proc p where p.oid = 'public.prepare_mercadopago_preference(uuid,uuid,boolean)'::regprocedure)) = 0,
  'la version anterior tampoco (o ya estaba retirada)');
select ok(
  position('raise exception ''checkout vencido'' using errcode = ''55000''' in
    (select p.prosrc from pg_proc p where p.oid = 'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)'::regprocedure)) > 0,
  'y conserva el error de checkout vencido');

select pg_temp.armar('v');
select is(
  (public.prepare_mercadopago_preference_v2(pg_temp.sid('v'), (select customer_id from caso where k = 'v'), false) ->> 'attempt_status'),
  'prepared', 'V: un checkout vigente sigue preparando su preferencia');
update public.checkout_sessions set created_at = clock_timestamp() - interval '20 minutes', expires_at = clock_timestamp() - interval '1 minute'
 where id = pg_temp.sid('v');
update public.inventory_reservations set created_at = clock_timestamp() - interval '20 minutes', expires_at = clock_timestamp() - interval '1 minute'
 where checkout_session_id = pg_temp.sid('v');
select throws_ok(
  format('select public.prepare_mercadopago_preference_v2(%L, %L, false)', pg_temp.sid('v'), (select customer_id from caso where k = 'v')),
  '55000', 'checkout vencido', 'V: vencido, el mismo error con el mismo codigo');
select is(pg_temp.stock('v') || ' ' || pg_temp.reserva('v') || ' ' || (select status from public.checkout_sessions where id = pg_temp.sid('v')),
  '8 active ready_for_payment', 'V: la preferencia no libero nada (antes tampoco: la excepcion lo deshacia)');
select public.expire_checkout_sessions(500);
select is(pg_temp.stock('v') || ' ' || pg_temp.reserva('v') || ' ' || (select status from public.checkout_sessions where id = pg_temp.sid('v')),
  '10 released expired', 'V: el que libera es el barrido');
select throws_ok(
  format('select public.prepare_mercadopago_preference_v2(%L, %L, false)', pg_temp.sid('v'), pg_temp.usuario('pc-otro')),
  '42501', 'checkout no autorizado', 'V: y un checkout ajeno sigue dando 42501');

select * from finish();
rollback;
