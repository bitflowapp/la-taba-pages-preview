-- TABA · LA PANTALLA DEL PAGO NO SE ROMPE DESPUÉS DE RECUPERAR EL SEGUIMIENTO (TRACK-01)
--
-- QUÉ PASABA (reproducido por el paquete wp11 y confirmado por su revisión; PG17 local)
--
--   Un pedido de Mercado Pago con entrega a domicilio no tiene código de entrega hasta que el cliente recupera
--   el seguimiento: recover_order_tracking_access lo crea cifrado con el TOKEN NUEVO. checkout_session_customer_
--   payload (la respuesta de la pantalla de estado del pago) descifra todo código vigente del pedido con el ID DE
--   LA SESIÓN: clave equivocada, pgp_sym_decrypt lanza 39000 («Wrong key or corrupt data») y la respuesta ENTERA
--   falla. El cliente que recuperó su seguimiento deja de poder ver el estado de su pago.
--
-- QUÉ CAMBIA
--
--   La respuesta descifra con private.handoff_code_or_null: con la clave correcta, el código, como antes; con
--   otra clave (39000), null. Es lo mismo que la pantalla mostraba antes de la recuperación (null): el código
--   del pedido se sigue viendo por el seguimiento, con el token nuevo. Otros errores no se tragan.
--
-- QUÉ NO CAMBIA
--
--   Firma, lenguaje, SECURITY DEFINER, search_path y permisos de la respuesta (en Staging y CP:
--   {postgres, service_role}); el resto de su cuerpo, letra por letra. La función nueva es privada y ningún rol
--   de cliente la puede ejecutar.
--
-- Generada de la definición viva con un reemplazo que coincide una sola vez.
-- Prueba: supabase/tests/checkout_payload_survives_tracking_recovery_test.sql
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002063000_checkout_payload_survives_tracking_recovery.rollback.sql

create or replace function private.handoff_code_or_null(p_ciphertext bytea, p_key text)
returns text
language plpgsql
stable
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
begin
  if p_ciphertext is null or p_key is null then
    return null;
  end if;
  return pgp_sym_decrypt(p_ciphertext, p_key);
exception when sqlstate '39000' then
  -- La clave no es la de ese cifrado: recuperar el seguimiento vuelve a cifrar el código de entrega con
  -- el token nuevo (recover_order_tracking_access). El código se sigue viendo por el seguimiento; acá no.
  return null;
end
$function$;

revoke all on function private.handoff_code_or_null(bytea, text) from public, anon, authenticated, service_role;
comment on function private.handoff_code_or_null(bytea, text) is
  'Descifra el código de entrega con la clave dada; si la clave no es la del cifrado (39000) contesta null en vez de romper la respuesta que lo incluye (20261002063000).';

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
        select private.handoff_code_or_null(h.code_ciphertext, s.id::text)
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
