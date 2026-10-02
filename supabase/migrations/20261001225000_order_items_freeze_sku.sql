-- TABA · EL RENGLÓN DEL PEDIDO CONGELA EL SKU
--
-- QUÉ FALTABA (auditoría, PRICE-02; reproducido)
--
--   El pedido congela el nombre, la cantidad, el precio unitario, el subtotal, el
--   descuento, el envío, el total y la moneda: un cambio posterior del catálogo no
--   toca un pedido viejo (20261001224500 además lo impide para cualquier rol). El SKU
--   no. `order_items` guarda el id del producto, y quien necesitaba el SKU de un
--   pedido histórico lo leía EN VIVO del catálogo: si el producto cambiaba de SKU, el
--   pedido viejo pasaba a mostrar el nuevo; si el producto se borraba, lo perdía.
--
-- QUÉ CAMBIA
--
--   · `order_items.sku`: el SKU del producto en el momento en que nace el renglón. Lo
--     escribe un trigger al insertar, así vale para los dos caminos de alta (pedido en
--     efectivo y pedido que nace de un cobro de Mercado Pago) sin redefinir ninguna de
--     las dos funciones. En el pedido de Mercado Pago ese momento es la finalización:
--     entre la sesión y el cobro pasan como mucho los minutos que dura la sesión.
--   · Una vez escrito no cambia, para ningún rol (55000), igual que el resto del
--     renglón. Un renglón sin SKU tampoco lo recibe después.
--   · Lo leen los mismos roles que ya leen el renglón, con la misma política de filas:
--     `order_items` tiene permisos por columna y un `select *` de la tienda o del Panel
--     falla si una columna queda sin permiso.
--   · Los renglones que ya existen se completan con el SKU que el producto tiene HOY.
--     No es el del día de la venta —ese dato no se guardó nunca—; es el mejor
--     disponible, y desde acá queda fijo. Un renglón cuyo producto ya no existe queda
--     sin SKU. Es la única escritura de filas de esta migración.
--
-- QUÉ NO CAMBIA
--
--   Ninguna función. Los importes, los renglones y sus resguardos. `pos_list_orders` y
--   la evaluación fiscal siguen leyendo el SKU del catálogo: pasarlas a la columna
--   nueva es un cambio de esas funciones, que no son de este paquete.
--   Impuestos: el pedido no los congela porque hoy no los calcula; la política fiscal
--   de cada producto es una decisión del contador del comercio (OWNER-INPUT).
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001225000_order_items_freeze_sku.rollback.sql

alter table public.order_items add column if not exists sku text;

comment on column public.order_items.sku is
  'SKU del producto en el momento en que nacio el renglon. No se actualiza: es parte de la instantanea del pedido.';

create or replace function private.order_items_freeze_sku()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.product_uuid is not null then
    select p.sku into new.sku from public.products p where p.id = new.product_uuid;
  else
    new.sku := null;
  end if;
  return new;
end;
$$;

revoke all on function private.order_items_freeze_sku() from public, anon, authenticated, service_role;

comment on function private.order_items_freeze_sku() is
  'Al insertar un renglon copia el SKU vigente del producto. El valor que traiga el INSERT se ignora: el SKU sale del catalogo, no de quien inserta.';

drop trigger if exists order_items_freeze_sku on public.order_items;
create trigger order_items_freeze_sku
  before insert on public.order_items
  for each row
  execute function private.order_items_freeze_sku();

-- Los renglones anteriores a esta migración: el SKU que el producto tiene hoy. Va
-- antes del resguardo de abajo, que después no deja escribir la columna.
drop trigger if exists order_items_sku_immutable on public.order_items;
update public.order_items oi
   set sku = p.sku
  from public.products p
 where p.id = oi.product_uuid
   and oi.sku is null
   and p.sku is not null;

-- Compara columnas, no `UPDATE OF`: también frena un valor que otro trigger BEFORE
-- haya cambiado en el camino.
create trigger order_items_sku_immutable
  before update on public.order_items
  for each row
  when (new.sku is distinct from old.sku)
  execute function private.order_lines_snapshot_immutable();

grant select (sku) on table public.order_items to anon, authenticated;
