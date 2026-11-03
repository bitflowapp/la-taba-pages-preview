-- Alerta de salud de Mobbex en el panel operativo — APAGADA hasta que alguien la habilite por comercio.
--
-- Qué hace: cuando un comercio tiene `health_alert_enabled = true`, el panel de alertas operativas existente
-- (`refresh_operational_alerts` → `reconcile_operational_alerts_for_business`, y su evaluación autónoma cada minuto)
-- muestra tres alertas de Mobbex, con el mismo ciclo de vida que las demás (abierta → reconocida → resuelta, y se resuelve
-- sola cuando la condición desaparece):
--
--   MOBBEX_PAID_WITHOUT_ORDER       CRITICAL         cobro aprobado, sin pedido, hace más de 10 minutos
--   MOBBEX_PAYMENT_NEEDS_REVIEW     ACTION_REQUIRED  cobro en revisión de seguridad o con motivo de atención
--   MOBBEX_RECONCILIATION_STUCK     ACTION_REQUIRED  trabajos de conciliación agotados (dead_letter)
--
-- Misma definición de «hay que intervenir» que `mobbex_pipeline_health()`, pero acotada al comercio.
--
-- Por qué es seguro dejarla puesta:
--   * apagada por defecto y por comercio: con el flag en false el lister devuelve CERO filas, así que la función
--     `reconcile_operational_alerts_for_business` se comporta exactamente igual que antes;
--   * es aditiva: una columna nueva en la tabla de ajustes de Mobbex, dos funciones nuevas y UN reemplazo guardado de
--     `reconcile_operational_alerts_for_business` (se deriva de la definición vigente con `pg_get_functiondef`; si el
--     ancla no es única o ya está conectada, la migración aborta en vez de adivinar), igual que la migración base deriva
--     `create_mobbex_checkout_session`;
--   * la evidencia lleva sólo conteos y códigos internos de motivo: nunca importes de otras personas, credenciales ni datos de contacto;
--   * revertible: docs/migrations/rollback/20261103020000_mobbex_operational_alert.rollback.sql deja la función idéntica
--     byte a byte a la anterior (verificado por scripts/mobbex/run-mobbex-db-tests.mjs).
--
-- Nada de esto despliega ni programa nada por sí mismo.

alter table public.mobbex_business_settings
  add column health_alert_enabled boolean not null default false;

comment on column public.mobbex_business_settings.health_alert_enabled is
  'Muestra las alertas de Mobbex en el panel operativo. Apagada por defecto: se habilita con set_mobbex_health_alert.';

create function public.set_mobbex_health_alert(p_business_id uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_enabled is null then raise exception 'p_enabled requerido' using errcode = '22023'; end if;
  update public.mobbex_business_settings
     set health_alert_enabled = p_enabled, changed_by = 'set_mobbex_health_alert', updated_at = clock_timestamp()
   where business_id = p_business_id;
  if not found then raise exception 'comercio sin configuracion de Mobbex' using errcode = 'P0002'; end if;
  return jsonb_build_object('business_id', p_business_id, 'health_alert_enabled', p_enabled);
end $$;

-- Mismas columnas, en el mismo orden, que los hallazgos de reconcile_operational_alerts_for_business.
create function public.list_mobbex_operational_alerts(p_business_id uuid)
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
               and (x.internal_status = 'security_review_required' or x.attention_reason is not null)
             order by 1 limit 10) r))
    from public.mobbex_payment_intents pi
    where pi.business_id = p_business_id
      and (pi.internal_status = 'security_review_required' or pi.attention_reason is not null)
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
  ) findings
  where exists (
    select 1 from public.mobbex_business_settings s
     where s.business_id = p_business_id and s.health_alert_enabled
  );
$$;

revoke all on function public.set_mobbex_health_alert(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_mobbex_health_alert(uuid, boolean) to service_role;
revoke all on function public.list_mobbex_operational_alerts(uuid) from public, anon, authenticated;
grant execute on function public.list_mobbex_operational_alerts(uuid) to service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────
-- Conectar el lister a la reconciliación de alertas existente (derivado de la definición vigente)
-- ───────────────────────────────────────────────────────────────────────────────────────────

do $wire$
declare
  v_def text;
  v_new text;
  v_anchor constant text := ') findings';
  v_snippet constant text := E'union all select * from public.list_mobbex_operational_alerts(p_business_id)\n    ';
begin
  v_def := pg_get_functiondef('public.reconcile_operational_alerts_for_business(uuid)'::regprocedure);
  if strpos(v_def, 'list_mobbex_operational_alerts') > 0 then raise exception 'MOBBEX_ALERT_ALREADY_WIRED'; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) then
    raise exception 'MOBBEX_ALERT_ANCHOR_NOT_UNIQUE';
  end if;
  v_new := replace(v_def, v_anchor, v_snippet || v_anchor);
  if v_new = v_def or strpos(v_new, 'list_mobbex_operational_alerts') = 0 then raise exception 'MOBBEX_ALERT_WIRING_FAILED'; end if;
  execute v_new;
end $wire$;
