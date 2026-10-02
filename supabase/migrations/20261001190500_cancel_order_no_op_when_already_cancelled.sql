-- Cancelar un pedido que ya está cancelado no escribe un segundo motivo.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 en una base PG17 local con las
-- migraciones anteriores)
--
--   Un operador cancela el pedido con motivo «pedido de prueba». Otro operador
--   —o el mismo, con otra pestaña— vuelve a llamar `cancel_order` con la revisión
--   vigente, una clave de idempotencia nueva y el motivo «otro motivo distinto»:
--
--     respuesta           éxito, status cancelled
--     order_events        2 filas `business_cancel_reason`
--                         («pedido de prueba» / «otro motivo distinto»)
--     command receipts    2 recibos `cancel_order`
--
--   `transition_order` ya respondía bien: el pedido está en el estado pedido, es un
--   no-op (`idempotent_no_op: true`), sin evento de estado y sin avanzar la
--   revisión. Pero `cancel_order` escribía el motivo y el recibo SIN mirar esa
--   respuesta. El historial quedaba con dos motivos de cancelación que se
--   contradicen, y el segundo no canceló nada.
--
-- QUÉ CAMBIA
--
--   Cuando la transición vuelve como no-op, `cancel_order` devuelve el estado
--   actual con `idempotent_no_op: true` y no escribe ni el evento del motivo ni el
--   recibo. El motivo que vale es el de quien canceló.
--
-- QUÉ NO CAMBIA
--
--   · La primera cancelación: mismo evento, mismo recibo, misma respuesta.
--   · El reintento con la MISMA clave: devuelve el recibo guardado
--     (`idempotent_replay: true`), como antes.
--   · Una revisión vieja sigue dando PT409; un pedido cobrado por Mercado Pago sin
--     reembolso sigue dando 55000; un rol que no es del comercio, 42501.
--   · Firma, SECURITY DEFINER, search_path y permisos: los operadores autenticados
--     la siguen ejecutando; anon no.
--
-- Forward-only. No toca filas: los motivos duplicados que ya existan quedan como
-- historia.
-- Reversión: docs/migrations/rollback/20261001190500_cancel_order_no_op_when_already_cancelled.rollback.sql

create or replace function public.cancel_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $cancel$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  if lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'
     or exists (
       select 1 from public.payment_intents pi
        where pi.order_id = v_order.id
          and pi.internal_status in (
            'approved', 'approved_order_pending', 'completed',
            'partially_refunded', 'refunded', 'security_review_required'
          )
     ) then
    if not public.order_payment_is_financially_reversed(v_order.id) then
    raise exception 'pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar'
      using errcode = '55000';
    end if;
  end if;

  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  -- Ya estaba cancelado: esta llamada no canceló nada, así que no deja motivo ni
  -- recibo. El motivo que queda en el historial es el de quien sí canceló.
  if coalesce((v_result ->> 'idempotent_no_op')::boolean, false) then
    return v_result || jsonb_build_object('idempotent_replay', false);
  end if;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$cancel$;

revoke all on function public.cancel_order(uuid, bigint, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, bigint, text, text) to authenticated;
