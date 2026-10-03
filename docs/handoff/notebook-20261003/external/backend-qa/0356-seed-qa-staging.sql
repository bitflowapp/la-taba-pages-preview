-- Update business controls for staging pilot
update public.businesses
set ordering_enabled = true,
    ordering_verified = true,
    ordering_verified_at = now(),
    ordering_verified_by = (select id from auth.users where email = 'qa-business-staging@local.taba' limit 1),
    status = 'open'
where id = '00000000-0000-4000-8000-000000000001';

-- Business owner membership (owner)
insert into public.business_members (business_id, user_id, role, is_active)
select '00000000-0000-4000-8000-000000000001', u.id, 'owner', true
from auth.users u
where u.email = 'qa-business-staging@local.taba'
on conflict do nothing;

-- Rider membership (rider)
insert into public.business_members (business_id, user_id, role, is_active)
select '00000000-0000-4000-8000-000000000001', u.id, 'rider', true
from auth.users u
where u.email = 'qa-rider-staging@local.taba'
on conflict do nothing;

-- Customer record
insert into public.customers (id, business_id, user_id, name, phone)
select gen_random_uuid(), '00000000-0000-4000-8000-000000000001', u.id, 'QA Cliente TABA', '+5491112345678'
from auth.users u
where u.email = 'qa-customer-staging@local.taba'
on conflict do nothing;

with c as (
  select id
  from public.customers c
  join auth.users u on u.id = c.user_id
  where u.email = 'qa-customer-staging@local.taba'
  order by c.created_at desc
  limit 1
)
insert into public.customer_addresses (customer_id, label, formatted_address, street, street_number, city, province, source, normalized_address, is_default)
select c.id, 'Casa QA', 'Calle Ficticia 123, CABA', 'Calle Ficticia', '123', 'Ciudad Autónoma de Buenos Aires', 'CABA', 'manual', 'calle ficticia 123 caba', true
from c
on conflict do nothing;

-- Seed summary check
select
  (select count(*) from public.business_members where business_id = '00000000-0000-4000-8000-000000000001') as business_members_count,
  (select count(*) from public.customers) as customers_count,
  (select count(*) from public.customer_addresses) as addresses_count,
  (select count(*) from public.products) as products_count,
  (select ordering_enabled from public.businesses where id = '00000000-0000-4000-8000-000000000001') as ordering_enabled,
  (select ordering_verified from public.businesses where id = '00000000-0000-4000-8000-000000000001') as ordering_verified;
