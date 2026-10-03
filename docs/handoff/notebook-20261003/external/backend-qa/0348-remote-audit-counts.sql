select 'auth_users_count' as metric, (select count(*)::text from auth.users) as value
union all
select 'businesses_count', (select count(*)::text from public.businesses)
union all
select 'business_members_count', (select count(*)::text from public.business_members)
union all
select 'customers_count', (select count(*)::text from public.customers)
union all
select 'customer_addresses_count', (select count(*)::text from public.customer_addresses)
union all
select 'orders_count', (select count(*)::text from public.orders)
union all
select 'order_events_count', (select count(*)::text from public.order_events)
union all
select 'order_public_tokens_count', (select count(*)::text from public.order_public_tokens)
union all
select 'products_count', (select count(*)::text from public.products);
