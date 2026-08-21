-- Góndola comercial final · 12 altas nuevas + 12 códigos de barras
-- Generado por scripts/gondola-retail-final-plan.mjs desde
-- catalog/gondola-retail-final-proposal.mjs. No editar a mano: se regenera.
--
-- Una sola transacción: o entran las 12 o no entra ninguna.
-- INSERT liso (NUNCA on conflict do update): si algún SKU o GTIN ya existe,
-- la transacción entera aborta y no escribe nada. No toca ninguna fila
-- existente de products ni de product_barcodes, no toca orders/order_items.
--
-- Las 12 nacen: stock = 0, available = false, sin packshot (fallback propio
-- de TABA). Se habilitan con un UPDATE aparte el día de la Recepción real.
--
-- verified_by / created_by = 61f238ad-fc2b-446a-9f17-257f4622cd86

begin;

do $altas$
begin
  if not exists (select 1 from public.businesses where id = '00000000-0000-4000-8000-000000000001') then
    raise exception 'El negocio 00000000-0000-4000-8000-000000000001 no existe en este proyecto.';
  end if;
  if exists (
    select 1 from public.businesses
     where id = '00000000-0000-4000-8000-000000000001' and alcohol_sales_enabled is true
  ) then
    raise exception 'alcohol_sales_enabled cambió a true: este lote asume que sigue en false y no vuelve a decidirlo acá. Revisar antes de aplicar.';
  end if;
  if exists (
    select 1 from public.products
     where business_id = '00000000-0000-4000-8000-000000000001' and external_id in ('coca-cola-original-pet-1500ml','coca-cola-zero-pet-1500ml','sprite-original-pet-1500ml','sprite-zero-pet-1500ml','villa-del-sur-sin-gas-pet-2250ml','villavicencio-con-gas-pet-1500ml','cepita-naranja-pet-1500ml','cepita-durazno-pet-1500ml','brahma-chopp-lata-473ml-pack-6','budweiser-lata-473ml-pack-6','stella-artois-lata-473ml-pack-6','andes-origen-rubia-lata-473ml-pack-6')
  ) then
    raise exception 'al menos uno de los % SKU de la góndola final ya existe. Abortado antes de escribir.', 12;
  end if;
  if exists (
    select 1 from public.product_barcodes
     where business_id = '00000000-0000-4000-8000-000000000001' and gtin in ('7790895000430','7790895067556','7790895000447','7790895064173','7798062547559','7799155000210','7790895641800','7790895641534','7792798005970','7793147118846','7792798010592','7792798001712')
  ) then
    raise exception 'al menos uno de los % GTIN ya está registrado para este negocio. Abortado antes de escribir.', 12;
  end if;
end
$altas$;

with nuevos as (
  insert into public.products (
    business_id, external_id, sku, brand, name,
    description, category, subcategory, variant, presentation,
    capacity_value, capacity_unit, capacity, packaging_type, units_per_pack, sold_as_pack,
    price, price_status, stock, chilled, is_alcoholic, minimum_age,
    sort_order, tags, catalog_origin, is_active,
    is_verified, verified_at, verified_by, available, updated_at
  )
  values
  ('00000000-0000-4000-8000-000000000001', 'coca-cola-original-pet-1500ml', 'coca-cola-original-pet-1500ml', 'Coca-Cola', 'Coca-Cola Original',
   'Coca-Cola Original en botella pet de 1,5 L.', 'Gaseosas', 'cola', 'Original', 'Original',
   1500, 'ml', '1500 ml', 'botella-pet', 1, false,
   4990, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'coca-cola-zero-pet-1500ml', 'coca-cola-zero-pet-1500ml', 'Coca-Cola', 'Coca-Cola Zero',
   'Coca-Cola Zero en botella pet de 1,5 L.', 'Gaseosas', 'cola-sin-azucar', 'Sin azúcar', 'Sin azúcar',
   1500, 'ml', '1500 ml', 'botella-pet', 1, false,
   4990, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'sprite-original-pet-1500ml', 'sprite-original-pet-1500ml', 'Sprite', 'Sprite',
   'Sprite en botella pet de 1,5 L.', 'Gaseosas', 'lima-limon', 'Original', 'Original',
   1500, 'ml', '1500 ml', 'botella-pet', 1, false,
   4990, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'sprite-zero-pet-1500ml', 'sprite-zero-pet-1500ml', 'Sprite', 'Sprite Zero',
   'Sprite Zero en botella pet de 1,5 L.', 'Gaseosas', 'lima-limon-sin-azucar', 'Sin azúcar', 'Sin azúcar',
   1500, 'ml', '1500 ml', 'botella-pet', 1, false,
   4990, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'villa-del-sur-sin-gas-pet-2250ml', 'villa-del-sur-sin-gas-pet-2250ml', 'Villa del Sur', 'Villa del Sur',
   'Villa del Sur en botella pet de 2,25 L.', 'Aguas', 'sin-gas', 'Sin gas', 'Sin gas',
   2250, 'ml', '2250 ml', 'botella-pet', 1, false,
   2890, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'villavicencio-con-gas-pet-1500ml', 'villavicencio-con-gas-pet-1500ml', 'Villavicencio', 'Villavicencio',
   'Villavicencio en botella pet de 1,5 L.', 'Aguas', 'con-gas', 'Con gas', 'Con gas',
   1500, 'ml', '1500 ml', 'botella-pet', 1, false,
   3490, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'cepita-naranja-pet-1500ml', 'cepita-naranja-pet-1500ml', 'Cepita', 'Cepita Naranja',
   'Cepita Naranja en botella pet de 1,5 L.', 'Jugos', 'naranja', 'Naranja', 'Naranja',
   1500, 'ml', '1500 ml', 'botella-pet', 1, false,
   4490, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'cepita-durazno-pet-1500ml', 'cepita-durazno-pet-1500ml', 'Cepita', 'Cepita Durazno',
   'Cepita Durazno en botella pet de 1,5 L.', 'Jugos', 'durazno', 'Durazno', 'Durazno',
   1500, 'ml', '1500 ml', 'botella-pet', 1, false,
   4490, 'confirmed', 0, false, false, null,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'brahma-chopp-lata-473ml-pack-6', 'brahma-chopp-lata-473ml-pack-6', 'Brahma', 'Brahma Chopp',
   'Brahma Chopp en lata de 473 ml, pack x6.', 'Cervezas', 'rubia', 'Rubia', 'Rubia',
   473, 'ml', '473 ml', 'lata', 6, true,
   14990, 'confirmed', 0, false, true, 18,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'budweiser-lata-473ml-pack-6', 'budweiser-lata-473ml-pack-6', 'Budweiser', 'Budweiser',
   'Budweiser en lata de 473 ml, pack x6.', 'Cervezas', 'lager', 'Lager', 'Lager',
   473, 'ml', '473 ml', 'lata', 6, true,
   19990, 'confirmed', 0, false, true, 18,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'stella-artois-lata-473ml-pack-6', 'stella-artois-lata-473ml-pack-6', 'Stella Artois', 'Stella Artois',
   'Stella Artois en lata de 473 ml, pack x6.', 'Cervezas', 'lager', 'Lager', 'Lager',
   473, 'ml', '473 ml', 'lata', 6, true,
   29490, 'confirmed', 0, false, true, 18,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now()),
  ('00000000-0000-4000-8000-000000000001', 'andes-origen-rubia-lata-473ml-pack-6', 'andes-origen-rubia-lata-473ml-pack-6', 'Andes Origen', 'Andes Origen Rubia',
   'Andes Origen Rubia en lata de 473 ml, pack x6.', 'Cervezas', 'rubia', 'Rubia', 'Rubia',
   473, 'ml', '473 ml', 'lata', 6, true,
   23390, 'confirmed', 0, false, true, 18,
   0, array[]::text[], 'commercial', true,
   true, now(), '61f238ad-fc2b-446a-9f17-257f4622cd86', false, now())
  returning id, external_id
),
codigos (external_id, gtin, gtin_type) as (
  values
  ('coca-cola-original-pet-1500ml', '7790895000430', 'EAN-13'),
  ('coca-cola-zero-pet-1500ml', '7790895067556', 'EAN-13'),
  ('sprite-original-pet-1500ml', '7790895000447', 'EAN-13'),
  ('sprite-zero-pet-1500ml', '7790895064173', 'EAN-13'),
  ('villa-del-sur-sin-gas-pet-2250ml', '7798062547559', 'EAN-13'),
  ('villavicencio-con-gas-pet-1500ml', '7799155000210', 'EAN-13'),
  ('cepita-naranja-pet-1500ml', '7790895641800', 'EAN-13'),
  ('cepita-durazno-pet-1500ml', '7790895641534', 'EAN-13'),
  ('brahma-chopp-lata-473ml-pack-6', '7792798005970', 'EAN-13'),
  ('budweiser-lata-473ml-pack-6', '7793147118846', 'EAN-13'),
  ('stella-artois-lata-473ml-pack-6', '7792798010592', 'EAN-13'),
  ('andes-origen-rubia-lata-473ml-pack-6', '7792798001712', 'EAN-13')
)
-- package_type='unit', unit_factor=1 para las 12, incluidas las 4 cervezas
-- pack x6: el stock del producto ya cuenta packs, no latas sueltas, así que
-- un escaneo de este GTIN equivale a 1 unidad del STOCK DE ESTA FILA (el pack
-- completo) — no hay una unidad de conteo más chica en este catálogo. Mismo
-- criterio que ya usan las 4 unidades minoristas aplicadas en
-- retail-unidades-plan.mjs; no hay ningún GTIN con package_type='pack' ya
-- aplicado en este negocio del que copiar otro criterio.
insert into public.product_barcodes (
  business_id, product_id, gtin, barcode_type, package_type, unit_factor,
  is_primary, is_active, source, verified_at, created_by
)
select '00000000-0000-4000-8000-000000000001', n.id, c.gtin, c.gtin_type, 'unit', 1,
       true, true, 'manual', now(), '61f238ad-fc2b-446a-9f17-257f4622cd86'
  from nuevos n join codigos c on c.external_id = n.external_id;

commit;

-- Relectura: lo que quedó escrito, no lo que se pidió escribir.
select p.external_id, p.name, p.category, p.price, p.stock, p.available, p.is_verified,
       p.sold_as_pack, p.is_alcoholic, b.gtin
  from public.products p
  join public.product_barcodes b on b.product_id = p.id
 where p.business_id = '00000000-0000-4000-8000-000000000001' and p.external_id in ('coca-cola-original-pet-1500ml','coca-cola-zero-pet-1500ml','sprite-original-pet-1500ml','sprite-zero-pet-1500ml','villa-del-sur-sin-gas-pet-2250ml','villavicencio-con-gas-pet-1500ml','cepita-naranja-pet-1500ml','cepita-durazno-pet-1500ml','brahma-chopp-lata-473ml-pack-6','budweiser-lata-473ml-pack-6','stella-artois-lata-473ml-pack-6','andes-origen-rubia-lata-473ml-pack-6')
 order by p.external_id;

-- Control: el catálogo total del negocio antes de este lote tenía 60
-- filas; después de este lote, sin tocar ninguna, tiene que tener 72.
select count(*)::int as total_business from public.products where business_id = '00000000-0000-4000-8000-000000000001';
