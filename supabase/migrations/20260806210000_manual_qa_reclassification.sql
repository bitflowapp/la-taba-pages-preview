-- Sacar un pedido de la operación real sin borrarlo.
--
-- La clasificación automática cubre el caso que se puede deducir del catálogo
-- (un fixture de prueba). No cubre el resto: una prueba hecha con productos
-- reales, un pedido de demostración frente a un cliente, una certificación del
-- circuito. Hasta ahora la única salida era cancelar el pedido -- que miente
-- sobre lo que pasó -- o borrarlo -- que destruye la evidencia.
--
-- Esta función es de una sola dirección. Nada puede devolver un pedido QA a la
-- operación real: si se pudiera, la marca no valdría nada.

create or replace function public.classify_order_as_qa(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor uuid := auth.uid();
begin
  if v_reason is null or char_length(v_reason) > 120 or v_reason !~ '^[a-z0-9_]+$' then
    raise exception 'motivo requerido en snake_case de hasta 120 caracteres' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  -- El service_role certifica sin sesión; una persona necesita rol del negocio.
  if v_actor is not null
     and not public.has_business_role(v_order.business_id, array['owner', 'admin']) then
    raise exception 'solo owner o admin pueden reclasificar un pedido' using errcode = '42501';
  end if;

  if v_order.origin = 'qa' then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_order.id,
      'public_code', v_order.public_code,
      'origin', 'qa',
      'origin_reason', v_order.origin_reason,
      'idempotent_no_op', true
    );
  end if;

  -- Sólo se toca la clasificación: estado, rider, stock y tiempos quedan como
  -- están, y `bump_order_revision` deja la revisión intacta para no invalidar
  -- la vista de quien esté operando.
  update public.orders
     set origin = 'qa',
         origin_reason = v_reason,
         origin_classified_at = clock_timestamp()
   where id = v_order.id;

  update public.notification_outbox n
     set state = 'processed',
         processed_at = coalesce(n.processed_at, clock_timestamp()),
         payload = n.payload || jsonb_build_object('suppressed', true, 'suppressed_reason', v_reason)
   where n.aggregate_id = v_order.id
     and n.event_type = 'new_order'
     and n.state = 'pending';

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_actor,
    case when v_actor is null then 'system' else 'business' end,
    case when v_actor is null then 'system' else 'business' end,
    'order.origin_classified',
    'order.origin_classified',
    'Pedido reclasificado como QA; se conserva como evidencia y sale de la operación real.',
    jsonb_build_object('origin', 'qa', 'origin_reason', v_reason, 'previous_origin', v_order.origin),
    jsonb_build_object('origin', 'qa', 'origin_reason', v_reason, 'previous_origin', v_order.origin)
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'public_code', v_order.public_code,
    'origin', 'qa',
    'origin_reason', v_reason,
    'idempotent_no_op', false
  );
end;
$$;

revoke all on function public.classify_order_as_qa(uuid, text) from public, anon;
grant execute on function public.classify_order_as_qa(uuid, text) to authenticated, service_role;

comment on function public.classify_order_as_qa(uuid, text) is
  'Reclasifica un pedido como QA sin borrarlo ni tocar su estado operativo. Una sola dirección.';
