-- Canonical beverage taxonomy and authoritative alcohol metadata.
--
-- Catalog imports remain fail-closed: rows that do not satisfy this contract
-- may exist while unverified, but they cannot be verified or published.

-- Fail-close any previously verified row that does not satisfy the new
-- canonical contract. Preserve the source data so an owner can correct it.
update public.products
   set available = false,
       is_verified = false,
       verified_at = null,
       verified_by = null
 where is_verified
   and not coalesce((
     category in (
       'Promos',
       'Gaseosas',
       'Aguas',
       'Jugos',
       'Energéticas',
       'Isotónicas',
       'Cervezas',
       'Vinos y espumantes',
       'Gins y vodkas',
       'Whisky y destilados',
       'Picadas y deli',
       'Hielo y extras'
     )
     and (
       (
         category in (
           'Cervezas',
           'Vinos y espumantes',
           'Gins y vodkas',
           'Whisky y destilados'
         )
         and is_alcoholic is true
       )
       or (
         category in (
           'Gaseosas',
           'Aguas',
           'Jugos',
           'Energéticas',
           'Isotónicas',
           'Picadas y deli',
           'Hielo y extras'
         )
         and is_alcoholic is false
       )
       -- A promotion may contain alcohol. Its explicit flag determines
       -- whether age and business alcohol policy apply.
       or (category = 'Promos' and is_alcoholic is not null)
     )
     and (
       (
         is_alcoholic is true
         and minimum_age is not null
         and minimum_age between 18 and 99
       )
       or (is_alcoholic is false and minimum_age is null)
     )
   ), false);

alter table public.products
  drop constraint if exists products_verified_canonical_beverage_category;
alter table public.products
  add constraint products_verified_canonical_beverage_category check (
    not is_verified
    or category in (
      'Promos',
      'Gaseosas',
      'Aguas',
      'Jugos',
      'Energéticas',
      'Isotónicas',
      'Cervezas',
      'Vinos y espumantes',
      'Gins y vodkas',
      'Whisky y destilados',
      'Picadas y deli',
      'Hielo y extras'
    )
  );

alter table public.products
  drop constraint if exists products_verified_alcohol_coherence;
alter table public.products
  add constraint products_verified_alcohol_coherence check (
    not is_verified
    or (
      (
        (
          category in (
            'Cervezas',
            'Vinos y espumantes',
            'Gins y vodkas',
            'Whisky y destilados'
          )
          and is_alcoholic is true
        )
        or (
          category in (
            'Gaseosas',
            'Aguas',
            'Jugos',
            'Energéticas',
            'Isotónicas',
            'Picadas y deli',
            'Hielo y extras'
          )
          and is_alcoholic is false
        )
        or (category = 'Promos' and is_alcoholic is not null)
      )
      and (
        (
          is_alcoholic is true
          and minimum_age is not null
          and minimum_age between 18 and 99
        )
        or (is_alcoholic is false and minimum_age is null)
      )
    )
  );

-- A regular unique index still permits multiple NULL values and is inferable
-- by PostgREST ON CONFLICT. This makes the catalog import one atomic upsert.
drop index if exists public.products_business_external_id_key;
create unique index products_business_external_id_key
on public.products(business_id, external_id);

drop index if exists public.products_business_sku_key;
create unique index products_business_sku_key
on public.products(business_id, sku);

comment on constraint products_verified_canonical_beverage_category on public.products is
  'Verified products use one of the twelve canonical TABA beverage categories.';
comment on constraint products_verified_alcohol_coherence on public.products is
  'Verified alcohol metadata is category-consistent; alcohol requires an age from 18 to 99.';
