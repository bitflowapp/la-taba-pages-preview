-- TABA2 · La foto deja de ser condicion para vender, y los derechos siguen firmes.
--
-- La frontera que la migracion 108 movio, en una linea:
--
--     PUBLICAR depende de identidad, precio, stock y datos maestros.
--     LA IMAGEN es opcional; si esta, tiene que estar entera.
--     LOS DERECHOS siguen viviendo en catalog_assets, intactos.
--
-- Los casos negativos se prueban dando de alta filas defectuosas, no mutando una
-- fila buena. La razon la enseno el primer ensayo contra produccion:
-- `products_fail_close_master_change` desverifica el producto en cuanto cambian
-- sus datos maestros, asi que un UPDATE nunca llega a chocar contra la
-- restriccion -la fila deja de estar verificada y la restriccion, con razon, se
-- desentiende-. Probar por UPDATE medía el trigger, no el contrato.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── Fixture: un comercio, su duena y dos assets ────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('e8000000-0000-4000-8000-000000000001','authenticated','authenticated','verifica@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values ('e9000000-0000-4000-8000-000000000001','TABA sin fotos','open','taba-sin-fotos',true);

-- Un asset con derechos en regla y uno de QA legitimo. Los campos derivados los
-- calculan las mismas funciones que exige `catalog_assets_identity_binding_valid`.
insert into public.catalog_assets(
  business_id, external_id, sku, safe_sku, catalog_origin,
  rights_status, rights_reference, approved_at, approved_by,
  source_url, source_sha256, identity_sha256,
  master_path, master_sha256, master_binding_sha256,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256)
select
  'e9000000-0000-4000-8000-000000000001','p-ok','sku-ok','sku-ok','commercial',
  'PROPIO','foto propia del comercio',now(),'e8000000-0000-4000-8000-000000000001',
  'https://ejemplo.invalid/propia.jpg', s.src, i.ident,
  public.catalog_asset_path('sku-ok', i.ident, 'master', s.mas), s.mas,
  public.catalog_asset_binding_sha256(i.ident,'master',s.src,s.mas,1000,1000,public.catalog_asset_path('sku-ok',i.ident,'master',s.mas)),
  public.catalog_asset_path('sku-ok', i.ident, 'thumbnail', s.thu), s.thu,
  public.catalog_asset_binding_sha256(i.ident,'thumbnail',s.src,s.thu,400,400,public.catalog_asset_path('sku-ok',i.ident,'thumbnail',s.thu))
from (select repeat('ab',32) as src, repeat('cd',32) as mas, repeat('ef',32) as thu) s,
     lateral (select public.catalog_image_identity_sha256('p-ok','sku-ok',s.src) as ident) i;

insert into public.catalog_assets(
  business_id, external_id, sku, safe_sku, catalog_origin,
  rights_status, rights_reference, source_url, source_sha256, identity_sha256,
  master_path, master_sha256, master_binding_sha256,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256)
select
  'e9000000-0000-4000-8000-000000000001','p-qa','sku-qa','sku-qa','demo_fixture',
  'UNAPPROVED_QA','fixture interno',
  'https://ejemplo.invalid/qa.jpg', s.src, i.ident,
  public.catalog_asset_path('sku-qa', i.ident, 'master', s.mas), s.mas,
  public.catalog_asset_binding_sha256(i.ident,'master',s.src,s.mas,1000,1000,public.catalog_asset_path('sku-qa',i.ident,'master',s.mas)),
  public.catalog_asset_path('sku-qa', i.ident, 'thumbnail', s.thu), s.thu,
  public.catalog_asset_binding_sha256(i.ident,'thumbnail',s.src,s.thu,400,400,public.catalog_asset_path('sku-qa',i.ident,'thumbnail',s.thu))
from (select repeat('ab',32) as src, repeat('cd',32) as mas, repeat('ef',32) as thu) s,
     lateral (select public.catalog_image_identity_sha256('p-qa','sku-qa',s.src) as ident) i;

-- Un alta de producto con los datos maestros completos. Cada caso pisa lo que
-- necesita romper.
create function pg_temp.alta(
  p_sku text,
  p_origen text default 'commercial',
  p_precio numeric default 17100,
  p_stock int default 8,
  p_marca text default 'Marca Ensayo',
  p_asset uuid default null,
  p_image_url text default null,
  p_image_sha text default null,
  p_thumb_url text default null,
  p_thumb_sha text default null,
  p_source_sha text default null
) returns void language sql as $$
  insert into public.products(
    business_id, name, description, category, subcategory, brand, presentation,
    capacity, capacity_value, capacity_unit, packaging_type, variant,
    external_id, sku, units_per_pack, price, stock, is_active, available,
    is_alcoholic, is_verified, verified_at, verified_by, sort_order,
    price_status, catalog_origin, catalog_asset_id,
    image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256)
  values (
    'e9000000-0000-4000-8000-000000000001', 'Gaseosa ' || coalesce(p_sku,'sin sku'),
    'Botella PET 500 ml Pack x12', 'Gaseosas', 'Cola', p_marca,
    'Botella PET 500 ml Pack x12', '500 ml', 500, 'ml', 'Botella PET',
    'Botella PET 500 ml Pack x12',
    'ext-' || coalesce(p_sku,'x'), p_sku, 12, p_precio, p_stock, true, true,
    false, true, now(), 'e8000000-0000-4000-8000-000000000001',
    (random() * 1000)::int, 'confirmed', p_origen, p_asset,
    p_image_url, p_image_sha, p_thumb_url, p_thumb_sha, p_source_sha);
$$;

-- ── 1 y 2 · sin imagen, con todo lo demas: PUBLICABLE ──────────────────────
select lives_ok(
  $$select pg_temp.alta('sku-sin-foto')$$,
  'un producto comercial real sin imagen se verifica y se publica'
);

select is(
  (select count(*)::int from public.products
    where sku = 'sku-sin-foto' and is_verified and available
      and catalog_asset_id is null and image_url is null and image_sha256 is null
      and image_thumbnail_url is null and image_thumbnail_sha256 is null
      and source_image_sha256 is null),
  1,
  'queda vendible con los seis campos de imagen coherentemente nulos'
);

-- ── 3 · solo image_url: FALLA ──────────────────────────────────────────────
select throws_ok(
  $$select pg_temp.alta('sku-url-suelta', p_image_url => 'assets/products/suelta.webp')$$,
  null, null,
  'una image_url suelta, sin asset ni hashes, no se acepta'
);

-- ── 4 · asset + url pero sin hashes: FALLA ─────────────────────────────────
select throws_ok(
  $$select pg_temp.alta('sku-sin-hash',
      p_asset => (select id from public.catalog_assets where sku = 'sku-ok'),
      p_image_url => (select master_path from public.catalog_assets where sku = 'sku-ok'))$$,
  null, null,
  'metadata de imagen a medias no se acepta ni con un asset valido detras'
);

-- ── 5 · una imagen de tercero sin derechos no entra al catalogo ────────────
select throws_ok(
  $$insert into public.catalog_assets(
      business_id, external_id, sku, safe_sku, catalog_origin,
      rights_status, rights_reference, source_url, source_sha256, identity_sha256,
      master_path, master_sha256, master_binding_sha256,
      thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256)
    select
      'e9000000-0000-4000-8000-000000000001','p-3ro','sku-3ro','sku-3ro','commercial',
      'pending_review','jumbo.com.ar','https://ejemplo.invalid/x.jpg', s.src, i.ident,
      public.catalog_asset_path('sku-3ro', i.ident, 'master', s.mas), s.mas,
      public.catalog_asset_binding_sha256(i.ident,'master',s.src,s.mas,1000,1000,public.catalog_asset_path('sku-3ro',i.ident,'master',s.mas)),
      public.catalog_asset_path('sku-3ro', i.ident, 'thumbnail', s.thu), s.thu,
      public.catalog_asset_binding_sha256(i.ident,'thumbnail',s.src,s.thu,400,400,public.catalog_asset_path('sku-3ro',i.ident,'thumbnail',s.thu))
    from (select repeat('ab',32) as src, repeat('cd',32) as mas, repeat('ef',32) as thu) s,
         lateral (select public.catalog_image_identity_sha256('p-3ro','sku-3ro',s.src) as ident) i$$,
  null, null,
  'una imagen de tercero en pending_review no entra al catalogo comercial'
);

-- ── 6 · un producto comercial no puede vestirse con una imagen de QA ───────
select throws_ok(
  $$select pg_temp.alta('sku-con-qa',
      p_asset => (select id from public.catalog_assets where sku = 'sku-qa'),
      p_image_url => (select master_path from public.catalog_assets where sku = 'sku-qa'),
      p_image_sha => (select master_sha256 from public.catalog_assets where sku = 'sku-qa'),
      p_thumb_url => (select thumbnail_path from public.catalog_assets where sku = 'sku-qa'),
      p_thumb_sha => (select thumbnail_sha256 from public.catalog_assets where sku = 'sku-qa'),
      p_source_sha => (select source_sha256 from public.catalog_assets where sku = 'sku-qa'))$$,
  null, null,
  'una imagen UNAPPROVED_QA no puede publicarse en un producto comercial'
);

-- ── 7 · la imagen con derechos en regla sigue publicando igual ─────────────
select lives_ok(
  $$select pg_temp.alta('sku-con-foto',
      p_asset => (select id from public.catalog_assets where sku = 'sku-ok'),
      p_image_url => (select master_path from public.catalog_assets where sku = 'sku-ok'),
      p_image_sha => (select master_sha256 from public.catalog_assets where sku = 'sku-ok'),
      p_thumb_url => (select thumbnail_path from public.catalog_assets where sku = 'sku-ok'),
      p_thumb_sha => (select thumbnail_sha256 from public.catalog_assets where sku = 'sku-ok'),
      p_source_sha => (select source_sha256 from public.catalog_assets where sku = 'sku-ok'))$$,
  'una imagen propia y completa sigue entrando sin friccion'
);

-- ── 8 · lo comercial de siempre sigue fallando cerrado ─────────────────────
select throws_ok(
  $$select pg_temp.alta('sku-sin-precio', p_precio => 0)$$,
  null, null,
  'sin precio no hay publicacion, con o sin foto'
);

select throws_ok(
  $$select pg_temp.alta('sku-sin-stock', p_stock => null)$$,
  null, null,
  'sin stock no hay publicacion, con o sin foto'
);

select throws_ok(
  $$select pg_temp.alta(null)$$,
  null, null,
  'sin sku no hay identidad comercial, y sin identidad no hay publicacion'
);

select throws_ok(
  $$select pg_temp.alta('sku-sin-marca', p_marca => '   ')$$,
  null, null,
  'sin datos maestros no hay publicacion'
);

-- ── Controles negativos ────────────────────────────────────────────────────
select throws_ok(
  $$select pg_temp.alta('sku-fixture', p_origen => 'demo_fixture')$$,
  null, null,
  'la rama de fixtures quedo igual de estricta: sigue exigiendo imagen'
);

-- Tocar la imagen de un producto verificado no lo deja publicado con datos
-- cambiados: le quita la verificacion.
update public.products
   set image_url = null, image_sha256 = null, image_thumbnail_url = null,
       image_thumbnail_sha256 = null, source_image_sha256 = null, catalog_asset_id = null
 where sku = 'sku-con-foto';

select is(
  (select is_verified from public.products where sku = 'sku-con-foto'),
  false,
  'sacarle la foto a un producto verificado lo desverifica (fail-close)'
);

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.products'::regclass and tgname = 'products_assert_asset_origin'),
  1,
  'el trigger que ata el origen del asset al del producto quedo instalado'
);

select * from finish();
rollback;
