-- SET NULL contradicted businesses_ordering_verified_configuration: deleting an
-- Auth verifier failed with CHECK 23514. Retain the verifier and the existing
-- commercial configuration until an authorized operator explicitly retires or
-- reassigns verification. Never silently disable ordering or weaken the CHECK.
-- The same contradiction exists for verified commercial products. Apply the
-- same retention policy to products.verified_by; synthetic data has no bypass.
-- No row is rewritten. The replacement FK is installed/validated before the
-- old FK is removed, in the same transaction. Bound lock waits for hosted QA.
do $migration$
begin
perform set_config('lock_timeout', '5s', true);

alter table public.businesses
  add constraint businesses_ordering_verifier_restrict_fkey
  foreign key (ordering_verified_by) references auth.users(id) on delete restrict;

alter table public.businesses
  drop constraint businesses_ordering_verified_by_fkey;
alter table public.businesses
  rename constraint businesses_ordering_verifier_restrict_fkey to businesses_ordering_verified_by_fkey;

create index if not exists businesses_ordering_verified_by_idx
  on public.businesses(ordering_verified_by) where ordering_verified_by is not null;

comment on constraint businesses_ordering_verified_by_fkey on public.businesses is
  'Retain verification attribution. Retire ordering verification or reassign it explicitly before deleting the Auth verifier.';

alter table public.products
  add constraint products_verifier_restrict_fkey
  foreign key (verified_by) references auth.users(id) on delete restrict;
alter table public.products drop constraint products_verified_by_fkey;
alter table public.products rename constraint products_verifier_restrict_fkey to products_verified_by_fkey;
create index if not exists products_verified_by_idx
  on public.products(verified_by) where verified_by is not null;
comment on constraint products_verified_by_fkey on public.products is
  'Retain catalog verification attribution. Unpublish and retire verification, or reassign it explicitly, before deleting the Auth verifier.';
end $migration$;
