-- Lo que un pedido cobró no se reescribe: el importe y los renglones quedan fijos desde
-- que el pedido nace, para todos los roles.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   El importe de un pedido era inmutable sólo por permisos: `anon` y `authenticated`
--   no tienen UPDATE sobre `orders`, `order_items` ni `order_combos`. Para cualquier
--   otro camino —la clave de servicio, una migración, una función SECURITY DEFINER
--   nueva— no había nada. Con la clave de servicio, y confirmando cada paso:
--
--     · `update orders set subtotal = 1500, total = 1250` sobre un pedido de Mercado
--       Pago ya cobrado por 2250: aceptado, sin ningún evento;
--     · `update orders set currency_code = 'USD'`: aceptado, con el cobro en ARS;
--     · `update order_items set unit_price = 500, subtotal = 1000`: aceptado, con la
--       cabecera todavía en 2500;
--     · borrar el único renglón de un pedido cobrado, y cambiar y borrar su combo:
--       aceptado.
--
--   Los CHECK sólo miran la aritmética de cada fila. `orders.total` lo leen en vivo el
--   repartidor (lo que cobra en efectivo), la comandera, el POS y la confirmación del
--   pago manual: un total reescrito cambia lo que se cobra y lo que se imprime.
--
--   Ningún código vigente lo hace: se revisaron los cuerpos de todas las funciones
--   (25 sentencias UPDATE sobre `orders`, ninguna sobre una columna de dinero; ninguna
--   sobre `order_items` ni `order_combos`; ningún trigger que reasigne esas columnas).
--   Es defensa en profundidad contra el próximo script «para corregir un precio».
--
-- QUÉ QUEDA
--
--   · `orders`: no cambian `subtotal`, `discount_total`, `delivery_fee`, `total` ni
--     `currency_code` (tampoco de NULL a un valor: un pedido sin moneda se lee como
--     pesos y rotularlo después cambia lo que significa).
--   · `order_items`: no cambia nada, salvo `product_uuid` → NULL (es lo que hace la
--     clave foránea ON DELETE SET NULL cuando se borra el producto).
--   · `order_combos`: no cambia nada, salvo `combo_uuid` → NULL (ídem, al borrar la
--     definición del combo).
--   · Un renglón o un combo de un pedido no se borran mientras el pedido exista. El
--     borrado en cascada desde el pedido sigue funcionando.
--
--   Vale para todos los roles, incluidas las funciones SECURITY DEFINER y el dueño de
--   la base. No hay excepción para «la transacción que crea el pedido» porque no hace
--   falta: los dos caminos de alta (`create_order_with_items_core` y
--   `finalize_paid_checkout_session`) insertan los importes ya calculados, y las capas
--   que después actualizan el pedido recién creado sólo tocan dirección y punto de
--   entrega. Y una excepción por `xmin` sería un agujero: cualquier función que
--   primero cambie el estado y después el total, en la misma transacción, pasaría.
--
--   Una corrección legítima y excepcional (un error de carga que hay que arreglar con
--   el comercio) es un acto de plataforma: se hace en una migración que desactiva el
--   trigger de forma explícita, y queda en el historial.
--
-- QUÉ NO CAMBIA
--
--   · Los 25 UPDATE vigentes sobre `orders` (estado, repartidor, pago manual,
--     estimación, dirección, origen): ninguno toca una columna de dinero.
--   · Borrar un producto o la definición de un combo que ya se vendieron.
--   · Borrar un pedido (su cascada) y dar de baja a un cliente.
--   · Los privilegios de las tablas.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001224500_order_money_snapshot_immutable.rollback.sql

-- ── 1. La cabecera ──────────────────────────────────────────────────────────
create or replace function private.orders_money_snapshot_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'el importe de un pedido ya creado es inmutable'
    using errcode = '55000',
          detail = format('pedido %s: %s', old.id, concat_ws(', ',
            case when new.subtotal is distinct from old.subtotal then 'subtotal' end,
            case when new.discount_total is distinct from old.discount_total then 'discount_total' end,
            case when new.delivery_fee is distinct from old.delivery_fee then 'delivery_fee' end,
            case when new.total is distinct from old.total then 'total' end,
            case when new.currency_code is distinct from old.currency_code then 'currency_code' end)),
          hint = 'un pedido cobrado se corrige con una devolucion o una cancelacion, no reescribiendo su importe';
end;
$$;
revoke all on function private.orders_money_snapshot_immutable() from public, anon, authenticated;

-- Compara columnas en vez de usar `UPDATE OF`: así también frena un valor que otro
-- trigger BEFORE haya cambiado antes. Por eso el nombre lo ordena último.
drop trigger if exists orders_zzz_money_snapshot_immutable on public.orders;
create trigger orders_zzz_money_snapshot_immutable
  before update on public.orders
  for each row
  when (
    new.subtotal is distinct from old.subtotal
    or new.discount_total is distinct from old.discount_total
    or new.delivery_fee is distinct from old.delivery_fee
    or new.total is distinct from old.total
    or new.currency_code is distinct from old.currency_code
  )
  execute function private.orders_money_snapshot_immutable();

-- ── 2. Los renglones y los combos ───────────────────────────────────────────
-- Corre como su dueño y con el `search_path` fijado: el borrado mira si el pedido
-- sigue existiendo, y esa lectura no puede depender de quién borra (un rol sin
-- lectura sobre `orders`, o al que RLS le esconda la fila, no vería el pedido y el
-- resguardo se saltearía en silencio).
create or replace function private.order_lines_snapshot_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    -- La cascada desde el pedido llega acá con el pedido ya borrado.
    if exists (select 1 from public.orders o where o.id = old.order_id) then
      raise exception 'un renglon de un pedido no se borra mientras el pedido exista'
        using errcode = '55000',
              detail = format('%s %s del pedido %s', tg_table_name, old.id, old.order_id);
    end if;
    return old;
  end if;

  raise exception 'los renglones de un pedido ya creado son inmutables'
    using errcode = '55000',
          detail = format('%s %s del pedido %s', tg_table_name, old.id, old.order_id),
          hint = 'un pedido cobrado se corrige con una devolucion o una cancelacion, no reescribiendo sus renglones';
end;
$$;
revoke all on function private.order_lines_snapshot_immutable() from public, anon, authenticated;

drop trigger if exists order_items_snapshot_immutable on public.order_items;
create trigger order_items_snapshot_immutable
  before update on public.order_items
  for each row
  when (
    new.id is distinct from old.id
    or new.order_id is distinct from old.order_id
    or new.product_id is distinct from old.product_id
    or new.name is distinct from old.name
    or new.quantity is distinct from old.quantity
    or new.unit is distinct from old.unit
    or new.unit_price is distinct from old.unit_price
    or new.subtotal is distinct from old.subtotal
    or new.created_at is distinct from old.created_at
    -- Soltar el producto es la clave foránea; apuntar el renglón a OTRO producto
    -- cambia lo vendido (y a quién se le devolvería el stock).
    or (new.product_uuid is distinct from old.product_uuid and new.product_uuid is not null)
  )
  execute function private.order_lines_snapshot_immutable();

drop trigger if exists order_items_snapshot_no_delete on public.order_items;
create trigger order_items_snapshot_no_delete
  before delete on public.order_items
  for each row
  execute function private.order_lines_snapshot_immutable();

drop trigger if exists order_combos_snapshot_immutable on public.order_combos;
create trigger order_combos_snapshot_immutable
  before update on public.order_combos
  for each row
  when (
    new.id is distinct from old.id
    or new.order_id is distinct from old.order_id
    or new.combo_id is distinct from old.combo_id
    or new.name is distinct from old.name
    or new.quantity is distinct from old.quantity
    or new.discount_percentage is distinct from old.discount_percentage
    or new.list_price is distinct from old.list_price
    or new.promotional_price is distinct from old.promotional_price
    or new.discount_amount is distinct from old.discount_amount
    or new.combo_snapshot is distinct from old.combo_snapshot
    or new.created_at is distinct from old.created_at
    or (new.combo_uuid is distinct from old.combo_uuid and new.combo_uuid is not null)
  )
  execute function private.order_lines_snapshot_immutable();

drop trigger if exists order_combos_snapshot_no_delete on public.order_combos;
create trigger order_combos_snapshot_no_delete
  before delete on public.order_combos
  for each row
  execute function private.order_lines_snapshot_immutable();

comment on function private.orders_money_snapshot_immutable() is
  'El importe y la moneda de un pedido no cambian despues de creado, para ningun rol.';
comment on function private.order_lines_snapshot_immutable() is
  'Los renglones y los combos de un pedido no cambian ni se borran mientras el pedido exista. Solo se admite soltar el producto o el combo borrados (FK SET NULL) y la cascada desde el pedido.';
