-- Reversión de 20260815020000_rider_order_offers.sql
--
-- Saca el modelo de oferta y devuelve al Panel a la asignación directa.
--
-- QUÉ PASA CON LOS DATOS: `rider_order_offers` se BORRA, y con ella el
-- historial de qué se ofreció y quién rechazó qué. Ninguna oferta llegó nunca a
-- `public.orders`, así que ningún pedido queda inconsistente: los aceptados
-- siguen asignados y los pendientes vuelven a estar simplemente `ready` y sin
-- rider, que es donde estuvieron todo el tiempo.
--
-- Si el historial importa, exportarlo ANTES:
--   \copy (select * from public.rider_order_offers) to 'ofertas.csv' csv header
--
-- Aplicar ANTES de 20260815010000_*.rollback.sql.

drop function if exists public.publish_rider_location_fanout(
  double precision, double precision, double precision, double precision,
  double precision, timestamptz, text, boolean);
drop function if exists public.get_rider_delivery_board();
drop function if exists public.reject_rider_order_offer(uuid, bigint, text, text);
drop function if exists public.accept_rider_order_offer(uuid, bigint, text);
drop function if exists public.withdraw_rider_order_offer(uuid);
drop function if exists public.offer_order_to_rider(uuid, text, uuid, uuid);
drop function if exists public.list_rider_order_offers(uuid);
drop function if exists public.rider_offer_payload(uuid);

drop trigger if exists rider_order_offers_touch on public.rider_order_offers;
drop function if exists public.touch_rider_order_offer();
drop table if exists public.rider_order_offers;

-- `list_active_business_riders` vuelve a las dos columnas de 20260725100000.
drop function if exists public.list_active_business_riders(uuid);
create or replace function public.list_active_business_riders(p_business_id uuid)
returns table (
  rider_user_id uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if auth.uid() is null
    or p_business_id is null
    or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;
  return query
  select
    bm.user_id,
    left(coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      'Rider ' || upper(right(bm.user_id::text, 8))
    ), 80)
  from public.business_members bm
  left join auth.users u on u.id = bm.user_id
  where bm.business_id = p_business_id
    and bm.role = 'rider'
    and bm.is_active = true
  order by 2, bm.user_id
  limit 100;
end;
$$;

revoke execute on function public.list_active_business_riders(uuid) from public, anon, authenticated;
grant execute on function public.list_active_business_riders(uuid) to authenticated;

-- Los recibos vuelven al vocabulario de 20260802100000. Las filas de
-- accept_offer/reject_offer que hubiera se borran: son recibos de idempotencia
-- de operaciones que ya no existen, no estado de negocio.
delete from public.rider_delivery_operations where operation in ('accept_offer', 'reject_offer');

alter table public.rider_delivery_operations
  drop constraint if exists rider_delivery_operations_operation_check;
alter table public.rider_delivery_operations
  add constraint rider_delivery_operations_operation_check
  check (operation in ('claim', 'picked_up', 'start_route', 'arrived', 'confirm_code', 'report_issue'));

select pg_notify('pgrst', 'reload schema');
