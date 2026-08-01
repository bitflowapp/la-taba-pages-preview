-- STAGING-ONLY continuation of the QA fixture catalog contract.
--
-- QA products need the operational is_verified flag because the authoritative
-- order RPC refuses unpublished products. That flag is deliberately separate
-- from asset rights: QA assets remain UNAPPROVED_QA with no approval stamp.

alter table public.products
  drop constraint if exists products_verified_master_data;
alter table public.products
  add constraint products_verified_master_data check (
    not is_verified
    or (
      catalog_origin in ('demo_fixture', 'test_only', 'staging_only')
      and btrim(name) <> ''
      and brand is not null and btrim(brand) <> ''
      and category is not null and btrim(category) <> ''
      and subcategory is not null and btrim(subcategory) <> ''
      and presentation is not null and btrim(presentation) <> ''
      and capacity is not null and btrim(capacity) <> ''
      and packaging_type is not null and btrim(packaging_type) <> ''
      and price > 0
      and stock is not null
      and is_alcoholic is not null
      and image_url is not null and btrim(image_url) <> ''
    )
    or (
      catalog_origin = 'commercial'
      and btrim(name) <> ''
      and brand is not null and btrim(brand) <> ''
      and category is not null and btrim(category) <> ''
      and subcategory is not null and btrim(subcategory) <> ''
      and presentation is not null and btrim(presentation) <> ''
      and capacity is not null and btrim(capacity) <> ''
      and packaging_type is not null and btrim(packaging_type) <> ''
      and price > 0
      and stock is not null
      and is_alcoholic is not null
      and image_url is not null and btrim(image_url) <> ''
      and verified_at is not null
      and verified_by is not null
    )
  );

comment on constraint products_verified_master_data on public.products is
  'Commercial rows require human verification stamps; staging QA rows may use the operational flag without commercial rights approval.';
