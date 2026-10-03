-- El planificador se mide con su propia vara: qué tareas tienen que existir, cada
-- cuánto corre cada una, y un historial que no crece para siempre.
--
-- QUÉ SE MIDIÓ (2026-10-01, base limpia con las 159 migraciones anteriores)
--
--   1. `cron.job_run_details` no lo poda nadie: ninguna función ni tarea borra una
--      fila. Seis tareas escriben unas 8.640 filas por día.
--   2. `list_scheduler_health()` recorría ese historial ENTERO una vez por tarea, lo
--      ordenaba dos veces y, por cada corrida fallida, volvía a recorrerlo. La llaman
--      el barrido de alertas (tres veces por negocio, cada minuto) y el Panel.
--      Con el historial sembrado como lo deja pg_cron (mediana de cinco lecturas en
--      una PC de desarrollo; importa la forma, no el número):
--
--        filas               list_scheduler_health   reconciliar UN negocio
--        0                            3 ms                   21 ms
--        60.648  ( 7 días)          1,1 s                   2,9 s
--        519.840 (60 días)          8,7 s                    21 s
--
--      A los dos meses el barrido tarda decenas de segundos POR NEGOCIO: con tres
--      negocios ya no entra en su minuto y la corrida siguiente se saltea.
--      Con esta migración, las mismas dos lecturas quedan en unos 0,2 s con 7 días
--      y con 60: dejan de depender del tamaño del historial.
--   3. El umbral de «tarea detenida» era fijo: 15 minutos sin un éxito. Sirve para
--      una tarea de cada minuto y es falso para cualquier otra. La tarea horaria
--      `taba-order-intake-purge` (20261001180000), sana y recién corrida hace 40
--      minutos, abría SCHEDULER_JOB_STALLED en CRÍTICO para cada negocio y aparecía
--      «detenido» en el Panel 45 minutos de cada hora.
--   4. No había ninguna lista de las tareas que TIENEN que existir: una tarea
--      borrada simplemente dejaba de aparecer.
--
-- QUÉ CAMBIA
--
--   · `private.scheduler_expected_jobs`: el inventario, en un solo lugar. Lo leen la
--     salud del Panel, las alertas y `get_ecommerce_health()`. Guarda además desde
--     cuándo se espera cada tarea, que es lo único que permite distinguir «todavía
--     no le tocó correr» de «nunca corrió».
--   · `private.scheduler_schedule_period` / `scheduler_job_stale_after` /
--     `scheduler_job_state`: el período se lee de la propia programación y el
--     umbral sale de ahí (dos períodos más cinco minutos, nunca menos que los 15
--     minutos de siempre). Para las tareas de cada minuto no cambia nada.
--   · `list_scheduler_health()`: misma firma, mismas columnas y los mismos
--     números. Lee las últimas 20.000 corridas una sola vez para todas las tareas
--     (no una vez por tarea ni una vez por fallo). Sólo la tarea que no tiene un
--     éxito en ese tramo —está rota o corre muy de vez en cuando— vuelve a su
--     propio historial, y de ahí salen exactos su último éxito y sus fallos.
--   · `purge_cron_job_history()` y la tarea diaria `taba-cron-history-purge`:
--     conserva 7 días y, de cada tarea, siempre su última corrida y su último
--     éxito, para que «detenida hace un mes» no se convierta en «nunca corrió».
--
-- QUÉ NO CAMBIA
--
--   · Quién puede llamar a `list_scheduler_health()` (sólo service_role).
--   · El umbral de las cinco tareas de cada minuto / 30 segundos: 15 minutos.
--   · Ninguna tarea existente se reprograma ni se toca.
--
-- PRIVILEGIOS SOBRE cron.job_run_details
--
--   pg_cron da SELECT y DELETE a PUBLIC sobre esa tabla, con RLS por `username`.
--   La poda corre como dueño de la función, que es quien programa las tareas, así
--   que ve y borra sus propias corridas. Si en algún entorno no pudiera, la función
--   no falla: avisa con un NOTICE y no borra nada; `get_ecommerce_health()` lo
--   muestra como historial sin podar.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001220000_scheduler_inventory_and_history_retention.rollback.sql

-- ── 1. Inventario de tareas esperadas ───────────────────────────────────────
create table if not exists private.scheduler_expected_jobs (
  job_name text primary key,
  purpose text not null,
  expected_since timestamptz not null default clock_timestamp(),
  constraint scheduler_expected_jobs_name_format check (job_name ~ '^taba-[a-z0-9-]{3,60}$'),
  constraint scheduler_expected_jobs_purpose_length check (char_length(btrim(purpose)) between 3 and 200)
);
alter table private.scheduler_expected_jobs enable row level security;
revoke all on table private.scheduler_expected_jobs from public, anon, authenticated;

comment on table private.scheduler_expected_jobs is
  'Tareas de pg_cron que tienen que existir y estar activas. Quien agregue una tarea taba-* la anota aca en la misma migracion.';
comment on column private.scheduler_expected_jobs.expected_since is
  'Desde cuando se espera la tarea. Una tarea que nunca corrio no se juzga antes de que pase su umbral desde este momento.';

-- Las ocho de hoy. `taba-unattended-order-expiry` la programa 20261001191000, de
-- la misma entrega: en una base donde esa migración no esté aplicada, la salud la
-- informa como faltante (que es lo que corresponde) hasta que se aplique o se
-- borre su fila de acá.
insert into private.scheduler_expected_jobs (job_name, purpose) values
  ('taba-payment-outbox-worker', 'despacha la cola de cobros de Mercado Pago'),
  ('taba-checkout-expiry-sweep', 'vence checkouts sin pagar y devuelve el stock reservado'),
  ('taba-checkout-provider-truth-sweep', 'pregunta al proveedor por checkouts que nadie confirmo'),
  ('taba-operational-alerts-sweep', 'evalua las alertas operativas de cada negocio'),
  ('taba-qa-window-expiry', 'cierra las ventanas de QA vencidas'),
  ('taba-order-intake-purge', 'poda el rastro del guardian de admision de pedidos'),
  ('taba-unattended-order-expiry', 'vence los pedidos que nadie atendio'),
  ('taba-cron-history-purge', 'poda el historial de corridas del planificador')
on conflict (job_name) do nothing;

-- ── 2. Cada cuánto corre una tarea, leído de su programación ────────────────
-- Devuelve la separación MÁXIMA esperable entre dos corridas. NULL cuando la
-- programación no se sabe leer: quien llama decide qué hacer con eso.
create or replace function private.scheduler_schedule_period(p_schedule text)
returns interval
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_schedule text := lower(btrim(coalesce(p_schedule, '')));
  v_fields text[];
begin
  -- Forma propia de pg_cron: «30 seconds».
  if v_schedule ~ '^[0-9]{1,2} seconds?$' then
    return make_interval(secs => greatest(1, split_part(v_schedule, ' ', 1)::integer));
  end if;

  v_fields := regexp_split_to_array(v_schedule, '[[:space:]]+');
  if coalesce(array_length(v_fields, 1), 0) <> 5 then
    return null;
  end if;

  -- minuto hora día-del-mes mes día-de-la-semana
  if v_fields[4] <> '*' or v_fields[3] <> '*' then
    return interval '31 days';
  end if;
  if v_fields[5] <> '*' then
    return interval '7 days';
  end if;
  if v_fields[2] = '*' then
    if v_fields[1] = '*' then
      return interval '1 minute';
    end if;
    if v_fields[1] ~ '^[*]/[0-9]{1,2}$' then
      return make_interval(mins => greatest(1, substring(v_fields[1] from 3)::integer));
    end if;
    return interval '1 hour';
  end if;
  if v_fields[2] ~ '^[*]/[0-9]{1,2}$' then
    return make_interval(hours => greatest(1, substring(v_fields[2] from 3)::integer));
  end if;
  return interval '1 day';
end;
$$;
revoke all on function private.scheduler_schedule_period(text) from public, anon, authenticated;

-- Cuánto silencio se le tolera a una tarea antes de llamarla detenida: dos períodos
-- y cinco minutos, con el piso histórico de 15 minutos. Una programación que no se
-- sabe leer conserva ese piso (greatest ignora el NULL): el comportamiento anterior.
create or replace function private.scheduler_job_stale_after(p_schedule text)
returns interval
language sql
immutable
set search_path = pg_catalog
as $$
  select greatest(
    interval '15 minutes',
    private.scheduler_schedule_period(p_schedule) * 2 + interval '5 minutes'
  );
$$;
revoke all on function private.scheduler_job_stale_after(text) from public, anon, authenticated;

-- El estado de una tarea, con las mismas palabras que ya lee el Panel. Una sola
-- función para la salud del negocio y para la salud de la plataforma: dos lecturas
-- de la misma regla no se pueden separar.
--
-- «esperando su primera corrida» es el único estado nuevo: una tarea anotada en el
-- inventario que todavía no corrió y a la que todavía no se le venció el umbral
-- desde que se la espera. Sin ese estado, una tarea diaria recién desplegada
-- figuraría rota hasta el día siguiente.
create or replace function private.scheduler_job_state(
  p_active boolean,
  p_schedule text,
  p_last_start timestamptz,
  p_last_success_at timestamptz,
  p_failures_since_success integer,
  p_expected_since timestamptz,
  p_now timestamptz
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when not coalesce(p_active, false) then 'apagado'
    when p_last_success_at is null and p_last_start is null
      and p_expected_since > p_now - private.scheduler_job_stale_after(p_schedule)
      then 'esperando su primera corrida'
    when p_last_success_at is null then 'sin ninguna corrida exitosa'
    when p_last_success_at < p_now - private.scheduler_job_stale_after(p_schedule) then 'detenido'
    when coalesce(p_failures_since_success, 0) >= 3 then 'fallando'
    when coalesce(p_failures_since_success, 0) > 0 then 'con fallos recientes'
    else 'al día'
  end;
$$;
revoke all on function private.scheduler_job_state(boolean, text, timestamptz, timestamptz, integer, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ── 3. La lectura del historial, acotada ────────────────────────────────────
-- Misma firma, mismas columnas, mismo acceso. Lo que cambia es el costo, y que deja
-- de depender del tamaño del historial:
--
--   recent   las últimas 20.000 corridas de toda la tabla, leídas por clave primaria
--            (con las tareas de hoy son unas 48 horas). De ahí salen, por tarea y sin
--            ordenar nada: último arranque, último éxito, última corrida y los fallos
--            posteriores al último éxito.
--   older    sólo para la tarea que NO tiene un éxito o un arranque en ese tramo
--            (lleva días rota, o corre una vez por semana): se buscan sus máximos en
--            el historial completo. Una tarea sana nunca pasa por acá.
--   since    sólo para la tarea que NO tiene un éxito en ese tramo: sus fallos
--            posteriores a su último éxito, contados exactos. Sin esto, una tarea
--            diaria que falla cuatro días seguidos mostraría uno o dos fallos (los
--            que entran en el tramo) y nunca llegaría al umbral de «fallando».
--
-- Último arranque, último éxito y fallos desde el último éxito son exactos. La
-- única diferencia observable con la versión anterior:
--   · «después del último éxito» se decide por número de corrida y no por hora de
--     arranque. Una corrida que falló sin llegar a conectar no tiene hora de
--     arranque: antes no contaba como fallo; ahora sí.
create or replace function public.list_scheduler_health()
returns table (
  job_name text,
  schedule text,
  active boolean,
  last_start timestamptz,
  last_status text,
  last_success_at timestamptz,
  failures_since_success integer,
  last_message text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;

  return query execute $dynamic$
    with job as materialized (
      select j.jobid, j.jobname::text as job_name, j.schedule::text as schedule, j.active
      from cron.job j
      where j.jobname like 'taba-%'
    ),
    recent as (
      select
        d.jobid,
        max(d.start_time) as last_start,
        max(d.end_time) filter (where d.status = 'succeeded') as last_success_at,
        max(d.runid) filter (where d.status = 'succeeded') as last_success_run,
        max(d.runid) as last_run,
        array_agg(d.runid) filter (where d.status = 'failed') as failed_runs
      from (
        -- Hacia atrás por la clave primaria y con tope: lee 20.000 filas, tenga la
        -- tabla las que tenga.
        select r.jobid, r.runid, r.status, r.start_time, r.end_time
        from cron.job_run_details r
        order by r.runid desc
        limit 20000
      ) d
      where d.jobid in (select job.jobid from job)
      group by d.jobid
    )
    select
      job.job_name,
      job.schedule,
      job.active,
      coalesce(recent.last_start, older.last_start),
      latest.status::text,
      coalesce(recent.last_success_at, older.last_success_at),
      case
        when recent.last_success_run is not null then (
          select count(*)
          from unnest(recent.failed_runs) as failed(runid)
          where failed.runid > recent.last_success_run
        )
        else since.failures
      end::integer,
      case when latest.runid is not null then left(coalesce(latest.return_message, ''), 200) end
    from job
    left join recent on recent.jobid = job.jobid
    left join lateral (
      select
        max(o.start_time) as last_start,
        max(o.end_time) filter (where o.status = 'succeeded') as last_success_at,
        max(o.runid) as last_run,
        max(o.runid) filter (where o.status = 'succeeded') as last_success_run
      from cron.job_run_details o
      where o.jobid = job.jobid
        and (recent.last_success_at is null or recent.last_start is null)
    ) older on true
    left join lateral (
      select count(*) as failures
      from cron.job_run_details f
      where recent.last_success_run is null
        and f.jobid = job.jobid
        and f.status = 'failed'
        and f.runid > coalesce(older.last_success_run, 0)
    ) since on true
    left join cron.job_run_details latest on latest.runid = coalesce(recent.last_run, older.last_run)
    order by job.job_name
  $dynamic$;
end;
$$;

revoke all on function public.list_scheduler_health() from public, anon, authenticated;
grant execute on function public.list_scheduler_health() to service_role;

-- ── 4. Retención del historial ──────────────────────────────────────────────
-- Devuelve cuántas filas borró. Nunca borra, de ninguna tarea, ni su última corrida
-- ni su último éxito: son las dos filas de las que depende saber si una tarea que
-- dejó de correr estuvo alguna vez en marcha.
create or replace function public.purge_cron_job_history(p_keep_days integer default 7)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_cutoff timestamptz := clock_timestamp() - make_interval(days => greatest(1, least(coalesce(p_keep_days, 7), 90)));
  v_deleted integer := 0;
begin
  if to_regclass('cron.job_run_details') is null then
    raise notice 'purge_cron_job_history: esta base no tiene cron.job_run_details; no se poda nada';
    return 0;
  end if;

  delete from cron.job_run_details d
   where (
       coalesce(d.end_time, d.start_time) < v_cutoff
       -- Una corrida que no llegó a conectar no tiene ninguna fecha. Se la da por
       -- vieja cuando su número es anterior al de la primera corrida que se conserva.
       or (d.end_time is null and d.start_time is null and d.runid < (
         select min(r.runid) from cron.job_run_details r where coalesce(r.end_time, r.start_time) >= v_cutoff))
     )
     and not exists (
       select 1
         from (
           select k.jobid,
                  max(k.runid) as last_run,
                  max(k.runid) filter (where k.status = 'succeeded') as last_success
             from cron.job_run_details k
            group by k.jobid
         ) keep
        where keep.jobid = d.jobid
          and d.runid in (keep.last_run, keep.last_success)
     );
  get diagnostics v_deleted = row_count;
  return v_deleted;
exception
  when insufficient_privilege or undefined_table or invalid_schema_name then
    -- La retención es accesoria: si este entorno no deja borrar, no se rompe la
    -- tarea que la llama. Queda dicho, y la salud de la plataforma lo muestra.
    raise notice 'purge_cron_job_history: no se pudo podar cron.job_run_details (%); no se borra nada', sqlstate;
    return 0;
end;
$$;

revoke all on function public.purge_cron_job_history(integer) from public, anon, authenticated;
grant execute on function public.purge_cron_job_history(integer) to service_role;

comment on function public.purge_cron_job_history(integer) is
  'Poda cron.job_run_details: conserva N dias (1 a 90) y siempre la ultima corrida y el ultimo exito de cada tarea.';

-- A las 03:43 UTC: fuera del horario de venta y lejos del minuto 0 y del 17, donde
-- ya corren otras tareas.
create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  perform cron.schedule(
    'taba-cron-history-purge',
    '43 3 * * *',
    'select public.purge_cron_job_history(7);'
  );
end;
$$;
