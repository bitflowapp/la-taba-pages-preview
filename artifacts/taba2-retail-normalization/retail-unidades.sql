-- Unidades minoristas Coca-Cola-system · 4 SKU nuevos + 4 codigos de barras
-- Generado por scripts/retail-unidades-plan.mjs desde catalog/retail-unidades.mjs.
-- No editar a mano: se regenera.
--
-- Una sola transaccion. INSERT liso (NUNCA on conflict do update): si alguna
-- de las 4 filas ya existe, la transaccion entera aborta y no escribe nada.
-- No toca ninguna fila existente de products ni de product_barcodes.
-- verified_by / created_by = 61f238ad-fc2b-446a-9f17-257f4622cd86

begin;

do $retail$
begin
  if not exists (select 1 from public.businesses where id = '00000000-0000-4000-8000-000000000001') then
    raise exception 'El negocio 00000000-0000-4000-8000-000000000001 no existe en este proyecto.';
  end if;
  if exists (
    select 1 from public.products
     where business_id = '00000000-0000-4000-8000-000000000001' and external_id in ('coca-cola-original-pet-500ml','coca-cola-zero-pet-500ml','sprite-pet-500ml','fanta-naranja-pet-1500ml')
  ) then
    raise exception 'al menos uno de los % SKU minoristas ya existe. Abortado antes de escribir.', 4;
  end if;
  if exists (
    select 1 from public.product_barcodes
     where business_id = '00000000-0000-4000-8000-000000000001' and gtin in ('7790895000782','7790895067532','7790895000829','7790895000454')
  ) then
    raise exception 'al menos uno de los % GTIN ya esta registrado para este negocio. Abortado antes de escribir.', 4;
  end if;
end
$retail$;

with nuevos as (
  insert into public.products (
    business_id, external_id, sku, brand, name,
    description, category, subcategory, variant, presentation,
    capacity_value, capacity_unit, capacity, packaging_type, units_per_pack, sold_as_pack,
    price, price_status, stock, chilled, is_alcoholic, minimum_age, sort_order, tags, catalog_origin, is_active,
    is_verified, verified_at, verified_by, available, updated_at
  )
  values
  ('00000000-0000-4000-8000-000000000001', 'coca-cola-original-pet-500ml', 'coca-cola-original-pet-500ml', 'Coca-Cola', 'Coca-Cola Original',
   'Coca-Cola Original en botella PET de 500 ml.', 'Gaseosas', 'Cola', '500 ml', '500 ml',
   500, 'ml', '500 ml', 'Botella PET', 1, false,
   2290, 'confirmed', 0, false, false, null, 0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'coca-cola-zero-pet-500ml', 'coca-cola-zero-pet-500ml', 'Coca-Cola', 'Coca-Cola Zero',
   'Coca-Cola Zero en botella PET de 500 ml.', 'Gaseosas', 'Cola sin azúcar', '500 ml', '500 ml',
   500, 'ml', '500 ml', 'Botella PET', 1, false,
   2290, 'confirmed', 0, false, false, null, 0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'sprite-pet-500ml', 'sprite-pet-500ml', 'Sprite', 'Sprite',
   'Sprite en botella PET de 500 ml.', 'Gaseosas', 'Lima limón', '500 ml', '500 ml',
   500, 'ml', '500 ml', 'Botella PET', 1, false,
   2290, 'confirmed', 0, false, false, null, 0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'fanta-naranja-pet-1500ml', 'fanta-naranja-pet-1500ml', 'Fanta', 'Fanta Naranja',
   'Fanta Naranja en botella PET de 1,5 L.', 'Gaseosas', 'Naranja', '1,5 L', '1,5 L',
   1500, 'ml', '1500 ml', 'Botella PET', 1, false,
   4990, 'confirmed', 0, false, false, null, 0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now())
  returning id, external_id
),
codigos (external_id, gtin, gtin_type) as (
  values
  ('coca-cola-original-pet-500ml', '7790895000782', 'EAN-13'),
  ('coca-cola-zero-pet-500ml', '7790895067532', 'EAN-13'),
  ('sprite-pet-500ml', '7790895000829', 'EAN-13'),
  ('fanta-naranja-pet-1500ml', '7790895000454', 'EAN-13')
)
insert into public.product_barcodes (
  business_id, product_id, gtin, barcode_type, package_type, unit_factor,
  is_primary, is_active, source, verified_at, created_by
)
select '00000000-0000-4000-8000-000000000001', n.id, c.gtin, c.gtin_type, 'unit', 1,
       true, true, 'manual', now(), '61f238ad-fc2b-446a-9f17-257f4622cd86'
  from nuevos n join codigos c on c.external_id = n.external_id;

commit;

-- Relectura: lo que quedo escrito, no lo que se pidio escribir.
select p.external_id, p.name, p.presentation, p.price, p.stock, p.available, p.is_verified,
       p.sold_as_pack, p.sort_order, b.gtin, b.barcode_type
  from public.products p
  join public.product_barcodes b on b.product_id = p.id
 where p.business_id = '00000000-0000-4000-8000-000000000001' and p.external_id in ('coca-cola-original-pet-500ml','coca-cola-zero-pet-500ml','sprite-pet-500ml','fanta-naranja-pet-1500ml')
 order by p.external_id;
