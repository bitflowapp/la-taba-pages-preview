-- Escenario sintético del canal de WhatsApp. SÓLO para una base local
-- desechable: crea un comercio, cuatro productos y un combo con
-- `catalog_origin = 'test_only'`, que es la marca que hace que cualquier pedido
-- nacido de acá quede clasificado como QA y no ensucie la operación real.
--
-- La ventana de venta de alcohol es de día completo A PROPÓSITO. En staging la
-- política real es 20:00-06:00; un test que sólo pasa de noche no prueba el
-- canal, prueba la hora a la que corrió.

do $$
declare
  v_owner uuid := '11000000-0000-4000-8000-000000000001';
  v_business uuid := '21000000-0000-4000-8000-000000000001';
  v_combo uuid := '41000000-0000-4000-8000-000000000001';
  v_product record;
  v_asset uuid;
  v_identity text;
  v_source text;
  v_master text;
  v_thumb text;
begin
  insert into auth.users (
    id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_owner, 'authenticated', 'authenticated', 'wa-owner@taba2.invalid', '',
    '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
  ) on conflict (id) do nothing;

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal,
    alcohol_sales_enabled, alcohol_minimum_age, alcohol_sales_start,
    alcohol_sales_end, alcohol_timezone
  ) values (
    v_business, 'TABA2 canal WhatsApp', 'taba2-canal-whatsapp', 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true,
    true, 1500.00, 5000.00,
    true, 18, '00:00:00', '23:59:59', 'America/Argentina/Buenos_Aires'
  ) on conflict (id) do nothing;

  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true)
  on conflict do nothing;

  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at,
    preference_expiration_minutes, allow_offline_payment_methods
  ) values (
    v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'wa-collector-fixture', 'wa-application-fixture', clock_timestamp(), clock_timestamp(),
    30, false
  ) on conflict (business_id, provider) do nothing;

  for v_product in
    select *
      from (values
        ('31000000-0000-4000-8000-000000000001'::uuid, 'Heineken', 'Heineken Original', 'Cervezas', 'Lager',
         'Lata · 473 ml · Unidad', 473, 'ml', 'lata', 2350.00, 96, true, 18, 10),
        ('31000000-0000-4000-8000-000000000002'::uuid, 'Red Bull', 'Red Bull Energy Drink', 'Energéticas', 'Energizante',
         'Lata · 250 ml · Unidad', 250, 'ml', 'lata', 2100.00, 60, false, null, 20),
        ('31000000-0000-4000-8000-000000000003'::uuid, 'Fernet Branca', 'Fernet Branca', 'Whisky y destilados', 'Fernet',
         'Botella · 750 ml · Unidad', 750, 'ml', 'botella', 12800.00, 24, true, 18, 30),
        ('31000000-0000-4000-8000-000000000004'::uuid, 'Coca-Cola', 'Coca-Cola Original', 'Gaseosas', 'Cola',
         'Botella PET · 1500 ml · Unidad', 1500, 'ml', 'botella', 3200.00, 80, false, null, 40)
      ) as p(id, brand, name, category, subcategory, presentation, capacity_value, capacity_unit,
             packaging_type, price, stock, alcoholic, minimum_age, sort_order)
  loop
    v_asset := gen_random_uuid();
    v_source := encode(digest('wa-source-' || v_product.id::text, 'sha256'), 'hex');
    v_identity := public.catalog_image_identity_sha256(
      'wa-' || v_product.id::text, 'wa-' || replace(lower(v_product.name), ' ', '-'), v_source
    );
    v_master := encode(digest('wa-master-' || v_product.id::text, 'sha256'), 'hex');
    v_thumb := encode(digest('wa-thumb-' || v_product.id::text, 'sha256'), 'hex');

    insert into public.catalog_assets (
      id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
      master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256,
      thumbnail_binding_sha256, source_sha256, source_url, rights_status,
      rights_reference, approved_at, approved_by, catalog_origin
    ) values (
      v_asset, v_business, 'wa-' || v_product.id::text,
      'wa-' || replace(lower(v_product.name), ' ', '-'),
      'wa-' || replace(lower(v_product.name), ' ', '-'),
      v_identity,
      public.catalog_asset_path('wa-' || replace(lower(v_product.name), ' ', '-'), v_identity, 'master', v_master),
      v_master,
      public.catalog_asset_binding_sha256(v_identity, 'master', v_source, v_master, 1000, 1000,
        public.catalog_asset_path('wa-' || replace(lower(v_product.name), ' ', '-'), v_identity, 'master', v_master)),
      public.catalog_asset_path('wa-' || replace(lower(v_product.name), ' ', '-'), v_identity, 'thumbnail', v_thumb),
      v_thumb,
      public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_source, v_thumb, 400, 400,
        public.catalog_asset_path('wa-' || replace(lower(v_product.name), ' ', '-'), v_identity, 'thumbnail', v_thumb)),
      v_source, 'https://example.invalid/wa-fixture.webp', 'UNAPPROVED_QA',
      'canal whatsapp: escenario sintetico local', null, null, 'test_only'
    );

    insert into public.products (
      id, business_id, name, description, category, subcategory, price, image_url,
      is_active, brand, presentation, variant, capacity, capacity_value, capacity_unit,
      packaging_type, stock, available, is_alcoholic, minimum_age, is_verified,
      chilled, units_per_pack, external_id, sku, catalog_asset_id, image_sha256,
      image_thumbnail_url, image_thumbnail_sha256, source_image_sha256,
      catalog_origin, price_status, sort_order, tags
    ) values (
      v_product.id, v_business, v_product.name, 'Escenario sintetico del canal de WhatsApp',
      v_product.category, v_product.subcategory, v_product.price,
      'assets/products/wa-fixture.webp', true, v_product.brand, v_product.presentation,
      v_product.presentation, v_product.capacity_value || ' ' || v_product.capacity_unit,
      v_product.capacity_value, v_product.capacity_unit, v_product.packaging_type,
      v_product.stock, true, v_product.alcoholic, v_product.minimum_age, true,
      false, 1, 'wa-' || v_product.id::text,
      'wa-' || replace(lower(v_product.name), ' ', '-'), v_asset, v_master,
      'assets/products/wa-fixture-thumb.webp', v_thumb, v_source,
      'test_only', 'confirmed', v_product.sort_order,
      array[lower(v_product.subcategory), lower(v_product.brand)]
    );
  end loop;

  insert into public.product_combos (
    id, business_id, combo_id, name, tagline, description, category_id, terms,
    discount_percentage, price_rounding, approval_status, approved_by, approved_at,
    is_active, sort_order
  ) values (
    v_combo, v_business, 'combo-noche-larga', 'Noche larga',
    'Cuatro Heineken y dos Red Bull', 'Cuatro Heineken de 473 ml y dos Red Bull de 250 ml.',
    'cervezas', 'Requiere validacion de mayoria de edad al recibir.',
    12, 100, 'APROBADO_COMERCIAL', v_owner, clock_timestamp(), true, 10
  ) on conflict (business_id, combo_id) do nothing;

  insert into public.product_combo_components (combo_id, product_id, quantity, sort_order)
  values
    (v_combo, '31000000-0000-4000-8000-000000000001', 4, 1),
    (v_combo, '31000000-0000-4000-8000-000000000002', 2, 2)
  on conflict (combo_id, product_id) do nothing;
end;
$$;
