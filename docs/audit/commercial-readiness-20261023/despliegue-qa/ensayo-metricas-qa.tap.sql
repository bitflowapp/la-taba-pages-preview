begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(pg_get_functiondef('public.get_production_operation_center(uuid)'::regprocedure) ~ 'order_payment_is_financially_reversed', 'the operation center metrics now exclude refunded open orders');
select is((select count(*)::int from public.orders o where o.business_id = '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01' and o.status in ('submitted','received') and o.created_at >= clock_timestamp() - interval '24 hours'), 1, 'control: LT-0087 counted as new with the old predicate');
select is((select count(*)::int from public.orders o where o.business_id = '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01' and o.status in ('submitted','received') and o.created_at >= clock_timestamp() - interval '24 hours' and not public.order_payment_is_financially_reversed(o.id)), 0, 'with the new predicate LT-0087 is not a new order');
select * from finish();
rollback;
