-- TABA · EL BARRIDO DE ALERTAS NO SALTEA UN NEGOCIO CERRADO CON COBROS EN MOVIMIENTO (20261003092000)
--
-- «Cerrado» es el estado que deja el botón de fin de día del Panel. evaluate_operational_alerts_sweep()
-- salteaba un negocio cerrado sin alertas abiertas: lo que llegaba después del cierre no se veía hasta
-- abrir, y un checkout sin verificar de un negocio cerrado más de 30 días no abría nunca su alerta.
--
--   A  cerrado y con un cobro que se movió hoy: se evalúa, y el checkout sin verificar abre su alerta
--   B  cerrado y sin ningún cobro: se sigue salteando (un pedido listo sin repartidor no abre nada);
--      con cobros de hace más de 30 días, también
--   C  el mismo pedido en un negocio abierto sí abre la alerta: lo que cambia es sólo a quién se evalúa
--   D  la función sigue igual en lo demás: SECURITY DEFINER, search_path y permisos
--
-- Todo transaccional (rollback). El barrido evalúa todos los negocios de la base: las cuentas se acotan
-- a los de esta prueba.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table cbs_ids (name text primary key, id uuid not null) on commit drop;
create temporary table cbs_actores (actor text primary key, claims text not null) on commit drop;

create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from cbs_ids where name = p_name
$$;

create function pg_temp.usuario(p_name text, p_anonymous boolean) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',
          case when p_anonymous then null else 'cbs-' || left(v_id::text, 8) || '@example.invalid' end,
          '',case when p_anonymous then null else now() end,'{}','{}',p_anonymous,now(),now());
  insert into cbs_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio abierto, de retiro, con un producto, el vendedor conectado por OAuth y su equipo
-- (dueño, encargado y empleado, cada uno con su sesión del Panel).
create function pg_temp.negocio(p_key text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario(p_key || ':owner', false);
  v_admin uuid := pg_temp.usuario(p_key || ':admin', false);
  v_staff uuid := pg_temp.usuario(p_key || ':staff', false);
  v_slug text := 'closed-sweep-' || p_key || '-' || right(replace(v_business::text, '-', ''), 8);
  v_member record;
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, alcohol_sales_enabled
  ) values (
    v_business, 'TABA cerrado ' || p_key, v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', false
  );
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true), (v_business, v_admin, 'admin', true), (v_business, v_staff, 'staff', true);
  for v_member in
    select * from (values ('owner', v_owner), ('admin', v_admin), ('staff', v_staff)) as t(role, user_id)
  loop
    insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
    values (gen_random_uuid(), v_member.user_id, v_business, v_member.role, 'panel_web');
    insert into cbs_actores
    select p_key || ':' || v_member.role,
           json_build_object('sub', v_member.user_id, 'role', 'authenticated', 'session_id', s.session_id)::text
      from public.identity_sessions s
     where s.user_id = v_member.user_id and s.business_id = v_business;
  end loop;
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
    'collector-cbs-' || v_slug, 'app-cbs-' || v_slug, clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-cbs-' || v_slug,'app-cbs-' || v_slug,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into cbs_ids values (p_key || ':business', v_business), (p_key || ':product', v_product);
end $$;

-- Un checkout con su preferencia creada por el camino de la función Edge (V2), ya vencido:
-- creado hace p_created_ago, vencido 20 minutos después, intent «expired» por el barrido.
create function pg_temp.checkout(p_name text, p_business_key text, p_created_ago interval) returns uuid language plpgsql as $$
declare
  v_customer uuid := pg_temp.usuario(p_name || ':customer', true);
  v_business uuid := pg_temp.id(p_business_key || ':business');
  v_session uuid;
  v_prepare jsonb;
  v_attempt uuid;
begin
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business,
    'client_request_id', 'cbs_' || md5(p_name || v_business::text),
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
  update public.checkout_sessions
     set created_at = clock_timestamp() - p_created_ago,
         expires_at = clock_timestamp() - p_created_ago + interval '20 minutes'
   where id = v_session;
  insert into cbs_ids values (p_name, v_session);
  insert into cbs_ids select p_name || ':intent', pi.id from public.payment_intents pi where pi.checkout_session_id = v_session;
  return v_session;
end $$;

create function pg_temp.vacios(p_intent uuid, p_n integer, p_last timestamptz, p_conclusive boolean) returns void language plpgsql as $$
begin
  delete from public.payment_events where payment_intent_id = p_intent and event_type = 'payment.provider_probe_empty';
  for g in 1 .. p_n loop
    insert into public.payment_events (payment_intent_id, event_type, details, server_recorded_at)
    values (p_intent, 'payment.provider_probe_empty',
            jsonb_build_object('source', 'provider_truth_sweep', 'conclusive', p_conclusive),
            p_last - make_interval(mins => 3 * (p_n - g)));
  end loop;
end $$;

create function pg_temp.alerta(p_intent text) returns text language sql stable as $$
  select a.status from public.operational_alerts a
   where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id(p_intent)
$$;

create function pg_temp.reconciliar(p_business_key text) returns integer language sql as $$
  select public.reconcile_operational_alerts_for_business(pg_temp.id(p_business_key || ':business'))
$$;

create function pg_temp.sonda_pendiente(p_intent text) returns integer language sql stable as $$
  select count(*)::integer from public.payment_outbox po
   where po.payment_intent_id = pg_temp.id(p_intent) and po.topic = 'payment_reconcile'
     and po.status in ('pending', 'claimed', 'processing', 'retry_wait')
$$;

-- Resuelve la alerta del cobro con la sesión de p_actor, como el Panel.
create function pg_temp.resolver(p_actor text, p_intent text) returns text language plpgsql as $$
declare
  v_out jsonb;
  v_alert uuid := (select a.id from public.operational_alerts a
                    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id(p_intent));
begin
  perform set_config('request.jwt.claims', (select claims from cbs_actores where actor = p_actor), true);
  set local role authenticated;
  v_out := public.transition_operational_alert(v_alert, 'resolved', 'Busqué la referencia en Mercado Pago: no hay ningún pago.');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out ->> 'status';
end $$;

-- Asienta un pago leído del proveedor, por el camino del worker.
create function pg_temp.pago(p_intent text, p_payment_id text, p_status text, p_detail text, p_variant text default '')
returns jsonb language sql as $$
  select public.record_mercadopago_payment_snapshot(pg_temp.id(p_intent), jsonb_build_object(
      'provider_payment_id', p_payment_id,
      'external_reference', pi.external_reference,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-' || p_payment_id,
      'collector_id', ps.collector_id,
      'application_id', '',
      'currency', 'ARS',
      'transaction_amount', cs.total::text,
      'status', p_status,
      'status_detail', p_detail,
      'payment_method', 'visa',
      'live_mode', false,
      'provider_occurred_at', (clock_timestamp() - interval '46 hours 50 minutes')::text,
      'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(digest(p_payment_id || ':' || p_status || p_variant, 'sha256'), 'hex')), 'reconciliation', null)
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.environment = 'test'
   where pi.id = pg_temp.id(p_intent)
$$;


create function pg_temp.pedido_listo(p_name text, p_business_key text) returns uuid language plpgsql as $$
declare v_order uuid := gen_random_uuid(); v_code text := 'CBS-' || upper(left(replace(v_order::text, '-', ''), 8));
begin
  insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,
    customer_user_id,customer_name,customer_neighborhood,customer_street_address,customer_phone,payment_method,
    subtotal,delivery_fee,total,delivery_code_required,ready_at)
  values (v_order, pg_temp.id(p_business_key || ':business'), v_code, v_code, 'ready', 'delivery', 'delivery',
    'cbs-request-' || p_name || '-' || left(v_order::text, 8), pg_temp.usuario(p_name || ':customer', false), 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro',
    'Mendoza 851', '+5492996209136', 'cash', 1000, 0, 1000, true, clock_timestamp() - interval '20 minutes');
  insert into cbs_ids values (p_name, v_order);
  return v_order;
end $$;
create function pg_temp.alerta_de(p_code text, p_subject text) returns text language sql stable as $$
  select a.status from public.operational_alerts a where a.alert_code = p_code and a.subject_id = pg_temp.id(p_subject)
$$;

-- k: un checkout que llegó a Mercado Pago hace 45 minutos, venció, y ninguna sonda probó nada. Después el
-- dueño cierra el negocio con el botón de fin de día, antes de que corra la reconciliación.
select pg_temp.negocio('k');
select pg_temp.checkout('k1', 'k', interval '45 minutes');
select public.sweep_expired_checkout_sessions();
select pg_temp.vacios(pg_temp.id('k1:intent'), 3, clock_timestamp() - interval '10 minutes', false);
update public.businesses set status = 'closed' where id = pg_temp.id('k:business');
-- z: cerrado y sin ningún cobro, con un pedido delivery listo hace 20 minutos sin repartidor.
-- y: lo mismo, abierto.
select pg_temp.negocio('z');
select pg_temp.negocio('y');
select pg_temp.pedido_listo('z1', 'z');
select pg_temp.pedido_listo('y1', 'y');
update public.businesses set status = 'closed' where id = pg_temp.id('z:business');
-- w: cerrado, con un cobro de hace 40 días y el mismo pedido listo.
select pg_temp.negocio('w');
select pg_temp.checkout('w1', 'w', interval '40 days');
update public.payment_intents set created_at = clock_timestamp() - interval '40 days' where id = pg_temp.id('w1:intent');
select pg_temp.pedido_listo('w2', 'w');
update public.businesses set status = 'closed' where id = pg_temp.id('w:business');
-- Crear un pedido patea la sonda del planificador (orders_kick_scheduler_watchdog) y, como en esta base
-- pg_cron no corre, abre SCHEDULER_WATCHDOG_STALE. En un entorno con el planificador vivo no existiría:
-- se cierra acá para que «sin alertas abiertas» sea cierto.
update public.operational_alerts set status = 'resolved', resolved_at = clock_timestamp(),
       resolution_note = 'fixture: en esta base no corre pg_cron'
 where business_id in (pg_temp.id('z:business'), pg_temp.id('y:business'), pg_temp.id('w:business'))
   and alert_code = 'SCHEDULER_WATCHDOG_STALE' and status <> 'resolved';

select is(
  (select count(*)::integer from public.operational_alerts
    where business_id in (pg_temp.id('k:business'), pg_temp.id('z:business'), pg_temp.id('y:business'), pg_temp.id('w:business'))
      and status <> 'resolved'),
  0, 'precondición: ninguno de los cuatro tiene alertas abiertas');
select is(
  (select string_agg(status, ',' order by name) from public.businesses
    where id in (pg_temp.id('k:business'), pg_temp.id('z:business'), pg_temp.id('y:business'))),
  'closed,open,closed', 'precondición: k y z cerrados, y abierto');

select public.evaluate_operational_alerts_sweep();

-- ══ A ══
select is(pg_temp.alerta_de('CHECKOUT_PROVIDER_UNVERIFIED', 'k1:intent'), 'open',
  'A: cerrado y con un cobro que se movió hoy, se evalúa: el checkout sin verificar abre su alerta esa misma noche');
select is(
  (select a.severity from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('k1:intent')),
  'CRITICAL', 'A: crítica, como siempre');
-- ══ B ══
select is(pg_temp.alerta_de('ORDER_READY_WITHOUT_RIDER', 'z1'), null,
  'B: cerrado y sin cobros, se sigue salteando: el pedido listo sin repartidor no abre nada');
select is(pg_temp.alerta_de('ORDER_READY_WITHOUT_RIDER', 'w2'), null,
  'B: cerrado y con su último cobro de hace 40 días, también: el límite de 30 días vale');
-- ══ C ══
select is(pg_temp.alerta_de('ORDER_READY_WITHOUT_RIDER', 'y1'), 'open',
  'C: el mismo pedido en un negocio abierto sí abre la alerta');
-- ══ D ══
select ok(
  (select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')
     from pg_proc p where p.oid = 'public.evaluate_operational_alerts_sweep()'::regprocedure),
  'D: sigue SECURITY DEFINER con search_path fijado');
select ok(
  (select has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     from pg_proc p where p.oid = 'public.evaluate_operational_alerts_sweep()'::regprocedure),
  'D: y sólo service_role la ejecuta');

select * from finish();
rollback;
