-- ============================================================================
--  ENSAYOS DE RESILIENCIA OPERATIVA
-- ============================================================================
--  Para cada condición crítica: se provoca de verdad, se comprueba que el
--  sistema la detecta SIN que nadie abra el Panel, y se comprueba qué pasa
--  cuando el servicio vuelve.
--
--    TABA_LOCAL_OPS_DB=1 node scripts/run-operational-resilience-drills.mjs
--
--  Regla del archivo: si algo no se cumple, FALLA. Nada se comenta como
--  "esperado". Los helpers de fixture (`nuevo_usuario`, `fixture`,
--  `hasta_preferencia`, `snapshot`, `envejecer`) vienen de
--  supabase/tests/order_intake_dispatch_p0.local.sql, que es donde se
--  certificó el circuito comercial: acá se reusan sin cambiarlos para que los
--  ensayos corran sobre el MISMO camino que ya está en staging.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(p_condicion boolean, p_nombre text, p_detalle text default '')
returns void
language plpgsql as $$
begin
  if p_condicion then
    raise notice 'OK    %  %', rpad(p_nombre, 58, '.'), p_detalle;
  else
    raise exception 'FALLA: % — %', p_nombre, p_detalle;
  end if;
end;
$$;

create or replace function pg_temp.nuevo_usuario(p_prefix text)
returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated', p_prefix || '-' || replace(v_id::text, '-', '') || '@example.invalid',
    '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  return v_id;
end;
$$;

create or replace function pg_temp.fixture(p_stock integer)
returns table (business_id uuid, product_id uuid, owner_id uuid)
language plpgsql as $$
declare
  v_slug text := 'ops-' || right(replace(gen_random_uuid()::text, '-', ''), 10);
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid;
  v_asset uuid := gen_random_uuid();
  v_identity text; v_master text; v_thumb text;
  v_h1 text := encode(gen_random_bytes(32), 'hex');
  v_h2 text := encode(gen_random_bytes(32), 'hex');
  v_h3 text := encode(gen_random_bytes(32), 'hex');
  v_h4 text := encode(gen_random_bytes(32), 'hex');
begin
  v_owner := pg_temp.nuevo_usuario(v_slug || '-owner');
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'Fixture ' || v_slug, v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00
  );
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true);
  v_identity := public.catalog_image_identity_sha256(v_slug || '-ext', v_slug || '-sku', v_h4);
  v_master := public.catalog_asset_path(v_slug || '-sku', v_identity, 'master', v_h2);
  v_thumb := public.catalog_asset_path(v_slug || '-sku', v_identity, 'thumbnail', v_h3);
  insert into public.catalog_assets (
    id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
    master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256,
    thumbnail_binding_sha256, source_sha256, source_url, rights_status,
    rights_reference, catalog_origin
  ) values (
    v_asset, v_business, v_slug || '-ext', v_slug || '-sku', v_slug || '-sku', v_identity,
    v_master, v_h2, public.catalog_asset_binding_sha256(v_identity, 'master', v_h4, v_h2, 1000, 1000, v_master),
    v_thumb, v_h3, public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_h4, v_h3, 400, 400, v_thumb),
    v_h4, 'https://example.invalid/' || v_slug || '.webp', 'UNAPPROVED_QA', 'fixture aislado', 'test_only'
  );
  insert into public.products (
    id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available,
    is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status
  ) values (
    v_product, v_business, 'Lata fixture', 'Ensayo de resiliencia', 'Gaseosas', 1000.00,
    'assets/products/' || v_slug || '.webp', true, 'TABA2 QA', 'Cola', 'Lata 473 ml', '473 ml', 'lata',
    p_stock, true, false, true, false, 1, v_slug || '-ext', v_slug || '-sku', v_asset,
    v_h1, 'assets/products/' || v_slug || '-t.webp', v_h2, v_h4,
    'Lata 473 ml', 473, 'ml', 'test_only', 'confirmed'
  );
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-' || v_slug, 'app-' || v_slug, clock_timestamp(), clock_timestamp());
  return query select v_business, v_product, v_owner;
end;
$$;

create or replace function pg_temp.hasta_preferencia(p_business uuid, p_product uuid, p_customer uuid, p_rid text, p_qty integer default 1)
returns table (session_id uuid, intent_id uuid)
language plpgsql as $$
declare v_session uuid; v_prepare jsonb; v_intent uuid;
begin
  v_session := (public.create_checkout_session(p_customer, jsonb_build_object(
    'business_id', p_business, 'client_request_id', p_rid,
    'items', jsonb_build_array(jsonb_build_object('product_id', p_product, 'quantity', p_qty)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'QA OPS', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference(v_session, p_customer, false);
  perform public.record_mercadopago_preference_created(
    (v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-' || right(replace(v_session::text, '-', ''), 16),
    'https://www.mercadopago.com/r/' || p_rid, 'https://sandbox.mercadopago.com/r/' || p_rid,
    encode(gen_random_bytes(32), 'hex'), 'req-' || right(replace(v_session::text, '-', ''), 12)
  );
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  return query select v_session, v_intent;
end;
$$;

create or replace function pg_temp.snapshot(p_session uuid, p_amount numeric, p_when timestamptz, p_status text default 'approved')
returns jsonb
language sql as $$
  select jsonb_build_object(
    'provider_payment_id', 'PAY-' || right(replace(p_session::text, '-', ''), 12),
    'external_reference', 'taba2:checkout:' || p_session::text,
    'preference_id', pi.preference_id, 'merchant_order_id', 'MO-' || right(replace(p_session::text, '-', ''), 8),
    'collector_id', ps.collector_id, 'currency', 'ARS',
    'transaction_amount', p_amount::text, 'status', p_status,
    'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
    'provider_occurred_at', p_when::text, 'refunded_amount', '0.00',
    'payer_email_hash', encode(gen_random_bytes(32), 'hex'),
    'raw_response_hash', encode(gen_random_bytes(32), 'hex')
  )
  from public.payment_intents pi
  join public.business_payment_settings ps
    on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
  where pi.checkout_session_id = p_session;
$$;

create or replace function pg_temp.envejecer(p_session uuid, p_edad interval, p_vencida_hace interval)
returns void
language sql as $$
  with s as (
    update public.checkout_sessions
       set created_at = clock_timestamp() - p_edad,
           expires_at = clock_timestamp() - p_vencida_hace
     where id = p_session returning id
  )
  update public.inventory_reservations
     set created_at = clock_timestamp() - p_edad,
         expires_at = clock_timestamp() - p_vencida_hace
   where checkout_session_id = (select id from s);
$$;

-- ===== Utilidades propias de estos ensayos =====

-- Corre el barrido tal como lo corre el planificador y devuelve su resumen.
create or replace function pg_temp.barrer()
returns jsonb
language sql as $$
  select public.evaluate_operational_alerts_sweep();
$$;

create or replace function pg_temp.alerta(p_business uuid, p_code text)
returns public.operational_alerts
language sql as $$
  select a.* from public.operational_alerts a
   where a.business_id = p_business and a.alert_code = p_code
   order by a.last_seen_at desc limit 1;
$$;

create or replace function pg_temp.abierta(p_business uuid, p_code text)
returns boolean
language sql as $$
  select exists (
    select 1 from public.operational_alerts a
     where a.business_id = p_business and a.alert_code = p_code and a.status <> 'resolved'
  );
$$;

-- Las alertas del planificador nombran la tarea en su evidencia: para afirmar
-- "esta tarea no produce dos alertas" hay que mirar la tarea, no sólo el código.
create or replace function pg_temp.abierta_job(p_business uuid, p_code text, p_job text)
returns boolean
language sql as $$
  select exists (
    select 1 from public.operational_alerts a
     where a.business_id = p_business and a.alert_code = p_code
       and a.status <> 'resolved' and a.evidence ->> 'job' = p_job
  );
$$;

-- Envejecer una fila es trabajo de fixture, no un camino de producto: los
-- disparadores que sellan `updated_at` la devolverían al presente y el ensayo
-- mediría el reloj en vez del sistema. Se apagan SOLO durante el envejecimiento
-- y se vuelven a encender enseguida.
create or replace function pg_temp.envejecer_cobro(p_session uuid, p_intent uuid, p_edad interval)
returns void
language plpgsql as $$
begin
  alter table public.payment_intents disable trigger payment_intents_set_updated_at;
  update public.payment_intents set updated_at = clock_timestamp() - p_edad where id = p_intent;
  alter table public.payment_intents enable trigger payment_intents_set_updated_at;
  alter table public.checkout_sessions disable trigger user;
  update public.checkout_sessions set updated_at = clock_timestamp() - p_edad where id = p_session;
  alter table public.checkout_sessions enable trigger user;
end;
$$;

-- Igual para pedidos: acá además hay disparadores que sellan marcas de estado y
-- guardan reglas de entrega que no son lo que este ensayo mide.
create or replace function pg_temp.mover_pedido(p_order uuid, p_sql text)
returns void
language plpgsql as $$
begin
  alter table public.orders disable trigger user;
  execute format('update public.orders set %s where id = %L', p_sql, p_order);
  alter table public.orders enable trigger user;
end;
$$;

-- Deja registrada una corrida del planificador tal como la escribe pg_cron.
create or replace function pg_temp.corrida_de_cron(p_job text, p_status text, p_cuando timestamptz)
returns void
language plpgsql as $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = p_job;
  if v_jobid is null then raise exception 'no existe el job %', p_job; end if;
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  values (
    v_jobid, coalesce((select max(runid) from cron.job_run_details), 0) + 1, 0,
    current_database(), current_user, 'ensayo', p_status,
    case when p_status = 'failed' then 'ERROR: ensayo de resiliencia' else 'ensayo' end,
    p_cuando, p_cuando + interval '1 second'
  );
end;
$$;

-- ============================================================================
do $$
declare
  f record; c uuid; s record; r jsonb; n integer; a public.operational_alerts;
  v_health jsonb; v_orden uuid; v_rider uuid; v_stock integer; v_antes integer;
  v_eventos integer; v_ocurrencias integer; v_secreto text;
begin
  raise notice '';
  raise notice '===== ENSAYO 1 · EL PROCESADOR DE COBROS SE CAE =====';
  select * into f from pg_temp.fixture(40);
  c := pg_temp.nuevo_usuario('ops-cust');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'opsrid0001', 1);

  -- La notificación llegó y encoló trabajo. El procesador nunca lo tomó.
  insert into public.payment_outbox (payment_intent_id, topic, status, next_attempt_at, created_at, updated_at)
  values (s.intent_id, 'payment', 'pending',
    clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '20 minutes');

  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'PAYMENT_WORKER_IDLE'),
    'antes del barrido no hay ninguna alerta', 'el estado de partida es limpio');

  r := pg_temp.barrer();
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'PAYMENT_WORKER_IDLE'),
    'la cola parada se detecta SOLA', 'barrido=' || (r ->> 'status'));
  a := pg_temp.alerta(f.business_id, 'PAYMENT_WORKER_IDLE');
  perform pg_temp.ok(a.severity = 'CRITICAL' and (a.evidence ->> 'due_jobs')::integer = 1,
    'dice cuánto trabajo quedó vencido', 'due_jobs=' || (a.evidence ->> 'due_jobs')
      || ' hace ' || (a.evidence ->> 'oldest_due_minutes') || ' min');
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'PAYMENT_OUTBOX_STALLED'),
    'y también el cobro concreto que quedó trabado');

  -- El procesador vuelve y toma el trabajo.
  update public.payment_outbox
     set status = 'completed', completed_at = clock_timestamp(), updated_at = clock_timestamp()
   where payment_intent_id = s.intent_id;
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'PAYMENT_WORKER_IDLE')
    and not pg_temp.abierta(f.business_id, 'PAYMENT_OUTBOX_STALLED'),
    'cuando vuelve, las dos alertas se cierran solas', 'sin intervención humana');
  a := pg_temp.alerta(f.business_id, 'PAYMENT_WORKER_IDLE');
  perform pg_temp.ok(a.status = 'resolved' and a.resolved_by is null,
    'y quedan cerradas POR EL SISTEMA, no por una persona', a.resolution_note);

  commit;
  raise notice '';
  raise notice '===== ENSAYO 2 · UNA TAREA DEL PLANIFICADOR FALLA Y OTRA SE DETIENE =====';
  -- El historial del planificador lo maneja este ensayo de punta a punta: si
  -- quedaran corridas reales de la prueba anterior, el fixture mediría contra
  -- un reloj que no controla.
  delete from cron.job_run_details;
  -- Punto de partida honesto: las cuatro tareas propias corrieron bien hace un
  -- rato. Sin esto, una tarea que todavía no corrió nunca se vería "detenida" y
  -- el ensayo estaría midiendo el fixture en vez del sistema.
  perform pg_temp.corrida_de_cron(j, 'succeeded', clock_timestamp() - interval '4 minutes')
    from unnest(array[
      'taba-payment-outbox-worker', 'taba-checkout-expiry-sweep',
      'taba-checkout-provider-truth-sweep', 'taba-operational-alerts-sweep'
    ]) as j;
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'SCHEDULER_JOB_FAILING')
    and not pg_temp.abierta(f.business_id, 'SCHEDULER_JOB_STALLED'),
    'con el planificador sano no se inventa ninguna alerta');

  -- ENCONTRADO EN STAGING, no acá: en la primera corrida después de aplicar la
  -- migración, el propio barrido se denunció como detenido —arrancado hace un
  -- segundo, sin ningún éxito todavía— y abrió una alerta CRÍTICA que se cerró
  -- sola al minuto siguiente. El fixture de arriba siembra historial, así que
  -- este ensayo no podía verlo. Ahora sí: una tarea recién programada, con el
  -- planificador vivo alrededor.
  delete from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'taba-operational-alerts-sweep');
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, coalesce((select max(runid) from cron.job_run_details), 0) + 1, 0,
         current_database(), current_user, 'ensayo', 'running', 'en curso',
         clock_timestamp(), null
    from cron.job j where j.jobname = 'taba-operational-alerts-sweep';
  r := pg_temp.barrer();
  perform pg_temp.ok(
    not pg_temp.abierta_job(f.business_id, 'SCHEDULER_JOB_STALLED', 'taba-operational-alerts-sweep'),
    'una tarea en su PRIMERA corrida no se denuncia a sí misma como detenida',
    'defecto encontrado en staging 2026-08-10T18:04Z');

  -- Pero una que lleva un cuarto de hora arrancada y nunca terminó, sí.
  update cron.job_run_details
     set start_time = clock_timestamp() - interval '30 minutes'
   where jobid = (select jobid from cron.job where jobname = 'taba-operational-alerts-sweep');
  r := pg_temp.barrer();
  perform pg_temp.ok(
    pg_temp.abierta_job(f.business_id, 'SCHEDULER_JOB_STALLED', 'taba-operational-alerts-sweep'),
    'una tarea colgada media hora sin terminar sí se detecta');
  perform pg_temp.corrida_de_cron('taba-operational-alerts-sweep', 'succeeded', clock_timestamp() - interval '4 minutes');
  r := pg_temp.barrer();

  -- Una tarea empieza a fallar.
  perform pg_temp.corrida_de_cron('taba-checkout-expiry-sweep', 'failed', clock_timestamp() - interval '3 minutes');
  perform pg_temp.corrida_de_cron('taba-checkout-expiry-sweep', 'failed', clock_timestamp() - interval '2 minutes');
  perform pg_temp.corrida_de_cron('taba-checkout-expiry-sweep', 'failed', clock_timestamp() - interval '1 minute');

  r := pg_temp.barrer();
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'SCHEDULER_JOB_FAILING'),
    'una tarea que falla tres veces se detecta sola');
  a := pg_temp.alerta(f.business_id, 'SCHEDULER_JOB_FAILING');
  perform pg_temp.ok(a.evidence ->> 'job' = 'taba-checkout-expiry-sweep'
    and (a.evidence ->> 'failures_since_success')::integer >= 3,
    'y dice cuál y cuántas veces', a.evidence ->> 'job');
  perform pg_temp.ok(
    not pg_temp.abierta_job(f.business_id, 'SCHEDULER_JOB_STALLED', 'taba-checkout-expiry-sweep'),
    'no se duplica: la misma tarea produce UNA alerta, no dos');

  -- Otra simplemente dejó de correr, sin fallar.
  perform pg_temp.corrida_de_cron('taba-checkout-provider-truth-sweep', 'succeeded', clock_timestamp() - interval '45 minutes');
  update cron.job_run_details set start_time = start_time - interval '45 minutes',
    end_time = end_time - interval '45 minutes'
   where jobid = (select jobid from cron.job where jobname = 'taba-checkout-provider-truth-sweep');
  r := pg_temp.barrer();
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'SCHEDULER_JOB_STALLED'),
    'una tarea detenida sin fallar también se detecta');
  a := pg_temp.alerta(f.business_id, 'SCHEDULER_JOB_STALLED');
  perform pg_temp.ok(a.evidence ->> 'job' = 'taba-checkout-provider-truth-sweep',
    'y se nombra la tarea correcta', a.evidence ->> 'job');

  -- Las dos vuelven.
  perform pg_temp.corrida_de_cron('taba-checkout-expiry-sweep', 'succeeded', clock_timestamp());
  perform pg_temp.corrida_de_cron('taba-checkout-provider-truth-sweep', 'succeeded', clock_timestamp());
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'SCHEDULER_JOB_FAILING')
    and not pg_temp.abierta(f.business_id, 'SCHEDULER_JOB_STALLED'),
    'cuando el planificador se recupera, las alertas se cierran solas');

  commit;
  raise notice '';
  raise notice '===== ENSAYO 3 · EL PAGO ENTRA Y EL PEDIDO NO NACE =====';
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'opsrid0003', 1);
  r := public.record_mercadopago_payment_snapshot(s.intent_id, pg_temp.snapshot(s.session_id, 1000.00, clock_timestamp()), 'webhook', null);
  perform pg_temp.ok(r ->> 'finalize_required' = 'true', 'el cobro entra y queda listo para armarse');
  -- Nadie finaliza. Cinco minutos después ya es dinero sin pedido.
  perform pg_temp.envejecer_cobro(s.session_id, s.intent_id, interval '10 minutes');

  r := pg_temp.barrer();
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'PAYMENT_APPROVED_WITHOUT_ORDER'),
    'dinero cobrado sin pedido se detecta SOLO');
  v_health := public.build_operational_health(f.business_id);
  perform pg_temp.ok((v_health #>> '{payments,reconciliation,paid_without_order}')::integer >= 1,
    'la salud operativa lo cuenta con datos reales',
    'paid_without_order=' || (v_health #>> '{payments,reconciliation,paid_without_order}'));

  -- Recuperación: la acción que ya existe para el operador.
  r := public.finalize_paid_checkout_session(s.session_id);
  perform pg_temp.ok(r ->> 'ok' = 'true', 'el pedido se arma desde el cobro que ya entró');
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'PAYMENT_APPROVED_WITHOUT_ORDER'),
    'y la alerta se cierra sola cuando el pedido existe');
  select id into v_orden from public.orders where business_id = f.business_id order by created_at desc limit 1;
  perform pg_temp.ok(v_orden is not null, 'hay un pedido de verdad detrás del cobro');

  commit;
  raise notice '';
  raise notice '===== ENSAYO 4 · EL STOCK QUEDA RETENIDO POR UN CHECKOUT VENCIDO =====';
  select stock into v_antes from public.products where id = f.product_id;
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'opsrid0004', 3);
  select stock into v_stock from public.products where id = f.product_id;
  perform pg_temp.ok(v_stock = v_antes - 3, 'la reserva retiene stock', 'stock=' || v_stock);
  perform pg_temp.envejecer(s.session_id, interval '40 minutes', interval '20 minutes');

  r := pg_temp.barrer();
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'STOCK_RESERVATION_STUCK'),
    'stock retenido por un checkout vencido se detecta solo');

  -- Recuperación automática: el barrido de expiración que ya existe.
  perform public.sweep_expired_checkout_sessions();
  select stock into v_stock from public.products where id = f.product_id;
  perform pg_temp.ok(v_stock = v_antes, 'el barrido de expiración devuelve el stock', 'stock=' || v_stock);
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'STOCK_RESERVATION_STUCK'),
    'y la alerta se cierra sola');

  commit;
  raise notice '';
  raise notice '===== ENSAYO 5 · EL RIDER DEJA DE REPORTAR =====';
  v_rider := pg_temp.nuevo_usuario('ops-rider');
  perform pg_temp.mover_pedido(v_orden, format(
    'status = %L, assigned_rider_user_id = %L, updated_at = clock_timestamp() - interval ''30 minutes''',
    'assigned', v_rider));
  r := pg_temp.barrer();
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'RIDER_SIGNAL_STALE'),
    'una entrega activa sin señal se detecta sola');
  v_health := public.build_operational_health(f.business_id);
  perform pg_temp.ok((v_health ->> 'riders_without_signal')::integer >= 1,
    'y la salud operativa lo refleja', 'riders_without_signal=' || (v_health ->> 'riders_without_signal'));

  insert into public.rider_locations (order_id, business_id, rider_user_id, lat, lng, accuracy, order_revision, created_at, recorded_at)
  select v_orden, o.business_id, v_rider, -38.9539, -68.0596, 12, o.revision, clock_timestamp(), clock_timestamp()
    from public.orders o where o.id = v_orden;
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'RIDER_SIGNAL_STALE'),
    'cuando la señal vuelve, la alerta se cierra sola');

  commit;
  raise notice '';
  raise notice '===== ENSAYO 6 · ENTRA UN PEDIDO Y NADIE LO ACEPTA =====';
  perform pg_temp.mover_pedido(v_orden,
    'status = ''received'', acknowledged_at = null, assigned_rider_user_id = null, '
    || 'created_at = clock_timestamp() - interval ''25 minutes'', '
    || 'updated_at = clock_timestamp() - interval ''25 minutes''');

  -- El pedido de este fixture nació de un producto QA, así que el sistema lo
  -- clasificó `qa`. Un pedido de prueba NO puede sonar: es la diferencia entre
  -- un tablero que se mira y uno que se ignora.
  perform pg_temp.ok((select origin from public.orders where id = v_orden) = 'qa',
    'el pedido de prueba está clasificado como tal', 'origin=qa');
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'ORDER_NOT_ACCEPTED'),
    'un pedido de PRUEBA sin aceptar no despierta a nadie');

  -- El mismo pedido, ahora con el origen de uno real.
  perform pg_temp.mover_pedido(v_orden, 'origin = ''production''');
  r := pg_temp.barrer();
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'ORDER_NOT_ACCEPTED'),
    'un pedido REAL sin aceptar se detecta solo');
  a := pg_temp.alerta(f.business_id, 'ORDER_NOT_ACCEPTED');
  perform pg_temp.ok((a.evidence ->> 'waiting_minutes')::integer >= 25,
    'y dice hace cuánto que espera', (a.evidence ->> 'waiting_minutes') || ' min');

  perform pg_temp.mover_pedido(v_orden,
    'status = ''accepted'', acknowledged_at = clock_timestamp() - interval ''90 minutes'', '
    || 'preparation_estimate_minutes = 30');
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'ORDER_NOT_ACCEPTED'),
    'aceptarlo cierra esa alerta sola');
  perform pg_temp.ok(pg_temp.abierta(f.business_id, 'ORDER_STALLED'),
    'pero si se queda ahí, media hora más allá de lo prometido, vuelve a avisar');

  perform pg_temp.mover_pedido(v_orden, 'status = ''delivered''');
  r := pg_temp.barrer();
  perform pg_temp.ok(not pg_temp.abierta(f.business_id, 'ORDER_STALLED'),
    'entregarlo la cierra sola');

  commit;
  raise notice '';
  raise notice '===== ENSAYO 7 · IDEMPOTENCIA: EL BARRIDO NO HACE RUIDO =====';
  -- Se vuelve a provocar una condición estable y se barre varias veces.
  insert into public.payment_outbox (payment_intent_id, topic, status, next_attempt_at, created_at, updated_at)
  values (s.intent_id, 'payment_reconcile', 'pending',
    clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '20 minutes');
  r := pg_temp.barrer();
  a := pg_temp.alerta(f.business_id, 'PAYMENT_WORKER_IDLE');
  v_ocurrencias := a.occurrence_count;
  select count(*)::integer into v_eventos from public.operational_alert_events e
   where e.alert_id = a.id;

  r := pg_temp.barrer();
  r := pg_temp.barrer();
  r := pg_temp.barrer();
  select count(*)::integer into n from public.operational_alerts
   where business_id = f.business_id and alert_code = 'PAYMENT_WORKER_IDLE';
  perform pg_temp.ok(n = 1, 'cuatro barridos dejan UNA fila, no cuatro', 'filas=' || n);
  a := pg_temp.alerta(f.business_id, 'PAYMENT_WORKER_IDLE');
  perform pg_temp.ok(a.occurrence_count = v_ocurrencias,
    'y no infla el contador dentro del mismo minuto',
    v_ocurrencias || ' -> ' || a.occurrence_count);
  select count(*)::integer into n from public.operational_alert_events e where e.alert_id = a.id;
  perform pg_temp.ok(n = v_eventos, 'ni escribe un evento por corrida', v_eventos || ' -> ' || n);

  commit;
  raise notice '';
  raise notice '===== ENSAYO 8 · LA SUPERFICIE DE SALUD DICE LA VERDAD =====';
  v_health := public.build_operational_health(f.business_id);
  perform pg_temp.ok(v_health #>> '{autonomous_evaluation,state}' = 'al día',
    'con el barrido corriendo, la salud dice que está al día',
    v_health #>> '{autonomous_evaluation,state}');
  perform pg_temp.ok((v_health #>> '{autonomous_evaluation,seconds_since_last_run}')::numeric < 60,
    'y la antigüedad es un número medido, no una promesa',
    (v_health #>> '{autonomous_evaluation,seconds_since_last_run}') || ' s');

  -- Nada está verde por defecto: se envejece la última corrida y la superficie
  -- tiene que cambiar de opinión sola.
  update public.operational_sweep_runs
     set started_at = started_at - interval '30 minutes',
         finished_at = finished_at - interval '30 minutes';
  v_health := public.build_operational_health(f.business_id);
  perform pg_temp.ok(v_health #>> '{autonomous_evaluation,state}' = 'detenido',
    'si la evaluación se detiene, la superficie lo dice',
    v_health #>> '{autonomous_evaluation,state}');

  perform pg_temp.ok(
    (select count(*) from jsonb_array_elements(v_health -> 'scheduler')) >= 4,
    'el planificador se reporta tarea por tarea',
    (select count(*)::text from jsonb_array_elements(v_health -> 'scheduler')));

  commit;
  raise notice '';
  raise notice '===== ENSAYO 9 · LOS SECRETOS NO SE FILTRAN =====';
  -- El ensayo parte de una bóveda vacía aunque la base se reutilice.
  delete from vault.secrets where name in ('taba_payment_worker_url', 'taba_payment_worker_hmac_secret');
  v_health := public.build_operational_health(f.business_id);
  perform pg_temp.ok(
    (v_health #>> '{secrets,0,configured}') = 'false',
    'sin bóveda cargada, la superficie dice que falta', v_health #>> '{secrets,0,detail}');

  v_secreto := 'valor-de-prueba-que-no-puede-aparecer-nunca-1234567890';
  perform vault.create_secret(v_secreto, 'taba_payment_worker_hmac_secret', 'ensayo de resiliencia');
  perform vault.create_secret('https://ejemplo.supabase.co/functions/v1/mercadopago-payment-worker',
    'taba_payment_worker_url', 'ensayo de resiliencia');
  v_health := public.build_operational_health(f.business_id);

  perform pg_temp.ok(
    (select count(*) from jsonb_array_elements(v_health -> 'secrets') sec
      where (sec ->> 'configured')::boolean) = 2,
    'con la bóveda cargada, la superficie lo reconoce');
  perform pg_temp.ok(position(v_secreto in v_health::text) = 0,
    'y el valor del secreto NO aparece en ninguna parte de la respuesta');
  perform pg_temp.ok(
    (select sec ->> 'detail' from jsonb_array_elements(v_health -> 'secrets') sec
      where sec ->> 'name' = 'taba_payment_worker_hmac_secret') = 'cargada y con el largo mínimo',
    'lo que se publica del secreto es su estado, no su contenido');

  commit;
  raise notice '';
  raise notice '===== ENSAYO 10 · EL CAMINO HUMANO NO SE RELAJÓ =====';
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
    perform public.refresh_operational_alerts(f.business_id);
    raise exception 'FALLA: un usuario ajeno pudo recalcular las alertas del negocio';
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'un usuario sin rol en el negocio sigue sin poder recalcular', 'error 42501');
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', f.owner_id::text, 'role', 'authenticated')::text, true);
  n := public.refresh_operational_alerts(f.business_id);
  perform pg_temp.ok(n >= 0, 'el dueño sigue pudiendo recalcular desde el Panel', 'hallazgos=' || n);
  v_health := public.get_operational_health(f.business_id);
  perform pg_temp.ok(v_health ? 'autonomous_evaluation', 'y ve la salud operativa con su propio rol');
  perform set_config('request.jwt.claims', '', true);

  commit;
  raise notice '';
  raise notice '===== ENSAYO 11 · EL PANEL Y EL BARRIDO CALCULAN LO MISMO =====';
  perform set_config('request.jwt.claims', json_build_object('sub', f.owner_id::text, 'role', 'authenticated')::text, true);
  r := public.get_production_operation_center(f.business_id);
  perform pg_temp.ok(r ? 'health', 'el Centro de operación trae la salud en el mismo viaje');
  perform pg_temp.ok(
    (r #>> '{health,autonomous_evaluation,expected_every_seconds}') = '60',
    'y declara cada cuánto se espera que corra la evaluación');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ============================================================================
--  Resumen final: qué queda abierto y desde cuándo.
-- ============================================================================
select
  a.alert_code,
  a.severity,
  a.status,
  a.occurrence_count,
  round(extract(epoch from (clock_timestamp() - a.first_seen_at))) as segundos_abierta
from public.operational_alerts a
order by a.status, a.alert_code;

select
  r.status,
  r.businesses_evaluated,
  r.findings,
  r.open_alerts,
  r.critical_alerts,
  round(extract(epoch from (r.finished_at - r.started_at)) * 1000) as duracion_ms
from public.operational_sweep_runs r
order by r.started_at desc
limit 5;
