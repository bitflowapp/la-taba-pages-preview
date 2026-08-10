-- ============================================================================
--  Quién vigila al vigilante.
-- ============================================================================
--
--  EL PUNTO CIEGO, dicho con precisión: `taba-operational-alerts-sweep` detecta
--  todo lo demás, pero si pg_cron deja de ejecutarlo, el barrido no puede
--  denunciar su propia ausencia. Cualquier alerta sobre "el barrido no corre"
--  escrita POR el barrido es una contradicción.
--
--  Lo único que cierra ese agujero es que alguien que NO sea pg_cron mire el
--  reloj. Esta migración pone la superficie para que ese alguien exista, en dos
--  capas, ninguna de las cuales depende del planificador:
--
--    1. `scheduler_heartbeat()` — una sonda pública, sin un solo dato de
--       negocio: cuándo corrió el barrido por última vez, hace cuánto, y si eso
--       está dentro de lo esperado. Cualquier cosa que hable HTTP puede
--       consultarla: un Worker con cron, un monitor de uptime gratuito, un
--       `curl` desde cualquier lado. No hace falta guardar ninguna credencial
--       en ningún lado, que es lo que hace que esta pieza sea desplegable de
--       verdad y no un plan.
--
--    2. `check_scheduler_watchdog()` — la misma medición, pero además ABRE la
--       alerta cuando el atraso es real y la CIERRA cuando vuelve. La condición
--       la mide la función contra la base; NO se confía en lo que diga quien
--       llama. Por eso puede ser anónima: un extraño no puede inventar una
--       alerta ni silenciarla, sólo provocar que el servidor mire su propio
--       reloj.
--
--    3. Y una tercera, gratis: el tráfico real. Un trigger de sentencia sobre
--       `orders` hace la misma comprobación cuando entra un pedido. Si el
--       planificador se murió y el local sigue vendiendo, el primer pedido lo
--       descubre sin que exista ninguna infraestructura afuera.
--
--  ANTI-SPAM
--  ---------
--  Se escribe como mucho una vez por minuto, la llamen mil veces o una. El
--  guardián es doble: un lock consultivo (dos llamadas simultáneas, una sola
--  escribe) y una ventana de 60 s sobre `last_seen_at` de la alerta abierta.
--
--  RECUPERACIÓN
--  ------------
--  Por dos caminos independientes: la propia sonda cierra la alerta en cuanto
--  el barrido vuelve a estar fresco, y el barrido —cuando revive— la cierra
--  también, porque la condición ya no está entre sus hallazgos.
--
--  UMBRALES
--  --------
--  El barrido corre cada 60 s. Se considera atrasado a los 600 s: diez corridas
--  perdidas. Suficiente para no confundir una demora con una muerte, y lejos de
--  las horas que el problema tenía antes.
-- ============================================================================

-- ===== La sonda: sin datos de negocio, apta para cualquiera =====
create or replace function public.scheduler_heartbeat()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $scheduler_heartbeat$
  select jsonb_build_object(
    'service', 'taba-operational-alerts-sweep',
    'expected_every_seconds', 60,
    'stale_after_seconds', 600,
    'last_run_at', r.started_at,
    'age_seconds', case when r.started_at is null then null
      else round(extract(epoch from (clock_timestamp() - r.started_at))) end,
    'healthy', r.started_at is not null
      and r.started_at > clock_timestamp() - interval '600 seconds',
    'checked_at', clock_timestamp()
  )
  from (
    select max(started_at) as started_at
    from public.operational_sweep_runs
    where scope = 'operational_alerts'
  ) r;
$scheduler_heartbeat$;

-- Deliberadamente pública. Lo que devuelve es un reloj, no un dato del negocio:
-- ni pedidos, ni cobros, ni nombres, ni importes. Que sea anónima es lo que
-- permite que la vigile algo de afuera sin repartir credenciales.
revoke all on function public.scheduler_heartbeat() from public;
grant execute on function public.scheduler_heartbeat() to anon, authenticated, service_role;

comment on function public.scheduler_heartbeat() is
  'Reloj del barrido de alertas: cuando corrio por ultima vez y si eso esta dentro de lo esperado. Sin ningun dato de negocio; apta para una sonda externa sin credenciales.';

-- ===== El watchdog: mide, y actúa sobre lo que midió =====
create or replace function public.check_scheduler_watchdog(p_source text default 'external')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $check_scheduler_watchdog$
declare
  v_beat jsonb;
  v_healthy boolean;
  v_age numeric;
  v_last timestamptz;
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'external'), 40);
  v_business record;
  v_alert public.operational_alerts;
  v_fingerprint text;
  v_alert_id uuid;
  v_subject uuid := md5('scheduler_watchdog')::uuid;
  v_action text := 'ninguna';
  v_touched integer := 0;
begin
  v_beat := public.scheduler_heartbeat();
  v_healthy := coalesce((v_beat ->> 'healthy')::boolean, false);
  v_age := nullif(v_beat ->> 'age_seconds', '')::numeric;
  v_last := nullif(v_beat ->> 'last_run_at', '')::timestamptz;

  -- Dos sondas al mismo tiempo no tienen nada que agregar la una a la otra.
  if not pg_try_advisory_xact_lock(hashtext('taba:scheduler_watchdog')) then
    return v_beat || jsonb_build_object('action', 'omitida', 'reason', 'otra comprobación en curso');
  end if;

  for v_business in
    select b.id from public.businesses b where b.status <> 'closed' order by b.id
  loop
    v_fingerprint := encode(digest(
      v_business.id::text || ':SCHEDULER_WATCHDOG_STALE:' || v_subject::text, 'sha256'
    ), 'hex');

    select * into v_alert from public.operational_alerts
     where business_id = v_business.id and fingerprint = v_fingerprint
     for update;

    if v_healthy then
      -- Vuelve sola, sin esperar a que el barrido reviva.
      if v_alert.id is not null and v_alert.status <> 'resolved' then
        update public.operational_alerts
           set status = 'resolved', resolved_at = clock_timestamp(),
               resolution_note = 'El barrido volvió a correr; la sonda externa lo confirmó.',
               updated_at = clock_timestamp()
         where id = v_alert.id;
        insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
        values (v_business.id, v_alert.id, 'resolved',
          jsonb_build_object('resolution', 'scheduler_recovered', 'source', v_source));
        v_action := 'resuelta';
        v_touched := v_touched + 1;
      end if;
      continue;
    end if;

    -- No sano. Se escribe como mucho una vez por minuto, la llamen las veces
    -- que la llamen: la alerta ya abierta y reciente no se vuelve a tocar.
    if v_alert.id is not null and v_alert.status <> 'resolved'
      and v_alert.last_seen_at > clock_timestamp() - interval '60 seconds' then
      v_action := 'sin cambios';
      continue;
    end if;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      status, summary, required_action, evidence
    ) values (
      v_business.id, v_fingerprint, 'CRITICAL', 'SCHEDULER_WATCHDOG_STALE',
      'service_health', v_subject, 'open',
      'La vigilancia automática dejó de correr.',
      'El sistema ya no se está revisando solo: mirá el Panel hasta que vuelva y avisá a soporte.',
      jsonb_build_object(
        'last_run_at', v_last,
        'age_seconds', v_age,
        'stale_after_seconds', 600,
        'observed_by', v_source
      )
    )
    on conflict (business_id, fingerprint) do update set
      severity = 'CRITICAL',
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = null, resolved_at = null, resolution_note = null,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    -- Un evento por episodio, no por comprobación.
    if v_alert.id is null or v_alert.status = 'resolved' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        v_business.id, v_alert_id,
        case when v_alert.id is null then 'detected' else 'reopened' end,
        jsonb_build_object('alert_code', 'SCHEDULER_WATCHDOG_STALE', 'source', v_source)
      );
    end if;
    v_action := 'abierta';
    v_touched := v_touched + 1;
  end loop;

  return v_beat || jsonb_build_object('action', v_action, 'businesses_touched', v_touched, 'source', v_source);
end;
$check_scheduler_watchdog$;

-- Anónima a propósito: la condición la mide la función contra la base, así que
-- quien llama no puede inventar una alerta ni silenciarla. Lo único que puede
-- hacer un extraño es pedirle al servidor que mire su propio reloj, y eso está
-- acotado a una escritura por minuto.
revoke all on function public.check_scheduler_watchdog(text) from public;
grant execute on function public.check_scheduler_watchdog(text) to anon, authenticated, service_role;

comment on function public.check_scheduler_watchdog(text) is
  'Sonda del planificador: mide el atraso real del barrido, abre la alerta cuando esta muerto y la cierra cuando vuelve. No confia en el llamador; escribe como mucho una vez por minuto.';

-- ===== Tercera capa: el tráfico real, sin infraestructura afuera =====
-- Si el planificador se murió y el local sigue vendiendo, el primer pedido que
-- entre lo descubre. No reemplaza a la sonda externa —un local cerrado no genera
-- tráfico— pero no cuesta nada y cubre justo las horas en que sí importa.
create or replace function public.kick_scheduler_watchdog()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $kick_scheduler_watchdog$
begin
  perform public.check_scheduler_watchdog('order_traffic');
  return null;
exception when others then
  -- Un pedido REAL no se cae nunca por una comprobación de salud.
  return null;
end;
$kick_scheduler_watchdog$;

revoke all on function public.kick_scheduler_watchdog() from public, anon, authenticated;

drop trigger if exists orders_kick_scheduler_watchdog on public.orders;
create trigger orders_kick_scheduler_watchdog
after insert on public.orders
for each statement execute function public.kick_scheduler_watchdog();

comment on function public.kick_scheduler_watchdog() is
  'Comprueba la salud del planificador cuando entra un pedido. Nunca hace fallar la insercion: si algo sale mal, se traga el error.';
