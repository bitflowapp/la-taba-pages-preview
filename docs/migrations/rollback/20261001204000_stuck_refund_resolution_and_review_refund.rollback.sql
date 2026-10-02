-- REVERSIÓN de 20261001204000_stuck_refund_resolution_and_review_refund.sql
--
-- Devuelve `prepare_payment_refund_v2` a su cuerpo anterior, exacto, quita
-- `resolve_stuck_payment_refund` y las seis columnas que la migración agregó a
-- `payment_refunds` (`provider_attempts`, `last_provider_attempt_at`,
-- `resolution_mode`, `resolution_requested_at`, `resolution_requested_by`,
-- `provider_payment_id`).
--
-- Ojo con lo que vuelve a quedar abierto: un reembolso `requested` o `ambiguous`
-- sin identidad del proveedor vuelve a no tener salida, y un cobro aprobado que
-- está en revisión por otro motivo que los dos de siempre vuelve a no poder
-- reembolsarse desde el Panel.
--
-- Se niega a correr si alguna solicitud tiene un reintento o un destrabe anotado:
-- esas columnas son el registro de quién autorizó reenviar dinero y cuántas veces
-- se envió, y se perderían. Exportar antes `payment_refunds` (id y las seis
-- columnas) y recién entonces limpiarlas. Los eventos `payment.refund_retry_*` de
-- `payment_events` no se tocan. Una autorización pendiente de usar
-- (`resolution_mode` no nulo) queda sin efecto: ese reembolso vuelve a quedar
-- trabado.
--
-- `provider_payment_id` (contra qué pago del proveedor salió cada solicitud) se
-- pierde para todas las solicitudes posteriores a la migración y NO frena la
-- reversión: la llenan todas, así que frenar por ella la volvería inservible
-- justo cuando hace falta. Va en la misma exportación; la función que la usaba
-- se va con ella.
--
-- El cuerpo de abajo es el de `pg_get_functiondef` sobre la base anterior a la
-- migración: no se reescribió a mano.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001204000
begin;

do $guard$
declare
  v_used integer;
begin
  select count(*) into v_used
    from public.payment_refunds r
   where r.provider_attempts <> 1
      or r.last_provider_attempt_at is not null
      or r.resolution_mode is not null
      or r.resolution_requested_at is not null
      or r.resolution_requested_by is not null;
  if v_used > 0 then
    raise exception 'ROLLBACK_BLOCKED: % reembolso(s) tienen reintentos o destrabes anotados; exportar payment_refunds antes de revertir', v_used;
  end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.prepare_payment_refund_v2(p_payment_intent_id uuid, p_amount numeric, p_idempotency_key uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_remaining numeric(12, 2);
  v_amount numeric(12, 2);
  v_refundable_without_order boolean;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  v_refundable_without_order := v_intent.order_id is null
    and v_intent.internal_status = 'security_review_required'
    and v_intent.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation');
  if v_intent.provider_payment_id is null
    or (
      not v_refundable_without_order
      and (v_intent.order_id is null or v_intent.internal_status not in ('completed', 'partially_refunded'))
    )
    or (v_refundable_without_order is false and v_intent.internal_status not in ('completed', 'partially_refunded')) then
    raise exception 'pago no reembolsable en su estado actual' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.payment_disputes d
     where d.payment_intent_id = v_intent.id
       and d.dispute_type = 'chargeback'
       and d.resolved_at is null
  ) then
    raise exception 'reembolso bloqueado por contracargo abierto' using errcode = '55000';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then
      raise exception 'idempotency key pertenece a otro reembolso' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      -- A caller that sees an existing outbound request must never POST it
      -- again. This is what keeps the deployed legacy handler safe if the
      -- provider answered but its recorder call failed.
      'reconciliation_required', v_refund.status not in ('approved', 'rejected')
        or v_refund.provider_refund_id is not null
    );
  end if;
  -- Never replace an ambiguous outbound financial request with a new UUID.
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if found then
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', true
    );
  end if;
  v_remaining := coalesce(v_intent.paid_amount, v_intent.expected_amount) - v_intent.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe de reembolso invalido' using errcode = '22023';
  end if;
  insert into public.payment_refunds (
    payment_intent_id, order_id, idempotency_key, amount, requested_by, reason
  ) values (
    v_intent.id, v_intent.order_id, p_idempotency_key, v_amount, v_actor,
    nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  ) returning * into v_refund;
  return jsonb_build_object(
    'refund_id', v_refund.id,
    'provider_payment_id', v_intent.provider_payment_id,
    'amount', v_refund.amount,
    'idempotency_key', v_refund.idempotency_key,
    'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
    'idempotent', false
  );
end;
$function$;

revoke all on function public.prepare_payment_refund_v2(uuid, numeric, uuid, text) from public, anon;
grant execute on function public.prepare_payment_refund_v2(uuid, numeric, uuid, text) to authenticated;

drop function public.resolve_stuck_payment_refund(uuid);

alter table public.payment_refunds drop constraint payment_refunds_resolution_check;
alter table public.payment_refunds
  drop column provider_attempts,
  drop column last_provider_attempt_at,
  drop column resolution_mode,
  drop column resolution_requested_at,
  drop column resolution_requested_by,
  drop column provider_payment_id;

commit;
