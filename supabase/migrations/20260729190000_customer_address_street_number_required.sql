-- Require a street number for every new or edited active saved address.
--
-- Existing invalid rows remain readable because the constraint is NOT VALID.
-- They can still be archived: archived rows are deliberately exempt so cleanup
-- never requires privileged SQL.
--
-- Rollback:
--   alter table public.customer_addresses
--     drop constraint if exists customer_addresses_active_street_number_required;

alter table public.customer_addresses
  drop constraint if exists customer_addresses_active_street_number_required;

alter table public.customer_addresses
  add constraint customer_addresses_active_street_number_required
  check (
    deleted_at is not null
    or char_length(btrim(coalesce(street_number, ''))) between 1 and 24
  ) not valid;
