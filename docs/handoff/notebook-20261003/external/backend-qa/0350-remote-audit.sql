select
  (select count(*) from auth.users) as auth_users_count,
  (select count(*) from public.businesses) as businesses_count,
  (select count(*) from public.business_members) as business_members_count,
  (select count(*) from public.customers) as customers_count,
  (select count(*) from public.customer_addresses) as customer_addresses_count,
  (select count(*) from public.orders) as orders_count,
  (select count(*) from public.order_events) as order_events_count,
  (select count(*) from public.order_public_tokens) as order_public_tokens_count,
  (select count(*) from public.products) as products_count;

select id, ordering_enabled, ordering_verified from public.businesses order by created_at asc;

select schemaname, tablename, rowsecurity from pg_tables
where schemaname in ('public','storage','auth')
and tablename in ('businesses','orders','products','business_members','order_events','order_public_tokens','rider_locations','customer_addresses');
