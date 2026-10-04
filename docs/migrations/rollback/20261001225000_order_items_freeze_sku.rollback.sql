-- Rollback de 20261001225000: el renglón del pedido deja de congelar el SKU.
--
-- Qué vuelve a quedar abierto:
--   · el SKU de un pedido histórico vuelve a existir sólo en el catálogo: si el
--     producto cambia de SKU o se borra, el pedido viejo lo pierde.
--
-- Qué se pierde, sin vuelta atrás:
--   · la columna `order_items.sku` y lo que tenga guardado. Volver a aplicar la
--     migración la completa otra vez con el SKU que cada producto tenga ese día, no
--     con el de la venta.
--
-- No toca importes, renglones ni ningún otro resguardo.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001225000', 0)
);

drop trigger if exists order_items_sku_immutable on public.order_items;
drop trigger if exists order_items_freeze_sku on public.order_items;
drop function if exists private.order_items_freeze_sku();
alter table public.order_items drop column if exists sku;

commit;
