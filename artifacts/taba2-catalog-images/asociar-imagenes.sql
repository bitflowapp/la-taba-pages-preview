-- TABA2 · asociar las fotografías aprobadas a sus productos
--
-- GENERADO por scripts/catalog-images/build-association-sql.mjs. No editar a mano.
-- Destino: Supabase PRODUCTIVO wwcpogltfgzgkrlilbcd, negocio 00000000-0000-4000-8000-000000000001.
--
-- QUÉ HACE Y QUÉ NO
-- -----------------
-- Toca EXCLUSIVAMENTE los seis campos de imagen de 4 productos, más su fila
-- en catalog_assets. NO toca precios, stock, disponibilidad, alcohol, ordering,
-- ni ninguna otra columna. No crea ni borra productos.
--
-- ANTES DE APLICAR
-- ----------------
-- 1. Los archivos WebP tienen que estar publicados en el sitio: el lote escribe
--    rutas relativas y la vitrina las va a pedir por HTTP.
-- 2. Se aplica con un usuario owner autenticado. La clave publicable no escribe
--    products, y está bien que no lo haga.
-- 3. Es idempotente: volver a aplicarlo deja el mismo estado.
--
-- Aprobado por: 61f238ad-fc2b-446a-9f17-257f4622cd86
-- Autoridad de derechos: TABA-AUT-2026-08-001 (declarada; evidencia documental pendiente: true)

begin;

-- Coca-Cola Original · 500 ml · pack x12
--   fuente: https://andinacocacolaar.vteximg.com.br/arquivos/ids/156458/100116.jpg?v=639063398326300000
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'coca-cola-original-botella-pet-500-ml-pack-x12', 'coca-cola-original-botella-pet-500-ml-pack-x12', 'coca-cola-original-botella-pet-500-ml-pack-x12', 'da9d9f1d872c1e49dbeaa9550935dcefa7e6a1a11d70dac2dea9cbf7c78ed28e',
  'assets/products/coca-cola-original-botella-pet-500-ml-pack-x12-da9d9f1d872c1e49-75b52ee33dad073c.webp', '75b52ee33dad073cedd2ae3babd87c319f3aa1cc22dc0f8623738701965b4235', 'bb02520b2511b35748876f30305eaab7407ab1ce24330a598848f15b3c1d85b1', 1000, 1000,
  'assets/products/coca-cola-original-botella-pet-500-ml-pack-x12-da9d9f1d872c1e49-thumb-2b779c394ec67eb4.webp', '2b779c394ec67eb41c4197ac7016f1bf1991fbfcb313b0feaaceafe2022079dc', 'd58fc0d26d2d062471f34007cdec47b43bf8005cb2c1ee62e9ebf34df1154ad6', 400, 400,
  'cb040bed34a53d9c0632701f8f4eeb22ffad1345d1fb92e8b8d743c59d3bf9db', 'https://andinacocacolaar.vteximg.com.br/arquivos/ids/156458/100116.jpg?v=639063398326300000', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
  now(), '61f238ad-fc2b-446a-9f17-257f4622cd86'
)
on conflict (business_id, sku) do update set
  master_path = excluded.master_path,
  master_sha256 = excluded.master_sha256,
  master_binding_sha256 = excluded.master_binding_sha256,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_sha256 = excluded.thumbnail_sha256,
  thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
  source_sha256 = excluded.source_sha256,
  source_url = excluded.source_url,
  rights_status = excluded.rights_status,
  rights_reference = excluded.rights_reference,
  updated_at = now();

update public.products set
  catalog_asset_id = (select id from public.catalog_assets
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-original-botella-pet-500-ml-pack-x12'),
  image_url = 'assets/products/coca-cola-original-botella-pet-500-ml-pack-x12-da9d9f1d872c1e49-75b52ee33dad073c.webp',
  image_sha256 = '75b52ee33dad073cedd2ae3babd87c319f3aa1cc22dc0f8623738701965b4235',
  image_thumbnail_url = 'assets/products/coca-cola-original-botella-pet-500-ml-pack-x12-da9d9f1d872c1e49-thumb-2b779c394ec67eb4.webp',
  image_thumbnail_sha256 = '2b779c394ec67eb41c4197ac7016f1bf1991fbfcb313b0feaaceafe2022079dc',
  source_image_sha256 = 'cb040bed34a53d9c0632701f8f4eeb22ffad1345d1fb92e8b8d743c59d3bf9db',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-original-botella-pet-500-ml-pack-x12';

-- Coca-Cola Zero · 500 ml · pack x12
--   fuente: https://andinacocacolaar.vteximg.com.br/arquivos/ids/156461/101816.jpg?v=639063400798100000
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'coca-cola-zero-botella-pet-500-ml-pack-x12', 'coca-cola-zero-botella-pet-500-ml-pack-x12', 'coca-cola-zero-botella-pet-500-ml-pack-x12', 'ab4d9e31abe096e081be13f62bc9321747c029c16b767cbbd26532849db7421e',
  'assets/products/coca-cola-zero-botella-pet-500-ml-pack-x12-ab4d9e31abe096e0-7a626dec1b48f442.webp', '7a626dec1b48f44272ba58d6f9240d4e4c9c673f96e38d636dd4cd64a19fa2c4', 'bd9e83d5d160eb3546427071316f3de390d3da6d44198361ceb7f570c289a1d6', 1000, 1000,
  'assets/products/coca-cola-zero-botella-pet-500-ml-pack-x12-ab4d9e31abe096e0-thumb-390944099fdb5e22.webp', '390944099fdb5e227be5b9db4a4c6f3549c3e6355a52e7b8290ad421ec741cd9', 'f89658f11cad489f95836e88ae76fbe88e948c5c56d164ed289c4672d09712ac', 400, 400,
  'ad180f225a01e71add4d61beab3be1f01a092e4bdf5579b20484d87a2146dbc1', 'https://andinacocacolaar.vteximg.com.br/arquivos/ids/156461/101816.jpg?v=639063400798100000', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
  now(), '61f238ad-fc2b-446a-9f17-257f4622cd86'
)
on conflict (business_id, sku) do update set
  master_path = excluded.master_path,
  master_sha256 = excluded.master_sha256,
  master_binding_sha256 = excluded.master_binding_sha256,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_sha256 = excluded.thumbnail_sha256,
  thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
  source_sha256 = excluded.source_sha256,
  source_url = excluded.source_url,
  rights_status = excluded.rights_status,
  rights_reference = excluded.rights_reference,
  updated_at = now();

update public.products set
  catalog_asset_id = (select id from public.catalog_assets
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-zero-botella-pet-500-ml-pack-x12'),
  image_url = 'assets/products/coca-cola-zero-botella-pet-500-ml-pack-x12-ab4d9e31abe096e0-7a626dec1b48f442.webp',
  image_sha256 = '7a626dec1b48f44272ba58d6f9240d4e4c9c673f96e38d636dd4cd64a19fa2c4',
  image_thumbnail_url = 'assets/products/coca-cola-zero-botella-pet-500-ml-pack-x12-ab4d9e31abe096e0-thumb-390944099fdb5e22.webp',
  image_thumbnail_sha256 = '390944099fdb5e227be5b9db4a4c6f3549c3e6355a52e7b8290ad421ec741cd9',
  source_image_sha256 = 'ad180f225a01e71add4d61beab3be1f01a092e4bdf5579b20484d87a2146dbc1',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-zero-botella-pet-500-ml-pack-x12';

-- Fanta Naranja · 1500 ml · pack x6
--   fuente: https://andinacocacolaar.vteximg.com.br/arquivos/ids/156347/101113.jpg?v=638857652534800000
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'fanta-naranja-botella-pet-1500-ml-pack-x6', 'fanta-naranja-botella-pet-1500-ml-pack-x6', 'fanta-naranja-botella-pet-1500-ml-pack-x6', 'ddcfc29d89d6d01dca5279e75a978d7ec6bb3e0a9c9c9c690d9458e3a4fa8e9c',
  'assets/products/fanta-naranja-botella-pet-1500-ml-pack-x6-ddcfc29d89d6d01d-e41698f0e9b8788b.webp', 'e41698f0e9b8788b7472ecd777ddeab4791cc6166770630d079f52b3062e08ea', 'ee97c9cf8890ef765f16b9b21ccb3c830b3fd2b5a5db9e150b34ecbc00b3a03d', 1000, 1000,
  'assets/products/fanta-naranja-botella-pet-1500-ml-pack-x6-ddcfc29d89d6d01d-thumb-6f5544d252c1151c.webp', '6f5544d252c1151c4b4b8aa477d706fc2f9014c0c801f446e589366f5a66c8a7', 'd585077e8d1314df31befd7ad280f22212a4e65c841153e7f5ef5fa86979accf', 400, 400,
  '8a49eddb5f26bdbad98fb14085c221a37432f21a884ce4808358180987f29512', 'https://andinacocacolaar.vteximg.com.br/arquivos/ids/156347/101113.jpg?v=638857652534800000', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
  now(), '61f238ad-fc2b-446a-9f17-257f4622cd86'
)
on conflict (business_id, sku) do update set
  master_path = excluded.master_path,
  master_sha256 = excluded.master_sha256,
  master_binding_sha256 = excluded.master_binding_sha256,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_sha256 = excluded.thumbnail_sha256,
  thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
  source_sha256 = excluded.source_sha256,
  source_url = excluded.source_url,
  rights_status = excluded.rights_status,
  rights_reference = excluded.rights_reference,
  updated_at = now();

update public.products set
  catalog_asset_id = (select id from public.catalog_assets
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'fanta-naranja-botella-pet-1500-ml-pack-x6'),
  image_url = 'assets/products/fanta-naranja-botella-pet-1500-ml-pack-x6-ddcfc29d89d6d01d-e41698f0e9b8788b.webp',
  image_sha256 = 'e41698f0e9b8788b7472ecd777ddeab4791cc6166770630d079f52b3062e08ea',
  image_thumbnail_url = 'assets/products/fanta-naranja-botella-pet-1500-ml-pack-x6-ddcfc29d89d6d01d-thumb-6f5544d252c1151c.webp',
  image_thumbnail_sha256 = '6f5544d252c1151c4b4b8aa477d706fc2f9014c0c801f446e589366f5a66c8a7',
  source_image_sha256 = '8a49eddb5f26bdbad98fb14085c221a37432f21a884ce4808358180987f29512',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'fanta-naranja-botella-pet-1500-ml-pack-x6';

-- Sprite · 500 ml · pack x12
--   fuente: https://andinacocacolaar.vteximg.com.br/arquivos/ids/155757/7790895000829.jpg?v=638748141213370000
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'sprite-botella-pet-500-ml-pack-x12', 'sprite-botella-pet-500-ml-pack-x12', 'sprite-botella-pet-500-ml-pack-x12', '07620ef3d3aa792cec86f2762094b0656b1ecbcfa6b39acad2c5abcef4850c75',
  'assets/products/sprite-botella-pet-500-ml-pack-x12-07620ef3d3aa792c-09a508b8102bd8a5.webp', '09a508b8102bd8a5bd01c7ca752caeb312cffc577d752eb34b59993caa7e5c1a', '8e996ad9e54c3cda019abcae56d48977520004034f6c7553fdb237562c21b0b0', 1000, 1000,
  'assets/products/sprite-botella-pet-500-ml-pack-x12-07620ef3d3aa792c-thumb-49fb5075276d3ebb.webp', '49fb5075276d3ebb3e01c5f36f2a440ea289c88e8d09fca04047681b4d978211', '8dad72bef786f649204f9c06147ff4ab7ddabb19f6bee02062b0b9e4e8bbd597', 400, 400,
  '789d34a9616fdd1fc16eff747e41814af68a82cb7ba6799a7a2b533f98dbd9f2', 'https://andinacocacolaar.vteximg.com.br/arquivos/ids/155757/7790895000829.jpg?v=638748141213370000', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
  now(), '61f238ad-fc2b-446a-9f17-257f4622cd86'
)
on conflict (business_id, sku) do update set
  master_path = excluded.master_path,
  master_sha256 = excluded.master_sha256,
  master_binding_sha256 = excluded.master_binding_sha256,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_sha256 = excluded.thumbnail_sha256,
  thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
  source_sha256 = excluded.source_sha256,
  source_url = excluded.source_url,
  rights_status = excluded.rights_status,
  rights_reference = excluded.rights_reference,
  updated_at = now();

update public.products set
  catalog_asset_id = (select id from public.catalog_assets
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-botella-pet-500-ml-pack-x12'),
  image_url = 'assets/products/sprite-botella-pet-500-ml-pack-x12-07620ef3d3aa792c-09a508b8102bd8a5.webp',
  image_sha256 = '09a508b8102bd8a5bd01c7ca752caeb312cffc577d752eb34b59993caa7e5c1a',
  image_thumbnail_url = 'assets/products/sprite-botella-pet-500-ml-pack-x12-07620ef3d3aa792c-thumb-49fb5075276d3ebb.webp',
  image_thumbnail_sha256 = '49fb5075276d3ebb3e01c5f36f2a440ea289c88e8d09fca04047681b4d978211',
  source_image_sha256 = '789d34a9616fdd1fc16eff747e41814af68a82cb7ba6799a7a2b533f98dbd9f2',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-botella-pet-500-ml-pack-x12';

-- Constancia: cuántos productos quedaron con la cadena de imagen completa.
select count(*) as productos_con_imagen
from public.products
where business_id = '00000000-0000-4000-8000-000000000001'
  and image_url is not null
  and catalog_asset_id is not null;

commit;
