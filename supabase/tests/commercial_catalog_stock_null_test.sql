-- Run read-only against CP after 20260927004045.
select
  public.commercial_catalog_parse_stock('{"stock":null}'::jsonb) is null as explicit_null_stays_null,
  public.commercial_catalog_parse_stock('{}'::jsonb) is null as missing_stays_null,
  public.commercial_catalog_parse_stock('{"stock":0}'::jsonb) = 0 as zero_stays_zero,
  public.commercial_catalog_parse_stock('{"stock":5}'::jsonb) = 5 as five_stays_five;
