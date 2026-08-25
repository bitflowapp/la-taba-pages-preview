-- TABA2 · asociar las fotografías aprobadas a sus productos
--
-- GENERADO por scripts/catalog-images/build-association-sql.mjs. No editar a mano.
-- Destino: Supabase PRODUCTIVO wwcpogltfgzgkrlilbcd, negocio 00000000-0000-4000-8000-000000000001.
--
-- QUÉ HACE Y QUÉ NO
-- -----------------
-- Toca EXCLUSIVAMENTE los seis campos de imagen de 14 productos, más su fila
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

-- Benedictino · 2250 ml · unidad
--   fuente: https://coca-colaentucasa.com/media/catalog/product/3/-/3-render_2.25l_bndsg.png
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'benedictino-sin-gas-2250ml', 'benedictino-sin-gas-2250ml', 'benedictino-sin-gas-2250ml', '8291602e84de68e9d476ce7b02e067cf97090abee8c87cdba73ee375cb089e0f',
  'assets/products/benedictino-sin-gas-2250ml-8291602e84de68e9-b3100a865b922f28.webp', 'b3100a865b922f28e4669b6b65cbb652a5a53bfed7ef3a321d4f36e8d21d14fd', '08fb3e32cb654fa975f881bd25571828c5801155e6b5b163d45965c36f059ac2', 1000, 1000,
  'assets/products/benedictino-sin-gas-2250ml-8291602e84de68e9-thumb-e6d7c299f80e6e5d.webp', 'e6d7c299f80e6e5d170f46c818147296496907c6608f84a89d40ae1ccaec1e88', '0bcebd98dd90854225e18089d772c1d55d6bdccef05ce0709e1d230698301be9', 400, 400,
  'd24dd0a08af51f162cd3a535bc04545ddca571ba3390940f7b29e6e1bd106353', 'https://coca-colaentucasa.com/media/catalog/product/3/-/3-render_2.25l_bndsg.png', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'benedictino-sin-gas-2250ml'),
  image_url = 'assets/products/benedictino-sin-gas-2250ml-8291602e84de68e9-b3100a865b922f28.webp',
  image_sha256 = 'b3100a865b922f28e4669b6b65cbb652a5a53bfed7ef3a321d4f36e8d21d14fd',
  image_thumbnail_url = 'assets/products/benedictino-sin-gas-2250ml-8291602e84de68e9-thumb-e6d7c299f80e6e5d.webp',
  image_thumbnail_sha256 = 'e6d7c299f80e6e5d170f46c818147296496907c6608f84a89d40ae1ccaec1e88',
  source_image_sha256 = 'd24dd0a08af51f162cd3a535bc04545ddca571ba3390940f7b29e6e1bd106353',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'benedictino-sin-gas-2250ml';

-- Coca-Cola · 2250 ml · unidad
--   fuente: https://coca-colaentucasa.com/media/catalog/product/6/-/6-render_2.25l_1.png
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'coca-cola-original-2250ml', 'coca-cola-original-2250ml', 'coca-cola-original-2250ml', '97dc25e8399a5775388fd065c3350d71a6b79a661dab2ef2e3bb2b5aa719d1db',
  'assets/products/coca-cola-original-2250ml-97dc25e8399a5775-adb8042ea9716cb9.webp', 'adb8042ea9716cb98846dc1d8764eb9a047adcf34ca33fc50d46fc959c846c6e', '49e59e22653478a892b86a94cfef6956a41a55ad44920bf822f7f7e93e035a30', 1000, 1000,
  'assets/products/coca-cola-original-2250ml-97dc25e8399a5775-thumb-acbe05a93036a3a4.webp', 'acbe05a93036a3a451939f75f146b73eb74db5aec2c16ac0b47f04886949b1df', '3a506fd9bc98fff69ddbd26c9c160d1244b89d5b6de87b5a58cb715759b685a0', 400, 400,
  '528fe77e3d7a4a0f0d62361b2ebf1dd271a778c2edc1de6bfd6657345d86fac5', 'https://coca-colaentucasa.com/media/catalog/product/6/-/6-render_2.25l_1.png', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-original-2250ml'),
  image_url = 'assets/products/coca-cola-original-2250ml-97dc25e8399a5775-adb8042ea9716cb9.webp',
  image_sha256 = 'adb8042ea9716cb98846dc1d8764eb9a047adcf34ca33fc50d46fc959c846c6e',
  image_thumbnail_url = 'assets/products/coca-cola-original-2250ml-97dc25e8399a5775-thumb-acbe05a93036a3a4.webp',
  image_thumbnail_sha256 = 'acbe05a93036a3a451939f75f146b73eb74db5aec2c16ac0b47f04886949b1df',
  source_image_sha256 = '528fe77e3d7a4a0f0d62361b2ebf1dd271a778c2edc1de6bfd6657345d86fac5',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-original-2250ml';

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

-- Coca-Cola Zero · 2250 ml · unidad
--   fuente: https://coca-colaentucasa.com/media/catalog/product/6/-/6-render_2.25l_z.png
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'coca-cola-zero-2250ml', 'coca-cola-zero-2250ml', 'coca-cola-zero-2250ml', '4ce84243eb65d14a086dbdfb1a0e9fddd03d76eea54fd4ff32ad1200ff4355d7',
  'assets/products/coca-cola-zero-2250ml-4ce84243eb65d14a-309bbcc731498df7.webp', '309bbcc731498df73d5f2618ca902169e6dca283eb9fc35fa2c8a7807886f2f1', '4b12d6091b774f0a95bcbaee9fa44691947ee836c3d99cdab89952b6984ef28f', 1000, 1000,
  'assets/products/coca-cola-zero-2250ml-4ce84243eb65d14a-thumb-826e5a5ea976e1e2.webp', '826e5a5ea976e1e2dbaa1cb55dafbfa68bfbfa84ad2c1bb2452fb7ac1198ce7f', '62906af4ab4b9f0ee7895e109aeb7422950cf4c45f1cad6fb8b48a06af14c921', 400, 400,
  '0da19cff6e9133bc27b50bf74bc164faf7bef0f1111fa1d06807ba73c909de38', 'https://coca-colaentucasa.com/media/catalog/product/6/-/6-render_2.25l_z.png', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-zero-2250ml'),
  image_url = 'assets/products/coca-cola-zero-2250ml-4ce84243eb65d14a-309bbcc731498df7.webp',
  image_sha256 = '309bbcc731498df73d5f2618ca902169e6dca283eb9fc35fa2c8a7807886f2f1',
  image_thumbnail_url = 'assets/products/coca-cola-zero-2250ml-4ce84243eb65d14a-thumb-826e5a5ea976e1e2.webp',
  image_thumbnail_sha256 = '826e5a5ea976e1e2dbaa1cb55dafbfa68bfbfa84ad2c1bb2452fb7ac1198ce7f',
  source_image_sha256 = '0da19cff6e9133bc27b50bf74bc164faf7bef0f1111fa1d06807ba73c909de38',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'coca-cola-zero-2250ml';

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

-- Monster Green Zero · 473 ml · unidad
--   fuente: https://web-assests.monsterenergy.com/mnst/9c1506b2-791c-4f0a-9ed9-25cf66549334.png
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'monster-green-zero-473ml', 'monster-green-zero-473ml', 'monster-green-zero-473ml', 'c238e9bf28582e1578da5cad0bd65fbced083497c0975c7afdeca167b5e059a5',
  'assets/products/monster-green-zero-473ml-c238e9bf28582e15-36ea5aaa51d7906e.webp', '36ea5aaa51d7906e28a0867e07e7cfe81aa44f929b9a2aebfb31982558bec049', 'b0a3bf1988da0ac50d46c35b748c0148575ebae87da370db73571f6b74a56a29', 1000, 1000,
  'assets/products/monster-green-zero-473ml-c238e9bf28582e15-thumb-9ee7f5db50e33ce1.webp', '9ee7f5db50e33ce1f71fd6457c98e315eb20e72d69cc2f2b442d742f5f84ca27', 'c43b8000ca8c74275de812abdba35931be52c209eeea7150670744610c55ab4a', 400, 400,
  '266935e6279014724e34ddbceaac6f2d8867a15e0f88f21be1ab0b7ffc4e03b1', 'https://web-assests.monsterenergy.com/mnst/9c1506b2-791c-4f0a-9ed9-25cf66549334.png', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'monster-green-zero-473ml'),
  image_url = 'assets/products/monster-green-zero-473ml-c238e9bf28582e15-36ea5aaa51d7906e.webp',
  image_sha256 = '36ea5aaa51d7906e28a0867e07e7cfe81aa44f929b9a2aebfb31982558bec049',
  image_thumbnail_url = 'assets/products/monster-green-zero-473ml-c238e9bf28582e15-thumb-9ee7f5db50e33ce1.webp',
  image_thumbnail_sha256 = '9ee7f5db50e33ce1f71fd6457c98e315eb20e72d69cc2f2b442d742f5f84ca27',
  source_image_sha256 = '266935e6279014724e34ddbceaac6f2d8867a15e0f88f21be1ab0b7ffc4e03b1',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'monster-green-zero-473ml';

-- Paso de los Toros Pomelo · 1500 ml · unidad
--   fuente: https://boulevard-sa.com.ar/Site/img/products/paso-de-los-toros/Paso-de-los-Toros-pomelo-1500-L.jpg
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'paso-de-los-toros-pomelo-1500ml', 'paso-de-los-toros-pomelo-1500ml', 'paso-de-los-toros-pomelo-1500ml', '07e30d411964923244775739570d51ce8ae4d165f710782f0b5a58c887faf9b3',
  'assets/products/paso-de-los-toros-pomelo-1500ml-07e30d4119649232-5ee73401ead32b21.webp', '5ee73401ead32b21b98bae86af35d1b20c5b5c34fe52749be028a0a1b7d6f7bc', 'e4d90211a25054d3857d153b45334d7a2390efbb8f5128f80a11bf4c220bea3d', 1000, 1000,
  'assets/products/paso-de-los-toros-pomelo-1500ml-07e30d4119649232-thumb-2578710a66ec476a.webp', '2578710a66ec476a5b4a0cae9244e5115a51a9cebe3be50fb2ba4cf997f79f80', '389953d4586165dbceef4139bfbfe1f5b34fe54ebfb129ff5094c20a8735af91', 400, 400,
  '40948981e939230101c62aa975fff5988af5cd2868b232a57d590f81196e1e02', 'https://boulevard-sa.com.ar/Site/img/products/paso-de-los-toros/Paso-de-los-Toros-pomelo-1500-L.jpg', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'paso-de-los-toros-pomelo-1500ml'),
  image_url = 'assets/products/paso-de-los-toros-pomelo-1500ml-07e30d4119649232-5ee73401ead32b21.webp',
  image_sha256 = '5ee73401ead32b21b98bae86af35d1b20c5b5c34fe52749be028a0a1b7d6f7bc',
  image_thumbnail_url = 'assets/products/paso-de-los-toros-pomelo-1500ml-07e30d4119649232-thumb-2578710a66ec476a.webp',
  image_thumbnail_sha256 = '2578710a66ec476a5b4a0cae9244e5115a51a9cebe3be50fb2ba4cf997f79f80',
  source_image_sha256 = '40948981e939230101c62aa975fff5988af5cd2868b232a57d590f81196e1e02',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'paso-de-los-toros-pomelo-1500ml';

-- Paso de los Toros Tónica · 1500 ml · unidad
--   fuente: https://boulevard-sa.com.ar/Site/img/products/paso-de-los-toros/Paso-de-los-Toros-1500-L.jpg
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'paso-de-los-toros-tonica-1500ml', 'paso-de-los-toros-tonica-1500ml', 'paso-de-los-toros-tonica-1500ml', '3a05ed21abc4e380deac78387feaea44417dc8e452fed44ff15555728bbef833',
  'assets/products/paso-de-los-toros-tonica-1500ml-3a05ed21abc4e380-f551a02eb264272c.webp', 'f551a02eb264272cb86146b87231f4d43196e2be52f142b80f03cdbd6622821a', 'c85a23a09d3b555458767a7ccf5a6545aa221b121ee88ff149cc02b6b2dcec57', 1000, 1000,
  'assets/products/paso-de-los-toros-tonica-1500ml-3a05ed21abc4e380-thumb-209929c85be873fa.webp', '209929c85be873fa6ee45a627f1767e730b86fec8df07a8d2a543285ca25ec57', '3e374defd0be933122fa883c3a0b2e87b2ada2e42382df5852027883db7f7c12', 400, 400,
  'ee6498aa3cf45e863946a7d33adbbd68bb1ac16328552d3b7ccc814e5be2c4cd', 'https://boulevard-sa.com.ar/Site/img/products/paso-de-los-toros/Paso-de-los-Toros-1500-L.jpg', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'paso-de-los-toros-tonica-1500ml'),
  image_url = 'assets/products/paso-de-los-toros-tonica-1500ml-3a05ed21abc4e380-f551a02eb264272c.webp',
  image_sha256 = 'f551a02eb264272cb86146b87231f4d43196e2be52f142b80f03cdbd6622821a',
  image_thumbnail_url = 'assets/products/paso-de-los-toros-tonica-1500ml-3a05ed21abc4e380-thumb-209929c85be873fa.webp',
  image_thumbnail_sha256 = '209929c85be873fa6ee45a627f1767e730b86fec8df07a8d2a543285ca25ec57',
  source_image_sha256 = 'ee6498aa3cf45e863946a7d33adbbd68bb1ac16328552d3b7ccc814e5be2c4cd',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'paso-de-los-toros-tonica-1500ml';

-- Soda Manaos · 2000 ml · unidad
--   fuente: https://www.manaosargentina.com/images/productos/soda/MANAOS-SODA-2LTS.jpg
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'soda-manaos-sifon-2000ml', 'soda-manaos-sifon-2000ml', 'soda-manaos-sifon-2000ml', 'b92e160958368c0da49d880a4f4a972e5dca200d4658aca6a70b194461bd8bf5',
  'assets/products/soda-manaos-sifon-2000ml-b92e160958368c0d-3700b6c8cb4ec1b4.webp', '3700b6c8cb4ec1b4ab234cd89bb7b3d8061c7529f8c92d6a8c2ee842d08cdc00', '949fd8d3b796e91b89dd19b90e7cc7d285d4b6fee59b067e4a9bed2dfd48b84d', 1000, 1000,
  'assets/products/soda-manaos-sifon-2000ml-b92e160958368c0d-thumb-33a5a3998f343f97.webp', '33a5a3998f343f97f5385215b03c4d2f7f58b8036ee18d78aa52a9b4aee7f3b5', '96431db8bf229277b86c8d8c013314dc28a76e853174138f4cbffbad5f2bfda9', 400, 400,
  '03b09a8673ededd69383491e79b87f9687813872099d5d1fdcbee7b498a23fb5', 'https://www.manaosargentina.com/images/productos/soda/MANAOS-SODA-2LTS.jpg', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'soda-manaos-sifon-2000ml'),
  image_url = 'assets/products/soda-manaos-sifon-2000ml-b92e160958368c0d-3700b6c8cb4ec1b4.webp',
  image_sha256 = '3700b6c8cb4ec1b4ab234cd89bb7b3d8061c7529f8c92d6a8c2ee842d08cdc00',
  image_thumbnail_url = 'assets/products/soda-manaos-sifon-2000ml-b92e160958368c0d-thumb-33a5a3998f343f97.webp',
  image_thumbnail_sha256 = '33a5a3998f343f97f5385215b03c4d2f7f58b8036ee18d78aa52a9b4aee7f3b5',
  source_image_sha256 = '03b09a8673ededd69383491e79b87f9687813872099d5d1fdcbee7b498a23fb5',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'soda-manaos-sifon-2000ml';

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

-- Sprite · 2250 ml · unidad
--   fuente: https://coca-colaentucasa.com/media/catalog/product/3/-/3-render_2.25l_sp.png
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'sprite-original-2250ml', 'sprite-original-2250ml', 'sprite-original-2250ml', '99d83c94dac255ca2db8ac0ea5d0d86e6b46277749e4cfd4722c19cb293bf8e0',
  'assets/products/sprite-original-2250ml-99d83c94dac255ca-3898f9d83fdf293f.webp', '3898f9d83fdf293f0d4efb1b1ed1dc914a91fe026a9d0f4b933374e316e3f613', 'a2b6e82c2bb1b9dd18a8a023be9633759759e4489e7acaccb76e3b5771fb3b22', 1000, 1000,
  'assets/products/sprite-original-2250ml-99d83c94dac255ca-thumb-1e02490bc9080f49.webp', '1e02490bc9080f4969bf2c4100514bd90facaaed68e44ef52efc1e383235084f', 'f4d03806acfbd2ff694137805aa1feff044e6b8073374951cbaabb07cf7c1780', 400, 400,
  '90134b8ab009f14ed990099565579b7bb03ee3edef37a2bd2d8f353d1b6ab1c7', 'https://coca-colaentucasa.com/media/catalog/product/3/-/3-render_2.25l_sp.png', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-original-2250ml'),
  image_url = 'assets/products/sprite-original-2250ml-99d83c94dac255ca-3898f9d83fdf293f.webp',
  image_sha256 = '3898f9d83fdf293f0d4efb1b1ed1dc914a91fe026a9d0f4b933374e316e3f613',
  image_thumbnail_url = 'assets/products/sprite-original-2250ml-99d83c94dac255ca-thumb-1e02490bc9080f49.webp',
  image_thumbnail_sha256 = '1e02490bc9080f4969bf2c4100514bd90facaaed68e44ef52efc1e383235084f',
  source_image_sha256 = '90134b8ab009f14ed990099565579b7bb03ee3edef37a2bd2d8f353d1b6ab1c7',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-original-2250ml';

-- Sprite · 354 ml · unidad
--   fuente: https://coca-colaentucasa.com/media/catalog/product/s/p/spritelima-limo_n354ml_1.png
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'sprite-original-lata-354ml', 'sprite-original-lata-354ml', 'sprite-original-lata-354ml', '0060e518ebfab8e77a17ced40c28a0e9eee1fa4e1c3908c32e5494a2664587bb',
  'assets/products/sprite-original-lata-354ml-0060e518ebfab8e7-8832bfc71a16ffad.webp', '8832bfc71a16ffada799d1992258f6c7813f19844beb8414862b05a80f08c4bb', '60a338ad420136222d6f45ba5adaabec6b402414d76449e85d4f0bffc5373167', 1000, 1000,
  'assets/products/sprite-original-lata-354ml-0060e518ebfab8e7-thumb-9f34da79cf990fa1.webp', '9f34da79cf990fa1127231b78e09dc43f6af91fc5b0544943d7e79d39cd88932', '59a24a91b6f90445878b14c3584e9b299e17e4f58c8f1a942a6947787c95709b', 400, 400,
  '6127751bbe5bc05b1aa94450e27b39a03b20ed017d565d7f85d4750e06b6d4bb', 'https://coca-colaentucasa.com/media/catalog/product/s/p/spritelima-limo_n354ml_1.png', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-original-lata-354ml'),
  image_url = 'assets/products/sprite-original-lata-354ml-0060e518ebfab8e7-8832bfc71a16ffad.webp',
  image_sha256 = '8832bfc71a16ffada799d1992258f6c7813f19844beb8414862b05a80f08c4bb',
  image_thumbnail_url = 'assets/products/sprite-original-lata-354ml-0060e518ebfab8e7-thumb-9f34da79cf990fa1.webp',
  image_thumbnail_sha256 = '9f34da79cf990fa1127231b78e09dc43f6af91fc5b0544943d7e79d39cd88932',
  source_image_sha256 = '6127751bbe5bc05b1aa94450e27b39a03b20ed017d565d7f85d4750e06b6d4bb',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-original-lata-354ml';

-- Sprite Zero · 2250 ml · unidad
--   fuente: https://coca-colaentucasa.com/media/catalog/product/4/-/4-render_2.25l_spz.png
--   derechos: LICENCIA_COMERCIAL · TABA-AUT-2026-08-001
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  '00000000-0000-4000-8000-000000000001', 'sprite-zero-2250ml', 'sprite-zero-2250ml', 'sprite-zero-2250ml', 'c43f15fd8eedc2e4ca9be7808753d06ea1b0db20049dbedd74048e5d12dcf160',
  'assets/products/sprite-zero-2250ml-c43f15fd8eedc2e4-96e92127e95886ab.webp', '96e92127e95886abe28220741a08e9f8d839c5247c7ff410efb638fe98a1aa48', '67fbfec236a0905277a8daabaf8b858782d3fee748aeb17413c21113e3d8eb74', 1000, 1000,
  'assets/products/sprite-zero-2250ml-c43f15fd8eedc2e4-thumb-4e04923ee3c2fb00.webp', '4e04923ee3c2fb008e57d9b4d16d85f04ab63653db7f2b71763ac312d7c8568b', 'b2f73defd0d88b045d11bf4593018a9f3f4fcbfd81318629c043628614fb6fbc', 400, 400,
  '6726494255aba9a76efba2fdf61101db16183464526c1a63fd66fa2811929157', 'https://coca-colaentucasa.com/media/catalog/product/4/-/4-render_2.25l_spz.png', 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001',
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
                      where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-zero-2250ml'),
  image_url = 'assets/products/sprite-zero-2250ml-c43f15fd8eedc2e4-96e92127e95886ab.webp',
  image_sha256 = '96e92127e95886abe28220741a08e9f8d839c5247c7ff410efb638fe98a1aa48',
  image_thumbnail_url = 'assets/products/sprite-zero-2250ml-c43f15fd8eedc2e4-thumb-4e04923ee3c2fb00.webp',
  image_thumbnail_sha256 = '4e04923ee3c2fb008e57d9b4d16d85f04ab63653db7f2b71763ac312d7c8568b',
  source_image_sha256 = '6726494255aba9a76efba2fdf61101db16183464526c1a63fd66fa2811929157',
  updated_at = now()
where business_id = '00000000-0000-4000-8000-000000000001' and sku = 'sprite-zero-2250ml';

-- Constancia: cuántos productos quedaron con la cadena de imagen completa.
select count(*) as productos_con_imagen
from public.products
where business_id = '00000000-0000-4000-8000-000000000001'
  and image_url is not null
  and catalog_asset_id is not null;

commit;
