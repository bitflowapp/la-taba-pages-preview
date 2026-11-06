-- Lectores de incidencias que respetan el RECONOCIMIENTO de una persona (ver 20261105010000_mobbex_merchant_console.sql).
--
-- Antes: `mobbex_pipeline_health()` y la alerta MOBBEX_PAYMENT_NEEDS_REVIEW contaban TODO cobro en revisión de seguridad o con
-- `attention_reason`, y esas marcas sólo se limpian con un reembolso completo dentro de TABA. Un cobro duplicado ya devuelto desde el
-- panel de Mobbex dejaba la alerta encendida para siempre, y una alerta permanente deja de leerse.
-- Ahora cuentan sólo las incidencias SIN un reconocimiento vigente (misma causa, menos de 14 días) de dueño/encargado.
-- No cambia estados ni dinero; los contadores crudos (`intents_in_review`, `intents_with_attention`) siguen mostrando todo.
--
-- Revertible byte a byte: docs/migrations/rollback/20261105020000_mobbex_attention_readers.rollback.sql (verificado por el runner).

create or replace function public.mobbex_pipeline_health() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object(
    'dead_letter_jobs', (select count(*) from public.mobbex_jobs where status = 'dead_letter'),
    'oldest_open_job_seconds', coalesce((select extract(epoch from (clock_timestamp() - min(next_attempt_at)))::integer
        from public.mobbex_jobs where status in ('pending', 'retry_wait') and next_attempt_at < clock_timestamp()), 0),
    'intents_in_review', (select count(*) from public.mobbex_payment_intents where internal_status = 'security_review_required'),
    'intents_with_attention', (select count(*) from public.mobbex_payment_intents where attention_reason is not null),
    'concerns_open', (select count(*) from public.mobbex_payment_intents pi where private.mobbex_concern_open(pi)),
    'paid_without_order', (select count(*) from public.mobbex_payment_intents where internal_status = 'approved_order_pending' and updated_at < clock_timestamp() - interval '10 minutes'),
    'open_intents', (select count(*) from public.mobbex_payment_intents where internal_status in ('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending')),
    'refunds_unresolved', (select count(*) from public.mobbex_refunds where status in ('requested', 'processing', 'ambiguous') and requested_at < clock_timestamp() - interval '1 hour'),
    'needs_attention', exists (select 1 from public.mobbex_jobs where status = 'dead_letter')
        or exists (select 1 from public.mobbex_payment_intents pi where private.mobbex_concern_open(pi))
        or exists (select 1 from public.mobbex_payment_intents where internal_status = 'approved_order_pending' and updated_at < clock_timestamp() - interval '10 minutes')
        or exists (select 1 from public.mobbex_refunds where status in ('requested', 'processing', 'ambiguous') and requested_at < clock_timestamp() - interval '1 hour'));
$$;

create or replace function public.list_mobbex_operational_alerts(p_business_id uuid)
returns table (
  severity text, alert_code text, subject_type text, subject_id uuid, correlation_id uuid,
  summary text, required_action text, evidence jsonb
)
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  select * from (
    select
      'CRITICAL'::text, 'MOBBEX_PAID_WITHOUT_ORDER'::text, 'service_health'::text,
      md5('mobbex_paid_without_order:' || p_business_id::text)::uuid, null::uuid,
      'Hay un cobro aprobado en Mobbex que todavía no generó pedido.'::text,
      'Abrí Cobros y reconciliá el pago; no cobres de nuevo. Si ya no hay stock, devolvé el dinero.'::text,
      jsonb_build_object('count', count(*), 'oldest_minutes', round(extract(epoch from (clock_timestamp() - min(pi.updated_at))) / 60)::integer)
    from public.mobbex_payment_intents pi
    where pi.business_id = p_business_id
      and pi.internal_status = 'approved_order_pending'
      and pi.updated_at < clock_timestamp() - interval '10 minutes'
    having count(*) > 0

    union all

    select
      'ACTION_REQUIRED', 'MOBBEX_PAYMENT_NEEDS_REVIEW', 'service_health',
      md5('mobbex_payment_needs_review:' || p_business_id::text)::uuid, null::uuid,
      'Hay un cobro de Mobbex que necesita revisión de una persona.',
      'Abrí Cobros, compará importe y referencia con el panel de Mobbex y reconciliá o devolvé el dinero.',
      jsonb_build_object('count', count(*),
        'reasons', (select coalesce(jsonb_agg(r.reason), '[]'::jsonb) from (
            select distinct left(coalesce(x.review_reason, x.attention_reason), 60) as reason
              from public.mobbex_payment_intents x
             where x.business_id = p_business_id
               and private.mobbex_concern_open(x)
             order by 1 limit 10) r))
    from public.mobbex_payment_intents pi
    where pi.business_id = p_business_id
      and private.mobbex_concern_open(pi)
    having count(*) > 0

    union all

    select
      'ACTION_REQUIRED', 'MOBBEX_RECONCILIATION_STUCK', 'service_health',
      md5('mobbex_reconciliation_stuck:' || p_business_id::text)::uuid, null::uuid,
      'La conciliación de cobros de Mobbex se quedó sin reintentos.',
      'Revisá las credenciales de Mobbex y que Mobbex responda; después pedí reencolar los trabajos agotados.',
      jsonb_build_object('count', count(*))
    from public.mobbex_jobs j
    join public.mobbex_payment_intents pi on pi.id = j.payment_intent_id
    where pi.business_id = p_business_id
      and j.status = 'dead_letter'
    having count(*) > 0

    union all

    select
      'ACTION_REQUIRED', 'MOBBEX_REFUND_UNRESOLVED', 'service_health',
      md5('mobbex_refund_unresolved:' || p_business_id::text)::uuid, null::uuid,
      'Hay una devolución de Mobbex sin confirmar hace más de una hora.',
      'No la repitas: buscá la operación en el panel de Mobbex y registrá el resultado que muestre (devuelta o no).',
      jsonb_build_object('count', count(*), 'oldest_minutes', round(extract(epoch from (clock_timestamp() - min(r.requested_at))) / 60)::integer)
    from public.mobbex_refunds r
    join public.mobbex_payment_intents pi on pi.id = r.payment_intent_id
    where pi.business_id = p_business_id
      and r.status in ('requested', 'processing', 'ambiguous')
      and r.requested_at < clock_timestamp() - interval '1 hour'
    having count(*) > 0
  ) findings
  where exists (
    select 1 from public.mobbex_business_settings s
     where s.business_id = p_business_id and s.health_alert_enabled
  );
$$;
