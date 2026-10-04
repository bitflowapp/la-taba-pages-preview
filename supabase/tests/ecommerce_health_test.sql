-- TABA · LA SALUD DE LA PLATAFORMA, COMPONENTE POR COMPONENTE
--
-- `get_ecommerce_health()` contesta por la plataforma entera: base, Auth,
-- checkout, pedidos, cobros, avisos del proveedor y planificador. Acá se prueba
-- provocando cada condición de verdad:
--
--   · sana, dice `ok` en los siete componentes;
--   · el estado general es el peor de los componentes;
--   · firmas rechazadas, avisos abandonados sin intento de pago, una tarea
--     borrada o apagada: lo que la salud del Panel no veía, acá figura;
--   · una sonda que no puede leer deja SU componente en `unknown` y los demás se
--     informan igual: la función no levanta;
--   · no sale ningún secreto ni dato personal: de la cuenta de Mercado Pago, su
--     estado; de los avisos, cuentas; de los pedidos sin atender, cuántos.
--
-- No depende de la hora: todo es relativo a clock_timestamp().
-- No depende de lo que haya en la base: arma su propio punto de partida (abajo).
-- Todo transaccional: termina en rollback.
--
-- PRECONDICIONES DEL ENTORNO (las dos las cumple `postgres` en la plataforma
-- administrada; el arnés de CI las concede al preparar pg_cron y al degradar el rol):
--   · INSERT sobre `cron.job_run_details`: la prueba arma el historial de pg_cron
--     a mano (`grant insert on cron.job_run_details to postgres`);
--   · poder fijar `session_replication_role`: el punto de partida se arma sin
--     disparadores (`grant set on parameter session_replication_role to postgres`).

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

do $precondition$
begin
  if not has_table_privilege(current_user, 'cron.job_run_details', 'INSERT') then
    raise exception 'PRECONDICION: el rol % necesita INSERT sobre cron.job_run_details para armar el historial de prueba (grant insert on cron.job_run_details to %)',
      current_user, current_user using errcode = '42501';
  end if;
end
$precondition$;

create function pg_temp.component(p_name text) returns jsonb language sql as $$
  select c.value from jsonb_array_elements(public.get_ecommerce_health() -> 'components') c(value)
   where c.value ->> 'component' = p_name;
$$;
create function pg_temp.run(p_job text, p_status text, p_ago interval) returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'prueba', p_status, 'ok',
         clock_timestamp() - p_ago, clock_timestamp() - p_ago + interval '1 second'
    from cron.job j where j.jobname = p_job;
$$;

-- ── Punto de partida: una plataforma sin nada pendiente ─────────────────────
-- La salud es de TODA la plataforma: cuenta cualquier fila que haya en la base,
-- no sólo las de esta prueba. Una base de pruebas compartida trae de todo (el
-- arnés de CI ensaya antes la liberación: deja checkouts, avisos, trabajos en
-- cola, una tarea apagada). Acá se parte de cero ADENTRO de esta transacción, que
-- termina en rollback: lo confirmado en la base no se toca.
-- Sin disparadores, porque varias de estas tablas tienen compuertas que no dejan
-- borrar por el camino normal; es el mismo mecanismo con el que el arnés de CI
-- limpia sus propios datos.
do $start$
begin
  begin
    perform set_config('session_replication_role', 'replica', true);
  exception when insufficient_privilege then
    raise exception 'PRECONDICION: el rol % necesita poder fijar session_replication_role para armar el punto de partida (grant set on parameter session_replication_role to %)',
      current_user, current_user using errcode = '42501';
  end;
  delete from public.payment_outbox;
  delete from public.payment_webhook_receipts;
  delete from public.inventory_reservations;
  delete from public.checkout_sessions;
  delete from public.orders o
   where o.status in ('submitted', 'received') and o.acknowledged_at is null
     and coalesce(o.origin, 'production') <> 'qa';
  delete from private.order_intake_blocks;
  update public.business_payment_settings set enabled = false where enabled;
  update private.a1_a4_release_control_v5 set paused = false where paused;
  update private.a1_a4_payment_dispatch_control
     set paused = false, paused_at = null, paused_by = null, target_edge_version = null
   where paused;
  perform set_config('session_replication_role', 'origin', true);
end
$start$;

-- ── Una plataforma sana ────────────────────────────────────────────────────
-- El planificador como lo deja pg_cron cuando todo anda: cada tarea del
-- inventario existe, está activa y corrió recién, no hay ninguna tarea taba-*
-- fuera del inventario, y el barrido dejó su latido.
select cron.unschedule(j.jobname) from cron.job j
 where j.jobname like 'taba-%'
   and not exists (select 1 from private.scheduler_expected_jobs e where e.job_name = j.jobname);
select cron.schedule(e.job_name, '* * * * *', 'select 1') from private.scheduler_expected_jobs e
 where not exists (select 1 from cron.job j where j.jobname = e.job_name);
select cron.alter_job(j.jobid, active => true) from cron.job j where j.jobname like 'taba-%' and not j.active;
delete from cron.job_run_details;
select pg_temp.run(j.jobname, 'succeeded', interval '20 seconds') from cron.job j where j.jobname like 'taba-%';
delete from public.operational_sweep_runs where scope = 'operational_alerts';
insert into public.operational_sweep_runs (scope, status, started_at, finished_at)
values ('operational_alerts', 'ok', clock_timestamp(), clock_timestamp());

create temporary table healthy on commit drop as select public.get_ecommerce_health() as doc;

-- ── 1 · Contrato ───────────────────────────────────────────────────────────
select ok(
  has_function_privilege('service_role', 'public.get_ecommerce_health()', 'execute')
  and not has_function_privilege('anon', 'public.get_ecommerce_health()', 'execute')
  and not has_function_privilege('authenticated', 'public.get_ecommerce_health()', 'execute'),
  'get_ecommerce_health: sólo service_role');
select is(
  (select p.provolatile::text || ':' || p.prosecdef::text || ':' || (p.proconfig::text like '%search_path=pg_catalog%')::text
     from pg_proc p where p.oid = 'public.get_ecommerce_health()'::regprocedure),
  's:true:true', 'es de sólo lectura (STABLE), SECURITY DEFINER y con search_path fijo');
select is(
  (select array_agg(k order by k) from healthy h, jsonb_object_keys(h.doc) k),
  array['components', 'generated_at', 'not_observable_from_sql', 'status', 'summary'],
  'el documento trae estado general, resumen, componentes y lo que SQL no puede ver');
select is(
  (select array_agg(c.value ->> 'component' order by c.position)
     from healthy h, jsonb_array_elements(h.doc -> 'components') with ordinality as c(value, position)),
  array['database', 'auth', 'checkout', 'orders', 'payment_integration', 'webhook_processing', 'schedulers'],
  'los siete componentes, siempre en el mismo orden');
select is(
  (select count(*)::integer from healthy h, jsonb_array_elements(h.doc -> 'components') c(value)
    where not (c.value ?& array['component', 'status', 'checked_at', 'detail'])
       or (c.value ->> 'status') not in ('ok', 'degraded', 'down', 'unknown')
       or jsonb_typeof(c.value -> 'detail') <> 'object'),
  0, 'cada componente trae component, status (ok|degraded|down|unknown), checked_at y detail');
select is(
  (select jsonb_object_agg(c.value ->> 'component', c.value ->> 'status') from healthy h, jsonb_array_elements(h.doc -> 'components') c(value)),
  '{"database": "ok", "auth": "ok", "checkout": "ok", "orders": "ok", "payment_integration": "ok",
    "webhook_processing": "ok", "schedulers": "ok"}'::jsonb,
  'una plataforma sana dice ok en los siete');
select is((select h.doc ->> 'status' from healthy h), 'ok', 'y el estado general es ok');

-- ── 2 · database y auth ────────────────────────────────────────────────────
select ok(
  (select (pg_temp.component('database') #>> '{detail,public_tables}')::integer > 50
      and (pg_temp.component('database') #>> '{detail,in_recovery}') = 'false'
      and (pg_temp.component('database') #>> '{detail,connections,max_connections}')::integer > 0
      and case when to_regclass('supabase_migrations.schema_migrations') is null
            then pg_temp.component('database') #>> '{detail,migrations_note}' is not null
            else pg_temp.component('database') #>> '{detail,migrations_head}' ~ '^[0-9]{14}$' end),
  'database: el catálogo responde y la cabeza del libro de migraciones figura (o se dice que el libro no está)');
select is(
  pg_temp.component('auth') -> 'detail',
  '{"schema_reachable": true, "anonymous_sign_ins": {"status": "unknown",
    "reason": "que Auth permita el ingreso anónimo es configuración de GoTrue: no es visible desde SQL"}}'::jsonb,
  'auth: el esquema se alcanza; lo que SQL no puede saber se informa unknown con su motivo, no se adivina');

-- ── 3 · orders ─────────────────────────────────────────────────────────────
insert into auth.users (id, aud, role, email, encrypted_password) values
  ('a7800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'salud-owner@example.invalid', ''),
  ('a7800000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'salud-cliente-pii@example.invalid', '');
insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
  ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal)
values ('b7800000-0000-4000-8000-0000000000a1', 'TABA salud', 'taba-salud', 'open', true, true, true,
  clock_timestamp(), 'a7800000-0000-4000-8000-000000000001', 'ARS', true, false, 0.00, 0.00);
insert into public.orders (id, business_id, code, public_code, status, fulfillment_type, delivery_mode, client_request_id,
  customer_name, customer_phone, payment_method, subtotal, delivery_fee, total, created_at, updated_at, origin, origin_reason, origin_classified_at)
values
  ('d7800000-0000-4000-8000-000000000001', 'b7800000-0000-4000-8000-0000000000a1', 'SAL-0001', 'SAL-0001', 'received', 'pickup', 'pickup',
   'salud-pedido-0001', 'Zulema Salud Pii', '2996209137', 'cash', 1000, 0, 1000,
   clock_timestamp() - interval '45 minutes', clock_timestamp() - interval '45 minutes', 'production', null, null),
  ('d7800000-0000-4000-8000-000000000002', 'b7800000-0000-4000-8000-0000000000a1', 'SAL-0002', 'SAL-0002', 'received', 'pickup', 'pickup',
   'salud-pedido-0002', 'Zulema Salud Pii', '2996209137', 'cash', 1000, 0, 1000,
   clock_timestamp() - interval '3 hours', clock_timestamp() - interval '3 hours', 'qa', 'pedido de prueba', clock_timestamp()),
  ('d7800000-0000-4000-8000-000000000003', 'b7800000-0000-4000-8000-0000000000a1', 'SAL-0003', 'SAL-0003', 'received', 'pickup', 'pickup',
   'salud-pedido-0003', 'Zulema Salud Pii', '2996209137', 'cash', 1000, 0, 1000,
   clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '2 minutes', 'production', null, null);
select is(
  jsonb_build_object('status', pg_temp.component('orders') -> 'status',
    'unattended', pg_temp.component('orders') #> '{detail,unattended_over_10_minutes}',
    'oldest', pg_temp.component('orders') #> '{detail,oldest_unattended_minutes}',
    'businesses', pg_temp.component('orders') #> '{detail,businesses_with_unattended}'),
  '{"status": "degraded", "unattended": 1, "oldest": 45,
    "businesses": [{"business_id": "b7800000-0000-4000-8000-0000000000a1", "unattended": 1, "oldest_minutes": 45}]}'::jsonb,
  'orders: un pedido real sin atender hace 45 minutos degrada; el de QA y el de hace 2 minutos no cuentan');
insert into private.order_intake_blocks (business_id, scope, subject_hash, window_started_at, blocked_count, last_reason)
values ('b7800000-0000-4000-8000-0000000000a1', 'customer', sha256('salud-guardia'::bytea), clock_timestamp(), 3, 'guard_error');
select is(
  jsonb_build_object('errors', pg_temp.component('orders') #> '{detail,intake_guard,guard_errors_last_hour}',
    'blocked', pg_temp.component('orders') #> '{detail,intake_guard,blocked_attempts_last_hour}'),
  '{"errors": 3, "blocked": 3}'::jsonb,
  'orders: los errores propios del guardián de admisión de la última hora figuran');
update public.orders set status = 'accepted', acknowledged_at = clock_timestamp() where id = 'd7800000-0000-4000-8000-000000000001';
delete from private.order_intake_blocks where business_id = 'b7800000-0000-4000-8000-0000000000a1';
select is(pg_temp.component('orders') ->> 'status', 'ok', 'atendido el pedido y sin errores del guardián, orders vuelve a ok');

-- ── 4 · webhook_processing (firmas rechazadas) ─────────────────────────────
select public.record_mercadopago_webhook_receipt('production', 'evt-salud-malo-' || g, 'payment', 'pay-salud-' || g, false,
         'rq-salud-malo-' || g, repeat('c', 64))
  from generate_series(1, 4) g;
select is(
  jsonb_build_object('status', pg_temp.component('webhook_processing') -> 'status',
    'rejected', pg_temp.component('webhook_processing') #> '{detail,rejected_signature_last_hour}'),
  '{"status": "ok", "rejected": 4}'::jsonb,
  'webhook: cuatro firmas rechazadas se cuentan y no degradan: es entrada sin autenticar y cualquiera puede mandarla');
select public.record_mercadopago_webhook_receipt('production', 'evt-salud-malo-' || g, 'payment', 'pay-salud-' || g, false,
         'rq-salud-malo-' || g, repeat('c', 64))
  from generate_series(5, 6) g;
select is(
  jsonb_build_object('status', pg_temp.component('webhook_processing') -> 'status',
    'rejected_hour', pg_temp.component('webhook_processing') #> '{detail,rejected_signature_last_hour}',
    'rejected_day', pg_temp.component('webhook_processing') #> '{detail,rejected_signature_last_24h}',
    'valid_hour', pg_temp.component('webhook_processing') #> '{detail,valid_last_hour}',
    'has_last', pg_temp.component('webhook_processing') #>> '{detail,seconds_since_last_received}' is not null),
  '{"status": "degraded", "rejected_hour": 6, "rejected_day": 6, "valid_hour": 0, "has_last": true}'::jsonb,
  'webhook: seis firmas rechazadas en la hora y ningún aviso válido: degradado (el secreto del webhook está mal)');
select is((public.get_ecommerce_health() ->> 'status'), 'degraded', 'y el estado general pasa a degraded: es el peor componente');

-- ── 5 · payment_integration ────────────────────────────────────────────────
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values ('c7800000-0000-4000-8000-0000000000a1','b7800000-0000-4000-8000-0000000000a1','Lata Salud','Gaseosas','Cola',1000,'confirmed',true,'Marca',
  'Lata','Lata',473,'ml','473 ml','lata',
  50,true,true,false,'{}',true,now(),'a7800000-0000-4000-8000-000000000001','salud-sku','salud-sku','commercial',1);
insert into public.business_payment_settings (business_id, enabled, environment, checkout_mode, currency, reserve_stock,
  collector_id, application_id, configured_at, verified_at)
values ('b7800000-0000-4000-8000-0000000000a1', true, 'test', 'checkout_pro', 'ARS', true, 'collector-salud', 'app-salud',
  clock_timestamp(), clock_timestamp());
select is(
  jsonb_build_object('status', pg_temp.component('payment_integration') -> 'status',
    'enabled', pg_temp.component('payment_integration') #> '{detail,enabled_businesses}',
    'cannot', pg_temp.component('payment_integration') #> '{detail,businesses_that_cannot_charge}',
    'connection', pg_temp.component('payment_integration') #> '{detail,seller_connections,0,connection}'),
  '{"status": "down", "enabled": 1, "cannot": 1, "connection": "missing"}'::jsonb,
  'cobros: Mercado Pago encendido y ninguna cuenta vinculada puede cobrar: down');
insert into public.mp_seller_connections (business_id, environment, status, seller_id, application_id, protected_tokens, expires_at, connected_at)
values ('b7800000-0000-4000-8000-0000000000a1', 'test', 'connected', 'collector-salud', 'app-salud', 'cifrado-secreto-de-la-cuenta',
        clock_timestamp() + interval '30 days', clock_timestamp());
select is(
  jsonb_build_object('cannot', pg_temp.component('payment_integration') #> '{detail,businesses_that_cannot_charge}',
    'connection', pg_temp.component('payment_integration') #> '{detail,seller_connections,0,connection}',
    'keys', (select to_jsonb(array_agg(k order by k))
               from jsonb_object_keys(pg_temp.component('payment_integration') #> '{detail,seller_connections,0}') k)),
  '{"cannot": 0, "connection": "connected",
    "keys": ["business_id", "connected_at", "connection", "environment", "last_refresh_at", "token_expires_at"]}'::jsonb,
  'cobros: con la cuenta vinculada figura connected, y de la cuenta salen estado y fechas, nada más');

-- Un aviso firmado del vendedor que el procesador abandonó, sin intento de pago.
select public.mp_record_seller_webhook('test', 'evt-salud-1', 'payment', 'pay-salud-vendedor', true, 'rq-salud-1', repeat('b', 64),
  'b7800000-0000-4000-8000-0000000000a1');
update public.payment_outbox set status = 'dead_letter', attempts = 8, last_error = 'Provider payment does not match a checkout session'
 where webhook_receipt_id = (select r.id from public.payment_webhook_receipts r where r.webhook_event_id = 'evt-salud-1');
select is(
  jsonb_build_object('status', pg_temp.component('payment_integration') -> 'status',
    'dead_letter', pg_temp.component('payment_integration') #> '{detail,outbox,dead_letter}',
    'recent', pg_temp.component('payment_integration') #> '{detail,outbox,dead_letter_last_24h}',
    'without_intent', pg_temp.component('payment_integration') #> '{detail,outbox,without_payment_intent}'),
  '{"status": "degraded", "dead_letter": 1, "recent": 1, "without_intent": 1}'::jsonb,
  'cobros: el aviso abandonado SIN intento de pago se cuenta (la salud del Panel lo perdía en un JOIN)');
select is(
  jsonb_build_object('status', pg_temp.component('webhook_processing') -> 'status',
    'rejected_hour', pg_temp.component('webhook_processing') #> '{detail,rejected_signature_last_hour}',
    'valid_hour', pg_temp.component('webhook_processing') #> '{detail,valid_last_hour}'),
  '{"status": "ok", "rejected_hour": 6, "valid_hour": 1}'::jsonb,
  'webhook: con un aviso válido en la hora, las firmas rechazadas dejan de degradar: el secreto funciona');
-- Un trabajo que el procesador tendría que haber tomado hace 20 minutos.
select public.record_mercadopago_webhook_receipt('test', 'evt-salud-2', 'payment', 'pay-salud-atrasado', true,
  'rq-salud-2', repeat('d', 64));
update public.payment_outbox set next_attempt_at = clock_timestamp() - interval '20 minutes'
 where resource_id = 'pay-salud-atrasado';
select is(
  jsonb_build_object('status', pg_temp.component('payment_integration') -> 'status',
    'due', pg_temp.component('payment_integration') #> '{detail,outbox,due_now}',
    'lag_over_15_min', (pg_temp.component('payment_integration') #>> '{detail,outbox,oldest_due_seconds}')::numeric > 900),
  '{"status": "down", "due": 1, "lag_over_15_min": true}'::jsonb,
  'cobros: un trabajo vencido hace más de 15 minutos sin que nadie lo tome: down');
delete from public.payment_outbox where resource_id = 'pay-salud-atrasado';

-- ── 6 · checkout ───────────────────────────────────────────────────────────
create temporary table salud_session on commit drop as
  select (public.create_checkout_session('a7800000-0000-4000-8000-000000000002', jsonb_build_object(
    'business_id', 'b7800000-0000-4000-8000-0000000000a1', 'client_request_id', 'SALUD-CHECKOUT-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', 'c7800000-0000-4000-8000-0000000000a1', 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Zulema Salud Pii', 'phone', '5492996209137'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago')) ->> 'checkout_session_id')::uuid as id;
select is(pg_temp.component('checkout') ->> 'status', 'ok', 'checkout: una sesión vigente no es un problema');
update public.checkout_sessions set created_at = clock_timestamp() - interval '40 minutes', expires_at = clock_timestamp() - interval '10 minutes'
 where id = (select id from salud_session);
update public.inventory_reservations set created_at = clock_timestamp() - interval '40 minutes', expires_at = clock_timestamp() - interval '10 minutes'
 where checkout_session_id = (select id from salud_session);
select is(
  jsonb_build_object('status', pg_temp.component('checkout') -> 'status',
    'sessions', pg_temp.component('checkout') #> '{detail,sessions_past_expiry}',
    'reservations', pg_temp.component('checkout') #> '{detail,reservations_past_expiry}',
    'oldest', pg_temp.component('checkout') #> '{detail,oldest_past_expiry_minutes}'),
  '{"status": "degraded", "sessions": 1, "reservations": 1, "oldest": 10}'::jsonb,
  'checkout: una sesión vencida hace 10 minutos que el barrido no liberó, con su reserva retenida: degraded');
update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour'
 where id = (select id from salud_session);
select is(pg_temp.component('checkout') ->> 'status', 'down', 'checkout: vencida hace una hora y sigue ahí: down');
select public.sweep_expired_checkout_sessions();
select is(
  jsonb_build_object('status', pg_temp.component('checkout') -> 'status',
    'sessions', pg_temp.component('checkout') #> '{detail,sessions_past_expiry}',
    'reservations', pg_temp.component('checkout') #> '{detail,reservations_past_expiry}'),
  '{"status": "ok", "sessions": 0, "reservations": 0}'::jsonb,
  'checkout: cuando el barrido corre y libera, vuelve a ok');

-- ── 7 · Sin secretos y sin datos personales ────────────────────────────────
select is(
  (select count(*)::integer
     from unnest(array['cifrado-secreto', 'Zulema', 'Salud Pii', '2996209137', 'salud-cliente-pii', 'example.invalid',
                       'collector-salud', 'app-salud', 'SALUD-CHECKOUT-0001', 'pay-salud']) as secret(value)
    where position(lower(secret.value) in lower(public.get_ecommerce_health()::text)) > 0),
  0, 'ni el token cifrado de la cuenta, ni el id del cobrador, ni nombres, teléfonos, correos o ids de pago aparecen');
select is(
  (select coalesce(array_agg(distinct kv.value ->> 'key' order by kv.value ->> 'key'), '{}'::text[])
     from jsonb_path_query(public.get_ecommerce_health(), 'strict $.** ? (@.type() == "object").keyvalue()') kv(value)
    where kv.value ->> 'key' ~* '(protected|password|seller_id|collector|application_id|customer|phone|email|payload|hash|last_error)'),
  '{}'::text[], 'ninguna clave con nombre de credencial, de dato personal o de mensaje crudo');

-- ── 8 · Una sonda rota no tira la función ──────────────────────────────────
alter table public.payment_webhook_receipts rename to payment_webhook_receipts_fuera_de_servicio;
create temporary table broken on commit drop as select public.get_ecommerce_health() as doc;
alter table public.payment_webhook_receipts_fuera_de_servicio rename to payment_webhook_receipts;
select is(
  (select c.value - 'checked_at' from broken b, jsonb_array_elements(b.doc -> 'components') c(value)
    where c.value ->> 'component' = 'webhook_processing'),
  '{"component": "webhook_processing", "status": "unknown", "detail": {"probe_error": "42P01"}}'::jsonb,
  'con la tabla de avisos inaccesible, ese componente queda unknown con su SQLSTATE');
select is(
  (select jsonb_build_object('components', jsonb_array_length(b.doc -> 'components'),
            'others_reported', (select count(*) from jsonb_array_elements(b.doc -> 'components') c(value)
                                 where c.value ->> 'status' <> 'unknown'),
            'summary_unknown', b.doc #> '{summary,unknown}')
     from broken b),
  '{"components": 7, "others_reported": 6, "summary_unknown": 1}'::jsonb,
  'y los otros seis se informan igual: la función no levanta por una sonda');

-- ── 9 · schedulers (una tarea borrada, una apagada, el latido) ─────────────
select is(pg_temp.component('schedulers') ->> 'status', 'ok', 'schedulers: control, sigue sano antes de tocarlo');
select cron.schedule('taba-prueba-fuera-de-inventario', '* * * * *', 'select 1');
select cron.unschedule('taba-checkout-provider-truth-sweep');
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'taba-checkout-expiry-sweep'), active => false);
select is(
  jsonb_build_object('status', pg_temp.component('schedulers') -> 'status',
    'missing', pg_temp.component('schedulers') #> '{detail,missing}',
    'inactive', pg_temp.component('schedulers') #> '{detail,inactive}',
    'not_in_inventory', pg_temp.component('schedulers') #> '{detail,not_in_inventory}',
    'states', (select jsonb_object_agg(j.value ->> 'job', j.value ->> 'state')
                 from jsonb_array_elements(pg_temp.component('schedulers') #> '{detail,jobs}') j(value)
                where j.value ->> 'job' in ('taba-checkout-provider-truth-sweep', 'taba-checkout-expiry-sweep',
                                            'taba-operational-alerts-sweep'))),
  '{"status": "degraded", "missing": ["taba-checkout-provider-truth-sweep"], "inactive": ["taba-checkout-expiry-sweep"],
    "not_in_inventory": ["taba-prueba-fuera-de-inventario"],
    "states": {"taba-checkout-provider-truth-sweep": "no programada", "taba-checkout-expiry-sweep": "apagado",
               "taba-operational-alerts-sweep": "al día"}}'::jsonb,
  'schedulers: la tarea borrada figura como faltante, la apagada como apagada, y una que no está en el inventario se nombra aparte');
select is(pg_temp.component('checkout') ->> 'status', 'degraded',
  'checkout: con su barrido de vencimiento apagado, checkout también queda degraded');
update public.operational_sweep_runs set started_at = started_at - interval '30 minutes', finished_at = finished_at - interval '30 minutes'
 where scope = 'operational_alerts';
select is(
  jsonb_build_object('schedulers', pg_temp.component('schedulers') -> 'status',
    'heartbeat', pg_temp.component('schedulers') #> '{detail,heartbeat,healthy}',
    'overall', public.get_ecommerce_health() -> 'status'),
  '{"schedulers": "down", "heartbeat": false, "overall": "down"}'::jsonb,
  'schedulers: sin latido del barrido hace 30 minutos, down; y el estado general también');

select * from finish();
rollback;
