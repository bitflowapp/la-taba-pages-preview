-- TABA · UN «VACÍO» DEL PROVEEDOR NO ES PRUEBA DE QUE EL COMPRADOR NO PAGÓ (20261002060000)
--
-- Lo que pasó en Staging (2026-09-25): 8 sondas vacías en 30 minutos bajo una conexión del
-- vendedor que no era la que creó la preferencia, el barrido dejó de preguntar y la alerta
-- de checkout sin verificar calló. El pago estaba aprobado.
--
--   A  el vacío anota con qué conexión se buscó y si es concluyente
--   B  cuándo toca volver a preguntar: 8 concluyentes, tres tardías (2, 6 y 24 h), los no
--      concluyentes no gastan el tope pero esperan 30 minutos; los vacíos viejos (sin
--      marca) cuentan como concluyentes
--   C  el barrido encola la sonda tardía y no la temprana
--   D  la alerta sólo calla ante un vacío concluyente
--   E  la sonda tardía que encuentra el pago lo asienta por el camino de siempre
--   F  permisos, volatilidad y el texto del barrido
--
-- No depende de la hora: los momentos de los vacíos y de las sesiones se escriben a mano.
-- Todo transaccional (rollback). Ids aleatorios y cuentas acotadas a ellos: corre igual
-- sobre la base del gate, que nunca está vacía.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table pp_ids (name text primary key, id uuid not null) on commit drop;

create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from pp_ids where name = p_name
$$;

create function pg_temp.usuario(p_name text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
  insert into pp_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio abierto, de retiro, con un producto y el vendedor conectado por OAuth.
create function pg_temp.negocio(p_key text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario(p_key || ':owner');
  v_slug text := 'probe-empty-' || p_key || '-' || right(replace(v_business::text, '-', ''), 8);
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, alcohol_sales_enabled
  ) values (
    v_business, 'TABA sonda vacia ' || p_key, v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', false
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata ' || p_key,'Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    50,true,true,false,null,'{}',true,now(),v_owner,
    v_slug || '-sku',v_slug || '-sku','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-pp-' || v_slug, 'app-pp-' || v_slug, clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-pp-' || v_slug,'app-pp-' || v_slug,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into pp_ids values (p_key || ':business', v_business), (p_key || ':product', v_product);
end $$;

-- Un checkout con su preferencia creada por el camino de la función Edge (V2): el comprador
-- está en Checkout Pro. Guarda la sesión como p_name y el intent como p_name:intent.
create function pg_temp.checkout(p_name text, p_business_key text) returns uuid language plpgsql as $$
declare
  v_customer uuid := pg_temp.usuario(p_name || ':customer');
  v_business uuid := pg_temp.id(p_business_key || ':business');
  v_session uuid;
  v_prepare jsonb;
  v_attempt uuid;
begin
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business,
    'client_request_id', 'pp_' || md5(p_name || v_business::text),
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id(p_business_key || ':product'), 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Prueba', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago')) ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  v_attempt := (v_prepare ->> 'payment_attempt_id')::uuid;
  perform public.record_mercadopago_preference_created_v2(
    v_business, 'test', v_session, v_customer, v_attempt,
    public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer, v_attempt) ->> 'authority_version',
    'PREF-' || p_name || '-' || left(v_session::text, 8),
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_name,
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_name,
    encode(digest('pref-' || p_name || v_session::text, 'sha256'), 'hex'), 'req-' || p_name || '-' || left(v_session::text, 8));
  insert into pp_ids values (p_name, v_session);
  insert into pp_ids select p_name || ':intent', pi.id from public.payment_intents pi where pi.checkout_session_id = v_session;
  return v_session;
end $$;

-- Un vacío con su momento: p_conclusive null = un vacío viejo, sin la marca.
create function pg_temp.vacio(p_intent uuid, p_at timestamptz, p_conclusive boolean) returns void language plpgsql as $$
begin
  insert into public.payment_events (payment_intent_id, event_type, details, server_recorded_at)
  values (p_intent, 'payment.provider_probe_empty',
          case when p_conclusive is null then jsonb_build_object('source', 'provider_truth_sweep')
               else jsonb_build_object('source', 'provider_truth_sweep', 'conclusive', p_conclusive) end,
          p_at);
end $$;

-- p_n vacíos espaciados 3 minutos; el último en p_last.
create function pg_temp.vacios(p_intent uuid, p_n integer, p_last timestamptz, p_conclusive boolean) returns void language plpgsql as $$
begin
  delete from public.payment_events where payment_intent_id = p_intent and event_type = 'payment.provider_probe_empty';
  for g in 1 .. p_n loop
    perform pg_temp.vacio(p_intent, p_last - make_interval(mins => 3 * (p_n - g)), p_conclusive);
  end loop;
end $$;

create function pg_temp.ultimo_vacio(p_intent uuid) returns jsonb language sql stable as $$
  select pe.details from public.payment_events pe
   where pe.payment_intent_id = p_intent and pe.event_type = 'payment.provider_probe_empty'
   order by pe.server_recorded_at desc, pe.sequence desc limit 1
$$;

create function pg_temp.toca(p_intent uuid, p_created_ago interval) returns boolean language sql stable as $$
  select private.provider_probe_is_due(p_intent, clock_timestamp() - p_created_ago)
$$;

create function pg_temp.generacion(p_business_key text) returns uuid language sql stable as $$
  select generation from public.mp_seller_connections where business_id = pg_temp.id(p_business_key || ':business') and environment = 'test'
$$;

select pg_temp.negocio('a');
select pg_temp.negocio('b');
select pg_temp.checkout('c1', 'a');

-- ══════════════════════════════════════════════════════════════════════════
--  A · el vacío anota con qué conexión se buscó
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select pa.seller_generation from public.payment_attempts pa
     join public.payment_intents pi on pa.id = pi.current_payment_attempt_id
    where pi.id = pg_temp.id('c1:intent')),
  pg_temp.generacion('a'),
  'A: precondición: el intento guarda la generación de la conexión que creó la preferencia');

select public.record_provider_probe_empty(pg_temp.id('c1:intent'));
select is(pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'conclusive', 'true',
  'A: buscado con la misma conexión que creó la preferencia: el vacío es concluyente');
select is(pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'probe_seller_generation',
  pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'attempt_seller_generation',
  'A: y anota las dos generaciones, iguales');

-- Empezar a reconectar rota la generación (mp_begin_oauth) aunque los tokens sigan.
update public.mp_seller_connections set generation = gen_random_uuid()
 where business_id = pg_temp.id('a:business') and environment = 'test';
select public.record_provider_probe_empty(pg_temp.id('c1:intent'));
select is(pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'conclusive', 'false',
  'A: con otra generación de la conexión el vacío NO es concluyente');
select is(pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'probe_seller_generation', pg_temp.generacion('a')::text,
  'A: y anota la generación con la que se buscó');

update public.mp_seller_connections
   set generation = (pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'attempt_seller_generation')::uuid,
       status = 'requires_reauthorization'
 where business_id = pg_temp.id('a:business') and environment = 'test';
select public.record_provider_probe_empty(pg_temp.id('c1:intent'));
select is(pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'conclusive', 'false',
  'A: la misma generación con la conexión que pide reautorizar tampoco es concluyente');
update public.mp_seller_connections set status = 'connected'
 where business_id = pg_temp.id('a:business') and environment = 'test';

-- Modo directo: el intento no tiene generación de vendedor.
update public.payment_attempts pa set seller_generation = null
  from public.payment_intents pi
 where pi.id = pg_temp.id('c1:intent') and pa.id = pi.current_payment_attempt_id;
select public.record_provider_probe_empty(pg_temp.id('c1:intent'));
select is(pg_temp.ultimo_vacio(pg_temp.id('c1:intent')) ->> 'conclusive', 'true',
  'A: sin generación en el intento (modo directo) el vacío es concluyente, como hasta acá');

-- ══════════════════════════════════════════════════════════════════════════
--  B · cuándo toca volver a preguntar
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.vacios(pg_temp.id('c1:intent'), 0, clock_timestamp(), true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '10 minutes'), true, 'B: sin vacíos, toca');
select pg_temp.vacios(pg_temp.id('c1:intent'), 1, clock_timestamp() - interval '1 minute', true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '10 minutes'), false, 'B: un vacío hace 1 minuto: espera los 2 minutos');
select pg_temp.vacios(pg_temp.id('c1:intent'), 7, clock_timestamp() - interval '3 minutes', true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '30 minutes'), true, 'B: 7 concluyentes: toca la octava');
select pg_temp.vacios(pg_temp.id('c1:intent'), 8, clock_timestamp() - interval '3 minutes', true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '1 hour'), false, 'B: 8 concluyentes y el checkout de hace 1 hora: no toca');
select pg_temp.vacios(pg_temp.id('c1:intent'), 8, clock_timestamp() - interval '40 minutes', true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '3 hours'), true, 'B: 8 concluyentes y el checkout de hace 3 horas: toca la tardía de las 2 horas');
select pg_temp.vacios(pg_temp.id('c1:intent'), 9, clock_timestamp() - interval '40 minutes', true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '5 hours'), false, 'B: 9 concluyentes a las 5 horas: no toca');
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '7 hours'), true, 'B: 9 concluyentes a las 7 horas: toca la de las 6');
select pg_temp.vacios(pg_temp.id('c1:intent'), 10, clock_timestamp() - interval '40 minutes', true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '23 hours'), false, 'B: 10 concluyentes a las 23 horas: no toca');
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '25 hours'), true, 'B: 10 concluyentes a las 25 horas: toca la de las 24');
select pg_temp.vacios(pg_temp.id('c1:intent'), 11, clock_timestamp() - interval '40 minutes', true);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '40 hours'), false, 'B: 11 concluyentes: no pregunta más');
select pg_temp.vacios(pg_temp.id('c1:intent'), 20, clock_timestamp() - interval '31 minutes', false);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '3 hours'), true, 'B: 20 vacíos no concluyentes no gastan el tope: pasados 30 minutos, toca');
select pg_temp.vacios(pg_temp.id('c1:intent'), 20, clock_timestamp() - interval '10 minutes', false);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '3 hours'), false, 'B: el último no concluyente de hace 10 minutos: espera los 30');
select pg_temp.vacios(pg_temp.id('c1:intent'), 8, clock_timestamp() - interval '3 minutes', null);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '1 hour'), false, 'B: 8 vacíos viejos sin marca cuentan como concluyentes (como antes)');
select pg_temp.vacios(pg_temp.id('c1:intent'), 8, clock_timestamp() - interval '40 minutes', null);
select is(pg_temp.toca(pg_temp.id('c1:intent'), interval '3 hours'), true, 'B: y también tienen su sonda tardía');

-- ══════════════════════════════════════════════════════════════════════════
--  C · el barrido encola la sonda tardía y no la temprana
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('c4', 'a');
select pg_temp.checkout('c5', 'a');
update public.checkout_sessions set created_at = clock_timestamp() - interval '3 hours',
       expires_at = clock_timestamp() - interval '2 hours 45 minutes'
 where id = pg_temp.id('c4');
update public.checkout_sessions set created_at = clock_timestamp() - interval '1 hour',
       expires_at = clock_timestamp() - interval '45 minutes'
 where id = pg_temp.id('c5');
select pg_temp.vacios(pg_temp.id('c4:intent'), 8, clock_timestamp() - interval '40 minutes', true);
select pg_temp.vacios(pg_temp.id('c5:intent'), 8, clock_timestamp() - interval '40 minutes', true);
select ok(public.enqueue_checkout_provider_probes(200) >= 1, 'C: el barrido encola al menos la sonda tardía');
select is(
  (select count(*)::integer from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('c4:intent') and po.topic = 'payment_reconcile'
      and po.status in ('pending', 'claimed', 'processing', 'retry_wait')),
  1, 'C: el checkout de hace 3 horas con 8 vacíos recibe su sonda tardía');
select is(
  (select count(*)::integer from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('c5:intent') and po.topic = 'payment_reconcile'),
  0, 'C: el de hace 1 hora con 8 vacíos todavía no');

-- ══════════════════════════════════════════════════════════════════════════
--  D · la alerta sólo calla ante un vacío concluyente
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('c6', 'b');
select pg_temp.checkout('c7', 'b');
select pg_temp.checkout('c8', 'b');
update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours',
       expires_at = clock_timestamp() - interval '40 minutes'
 where id in (pg_temp.id('c6'), pg_temp.id('c7'), pg_temp.id('c8'));
select pg_temp.vacios(pg_temp.id('c6:intent'), 8, clock_timestamp() - interval '45 minutes', false);
select pg_temp.vacios(pg_temp.id('c7:intent'), 1, clock_timestamp() - interval '45 minutes', true);
select pg_temp.vacios(pg_temp.id('c8:intent'), 1, clock_timestamp() - interval '45 minutes', null);
select public.reconcile_operational_alerts_for_business(pg_temp.id('b:business'));
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id = pg_temp.id('b:business') and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED'
      and a.subject_id = pg_temp.id('c6:intent') and a.resolved_at is null),
  1, 'D: vacíos sólo no concluyentes: el checkout sigue sin verificar y la alerta está abierta');
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id = pg_temp.id('b:business') and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED'
      and a.subject_id = pg_temp.id('c7:intent') and a.resolved_at is null),
  0, 'D: con un vacío concluyente calla, como antes');
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id = pg_temp.id('b:business') and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED'
      and a.subject_id = pg_temp.id('c8:intent') and a.resolved_at is null),
  0, 'D: un vacío viejo sin marca cuenta como concluyente');
select is(
  (select (a.evidence ->> 'empty_probes')::integer from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('c6:intent')),
  8, 'D: la evidencia de la alerta cuenta los vacíos');

-- ══════════════════════════════════════════════════════════════════════════
--  E · la sonda tardía que encuentra el pago lo asienta por el camino de siempre
-- ══════════════════════════════════════════════════════════════════════════
select lives_ok($$
  select public.record_mercadopago_payment_snapshot(pg_temp.id('c4:intent'), jsonb_build_object(
      'provider_payment_id', 'PAY-PP-C4',
      'external_reference', pi.external_reference,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-PP-C4',
      'collector_id', ps.collector_id,
      'application_id', '',
      'currency', 'ARS',
      'transaction_amount', cs.total::text,
      'status', 'approved',
      'status_detail', 'accredited',
      'payment_method', 'visa',
      'live_mode', false,
      'provider_occurred_at', (clock_timestamp() - interval '2 hours 50 minutes')::text,
      'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(digest('pp-c4-approved', 'sha256'), 'hex')), 'reconciliation', null)
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.environment = 'test'
   where pi.id = pg_temp.id('c4:intent')
$$, 'E: el pago aprobado que trae la sonda tardía se asienta sin error');
select is(
  (select pi.provider_payment_id from public.payment_intents pi where pi.id = pg_temp.id('c4:intent')),
  'PAY-PP-C4', 'E: y el cobro queda a la vista: el intent ya tiene el pago del proveedor');

-- ══════════════════════════════════════════════════════════════════════════
--  F · permisos, volatilidad y el texto del barrido
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::integer from pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, 'private.provider_probe_is_due(uuid,timestamptz)'::regprocedure, 'EXECUTE'))
  + (case when has_function_privilege('public', 'private.provider_probe_is_due(uuid,timestamptz)'::regprocedure, 'EXECUTE') then 1 else 0 end),
  0, 'F: la función auxiliar no la ejecuta ningún rol de cliente');
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'private.provider_probe_is_due(uuid,timestamptz)'::regprocedure),
  's', 'F: y es STABLE (lee clock_timestamp)');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in ('public.record_provider_probe_empty(uuid)'::regprocedure,
                    'public.enqueue_checkout_provider_probes(integer)'::regprocedure,
                    'public.reconcile_operational_alerts_for_business(uuid)'::regprocedure)
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('public', p.oid, 'EXECUTE')),
  3, 'F: las tres siguen SECURITY DEFINER, con search_path fijado y EXECUTE sólo para service_role');
select ok(
  (select position('private.provider_probe_is_due(pi.id, cs.created_at)' in p.prosrc) > 0
      and position(') < 8' in p.prosrc) = 0
     from pg_proc p where p.oid = 'public.enqueue_checkout_provider_probes(integer)'::regprocedure),
  'F: el barrido decide con la función auxiliar y ya no corta en «8 vacíos cualesquiera»');

select * from finish();
rollback;
