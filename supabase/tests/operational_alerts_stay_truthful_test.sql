-- TABA · UNA ALERTA ABIERTA DICE LA VERDAD
--
-- Regresiones de la migración 20261001220500, cada una sobre el defecto que se
-- reprodujo antes de tocar nada:
--
--   · abrir el Panel ya no cierra SCHEDULER_WATCHDOG_STALE con el planificador
--     muerto, ni la hace parpadear; cuando el barrido revive, la cierra él;
--   · ORDER_NOT_ACCEPTED y ORDER_STALLED no vencen a las 24 horas mientras el
--     pedido siga abierto, y se cierran cuando el pedido deja de estarlo;
--   · `check_scheduler_watchdog` (la ejecuta `anon`) guarda una etiqueta de una
--     lista cerrada, no el texto que le pasen;
--   · la salud de un negocio no muestra el fallo de barrido de otro;
--   · un aviso de Mercado Pago abandonado, sin intento de pago, cuenta en la cola
--     del negocio del vendedor y en ningún otro;
--   · una tarea horaria sana no figura detenida a los 40 minutos, y una de cada
--     minuto sigue figurando detenida a los 16.
--
-- No depende de la hora: todo es relativo a clock_timestamp().
-- Todo transaccional: termina en rollback.
--
-- PRECONDICIÓN DEL ENTORNO: la prueba arma el historial de pg_cron a mano, así que
-- el rol que la corre necesita INSERT sobre `cron.job_run_details`. En la
-- plataforma administrada `postgres` lo tiene; pg_cron de fábrica sólo da SELECT y
-- DELETE. El arnés de CI lo concede junto con el resto de la preparación de
-- pg_cron (`grant insert on cron.job_run_details to postgres`).

begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

do $precondition$
begin
  if not has_table_privilege(current_user, 'cron.job_run_details', 'INSERT') then
    raise exception 'PRECONDICION: el rol % necesita INSERT sobre cron.job_run_details para armar el historial de prueba (grant insert on cron.job_run_details to %)',
      current_user, current_user using errcode = '42501';
  end if;
end
$precondition$;

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id, aud, role, email, encrypted_password) values
  ('a7700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'alertas-owner-a@example.invalid', ''),
  ('a7700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'alertas-owner-b@example.invalid', '');
insert into public.businesses (id, name, slug, status, is_active, currency_code) values
  ('b7700000-0000-4000-8000-0000000000a1', 'TABA alertas A', 'taba-alertas-a', 'open', true, 'ARS'),
  ('b7700000-0000-4000-8000-0000000000a2', 'TABA alertas B', 'taba-alertas-b', 'open', true, 'ARS');
insert into public.business_members (business_id, user_id, role, is_active) values
  ('b7700000-0000-4000-8000-0000000000a1', 'a7700000-0000-4000-8000-000000000001', 'owner', true),
  ('b7700000-0000-4000-8000-0000000000a2', 'a7700000-0000-4000-8000-000000000002', 'owner', true);
insert into public.identity_sessions (session_id, user_id, business_id, role_at_login, client) values
  ('e7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-0000000000a1', 'owner', 'panel_web'),
  ('e7700000-0000-4000-8000-000000000002', 'a7700000-0000-4000-8000-000000000002', 'b7700000-0000-4000-8000-0000000000a2', 'owner', 'panel_web');

create function pg_temp.a() returns uuid language sql as $$ select 'b7700000-0000-4000-8000-0000000000a1'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'b7700000-0000-4000-8000-0000000000a2'::uuid $$;
create function pg_temp.as_owner(p_business uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case p_business
    when pg_temp.a() then '{"sub":"a7700000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e7700000-0000-4000-8000-000000000001"}'
    else '{"sub":"a7700000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e7700000-0000-4000-8000-000000000002"}'
  end, true)::void;
$$;
create function pg_temp.nobody() returns void language sql as $$ select set_config('request.jwt.claims', '', true)::void $$;
-- Estado de una alerta del negocio: 'open', 'acknowledged', 'resolved' o '-' si no existe.
create function pg_temp.alert(p_business uuid, p_code text, p_job text default null) returns text language sql as $$
  select coalesce((select a.status from public.operational_alerts a
                    where a.business_id = p_business and a.alert_code = p_code
                      and (p_job is null or a.evidence ->> 'job' = p_job)
                    order by a.last_seen_at desc limit 1), '-');
$$;
create function pg_temp.alert_events(p_business uuid, p_code text) returns text[] language sql as $$
  select coalesce(array_agg(e.event_type || ':' || coalesce(e.detail ->> 'source', e.detail ->> 'resolution', '-') order by e.created_at),
                  '{}'::text[])
    from public.operational_alert_events e
    join public.operational_alerts a on a.id = e.alert_id
   where a.business_id = p_business and a.alert_code = p_code;
$$;
-- El planificador «muere»: la última corrida del barrido queda a 30 minutos.
create function pg_temp.kill_scheduler() returns void language sql as $$
  delete from public.operational_sweep_runs where scope = 'operational_alerts';
  insert into public.operational_sweep_runs (scope, status, started_at, finished_at)
  values ('operational_alerts', 'ok', clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '30 minutes');
$$;
create function pg_temp.run(p_job text, p_status text, p_ago interval) returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'prueba', p_status, 'ok',
         clock_timestamp() - p_ago, clock_timestamp() - p_ago + interval '1 second'
    from cron.job j where j.jobname = p_job;
$$;

-- El planificador como en una plataforma en marcha, ANTES de la primera
-- reconciliación: cada tarea del inventario programada y encendida. Una base de
-- pruebas compartida puede traer alguna apagada o sin programar (el arnés de CI
-- ensaya antes la liberación y deja una así). Desde 20261002011000 eso es una
-- alerta en cada negocio que se reconcilia (SCHEDULER_JOB_DISABLED,
-- SCHEDULER_JOB_MISSING), con su evento: la sección 7 de esta prueba limpia las
-- alertas SCHEDULER_JOB_* del negocio A para medir desde cero y no podría borrarla.
-- Sin esa migración las dos líneas no cambian nada de lo que esta prueba mide.
select cron.schedule(e.job_name, '* * * * *', 'select 1') from private.scheduler_expected_jobs e
 where not exists (select 1 from cron.job j where j.jobname = e.job_name);
select cron.alter_job(j.jobid, active => true) from cron.job j where j.jobname like 'taba-%' and not j.active;

-- ── 1 · Firmas y privilegios intactos ──────────────────────────────────────
select ok(
  has_function_privilege('anon', 'public.check_scheduler_watchdog(text)', 'execute')
  and has_function_privilege('authenticated', 'public.check_scheduler_watchdog(text)', 'execute')
  and has_function_privilege('service_role', 'public.check_scheduler_watchdog(text)', 'execute'),
  'check_scheduler_watchdog sigue siendo pública: es la sonda externa');
select is(
  (select count(*)::integer
     from unnest(array['public.reconcile_operational_alerts_for_business(uuid)', 'public.evaluate_operational_alerts_sweep()',
                       'public.build_operational_health(uuid)']) as f(signature)
    where has_function_privilege('service_role', f.signature, 'execute')
      and not has_function_privilege('anon', f.signature, 'execute')
      and not has_function_privilege('authenticated', f.signature, 'execute')),
  3, 'la reconciliación, el barrido y la salud interna siguen siendo sólo de service_role');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in ('public.check_scheduler_watchdog(text)'::regprocedure,
                    'public.reconcile_operational_alerts_for_business(uuid)'::regprocedure,
                    'public.evaluate_operational_alerts_sweep()'::regprocedure,
                    'public.build_operational_health(uuid)'::regprocedure)
      and p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions, pg_temp%'),
  4, 'las cuatro conservan SECURITY DEFINER y su search_path');

-- ── 2 · AUTHZ-06: la sonda guarda una etiqueta de lista cerrada ────────────
select pg_temp.kill_scheduler();
set local role anon;
select is(
  public.check_scheduler_watchdog('<img src=x onerror=alert(1)>') ->> 'source', 'external',
  'anon llama con un texto propio y la sonda responde con la etiqueta external');
reset role;
select is(
  (select a.status || '/' || a.severity || '/' || (a.evidence ->> 'observed_by')
     from public.operational_alerts a
    where a.business_id = pg_temp.a() and a.alert_code = 'SCHEDULER_WATCHDOG_STALE'),
  'open/CRITICAL/external', 'la alerta se abre igual, y en su evidencia queda external, no el texto');
select is(pg_temp.alert_events(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'), array['detected:external'],
  'en el evento también');
select is(
  (select array_agg(public.check_scheduler_watchdog(s.value) ->> 'source' order by s.n)
     from unnest(array['external', 'github_actions', 'cloudflare_cron', 'order_traffic', 'sweep', '  GitHub_Actions ',
                       null, '', 'ensayo', repeat('x', 200)]) with ordinality as s(value, n)),
  array['external', 'github_actions', 'cloudflare_cron', 'order_traffic', 'sweep', 'github_actions',
        'external', 'external', 'external', 'external'],
  'las cinco etiquetas conocidas pasan (sin importar mayúsculas ni espacios); todo lo demás es external');
select is(
  (select count(*)::integer from public.operational_alert_events e join public.operational_alerts a on a.id = e.alert_id
    where a.business_id = pg_temp.a() and a.alert_code = 'SCHEDULER_WATCHDOG_STALE'),
  1, 'y diez llamadas seguidas no escribieron nada más: sigue habiendo un evento por episodio');

-- ── 3 · DIAG-04: el Panel no cierra la alerta del vigilante ────────────────
select pg_temp.as_owner(pg_temp.a());
create temporary table panel_view on commit drop as
  select public.get_production_operation_center(pg_temp.a()) as center;
select pg_temp.nobody();
select is(
  (select coalesce(string_agg(x.value ->> 'code', ',' order by x.value ->> 'code'), '(ninguna)')
     from panel_view p, jsonb_array_elements(p.center -> 'alerts') x(value)
    where x.value ->> 'code' = 'SCHEDULER_WATCHDOG_STALE'),
  'SCHEDULER_WATCHDOG_STALE', 'con el planificador muerto, el centro de operación LISTA la alerta del vigilante');
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'), 'open',
  'y abrir el Panel no la cerró');
select is((public.scheduler_heartbeat() ->> 'healthy')::boolean, false, 'el latido sigue sin estar sano');
select pg_temp.as_owner(pg_temp.a());
select public.refresh_operational_alerts(pg_temp.a());
select public.refresh_operational_alerts(pg_temp.a());
select pg_temp.nobody();
select is(pg_temp.alert_events(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'), array['detected:external'],
  'dos refrescos más del Panel: ni un resolved ni un reopened; la alerta no parpadea');

-- Una alerta que una persona marcó como vista tampoco se cierra sola.
update public.operational_alerts
   set status = 'acknowledged', acknowledged_by = 'a7700000-0000-4000-8000-000000000001', acknowledged_at = clock_timestamp(),
       resolved_by = null, resolved_at = null, resolution_note = null
 where business_id = pg_temp.a() and alert_code = 'SCHEDULER_WATCHDOG_STALE';
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'), 'acknowledged',
  'reconocida por una persona y con el planificador muerto: sigue reconocida');

-- El barrido revive: lo cierra la MISMA corrida que demuestra que volvió.
update public.businesses set status = 'closed' where id = pg_temp.b();
select is(pg_temp.alert(pg_temp.b(), 'SCHEDULER_WATCHDOG_STALE'), 'open', 'control: el negocio B también la tenía abierta');
create temporary table first_sweep on commit drop as select public.evaluate_operational_alerts_sweep() as result;
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'), 'resolved',
  'el primer barrido que vuelve a correr cierra la alerta del vigilante');
select is((pg_temp.alert_events(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'))[2], 'resolved:sweep',
  'y deja dicho que la cerró el barrido');
select is(pg_temp.alert(pg_temp.b(), 'SCHEDULER_WATCHDOG_STALE'), 'open',
  'la de un negocio que cerró mientras tanto queda para la corrida siguiente (la sonda no recorre negocios cerrados)');
select public.evaluate_operational_alerts_sweep();
select is(pg_temp.alert(pg_temp.b(), 'SCHEDULER_WATCHDOG_STALE'), 'resolved',
  'y la corrida siguiente la cierra: con el latido sano ya es una condición ausente');
update public.businesses set status = 'open' where id = pg_temp.b();

-- Con el latido sano, el Panel la sigue cerrando como siempre (no quedó clavada).
select pg_temp.kill_scheduler();
select public.check_scheduler_watchdog('external');
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'), 'open', 'vuelve a morir: se reabre');
insert into public.operational_sweep_runs (scope, status, started_at, finished_at)
values ('operational_alerts', 'ok', clock_timestamp(), clock_timestamp());
select pg_temp.as_owner(pg_temp.a());
select public.refresh_operational_alerts(pg_temp.a());
select pg_temp.nobody();
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_WATCHDOG_STALE'), 'resolved',
  'y cuando el latido vuelve a estar sano, un refresco del Panel la cierra');

-- ── 4 · DIAG-07: un pedido abierto no pierde su alerta a las 24 horas ──────
-- Un pedido de ayer que nadie aceptó y otro de ayer aceptado y trabado. Los dos
-- siguen abiertos y con su stock descontado. Y uno de hace dos horas, de control.
insert into public.orders (id, business_id, code, public_code, status, fulfillment_type, delivery_mode, client_request_id,
  customer_name, customer_phone, payment_method, subtotal, delivery_fee, total, created_at, updated_at,
  acknowledged_at, preparation_estimate_minutes)
values
  ('d7700000-0000-4000-8000-000000000001', pg_temp.a(), 'ALR-0001', 'ALR-0001', 'received', 'pickup', 'pickup',
   'alertas-pedido-0001', 'Cliente', '2990000000', 'cash', 1000, 0, 1000,
   clock_timestamp() - interval '26 hours', clock_timestamp() - interval '26 hours', null, null),
  ('d7700000-0000-4000-8000-000000000002', pg_temp.a(), 'ALR-0002', 'ALR-0002', 'accepted', 'pickup', 'pickup',
   'alertas-pedido-0002', 'Cliente', '2990000000', 'cash', 1000, 0, 1000,
   clock_timestamp() - interval '27 hours', clock_timestamp() - interval '27 hours',
   clock_timestamp() - interval '27 hours', 30),
  ('d7700000-0000-4000-8000-000000000003', pg_temp.a(), 'ALR-0003', 'ALR-0003', 'received', 'pickup', 'pickup',
   'alertas-pedido-0003', 'Cliente', '2990000000', 'cash', 1000, 0, 1000,
   clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours', null, null);
select is(
  (select array_agg(o.public_code || '=' || o.status || '/' || round(extract(epoch from clock_timestamp() - o.created_at) / 3600)
                    order by o.public_code)
     from public.orders o where o.business_id = pg_temp.a()),
  array['ALR-0001=received/26', 'ALR-0002=accepted/27', 'ALR-0003=received/2'],
  'control: los tres pedidos quedaron con la edad y el estado del fixture');
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(
  (select array_agg(x.line order by x.line)
     from (select a.alert_code || ':' || (select o.public_code from public.orders o where o.id = a.subject_id) || ':' || a.status as line
             from public.operational_alerts a
            where a.business_id = pg_temp.a() and a.alert_code in ('ORDER_NOT_ACCEPTED', 'ORDER_STALLED')) x),
  array['ORDER_NOT_ACCEPTED:ALR-0001:open', 'ORDER_NOT_ACCEPTED:ALR-0003:open', 'ORDER_STALLED:ALR-0002:open'],
  'un pedido sin aceptar de hace 26 horas y uno trabado de hace 27 TIENEN su alerta abierta, igual que el de hace 2');
select is(
  (public.build_operational_health(pg_temp.a()) -> 'orders_needing_attention') - 'active_deliveries' - 'ready_without_rider',
  '{"not_accepted": 2, "stalled": 1}'::jsonb,
  'y la salud del negocio cuenta lo mismo que las alertas: ya no se contradicen');
-- Atender, cancelar o vencer el pedido es lo que cierra la alerta.
update public.orders set status = 'cancelled' where id = 'd7700000-0000-4000-8000-000000000001';
update public.orders set status = 'ready' where id = 'd7700000-0000-4000-8000-000000000002';
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(
  (select array_agg(x.line order by x.line)
     from (select a.alert_code || ':' || (select o.public_code from public.orders o where o.id = a.subject_id) || ':' || a.status as line
             from public.operational_alerts a
            where a.business_id = pg_temp.a() and a.alert_code in ('ORDER_NOT_ACCEPTED', 'ORDER_STALLED')) x),
  array['ORDER_NOT_ACCEPTED:ALR-0001:resolved', 'ORDER_NOT_ACCEPTED:ALR-0003:open', 'ORDER_STALLED:ALR-0002:resolved'],
  'cancelar el viejo y avanzar el trabado cierra sus alertas; la del que sigue sin aceptar queda');

-- ── 5 · DIAG-11: los fallos de barrido de otro negocio no se muestran ──────
insert into public.operational_sweep_runs (scope, status, started_at, finished_at, businesses_evaluated, findings, failures)
values ('operational_alerts', 'partial', clock_timestamp(), clock_timestamp(), 1, 0, jsonb_build_array(
  jsonb_build_object('business_id', pg_temp.b(), 'error', 'relation "tabla_privada_de_b" does not exist')));
select pg_temp.as_owner(pg_temp.a());
create temporary table health_a on commit drop as select public.get_operational_health(pg_temp.a()) as h;
select pg_temp.as_owner(pg_temp.b());
create temporary table health_b on commit drop as select public.get_operational_health(pg_temp.b()) as h;
select pg_temp.nobody();
select is(
  (select jsonb_build_object('failures', h #> '{autonomous_evaluation,failures}',
            'others', h #> '{autonomous_evaluation,failures_in_other_businesses}') from health_a),
  '{"failures": [], "others": 1}'::jsonb,
  'la dueña de A no ve el fallo de B: sólo que hubo uno en otro negocio');
select ok(
  (select position(pg_temp.b()::text in h::text) = 0 and position('tabla_privada_de_b' in h::text) = 0 from health_a),
  'ni el id del otro negocio ni su mensaje de error aparecen en la salud de A');
select is(
  (select jsonb_build_object('failures', h #> '{autonomous_evaluation,failures}',
            'others', h #> '{autonomous_evaluation,failures_in_other_businesses}') from health_b),
  jsonb_build_object('failures', jsonb_build_array(jsonb_build_object('business_id', pg_temp.b(),
    'error', 'relation "tabla_privada_de_b" does not exist')), 'others', 0),
  'la dueña de B sí ve el suyo, entero');
-- El barrido siempre escribe una lista. Si alguien dejara otra cosa en esa columna
-- (la clave de servicio puede escribirla), la salud del negocio no falla por eso.
insert into public.operational_sweep_runs (scope, status, started_at, finished_at, businesses_evaluated, findings, failures)
values ('operational_alerts', 'partial', clock_timestamp(), clock_timestamp(), 1, 0,
  jsonb_build_object('business_id', pg_temp.b(), 'error', 'relation "tabla_privada_de_b" does not exist'));
select is(
  (select jsonb_build_object('failures', x.h #> '{autonomous_evaluation,failures}',
            'others', x.h #> '{autonomous_evaluation,failures_in_other_businesses}',
            'leaks', position('tabla_privada_de_b' in x.h::text) > 0)
     from (select public.build_operational_health(pg_temp.a()) as h) x),
  '{"failures": [], "others": 0, "leaks": false}'::jsonb,
  'un failures que no es una lista no hace fallar la salud ni se muestra: se lee como lista vacía');

-- ── 6 · DIAG-02: un aviso abandonado sin intento de pago cuenta para su negocio ──
insert into public.mp_seller_connections (business_id, environment, status, seller_id, application_id, protected_tokens, expires_at, connected_at)
values (pg_temp.a(), 'production', 'connected', 'seller-alertas', 'app-alertas', 'cifrado-de-prueba',
        clock_timestamp() + interval '30 days', clock_timestamp());
select public.mp_record_seller_webhook('production', 'evt-alertas-1', 'payment', 'pay-alertas-1', true, 'rq-alertas-1', repeat('b', 64), pg_temp.a());
update public.payment_outbox set status = 'dead_letter', attempts = 8, last_error = 'Provider payment does not match a checkout session'
 where webhook_receipt_id = (select r.id from public.payment_webhook_receipts r where r.webhook_event_id = 'evt-alertas-1');
select is(
  (select count(*)::integer from public.payment_outbox po
    where po.payment_intent_id is null and po.status = 'dead_letter'
      and po.webhook_receipt_id = (select r.id from public.payment_webhook_receipts r where r.webhook_event_id = 'evt-alertas-1')),
  1, 'control: el trabajo abandonado no tiene intento de pago');
select is(
  jsonb_build_object('dead_letter', public.build_operational_health(pg_temp.a()) #> '{payments,outbox,dead_letter}',
    'worker', public.build_operational_health(pg_temp.a()) #> '{payments,worker,state}'),
  '{"dead_letter": 1, "worker": "con trabajos abandonados"}'::jsonb,
  'la salud del negocio del vendedor lo cuenta y lo nombra');
select is(
  public.build_operational_health(pg_temp.b()) #> '{payments,outbox,dead_letter}', '0'::jsonb,
  'y la del otro negocio no');

-- ── 7 · El umbral de «tarea detenida» sale de la programación ──────────────
delete from cron.job_run_details;
delete from public.operational_alerts where business_id = pg_temp.a() and alert_code like 'SCHEDULER_JOB_%';
-- Una tarea que todavía no corrió nunca se mide desde que se la espera: se fija
-- acá para que la prueba no dependa de cuándo se aplicó la migración.
update private.scheduler_expected_jobs set expected_since = clock_timestamp();
-- Toda tarea encendida, como en una plataforma en marcha: una base de pruebas
-- puede traer alguna apagada, y una tarea apagada no se denuncia como detenida.
select cron.alter_job(j.jobid, active => true) from cron.job j where j.jobname like 'taba-%' and not j.active;
select pg_temp.run(j.jobname, 'succeeded', interval '20 seconds')
  from cron.job j where j.jobname like 'taba-%' and j.schedule in ('* * * * *', '30 seconds');
select pg_temp.run('taba-order-intake-purge', 'succeeded', interval '40 minutes');
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id = pg_temp.a() and a.alert_code like 'SCHEDULER_JOB_%' and a.status <> 'resolved'),
  0, 'la tarea horaria que corrió hace 40 minutos y la diaria que todavía no corrió no abren ninguna alerta');
select is(
  (select jsonb_object_agg(s.value ->> 'job', s.value ->> 'state')
     from jsonb_array_elements(public.build_operational_health(pg_temp.a()) -> 'scheduler') s(value)
    where s.value ->> 'job' in ('taba-order-intake-purge', 'taba-cron-history-purge', 'taba-operational-alerts-sweep')),
  '{"taba-order-intake-purge": "al día", "taba-cron-history-purge": "esperando su primera corrida",
    "taba-operational-alerts-sweep": "al día"}'::jsonb,
  'y en la salud figuran al día y esperando su primera corrida');

delete from cron.job_run_details where jobid = (select j.jobid from cron.job j where j.jobname = 'taba-order-intake-purge');
select pg_temp.run('taba-order-intake-purge', 'succeeded', interval '3 hours');
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_JOB_STALLED', 'taba-order-intake-purge'), 'open',
  'la horaria sin un éxito en tres horas SÍ se denuncia');

delete from cron.job_run_details where jobid = (select j.jobid from cron.job j where j.jobname = 'taba-checkout-expiry-sweep');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '16 minutes');
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_JOB_STALLED', 'taba-checkout-expiry-sweep'), 'open',
  'la de cada minuto sin un éxito en 16 minutos se sigue denunciando, como siempre');

update private.scheduler_expected_jobs set expected_since = clock_timestamp() - interval '3 days'
 where job_name = 'taba-cron-history-purge';
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(pg_temp.alert(pg_temp.a(), 'SCHEDULER_JOB_STALLED', 'taba-cron-history-purge'), 'open',
  'la diaria que se espera hace tres días y nunca corrió también');

select pg_temp.run('taba-order-intake-purge', 'succeeded', interval '5 minutes');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '5 seconds');
select pg_temp.run('taba-cron-history-purge', 'succeeded', interval '1 hour');
select public.reconcile_operational_alerts_for_business(pg_temp.a());
select is(
  (select count(*)::integer from public.operational_alerts a
    where a.business_id = pg_temp.a() and a.alert_code like 'SCHEDULER_JOB_%' and a.status <> 'resolved'),
  0, 'cuando las tres vuelven a correr, las tres alertas se cierran solas');

-- El planificador se lee una sola vez por reconciliación.
select ok(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'public.list_scheduler_health()', '')))
            / length('public.list_scheduler_health()') = 1
     from pg_proc p where p.oid = 'public.reconcile_operational_alerts_for_business(uuid)'::regprocedure),
  'la reconciliación consulta el planificador una vez, no una por cláusula');

select * from finish();
rollback;
