-- ============================================================================
--  De la revisión de seguridad no se salía. Ni siquiera devolviendo el dinero.
-- ============================================================================
--
--  MEDIDO, sobre una fila real en base efímera
--  (supabase/tests/security_review_dead_end_probe.local.sql):
--
--    security_review_required .. rango 150
--    refunded .................. rango 130   -> BLOQUEADO
--    partially_refunded ........ rango 120   -> BLOQUEADO
--    completed ................. rango 110   -> BLOQUEADO
--    approved_order_pending .... rango 105   -> BLOQUEADO
--
--  `security_review_required` es el rango más alto de la escala, y
--  `prevent_payment_intent_status_regression` rechaza todo destino menor. O sea:
--  es un estado ABSORBENTE. Un pago que entra ahí no sale nunca.
--
--  POR QUÉ IMPORTA TANTO
--  ---------------------
--  Ahí van a parar exactamente los cobros que entraron y no llegaron a pedido
--  -`approved_after_reservation_expired`, `finalization_without_active_reservation`-.
--  Y el Panel ofrece para ellos una sola salida: devolver el dinero.
--
--  Pero `record_payment_refund_response` termina con
--    update payment_intents set internal_status = 'refunded' ...
--  que es justo el UPDATE bloqueado. Consecuencia real: el reembolso SE EJECUTA
--  en Mercado Pago, la respuesta no se puede registrar de este lado, el trabajo
--  del outbox falla y reintenta hasta `dead_letter`, y la fila sigue diciendo
--  «revisión de seguridad» con la plata ya devuelta. La única salida que el
--  producto ofrecía no podía completarse.
--
--  Nadie lo había visto porque para llegar hay que combinar dos cosas poco
--  frecuentes: un cobro aprobado después de que venciera la reserva, y encima
--  intentar resolverlo.
--
--  QUÉ CAMBIA, Y QUÉ NO
--  --------------------
--  Una revisión ahora se puede RESOLVER hacia un conjunto explícito y cerrado:
--  completed, approved_order_pending, refunded, partially_refunded y
--  charged_back. Todo lo demás sigue bloqueado exactamente igual, y ninguna
--  otra regresión de la escala se habilita.
--
--  La automatización NO puede limpiar una revisión, que es lo que este guardián
--  protege: `record_mercadopago_payment_snapshot` elige su próximo estado con
--  `rank(nuevo) >= rank(viejo)`, y contra 150 ningún estado del proveedor gana.
--  Los únicos caminos que hacen estas transiciones son RPCs de owner/admin
--  -`recover_paid_checkout_order`- o la respuesta verificada de un reembolso que
--  un owner/admin pidió.
-- ============================================================================

create or replace function public.prevent_payment_intent_status_regression()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  -- Cómo se cierra una revisión de seguridad. Cerrado a propósito: cualquier
  -- destino fuera de esta lista sigue siendo una regresión.
  v_resoluciones constant text[] := array[
    'completed', 'approved_order_pending', 'refunded', 'partially_refunded', 'charged_back'
  ];
begin
  new.revision := old.revision;
  if new is distinct from old then
    if public.payment_internal_status_rank(new.internal_status)
       < public.payment_internal_status_rank(old.internal_status)
      and not (
        old.internal_status = 'security_review_required'
        and new.internal_status = any(v_resoluciones)
      ) then
      raise exception 'payment intent status regression: % -> %', old.internal_status, new.internal_status
        using errcode = '22023';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

comment on function public.prevent_payment_intent_status_regression() is
  'Impide que un pago retroceda de estado. Una revision de seguridad si se puede RESOLVER hacia completed, approved_order_pending, refunded, partially_refunded o charged_back; nada mas.';
