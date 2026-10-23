-- Preserve existing logic while removing caller-controlled name resolution.
-- All four functions were inspected on the restored schema before this change.
alter function public.set_order_operational_defaults()
  set search_path = pg_catalog, public, pg_temp;
alter function public.set_updated_at()
  set search_path = pg_catalog, public, pg_temp;
alter function public.next_order_public_code()
  set search_path = pg_catalog, public, pg_temp;
alter function public.request_order_token()
  set search_path = pg_catalog, public, pg_temp;
