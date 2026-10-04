-- REVERSIÓN de 20261001190500_cancel_order_no_op_when_already_cancelled.sql
--
-- Devuelve `cancel_order` al cuerpo anterior (el de 20260814040000), tal como lo
-- imprime pg_get_functiondef.
--
-- Ojo con lo que vuelve: cancelar de nuevo un pedido ya cancelado, con otra clave,
-- vuelve a escribir un segundo motivo y un segundo recibo. Sólo usar para volver
-- atrás un despliegue.
--
-- No toca filas: eventos y recibos quedan como están.
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001190500
begin;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_expected_revision bigint, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$function$;

revoke all on function public.cancel_order(uuid, bigint, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, bigint, text, text) to authenticated;

commit;
