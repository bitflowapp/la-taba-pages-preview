-- TABA · EL PLANIFICADOR: INVENTARIO, UMBRAL POR TAREA E HISTORIAL ACOTADO
--
-- `cron.job_run_details` no lo podaba nadie y `list_scheduler_health()` lo
-- recorría entero una vez por tarea, cada minuto y por cada negocio. Acá se
-- prueba la migración 20261001220000:
--
--   · la lectura sigue diciendo lo mismo sobre un historial normal (último
--     arranque, último éxito, último estado, fallos desde el último éxito);
--   · deja de depender del tamaño del historial sin cambiar los números: el
--     último éxito y los fallos de una tarea rota hace un mes se siguen leyendo
--     exactos, y una tarea diaria que falla varios días seguidos llega al umbral
--     de «fallando»;
--   · la poda conserva 7 días y, de cada tarea, su última corrida y su último
--     éxito; es idempotente y no acepta ventanas absurdas;
--   · cada tarea se mide con su propia programación (una horaria no está
--     detenida a los 16 minutos);
--   · el inventario de tareas esperadas existe en un solo lugar.
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
select plan(28);

do $precondition$
begin
  if not has_table_privilege(current_user, 'cron.job_run_details', 'INSERT') then
    raise exception 'PRECONDICION: el rol % necesita INSERT sobre cron.job_run_details para armar el historial de prueba (grant insert on cron.job_run_details to %)',
      current_user, current_user using errcode = '42501';
  end if;
end
$precondition$;

-- El historial real de la base de pruebas no entra en las cuentas.
delete from cron.job_run_details;

create function pg_temp.run(p_job text, p_status text, p_ago interval, p_message text default 'ok')
returns void language sql as $$
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'prueba', p_status, p_message,
         clock_timestamp() - p_ago, clock_timestamp() - p_ago + interval '1 second'
    from cron.job j where j.jobname = p_job;
$$;
create function pg_temp.health(p_job text) returns jsonb language sql as $$
  select to_jsonb(h) from public.list_scheduler_health() h where h.job_name = p_job;
$$;

-- ── 1 · Contrato y privilegios ─────────────────────────────────────────────
select is(
  pg_get_function_result('public.list_scheduler_health()'::regprocedure),
  'TABLE(job_name text, schedule text, active boolean, last_start timestamp with time zone, last_status text, last_success_at timestamp with time zone, failures_since_success integer, last_message text)',
  'list_scheduler_health conserva sus ocho columnas');
select ok(
  has_function_privilege('service_role', 'public.list_scheduler_health()', 'execute')
  and not has_function_privilege('anon', 'public.list_scheduler_health()', 'execute')
  and not has_function_privilege('authenticated', 'public.list_scheduler_health()', 'execute'),
  'list_scheduler_health sigue siendo sólo de service_role');
select ok(
  has_function_privilege('service_role', 'public.purge_cron_job_history(integer)', 'execute')
  and not has_function_privilege('anon', 'public.purge_cron_job_history(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.purge_cron_job_history(integer)', 'execute'),
  'purge_cron_job_history: sólo service_role');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'scheduler_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'las funciones privadas del planificador no las ejecuta ningún rol de cliente');

-- ── 2 · El inventario, en un solo lugar ────────────────────────────────────
select bag_eq(
  $$select job_name from private.scheduler_expected_jobs$$,
  $$values ('taba-payment-outbox-worker'), ('taba-checkout-expiry-sweep'), ('taba-checkout-provider-truth-sweep'),
           ('taba-operational-alerts-sweep'), ('taba-qa-window-expiry'), ('taba-order-intake-purge'),
           ('taba-unattended-order-expiry'), ('taba-cron-history-purge')$$,
  'el inventario nombra las ocho tareas que tienen que existir');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'private.scheduler_expected_jobs'::regclass)
  and not has_table_privilege('anon', 'private.scheduler_expected_jobs', 'select')
  and not has_table_privilege('authenticated', 'private.scheduler_expected_jobs', 'select'),
  'el inventario tiene RLS y ningún privilegio para roles de cliente');
select is(
  (select jsonb_build_object('schedule', j.schedule, 'active', j.active, 'command', j.command)
     from cron.job j where j.jobname = 'taba-cron-history-purge'),
  '{"schedule": "43 3 * * *", "active": true, "command": "select public.purge_cron_job_history(7);"}'::jsonb,
  'la poda del historial está programada una vez por día y conserva 7 días');

-- ── 3 · Cada tarea con su propia vara ──────────────────────────────────────
select is(
  array[
    private.scheduler_schedule_period('30 seconds'), private.scheduler_schedule_period('* * * * *'),
    private.scheduler_schedule_period('*/5 * * * *'), private.scheduler_schedule_period('17 * * * *'),
    private.scheduler_schedule_period('0 */6 * * *'), private.scheduler_schedule_period('43 3 * * *'),
    private.scheduler_schedule_period('0 3 * * 1'), private.scheduler_schedule_period('0 3 1 * *'),
    private.scheduler_schedule_period('no es una programacion'), private.scheduler_schedule_period(null)],
  array[interval '30 seconds', interval '1 minute', interval '5 minutes', interval '1 hour', interval '6 hours',
        interval '1 day', interval '7 days', interval '31 days', null, null]::interval[],
  'el período sale de la programación: segundos, cada minuto, cada N, horaria, diaria, semanal, mensual; lo ilegible es NULL');
select is(
  array[
    private.scheduler_job_stale_after('30 seconds'), private.scheduler_job_stale_after('* * * * *'),
    private.scheduler_job_stale_after('17 * * * *'), private.scheduler_job_stale_after('43 3 * * *'),
    private.scheduler_job_stale_after('no es una programacion')],
  array[interval '15 minutes', interval '15 minutes', interval '2 hours 5 minutes', interval '2 days 5 minutes',
        interval '15 minutes'],
  'el silencio tolerado: 15 minutos para las de cada minuto (como siempre), dos períodos y cinco minutos para las demás');
select is(
  array[
    private.scheduler_job_state(false, '* * * * *', null, null, 0, null, clock_timestamp()),
    private.scheduler_job_state(true, '43 3 * * *', null, null, 0, clock_timestamp() - interval '1 hour', clock_timestamp()),
    private.scheduler_job_state(true, '43 3 * * *', null, null, 0, clock_timestamp() - interval '3 days', clock_timestamp()),
    private.scheduler_job_state(true, '* * * * *', clock_timestamp(), null, 0, null, clock_timestamp()),
    private.scheduler_job_state(true, '* * * * *', clock_timestamp(), clock_timestamp() - interval '16 minutes', 0, null, clock_timestamp()),
    private.scheduler_job_state(true, '17 * * * *', clock_timestamp(), clock_timestamp() - interval '40 minutes', 0, null, clock_timestamp()),
    private.scheduler_job_state(true, '17 * * * *', clock_timestamp(), clock_timestamp() - interval '3 hours', 0, null, clock_timestamp()),
    private.scheduler_job_state(true, '* * * * *', clock_timestamp(), clock_timestamp(), 3, null, clock_timestamp()),
    private.scheduler_job_state(true, '* * * * *', clock_timestamp(), clock_timestamp(), 1, null, clock_timestamp()),
    private.scheduler_job_state(true, '* * * * *', clock_timestamp(), clock_timestamp(), 0, null, clock_timestamp())],
  array['apagado', 'esperando su primera corrida', 'sin ninguna corrida exitosa', 'sin ninguna corrida exitosa',
        'detenido', 'al día', 'detenido', 'fallando', 'con fallos recientes', 'al día'],
  'los estados de siempre, más «esperando su primera corrida» para una tarea recién anotada; la horaria de hace 40 minutos está al día');

-- ── 4 · La lectura dice lo mismo sobre un historial normal ─────────────────
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '10 minutes');
select pg_temp.run('taba-checkout-expiry-sweep', 'failed', interval '2 minutes', 'ERROR: primero');
select pg_temp.run('taba-checkout-expiry-sweep', 'failed', interval '1 minute', 'ERROR: ' || repeat('x', 400));
select is(
  jsonb_build_object(
    'status', pg_temp.health('taba-checkout-expiry-sweep') -> 'last_status',
    'failures', pg_temp.health('taba-checkout-expiry-sweep') -> 'failures_since_success',
    'message_length', length(pg_temp.health('taba-checkout-expiry-sweep') ->> 'last_message'),
    'success_age', round(extract(epoch from clock_timestamp()
      - (pg_temp.health('taba-checkout-expiry-sweep') ->> 'last_success_at')::timestamptz) / 60),
    'start_age', round(extract(epoch from clock_timestamp()
      - (pg_temp.health('taba-checkout-expiry-sweep') ->> 'last_start')::timestamptz) / 60)),
  '{"status": "failed", "failures": 2, "message_length": 200, "success_age": 10, "start_age": 1}'::jsonb,
  'un éxito y dos fallos posteriores: último estado, dos fallos, mensaje recortado a 200, último éxito y último arranque');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '10 seconds');
select is(
  jsonb_build_object('status', pg_temp.health('taba-checkout-expiry-sweep') -> 'last_status',
    'failures', pg_temp.health('taba-checkout-expiry-sweep') -> 'failures_since_success'),
  '{"status": "succeeded", "failures": 0}'::jsonb,
  'un éxito nuevo deja los fallos en cero');
select is(
  pg_temp.health('taba-qa-window-expiry') - 'job_name' - 'schedule' - 'active',
  '{"last_start": null, "last_status": null, "last_success_at": null, "failures_since_success": 0, "last_message": null}'::jsonb,
  'una tarea sin ninguna corrida: todo NULL y cero fallos');

-- Una corrida que falló sin llegar a arrancar no tiene hora. Ahora cuenta.
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'prueba', 'failed', 'could not connect', null, null
  from cron.job j where j.jobname = 'taba-checkout-expiry-sweep';
select is(
  jsonb_build_object('status', pg_temp.health('taba-checkout-expiry-sweep') -> 'last_status',
    'failures', pg_temp.health('taba-checkout-expiry-sweep') -> 'failures_since_success',
    'message', pg_temp.health('taba-checkout-expiry-sweep') -> 'last_message'),
  '{"status": "failed", "failures": 1, "message": "could not connect"}'::jsonb,
  'una corrida que falló sin hora de arranque es la última y cuenta como fallo');

-- ── 5 · Acotada: no depende del tamaño del historial ───────────────────────
-- Una tarea que tuvo su último éxito hace 30 días, falló cuatro veces y no
-- volvió a correr; después, 20.050 corridas de otra tarea.
select pg_temp.run('taba-qa-window-expiry', 'succeeded', interval '30 days');
select pg_temp.run('taba-qa-window-expiry', 'failed', interval '29 days' - make_interval(mins => g), 'ERROR: viejo')
  from generate_series(1, 4) g;
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select j.jobid, (select coalesce(max(d.runid), 0) from cron.job_run_details d) + g, 0, current_database(), current_user, 'prueba', 'succeeded', 'ok',
       clock_timestamp() - make_interval(secs => (20051 - g) * 30), clock_timestamp() - make_interval(secs => (20051 - g) * 30 - 1)
  from cron.job j, generate_series(1, 20050) g
 where j.jobname = 'taba-payment-outbox-worker'
 order by g;
select is(
  jsonb_build_object(
    'success_days', round(extract(epoch from clock_timestamp()
      - (pg_temp.health('taba-qa-window-expiry') ->> 'last_success_at')::timestamptz) / 86400),
    'start_days', round(extract(epoch from clock_timestamp()
      - (pg_temp.health('taba-qa-window-expiry') ->> 'last_start')::timestamptz) / 86400),
    'status', pg_temp.health('taba-qa-window-expiry') -> 'last_status'),
  '{"success_days": 30, "start_days": 29, "status": "failed"}'::jsonb,
  'fuera del tramo reciente, el último éxito, el último arranque y el último estado se siguen leyendo exactos');
select is(
  (pg_temp.health('taba-qa-window-expiry') ->> 'failures_since_success')::integer, 4,
  'y sus cuatro fallos posteriores a ese éxito se siguen contando, aunque ninguno entre en el tramo reciente');
-- Lo que le pasa a una tarea diaria que falla varios días seguidos: su último
-- éxito queda fuera del tramo y sólo el fallo de hoy queda adentro.
select pg_temp.run('taba-qa-window-expiry', 'failed', interval '1 minute', 'ERROR: hoy');
select is(
  jsonb_build_object(
    'failures', pg_temp.health('taba-qa-window-expiry') -> 'failures_since_success',
    'state', private.scheduler_job_state(true, '43 3 * * *', clock_timestamp() - interval '1 minute',
      clock_timestamp() - interval '1 day', (pg_temp.health('taba-qa-window-expiry') ->> 'failures_since_success')::integer,
      null, clock_timestamp())),
  '{"failures": 5, "state": "fallando"}'::jsonb,
  'con el último éxito fuera del tramo y un fallo adentro, cuenta los cinco: una tarea diaria que falla días seguidos llega a «fallando»');
select is(
  jsonb_build_object('status', pg_temp.health('taba-payment-outbox-worker') -> 'last_status',
    'failures', pg_temp.health('taba-payment-outbox-worker') -> 'failures_since_success',
    'fresh', (pg_temp.health('taba-payment-outbox-worker') ->> 'last_success_at')::timestamptz > clock_timestamp() - interval '1 minute'),
  '{"status": "succeeded", "failures": 0, "fresh": true}'::jsonb,
  'la tarea con 20.050 corridas se lee igual que con una');
select ok(
  (select p.prosrc ~ 'limit 20000' and p.prosrc !~* 'array_agg\([^)]*order by'
     from pg_proc p where p.oid = 'public.list_scheduler_health()'::regprocedure),
  'la lectura tiene tope de filas y ya no ordena el historial entero');

-- ── 6 · La poda ────────────────────────────────────────────────────────────
delete from cron.job_run_details;
-- A: una tarea viva con historia vieja. B: un único éxito de hace 20 días.
-- C: éxito hace 15 días y fallo hace 12 (nunca más corrió).
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'A-sin-hora-vieja', 'failed', 'could not connect', null, null
  from cron.job j where j.jobname = 'taba-checkout-expiry-sweep';
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '10 days', 'A-10d');
select pg_temp.run('taba-checkout-expiry-sweep', 'failed', interval '9 days', 'A-9d');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '8 days', 'A-8d');
select pg_temp.run('taba-qa-window-expiry', 'succeeded', interval '20 days', 'B-20d');
select pg_temp.run('taba-operational-alerts-sweep', 'succeeded', interval '15 days', 'C-15d');
select pg_temp.run('taba-operational-alerts-sweep', 'failed', interval '12 days', 'C-12d');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '6 days', 'A-6d');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '1 hour', 'A-1h');
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select j.jobid, (select coalesce(max(d.runid), 0) + 1 from cron.job_run_details d), 0, current_database(), current_user, 'A-sin-hora-nueva', 'failed', 'could not connect', null, null
  from cron.job j where j.jobname = 'taba-checkout-expiry-sweep';

select is(public.purge_cron_job_history(7), 4, 'la poda borra las cuatro corridas viejas que nadie necesita');
select is(
  (select array_agg(coalesce(nullif(d.return_message, 'could not connect'), d.command) order by d.runid) from cron.job_run_details d),
  array['B-20d', 'C-15d', 'C-12d', 'A-6d', 'A-1h', 'A-sin-hora-nueva'],
  'quedan los 7 días, y de cada tarea su última corrida y su último éxito aunque sean viejos');
select is(public.purge_cron_job_history(7), 0, 'correrla de nuevo no borra nada');
select is(
  jsonb_build_object(
    'b_success_days', round(extract(epoch from clock_timestamp()
      - (pg_temp.health('taba-qa-window-expiry') ->> 'last_success_at')::timestamptz) / 86400),
    'c_status', pg_temp.health('taba-operational-alerts-sweep') -> 'last_status',
    'c_success_days', round(extract(epoch from clock_timestamp()
      - (pg_temp.health('taba-operational-alerts-sweep') ->> 'last_success_at')::timestamptz) / 86400)),
  '{"b_success_days": 20, "c_status": "failed", "c_success_days": 15}'::jsonb,
  'después de podar, una tarea que dejó de correr sigue diciendo cuándo fue su último éxito: no pasa a «nunca corrió»');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '3 days', 'A-3d');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '1 minute', 'A-1m');
select is(public.purge_cron_job_history(0), 2,
  'una ventana de 0 días se trata como 1: borra lo de más de un día (A-6d y A-3d)');
select is(
  (select array_agg(coalesce(nullif(d.return_message, 'could not connect'), d.command) order by d.runid) from cron.job_run_details d),
  array['B-20d', 'C-15d', 'C-12d', 'A-1h', 'A-sin-hora-nueva', 'A-1m'],
  'y nunca la última corrida ni el último éxito de cada tarea; la corrida sin hora posterior a una conservada tampoco');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '100 days', 'A-100d');
select pg_temp.run('taba-checkout-expiry-sweep', 'succeeded', interval '30 seconds', 'A-30s');
select is(public.purge_cron_job_history(100000), 1,
  'una ventana desmedida se recorta a 90 días: lo de hace 100 días se va igual');
select is(public.purge_cron_job_history(null), 0, 'NULL vale 7 días');
select is(
  (select p.provolatile::text || ':' || p.prosecdef::text || ':' || (p.proconfig::text like '%search_path=pg_catalog%')::text
     from pg_proc p where p.oid = 'public.purge_cron_job_history(integer)'::regprocedure),
  'v:true:true', 'la poda es SECURITY DEFINER con search_path fijo');

select * from finish();
rollback;
