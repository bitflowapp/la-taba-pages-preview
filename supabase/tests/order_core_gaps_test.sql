-- TABA · LO QUE LAS SUITES VIEJAS DEL NÚCLEO DE PEDIDOS PROBABAN Y NINGUNA PRUEBA DEL GATE PROBABA (TOOL-04)
--
-- order_end_to_end_chain, order_intake_dispatch_p0, order_intake_dispatch_audit y order_dispatch_audit
-- (*.local.sql) llaman funciones de pago v1 que el contrato A1-A4 retiró y nunca corrieron en CI. Casi
-- todo lo que afirmaban ya lo afirma el gate o el certificador; esto es lo que quedaba sin dueño:
--
--   A  el estado de un cobro no retrocede: el disparador payment_intents_zz_monotonic_status, directo
--   B  dos repartidores y un pedido por la cola: claim_delivery_order con revisión, y la cola que lo
--      muestra y lo deja de mostrar
--   C  un pedido ofrecido a un repartidor sigue en la cola abierta: otro lo puede tomar, la oferta deja
--      de verse en el tablero del primero y aceptarla después no lo reasigna
--   D  dos barridos seguidos con una sonda en curso dejan UN trabajo de sonda por cobro
--   E  ORDER_READY_WITHOUT_RIDER: se abre para un delivery listo hace más de 15 minutos sin repartidor,
--      no para un retiro ni antes de los 15 minutos, y se cierra sola cuando un repartidor lo toma
--   F  STOCK_RESERVATION_STUCK: se abre para la reserva de un checkout vencido que el barrido no pasó
--      y el barrido la cierra; la de un cobro en revisión el barrido no la toca (la alerta queda
--      abierta) y la lista de servicio da la receta del Panel, no la del barrido
--
-- Todo transaccional (rollback). Ids aleatorios y cuentas acotadas a ellos: corre igual sobre la base
-- del gate, que nunca está vacía.

begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table ocg_ids (name text primary key, id uuid not null) on commit drop;
create temporary table ocg_actores (actor text primary key, claims text not null) on commit drop;

create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from ocg_ids where name = p_name
$$;

create function pg_temp.usuario(p_name text, p_anonymous boolean) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',
          case when p_anonymous then null else 'ocg-' || left(v_id::text, 8) || '@example.invalid' end,
          '',case when p_anonymous then null else now() end,'{}','{}',p_anonymous,now(),now());
  insert into ocg_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio abierto, con retiro, un producto, el vendedor de Mercado Pago conectado en TEST, y su
-- equipo con sesión: dueño y empleado en el Panel, dos repartidores en la app.
create function pg_temp.negocio(p_key text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_slug text := 'ocg-' || p_key || '-' || right(replace(v_business::text, '-', ''), 8);
  v_member record;
begin
  perform pg_temp.usuario(p_key || ':owner', false);
  perform pg_temp.usuario(p_key || ':staff', false);
  perform pg_temp.usuario(p_key || ':rider_a', false);
  perform pg_temp.usuario(p_key || ':rider_b', false);
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, alcohol_sales_enabled
  ) values (
    v_business, 'TABA núcleo ' || p_key, v_slug, 'open', true, true, true,
    clock_timestamp(), pg_temp.id(p_key || ':owner'), 'ARS', true, false, 0.00, 0.00, 'off', false
  );
  for v_member in
    select * from (values ('owner', 'owner', 'panel_web'), ('staff', 'staff', 'panel_web'),
                          ('rider_a', 'rider', 'rider_android'), ('rider_b', 'rider', 'rider_android')) as t(k, role, client)
  loop
    insert into public.business_members (business_id, user_id, role, is_active)
    values (v_business, pg_temp.id(p_key || ':' || v_member.k), v_member.role, true);
    insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
    values (gen_random_uuid(), pg_temp.id(p_key || ':' || v_member.k), v_business, v_member.role, v_member.client);
    insert into ocg_actores
    select p_key || ':' || v_member.k,
           json_build_object('sub', s.user_id, 'role', 'authenticated', 'session_id', s.session_id)::text
      from public.identity_sessions s
     where s.user_id = pg_temp.id(p_key || ':' || v_member.k) and s.business_id = v_business;
  end loop;
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata ' || p_key,'Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    50,true,true,false,null,'{}',true,now(),pg_temp.id(p_key || ':owner'),
    v_slug || '-sku',v_slug || '-sku','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-ocg-' || v_slug, 'app-ocg-' || v_slug, clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-ocg-' || v_slug,'app-ocg-' || v_slug,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into ocg_ids values (p_key || ':business', v_business), (p_key || ':product', v_product);
end $$;

-- Actuar como alguien del equipo (sólo el JWT: las funciones de abajo son SECURITY DEFINER y deciden
-- por has_business_role / la sesión).
create function pg_temp.como(p_actor text) returns void language sql as $$
  select set_config('request.jwt.claims', (select claims from ocg_actores where actor = p_actor), true)::void
$$;
create function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void
$$;

-- Un checkout de retiro con su intent (create_checkout_session, la puerta de siempre).
create function pg_temp.checkout(p_name text, p_business_key text) returns uuid language plpgsql as $$
declare
  v_customer uuid := pg_temp.usuario(p_name || ':customer', true);
  v_session uuid;
begin
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', pg_temp.id(p_business_key || ':business'),
    'client_request_id', 'ocg_' || md5(p_name || pg_temp.id(p_business_key || ':business')::text),
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id(p_business_key || ':product'), 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Prueba', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago')) ->> 'checkout_session_id')::uuid;
  insert into ocg_ids values (p_name, v_session);
  insert into ocg_ids select p_name || ':intent', pi.id from public.payment_intents pi where pi.checkout_session_id = v_session;
  return v_session;
end $$;

-- Lo mismo, con la preferencia creada por el camino de la función Edge (V2) y la sesión de hace 3 minutos.
create function pg_temp.checkout_con_preferencia(p_name text, p_business_key text) returns uuid language plpgsql as $$
declare
  v_session uuid := pg_temp.checkout(p_name, p_business_key);
  v_customer uuid := pg_temp.id(p_name || ':customer');
  v_business uuid := pg_temp.id(p_business_key || ':business');
  v_attempt uuid;
begin
  v_attempt := (public.prepare_mercadopago_preference_v2(v_session, v_customer, false) ->> 'payment_attempt_id')::uuid;
  perform public.record_mercadopago_preference_created_v2(
    v_business, 'test', v_session, v_customer, v_attempt,
    public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer, v_attempt) ->> 'authority_version',
    'PREF-' || p_name || '-' || left(v_session::text, 8),
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_name,
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_name,
    encode(digest('pref-' || p_name || v_session::text, 'sha256'), 'hex'), 'req-' || p_name || '-' || left(v_session::text, 8));
  update public.checkout_sessions set created_at = clock_timestamp() - interval '3 minutes' where id = v_session;
  return v_session;
end $$;

-- Asienta un pago leído del proveedor, por el camino del worker.
create function pg_temp.pago(p_intent text, p_payment_id text, p_status text, p_detail text) returns jsonb language sql as $$
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
      'provider_occurred_at', (clock_timestamp() - interval '1 minute')::text,
      'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(digest(p_payment_id || ':' || p_status, 'sha256'), 'hex')), 'reconciliation', null)
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.environment = 'test'
   where pi.id = pg_temp.id(p_intent)
$$;

-- Vence un checkout y su reserva hace p_ago, sin pasar el barrido.
create function pg_temp.vencer(p_name text, p_ago interval) returns void language sql as $$
  update public.checkout_sessions set created_at = clock_timestamp() - p_ago - interval '20 minutes',
         expires_at = clock_timestamp() - p_ago
   where id = pg_temp.id(p_name);
  update public.inventory_reservations set created_at = clock_timestamp() - p_ago - interval '20 minutes',
         expires_at = clock_timestamp() - p_ago
   where checkout_session_id = pg_temp.id(p_name);
$$;

-- Un pedido delivery LISTO, sin repartidor, insertado directo (lo que se prueba es el despacho, no la
-- admisión): el mismo atajo que usan las suites de ofertas del repartidor.
create function pg_temp.pedido(p_name text, p_business_key text, p_mode text, p_ready_ago interval) returns uuid language plpgsql as $$
declare
  v_order uuid := gen_random_uuid();
  v_code text := 'OCG-' || upper(left(replace(v_order::text, '-', ''), 8));
begin
  insert into public.orders(
    id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
    client_request_id,customer_user_id,customer_name,customer_neighborhood,
    customer_street_address,customer_phone,payment_method,subtotal,delivery_fee,total,
    delivery_code_required,ready_at
  ) values (
    v_order, pg_temp.id(p_business_key || ':business'), v_code, v_code, 'ready', p_mode, p_mode,
    'ocg-' || p_name || '-' || left(v_order::text, 8), pg_temp.usuario(p_name || ':customer', false), 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro',
    'Mendoza 851', '+5492996209136', 'cash', 1000, 0, 1000,
    p_mode = 'delivery', clock_timestamp() - p_ready_ago
  );
  insert into ocg_ids values (p_name, v_order);
  return v_order;
end $$;

create function pg_temp.codigo(p_name text) returns text language sql stable as $$
  select public_code from public.orders where id = pg_temp.id(p_name)
$$;
create function pg_temp.revision(p_name text) returns bigint language sql stable as $$
  select revision from public.orders where id = pg_temp.id(p_name)
$$;
create function pg_temp.tomar(p_actor text, p_business_key text, p_name text, p_revision bigint, p_key text) returns jsonb language plpgsql as $$
declare v_out jsonb;
begin
  perform pg_temp.como(p_actor);
  v_out := public.claim_delivery_order(pg_temp.id(p_business_key || ':business'), pg_temp.codigo(p_name), p_revision, p_key);
  perform pg_temp.sin_sesion();
  return v_out;
end $$;
create function pg_temp.en_la_cola(p_actor text, p_business_key text, p_name text) returns boolean language plpgsql as $$
declare v_out boolean;
begin
  perform pg_temp.como(p_actor);
  v_out := exists (select 1 from public.list_available_rider_orders(pg_temp.id(p_business_key || ':business')) q
                    where q.public_code = pg_temp.codigo(p_name));
  perform pg_temp.sin_sesion();
  return v_out;
end $$;
create function pg_temp.alerta(p_code text, p_subject text) returns text language sql stable as $$
  select a.status from public.operational_alerts a where a.alert_code = p_code and a.subject_id = pg_temp.id(p_subject)
$$;

select pg_temp.negocio('a');

-- ══════════════════════════════════════════════════════════════════════════
--  A · el estado de un cobro no retrocede
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('c_completo', 'a');
select pg_temp.checkout('c_revision', 'a');
select pg_temp.checkout('c_r1', 'a');
select pg_temp.checkout('c_r2', 'a');
select pg_temp.checkout('c_r3', 'a');
select pg_temp.checkout('c_r4', 'a');
select pg_temp.checkout('c_r5', 'a');
select is(
  (select count(*)::integer from public.payment_intents
    where id in (select id from ocg_ids where name like 'c\_%:intent') and internal_status = 'created'),
  7, 'A: precondición: siete cobros recién creados');
update public.payment_intents set internal_status = 'completed' where id = pg_temp.id('c_completo:intent');
update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'ocg_fixture'
 where id in (select id from ocg_ids where name in ('c_revision:intent', 'c_r1:intent', 'c_r2:intent', 'c_r3:intent', 'c_r4:intent', 'c_r5:intent'));
select is(
  (select string_agg(internal_status, ',' order by internal_status) from public.payment_intents
    where id in (pg_temp.id('c_completo:intent'), pg_temp.id('c_revision:intent'))),
  'completed,security_review_required', 'A: precondición: avanzar siempre se puede');
select throws_ok(
  format($q$update public.payment_intents set internal_status = 'pending' where id = %L$q$, pg_temp.id('c_completo:intent')),
  '22023', 'payment intent status regression: completed -> pending',
  'A: un cobro completado no vuelve a pendiente, aunque lo escriba alguien con permiso sobre la tabla');
select throws_ok(
  format($q$update public.payment_intents set internal_status = 'pending' where id = %L$q$, pg_temp.id('c_revision:intent')),
  '22023', 'payment intent status regression: security_review_required -> pending',
  'A: un cobro en revisión no vuelve a pendiente');
select throws_ok(
  format($q$update public.payment_intents set internal_status = 'redirected' where id = %L$q$, pg_temp.id('c_revision:intent')),
  '22023', 'payment intent status regression: security_review_required -> redirected',
  'A: ni a «redirigido»');
select throws_ok(
  format($q$update public.payment_intents set internal_status = 'expired' where id = %L$q$, pg_temp.id('c_revision:intent')),
  '22023', 'payment intent status regression: security_review_required -> expired',
  'A: ni a vencido');
select throws_ok(
  format($q$update public.payment_intents set internal_status = 'rejected' where id = %L$q$, pg_temp.id('c_revision:intent')),
  '22023', 'payment intent status regression: security_review_required -> rejected',
  'A: ni a rechazado');
select lives_ok(
  format($q$update public.payment_intents set internal_status = 'completed' where id = %L$q$, pg_temp.id('c_r1:intent')),
  'A: la revisión se resuelve hacia completado (el pedido se armó)');
select lives_ok(
  format($q$update public.payment_intents set internal_status = 'approved_order_pending' where id = %L$q$, pg_temp.id('c_r2:intent')),
  'A: hacia aprobado con el pedido por armar');
select lives_ok(
  format($q$update public.payment_intents set internal_status = 'refunded' where id = %L$q$, pg_temp.id('c_r3:intent')),
  'A: hacia devuelto');
select lives_ok(
  format($q$update public.payment_intents set internal_status = 'partially_refunded' where id = %L$q$, pg_temp.id('c_r4:intent')),
  'A: hacia devuelto en parte');
select lives_ok(
  format($q$update public.payment_intents set internal_status = 'charged_back' where id = %L$q$, pg_temp.id('c_r5:intent')),
  'A: y hacia contracargo');
-- La revisión del cobro la lleva el disparador: escribirla a mano no la fija.
create temporary table ocg_rev on commit drop as
  select revision from public.payment_intents where id = pg_temp.id('c_completo:intent');
update public.payment_intents set revision = 999, provider_status_detail = 'ocg-cambio' where id = pg_temp.id('c_completo:intent');
select is(
  (select revision from public.payment_intents where id = pg_temp.id('c_completo:intent')),
  (select revision + 1 from ocg_rev), 'A: la revisión la lleva el disparador: un 999 escrito a mano queda en la anterior + 1');

-- ══════════════════════════════════════════════════════════════════════════
--  B · dos repartidores y un pedido por la cola
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.pedido('p_cola', 'a', 'delivery', interval '2 minutes');
select is(pg_temp.en_la_cola('a:rider_a', 'a', 'p_cola'), true, 'B: el pedido listo y sin repartidor está en la cola de A');
select is(pg_temp.en_la_cola('a:rider_b', 'a', 'p_cola'), true, 'B: y en la de B');
create temporary table ocg_r on commit drop as select pg_temp.revision('p_cola') as r;
select is(pg_temp.tomar('a:rider_a', 'a', 'p_cola', (select r from ocg_r), 'ocg-claim-a-0001') ->> 'outcome', 'claimed',
  'B: A lo toma con la revisión que vio');
select is(pg_temp.tomar('a:rider_b', 'a', 'p_cola', (select r from ocg_r), 'ocg-claim-b-0001') ->> 'code', 'stale_revision',
  'B: B, con la misma revisión, recibe «la cola cambió»');
select is(pg_temp.tomar('a:rider_b', 'a', 'p_cola', pg_temp.revision('p_cola'), 'ocg-claim-b-0002') ->> 'code', 'taken_by_other',
  'B: y con la revisión nueva, «otro lo tomó primero»');
select is(
  (select status || '/' || (assigned_rider_user_id = pg_temp.id('a:rider_a'))::text from public.orders where id = pg_temp.id('p_cola')),
  'assigned/true', 'B: el pedido queda asignado a A');
select is(pg_temp.tomar('a:rider_a', 'a', 'p_cola', (select r from ocg_r), 'ocg-claim-a-0001') ->> 'idempotent_no_op', 'true',
  'B: el reintento de A con su clave devuelve lo mismo sin tocar nada');
select is(pg_temp.en_la_cola('a:rider_b', 'a', 'p_cola'), false, 'B: tomado, sale de la cola');

-- ══════════════════════════════════════════════════════════════════════════
--  C · un pedido ofrecido a un repartidor sigue en la cola abierta
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.pedido('p_oferta', 'a', 'delivery', interval '2 minutes');
select pg_temp.como('a:staff');
create temporary table ocg_oferta on commit drop as
  select public.offer_order_to_rider(pg_temp.id('p_oferta'), 'ready', null, pg_temp.id('a:rider_b')) as r;
select pg_temp.sin_sesion();
select is((select r ->> 'code' from ocg_oferta), 'offered', 'C: el comercio le ofrece el pedido a B');
select is(pg_temp.en_la_cola('a:rider_a', 'a', 'p_oferta'), true,
  'C: la oferta no lo saca de la cola abierta: A lo sigue viendo');
select is(pg_temp.tomar('a:rider_a', 'a', 'p_oferta', pg_temp.revision('p_oferta'), 'ocg-claim-a-0002') ->> 'outcome', 'claimed',
  'C: y lo puede tomar');
select pg_temp.como('a:rider_b');
select is(
  (select jsonb_array_length(public.get_rider_delivery_board() -> 'offers')),
  0, 'C: la oferta a B deja de verse en su tablero (el pedido ya se movió)');
select is(
  public.accept_rider_order_offer((select (r ->> 'offer_id')::uuid from ocg_oferta), 1, 'ocg-accept-b-0001') ->> 'code',
  'order_unavailable', 'C: y si B la acepta igual, se le contesta que el pedido ya no está');
select pg_temp.sin_sesion();
select is(
  (select assigned_rider_user_id = pg_temp.id('a:rider_a') from public.orders where id = pg_temp.id('p_oferta')),
  true, 'C: el pedido sigue con A: nadie queda con el mismo pedido dos veces');

-- ══════════════════════════════════════════════════════════════════════════
--  D · dos barridos seguidos con una sonda en curso: un trabajo por cobro
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout_con_preferencia('c_sonda', 'a');
select public.enqueue_checkout_provider_probes(200);
select public.enqueue_checkout_provider_probes(200);
select is(
  (select count(*)::integer from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('c_sonda:intent') and po.topic = 'payment_reconcile'
      and po.status in ('pending', 'claimed', 'processing', 'retry_wait')),
  1, 'D: dos barridos seguidos dejan una sola sonda activa para el cobro');

-- ══════════════════════════════════════════════════════════════════════════
--  E · ORDER_READY_WITHOUT_RIDER
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.pedido('p_demorado', 'a', 'delivery', interval '16 minutes');
select pg_temp.pedido('p_reciente', 'a', 'delivery', interval '10 minutes');
select pg_temp.pedido('p_retiro', 'a', 'pickup', interval '40 minutes');
select public.reconcile_operational_alerts_for_business(pg_temp.id('a:business'));
select is(pg_temp.alerta('ORDER_READY_WITHOUT_RIDER', 'p_demorado'), 'open',
  'E: un delivery listo hace 16 minutos sin repartidor abre la alerta');
select is(
  (select a.severity || '|' || (a.evidence ->> 'public_code') from public.operational_alerts a
    where a.alert_code = 'ORDER_READY_WITHOUT_RIDER' and a.subject_id = pg_temp.id('p_demorado')),
  'ACTION_REQUIRED|' || pg_temp.codigo('p_demorado'), 'E: accionable, con el código del pedido');
select is(pg_temp.alerta('ORDER_READY_WITHOUT_RIDER', 'p_reciente'), null, 'E: uno listo hace 10 minutos todavía no');
select is(pg_temp.alerta('ORDER_READY_WITHOUT_RIDER', 'p_retiro'), null, 'E: un retiro no la abre nunca');
select is(pg_temp.tomar('a:rider_b', 'a', 'p_demorado', pg_temp.revision('p_demorado'), 'ocg-claim-b-0003') ->> 'outcome', 'claimed',
  'E: B toma el pedido demorado');
select public.reconcile_operational_alerts_for_business(pg_temp.id('a:business'));
select is(pg_temp.alerta('ORDER_READY_WITHOUT_RIDER', 'p_demorado'), 'resolved', 'E: y la alerta se cierra sola');

-- ══════════════════════════════════════════════════════════════════════════
--  F · STOCK_RESERVATION_STUCK
-- ══════════════════════════════════════════════════════════════════════════
-- s1: el comprador no pagó y el barrido no pasó. s2: el pago llegó aprobado DESPUÉS del vencimiento y
-- antes del barrido: revisión manual, y la reserva queda retenida a propósito (no hay pedido todavía).
select pg_temp.checkout_con_preferencia('s1', 'a');
select pg_temp.checkout_con_preferencia('s2', 'a');
select pg_temp.vencer('s1', interval '6 minutes');
select pg_temp.vencer('s2', interval '6 minutes');
select is(pg_temp.pago('s2:intent', 'PAY-OCG-S2', 'approved', 'accredited') ->> 'manual_review_required', 'true',
  'F: precondición: el cobro aprobado después del vencimiento va a revisión manual');
select public.reconcile_operational_alerts_for_business(pg_temp.id('a:business'));
select is(pg_temp.alerta('STOCK_RESERVATION_STUCK', 's1'), 'open', 'F: la reserva vencida que el barrido no pasó abre la alerta');
select is(pg_temp.alerta('STOCK_RESERVATION_STUCK', 's2'), 'open', 'F: la del cobro en revisión también');
select is(
  (select l.state || ' -> ' || l.action from public.list_stock_reservation_alerts() l where l.checkout_session_id = pg_temp.id('s2')),
  'stock_held_by_checkout_in_manual_review -> recover_order_or_refund_payment_from_panel',
  'F: la lista de servicio nombra el estado y receta el Panel (rearmar o devolver), no el barrido');
select public.sweep_expired_checkout_sessions();
select public.reconcile_operational_alerts_for_business(pg_temp.id('a:business'));
select is(pg_temp.alerta('STOCK_RESERVATION_STUCK', 's1'), 'resolved', 'F: el barrido libera la reserva vencida y la alerta se cierra sola');
select is(
  (select string_agg(r.status, ',') from public.inventory_reservations r where r.checkout_session_id = pg_temp.id('s2')),
  'active', 'F: el barrido no toca la reserva del cobro en revisión');
select is(pg_temp.alerta('STOCK_RESERVATION_STUCK', 's2'), 'open',
  'F: y su alerta sigue abierta: la cierra rearmar el pedido o devolver el cobro, no el barrido');

select * from finish();
rollback;
