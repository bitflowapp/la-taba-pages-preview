-- Reversión de 20261002063000_checkout_payload_survives_tracking_recovery.sql
--
-- Devuelve la respuesta de la pantalla del pago a su definición anterior, letra por letra (vuelve a romper con
-- 39000 después de recuperar el seguimiento de un pedido de Mercado Pago con entrega), y borra la auxiliar.
-- No toca filas ni permisos. Se niega si otra migración redefinió la respuesta después (acepta el cuerpo que
-- dejó 20261002063000 o el anterior: correrla dos veces no falla).
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002063000', 0)
);

do $redefinition_guard$
declare
  v_actual text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_actual
    from pg_proc p where p.oid = to_regprocedure('public.checkout_session_customer_payload(uuid,uuid)');
  if v_actual is null or v_actual not in ('61ce172cfd16eaed99e48a03724518b2', '26b3e63039c546621108584d19059254') then
    raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002063000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', 'public.checkout_session_customer_payload(uuid,uuid)'
      using errcode = 'P0001';
  end if;
end
$redefinition_guard$;

CREATE OR REPLACE FUNCTION public.checkout_session_customer_payload(p_checkout_session_id uuid, p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'checkout_session_id', s.id,
    'status', s.status,
    'expires_at', s.expires_at,
    'currency', s.currency,
    'subtotal', s.subtotal,
    'discount_total', s.discount_total,
    'delivery_fee', s.delivery_fee,
    'total', s.total,
    'fulfillment_type', s.fulfillment_type,
    'payment_intent_id', pi.id,
    'payment_status', pi.internal_status,
    'provider_status', pi.provider_status,
    'provider_status_detail', pi.provider_status_detail,
    'latest_payment_attempt_status', (
      select pa.status
        from public.payment_attempts pa
       where pa.payment_intent_id = pi.id
         and pa.attempt_type = 'preference'
       order by pa.attempt_number desc
       limit 1
    ),
    'latest_payment_attempt_number', (
      select pa.attempt_number
        from public.payment_attempts pa
       where pa.payment_intent_id = pi.id
         and pa.attempt_type = 'preference'
       order by pa.attempt_number desc
       limit 1
    ),
    'order_id', s.completed_order_id,
    'order_public_code', o.public_code,
    'manual_review_required', s.status = 'manual_review_required',
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', si.product_id,
          'name', si.product_snapshot ->> 'name',
          'presentation', si.product_snapshot ->> 'presentation',
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'subtotal', si.subtotal
        ) order by si.created_at, si.id
      )
      from public.checkout_session_items si
      where si.checkout_session_id = s.id
    ), '[]'::jsonb),
    'delivery_code', case
      when s.completed_order_id is not null and s.fulfillment_type = 'delivery' then (
        select pgp_sym_decrypt(h.code_ciphertext, s.id::text)
          from public.order_delivery_handoffs h
         where h.order_id = s.completed_order_id
           and h.confirmed_at is null
           and h.expires_at > clock_timestamp()
      )
      else null
    end
  )
  from public.checkout_sessions s
  join public.payment_intents pi on pi.checkout_session_id = s.id
  left join public.orders o on o.id = s.completed_order_id
  where s.id = p_checkout_session_id
    and s.customer_id = p_customer_id;
$function$;

revoke all on function public.checkout_session_customer_payload(uuid,uuid) from public, anon, authenticated;

drop function if exists private.handoff_code_or_null(bytea, text);

commit;
