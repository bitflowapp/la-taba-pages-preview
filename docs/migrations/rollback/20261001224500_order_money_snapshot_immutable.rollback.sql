-- Rollback de 20261001224500: retira los cinco triggers que hacen inmutable el
-- importe de un pedido y sus dos funciones.
--
-- Qué vuelve a quedar abierto: el importe, la moneda, los renglones y los combos de un
-- pedido ya creado vuelven a estar protegidos sólo por permisos (la clave de servicio,
-- una migración o una función SECURITY DEFINER pueden reescribirlos y borrarlos).
--
-- Qué NO hace: no toca filas ni privilegios. Ninguna función vigente dependía de
-- estos triggers.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001224500', 0)
);

drop trigger if exists orders_zzz_money_snapshot_immutable on public.orders;
drop trigger if exists order_items_snapshot_immutable on public.order_items;
drop trigger if exists order_items_snapshot_no_delete on public.order_items;
drop trigger if exists order_combos_snapshot_immutable on public.order_combos;
drop trigger if exists order_combos_snapshot_no_delete on public.order_combos;

drop function if exists private.orders_money_snapshot_immutable();
drop function if exists private.order_lines_snapshot_immutable();

commit;
