-- TABA2 · Un pack también puede ser lo que se vende.
--
-- ## El defecto
--
-- El catálogo tiene una regla firme y buena: si un producto trae más de una
-- unidad, es el bulto con el que el local SE SURTE, no lo que le ofrece al
-- cliente. `publishRetailUnits` lo saca de la góndola y publica en su lugar una
-- unidad derivada, que nace sin precio a propósito —el precio de un pack no se
-- divide en doce sin que alguien decida el precio de la botella—.
--
-- Esa regla asume una tienda que vende botellas sueltas y compra packs. TABA
-- abre vendiendo packs: cuatro gaseosas, precio por pack, autorizado por escrito.
-- Con el modelo tal como estaba, la vitrina mostraba cuatro botellas sueltas sin
-- precio y ningún pack comprable. La tienda no podía vender lo que tenía.
--
-- No había forma de declarar la diferencia. `units_per_pack > 1` significaba dos
-- cosas a la vez —«trae doce» y «no se vende»— y sólo una de las dos es un hecho
-- del producto; la otra es una decisión comercial del local.
--
-- ## Lo que cambia
--
-- Se separan. `units_per_pack` sigue diciendo cuántas unidades trae, que es un
-- hecho y no se toca. `sold_as_pack` dice si ESE bulto es lo que el comercio
-- pone en góndola, que es una decisión y ahora se declara.
--
-- Un producto con `sold_as_pack = true` se vende entero, con su precio, y el
-- cliente ve en el nombre exactamente lo que se lleva. Uno con `false` —el valor
-- por omisión— se comporta igual que siempre: abastecimiento.
--
-- ## Lo que NO cambia
--
--   · el valor por omisión es `false`: ningún producto existente cambia de
--     comportamiento por esta migración;
--   · declarar un pack de una sola unidad no significa nada, y por eso se
--     rechaza: `sold_as_pack` sólo puede ser verdadero si de verdad hay bulto;
--   · las compuertas de precio, stock, verificación e imagen quedan intactas.
--
-- Forward-only. No toca 1..108.

alter table public.products
  add column if not exists sold_as_pack boolean not null default false;

comment on column public.products.sold_as_pack is
  'El bulto es lo que se vende, no con lo que el local se surte. Sólo puede ser verdadero cuando units_per_pack > 1: un «pack» de una unidad no es un pack.';

alter table public.products
  drop constraint if exists products_sold_as_pack_requires_pack;
alter table public.products
  add constraint products_sold_as_pack_requires_pack check (
    not sold_as_pack or units_per_pack > 1
  );
