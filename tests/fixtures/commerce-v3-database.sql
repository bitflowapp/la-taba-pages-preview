-- Minimal private schema fixture for the additive draft migration.
-- The full historical/payment schema remains covered by test:db:isolated.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.businesses(id uuid primary key);
create table public.business_members(business_id uuid references businesses, user_id uuid references auth.users, role text);
create function public.has_business_role(p_business_id uuid, p_roles text[]) returns boolean language sql stable security definer as
  $$ select exists(select 1 from public.business_members where business_id = p_business_id and user_id = auth.uid() and role = any(p_roles)) $$;
create table public.catalog_product_drafts(
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses,
  scanned_gtin text not null, suggested_name text, suggested_brand text, suggested_presentation text,
  suggested_category text, suggested_image text, source text not null, idempotency_key text not null,
  confidence numeric(4,3) default 0, status text not null default 'pending_review',
  created_by uuid not null references auth.users, created_at timestamptz default now(),
  reviewed_by uuid references auth.users, reviewed_at timestamptz, product_id uuid,
  unique(business_id,idempotency_key)
);
create unique index pending_gtin on catalog_product_drafts(business_id,scanned_gtin) where status='pending_review';
alter table public.catalog_product_drafts enable row level security;
create policy draft_read on public.catalog_product_drafts for select to authenticated
  using(public.has_business_role(business_id,array['owner','admin','staff']));
grant usage on schema public, auth to authenticated;
grant select on public.catalog_product_drafts to authenticated;
create table public.product_barcodes(id uuid primary key default gen_random_uuid(), business_id uuid, gtin text, unique(business_id,gtin));
insert into auth.users values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into businesses values('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
insert into business_members values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner');
