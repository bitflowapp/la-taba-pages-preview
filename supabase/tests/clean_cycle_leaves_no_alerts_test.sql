-- TABA · UN CICLO LIMPIO NO DEJA NINGUNA ALERTA ABIERTA
--
-- Lo afirmaba order_end_to_end_chain.local.sql (paso 15, «sin una sola alerta abierta al terminar»), que
-- llama la API de pagos v1 retirada y nunca corrió en un gate: quedó en el mapa de TOOL-04 como prueba
-- sin portar. Las alertas que dicen la verdad también tienen que callarse cuando no pasa nada: una alerta
-- falsa después de un pedido normal enseña a ignorarlas.
--
--   A  un cobro de Mercado Pago con retiro, de punta a punta: checkout, preferencia, aviso firmado, pago
--      aprobado, pedido (el Panel lo ve una vez, como pedido de Mercado Pago, y el checkout deja de figurar
--      como pendiente), aceptado, preparado, listo y entregado en el local
--   B  un pedido en efectivo con envío, de punta a punta: la dirección confirmada, aceptado, preparado,
--      cobrado, listo, tomado por un repartidor, retirado, en camino, llegó, y el código del cliente
--   C  con el planificador sano, la reconciliación de alertas del comercio no deja ninguna abierta (ni
--      abrió una en todo el ciclo), y el dinero y el stock cierran
--
-- Todo transaccional (rollback). Ids aleatorios y cuentas acotadas a este comercio.

begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

do $precondition$
begin
  if not has_table_privilege(current_user, 'cron.job_run_details', 'INSERT') then
    raise exception 'PRECONDICION: el rol % necesita INSERT sobre cron.job_run_details para armar el historial de prueba (grant insert on cron.job_run_details to %)',
      current_user, current_user using errcode = '42501';
  end if;
end
$precondition$;

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table ccl_ids (name text primary key, id uuid not null) on commit drop;
create temporary table ccl_texto (name text primary key, value text not null) on commit drop;
create temporary table ccl_actores (actor text primary key, claims text not null) on commit drop;

create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from ccl_ids where name = p_name
$$;
create function pg_temp.texto(p_name text) returns text language sql stable as $$
  select value from ccl_texto where name = p_name
$$;
create function pg_temp.rev(p_name text) returns bigint language sql stable as $$
  select revision from public.orders where id = pg_temp.id(p_name)
$$;

create function pg_temp.usuario(p_name text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated','ccl-' || left(v_id::text, 8) || '@example.invalid','',now(),'{}','{}',now(),now());
  insert into ccl_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio abierto con retiro y envío, un producto con stock, el vendedor de Mercado Pago conectado
-- en TEST, y su equipo con sesión: dueño y empleado en el Panel, un repartidor en la app.
do $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_slug text := 'ccl-' || right(replace(v_business::text, '-', ''), 8);
  v_member record;
begin
  perform pg_temp.usuario('owner');
  perform pg_temp.usuario('staff');
  perform pg_temp.usuario('rider');
  perform pg_temp.usuario('customer');
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'TABA ciclo limpio', v_slug, 'open', true, true, true,
    clock_timestamp(), pg_temp.id('owner'), 'ARS', true, true, 500.00, 0.00
  );
  for v_member in
    select * from (values ('owner', 'owner', 'panel_web'), ('staff', 'staff', 'panel_web'),
                          ('rider', 'rider', 'rider_android')) as t(k, role, client)
  loop
    insert into public.business_members (business_id, user_id, role, is_active)
    values (v_business, pg_temp.id(v_member.k), v_member.role, true);
    insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
    values (gen_random_uuid(), pg_temp.id(v_member.k), v_business, v_member.role, v_member.client);
    insert into ccl_actores
    select v_member.k, json_build_object('sub', s.user_id, 'role', 'authenticated', 'session_id', s.session_id)::text
      from public.identity_sessions s
     where s.user_id = pg_temp.id(v_member.k) and s.business_id = v_business;
  end loop;
  insert into ccl_actores values ('customer', json_build_object('sub', pg_temp.id('customer'), 'role', 'authenticated')::text);
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata ciclo','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    50,true,true,false,null,'{}',true,now(),pg_temp.id('owner'),
    v_slug || '-sku',v_slug || '-sku','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-' || v_slug, 'app-' || v_slug, clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-' || v_slug,'app-' || v_slug,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into ccl_ids values ('business', v_business), ('product', v_product);
end $$;

create function pg_temp.como(p_actor text) returns void language sql as $$
  select set_config('request.jwt.claims', (select claims from ccl_actores where actor = p_actor), true)::void
$$;
create function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void
$$;
create function pg_temp.mover(p_order text, p_status text, p_key text) returns jsonb language plpgsql as $$
declare v_out jsonb;
begin
  perform pg_temp.como('staff');
  v_out := public.transition_order(pg_temp.id(p_order), pg_temp.rev(p_order), p_status, p_key);
  perform pg_temp.sin_sesion();
  return v_out;
end $$;

-- El planificador como lo deja pg_cron cuando todo anda (en esta base no corre): cada tarea del inventario
-- existe, está activa y corrió recién, y el barrido de alertas dejó su latido. Va antes del ciclo porque dar
-- de alta un pedido patea la sonda del planificador, que con pg_cron parado abre SCHEDULER_WATCHDOG_STALE.
create function pg_temp.run(p_job text) returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'prueba', 'succeeded', 'ok',
         clock_timestamp() - interval '20 seconds', clock_timestamp() - interval '19 seconds'
    from cron.job j where j.jobname = p_job;
$$;
select cron.schedule(e.job_name, '* * * * *', 'select 1') from private.scheduler_expected_jobs e
 where not exists (select 1 from cron.job j where j.jobname = e.job_name);
select cron.alter_job(j.jobid, active => true) from cron.job j where j.jobname like 'taba-%' and not j.active;
select pg_temp.run(j.jobname) from cron.job j where j.jobname like 'taba-%';
insert into public.operational_sweep_runs (scope, status, started_at, finished_at)
values ('operational_alerts', 'ok', clock_timestamp(), clock_timestamp());
select ok((public.scheduler_heartbeat() ->> 'healthy')::boolean, 'A0 precondición: el planificador está sano');

-- ══════════════════════════════════════════════════════════════════════════
--  A · Mercado Pago, retiro
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_session uuid;
  v_prepare jsonb;
  v_intent uuid;
  v_receipt uuid;
  v_job uuid;
  v_res jsonb;
begin
  v_res := public.create_checkout_session(pg_temp.id('customer'), jsonb_build_object(
    'business_id', pg_temp.id('business'),
    'client_request_id', 'ccl_' || md5(pg_temp.id('business')::text || ':mp'),
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('product'), 'quantity', 2)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Prueba', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_res ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, pg_temp.id('customer'), false);
  perform public.record_mercadopago_preference_created_v2(
    pg_temp.id('business'), 'test', v_session, pg_temp.id('customer'), (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(pg_temp.id('business'), 'test', v_session, pg_temp.id('customer'),
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-CCL-' || left(v_session::text, 8), 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=ccl',
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=ccl',
    encode(gen_random_bytes(32), 'hex'), 'req-ccl-' || left(v_session::text, 8));
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  v_res := public.record_mercadopago_webhook_receipt('test', 'evt-ccl-' || left(v_session::text, 8), 'payment',
    '888' || left(replace(v_session::text, '-', ''), 9), true, 'rq-ccl-' || left(v_session::text, 8), repeat('c', 64));
  v_receipt := (v_res ->> 'receipt_id')::uuid;
  -- El worker: toma el trabajo del aviso (lo mismo que claim_payment_outbox_v2, acotado a este trabajo para no
  -- tomar los de otras pruebas de la base), lo empieza, asienta el pago leído y lo completa.
  select id into v_job from public.payment_outbox where webhook_receipt_id = v_receipt;
  update public.payment_outbox set status = 'claimed', owner = 'ccl-worker', lease_expires_at = clock_timestamp() + interval '1 minute'
   where id = v_job and status = 'pending';
  if not public.start_payment_outbox_job(v_job, 'ccl-worker') then raise exception 'el worker no pudo empezar el trabajo'; end if;
  perform public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', '888' || left(replace(v_session::text, '-', ''), 9),
      'external_reference', pi.external_reference,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-CCL', 'collector_id', ps.collector_id, 'currency', 'ARS',
      'transaction_amount', cs.total::text, 'status', 'approved',
      'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(gen_random_bytes(32), 'hex'))
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.environment = 'test'
    where pi.id = v_intent), 'webhook', v_receipt);
  if not public.complete_payment_outbox_job(v_job, 'ccl-worker') then raise exception 'el worker no pudo completar el trabajo'; end if;
  v_res := public.finalize_paid_checkout_session(v_session);
  insert into ccl_ids values ('session_a', v_session), ('intent_a', v_intent), ('order_a', (v_res ->> 'order_id')::uuid),
    ('receipt_a', v_receipt), ('job_a', v_job);
end $$;

select isnt(pg_temp.id('order_a'), null, 'A1 el pago aprobado arma el pedido');
-- Lo que ve el Panel (list_operational_pipeline): el pedido pagado aparece una vez, como pedido de Mercado
-- Pago con el importe del checkout, y el checkout ya no figura como pendiente.
select pg_temp.como('staff');
create temporary table ccl_pipeline on commit drop as
  select p.* from public.list_operational_pipeline(pg_temp.id('business'), false) p;
select pg_temp.sin_sesion();
select is((select string_agg(kind || '/' || payment_method || '/' || total::text, ',') from ccl_pipeline
            where reference_id = pg_temp.id('order_a')),
  'order/mercadopago/' || (select total::text from public.checkout_sessions where id = pg_temp.id('session_a')),
  'A2 el Panel ve el pedido de Checkout Pro una vez, como pedido de Mercado Pago con el importe del checkout');
select is((select count(*)::integer from ccl_pipeline where reference_id = pg_temp.id('session_a')), 0,
  'A3 y su checkout ya no figura como pendiente');
select pg_temp.mover('order_a', 'accepted', 'ccl-a-aceptar');
select pg_temp.mover('order_a', 'preparing', 'ccl-a-preparar');
select pg_temp.mover('order_a', 'ready', 'ccl-a-listo');
select pg_temp.mover('order_a', 'delivered', 'ccl-a-entregado');
select is((select status from public.orders where id = pg_temp.id('order_a')), 'delivered', 'A4 entregado en el local');

-- ══════════════════════════════════════════════════════════════════════════
--  B · efectivo, envío con repartidor
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_address uuid;
  v_res jsonb;
  v_token text := 'tok_CICLO_LIMPIO_' || repeat('Qz7', 12);
begin
  perform pg_temp.como('customer');
  perform public.upsert_current_customer_profile('Cliente Ciclo', '2996209138');
  v_address := (public.upsert_current_customer_address(jsonb_build_object(
    'label','Casa','street','Calle Ciclo','streetNumber','1234','city','Neuquen','neighborhood','Centro',
    'latitude',-38.951673,'longitude',-68.059127,'geolocationAccuracy',10,'source','gps',
    'locationSource','map_pin','locationConfirmedAt',clock_timestamp(),'isDefault',true)) -> 'address' ->> 'id')::uuid;
  v_res := public.create_order_with_items(jsonb_build_object(
    'business_id', pg_temp.id('business'), 'client_request_id', 'ccl-efectivo-' || left(pg_temp.id('business')::text, 8),
    'tracking_token', v_token,
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('product'), 'quantity', 1)),
    'customer_name', 'Cliente Ciclo', 'customer_phone', '2996209138',
    'delivery_mode', 'delivery', 'payment_method', 'cash',
    'customer_address_id', v_address));
  perform pg_temp.sin_sesion();
  insert into ccl_ids values ('order_b', (v_res ->> 'id')::uuid);
  insert into ccl_texto values ('token_b', v_token);
end $$;

select pg_temp.mover('order_b', 'accepted', 'ccl-b-aceptar');
select pg_temp.mover('order_b', 'preparing', 'ccl-b-preparar');
do $$
begin
  perform pg_temp.como('staff');
  perform public.confirm_manual_order_payment(pg_temp.id('order_b'), pg_temp.rev('order_b'), 'cash', 'ccl-b-cobro');
  perform pg_temp.sin_sesion();
end $$;
select pg_temp.mover('order_b', 'ready', 'ccl-b-listo');

do $$
declare
  v_res jsonb;
  v_code text;
begin
  perform pg_temp.como('rider');
  v_res := public.claim_delivery_order(pg_temp.id('business'),
    (select public_code from public.orders where id = pg_temp.id('order_b')), pg_temp.rev('order_b'), 'ccl-b-tomar');
  perform public.mark_delivery_picked_up(pg_temp.id('order_b'), pg_temp.rev('order_b'), 'ccl-b-retiro');
  perform public.start_rider_delivery(pg_temp.id('order_b'), pg_temp.rev('order_b'), 'ccl-b-camino');
  perform public.mark_rider_arrived(pg_temp.id('order_b'), pg_temp.rev('order_b'), 'ccl-b-llego');
  perform pg_temp.como('customer');
  v_code := public.recover_order_tracking_access(pg_temp.id('order_b'), 'tok_CICLO_LIMPIO_2_' || repeat('Qz7', 12)) ->> 'delivery_code';
  perform pg_temp.como('rider');
  perform public.confirm_delivery_code(pg_temp.id('order_b'), pg_temp.rev('order_b'), v_code, 'ccl-b-codigo');
  perform pg_temp.sin_sesion();
end $$;
select is((select status from public.orders where id = pg_temp.id('order_b')), 'delivered', 'B1 entregado con el código del cliente');

-- ══════════════════════════════════════════════════════════════════════════
--  C · la reconciliación y las cuentas
-- ══════════════════════════════════════════════════════════════════════════

-- El ciclo pasó hace horas, no en milisegundos: cada regla con umbral de tiempo (un pedido que no avanza, un
-- cobro aprobado sin pedido, una reserva trabada, un trabajo del worker sin terminar) tiene que poder
-- evaluarse. Todas las horas de las filas del ciclo se corren tres horas para atrás, juntas (sin
-- disparadores, que reescribirían updated_at; las restricciones entre horas siguen valiendo).
create function pg_temp.atrasar(p_table regclass, p_where text) returns void language plpgsql as $$
declare v_set text;
begin
  select string_agg(format('%I = %I - interval ''3 hours''', a.attname, a.attname), ', ') into v_set
    from pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and a.atttypid = 'timestamptz'::regtype;
  execute format('update %s set %s where %s', p_table, v_set, p_where);
end $$;
do $$
begin
  perform set_config('session_replication_role', 'replica', true);
  perform pg_temp.atrasar('public.orders', format('business_id = %L', pg_temp.id('business')));
  perform pg_temp.atrasar('public.payment_intents', format('business_id = %L', pg_temp.id('business')));
  perform pg_temp.atrasar('public.checkout_sessions', format('business_id = %L', pg_temp.id('business')));
  perform pg_temp.atrasar('public.inventory_reservations', format('checkout_session_id = %L', pg_temp.id('session_a')));
  perform pg_temp.atrasar('public.payment_events', format('payment_intent_id = %L', pg_temp.id('intent_a')));
  perform pg_temp.atrasar('public.payment_outbox', format('id = %L', pg_temp.id('job_a')));
  perform pg_temp.atrasar('public.payment_webhook_receipts', format('id = %L', pg_temp.id('receipt_a')));
  perform set_config('session_replication_role', 'origin', true);
end $$;
select is((select min(created_at) < clock_timestamp() - interval '170 minutes' from public.orders
            where business_id = pg_temp.id('business')), true, 'C0 precondición: el ciclo quedó tres horas atrás');

select public.reconcile_operational_alerts_for_business(pg_temp.id('business'));
select is(
  (select coalesce(string_agg(alert_code || '=' || status, ', ' order by alert_code), '')
     from public.operational_alerts where business_id = pg_temp.id('business') and status <> 'resolved'),
  '', 'C1 la reconciliación no deja ninguna alerta abierta para el comercio');
select is(
  (select count(*)::integer from public.operational_alerts where business_id = pg_temp.id('business')),
  0, 'C2 ni resuelta: no se abrió ninguna en todo el ciclo');

select is((select o.status || '/' || r.processing_status from public.payment_outbox o
            join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id where o.id = pg_temp.id('job_a')),
  'completed/completed', 'C3a el worker completó el trabajo del aviso y el recibo');
select is((select internal_status || '/' || provider_status from public.payment_intents where id = pg_temp.id('intent_a')),
  'completed/approved', 'C3 el cobro de Mercado Pago quedó completo y aprobado por el proveedor');
select is((select order_id from public.payment_intents where id = pg_temp.id('intent_a')), pg_temp.id('order_a'),
  'C4 con su pedido');
select is((select total from public.orders where id = pg_temp.id('order_a')),
  (select total from public.checkout_sessions where id = pg_temp.id('session_a')),
  'C5 el pedido cobra exactamente lo que el checkout');
select is((select total from public.orders where id = pg_temp.id('order_b')), 1500.00::numeric,
  'C6 el pedido en efectivo cobra producto más envío');
select is((select stock from public.products where id = pg_temp.id('product')), 47,
  'C7 el stock bajó exactamente lo vendido (2 + 1)');
select is((select string_agg(status, ',') from public.inventory_reservations
            where checkout_session_id = pg_temp.id('session_a')), 'converted',
  'C8 la reserva del checkout pasó al pedido: no quedó tomada');
select is((select count(*)::integer from public.orders where business_id = pg_temp.id('business')), 2,
  'C9 dos pedidos, ni uno más');

select * from finish();
rollback;
