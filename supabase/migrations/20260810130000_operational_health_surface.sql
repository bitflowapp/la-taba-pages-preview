-- ============================================================================
--  Una sola pregunta: ¿esto se está mirando solo, y desde cuándo?
-- ============================================================================
--
--  El Centro de operación contesta QUÉ HAY QUE RESOLVER. No contesta si el
--  sistema que encuentra esas cosas está funcionando. Hasta esta migración, un
--  tablero vacío significaba las dos cosas a la vez -«no pasa nada» y «hace seis
--  horas que nadie evalúa»- y no había forma de distinguirlas desde la pantalla.
--
--  Esta superficie contesta, con datos medidos y ninguno inventado:
--    · hace cuánto que corrió la evaluación automática, y si falló;
--    · si el planificador está vivo, job por job, con su último éxito;
--    · si el procesador de cobros está tomando trabajo;
--    · cuántos cobros hay en cola, reintentando o abandonados;
--    · si hay dinero cobrado sin pedido;
--    · qué pedidos necesitan una persona;
--    · cuánto stock quedó reservado por un checkout vencido;
--    · cuántas alertas abiertas hay y desde cuándo.
--
--  SECRETOS: nunca un valor. De la bóveda sale EXISTE / NO EXISTE y, para el
--  caso donde la ausencia de forma es el fallo invisible -la URL del worker
--  tiene que matchear un patrón exacto o el despacho aborta-, un booleano que
--  dice si la forma es la esperada. Ni un fragmento del valor cruza la función.
--
--  NADA ESTÁ EN VERDE POR DEFECTO. Cada booleano `healthy` sale de comparar un
--  timestamp real contra una ventana declarada. Si no hay dato, el estado es
--  `desconocido`, no `sano`.
-- ============================================================================

-- ===== Estado de los secretos operativos, sin los secretos =====
create or replace function public.list_operational_secret_status()
returns table (name text, configured boolean, detail text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $list_operational_secret_status$
declare
  v_url text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return query
      select s.name, false, 'la bóveda no está disponible en este entorno'::text
      from (values ('taba_payment_worker_url'), ('taba_payment_worker_hmac_secret')) as s(name);
    return;
  end if;

  execute 'select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = $1 limit 1'
    into v_url using 'taba_payment_worker_url';
  execute 'select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = $1 limit 1'
    into v_secret using 'taba_payment_worker_hmac_secret';

  -- De acá para abajo sólo salen booleanos y frases fijas. `v_url` y `v_secret`
  -- se usan para decidir, nunca para devolver.
  return query
  select
    'taba_payment_worker_url'::text,
    nullif(btrim(coalesce(v_url, '')), '') is not null,
    case
      when nullif(btrim(coalesce(v_url, '')), '') is null then 'falta cargarla'
      when v_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/mercadopago-payment-worker$'
        then 'está cargada pero no tiene la forma que el despacho exige'
      else 'cargada y con la forma esperada'
    end::text
  union all
  select
    'taba_payment_worker_hmac_secret'::text,
    nullif(coalesce(v_secret, ''), '') is not null,
    case
      when nullif(coalesce(v_secret, ''), '') is null then 'falta cargarla'
      when length(v_secret) < 32 then 'está cargada pero es más corta que el mínimo exigido'
      else 'cargada y con el largo mínimo'
    end::text;
end;
$list_operational_secret_status$;

revoke all on function public.list_operational_secret_status() from public, anon, authenticated;
grant execute on function public.list_operational_secret_status() to service_role;

comment on function public.list_operational_secret_status() is
  'Existencia y forma de los secretos operativos. NUNCA devuelve un valor ni un fragmento.';

-- ===== La superficie, sin verificación de rol: la usan el planificador y las pruebas =====
create or replace function public.build_operational_health(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $build_operational_health$
declare
  v_now timestamptz := clock_timestamp();
  v_sweep record;
  v_result jsonb;
begin
  select r.status, r.started_at, r.finished_at, r.businesses_evaluated,
         r.findings, r.open_alerts, r.critical_alerts, r.failures
    into v_sweep
    from public.operational_sweep_runs r
   where r.scope = 'operational_alerts'
   order by r.started_at desc
   limit 1;

  select jsonb_build_object(
    'generated_at', v_now,
    'business_id', p_business_id,

    -- ¿Se está evaluando solo? Es la pregunta que ordena todo el resto.
    'autonomous_evaluation', jsonb_build_object(
      'expected_every_seconds', 60,
      'last_run_at', v_sweep.started_at,
      'seconds_since_last_run', case when v_sweep.started_at is null then null
        else round(extract(epoch from (v_now - v_sweep.started_at))) end,
      'last_status', v_sweep.status,
      'businesses_evaluated', v_sweep.businesses_evaluated,
      'findings', v_sweep.findings,
      'failures', coalesce(v_sweep.failures, '[]'::jsonb),
      'state', case
        when v_sweep.started_at is null then 'desconocido'
        when v_sweep.started_at < v_now - interval '5 minutes' then 'detenido'
        when v_sweep.status = 'failed' then 'fallando'
        when v_sweep.status = 'partial' then 'degradado'
        else 'al día'
      end
    ),

    -- El planificador, job por job. Sin fila, sin afirmación.
    'scheduler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job', sh.job_name,
        'schedule', sh.schedule,
        'active', sh.active,
        'last_start', sh.last_start,
        'last_success_at', sh.last_success_at,
        'seconds_since_success', case when sh.last_success_at is null then null
          else round(extract(epoch from (v_now - sh.last_success_at))) end,
        'failures_since_success', sh.failures_since_success,
        'state', case
          when not sh.active then 'apagado'
          when sh.last_success_at is null then 'sin ninguna corrida exitosa'
          when sh.last_success_at < v_now - interval '15 minutes' then 'detenido'
          when sh.failures_since_success >= 3 then 'fallando'
          when sh.failures_since_success > 0 then 'con fallos recientes'
          else 'al día'
        end
      ) order by sh.job_name)
      from public.list_scheduler_health() sh
    ), '[]'::jsonb),

    -- Cobros: la cola, el procesador y la reconciliación con el proveedor.
    'payments', jsonb_build_object(
      'outbox', (
        select jsonb_build_object(
          'pending', count(*) filter (where po.status = 'pending'),
          'retry_wait', count(*) filter (where po.status = 'retry_wait'),
          'in_flight', count(*) filter (where po.status in ('claimed','processing')),
          'failed', count(*) filter (where po.status = 'failed'),
          'dead_letter', count(*) filter (where po.status = 'dead_letter'),
          'due_now', count(*) filter (where
            (po.status in ('pending','retry_wait') and po.next_attempt_at <= v_now)
            or (po.status in ('claimed','processing') and po.lease_expires_at < v_now)),
          'oldest_due_seconds', coalesce(round(extract(epoch from (v_now - min(po.next_attempt_at) filter (where
            po.status in ('pending','retry_wait') and po.next_attempt_at <= v_now)))), 0)
        )
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
      ),
      'worker', (
        select jsonb_build_object(
          'last_success_at', max(po.completed_at),
          'seconds_since_success', case when max(po.completed_at) is null then null
            else round(extract(epoch from (v_now - max(po.completed_at)))) end,
          'completed_last_hour', count(*) filter (where po.completed_at > v_now - interval '1 hour'),
          'last_failure_at', max(po.updated_at) filter (where po.status in ('failed','dead_letter')),
          'failed_last_hour', count(*) filter (
            where po.status in ('failed','dead_letter') and po.updated_at > v_now - interval '1 hour'),
          'state', case
            when count(*) filter (where
              (po.status in ('pending','retry_wait') and po.next_attempt_at < v_now - interval '5 minutes')
              or (po.status in ('claimed','processing') and po.lease_expires_at < v_now - interval '5 minutes')) > 0
              then 'no está tomando trabajo'
            when count(*) filter (where po.status in ('dead_letter')) > 0 then 'con trabajos abandonados'
            when max(po.completed_at) is null then 'sin trabajo procesado todavía'
            else 'al día'
          end
        )
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
      ),
      'reconciliation', jsonb_build_object(
        -- Dinero adentro y ningún pedido: la definición del peor caso, contada
        -- por la misma función que ya es autoridad de eso.
        'paid_without_order', (
          select count(*)
          from public.list_unfinalized_paid_checkouts() u
          join public.checkout_sessions cs on cs.id = u.checkout_session_id
          where cs.business_id = p_business_id
        ),
        'probes_last_hour', (
          select count(*)
          from public.payment_events pe
          join public.payment_intents pi on pi.id = pe.payment_intent_id
          where pi.business_id = p_business_id
            and pe.event_type = 'payment.provider_probe_empty'
            and pe.server_recorded_at > v_now - interval '1 hour'
        ),
        'provider_answers_last_hour', (
          select count(*)
          from public.payment_events pe
          join public.payment_intents pi on pi.id = pe.payment_intent_id
          where pi.business_id = p_business_id
            and pe.server_recorded_at > v_now - interval '1 hour'
        ),
        'in_review', (
          select count(*) from public.payment_intents pi
          where pi.business_id = p_business_id
            and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending')
        )
      )
    ),

    -- Pedidos que necesitan una persona, con el mismo criterio que las alertas.
    'orders_needing_attention', (
      select jsonb_build_object(
        'not_accepted', count(*) filter (
          where o.status in ('submitted','received')
            and o.acknowledged_at is null
            and o.created_at < v_now - interval '10 minutes'),
        'stalled', count(*) filter (
          where o.status in ('accepted','preparing')
            and coalesce(o.acknowledged_at, o.created_at)
                + make_interval(mins => coalesce(o.preparation_estimate_minutes, 30) + 30) < v_now),
        'ready_without_rider', count(*) filter (
          where o.status = 'ready'
            and coalesce(o.fulfillment_type, o.delivery_mode) = 'delivery'
            and o.assigned_rider_user_id is null
            and coalesce(o.ready_at, o.updated_at) < v_now - interval '15 minutes'),
        'active_deliveries', count(*) filter (
          where o.status in ('assigned','picked_up','on_the_way','arrived'))
      )
      from public.orders o
      where o.business_id = p_business_id
        and coalesce(o.origin, 'production') <> 'qa'
        and o.status not in ('delivered','canceled','cancelled','rejected','draft')
    ),

    'riders_without_signal', (
      select count(*) from public.operational_alerts a
      where a.business_id = p_business_id
        and a.alert_code = 'RIDER_SIGNAL_STALE'
        and a.status <> 'resolved'
    ),

    -- Stock retenido por checkouts que ya vencieron: se vacía la góndola sin
    -- haber vendido nada.
    'reservations', (
      select jsonb_build_object(
        'active', count(*) filter (where r.status = 'active'),
        'expired_still_held', count(*) filter (
          where r.status = 'active' and r.expires_at < v_now - interval '5 minutes'),
        'oldest_expired_minutes', coalesce(round(extract(epoch from (
          v_now - min(r.expires_at) filter (where r.status = 'active' and r.expires_at < v_now)
        )) / 60), 0)
      )
      from public.inventory_reservations r
      join public.checkout_sessions cs on cs.id = r.checkout_session_id
      where cs.business_id = p_business_id
    ),

    'alerts', (
      select jsonb_build_object(
        'open', count(*) filter (where a.status <> 'resolved'),
        'critical', count(*) filter (where a.status <> 'resolved' and a.severity = 'CRITICAL'),
        'action_required', count(*) filter (where a.status <> 'resolved' and a.severity = 'ACTION_REQUIRED'),
        'warning', count(*) filter (where a.status <> 'resolved' and a.severity = 'WARNING'),
        'acknowledged', count(*) filter (where a.status = 'acknowledged'),
        'oldest_open_at', min(a.first_seen_at) filter (where a.status <> 'resolved'),
        'detected_by_system_last_hour', (
          select count(*) from public.operational_alert_events e
          where e.business_id = p_business_id
            and e.event_type in ('detected','reopened')
            and e.actor_id is null
            and e.created_at > v_now - interval '1 hour'
        )
      )
      from public.operational_alerts a
      where a.business_id = p_business_id
    ),

    'secrets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'configured', s.configured, 'detail', s.detail
      ) order by s.name)
      from public.list_operational_secret_status() s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$build_operational_health$;

revoke all on function public.build_operational_health(uuid) from public, anon, authenticated;
grant execute on function public.build_operational_health(uuid) to service_role;

comment on function public.build_operational_health(uuid) is
  'Salud operativa medida del negocio. Sin verificacion de rol: la usan el planificador y las pruebas. El camino humano es get_operational_health.';

create or replace function public.get_operational_health(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $get_operational_health$
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return public.build_operational_health(p_business_id);
end;
$get_operational_health$;

revoke all on function public.get_operational_health(uuid) from public, anon;
grant execute on function public.get_operational_health(uuid) to authenticated, service_role;

comment on function public.get_operational_health(uuid) is
  'Salud operativa para el negocio o el administrador. Nunca devuelve secretos: de la boveda sale existencia y forma.';

-- ============================================================================
--  El Centro de operación pasa a traer la salud en el mismo viaje.
-- ============================================================================
--  Se reproduce la función de 20260802180000 sin un solo cambio en métricas,
--  alertas ni cierres. Lo único que se agrega es la clave `health`.
create or replace function public.get_production_operation_center(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $get_production_operation_center$
declare
  v_result jsonb;
begin
  if not public.has_business_role(p_business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  perform public.refresh_operational_alerts(p_business_id);
  select jsonb_build_object(
    'generated_at',clock_timestamp(),
    'business_id',p_business_id,
    'metrics',jsonb_build_object(
      'new_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('submitted','received') and o.created_at>=clock_timestamp()-interval '24 hours'),
      'delayed_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status not in ('delivered','canceled','cancelled','rejected') and coalesce(o.acknowledged_at,o.created_at)+make_interval(mins=>coalesce(o.preparation_estimate_minutes,30))<clock_timestamp()),
      'pending_payments',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('created','preference_creating','preference_created','redirected','pending','in_process')),
      'payments_in_review',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending')),
      'orders_without_stock',(select count(*) from public.checkout_sessions cs where cs.business_id=p_business_id and cs.status='manual_review_required' and coalesce(cs.manual_review_reason,'') like '%reservation%'),
      'packing_incomplete',(select count(*) from public.order_packing_sessions ps where ps.business_id=p_business_id and ps.status in ('not_started','in_progress','complete','exception_required')),
      'active_deliveries',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('assigned','picked_up','on_the_way','arrived')),
      'riders_without_signal',(select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.alert_code='RIDER_SIGNAL_STALE' and a.status<>'resolved'),
      'fiscal_documents_pending',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and (fd.state in ('draft','queued','claiming','authenticating','authorizing','ambiguous','retry_wait','failed') or (fd.state='authorized' and fd.artifact_state<>'artifact_ready'))),
      'failed_prints',(select count(*) from public.fiscal_print_jobs pj where pj.business_id=p_business_id and pj.status in ('failed','unknown')),
      'pending_credit_notes',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.document_intent='credit_note' and (fd.state<>'authorized' or fd.artifact_state<>'artifact_ready')),
      'blocked_outboxes',(
        (select count(*) from public.payment_outbox po join public.payment_intents pi on pi.id=po.payment_intent_id where pi.business_id=p_business_id and po.status in ('failed','dead_letter'))
        +(select count(*) from public.fiscal_outbox fo join public.fiscal_documents fd on fd.id=fo.fiscal_document_id where fd.business_id=p_business_id and fo.state='dead_letter')
        +(select count(*) from public.fiscal_artifact_outbox fao join public.fiscal_documents fd on fd.id=fao.fiscal_document_id where fd.business_id=p_business_id and fao.state='dead_letter')
      ),
      'reconciliations_required',(
        (select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending'))
        +(select count(*) from public.payment_refunds pr join public.payment_intents pi on pi.id=pr.payment_intent_id where pi.business_id=p_business_id and pr.status='ambiguous')
        +(select count(*) from public.payment_cancellations pc join public.payment_intents pi on pi.id=pc.payment_intent_id where pi.business_id=p_business_id and pc.status='ambiguous')
        +(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.state='ambiguous')
      )
    ),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'severity',a.severity,'code',a.alert_code,'status',a.status,
      'summary',a.summary,'required_action',a.required_action,
      'subject_type',a.subject_type,'subject_id',a.subject_id,
      'correlation_id',a.correlation_id,'last_seen_at',a.last_seen_at,
      'occurrence_count',a.occurrence_count
    ) order by case a.severity when 'CRITICAL' then 1 when 'ACTION_REQUIRED' then 2 when 'WARNING' then 3 else 4 end,a.last_seen_at desc)
      from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved'),'[]'::jsonb),
    'recent_closures',coalesce((select jsonb_agg(to_jsonb(r) order by r.business_date desc)
      from (select id,business_date,status,revision,declared_cash,expected_cash,cash_difference,difference_note,open_alerts,critical_alerts,snapshot_sha256,prepared_at,closed_at
        from public.daily_reconciliations where business_id=p_business_id order by business_date desc limit 14) r),'[]'::jsonb),
    'health',public.build_operational_health(p_business_id)
  ) into v_result;
  return v_result;
end;
$get_production_operation_center$;

revoke execute on function public.get_production_operation_center(uuid) from public, anon;
grant execute on function public.get_production_operation_center(uuid) to authenticated;

comment on function public.get_production_operation_center(uuid) is
  'Estado autoritativo del Centro de operacion, ahora con la salud operativa medida en el mismo viaje.';
