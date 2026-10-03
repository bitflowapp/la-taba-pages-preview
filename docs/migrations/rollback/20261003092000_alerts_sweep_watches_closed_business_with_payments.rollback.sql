-- Reversión de 20261003092000_alerts_sweep_watches_closed_business_with_payments.sql
--
-- Devuelve evaluate_operational_alerts_sweep a su definición anterior, letra por letra, con el mismo comentario y
-- los mismos permisos. No toca filas. Se niega si otra migración la redefinió después (acepta el cuerpo de
-- 20261003092000 o el anterior, así que correrla dos veces no falla).
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261003092000', 0)
);

do $redefinition_guard$
declare
  v_actual text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_actual from pg_proc p where p.oid = to_regprocedure('public.evaluate_operational_alerts_sweep()');
  if v_actual is null or v_actual not in ('d0eabfeac5f9a3ee98d2a0e0a9bc0e81', '8cf8cf0e6ec3e29ae12b66fde33e94e3') then
    raise exception 'ROLLBACK_BLOCKED: public.evaluate_operational_alerts_sweep() no tiene el cuerpo esperado; otra migración la redefinió'
      using errcode = 'P0001';
  end if;
end
$redefinition_guard$;

CREATE OR REPLACE FUNCTION public.evaluate_operational_alerts_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_started timestamptz := clock_timestamp();
  v_business record;
  v_found integer;
  v_findings integer := 0;
  v_evaluated integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_open integer := 0;
  v_critical integer := 0;
  v_status text;
begin
  -- Dos barridos a la vez escribirian las mismas filas y se pisarian los
  -- `for update`. El que llega segundo se va: el primero ya esta haciendo su
  -- trabajo y correrlo de nuevo no agrega informacion.
  if not pg_try_advisory_xact_lock(hashtext('taba:operational_alerts_sweep')) then
    return jsonb_build_object('status', 'skipped', 'reason', 'ya hay una evaluación en curso');
  end if;

  for v_business in
    select b.id
    from public.businesses b
    where b.status <> 'closed'
       -- Un negocio cerrado con alertas abiertas se sigue evaluando: es la
       -- unica forma de que esas alertas lleguen a resolverse solas.
       or exists (
         select 1 from public.operational_alerts a
          where a.business_id = b.id and a.status <> 'resolved'
       )
    order by b.id
  loop
    begin
      v_found := public.reconcile_operational_alerts_for_business(v_business.id);
      v_findings := v_findings + coalesce(v_found, 0);
      v_evaluated := v_evaluated + 1;
    exception when others then
      -- Un negocio que falla no puede dejar a los demas sin evaluar.
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'business_id', v_business.id,
        'error', left(sqlerrm, 180)
      ));
    end;
  end loop;

  select
    count(*) filter (where a.status <> 'resolved'),
    count(*) filter (where a.status <> 'resolved' and a.severity = 'CRITICAL')
  into v_open, v_critical
  from public.operational_alerts a;

  v_status := case
    when jsonb_array_length(v_failures) = 0 then 'ok'
    when v_evaluated > 0 then 'partial'
    else 'failed'
  end;

  insert into public.operational_sweep_runs(
    scope, status, started_at, finished_at, businesses_evaluated,
    findings, open_alerts, critical_alerts, failures
  ) values (
    'operational_alerts', v_status, v_started, clock_timestamp(), v_evaluated,
    v_findings, v_open, v_critical, v_failures
  );

  -- Recién ahora, con la corrida anotada, el latido vuelve a estar sano. La
  -- reconciliación de arriba todavía lo vio viejo y dejó abierta la alerta del
  -- vigilante: se cierra acá, en la misma corrida que demuestra que el planificador
  -- volvió. Los contadores de esta fila se tomaron antes y todavía la incluyen.
  -- Es accesorio: si la sonda falla, el barrido no se cae por eso.
  begin
    perform public.check_scheduler_watchdog('sweep');
  exception when others then
    null;
  end;

  -- Una fila por minuto: sin poda, en un mes son cuarenta mil filas que nadie
  -- va a leer. Una semana alcanza para reconstruir cualquier noche.
  delete from public.operational_sweep_runs
  where started_at < clock_timestamp() - interval '7 days';

  return jsonb_build_object(
    'status', v_status,
    'businesses_evaluated', v_evaluated,
    'findings', v_findings,
    'open_alerts', v_open,
    'critical_alerts', v_critical,
    'failures', v_failures
  );
end;
$function$;

comment on function public.evaluate_operational_alerts_sweep() is
  'Evalua las alertas operativas de todos los negocios activos. Idempotente, con lock consultivo y registro por corrida.';

commit;
