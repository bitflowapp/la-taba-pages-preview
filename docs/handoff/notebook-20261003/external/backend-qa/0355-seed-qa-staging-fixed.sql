begin;

update public.businesses
set
  ordering_enabled = true,
  ordering_verified = true,
  ordering_verified_at = now(),
  ordering_verified_by = (
    select id from auth.users where email = 'qa-business-staging@local.taba' limit 1
  ),
  status = 'open',
  is_active = true,
  currency_code = 'USD',
  delivery_enabled = true,
  pickup_enabled = true,
  delivery_fee = 150,
  minimum_delivery_subtotal = 350
where id = '00000000-0000-4000-8000-000000000001';

insert into public.business_members (business_id, user_id, role, is_active)
select '00000000-0000-4000-8000-000000000001', u.id, 'owner', true
from auth.users u
where u.email = 'qa-business-staging@local.taba'
on conflict (business_id, user_id) do nothing;

insert into public.business_members (business_id, user_id, role, is_active)
select '00000000-0000-4000-8000-000000000001', u.id, 'rider', true
from auth.users u
where u.email = 'qa-rider-staging@local.taba'
on conflict (business_id, user_id) do nothing;

insert into public.customers (id, name, phone)
select u.id, 'QA Cliente TABA', '11234567890'
from auth.users u
where u.email = 'qa-customer-staging@local.taba'
on conflict (id) do update
  set name = excluded.name,
      phone = excluded.phone;

insert into public.customer_addresses (
  customer_id, label, formatted_address, street, street_number, city, province,
  source, normalized_address, is_default
)
select c.id,
       'Casa QA',
       'Calle Ficticia 123, CABA',
       'Calle Ficticia',
       '123',
       'Ciudad Autonoma de Buenos Aires',
       'CABA',
       'manual',
       'calle ficticia 123 caba',
       true
from auth.users c
join public.customers pc on pc.id = c.id
where c.email = 'qa-customer-staging@local.taba'
  and not exists (
    select 1
    from public.customer_addresses a
    where a.customer_id = c.id
      and a.deleted_at is null
  )
on conflict (id) do nothing;

select
  id,
  status,
  is_active,
  ordering_enabled,
  ordering_verified,
  ordering_verified_at is not null as has_ordering_verified_at,
  currency_code,
  delivery_enabled,
  pickup_enabled,
  delivery_fee,
  minimum_delivery_subtotal
from public.businesses
where id = '00000000-0000-4000-8000-000000000001';

select 'business_members' as metric, count(*) as count from public.business_members where business_id = '00000000-0000-4000-8000-000000000001';
select 'customers' as metric, count(*) as count from public.customers;
select 'customer_addresses' as metric, count(*) as count from public.customer_addresses;
commit;
