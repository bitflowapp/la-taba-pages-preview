-- Un pedido QA no suena en el Panel.
--
-- `enqueue_new_order_notification` corre AFTER INSERT sobre `orders`, y en ese
-- instante el pedido todavía no tiene items: la clasificación de origen depende
-- de los productos, así que el trigger de notificación no puede saber si el
-- pedido es QA. El resultado medido es que un E2E encolaba igual la campana de
-- "pedido nuevo" del negocio.
--
-- La corrección no borra el registro: lo cierra. El aviso queda en la bandeja
-- con `state = 'processed'` y el motivo en el payload, así que se puede auditar
-- que existió y por qué no se entregó. `notification_outbox` es una cola de
-- entrega, no la evidencia del pedido; la evidencia sigue intacta en `orders`,
-- `order_items` y `order_events`.

create or replace function public.classify_order_qa_origin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_promoted boolean := false;
begin
  if new.product_uuid is null or not public.product_is_qa_fixture(new.product_uuid) then
    return null;
  end if;

  update public.orders o
     set origin = 'qa',
         origin_reason = coalesce(o.origin_reason, 'qa_fixture_product'),
         origin_classified_at = coalesce(o.origin_classified_at, clock_timestamp())
   where o.id = new.order_id
     and o.origin <> 'qa';
  get diagnostics v_promoted = row_count;

  if not v_promoted then
    return null;
  end if;

  -- Misma transacción que la creación del pedido: el aviso se cierra antes de
  -- que ningún consumidor pueda tomarlo.
  update public.notification_outbox n
     set state = 'processed',
         processed_at = coalesce(n.processed_at, clock_timestamp()),
         payload = n.payload || jsonb_build_object(
           'suppressed', true,
           'suppressed_reason', 'qa_origin_order'
         )
   where n.aggregate_id = new.order_id
     and n.event_type = 'new_order'
     and n.state = 'pending';

  return null;
end;
$$;

-- Backfill: los avisos que quedaron pendientes de pedidos ya clasificados QA.
update public.notification_outbox n
   set state = 'processed',
       processed_at = coalesce(n.processed_at, clock_timestamp()),
       payload = n.payload || jsonb_build_object(
         'suppressed', true,
         'suppressed_reason', 'qa_origin_order'
       )
  from public.orders o
 where o.id = n.aggregate_id
   and n.event_type = 'new_order'
   and n.state = 'pending'
   and o.origin = 'qa';

comment on function public.classify_order_qa_origin() is
  'Promueve el pedido a origen QA por producto fixture y cierra su aviso de pedido nuevo.';
