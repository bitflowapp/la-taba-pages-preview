-- Umbrales operativos explícitos y salud de servicios con evidencia.
--
-- Hasta acá el Panel podía decir "todo bien" sin haber medido nada:
-- `get_business_opening_status` devuelve `'backend', jsonb_build_object('status','ok')`
-- literal, sin sonda alguna. Un estado que no puede dar mal no informa.
--
-- Este bloque introduce dos cosas y ninguna inventa datos:
--
-- 1. Los umbrales que hoy están escritos a mano dentro de cada consulta
--    (5 minutos de GPS, 15 de outbox) pasan a ser configuración del negocio,
--    con el valor por defecto declarado y la fuente visible. Quien mira el
--    tablero sabe contra qué se comparó.
--
-- 2. Un contrato de salud de cuatro estados: `healthy`, `degraded`, `down` y
--    `unknown`. `unknown` es el que faltaba: si un servicio nunca dio señal,
--    decir "sano" es mentir y decir "caído" también. Cada servicio devuelve la
--    evidencia con la que se decidió y el instante en que se observó.

-- ===== 1. Umbrales del negocio =====

alter table public.businesses add column if not exists low_stock_threshold integer;
alter table public.businesses add column if not exists order_acceptance_sla_minutes integer;
alter table public.businesses add column if not exists rider_assignment_sla_minutes integer;
alter table public.businesses add column if not exists delivery_sla_minutes integer;
alter table public.businesses add column if not exists rider_signal_stale_minutes integer;

alter table public.businesses drop constraint if exists businesses_low_stock_threshold_check;
alter table public.businesses add constraint businesses_low_stock_threshold_check
  check (low_stock_threshold is null or low_stock_threshold between 0 and 10000);

alter table public.businesses drop constraint if exists businesses_order_acceptance_sla_check;
alter table public.businesses add constraint businesses_order_acceptance_sla_check
  check (order_acceptance_sla_minutes is null or order_acceptance_sla_minutes between 1 and 1440);

alter table public.businesses drop constraint if exists businesses_rider_assignment_sla_check;
alter table public.businesses add constraint businesses_rider_assignment_sla_check
  check (rider_assignment_sla_minutes is null or rider_assignment_sla_minutes between 1 and 1440);

alter table public.businesses drop constraint if exists businesses_delivery_sla_check;
alter table public.businesses add constraint businesses_delivery_sla_check
  check (delivery_sla_minutes is null or delivery_sla_minutes between 1 and 1440);

alter table public.businesses drop constraint if exists businesses_rider_signal_stale_check;
alter table public.businesses add constraint businesses_rider_signal_stale_check
  check (rider_signal_stale_minutes is null or rider_signal_stale_minutes between 1 and 240);

comment on column public.businesses.low_stock_threshold is
  'Unidades a partir de las cuales un producto publicado se considera a reponer. Sin valor se usa el default declarado (6).';
comment on column public.businesses.order_acceptance_sla_minutes is
  'Minutos que puede esperar un pedido sin que el mostrador lo acepte antes de ser una excepción. Default 10.';
comment on column public.businesses.rider_assignment_sla_minutes is
  'Minutos que puede estar un pedido listo sin rider asignado antes de ser una excepción. Default 10.';
comment on column public.businesses.delivery_sla_minutes is
  'Minutos desde que el pedido queda listo hasta que la entrega se considera demorada. Default 45.';
comment on column public.businesses.rider_signal_stale_minutes is
  'Minutos sin señal GPS durante una entrega activa antes de considerarla perdida. Default 5.';

-- Los umbrales viajan con su procedencia: el tablero muestra si el número es
-- una decisión del negocio o el default del producto. Nadie tiene que adivinar.
create or replace function public.pilot_ops_thresholds(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pilot_ops_thresholds$
  select jsonb_build_object(
    'low_stock_units', jsonb_build_object(
      'value', coalesce(b.low_stock_threshold, 6),
      'source', case when b.low_stock_threshold is null then 'default' else 'business' end
    ),
    'order_acceptance_minutes', jsonb_build_object(
      'value', coalesce(b.order_acceptance_sla_minutes, 10),
      'source', case when b.order_acceptance_sla_minutes is null then 'default' else 'business' end
    ),
    'rider_assignment_minutes', jsonb_build_object(
      'value', coalesce(b.rider_assignment_sla_minutes, 10),
      'source', case when b.rider_assignment_sla_minutes is null then 'default' else 'business' end
    ),
    'delivery_minutes', jsonb_build_object(
      'value', coalesce(b.delivery_sla_minutes, 45),
      'source', case when b.delivery_sla_minutes is null then 'default' else 'business' end
    ),
    'rider_signal_stale_minutes', jsonb_build_object(
      'value', coalesce(b.rider_signal_stale_minutes, 5),
      'source', case when b.rider_signal_stale_minutes is null then 'default' else 'business' end
    )
  )
  from public.businesses b
  where b.id = p_business_id;
$pilot_ops_thresholds$;

-- Cambiar un umbral es una decisión operativa del dueño, no un ajuste de código.
create or replace function public.configure_pilot_ops_thresholds(
  p_business_id uuid,
  p_thresholds jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $configure_pilot_ops_thresholds$
declare
  v_allowed text[] := array[
    'low_stock_units', 'order_acceptance_minutes', 'rider_assignment_minutes',
    'delivery_minutes', 'rider_signal_stale_minutes'
  ];
  v_key text;
  v_raw text;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'configurar umbrales requiere owner o admin' using errcode = '42501';
  end if;
  -- Cualquier clave fuera de la lista se rechaza entera: esta puerta no admite
  -- que entre nada que no sea un umbral conocido.
  if coalesce(p_thresholds, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'umbral desconocido' using errcode = '22023';
  end if;
  -- Un valor no numérico moriría como error de cast crudo; se rechaza antes.
  for v_key in select jsonb_object_keys(coalesce(p_thresholds, '{}'::jsonb)) loop
    v_raw := p_thresholds ->> v_key;
    if v_raw is not null and v_raw !~ '^[0-9]{1,5}$' then
      raise exception 'umbral invalido: %', v_key using errcode = '22023';
    end if;
  end loop;

  update public.businesses set
    low_stock_threshold = case
      when p_thresholds ? 'low_stock_units' then nullif(p_thresholds ->> 'low_stock_units', '')::integer
      else low_stock_threshold end,
    order_acceptance_sla_minutes = case
      when p_thresholds ? 'order_acceptance_minutes' then nullif(p_thresholds ->> 'order_acceptance_minutes', '')::integer
      else order_acceptance_sla_minutes end,
    rider_assignment_sla_minutes = case
      when p_thresholds ? 'rider_assignment_minutes' then nullif(p_thresholds ->> 'rider_assignment_minutes', '')::integer
      else rider_assignment_sla_minutes end,
    delivery_sla_minutes = case
      when p_thresholds ? 'delivery_minutes' then nullif(p_thresholds ->> 'delivery_minutes', '')::integer
      else delivery_sla_minutes end,
    rider_signal_stale_minutes = case
      when p_thresholds ? 'rider_signal_stale_minutes' then nullif(p_thresholds ->> 'rider_signal_stale_minutes', '')::integer
      else rider_signal_stale_minutes end,
    updated_at = now()
  where id = p_business_id;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'thresholds', public.pilot_ops_thresholds(p_business_id));
end;
$configure_pilot_ops_thresholds$;

-- ===== 2. Salud de servicios con evidencia =====

-- Un único lugar donde se decide el estado, para que ocho servicios no inventen
-- ocho escalas distintas. El orden importa: sin evidencia nunca hay `healthy`.
create or replace function public.pilot_health_verdict(
  p_has_evidence boolean,
  p_is_down boolean,
  p_is_degraded boolean
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $pilot_health_verdict$
  select case
    when coalesce(p_is_down, false) then 'down'
    when not coalesce(p_has_evidence, false) then 'unknown'
    when coalesce(p_is_degraded, false) then 'degraded'
    else 'healthy'
  end;
$pilot_health_verdict$;

-- El peor estado manda, pero `unknown` no degrada a `down`: no saber no es
-- lo mismo que estar caído, y confundirlos entrena a ignorar el tablero.
create or replace function public.pilot_health_rollup(p_statuses text[])
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $pilot_health_rollup$
  select case
    when 'down' = any (p_statuses) then 'down'
    when 'degraded' = any (p_statuses) then 'degraded'
    when 'unknown' = any (p_statuses) then 'unknown'
    when 'healthy' = any (p_statuses) then 'healthy'
    else 'unknown'
  end;
$pilot_health_rollup$;

create or replace function public.get_pilot_service_health(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $get_pilot_service_health$
declare
  v_now timestamptz := clock_timestamp();
  v_services jsonb := '[]'::jsonb;
  v_statuses text[] := '{}'::text[];
  v_status text;

  v_in_recovery boolean;
  v_uptime_seconds numeric;

  v_missing_extensions text[];
  v_rls_gaps text[];
  v_auth_reachable boolean;

  v_preference_at timestamptz;
  v_webhook_at timestamptz;
  v_worker_at timestamptz;

  v_webhook_total integer;
  v_webhook_completed integer;
  v_webhook_rejected integer;
  v_webhook_failed integer;
  v_webhook_awaiting integer;

  v_cron_present boolean;
  v_cron_jobs jsonb := '[]'::jsonb;
  v_cron_inactive integer := 0;
  v_cron_failed integer := 0;
  v_cron_never_ran integer := 0;
  v_cron_last_success timestamptz;
  v_cron_expected integer := 0;

  v_outbox_due integer;
  v_outbox_stuck integer;
  v_outbox_failed integer;
  v_outbox_dead integer;
  v_outbox_total integer;

  v_panel_last timestamptz;
  v_panel_open_orders integer;

  v_rider_missing text[];
  v_rider_leaked text[];
  v_rider_last_activity timestamptz;

  v_thresholds jsonb;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  v_thresholds := public.pilot_ops_thresholds(p_business_id);

  -- --- Base de datos: se mide sobre la sesión que está corriendo esta consulta.
  select pg_is_in_recovery(), extract(epoch from (v_now - pg_postmaster_start_time()))
    into v_in_recovery, v_uptime_seconds;
  v_status := public.pilot_health_verdict(true, false, coalesce(v_in_recovery, false));
  v_services := v_services || jsonb_build_object(
    'service', 'database',
    'label', 'Base de datos',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when coalesce(v_in_recovery, false) then 'La base está en modo réplica: acepta lecturas y rechaza escrituras.'
      else 'La base respondió esta misma consulta.'
    end,
    'evidence', jsonb_build_object(
      'in_recovery', coalesce(v_in_recovery, false),
      'uptime_seconds', round(coalesce(v_uptime_seconds, 0))
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  -- --- Supabase: las piezas gestionadas de las que depende la operación.
  select array_agg(required.name order by required.name)
    into v_missing_extensions
    from (values ('pgcrypto'), ('pg_net'), ('pg_cron'), ('supabase_vault')) as required(name)
   where not exists (select 1 from pg_catalog.pg_extension e where e.extname = required.name);

  select array_agg(t.relname order by t.relname)
    into v_rls_gaps
    from pg_catalog.pg_class t
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relkind = 'r'
     and t.relname in (
       'orders', 'order_items', 'order_events', 'payment_intents', 'checkout_sessions',
       'operational_alerts', 'daily_reconciliations', 'products', 'rider_locations'
     )
     and not t.relrowsecurity;

  v_auth_reachable := to_regclass('auth.users') is not null;
  v_status := public.pilot_health_verdict(
    true,
    not v_auth_reachable,
    coalesce(array_length(v_missing_extensions, 1), 0) > 0 or coalesce(array_length(v_rls_gaps, 1), 0) > 0
  );
  v_services := v_services || jsonb_build_object(
    'service', 'supabase',
    'label', 'Plataforma Supabase',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when not v_auth_reachable then 'No se encuentra el esquema de identidades: nadie puede iniciar sesión.'
      when coalesce(array_length(v_missing_extensions, 1), 0) > 0 then 'Faltan extensiones que sostienen colas y agenda.'
      when coalesce(array_length(v_rls_gaps, 1), 0) > 0 then 'Hay tablas operativas sin seguridad por fila.'
      else 'Identidades, extensiones y seguridad por fila verificadas.'
    end,
    'evidence', jsonb_build_object(
      'auth_reachable', v_auth_reachable,
      'missing_extensions', coalesce(to_jsonb(v_missing_extensions), '[]'::jsonb),
      'tables_without_rls', coalesce(to_jsonb(v_rls_gaps), '[]'::jsonb)
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  -- --- Edge Functions: sólo cuentan las invocaciones que dejaron rastro.
  -- Crear una preferencia, recibir un aviso y completar trabajo del outbox son
  -- las tres huellas que las funciones dejan en la base. Sin ninguna, el estado
  -- es `unknown`: nunca se las vio funcionar, y eso no es estar sano.
  select max(pi.preference_created_at) into v_preference_at
    from public.payment_intents pi where pi.business_id = p_business_id;
  select max(r.received_at) into v_webhook_at
    from public.payment_webhook_receipts r
   where exists (
     select 1 from public.payment_intents pi
      where pi.business_id = p_business_id
        and (pi.provider_payment_id = r.resource_id or pi.provider_merchant_order_id = r.resource_id)
   );
  select max(po.completed_at) into v_worker_at
    from public.payment_outbox po
    join public.payment_intents pi on pi.id = po.payment_intent_id
   where pi.business_id = p_business_id;

  v_status := public.pilot_health_verdict(
    v_preference_at is not null or v_webhook_at is not null or v_worker_at is not null,
    false,
    greatest(
      coalesce(v_preference_at, '-infinity'::timestamptz),
      coalesce(v_webhook_at, '-infinity'::timestamptz),
      coalesce(v_worker_at, '-infinity'::timestamptz)
    ) < v_now - interval '24 hours'
  );
  v_services := v_services || jsonb_build_object(
    'service', 'functions',
    'label', 'Funciones de pago',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when v_status = 'unknown' then 'Ninguna función dejó rastro todavía: no hay con qué afirmar que funcionan.'
      when v_status = 'degraded' then 'La última señal de las funciones tiene más de 24 horas.'
      else 'Hay rastro reciente de preferencias, avisos o trabajo completado.'
    end,
    'evidence', jsonb_build_object(
      'last_preference_at', v_preference_at,
      'last_webhook_at', v_webhook_at,
      'last_worker_completion_at', v_worker_at
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  -- --- Webhook de Mercado Pago.
  select
    count(*) filter (where r.received_at > v_now - interval '24 hours'),
    count(*) filter (where r.received_at > v_now - interval '24 hours' and r.processing_status = 'completed'),
    count(*) filter (where r.received_at > v_now - interval '1 hour' and r.processing_status = 'rejected_signature'),
    count(*) filter (where r.received_at > v_now - interval '24 hours' and r.processing_status in ('failed', 'dead_letter'))
    into v_webhook_total, v_webhook_completed, v_webhook_rejected, v_webhook_failed
    from public.payment_webhook_receipts r;

  -- Un pago que salió a Mercado Pago hace rato y del que nunca volvió un aviso
  -- es la forma en que este servicio se cae sin dar error.
  select count(*) into v_webhook_awaiting
    from public.payment_intents pi
   where pi.business_id = p_business_id
     and pi.internal_status in ('redirected', 'pending', 'in_process')
     and pi.updated_at < v_now - interval '30 minutes';

  v_status := public.pilot_health_verdict(
    v_webhook_at is not null,
    v_webhook_awaiting > 0 or v_webhook_failed > 0,
    v_webhook_rejected > 0 or coalesce(v_webhook_at, '-infinity'::timestamptz) < v_now - interval '24 hours'
  );
  v_services := v_services || jsonb_build_object(
    'service', 'webhook',
    'label', 'Aviso de pagos',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when v_webhook_awaiting > 0 then 'Hay pagos esperando aviso hace más de media hora.'
      when v_webhook_failed > 0 then 'Hubo avisos que no se pudieron procesar.'
      when v_webhook_rejected > 0 then 'Llegaron avisos con firma inválida en la última hora.'
      when v_status = 'unknown' then 'Todavía no llegó ningún aviso de pago.'
      when v_status = 'degraded' then 'El último aviso tiene más de 24 horas.'
      else 'Los avisos llegan y se procesan.'
    end,
    'evidence', jsonb_build_object(
      'last_receipt_at', v_webhook_at,
      'received_24h', v_webhook_total,
      'completed_24h', v_webhook_completed,
      'rejected_signature_1h', v_webhook_rejected,
      'failed_24h', v_webhook_failed,
      'payments_awaiting_notice', v_webhook_awaiting
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  -- --- Agenda (pg_cron). Se consulta por nombre para que la ausencia de la
  -- extensión sea un estado y no una excepción.
  v_cron_present := to_regclass('cron.job') is not null;
  if v_cron_present then
    execute $cron$
      select
        coalesce(jsonb_agg(jsonb_build_object(
          'job', j.jobname,
          'schedule', j.schedule,
          'active', j.active,
          'last_run_at', d.last_run_at,
          'last_status', d.last_status
        ) order by j.jobname), '[]'::jsonb),
        count(*) filter (where not j.active),
        count(*) filter (where d.last_status is not null and d.last_status <> 'succeeded'),
        count(*) filter (where d.last_run_at is null),
        max(d.last_run_at) filter (where d.last_status = 'succeeded'),
        count(*)
      from cron.job j
      left join lateral (
        select r.end_time as last_run_at, r.status as last_status
          from cron.job_run_details r
         where r.jobid = j.jobid
         order by r.start_time desc
         limit 1
      ) d on true
      where j.jobname in ('taba-payment-outbox-worker', 'taba-checkout-expiry-sweep')
    $cron$ into v_cron_jobs, v_cron_inactive, v_cron_failed, v_cron_never_ran, v_cron_last_success, v_cron_expected;
  end if;

  v_status := public.pilot_health_verdict(
    v_cron_present and v_cron_expected >= 2 and v_cron_last_success is not null,
    not v_cron_present or v_cron_expected < 2 or v_cron_inactive > 0,
    v_cron_failed > 0
      or v_cron_never_ran > 0
      or coalesce(v_cron_last_success, '-infinity'::timestamptz) < v_now - interval '15 minutes'
  );
  v_services := v_services || jsonb_build_object(
    'service', 'scheduler',
    'label', 'Agenda automática',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when not v_cron_present then 'No hay agenda instalada: nada se ejecuta solo.'
      when v_cron_expected < 2 then 'Falta alguna de las dos tareas agendadas del piloto.'
      when v_cron_inactive > 0 then 'Hay una tarea agendada pero apagada.'
      when v_cron_failed > 0 then 'La última corrida de una tarea falló.'
      when v_cron_never_ran > 0 then 'Hay una tarea agendada que nunca corrió.'
      when v_status = 'degraded' then 'Hace más de 15 minutos que no corre una tarea con éxito.'
      when v_status = 'unknown' then 'La agenda existe pero todavía no registró ninguna corrida.'
      else 'Las tareas agendadas corren y terminan bien.'
    end,
    'evidence', jsonb_build_object(
      'installed', v_cron_present,
      'expected_jobs', 2,
      'present_jobs', v_cron_expected,
      'inactive_jobs', v_cron_inactive,
      'failed_last_run', v_cron_failed,
      'never_ran', v_cron_never_ran,
      'last_success_at', v_cron_last_success,
      'jobs', v_cron_jobs
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  -- --- Worker de pagos: se juzga por la cola que tiene que vaciar.
  select
    count(*),
    count(*) filter (where po.status in ('pending', 'retry_wait') and po.next_attempt_at < v_now - interval '10 minutes'),
    count(*) filter (where po.status in ('claimed', 'processing') and po.lease_expires_at < v_now),
    count(*) filter (where po.status = 'failed'),
    count(*) filter (where po.status = 'dead_letter')
    into v_outbox_total, v_outbox_due, v_outbox_stuck, v_outbox_failed, v_outbox_dead
    from public.payment_outbox po
    left join public.payment_intents pi on pi.id = po.payment_intent_id
   -- El trabajo sin intento ligado todavía no tiene negocio: se cuenta igual,
   -- porque un worker frenado lo está para todos.
   where pi.business_id is null or pi.business_id = p_business_id;

  v_status := public.pilot_health_verdict(
    v_outbox_total > 0,
    v_outbox_dead > 0 or v_outbox_due > 0,
    v_outbox_failed > 0
      or v_outbox_stuck > 0
      or coalesce(v_worker_at, '-infinity'::timestamptz) < v_now - interval '24 hours'
  );
  v_services := v_services || jsonb_build_object(
    'service', 'worker',
    'label', 'Procesador de pagos',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when v_outbox_dead > 0 then 'Hay trabajo de pagos abandonado que nadie va a reintentar.'
      when v_outbox_due > 0 then 'Hay trabajo vencido hace más de 10 minutos sin procesar.'
      when v_outbox_failed > 0 then 'Hubo trabajo de pagos que falló.'
      when v_outbox_stuck > 0 then 'Hay trabajo tomado con la reserva vencida.'
      when v_status = 'unknown' then 'La cola de pagos nunca tuvo trabajo: no hay con qué medirlo.'
      when v_status = 'degraded' then 'Hace más de 24 horas que el procesador no completa nada.'
      else 'La cola de pagos avanza.'
    end,
    'evidence', jsonb_build_object(
      'queued_total', v_outbox_total,
      'overdue', v_outbox_due,
      'expired_leases', v_outbox_stuck,
      'failed', v_outbox_failed,
      'dead_letter', v_outbox_dead,
      'last_completion_at', v_worker_at
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  -- --- Panel: cada comando del Panel deja un receipt. Si no hay receipts y sí
  -- hay pedidos abiertos, el Panel no está operando aunque la página cargue.
  select max(c.created_at) into v_panel_last
    from public.business_command_receipts c where c.business_id = p_business_id;
  select count(*) into v_panel_open_orders
    from public.orders o
   where o.business_id = p_business_id
     and o.origin = 'production'
     and public.order_pipeline_state(o.status) in ('received', 'accepted', 'preparing', 'ready');

  v_status := public.pilot_health_verdict(
    v_panel_last is not null,
    false,
    v_panel_open_orders > 0 and coalesce(v_panel_last, '-infinity'::timestamptz) < v_now - interval '30 minutes'
  );
  v_services := v_services || jsonb_build_object(
    'service', 'panel',
    'label', 'Panel del negocio',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when v_status = 'unknown' then 'El Panel todavía no ejecutó ningún comando en este negocio.'
      when v_status = 'degraded' then 'Hay pedidos abiertos y el Panel no toca nada hace más de media hora.'
      else 'El Panel ejecuta comandos y el servidor los confirma.'
    end,
    'evidence', jsonb_build_object(
      'last_command_at', v_panel_last,
      'open_production_orders', v_panel_open_orders
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  -- --- Contratos del Rider: se verifica la matriz de privilegios, no el código
  -- de la app. Una función que desaparece o que vuelve a quedar abierta a
  -- anónimos es un incidente aunque el Android siga compilando.
  select array_agg(required.signature order by required.signature)
    into v_rider_missing
    from (values
      ('get_rider_queue(uuid)'),
      ('list_available_rider_orders(uuid)'),
      ('claim_delivery_order(uuid,text,bigint,text)'),
      ('start_rider_delivery(uuid,bigint,text)'),
      ('mark_delivery_picked_up(uuid,bigint,text)'),
      ('mark_rider_arrived(uuid,bigint,text)'),
      ('confirm_delivery_code(uuid,bigint,text,text)'),
      ('publish_rider_location_receipt(uuid,bigint,double precision,double precision,double precision,double precision,double precision,timestamp with time zone,text,boolean)'),
      ('report_rider_delivery_issue(uuid,bigint,text,text)'),
      ('get_active_rider_delivery()')
    ) as required(signature)
   where to_regprocedure('public.' || required.signature) is null
      or not has_function_privilege('authenticated', to_regprocedure('public.' || required.signature), 'execute');

  select array_agg(exposed.signature order by exposed.signature)
    into v_rider_leaked
    from (values
      ('get_rider_queue(uuid)'),
      ('list_available_rider_orders(uuid)'),
      ('claim_delivery_order(uuid,text,bigint,text)'),
      ('confirm_delivery_code(uuid,bigint,text,text)'),
      ('publish_rider_location_receipt(uuid,bigint,double precision,double precision,double precision,double precision,double precision,timestamp with time zone,text,boolean)')
    ) as exposed(signature)
   where to_regprocedure('public.' || exposed.signature) is not null
     and has_function_privilege('anon', to_regprocedure('public.' || exposed.signature), 'execute');

  select max(rl.created_at) into v_rider_last_activity
    from public.rider_locations rl where rl.business_id = p_business_id;

  v_status := public.pilot_health_verdict(
    true,
    coalesce(array_length(v_rider_missing, 1), 0) > 0,
    coalesce(array_length(v_rider_leaked, 1), 0) > 0
  );
  v_services := v_services || jsonb_build_object(
    'service', 'rider_contracts',
    'label', 'Contratos del Rider',
    'status', v_status,
    'observed_at', v_now,
    'reason', case
      when coalesce(array_length(v_rider_missing, 1), 0) > 0 then 'Falta una función que la app del Rider necesita para operar.'
      when coalesce(array_length(v_rider_leaked, 1), 0) > 0 then 'Una función del Rider quedó accesible sin iniciar sesión.'
      else 'Las diez funciones del Rider existen y sólo las ejecuta quien inició sesión.'
    end,
    'evidence', jsonb_build_object(
      'missing_or_unreachable', coalesce(to_jsonb(v_rider_missing), '[]'::jsonb),
      'reachable_by_anonymous', coalesce(to_jsonb(v_rider_leaked), '[]'::jsonb),
      'last_rider_signal_at', v_rider_last_activity
    )
  );
  v_statuses := array_append(v_statuses, v_status);

  return jsonb_build_object(
    'generated_at', v_now,
    'business_id', p_business_id,
    'overall', public.pilot_health_rollup(v_statuses),
    'thresholds', v_thresholds,
    'services', v_services
  );
end;
$get_pilot_service_health$;

-- ===== 3. Privilegios mínimos =====

revoke execute on function public.pilot_ops_thresholds(uuid) from public, anon, authenticated;
grant execute on function public.pilot_ops_thresholds(uuid) to service_role;

revoke execute on function public.pilot_health_verdict(boolean, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.pilot_health_rollup(text[]) from public, anon, authenticated;
grant execute on function public.pilot_health_verdict(boolean, boolean, boolean) to service_role;
grant execute on function public.pilot_health_rollup(text[]) to service_role;

revoke execute on function public.configure_pilot_ops_thresholds(uuid, jsonb) from public, anon;
grant execute on function public.configure_pilot_ops_thresholds(uuid, jsonb) to authenticated;

revoke execute on function public.get_pilot_service_health(uuid) from public, anon;
grant execute on function public.get_pilot_service_health(uuid) to authenticated;

comment on function public.pilot_ops_thresholds(uuid) is
  'Umbrales operativos con su procedencia: decisión del negocio o default declarado del producto.';
comment on function public.pilot_health_verdict(boolean, boolean, boolean) is
  'Veredicto único de salud. Sin evidencia devuelve unknown; healthy exige evidencia positiva.';
comment on function public.get_pilot_service_health(uuid) is
  'Salud verificada de base, Supabase, funciones, webhook, agenda, worker, Panel y contratos del Rider. Cada estado viaja con su evidencia.';
comment on function public.configure_pilot_ops_thresholds(uuid, jsonb) is
  'Ajusta los umbrales operativos del negocio; rechaza cualquier clave o valor fuera del contrato.';
