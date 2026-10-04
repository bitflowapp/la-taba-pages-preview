-- REVERSIÓN de 20261001191000_unattended_manual_orders_expire.sql
--
-- Quita el job `taba-unattended-order-expiry`, devuelve
-- `release_expired_stock_reservations` al cuerpo anterior (el de 20260918010000),
-- tal como lo imprime pg_get_functiondef, y retira
-- `expire_unattended_manual_orders`, `list_unattended_order_expiry_failures` y la
-- tabla `private.unattended_order_expiry_failures`.
--
-- Ojo con lo que vuelve:
--   · un pedido en efectivo sin atender vuelve a retener su stock sin límite de
--     tiempo, aunque el negocio tenga cargado `abandoned_order_minutes`;
--   · `release_expired_stock_reservations` vuelve a ser el código que nadie agenda
--     y que, si encontrara algo, lo dejaría en el estado viejo `canceled`. NO
--     agendarla.
-- Sólo usar para volver atrás un despliegue.
--
-- Se conserva todo lo ya escrito: los pedidos que vencieron siguen `cancelled`
-- con su stock devuelto, y sus eventos `order.expired_unattended` quedan como
-- historia. `businesses.abandoned_order_minutes` no se toca: el valor es del dueño.
--
-- Se pierde la memoria del barrido (`private.unattended_order_expiry_failures`): qué
-- pedidos no pudo cerrar y cuándo iba a reintentarlos. Es estado de trabajo, no
-- historia de ningún pedido, y el barrido la vuelve a armar sola si se reaplica la
-- migración. Si hay filas, conviene mirarlas antes: son pedidos que siguen
-- reteniendo stock.
--   select * from public.list_unattended_order_expiry_failures();
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001191000
begin;

do $unschedule$
begin
  perform cron.unschedule('taba-unattended-order-expiry');
exception
  when others then null;   -- el job ya no estaba
end
$unschedule$;

CREATE OR REPLACE FUNCTION public.release_expired_stock_reservations(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_count integer := 0;
begin
  for v_order in
    select *
      from public.orders
     where reservation_expires_at < clock_timestamp()
       and inventory_released_at is null
       and status in ('received', 'submitted')
     order by reservation_expires_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    update public.products p
       set stock = p.stock + oi.quantity::integer,
           available = p.merchant_available
                       and p.is_verified
                       and p.is_active
                       and (p.stock + oi.quantity::integer) > 0
                       and p.price_status = 'confirmed'
                       and p.price > 0
      from public.order_items oi
     where oi.order_id = v_order.id
       and oi.product_uuid = p.id;

    update public.orders
       set status = 'canceled',
           canceled_at = clock_timestamp(),
           inventory_released_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_order.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

comment on function public.release_expired_stock_reservations(integer) is
  'Trusted scheduled cleanup for expired stock reservations. Restores available only when merchant_available is true.';

revoke all on function public.release_expired_stock_reservations(integer) from public, anon, authenticated;

drop function public.expire_unattended_manual_orders(integer);
drop function public.list_unattended_order_expiry_failures();
drop table private.unattended_order_expiry_failures;

commit;
