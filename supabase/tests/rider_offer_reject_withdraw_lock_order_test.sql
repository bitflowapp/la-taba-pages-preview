-- TABA · RECHAZAR O RETIRAR UNA OFERTA DE REPARTO TOMA EL PEDIDO ANTES QUE LA OFERTA (20261002062000)
--
-- Lo que pgTAP puede probar: el orden de candados escrito en las dos definiciones, que las respuestas a una
-- oferta inexistente siguen iguales y que los permisos no cambiaron. Que ofrecer el pedido a otro repartidor
-- contra rechazar (P4) o contra retirar (P5) ya no se traba lo prueban las sondas con la llegada fijada
-- (wp18 repro-4: 40P01 antes, «sin deadlock» después). El comportamiento completo de las dos funciones lo
-- cubren authorization_matrix_test, idempotent_retries_test y order_trace_test.
-- Todo transaccional (rollback).

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ── Orden de candados ─────────────────────────────────────────────────────
select ok(
  (select position('perform 1 from public.orders where id = v_order_id for no key update' in p.prosrc) > 0
      and position('perform 1 from public.orders where id = v_order_id for no key update' in p.prosrc)
        < position('from public.rider_order_offers f where f.id = p_offer_id for update' in p.prosrc)
     from pg_proc p where p.oid = 'public.reject_rider_order_offer(uuid,bigint,text,text)'::regprocedure),
  'rechazar toma el pedido (FOR NO KEY UPDATE) antes que la oferta (FOR UPDATE)');
select ok(
  (select position('la oferta cambio de pedido' in p.prosrc) > 0
     from pg_proc p where p.oid = 'public.reject_rider_order_offer(uuid,bigint,text,text)'::regprocedure),
  'rechazar contesta PT409 si la oferta cambió de pedido entre las dos lecturas');
select ok(
  (select position('perform 1 from public.orders where id = v_offer.order_id for no key update' in p.prosrc) > 0
      and position('perform 1 from public.orders where id = v_offer.order_id for no key update' in p.prosrc)
        < position('update public.rider_order_offers' in p.prosrc)
     from pg_proc p where p.oid = 'public.withdraw_rider_order_offer(uuid)'::regprocedure),
  'retirar toma el pedido (FOR NO KEY UPDATE) antes de actualizar la oferta');

-- ── Respuestas a una oferta inexistente, iguales que antes ────────────────
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select throws_ok($$ select public.reject_rider_order_offer(gen_random_uuid(), 1, null, 'probe-062000-reject-0001') $$,
  'P0002', 'oferta inexistente', 'rechazar una oferta que no existe sigue siendo P0002');
select throws_ok($$ select public.withdraw_rider_order_offer(gen_random_uuid()) $$,
  'P0002', 'oferta inexistente', 'retirar una oferta que no existe sigue siendo P0002');
select throws_ok($$ select public.reject_rider_order_offer(gen_random_uuid(), 1, null, 'corta') $$,
  '22023', null, 'una clave de idempotencia inválida sigue siendo 22023, antes de tocar nada');

-- ── Permisos y configuración, sin cambios ─────────────────────────────────
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in ('public.reject_rider_order_offer(uuid,bigint,text,text)'::regprocedure,
                    'public.withdraw_rider_order_offer(uuid)'::regprocedure)
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')),
  2, 'las dos siguen SECURITY DEFINER con search_path fijado');
select is(
  (select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, 'public.reject_rider_order_offer(uuid,bigint,text,text)'::regprocedure, 'EXECUTE')),
  'authenticated', 'rechazar la ejecuta sólo authenticated');
select is(
  (select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, 'public.withdraw_rider_order_offer(uuid)'::regprocedure, 'EXECUTE')),
  'authenticated', 'retirar la ejecuta sólo authenticated');

select * from finish();
rollback;
