-- El aislamiento QA también en el claim canónico del Rider.
--
-- 20260806160000 puso el guard en `claim_available_rider_order`, que es la
-- sobrecarga legacy: 20260802102000 le revocó el execute justo para que nadie
-- la llame. El contrato vivo es `claim_delivery_order`, y ahí el guard faltaba.
-- Sin esto, un rider que conociera el código público podía tomar un pedido de
-- prueba aunque la cola nunca se lo hubiera ofrecido.
--
-- Devuelve `not_available`, el mismo código que un pedido inexistente: para el
-- reparto, un pedido QA no está disponible, y el rider no necesita saber más.

create or replace function public.claim_delivery_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
  v_fingerprint bytea;
begin
  perform public.rider_require_active_membership(p_business_id);
  if p_expected_revision is null or p_expected_revision < 1 or btrim(coalesce(p_public_code, '')) = '' then
    raise exception 'claim invalido' using errcode = '22023';
  end if;
  select o.* into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;
  if v_order.origin <> 'production' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid()
     and operation = 'claim' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if exists (
    select 1 from public.orders active
    where active.assigned_rider_user_id = auth.uid()
      and active.id <> v_order.id
      and active.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_delivery_exists');
  end if;
  if v_order.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision);
  end if;
  if v_order.delivery_mode <> 'delivery' or v_order.status <> 'ready' or v_order.assigned_rider_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id;
  v_result := jsonb_build_object(
    'ok', true,
    'outcome', 'claimed',
    'idempotent_no_op', false,
    'order', public.rider_active_delivery_payload(v_order.id)
  );
  v_fingerprint := digest(jsonb_build_object('public_code', v_order.public_code, 'revision', p_expected_revision)::text, 'sha256');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'claim', v_key, v_fingerprint, v_result);
  return v_result;
end;
$function$;

comment on function public.claim_delivery_order(uuid, text, bigint, text) is
  'Claim idempotente canónico del Rider; sólo despacha pedidos de operación real.';
