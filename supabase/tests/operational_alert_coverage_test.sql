-- TABA · LO QUE NO AVISABA, AHORA AVISA
--
-- Regresión de 20261002011000. Cada condición se arma por las funciones reales (el
-- aviso del vendedor, el pedido pagado, el reembolso, el asiento del pago) y para
-- cada alerta nueva se comprueba lo mismo:
--
--   · se abre una vez, con la severidad, el sujeto y la evidencia que dice el contrato;
--   · una segunda corrida del barrido no la duplica ni infla su contador;
--   · se cierra cuando su condición se va, y SÓLO entonces (nunca por tiempo);
--   · queda en el negocio que corresponde: el otro no ve nada. Las dos del
--     planificador son la excepción a propósito: la condición es de toda la
--     plataforma y, como SCHEDULER_JOB_FAILING y SCHEDULER_JOB_STALLED, se anota en
--     cada negocio.
--
--   SCHEDULER_JOB_DISABLED / SCHEDULER_JOB_MISSING   (DIAG-05)
--   PAYMENT_OUTBOX_STALLED / PAYMENT_WORKER_IDLE     con avisos sin intento de pago (DIAG-02)
--   REFUND_NEEDS_ATTENTION                           devolución que no terminó
--   PAYMENT_NEEDS_REVIEW                             pago duplicado, anomalía posterior al
--                                                    pedido, reclamo o contracargo
--
-- PAYMENT_NEEDS_REVIEW tiene además su propia regla de cierre, y se prueba entera: el
-- pago duplicado lo cierra sólo lo que informe Mercado Pago (una persona no puede);
-- la anomalía y el contracargo también los cierra el dueño o un encargado con su
-- nota (la de un empleado no cuenta), y esa resolución vale hasta que el proveedor
-- informe algo nuevo sobre lo mismo.
--
-- No depende de la hora ni de lo que ya haya en la base: los identificadores salen
-- del nombre de este archivo, todo es relativo a clock_timestamp() y ninguna cuenta
-- mira una tabla entera. El planificador es global: sus aserciones miran la tarea
-- que la prueba apaga o agrega, no cuántas alertas hay.
-- Todo transaccional: termina en rollback.
--
-- PRECONDICIÓN DEL ENTORNO (la misma de operational_alerts_stay_truthful_test.sql):
-- el rol que corre la prueba puede insertar y borrar en `cron.job_run_details`.

begin;
create extension if not exists pgtap with schema extensions;
select plan(101);

do $precondition$
begin
  if not has_table_privilege(current_user, 'cron.job_run_details', 'INSERT')
     or not has_table_privilege(current_user, 'cron.job_run_details', 'DELETE') then
    raise exception 'PRECONDICION: el rol % necesita INSERT y DELETE sobre cron.job_run_details para armar el historial de prueba',
      current_user using errcode = '42501';
  end if;
end
$precondition$;

-- ── Herramientas ───────────────────────────────────────────────────────────
create temporary table ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.uid(p_label text) returns uuid language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
    from (select md5('operational_alert_coverage_test:' || p_label) as h) x
$$;
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select id from ids where k = p_key $$;
create function pg_temp.hash(p_label text) returns text language sql immutable as $$
  select encode(digest('operational_alert_coverage_test-' || p_label, 'sha256'), 'hex')
$$;
create function pg_temp.como_duenia(p_business text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('owner_' || p_business), 'role', 'authenticated', 'session_id', pg_temp.id('sesion_' || p_business))::text, true)::void;
$$;
create function pg_temp.nadie() returns void language sql as $$ select set_config('request.jwt.claims', '', true)::void $$;
create function pg_temp.barrer(p_business text) returns integer language sql as $$
  select public.reconcile_operational_alerts_for_business(pg_temp.id(p_business));
$$;
-- Las alertas de los códigos que agrega esta migración (más los dos de la cola, que
-- ahora ven más), de un negocio: «CÓDIGO/SEVERIDAD/estado[sujeto]». p_job filtra las
-- del planificador por tarea.
create function pg_temp.alertas(p_business text, p_solo_abiertas boolean default true, p_job text default null) returns text language sql stable as $$
  select coalesce(string_agg(a.alert_code || '/' || a.severity || '/' || a.status || '[' || a.subject_type || ']', ' ' order by a.alert_code, a.subject_id), '-')
    from public.operational_alerts a
   where a.business_id = pg_temp.id(p_business)
     and (not p_solo_abiertas or a.status <> 'resolved')
     and case
           when a.alert_code in ('SCHEDULER_JOB_MISSING', 'SCHEDULER_JOB_DISABLED') then a.evidence ->> 'job' = p_job
           else p_job is null and a.alert_code in ('PAYMENT_OUTBOX_STALLED', 'PAYMENT_WORKER_IDLE', 'REFUND_NEEDS_ATTENTION', 'PAYMENT_NEEDS_REVIEW')
         end;
$$;
create function pg_temp.alerta(p_business text, p_code text, p_subject uuid default null, p_job text default null)
returns public.operational_alerts language sql stable as $$
  select a.* from public.operational_alerts a
   where a.business_id = pg_temp.id(p_business) and a.alert_code = p_code
     and (p_subject is null or a.subject_id = p_subject)
     and (p_job is null or a.evidence ->> 'job' = p_job)
   order by a.last_seen_at desc limit 1;
$$;
create function pg_temp.eventos(p_alert uuid) returns text language sql stable as $$
  select coalesce(string_agg(e.event_type, ' ' order by e.created_at, e.event_type), '-')
    from public.operational_alert_events e where e.alert_id = p_alert;
$$;
-- La dueña del negocio (o, con p_quien = 'staff', su empleado) da por resuelta una
-- alerta desde el Panel, con su nota. Sin alerta que resolver lo dice, en vez de
-- levantar: así, corrida sobre una base SIN la migración, la prueba llega al final y
-- muestra qué aserciones fallan.
create function pg_temp.resolver(p_business text, p_code text, p_subject uuid, p_nota text, p_quien text default 'owner')
returns text language plpgsql as $$
declare
  v_id uuid;
begin
  select a.id into v_id from pg_temp.alerta(p_business, p_code, p_subject) a;
  if v_id is null then
    return 'sin alerta';
  end if;
  if p_quien = 'owner' then
    perform pg_temp.como_duenia(p_business);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.id(p_quien || '_' || p_business), 'role', 'authenticated',
        'session_id', pg_temp.id('sesion_' || p_quien || '_' || p_business))::text, true);
  end if;
  perform public.transition_operational_alert(v_id, 'resolved', p_nota);
  perform pg_temp.nadie();
  return 'resuelta';
end $$;
-- Cuántas veces figura un cobro en la consulta de cobros para revisar de un negocio
-- (-1 si la consulta todavía no existe: misma razón que arriba).
create function pg_temp.para_revisar(p_business text, p_intent text) returns integer language plpgsql as $$
declare
  v_count integer;
begin
  execute 'select count(*)::integer from private.payment_review_findings($1) f where f.payment_intent_id = $2'
    into v_count using pg_temp.id(p_business), pg_temp.id(p_intent);
  return v_count;
exception when undefined_function then
  return -1;
end $$;
create function pg_temp.corrida(p_job text, p_status text, p_hace interval) returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'prueba', p_status, 'ok',
         clock_timestamp() - p_hace, clock_timestamp() - p_hace + interval '1 second'
    from cron.job j where j.jobname = p_job;
$$;
-- Envejece un trabajo de la cola: el disparador que sella `updated_at` se apaga SÓLO
-- para eso (es trabajo de fixture, no un camino de producto).
create function pg_temp.envejecer_trabajo(p_job uuid, p_hace interval) returns void language plpgsql as $$
begin
  alter table public.payment_outbox disable trigger payment_outbox_set_updated_at;
  update public.payment_outbox
     set next_attempt_at = clock_timestamp() - p_hace, created_at = clock_timestamp() - p_hace, updated_at = clock_timestamp() - p_hace
   where id = p_job;
  alter table public.payment_outbox enable trigger payment_outbox_set_updated_at;
end $$;
-- Un aviso firmado de Mercado Pago para el vendedor de un negocio. Devuelve su trabajo en la cola.
create function pg_temp.aviso(p_business text, p_nombre text, p_tipo text default 'payment') returns uuid language plpgsql as $$
declare v_receipt uuid; v_job uuid;
begin
  v_receipt := (public.mp_record_seller_webhook('test', 'evt-operational-alert-coverage-test-' || p_nombre, p_tipo,
    'PAY-operational-alert-coverage-test-' || p_nombre, true, 'rq-oac-' || p_nombre, pg_temp.hash('aviso-' || p_nombre),
    pg_temp.id(p_business)) ->> 'receipt_id')::uuid;
  select o.id into strict v_job from public.payment_outbox o where o.webhook_receipt_id = v_receipt;
  insert into ids values ('aviso_' || p_nombre, v_job);
  return v_job;
end $$;
-- Un pedido de retiro pagado por Mercado Pago, por el camino V2. Guarda <nombre>:session, :intent y :order.
create function pg_temp.pedido_pagado(p_business text, p_nombre text) returns void language plpgsql as $$
declare
  v_business uuid := pg_temp.id(p_business);
  v_customer uuid := pg_temp.id('cliente');
  v_res jsonb; v_session uuid; v_intent uuid; v_prepare jsonb;
begin
  perform pg_temp.nadie();
  v_res := public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'oac-test-' || p_nombre,
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('producto_' || p_business), 'quantity', 1)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Tadeo Privado Cobertura', 'phone', '5492994666321'),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_res ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  perform public.record_mercadopago_preference_created_v2(
    v_business, 'test', v_session, v_customer, (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer,
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-operational-alert-coverage-test-' || p_nombre,
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=oac-' || p_nombre,
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=oac-' || p_nombre,
    pg_temp.hash('pref-' || p_nombre), 'req-oac-' || p_nombre);
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  insert into ids values (p_nombre || ':session', v_session), (p_nombre || ':intent', v_intent);
  perform public.record_mercadopago_payment_snapshot(v_intent, pg_temp.pago(p_nombre, 'principal', 'approved', 'primera'), 'webhook', null);
  v_res := public.finalize_paid_checkout_session(v_session);
  insert into ids values (p_nombre || ':order', (v_res ->> 'order_id')::uuid);
end $$;
-- Lo que el worker asienta después de leer un pago en el proveedor. p_pago distingue
-- los pagos del mismo checkout; p_semilla decide el hash de la respuesta.
create function pg_temp.pago_id(p_nombre text, p_pago text) returns text language sql immutable as $$
  select 'PAY-operational-alert-coverage-test-' || p_nombre || '-' || p_pago
$$;
create function pg_temp.pago(p_nombre text, p_pago text, p_estado text, p_semilla text, p_cambios jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
      'provider_payment_id', pg_temp.pago_id(p_nombre, p_pago), 'external_reference', pi.external_reference,
      'preference_id', pi.preference_id, 'merchant_order_id', 'MO-oac-' || p_nombre || '-' || p_pago,
      'collector_id', ps.collector_id, 'application_id', '', 'currency', 'ARS',
      'transaction_amount', cs.total::text, 'status', p_estado, 'status_detail', 'detalle_de_prueba', 'payment_method', 'visa',
      'live_mode', false, 'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
      'payer_email_hash', pg_temp.hash('pagador-privado'),
      'raw_response_hash', pg_temp.hash(p_nombre || ':' || p_pago || ':' || p_semilla)) || p_cambios
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
   where pi.id = pg_temp.id(p_nombre || ':intent')
$$;
create function pg_temp.asentar(p_nombre text, p_snapshot jsonb) returns jsonb language sql as $$
  select public.record_mercadopago_payment_snapshot(pg_temp.id(p_nombre || ':intent'), p_snapshot, 'webhook', null) - 'payment_intent_id'
$$;

-- ── Fixture ────────────────────────────────────────────────────────────────
do $fixture$
declare
  v_key text; v_business uuid; v_owner uuid; v_product uuid;
  v_customer uuid := pg_temp.uid('cliente');
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_customer,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
  insert into ids values ('cliente', v_customer);
  foreach v_key in array array['a', 'b'] loop
    v_business := pg_temp.uid('negocio-' || v_key); v_owner := pg_temp.uid('owner-' || v_key); v_product := pg_temp.uid('producto-' || v_key);
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
    values (v_owner,'authenticated','authenticated','operational-alert-coverage-test-owner-' || v_key || '@example.invalid','',now(),'{}','{}',false,now(),now());
    -- El guardián de admisión se apaga: acá se prueban alertas, no cupos.
    insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at,
      ordering_verified_by, currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode)
    values (v_business, 'Cobertura de alertas ' || v_key, 'operational-alert-coverage-test-' || v_key, 'open', true, true, true,
      clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off');
    insert into public.business_members(business_id,user_id,role,is_active) values (v_business, v_owner, 'owner', true);
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values (pg_temp.uid('sesion-' || v_key), v_owner, v_business, 'owner', 'panel_web');
    insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
      variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
      stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
      external_id,sku,catalog_origin,units_per_pack)
    values (v_product,v_business,'Lata Cobertura','Gaseosas','Cola',1000,'confirmed',true,'Marca',
      'Lata','Lata',473,'ml','473 ml','lata',1000,true,true,false,'{}',true,now(),v_owner,
      'operational-alert-coverage-test-' || v_key,'operational-alert-coverage-test-' || v_key,'commercial',1);
    insert into public.business_payment_settings (business_id, enabled, environment, checkout_mode, currency, reserve_stock,
      collector_id, application_id, configured_at, verified_at)
    values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'operational-alert-coverage-test-collector-' || v_key,
      'operational-alert-coverage-test-app-' || v_key, clock_timestamp(), clock_timestamp());
    insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
    values (v_business, 'test', 'operational-alert-coverage-test-collector-' || v_key, 'operational-alert-coverage-test-app-' || v_key,
      'connected', 'ciphertext-only-local-fixture', now() + interval '2 days');
    insert into ids values (v_key, v_business), ('owner_' || v_key, v_owner), ('sesion_' || v_key, pg_temp.uid('sesion-' || v_key)),
      ('producto_' || v_key, v_product);
  end loop;
  -- Un empleado de A: ve las alertas y puede marcarlas resueltas, pero no ve los cobros.
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (pg_temp.uid('staff-a'),'authenticated','authenticated','operational-alert-coverage-test-staff-a@example.invalid','',now(),'{}','{}',false,now(),now());
  insert into public.business_members(business_id,user_id,role,is_active) values (pg_temp.id('a'), pg_temp.uid('staff-a'), 'staff', true);
  insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
  values (pg_temp.uid('sesion-staff-a'), pg_temp.uid('staff-a'), pg_temp.id('a'), 'staff', 'panel_web');
  insert into ids values ('staff_a', pg_temp.uid('staff-a')), ('sesion_staff_a', pg_temp.uid('sesion-staff-a'));

  -- Un planificador sano como punto de partida, igual que en
  -- operational_alerts_stay_truthful_test.sql y ecommerce_health_test.sql: cada tarea
  -- del inventario existe y está encendida (una base de pruebas compartida puede
  -- traer alguna apagada o sin programar), las de cada minuto con un éxito reciente
  -- y las demás recién esperadas.
  perform cron.schedule(e.job_name, '* * * * *', 'select 1') from private.scheduler_expected_jobs e
   where not exists (select 1 from cron.job j where j.jobname = e.job_name);
  perform cron.alter_job(j.jobid, active => true) from cron.job j where j.jobname like 'taba-%' and not j.active;
  delete from cron.job_run_details;
  update private.scheduler_expected_jobs set expected_since = clock_timestamp();
  perform pg_temp.corrida(j.jobname, 'succeeded', interval '20 seconds')
     from cron.job j where j.jobname like 'taba-%' and j.schedule in ('* * * * *', '30 seconds');
  delete from public.operational_sweep_runs where scope = 'operational_alerts';
  insert into public.operational_sweep_runs (scope, status, started_at, finished_at)
  values ('operational_alerts', 'ok', clock_timestamp(), clock_timestamp());
end
$fixture$;

-- ══ 1 · LO QUE NO CAMBIÓ DE LA FUNCIÓN ══════════════════════════════════════
select ok(
  has_function_privilege('service_role', 'public.reconcile_operational_alerts_for_business(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reconcile_operational_alerts_for_business(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.reconcile_operational_alerts_for_business(uuid)', 'execute')
  and not has_function_privilege('public', 'public.reconcile_operational_alerts_for_business(uuid)', 'execute'),
  'la reconciliación sigue siendo sólo de service_role');
select is(
  (select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ';')
     from pg_proc p where p.oid = 'public.reconcile_operational_alerts_for_business(uuid)'::regprocedure),
  'true search_path=pg_catalog, public, extensions, pg_temp', 'conserva SECURITY DEFINER y su search_path');
select ok(
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute')
            and not has_function_privilege('authenticated', p.oid, 'execute')
            and not has_function_privilege('service_role', p.oid, 'execute')
            and not has_function_privilege('public', p.oid, 'execute'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'payment_review_findings'),
  'la consulta de cobros para revisar existe y no la ejecuta ningún rol de la API');
select ok(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.list_scheduler_health()', '')))
            / length('public.list_scheduler_health()') = 1
     from pg_proc p where p.oid = 'public.reconcile_operational_alerts_for_business(uuid)'::regprocedure),
  'el planificador se sigue leyendo una sola vez por reconciliación');
select ok(
  (select i.indexdef like '%payment.duplicate_approved%' and i.indexdef like '%payment.post_completion_anomaly%'
     from pg_indexes i where i.schemaname = 'public' and i.indexname = 'payment_events_review_idx'),
  'el índice parcial cubre los dos asientos que busca el barrido');

select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'), '- | -',
  'punto de partida: con todo sano, ninguna de las alertas de esta prueba está abierta');
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id in (pg_temp.id('a'), pg_temp.id('b'))
      and a.alert_code in ('SCHEDULER_JOB_MISSING', 'SCHEDULER_JOB_DISABLED') and a.status <> 'resolved'),
  0, 'y con todas las tareas del inventario programadas y encendidas, ninguna del planificador');

-- ══ 2 · DIAG-05 · UNA TAREA APAGADA ═════════════════════════════════════════
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'taba-checkout-expiry-sweep'), active => false);
select is(pg_temp.barrer('a') >= 1, true, 'apagar una tarea produce un hallazgo');
select is(pg_temp.alertas('a', true, 'taba-checkout-expiry-sweep'), 'SCHEDULER_JOB_DISABLED/CRITICAL/open[service_health]',
  'SCHEDULER_JOB_DISABLED se abre, crítica, para la tarea apagada');
select is(
  (select jsonb_build_object('job', a.evidence -> 'job', 'schedule', a.evidence -> 'schedule',
            'tiene_proposito', (a.evidence ->> 'purpose') is not null, 'subject', a.subject_id, 'correlation', a.correlation_id)
     from pg_temp.alerta('a', 'SCHEDULER_JOB_DISABLED', null, 'taba-checkout-expiry-sweep') a),
  jsonb_build_object('job', 'taba-checkout-expiry-sweep', 'schedule', '* * * * *', 'tiene_proposito', true,
    'subject', md5('taba-checkout-expiry-sweep:disabled')::uuid, 'correlation', null),
  'la evidencia nombra la tarea, su programación y para qué sirve');
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.status <> 'resolved' and a.evidence ->> 'job' = 'taba-checkout-expiry-sweep'),
  1, 'una tarea apagada produce UNA alerta: no figura además fallando ni detenida');
select pg_temp.barrer('b');
select is(pg_temp.alertas('b', true, 'taba-checkout-expiry-sweep'), 'SCHEDULER_JOB_DISABLED/CRITICAL/open[service_health]',
  'el planificador es de toda la plataforma: el otro negocio también la tiene, como con las otras dos del planificador');
select pg_temp.barrer('a');
select pg_temp.barrer('a');
select is(
  (select count(*)::text || '|' || max(a.occurrence_count)::text || '|' || pg_temp.eventos((array_agg(a.id))[1])
     from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.alert_code = 'SCHEDULER_JOB_DISABLED' and a.evidence ->> 'job' = 'taba-checkout-expiry-sweep'),
  '1|1|detected', 'tres corridas: una fila, una ocurrencia, un evento');
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'taba-checkout-expiry-sweep'), active => true);
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'SCHEDULER_JOB_DISABLED', null, 'taba-checkout-expiry-sweep') a),
  'resolved|true|detected resolved', 'encenderla la cierra sola, por el sistema');

-- Lo que la auditoría midió: apagar una tarea DETENIDA cerraba su alerta y no quedaba nada.
delete from cron.job_run_details where jobid = (select j.jobid from cron.job j where j.jobname = 'taba-checkout-provider-truth-sweep');
select pg_temp.corrida('taba-checkout-provider-truth-sweep', 'succeeded', interval '40 minutes');
select pg_temp.barrer('a');
select is(
  (select a.status from pg_temp.alerta('a', 'SCHEDULER_JOB_STALLED', null, 'taba-checkout-provider-truth-sweep') a), 'open',
  'control: una tarea de cada minuto sin un éxito en 40 minutos figura detenida');
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'taba-checkout-provider-truth-sweep'), active => false);
select pg_temp.barrer('a');
select is(
  (select string_agg(a.alert_code || ':' || a.status, ' ' order by a.alert_code)
     from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.evidence ->> 'job' = 'taba-checkout-provider-truth-sweep'
      and a.alert_code like 'SCHEDULER_JOB_%'),
  'SCHEDULER_JOB_DISABLED:open SCHEDULER_JOB_STALLED:resolved',
  'apagarla ya no deja al sistema diciendo que se recuperó: la detenida se cierra y queda la de tarea apagada');
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'taba-checkout-provider-truth-sweep'), active => true);
select pg_temp.corrida('taba-checkout-provider-truth-sweep', 'succeeded', interval '10 seconds');
select pg_temp.barrer('a');
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.evidence ->> 'job' = 'taba-checkout-provider-truth-sweep'
      and a.alert_code like 'SCHEDULER_JOB_%' and a.status <> 'resolved'),
  0, 'encendida y con una corrida reciente, no queda ninguna');

-- ══ 3 · DIAG-05 · UNA TAREA DEL INVENTARIO QUE NO ESTÁ PROGRAMADA ═══════════
insert into private.scheduler_expected_jobs (job_name, purpose)
values ('taba-operational-alert-coverage-test', 'tarea de prueba que nadie programo');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a', true, 'taba-operational-alert-coverage-test'), 'SCHEDULER_JOB_MISSING/CRITICAL/open[service_health]',
  'SCHEDULER_JOB_MISSING se abre, crítica, para la tarea que falta');
select is(
  (select jsonb_build_object('job', a.evidence -> 'job', 'purpose', a.evidence -> 'purpose', 'subject', a.subject_id)
     from pg_temp.alerta('a', 'SCHEDULER_JOB_MISSING', null, 'taba-operational-alert-coverage-test') a),
  jsonb_build_object('job', 'taba-operational-alert-coverage-test', 'purpose', 'tarea de prueba que nadie programo',
    'subject', md5('taba-operational-alert-coverage-test:missing')::uuid),
  'la evidencia nombra la tarea y para qué sirve');
select pg_temp.barrer('b');
select pg_temp.barrer('a');
select is(
  (select pg_temp.alertas('b', true, 'taba-operational-alert-coverage-test') || '|' || count(*)::text || '|' || max(a.occurrence_count)::text
     from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.alert_code = 'SCHEDULER_JOB_MISSING' and a.evidence ->> 'job' = 'taba-operational-alert-coverage-test'),
  'SCHEDULER_JOB_MISSING/CRITICAL/open[service_health]|1|1',
  'también se anota en el otro negocio, y otra corrida no la duplica');
select cron.schedule('taba-operational-alert-coverage-test', '*/5 * * * *', 'select 1');
select pg_temp.barrer('a');
select is(
  (select string_agg(a.alert_code || ':' || a.status, ' ' order by a.alert_code)
     from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.evidence ->> 'job' = 'taba-operational-alert-coverage-test'),
  'SCHEDULER_JOB_MISSING:resolved',
  'programarla la cierra; recién programada no figura ni apagada ni detenida');
select cron.unschedule('taba-operational-alert-coverage-test');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || pg_temp.eventos(a.id) from pg_temp.alerta('a', 'SCHEDULER_JOB_MISSING', null, 'taba-operational-alert-coverage-test') a),
  'open|detected resolved reopened', 'si la tarea se borra de nuevo, la misma alerta se reabre');
delete from private.scheduler_expected_jobs where job_name = 'taba-operational-alert-coverage-test';
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(
  pg_temp.alertas('a', true, 'taba-operational-alert-coverage-test') || '|' || pg_temp.alertas('b', true, 'taba-operational-alert-coverage-test'),
  '-|-', 'sacarla del inventario también la cierra, en los dos negocios');

-- ══ 4 · DIAG-02 · AVISOS DE MERCADO PAGO SIN INTENTO DE PAGO ════════════════
-- Abandonado por la cola (dead_letter).
select pg_temp.aviso('a', 'abandonado');
update public.payment_outbox set status = 'dead_letter', attempts = 8, last_error = 'Provider payment does not match a checkout session'
 where id = pg_temp.id('aviso_abandonado');
select is(
  (select (o.payment_intent_id is null)::text || '|' || o.topic || '|' ||
          (select r.seller_business_id = pg_temp.id('a') from public.payment_webhook_receipts r where r.id = o.webhook_receipt_id)::text
     from public.payment_outbox o where o.id = pg_temp.id('aviso_abandonado')),
  'true|payment|true', 'control: el trabajo del aviso no tiene intento de pago y su recibo es del vendedor de A');
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'), 'PAYMENT_OUTBOX_STALLED/CRITICAL/open[payment_outbox] | -',
  'PAYMENT_OUTBOX_STALLED se abre, crítica, en el negocio del vendedor; el otro no ve nada');
select is(
  (select a.evidence || jsonb_build_object('subject', a.subject_id, 'correlation', a.correlation_id)
     from pg_temp.alerta('a', 'PAYMENT_OUTBOX_STALLED', pg_temp.id('aviso_abandonado')) a),
  jsonb_build_object('payment_outbox_id', pg_temp.id('aviso_abandonado'), 'topic', 'payment', 'outbox_status', 'dead_letter', 'attempts', 8,
    'webhook_receipt_id', (select o.webhook_receipt_id from public.payment_outbox o where o.id = pg_temp.id('aviso_abandonado')),
    'environment', 'test', 'provider_resource_id', 'PAY-operational-alert-coverage-test-abandonado',
    'subject', pg_temp.id('aviso_abandonado'), 'correlation', null),
  'el sujeto es el trabajo de la cola y la evidencia trae el id del pago para buscarlo; ni el error crudo ni datos de nadie');
select pg_temp.barrer('a');
select is(
  (select count(*)::text || '|' || max(a.occurrence_count)::text || '|' || pg_temp.eventos((array_agg(a.id))[1])
     from public.operational_alerts a where a.business_id = pg_temp.id('a') and a.alert_code = 'PAYMENT_OUTBOX_STALLED'),
  '1|1|detected', 'otra corrida no la duplica');
select is(
  public.build_operational_health(pg_temp.id('a')) #>> '{payments,outbox,dead_letter}', '1',
  'la salud del negocio y sus alertas ahora cuentan lo mismo');

-- Cualquier tema de la cola: un contracargo abandonado, también sin intento.
select pg_temp.aviso('a', 'contracargo', 'chargeback');
update public.payment_outbox set status = 'dead_letter', attempts = 8 where id = pg_temp.id('aviso_contracargo');
select pg_temp.barrer('a');
select is(
  (select a.severity || '|' || (a.evidence ->> 'topic') from pg_temp.alerta('a', 'PAYMENT_OUTBOX_STALLED', pg_temp.id('aviso_contracargo')) a),
  'CRITICAL|chargeback', 'un aviso de contracargo abandonado también: la rama no mira el tema');

-- Los dos se resuelven: las alertas se cierran, una por una.
update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where id = pg_temp.id('aviso_abandonado');
select pg_temp.barrer('a');
select is(
  (select string_agg((a.evidence ->> 'topic') || ':' || a.status, ' ' order by a.evidence ->> 'topic')
     from public.operational_alerts a where a.business_id = pg_temp.id('a') and a.alert_code = 'PAYMENT_OUTBOX_STALLED'),
  'chargeback:open payment:resolved', 'cuando un trabajo sale del abandono se cierra SU alerta; la del otro sigue');
update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where id = pg_temp.id('aviso_contracargo');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'y con los dos resueltos no queda ninguna');

-- Pendiente y vencido: nadie lo toma.
select pg_temp.aviso('a', 'vencido');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'un aviso recién encolado no es una alerta');
select pg_temp.envejecer_trabajo(pg_temp.id('aviso_vencido'), interval '7 minutes');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), 'PAYMENT_WORKER_IDLE/CRITICAL/open[service_health]',
  'a los 7 minutos sin que nadie lo tome: PAYMENT_WORKER_IDLE (y todavía no «la cola no progresa», que espera 15)');
select is(
  (select (a.evidence - 'last_progress_at' - 'oldest_due_minutes') || jsonb_build_object('subject', a.subject_id,
            'minutos', (a.evidence ->> 'oldest_due_minutes')::numeric between 6 and 8)
     from pg_temp.alerta('a', 'PAYMENT_WORKER_IDLE') a),
  jsonb_build_object('scope', 'provider_notifications', 'due_jobs', 1,
    'subject', md5('payment_worker_idle:provider_notifications')::uuid, 'minutos', true),
  'con su propio sujeto, cuántos avisos hay vencidos y desde cuándo');
select pg_temp.envejecer_trabajo(pg_temp.id('aviso_vencido'), interval '20 minutes');
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'),
  'PAYMENT_OUTBOX_STALLED/ACTION_REQUIRED/open[payment_outbox] PAYMENT_WORKER_IDLE/CRITICAL/open[service_health] | -',
  'a los 20 minutos: además PAYMENT_OUTBOX_STALLED por ese aviso; el otro negocio, nada');
select is(
  public.build_operational_health(pg_temp.id('a')) #>> '{payments,worker,state}', 'no está tomando trabajo',
  'lo mismo que ya decía la salud del negocio');

-- Un trabajo CON intento vencido al mismo tiempo: la rama de siempre sigue dando su
-- alerta, con su sujeto y su cuenta; la nueva no la pisa.
select pg_temp.pedido_pagado('a', 'cola');
insert into public.payment_outbox (payment_intent_id, topic, status, next_attempt_at, created_at, updated_at)
values (pg_temp.id('cola:intent'), 'payment_reconcile', 'pending', clock_timestamp() - interval '20 minutes',
        clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '20 minutes');
select pg_temp.barrer('a');
select is(
  (select string_agg(a.subject_id::text || '=' || (a.evidence ->> 'due_jobs') || coalesce(':' || (a.evidence ->> 'scope'), ''), ' '
            order by a.evidence ->> 'scope' nulls first)
     from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.alert_code = 'PAYMENT_WORKER_IDLE' and a.status <> 'resolved'),
  md5('payment_worker_idle')::uuid::text || '=1 ' || md5('payment_worker_idle:provider_notifications')::uuid::text || '=1:provider_notifications',
  'los trabajos con intento siguen en la alerta de siempre y los avisos en la suya: cada una cuenta lo suyo');
select is(
  (select string_agg(a.subject_type, ' ' order by a.subject_type)
     from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.alert_code = 'PAYMENT_OUTBOX_STALLED' and a.status <> 'resolved'),
  'payment_intent payment_outbox', 'y «la cola no progresa» sale una vez por el intento y una vez por el aviso');

-- El procesador vuelve y toma los dos.
update public.payment_outbox set status = 'completed', completed_at = clock_timestamp()
 where id = pg_temp.id('aviso_vencido') or (payment_intent_id = pg_temp.id('cola:intent') and topic = 'payment_reconcile');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'cuando el procesador vuelve, las cuatro se cierran solas');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_WORKER_IDLE', md5('payment_worker_idle:provider_notifications')::uuid) a),
  'resolved|true|detected resolved', 'cerrada por el sistema, con su evento');

-- Un trabajo abandonado de OTRO tema que sí tiene intento: la conciliación de un
-- reembolso dudoso, encolada por la función de siempre. Lo cubría la rama de siempre
-- y lo sigue cubriendo: ningún tema de la cola queda afuera.
select pg_temp.como_duenia('a');
select public.prepare_payment_refund_v2(pg_temp.id('cola:intent'), null, pg_temp.uid('clave-cola'), 'devolucion de la cola');
select pg_temp.nadie();
insert into ids select 'cola:refund', r.id from public.payment_refunds r where r.payment_intent_id = pg_temp.id('cola:intent');
select public.mark_payment_refund_ambiguous(pg_temp.id('cola:refund'), pg_temp.hash('cola-ambigua'), 'network_or_timeout');
select is(
  (select o.topic || '|' || o.status || '|' || (o.payment_intent_id = pg_temp.id('cola:intent'))::text
     from public.payment_outbox o where o.refund_id = pg_temp.id('cola:refund')),
  'refund_reconcile|pending|true', 'control: el reembolso dudoso encola su conciliación, con su intento de pago');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'recién encolada no es una alerta');
update public.payment_outbox set status = 'dead_letter', attempts = 8, last_error = 'refund_identity_unknown'
 where refund_id = pg_temp.id('cola:refund');
select pg_temp.barrer('a');
select is(
  (select a.severity || '|' || a.subject_type || '|' || (a.subject_id = pg_temp.id('cola:intent'))::text || '|' || (a.evidence ->> 'outbox_status')
     from pg_temp.alerta('a', 'PAYMENT_OUTBOX_STALLED', pg_temp.id('cola:intent')) a where a.status <> 'resolved'),
  'CRITICAL|payment_intent|true|dead_letter', 'un refund_reconcile abandonado abre PAYMENT_OUTBOX_STALLED crítica sobre su cobro');
select public.record_payment_refund_response_v2(pg_temp.id('cola:refund'), null, 'rejected',
  (select r.amount from public.payment_refunds r where r.id = pg_temp.id('cola:refund')), pg_temp.hash('cola-rechazada'));
update public.payment_outbox set status = 'completed', completed_at = clock_timestamp()
 where refund_id = pg_temp.id('cola:refund');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'resuelto el reembolso y su trabajo, no queda ninguna');

-- Un aviso abandonado que habla de un pago que un cobro del negocio YA conoce: el
-- trabajo sigue sin intento, pero la alerta lleva la correlación de ese cobro y la
-- traza de su pedido la muestra.
select pg_temp.aviso('a', 'cola-principal');
update public.payment_outbox set status = 'dead_letter', attempts = 8, last_error = 'Unable to finalize verified payment'
 where id = pg_temp.id('aviso_cola-principal');
select pg_temp.barrer('a');
select is(
  (select (a.correlation_id = (select pi.correlation_id from public.payment_intents pi where pi.id = pg_temp.id('cola:intent')))::text
          || '|' || a.subject_type || '|' || (a.evidence ->> 'provider_resource_id') || '|' || (a.evidence::text like '%Unable to finalize%')::text
     from pg_temp.alerta('a', 'PAYMENT_OUTBOX_STALLED', pg_temp.id('aviso_cola-principal')) a),
  'true|payment_outbox|' || pg_temp.pago_id('cola', 'principal') || '|false',
  'el aviso de un pago ya conocido lleva la correlación de su cobro; el error crudo del worker no va a la evidencia');
select pg_temp.como_duenia('a');
select is(
  (select count(*)::integer
     from jsonb_array_elements(public.get_order_trace(pg_temp.id('a'), pg_temp.id('cola:order')::text) -> 'timeline') t(value)
    where t.value ->> 'event' = 'alert.PAYMENT_OUTBOX_STALLED' and t.value #>> '{details,status}' = 'open'),
  1, 'y la traza del pedido de ese cobro muestra la alerta abierta');
select pg_temp.nadie();
update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where id = pg_temp.id('aviso_cola-principal');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'procesado el aviso, se cierra');

-- Un aviso que no trae vendedor (el modo anterior a la conexión por negocio) no es
-- de ningún negocio: lo cuenta `get_ecommerce_health`, no estas alertas.
select public.record_mercadopago_webhook_receipt('test', 'evt-operational-alert-coverage-test-sin-vendedor', 'payment',
  'PAY-operational-alert-coverage-test-sin-vendedor', true, 'rq-oac-sin-vendedor', pg_temp.hash('aviso-sin-vendedor'));
update public.payment_outbox set status = 'dead_letter', attempts = 8
 where webhook_receipt_id = (select r.id from public.payment_webhook_receipts r
                              where r.webhook_event_id = 'evt-operational-alert-coverage-test-sin-vendedor');
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'), '- | -',
  'un aviso sin vendedor no se le atribuye a nadie (queda para la salud de la plataforma)');

-- ══ 5 · UNA DEVOLUCIÓN QUE NO TERMINÓ ═══════════════════════════════════════
select pg_temp.pedido_pagado('a', 'devolucion');
select pg_temp.como_duenia('a');
select public.prepare_payment_refund_v2(pg_temp.id('devolucion:intent'), null, pg_temp.uid('clave-devolucion'), 'devolucion de prueba');
select pg_temp.nadie();
insert into ids select 'devolucion:refund', r.id from public.payment_refunds r where r.payment_intent_id = pg_temp.id('devolucion:intent');
select is(
  (select r.status || '|' || (select count(*) from public.payment_outbox o where o.refund_id = r.id)::text
     from public.payment_refunds r where r.id = pg_temp.id('devolucion:refund')),
  'requested|0', 'control: la devolución nace «requested» y no deja ningún trabajo en la cola');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'recién pedida no es una alerta: una devolución sana se resuelve en segundos');
update public.payment_refunds set requested_at = clock_timestamp() - interval '14 minutes' where id = pg_temp.id('devolucion:refund');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'a los 14 minutos todavía no');
update public.payment_refunds set requested_at = clock_timestamp() - interval '16 minutes' where id = pg_temp.id('devolucion:refund');
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'), 'REFUND_NEEDS_ATTENTION/ACTION_REQUIRED/open[payment_refund] | -',
  'pasados los 15 minutos: REFUND_NEEDS_ATTENTION en su negocio; el otro, nada');
select is(
  (select (a.evidence - 'waiting_minutes') || jsonb_build_object('subject', a.subject_id,
            'correlation_del_cobro', a.correlation_id = (select pi.correlation_id from public.payment_intents pi where pi.id = pg_temp.id('devolucion:intent')),
            'minutos', (a.evidence ->> 'waiting_minutes')::numeric between 15 and 17)
     from pg_temp.alerta('a', 'REFUND_NEEDS_ATTENTION') a),
  jsonb_build_object('refund_id', pg_temp.id('devolucion:refund'), 'payment_intent_id', pg_temp.id('devolucion:intent'),
    'order_id', pg_temp.id('devolucion:order'), 'status', 'requested', 'has_provider_identity', false, 'resolution_mode', null,
    'subject', pg_temp.id('devolucion:refund'), 'correlation_del_cobro', true, 'minutos', true),
  'la evidencia: la devolución, su cobro, su pedido, en qué quedó y hace cuánto; ni importe ni motivo escrito a mano');
select pg_temp.barrer('a');
select is(
  (select count(*)::text || '|' || max(a.occurrence_count)::text || '|' || pg_temp.eventos((array_agg(a.id))[1])
     from public.operational_alerts a where a.business_id = pg_temp.id('a') and a.alert_code = 'REFUND_NEEDS_ATTENTION'),
  '1|1|detected', 'otra corrida no la duplica');
-- No se cierra por cambiar a otro estado que tampoco es final, ni por tiempo.
select public.mark_payment_refund_ambiguous(pg_temp.id('devolucion:refund'), pg_temp.hash('devolucion-ambigua'), 'network_or_timeout');
update public.payment_refunds set requested_at = clock_timestamp() - interval '40 days' where id = pg_temp.id('devolucion:refund');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.evidence ->> 'status') from pg_temp.alerta('a', 'REFUND_NEEDS_ATTENTION') a),
  'open|ambiguous', 'ambigua y con 40 días encima sigue abierta: no vence sola');
update public.payment_refunds set status = 'processing' where id = pg_temp.id('devolucion:refund');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.evidence ->> 'status') from pg_temp.alerta('a', 'REFUND_NEEDS_ATTENTION') a),
  'open|processing', 'en «processing» también');
-- Llega a un estado final por la función de siempre.
select public.record_payment_refund_response_v2(pg_temp.id('devolucion:refund'), null, 'rejected',
  (select r.amount from public.payment_refunds r where r.id = pg_temp.id('devolucion:refund')), pg_temp.hash('devolucion-rechazada'));
update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where refund_id = pg_temp.id('devolucion:refund');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id) from pg_temp.alerta('a', 'REFUND_NEEDS_ATTENTION') a),
  'resolved|true|detected resolved', 'cuando la devolución llega a un estado final (rechazada) se cierra sola');
select is(pg_temp.alertas('a'), '-', 'y no queda nada abierto');

-- ══ 6 · UN COBRO QUE NECESITA REVISIÓN ══════════════════════════════════════
-- 6a · El cliente pagó dos veces.
select pg_temp.pedido_pagado('a', 'doble');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'un pedido pagado una vez no es una alerta');
select is(
  pg_temp.asentar('doble', pg_temp.pago('doble', 'segundo', 'approved', 'aprobado')),
  '{"ok": true, "internal_status": "completed", "finalize_required": false, "secondary_payment": true, "duplicate_approved": true, "manual_review_required": false, "refund_review_required": true}'::jsonb,
  'control: un segundo pago aprobado sobre el mismo checkout se asienta como duplicado, con devolución pendiente');
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'), 'PAYMENT_NEEDS_REVIEW/CRITICAL/open[payment_intent] | -',
  'PAYMENT_NEEDS_REVIEW se abre, crítica, en su negocio; el otro, nada');
select is(
  (select a.evidence || jsonb_build_object('subject', a.subject_id,
            'correlation_del_cobro', a.correlation_id = (select pi.correlation_id from public.payment_intents pi where pi.id = pg_temp.id('doble:intent')))
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a),
  jsonb_build_object('payment_intent_id', pg_temp.id('doble:intent'), 'order_id', pg_temp.id('doble:order'),
    'provider_payment_id', pg_temp.pago_id('doble', 'principal'), 'reasons', jsonb_build_array('duplicate_charge'),
    'duplicate_provider_payment_ids', jsonb_build_array(pg_temp.pago_id('doble', 'segundo')), 'duplicate_payments', 1,
    'subject', pg_temp.id('doble:intent'), 'correlation_del_cobro', true),
  'la evidencia trae lo que hace falta para actuar: el cobro, el pago del pedido y el id del pago duplicado');
select ok(
  (select position('Tadeo' in a.evidence::text) = 0 and position('2994666321' in a.evidence::text) = 0
          and position(pg_temp.hash('pagador-privado') in a.evidence::text) = 0
          and position('Tadeo' in a.summary || a.required_action) = 0
          and octet_length(a.evidence::text) < 1024
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a),
  'sin nombre, teléfono ni huella del correo del comprador');
select is(
  (select a.summary || ' / ' || a.required_action from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a),
  'El cliente pagó dos veces la misma compra en Mercado Pago. / Devolver el pago duplicado desde el panel de Mercado Pago: desde el Panel sólo se reembolsa el pago del pedido. Se cierra sola cuando Mercado Pago informa la devolución.',
  'dice qué pasó, qué hay que hacer y cómo se cierra');
-- La misma respuesta del proveedor otra vez (un reintento del aviso) no cambia nada.
select pg_temp.asentar('doble', pg_temp.pago('doble', 'segundo', 'approved', 'aprobado'));
select pg_temp.barrer('a');
select pg_temp.barrer('a');
select is(
  (select count(*)::text || '|' || max(a.occurrence_count)::text || '|' || pg_temp.eventos((array_agg(a.id))[1])
     from public.operational_alerts a where a.business_id = pg_temp.id('a') and a.alert_code = 'PAYMENT_NEEDS_REVIEW'),
  '1|1|detected', 'más corridas y un aviso repetido: una fila, una ocurrencia, un evento');
-- Nunca por tiempo.
update public.payment_events set server_recorded_at = server_recorded_at - interval '60 days', provider_occurred_at = provider_occurred_at - interval '60 days'
 where payment_intent_id = pg_temp.id('doble:intent');
update public.payment_intents set approved_at = approved_at - interval '60 days' where id = pg_temp.id('doble:intent');
select pg_temp.barrer('a');
select is((select a.status from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a), 'open',
  'sesenta días después sigue abierta: un cobro duplicado no vence');
-- Devuelto a medias: sigue.
select pg_temp.asentar('doble', pg_temp.pago('doble', 'segundo', 'approved', 'medio-devuelto', jsonb_build_object('refunded_amount', '400.00')));
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || a.severity from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a),
  'open|CRITICAL', 'con el duplicado devuelto a medias sigue abierta y crítica');
-- Una persona NO puede dar por cerrado un pago duplicado: es dinero del cliente y lo
-- cierra sólo lo que informe el proveedor. Si la marca resuelta, la corrida siguiente
-- la reabre.
select pg_temp.resolver('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent'), 'devuelto por fuera, dice el operador');
select is(
  (select a.status || '|' || (a.resolved_by = pg_temp.id('owner_a'))::text from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a),
  'resolved|true', 'control: la dueña la da por resuelta con una nota');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || a.severity || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a),
  'open|CRITICAL|true|detected resolved reopened',
  'con el duplicado todavía sin devolver en Mercado Pago, la corrida siguiente la reabre: la nota de una persona no lo cierra');
-- Devuelto entero en Mercado Pago: llega el aviso, se asienta, se cierra.
select is(
  pg_temp.asentar('doble', pg_temp.pago('doble', 'segundo', 'refunded', 'devuelto')) ->> 'refund_review_required', 'false',
  'control: el asiento del duplicado ya devuelto no pide devolución');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('doble:intent')) a),
  'resolved|true|detected resolved reopened resolved', 'cuando el último asiento de ese pago lo muestra devuelto, se cierra sola');

-- Un duplicado que YA llega devuelto entero no abre nada.
select pg_temp.pedido_pagado('a', 'doble_devuelto');
select pg_temp.asentar('doble_devuelto', pg_temp.pago('doble_devuelto', 'segundo', 'approved', 'ya-devuelto',
  (select jsonb_build_object('refunded_amount', cs.total::text) from public.checkout_sessions cs where cs.id = pg_temp.id('doble_devuelto:session'))));
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'un duplicado que llega ya devuelto no pide nada');

-- 6b · Después del pedido, el proveedor informa algo que no valida (un reclamo).
select pg_temp.pedido_pagado('a', 'reclamo');
select is(
  pg_temp.asentar('reclamo', pg_temp.pago('reclamo', 'principal', 'in_mediation', 'mediacion')) ->> 'operational_review_required', 'true',
  'control: «in_mediation» sobre un pedido ya creado queda como anomalía posterior, sin tocar el cobro');
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'), 'PAYMENT_NEEDS_REVIEW/ACTION_REQUIRED/open[payment_intent] | -',
  'PAYMENT_NEEDS_REVIEW, con acción requerida, en su negocio');
select is(
  (select a.evidence - 'payment_intent_id' - 'order_id' - 'provider_payment_id'
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('reclamo:intent')) a),
  '{"reasons": ["post_completion_anomaly"], "anomaly_reasons": ["unknown_provider_status"], "anomaly_provider_statuses": ["in_mediation"]}'::jsonb,
  'la evidencia dice el motivo de la anomalía y el estado que informó el proveedor');
select is(
  (select a.summary from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('reclamo:intent')) a),
  'Un cobro de Mercado Pago necesita que una persona lo revise.', 'con su propio texto');
-- El mismo estado otra vez no la cierra; una lectura válida posterior del mismo pago, sí.
select pg_temp.asentar('reclamo', pg_temp.pago('reclamo', 'principal', 'in_mediation', 'mediacion-2'));
select pg_temp.barrer('a');
select is((select a.status from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('reclamo:intent')) a), 'open',
  'otra lectura con el mismo reclamo: sigue abierta');
-- Una persona la da por resuelta con su nota: vale, y las corridas siguientes no la reabren.
select pg_temp.resolver('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('reclamo:intent'), 'reclamo atendido en Mercado Pago');
select pg_temp.barrer('a');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by = pg_temp.id('owner_a'))::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('reclamo:intent')) a),
  'resolved|true|detected resolved',
  'la anomalía que una persona dio por resuelta queda resuelta por ella: dos corridas después no se reabrió');
-- Algo nuevo del proveedor sobre lo mismo, posterior a esa resolución: vuelve a abrirse.
select pg_temp.asentar('reclamo', pg_temp.pago('reclamo', 'principal', 'in_mediation', 'mediacion-3'));
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('reclamo:intent')) a),
  'open|true|detected resolved reopened', 'una anomalía nueva, posterior a la resolución, la reabre');
select pg_temp.asentar('reclamo', pg_temp.pago('reclamo', 'principal', 'approved', 'reclamo-cerrado'));
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || pg_temp.eventos(a.id) from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('reclamo:intent')) a),
  'resolved|detected resolved reopened resolved', 'una lectura válida posterior del mismo pago (el reclamo se cerró) la cierra');

-- 6c · Contracargo.
select pg_temp.pedido_pagado('a', 'contracargo');
select pg_temp.asentar('contracargo', pg_temp.pago('contracargo', 'principal', 'charged_back', 'contracargo'));
select pg_temp.barrer('a');
select is(
  (select a.severity || '|' || a.status || '|' || (a.evidence -> 'reasons')::text || '|' || (a.evidence ->> 'provider_status')
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent')) a),
  'ACTION_REQUIRED|open|["provider_dispute"]|charged_back', 'un contracargo informado por el proveedor la abre');
update public.payment_intents set approved_at = approved_at - interval '90 days' where id = pg_temp.id('contracargo:intent');
update public.payment_events set server_recorded_at = server_recorded_at - interval '90 days' where payment_intent_id = pg_temp.id('contracargo:intent');
select pg_temp.barrer('a');
select is((select a.status from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent')) a), 'open',
  'noventa días después sigue abierta: se cierra por lo que diga el proveedor, no por el calendario');
-- El empleado la marca resuelta: el Panel se lo deja hacer, pero no ve el cobro, y
-- su marca no cuenta como la revisión de una persona.
select pg_temp.resolver('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent'), 'ya lo vi, queda asi', 'staff');
select is(
  (select a.status || '|' || (a.resolved_by = pg_temp.id('staff_a'))::text
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent')) a),
  'resolved|true', 'control: el empleado puede marcarla resuelta con su nota');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent')) a),
  'open|true|detected resolved reopened',
  'la marca del empleado no apaga un contracargo: la corrida siguiente la reabre');
select is(
  pg_temp.para_revisar('a', 'contracargo:intent'),
  1, 'y el cobro sigue entre los que hay que revisar');
-- Un contracargo perdido no cambia nunca de estado en el proveedor: lo cierra el
-- dueño o un encargado, con su nota, y esa resolución se respeta.
select pg_temp.resolver('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent'), 'contracargo perdido, asentado en la caja');
select pg_temp.barrer('a');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by = pg_temp.id('owner_a'))::text || '|' || pg_temp.eventos(a.id) || '|' ||
          (select pi.provider_status from public.payment_intents pi where pi.id = pg_temp.id('contracargo:intent'))
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent')) a),
  'resolved|true|detected resolved reopened resolved|charged_back',
  'con el cobro todavía contracargado, la alerta que la dueña dio por resuelta sigue resuelta dos corridas después');
select is(
  pg_temp.para_revisar('a', 'contracargo:intent'),
  0, 'y el cobro deja de figurar entre los que hay que revisar');
-- El proveedor vuelve a informar ese pago, todavía contracargado: es algo nuevo
-- sobre lo mismo, posterior a la resolución, y la alerta se reabre.
select pg_temp.asentar('contracargo', pg_temp.pago('contracargo', 'principal', 'charged_back', 'contracargo-2'));
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent')) a),
  'open|true|detected resolved reopened resolved reopened', 'una novedad del proveedor posterior a la resolución la reabre');
-- El contracargo se revierte: el proveedor vuelve a informar el pago aprobado.
select pg_temp.asentar('contracargo', pg_temp.pago('contracargo', 'principal', 'approved', 'contracargo-revertido'));
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (select pi.provider_status from public.payment_intents pi where pi.id = pg_temp.id('contracargo:intent'))
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('contracargo:intent')) a),
  'resolved|approved', 'cuando el estado del proveedor deja de ser contracargo, se cierra');

-- «in_mediation» guardado en el cobro: hoy el asiento no lo escribe (lo rechaza como
-- estado desconocido), pero si un día llega, la rama ya lo lee.
select pg_temp.pedido_pagado('a', 'mediacion');
update public.payment_intents set provider_status = 'in_mediation' where id = pg_temp.id('mediacion:intent');
select pg_temp.barrer('a');
select is(
  (select (a.evidence -> 'reasons')::text || '|' || (a.evidence ->> 'provider_status')
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('mediacion:intent')) a where a.status <> 'resolved'),
  '["provider_dispute"]|in_mediation', 'un cobro con el proveedor en «in_mediation» también');
update public.payment_intents set provider_status = 'approved' where id = pg_temp.id('mediacion:intent');
select pg_temp.barrer('a');
select is(pg_temp.alertas('a'), '-', 'y se cierra cuando deja de estarlo');

-- 6d · Varios motivos en el mismo cobro: UNA alerta, que baja de severidad cuando el
-- motivo crítico se va y se cierra cuando se van todos.
select pg_temp.pedido_pagado('a', 'varios');
select pg_temp.asentar('varios', pg_temp.pago('varios', 'segundo', 'approved', 'aprobado'));
select pg_temp.asentar('varios', pg_temp.pago('varios', 'principal', 'charged_back', 'contracargo'));
select pg_temp.barrer('a');
select is(
  (select count(*)::text || '|' || max(a.severity) || '|' || (max(a.evidence::text)::jsonb -> 'reasons')::text
     from public.operational_alerts a
    where a.business_id = pg_temp.id('a') and a.alert_code = 'PAYMENT_NEEDS_REVIEW' and a.subject_id = pg_temp.id('varios:intent')),
  '1|CRITICAL|["duplicate_charge", "provider_dispute"]', 'duplicado y contracargo en el mismo cobro: una sola alerta, crítica, con los dos motivos');
select pg_temp.asentar('varios', pg_temp.pago('varios', 'segundo', 'refunded', 'devuelto'));
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || a.severity || '|' || (a.evidence -> 'reasons')::text
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('varios:intent')) a),
  'open|ACTION_REQUIRED|["provider_dispute"]', 'devuelto el duplicado, queda abierta por el contracargo y deja de ser crítica');
select pg_temp.asentar('varios', pg_temp.pago('varios', 'principal', 'approved', 'contracargo-revertido'));
select pg_temp.barrer('a');
select is((select a.status from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('varios:intent')) a), 'resolved',
  'y sin ningún motivo, se cierra');

-- Los dos motivos y una persona que la da por resuelta: su nota cierra el
-- contracargo, no el pago duplicado. La alerta vuelve, sólo por el duplicado.
select pg_temp.pedido_pagado('a', 'varios2');
select pg_temp.asentar('varios2', pg_temp.pago('varios2', 'segundo', 'approved', 'aprobado'));
select pg_temp.asentar('varios2', pg_temp.pago('varios2', 'principal', 'charged_back', 'contracargo'));
select pg_temp.barrer('a');
select pg_temp.resolver('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('varios2:intent'), 'contracargo asentado; el duplicado ya se devuelve');
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || a.severity || '|' || (a.evidence -> 'reasons')::text || '|' || pg_temp.eventos(a.id)
     from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('varios2:intent')) a),
  'open|CRITICAL|["duplicate_charge"]|detected resolved reopened',
  'resuelta por una persona con los dos motivos: se reabre sólo por el duplicado, que sigue sin devolver');
select pg_temp.asentar('varios2', pg_temp.pago('varios2', 'segundo', 'refunded', 'devuelto'));
select pg_temp.barrer('a');
select is(
  (select a.status || '|' || (a.resolved_by is null)::text from pg_temp.alerta('a', 'PAYMENT_NEEDS_REVIEW', pg_temp.id('varios2:intent')) a),
  'resolved|true', 'devuelto el duplicado no queda ningún motivo: la cierra el sistema');

-- 6e · El aislamiento, mirado desde el otro lado: lo mismo en B no aparece en A.
select pg_temp.pedido_pagado('b', 'ajeno');
select pg_temp.asentar('ajeno', pg_temp.pago('ajeno', 'segundo', 'approved', 'aprobado'));
select pg_temp.aviso('b', 'ajeno');
update public.payment_outbox set status = 'dead_letter', attempts = 8 where id = pg_temp.id('aviso_ajeno');
select pg_temp.barrer('a');
select pg_temp.barrer('b');
select is(pg_temp.alertas('a') || ' | ' || pg_temp.alertas('b'),
  '- | PAYMENT_NEEDS_REVIEW/CRITICAL/open[payment_intent] PAYMENT_OUTBOX_STALLED/CRITICAL/open[payment_outbox]',
  'un duplicado y un aviso abandonado de B son de B: A no ve nada');
select is(
  pg_temp.para_revisar('a', 'ajeno:intent') || '|' || pg_temp.para_revisar('b', 'ajeno:intent'),
  '0|1', 'la consulta de cobros para revisar, pedida por A, no devuelve el cobro de B; pedida por B, sí');

-- ══ 7 · LO QUE VE EL PANEL ══════════════════════════════════════════════════
select pg_temp.como_duenia('b');
create temporary table centro_b on commit drop as select public.get_production_operation_center(pg_temp.id('b')) as c;
select pg_temp.nadie();
select is(
  (select string_agg(x.value ->> 'code' || '/' || (x.value ->> 'severity') || '/' || (x.value ->> 'subject_type'), ' ' order by x.value ->> 'code')
     from centro_b, jsonb_array_elements(c -> 'alerts') x(value)
    where x.value ->> 'code' in ('PAYMENT_NEEDS_REVIEW', 'PAYMENT_OUTBOX_STALLED', 'REFUND_NEEDS_ATTENTION')),
  'PAYMENT_NEEDS_REVIEW/CRITICAL/payment_intent PAYMENT_OUTBOX_STALLED/CRITICAL/payment_outbox',
  'el centro de operación de B lista sus dos alertas nuevas');
select ok(
  (select (x.value ->> 'subject_id')::uuid = pg_temp.id('ajeno:intent')
     from centro_b, jsonb_array_elements(c -> 'alerts') x(value) where x.value ->> 'code' = 'PAYMENT_NEEDS_REVIEW'),
  'y la del cobro apunta al intento de pago, como las demás alertas de pagos');
select pg_temp.como_duenia('a');
select throws_ok(
  format($q$select public.get_production_operation_center(%L)$q$, pg_temp.id('b')), '42501', 'operador no autorizado',
  'la dueña de A no entra al centro de operación de B');
select pg_temp.nadie();

select * from finish();
rollback;
