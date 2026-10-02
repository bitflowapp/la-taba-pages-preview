-- Una sola pregunta para la plataforma: ¿se puede vender ahora?
--
-- QUÉ HABÍA (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   `get_operational_health(negocio)` responde por UN negocio y para el Panel. No
--   mira la base, ni Auth, ni si el checkout está pudiendo vencer sesiones, ni el
--   estado de la cuenta de Mercado Pago, ni un solo aviso (webhook):
--
--     · seis avisos con la firma rechazada: la salud no los nombraba en ninguna parte;
--     · un aviso abandonado (`dead_letter`) sin intento de pago: cola en ceros;
--     · una tarea de pg_cron apagada o borrada: ninguna alerta, y la borrada ni
--       figuraba (la lista se arma con lo que existe en `cron.job`).
--
--   Lo demás vivía en scripts que hablan con la API de administración, atados a un
--   proyecto que ya no es el de la tienda.
--
-- QUÉ AGREGA
--
--   `public.get_ecommerce_health()` — sólo `service_role`. Devuelve un documento con
--   un estado por componente y el peor de todos como estado general:
--
--     database             catálogo, cabeza del libro de migraciones, conexiones
--     auth                 el esquema de Auth se alcanza desde la base
--     checkout             barrido de vencimiento, sesiones y reservas vencidas sin liberar
--     orders               pedidos sin atender, errores del guardián de admisión
--     payment_integration  cola de cobros (con y sin intento), abandonados, cuenta
--                          vinculada de cada negocio, secretos del despacho
--     webhook_processing   último aviso, firmas rechazadas, avisos trabados
--     schedulers           inventario de tareas contra `cron.job`, latido del barrido,
--                          historial sin podar
--
--   Cada componente: `{component, status, checked_at, detail}` con
--   `status` en ok | degraded | down | unknown.
--
-- REGLAS QUE CUMPLE
--
--   · Nunca falla por una sonda: cada componente corre en su propio bloque; si la
--     sonda no puede leer, ese componente queda `unknown` con el SQLSTATE y los
--     demás se informan igual.
--   · No expone secretos: de los secretos sale si están cargados y una frase fija;
--     de la cuenta de Mercado Pago, su estado y nunca un token; de los avisos,
--     cuentas y fechas.
--   · No adivina: lo que SQL no puede saber se dice. Que Auth tenga habilitado el
--     ingreso anónimo es configuración de GoTrue: figura como `unknown` con su
--     motivo, y la lista `not_observable_from_sql` nombra lo que este documento no
--     cubre.
--   · Una firma rechazada es entrada sin autenticar (cualquiera puede mandarla):
--     sola no degrada nada; cinco en una hora sin ningún aviso válido, sí.
--
-- QUÉ NO CAMBIA
--
--   Nada de lo existente: es una función nueva, de lectura, sin tablas propias.
--   El inventario de tareas sale de `private.scheduler_expected_jobs` (20261001220000).
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001221000_ecommerce_health.rollback.sql

create or replace function public.get_ecommerce_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_components jsonb := '[]'::jsonb;
  v_status text;
  v_detail jsonb;
  v_extra jsonb;
  v_jobs jsonb;
  v_job jsonb;
  v_beat jsonb;
  v_sellers jsonb;
  v_secrets jsonb;
  v_count bigint;
  v_count_2 bigint;
  v_count_3 bigint;
  v_oldest timestamptz;
  v_paused boolean;
  v_enabled integer;
  v_cannot_charge integer;
  v_cron_installed boolean := to_regclass('cron.job') is not null;
  -- Estados de tarea que NO son un problema. Todo lo demás (apagado, detenido,
  -- fallando, sin ninguna corrida exitosa, no programada) sí lo es.
  v_healthy_job_states constant text[] := array['al día', 'con fallos recientes', 'esperando su primera corrida'];
begin
  -- ── Tareas: inventario contra lo que existe. Lo usan tres componentes. ─────
  begin
    select jsonb_agg(jsonb_build_object(
             'job', coalesce(e.job_name, sh.job_name),
             'expected', e.job_name is not null,
             'scheduled', sh.job_name is not null,
             'active', coalesce(sh.active, false),
             'schedule', sh.schedule,
             'last_success_at', sh.last_success_at,
             'seconds_since_success', case when sh.last_success_at is null then null
               else round(extract(epoch from (v_now - sh.last_success_at))) end,
             'failures_since_success', coalesce(sh.failures_since_success, 0),
             'state', case
               when sh.job_name is null then 'no programada'
               else private.scheduler_job_state(
                 sh.active, sh.schedule, sh.last_start, sh.last_success_at,
                 sh.failures_since_success, e.expected_since, v_now)
             end
           ) order by coalesce(e.job_name, sh.job_name))
      into v_jobs
      from private.scheduler_expected_jobs e
      full join public.list_scheduler_health() sh on sh.job_name = e.job_name;
  exception when others then
    v_jobs := null;
  end;

  -- ── database ───────────────────────────────────────────────────────────────
  begin
    select jsonb_build_object(
             'server_version_num', current_setting('server_version_num')::integer,
             'in_recovery', pg_is_in_recovery(),
             'public_tables', (
               select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'),
             'connections', (
               select jsonb_build_object(
                        'client_backends', count(*),
                        'max_connections', current_setting('max_connections')::integer,
                        'used_percent', round(100.0 * count(*) / current_setting('max_connections')::integer))
                 from pg_stat_activity a
                where a.backend_type = 'client backend'))
      into v_detail;
    begin
      if to_regclass('supabase_migrations.schema_migrations') is null then
        v_detail := v_detail || jsonb_build_object('migrations_head', null,
          'migrations_note', 'el libro de migraciones no existe en esta base');
      else
        execute 'select jsonb_build_object(''migrations_head'', max(m.version), ''migrations_applied'', count(*))
                   from supabase_migrations.schema_migrations m' into v_extra;
        v_detail := v_detail || v_extra;
      end if;
    exception when others then
      v_detail := v_detail || jsonb_build_object('migrations_head', null,
        'migrations_note', 'el libro de migraciones no se pudo leer (' || sqlstate || ')');
    end;
    v_status := case
      when (v_detail ->> 'public_tables')::integer = 0 then 'down'
      when (v_detail ->> 'in_recovery')::boolean then 'degraded'
      when (v_detail #>> '{connections,used_percent}')::numeric >= 90 then 'degraded'
      else 'ok'
    end;
  exception when others then
    v_status := 'unknown';
    v_detail := jsonb_build_object('probe_error', sqlstate);
  end;
  v_components := v_components || jsonb_build_array(jsonb_build_object(
    'component', 'database', 'status', v_status, 'checked_at', clock_timestamp(), 'detail', v_detail));

  -- ── auth ───────────────────────────────────────────────────────────────────
  begin
    if to_regclass('auth.users') is null then
      v_status := 'down';
      v_detail := jsonb_build_object('schema_reachable', false);
    else
      execute 'select 1 from auth.users limit 1';
      v_status := 'ok';
      v_detail := jsonb_build_object('schema_reachable', true);
    end if;
    v_detail := v_detail || jsonb_build_object('anonymous_sign_ins', jsonb_build_object(
      'status', 'unknown',
      'reason', 'que Auth permita el ingreso anónimo es configuración de GoTrue: no es visible desde SQL'));
  exception when others then
    v_status := 'unknown';
    v_detail := jsonb_build_object('probe_error', sqlstate);
  end;
  v_components := v_components || jsonb_build_array(jsonb_build_object(
    'component', 'auth', 'status', v_status, 'checked_at', clock_timestamp(), 'detail', v_detail));

  -- ── checkout ───────────────────────────────────────────────────────────────
  begin
    -- Las mismas cinco situaciones que vence `expire_checkout_sessions`: una sesión
    -- en ellas con más de cinco minutos de vencida es una que el barrido no alcanzó.
    select count(*), min(s.expires_at) into v_count, v_oldest
      from public.checkout_sessions s
     where s.status in ('created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending')
       and s.expires_at < v_now - interval '5 minutes';
    select count(*) into v_count_2
      from public.inventory_reservations r
     where r.status = 'active' and r.expires_at < v_now - interval '5 minutes';
    select j.value into v_job from jsonb_array_elements(coalesce(v_jobs, '[]'::jsonb)) as j(value)
     where j.value ->> 'job' = 'taba-checkout-expiry-sweep';
    begin
      select c.paused into v_paused from private.a1_a4_release_control_v5 c where c.singleton;
    exception when others then
      v_paused := null;
    end;
    v_detail := jsonb_build_object(
      'expiry_sweep', case when v_job is null then null else jsonb_build_object(
        'state', v_job ->> 'state',
        'last_success_at', v_job -> 'last_success_at',
        'seconds_since_success', v_job -> 'seconds_since_success') end,
      'sessions_past_expiry', v_count,
      'oldest_past_expiry_minutes', case when v_oldest is null then null
        else round(extract(epoch from (v_now - v_oldest)) / 60) end,
      'reservations_past_expiry', v_count_2,
      'financial_writes_paused', v_paused);
    v_status := case
      when coalesce(v_paused, false) then 'down'
      when v_oldest < v_now - interval '30 minutes' then 'down'
      when v_count > 0 or v_count_2 > 0 then 'degraded'
      when v_job is null or not ((v_job ->> 'state') = any (v_healthy_job_states)) then 'degraded'
      else 'ok'
    end;
  exception when others then
    v_status := 'unknown';
    v_detail := jsonb_build_object('probe_error', sqlstate);
  end;
  v_components := v_components || jsonb_build_array(jsonb_build_object(
    'component', 'checkout', 'status', v_status, 'checked_at', clock_timestamp(), 'detail', v_detail));

  -- ── orders ─────────────────────────────────────────────────────────────────
  begin
    -- Misma cláusula que la alerta ORDER_NOT_ACCEPTED, negocio por negocio para
    -- usar el índice (business_id, status).
    select coalesce(sum(x.unattended), 0), min(x.oldest),
           coalesce(jsonb_agg(jsonb_build_object(
             'business_id', b.id,
             'unattended', x.unattended,
             'oldest_minutes', round(extract(epoch from (v_now - x.oldest)) / 60)
           ) order by x.oldest) filter (where x.unattended > 0), '[]'::jsonb)
      into v_count, v_oldest, v_extra
      from public.businesses b
      cross join lateral (
        select count(*) as unattended, min(o.created_at) as oldest
          from public.orders o
         where o.business_id = b.id
           and o.status in ('submitted', 'received')
           and o.acknowledged_at is null
           and coalesce(o.origin, 'production') <> 'qa'
           and o.created_at < v_now - interval '10 minutes'
      ) x;
    v_detail := jsonb_build_object(
      'unattended_over_10_minutes', v_count,
      'oldest_unattended_minutes', case when v_oldest is null then null
        else round(extract(epoch from (v_now - v_oldest)) / 60) end,
      'businesses_with_unattended', (
        select coalesce(jsonb_agg(first.value), '[]'::jsonb)
          from (select e.value from jsonb_array_elements(v_extra) with ordinality as e(value, position)
                 where e.position <= 20) first));
    v_count_2 := null;
    begin
      select coalesce(sum(k.blocked_count) filter (where k.last_reason = 'guard_error'), 0),
             coalesce(sum(k.blocked_count), 0)
        into v_count_2, v_count_3
        from private.order_intake_blocks k
       where k.window_started_at > v_now - interval '70 minutes'
         and k.last_blocked_at > v_now - interval '1 hour';
      v_detail := v_detail || jsonb_build_object('intake_guard', jsonb_build_object(
        'guard_errors_last_hour', v_count_2,
        'blocked_attempts_last_hour', v_count_3,
        'businesses_by_mode', (
          select coalesce(jsonb_object_agg(m.mode, m.total), '{}'::jsonb)
            from (select b.order_intake_guard_mode as mode, count(*) as total
                    from public.businesses b where b.is_active group by b.order_intake_guard_mode) m)));
    exception when others then
      v_detail := v_detail || jsonb_build_object('intake_guard', jsonb_build_object(
        'status', 'unknown', 'probe_error', sqlstate));
    end;
    v_status := case
      when v_count > 0 or coalesce(v_count_2, 0) > 0 then 'degraded'
      else 'ok'
    end;
  exception when others then
    v_status := 'unknown';
    v_detail := jsonb_build_object('probe_error', sqlstate);
  end;
  v_components := v_components || jsonb_build_array(jsonb_build_object(
    'component', 'orders', 'status', v_status, 'checked_at', clock_timestamp(), 'detail', v_detail));

  -- ── payment_integration ────────────────────────────────────────────────────
  begin
    -- TODA la cola, tenga o no intento de pago: un aviso recién llegado todavía no
    -- sabe de qué checkout es, y es justo el que se pierde si nadie lo procesa.
    select jsonb_build_object(
             'pending', count(*) filter (where po.status = 'pending'),
             'retry_wait', count(*) filter (where po.status = 'retry_wait'),
             'in_flight', count(*) filter (where po.status in ('claimed', 'processing')),
             'failed', count(*) filter (where po.status = 'failed'),
             'dead_letter', count(*) filter (where po.status = 'dead_letter'),
             'dead_letter_last_24h', count(*) filter (
               where po.status = 'dead_letter' and po.updated_at > v_now - interval '24 hours'),
             'without_payment_intent', count(*) filter (
               where po.payment_intent_id is null and po.status <> 'completed'),
             'due_now', count(*) filter (where
               (po.status in ('pending', 'retry_wait') and po.next_attempt_at <= v_now)
               or (po.status in ('claimed', 'processing') and po.lease_expires_at < v_now)),
             'oldest_due_seconds', coalesce(round(extract(epoch from (v_now - min(
               case when po.status in ('pending', 'retry_wait') and po.next_attempt_at <= v_now then po.next_attempt_at
                    when po.status in ('claimed', 'processing') and po.lease_expires_at < v_now then po.lease_expires_at
               end)))), 0),
             'last_completed_at', max(po.completed_at))
      into v_extra
      from public.payment_outbox po;

    -- La cuenta vinculada de cada negocio que tiene Mercado Pago encendido. Mismo
    -- criterio que la alerta MERCADOPAGO_SELLER_CANNOT_CHARGE; nunca un token.
    select coalesce(jsonb_agg(jsonb_build_object(
             'business_id', s.business_id,
             'environment', s.environment,
             'connection', case
               when c.business_id is null then 'missing'
               when c.status <> 'connected' then c.status
               when c.protected_tokens is null then 'without_credentials'
               when c.seller_id is distinct from s.collector_id
                 or c.application_id is distinct from s.application_id then 'account_mismatch'
               else 'connected'
             end,
             'connected_at', c.connected_at,
             'last_refresh_at', c.last_refresh_at,
             'token_expires_at', c.expires_at
           ) order by s.business_id), '[]'::jsonb)
      into v_sellers
      from public.business_payment_settings s
      left join public.mp_seller_connections c
        on c.business_id = s.business_id and c.environment = s.environment
     where s.provider = 'mercadopago' and s.enabled;
    v_enabled := jsonb_array_length(v_sellers);
    select count(*) into v_cannot_charge
      from jsonb_array_elements(v_sellers) as seller(value)
     where seller.value ->> 'connection' <> 'connected';

    begin
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', st.name, 'configured', st.configured, 'detail', st.detail) order by st.name), '[]'::jsonb)
        into v_secrets
        from public.list_operational_secret_status() st;
    exception when others then
      v_secrets := null;
    end;

    select j.value into v_job from jsonb_array_elements(coalesce(v_jobs, '[]'::jsonb)) as j(value)
     where j.value ->> 'job' = 'taba-payment-outbox-worker';
    v_paused := null;
    begin
      select bool_or(d.paused) into v_paused from private.a1_a4_payment_dispatch_control d;
    exception when others then
      v_paused := null;
    end;

    v_detail := jsonb_build_object(
      'outbox', v_extra,
      'enabled_businesses', v_enabled,
      'businesses_that_cannot_charge', v_cannot_charge,
      'seller_connections', v_sellers,
      'dispatch_secrets', v_secrets,
      'dispatch_paused', v_paused,
      'worker_job', case when v_job is null then null else jsonb_build_object(
        'state', v_job ->> 'state',
        'last_success_at', v_job -> 'last_success_at',
        'seconds_since_success', v_job -> 'seconds_since_success') end);

    v_status := case
      when (v_extra ->> 'oldest_due_seconds')::numeric > 900 then 'down'
      when v_enabled > 0 and v_cannot_charge = v_enabled then 'down'
      when (v_extra ->> 'dead_letter_last_24h')::bigint > 0 then 'degraded'
      when (v_extra ->> 'failed')::bigint > 0 then 'degraded'
      when (v_extra ->> 'oldest_due_seconds')::numeric > 300 then 'degraded'
      when v_cannot_charge > 0 then 'degraded'
      when coalesce(v_paused, false) then 'degraded'
      when v_enabled > 0 and (
        v_secrets is null
        or exists (select 1 from jsonb_array_elements(v_secrets) as secret(value)
                    where (secret.value ->> 'configured')::boolean is not true)
        or v_job is null
        or not ((v_job ->> 'state') = any (v_healthy_job_states))
      ) then 'degraded'
      else 'ok'
    end;
  exception when others then
    v_status := 'unknown';
    v_detail := jsonb_build_object('probe_error', sqlstate);
  end;
  v_components := v_components || jsonb_build_array(jsonb_build_object(
    'component', 'payment_integration', 'status', v_status, 'checked_at', clock_timestamp(), 'detail', v_detail));

  -- ── webhook_processing ─────────────────────────────────────────────────────
  begin
    select jsonb_build_object(
             'last_received_at', max(r.received_at),
             'seconds_since_last_received', case when max(r.received_at) is null then null
               else round(extract(epoch from (v_now - max(r.received_at)))) end,
             'last_valid_received_at', max(r.received_at) filter (where r.signature_valid),
             'valid_last_hour', count(*) filter (
               where r.signature_valid and r.received_at > v_now - interval '1 hour'),
             'rejected_signature_last_hour', count(*) filter (
               where r.processing_status = 'rejected_signature' and r.received_at > v_now - interval '1 hour'),
             'rejected_signature_last_24h', count(*) filter (
               where r.processing_status = 'rejected_signature' and r.received_at > v_now - interval '24 hours'),
             'failed_or_dead_letter_last_24h', count(*) filter (
               where r.processing_status in ('failed', 'dead_letter') and r.received_at > v_now - interval '24 hours'),
             'unprocessed_over_15_minutes', count(*) filter (
               where r.processing_status in ('received', 'queued', 'processing', 'retry_wait')
                 and r.received_at < v_now - interval '15 minutes'))
      into v_detail
      from public.payment_webhook_receipts r;
    v_status := case
      when (v_detail ->> 'failed_or_dead_letter_last_24h')::bigint > 0 then 'degraded'
      when (v_detail ->> 'unprocessed_over_15_minutes')::bigint > 0 then 'degraded'
      when (v_detail ->> 'rejected_signature_last_hour')::bigint >= 5
        and (v_detail ->> 'valid_last_hour')::bigint = 0 then 'degraded'
      else 'ok'
    end;
  exception when others then
    v_status := 'unknown';
    v_detail := jsonb_build_object('probe_error', sqlstate);
  end;
  v_components := v_components || jsonb_build_array(jsonb_build_object(
    'component', 'webhook_processing', 'status', v_status, 'checked_at', clock_timestamp(), 'detail', v_detail));

  -- ── schedulers ─────────────────────────────────────────────────────────────
  begin
    if v_jobs is null then
      raise exception 'no se pudo leer el planificador' using errcode = 'P0001';
    end if;
    v_beat := public.scheduler_heartbeat();
    v_extra := null;
    if to_regclass('cron.job_run_details') is not null then
      begin
        -- Sin contar la tabla: se mira la corrida número mil desde el principio. Si
        -- es de hace más de ocho días, hay más de mil filas que la poda no borró.
        execute 'select jsonb_build_object(
                   ''estimated_rows'', (select greatest(c.reltuples, 0)::bigint from pg_class c
                                         where c.oid = ''cron.job_run_details''::regclass),
                   ''unpruned'', coalesce((
                     select coalesce(d.end_time, d.start_time) < $1 - interval ''8 days''
                       from cron.job_run_details d order by d.runid offset 1000 limit 1), false))'
          into v_extra using v_now;
      exception when others then
        v_extra := jsonb_build_object('status', 'unknown', 'probe_error', sqlstate);
      end;
    end if;
    v_detail := jsonb_build_object(
      'pg_cron_installed', v_cron_installed,
      'heartbeat', jsonb_build_object(
        'healthy', coalesce((v_beat ->> 'healthy')::boolean, false),
        'last_run_at', v_beat -> 'last_run_at',
        'age_seconds', v_beat -> 'age_seconds',
        'stale_after_seconds', v_beat -> 'stale_after_seconds'),
      'jobs', v_jobs,
      'missing', (select coalesce(jsonb_agg(j.value -> 'job'), '[]'::jsonb)
                    from jsonb_array_elements(v_jobs) as j(value)
                   where (j.value ->> 'expected')::boolean and not (j.value ->> 'scheduled')::boolean),
      'inactive', (select coalesce(jsonb_agg(j.value -> 'job'), '[]'::jsonb)
                     from jsonb_array_elements(v_jobs) as j(value)
                    where (j.value ->> 'scheduled')::boolean and not (j.value ->> 'active')::boolean),
      'not_in_inventory', (select coalesce(jsonb_agg(j.value -> 'job'), '[]'::jsonb)
                             from jsonb_array_elements(v_jobs) as j(value)
                            where not (j.value ->> 'expected')::boolean),
      'history', v_extra);
    v_status := case
      when not v_cron_installed then 'down'
      when not coalesce((v_beat ->> 'healthy')::boolean, false) then 'down'
      when exists (
        select 1 from jsonb_array_elements(v_jobs) as j(value)
         where (j.value ->> 'expected')::boolean
           and not ((j.value ->> 'state') = any (v_healthy_job_states))
      ) then 'degraded'
      when coalesce((v_extra ->> 'unpruned')::boolean, false) then 'degraded'
      else 'ok'
    end;
  exception when others then
    v_status := 'unknown';
    v_detail := jsonb_build_object('probe_error', sqlstate);
  end;
  v_components := v_components || jsonb_build_array(jsonb_build_object(
    'component', 'schedulers', 'status', v_status, 'checked_at', clock_timestamp(), 'detail', v_detail));

  -- ── estado general: el peor ────────────────────────────────────────────────
  return jsonb_build_object(
    'generated_at', v_now,
    'status', (
      select case max(case c.value ->> 'status'
                        when 'down' then 3 when 'degraded' then 2 when 'unknown' then 1 else 0 end)
               when 3 then 'down' when 2 then 'degraded' when 1 then 'unknown' else 'ok'
             end
        from jsonb_array_elements(v_components) as c(value)),
    'summary', (
      select jsonb_object_agg(s.status, s.total)
        from (select c.value ->> 'status' as status, count(*) as total
                from jsonb_array_elements(v_components) as c(value) group by 1) s),
    'components', v_components,
    'not_observable_from_sql', jsonb_build_array(
      'auth.anonymous_sign_ins_enabled',
      'edge_functions.deployed_versions_and_secrets',
      'storefront.availability',
      'mercadopago.api_reachability')
  );
end;
$$;

revoke all on function public.get_ecommerce_health() from public, anon, authenticated;
grant execute on function public.get_ecommerce_health() to service_role;

comment on function public.get_ecommerce_health() is
  'Salud de la plataforma por componente (database, auth, checkout, orders, payment_integration, webhook_processing, schedulers). Solo service_role; sin secretos ni datos personales.';
