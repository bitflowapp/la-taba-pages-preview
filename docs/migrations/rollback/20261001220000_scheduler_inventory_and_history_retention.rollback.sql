-- REVERSIÓN de 20261001220000_scheduler_inventory_and_history_retention.sql
--
-- Devuelve `list_scheduler_health()` a su definición anterior (20260810120000, el
-- cuerpo de abajo es ése, sin tocar), desprograma la poda del historial y retira
-- el inventario de tareas y las funciones privadas del planificador.
--
-- Ojo con lo que vuelve a quedar abierto: `cron.job_run_details` vuelve a crecer
-- sin límite y la lectura del planificador vuelve a recorrerlo entero una vez por
-- tarea (medido: 1,1 s con 7 días de historial, 8,7 s con 60 días).
--
-- No se pierde nada durable: el inventario son ocho filas de configuración que la
-- migración vuelve a sembrar, y el historial que la poda ya borró no se recupera
-- (no es evidencia: es el registro de corridas de pg_cron).
--
-- ORDEN: revertir ANTES 20261001221000 (get_ecommerce_health) y 20261001220500
-- (alertas), que usan lo que acá se borra. El bloque de abajo se niega a correr si
-- todavía están.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001220000
begin;

do $guard$
declare
  v_dependents text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_dependents
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname <> 'list_scheduler_health'
     and p.prosrc ~ 'private[.]scheduler_(job_state|job_stale_after|schedule_period|expected_jobs)';
  if v_dependents is not null then
    raise exception 'ROLLBACK_BLOCKED: revertir primero 20261001221000 y 20261001220500; todavia usan el inventario del planificador: %', v_dependents
      using errcode = 'P0001';
  end if;
end
$guard$;

do $unschedule$
begin
  perform cron.unschedule('taba-cron-history-purge');
exception
  when others then null;   -- la tarea ya no estaba
end
$unschedule$;

drop function if exists public.purge_cron_job_history(integer);

CREATE OR REPLACE FUNCTION public.list_scheduler_health()
 RETURNS TABLE(job_name text, schedule text, active boolean, last_start timestamp with time zone, last_status text, last_success_at timestamp with time zone, failures_since_success integer, last_message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;

  return query execute $dynamic$
    select
      j.jobname::text,
      j.schedule::text,
      j.active,
      r.last_start,
      r.last_status,
      r.last_success_at,
      coalesce(r.failures_since_success, 0)::integer,
      r.last_message
    from cron.job j
    left join lateral (
      select
        max(d.start_time) as last_start,
        (array_agg(d.status order by d.start_time desc))[1]::text as last_status,
        max(d.end_time) filter (where d.status = 'succeeded') as last_success_at,
        count(*) filter (
          where d.status = 'failed'
            and d.start_time > coalesce(
              (select max(s.start_time) from cron.job_run_details s
                where s.jobid = j.jobid and s.status = 'succeeded'),
              '-infinity'::timestamptz
            )
        ) as failures_since_success,
        left((array_agg(coalesce(d.return_message, '') order by d.start_time desc))[1], 200) as last_message
      from cron.job_run_details d
      where d.jobid = j.jobid
    ) r on true
    where j.jobname like 'taba-%'
    order by j.jobname
  $dynamic$;
end;
$function$;

revoke all on function public.list_scheduler_health() from public, anon, authenticated;
grant execute on function public.list_scheduler_health() to service_role;

drop function if exists private.scheduler_job_state(boolean, text, timestamptz, timestamptz, integer, timestamptz, timestamptz);
drop function if exists private.scheduler_job_stale_after(text);
drop function if exists private.scheduler_schedule_period(text);
drop table if exists private.scheduler_expected_jobs;

commit;
