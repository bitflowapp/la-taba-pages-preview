alter table public.products
  add constraint cp_published_requires_approved_image
  check (
    business_id <> 'e7850ad2-a447-402c-8375-3fd74e9466ba'::uuid
    or not available
    or (catalog_asset_id is not null and image_url is not null)
  );
comment on constraint cp_published_requires_approved_image on public.products is
  'Controlled Production never serves a product without an approved bound catalog image.';
