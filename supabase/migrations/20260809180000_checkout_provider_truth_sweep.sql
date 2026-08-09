-- ============================================================================
--  El pago que nadie fue a buscar.
-- ============================================================================
--
--  MEDIDO el 2026-08-09 sobre base efimera con las 63 migraciones aplicadas
--  (supabase/tests/order_intake_dispatch_audit.local.sql, bloque C):
--
--    una sesion se va a Mercado Pago, el cliente paga alla y NO vuelve.
--    A los 15 minutos el barrido de expiracion libera el stock y la deja
--    `expired`. Estado de este lado, medido:
--
--      payment_intents.internal_status ....... expired
--      payment_intents.provider_payment_id ... NULL
--      trabajos de reconciliacion encolados .. 0
--      list_unfinalized_paid_checkouts ....... 0 filas
--      alertas operativas .................... 0
--
--    El dinero esta en Mercado Pago y de este lado NO HAY NADA que lo busque.
--    No es que la alerta este mal redactada: no existe el dato con el que
--    dispararla, porque nadie le pregunto nunca al proveedor.
--
--  POR QUE PASA
--  ------------
--  La unica via que finaliza un pago es que ALGUIEN traiga la novedad:
--    1. el webhook -> encola el outbox -> el worker lee el pago; pero en TEST
--       la notificacion de Checkout Pro viene firmada por la aplicacion de
--       prueba autoprovisionada, cuya clave el panel mantiene enmascarada, asi
--       que la firma no valida y el recibo nunca llega al outbox;
--    2. el cliente vuelve a la pantalla de estado -> mercadopago-checkout-status
--       le pregunta al proveedor. Si el cliente no vuelve, nadie pregunta.
--
--  Las dos son PASIVAS. Falta la tercera, activa, que es la que convierte esto
--  en un sistema que no depende de que el comprador colabore.
--
--  QUE HACE ESTA MIGRACION
--  -----------------------
--  Un barrido cada minuto encola una consulta al proveedor por cada checkout
--  que llego a Mercado Pago y todavia no es pedido. El worker ya existente la
--  resuelve por `external_reference` y la pasa por la MISMA verificacion de
--  siempre (`record_mercadopago_payment_snapshot`), asi que no se relaja ni una
--  sola assertion comercial: importe, moneda, referencia y collector se siguen
--  exigiendo igual.
--
--  Efecto secundario buscado: el pago aprobado se descubre mientras la reserva
--  TODAVIA ESTA VIVA, no cuando el comprador se acuerda de volver. Eso convierte
--  la carrera medida en el bloque D del mismo drill -pago aprobado antes de
--  vencer, avisado despues del barrido, que terminaba en revision manual- en un
--  pedido normal.
--
--  LIMITES DELIBERADOS
--  -------------------
--  * Solo sesiones que de verdad llegaron al proveedor (`preference_id` no nulo).
--  * Nunca antes de 90 segundos: el camino normal es el cliente volviendo.
--  * Nunca mas de una sonda activa por intent (indice unico parcial ya existente).
--  * Nunca mas de 8 sondas vacias por intent, y como maximo una cada 2 minutos:
--    un checkout abandonado deja de consultarse en vez de golpear al proveedor
--    para siempre.
--  * Solo las ultimas 24 horas.
--  * No toca `security_review_required`: ahi el dinero ya esta reconocido y lo
--    que falta es una decision humana, no otra pregunta al proveedor.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.enqueue_checkout_provider_probes(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_inserted integer;
begin
  with candidatos as (
    select pi.id, pi.provider_payment_id
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where cs.completed_order_id is null
       and pi.order_id is null
       -- El comprador llego a ver Mercado Pago: sin preferencia no hay nada que
       -- preguntar, porque nunca hubo donde pagar.
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and nullif(btrim(coalesce(pi.external_reference, '')), '') is not null
       and pi.internal_status not in (
         'completed', 'refunded', 'partially_refunded', 'charged_back',
         'security_review_required'
       )
       -- 48 horas, igual que la alerta CHECKOUT_PROVIDER_UNVERIFIED. Las dos
       -- ventanas tienen que coincidir: si la alerta abarcara mas que la sonda,
       -- habria checkouts marcados como «no sabemos» que nadie va a consultar.
       and cs.created_at > clock_timestamp() - interval '48 hours'
       and cs.created_at < clock_timestamp() - interval '90 seconds'
       and not exists (
         select 1 from public.payment_outbox po
          where po.payment_intent_id = pi.id
            and po.topic = 'payment_reconcile'
            and po.status in ('pending', 'claimed', 'processing', 'retry_wait')
       )
       and (
         select count(*) from public.payment_events pe
          where pe.payment_intent_id = pi.id
            and pe.event_type = 'payment.provider_probe_empty'
       ) < 8
       and not exists (
         select 1 from public.payment_events pe
          where pe.payment_intent_id = pi.id
            and pe.event_type = 'payment.provider_probe_empty'
            and pe.server_recorded_at > clock_timestamp() - interval '2 minutes'
       )
     order by cs.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  select c.id, 'payment_reconcile', c.provider_payment_id
    from candidatos c
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$$;

-- El worker llama a esto cuando el proveedor responde que no hay ningun pago
-- para esa referencia. Es la unica forma de que la sonda termine: sin la marca,
-- un checkout abandonado se consultaria para siempre.
create or replace function public.record_provider_probe_empty(p_payment_intent_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (
    p_payment_intent_id,
    'payment.provider_probe_empty',
    jsonb_build_object('source', 'provider_truth_sweep')
  );
end;
$$;

do $$
begin
  perform cron.schedule(
    'taba-checkout-provider-truth-sweep',
    '* * * * *',
    'select public.enqueue_checkout_provider_probes();'
  );
end;
$$;

-- ============================================================================
--  Que un cobro sin pedido no dependa de que el barrido funcione.
-- ============================================================================
--  Medido (bloque C10 del drill): un checkout que quedo en
--  `manual_review_required` por `approved_after_reservation_expired` -es decir,
--  dinero cobrado y ningun pedido- devolvia CERO filas en la funcion que existe
--  justamente para eso. El filtro exigia `internal_status in
--  ('approved_order_pending','approved')` y la revision manual lo mueve a
--  `security_review_required`, asi que el peor caso era el unico invisible.
create or replace function public.list_unfinalized_paid_checkouts()
returns table (
  severity text,
  checkout_session_id uuid,
  pipeline_state text,
  total numeric,
  stalled_for interval,
  action text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    case
      -- Dinero reconocido y sin pedido es critico desde el primer minuto: no
      -- se resuelve solo y hay una persona esperando algo que compro.
      when s.status = 'manual_review_required' then 'critical'
      when s.updated_at < clock_timestamp() - interval '15 minutes' then 'critical'
      else 'high'
    end,
    s.id,
    public.checkout_pipeline_state(s.status, s.expires_at),
    s.total,
    clock_timestamp() - s.updated_at,
    case
      when s.status = 'manual_review_required'
        then 'decide_refund_or_manual_fulfillment_the_money_is_already_in'
      else 'run_finalize_paid_checkout_session_or_inspect_payment_outbox'
    end
  from public.checkout_sessions s
  where s.completed_order_id is null
    and (
      s.status in ('payment_approved', 'finalizing_order')
      or exists (
        select 1
          from public.payment_intents pi
         where pi.checkout_session_id = s.id
           and pi.provider_status = 'approved'
           and pi.internal_status in ('approved_order_pending', 'approved')
      )
      -- El caso que faltaba: el proveedor confirmo el cobro y la finalizacion
      -- quedo bloqueada, sea por reserva vencida o por cualquier otra revision.
      or exists (
        select 1
          from public.payment_intents pi
         where pi.checkout_session_id = s.id
           and pi.provider_status = 'approved'
           and pi.internal_status = 'security_review_required'
      )
    )
    and (
      s.status = 'manual_review_required'
      or s.updated_at < clock_timestamp() - interval '3 minutes'
    )
  order by s.updated_at;
$$;

revoke all on function public.enqueue_checkout_provider_probes(integer) from public, anon, authenticated;
grant execute on function public.enqueue_checkout_provider_probes(integer) to service_role;
revoke all on function public.record_provider_probe_empty(uuid) from public, anon, authenticated;
grant execute on function public.record_provider_probe_empty(uuid) to service_role;
revoke all on function public.list_unfinalized_paid_checkouts() from public, anon, authenticated;
grant execute on function public.list_unfinalized_paid_checkouts() to service_role;

comment on function public.enqueue_checkout_provider_probes(integer) is
  'Encola una consulta al proveedor por cada checkout que llego a Mercado Pago y todavia no es pedido. Acotada: 90s de gracia, 8 sondas vacias, una cada 2 minutos, 24 horas.';
comment on function public.record_provider_probe_empty(uuid) is
  'Marca que el proveedor no tiene ningun pago para esa referencia. Es lo que hace terminar la sonda.';
comment on function public.list_unfinalized_paid_checkouts() is
  'Pagos verificados que no llegaron a pedido, incluida la revision manual: dinero cobrado sin operacion.';
