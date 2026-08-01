-- Verificación EN VIVO del Gate 1 contra Supabase staging (ukxqbgswjlibmnjemrzd).
--
-- Ejecutar con la migración 20260801020000 YA aplicada:
--   npx supabase db query --linked --file supabase/gate1-live-verification.sql
--
-- Todo corre dentro de una transacción que termina en ROLLBACK: no deja
-- pedidos, eventos, cambios de estado ni de stock en staging. Cada
-- comprobación falla ruidosamente con `raise exception` en vez de devolver una
-- fila que alguien podría pasar por alto. Los actores se simulan con
-- request.jwt.claims (is_local), que es lo que lee auth.uid().

begin;

do $gate1$
declare
  v_order public.orders%rowtype;
  v_before bigint;
  v_after bigint;
  v_rev_at_start bigint;
  v_seq_a bigint;
  v_seq_b bigint;
  v_created_a timestamptz;
  v_created_b timestamptz;
  v_business_id uuid;
  v_customer uuid;
  v_other_customer uuid;
  v_rider uuid;
  v_outsider uuid;
  v_visible integer;
  v_result jsonb;
  v_sqlstate text;
  v_events_before integer;
  v_report text := '';
  v_orders_before integer;
begin
  -- ===== 0. Preflight =====
  if to_regclass('public.order_events_sequence_seq') is null
     or to_regprocedure('public.transition_order(uuid, bigint, text)') is null
     or not exists (select 1 from pg_trigger where tgname='orders_zz_bump_revision' and not tgisinternal)
     or not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='orders' and column_name='revision') then
    raise exception 'FALLA PREFLIGHT: la migración 20260801020000 no está aplicada.';
  end if;
  if (select relreplident from pg_class where oid='public.orders'::regclass) <> 'f'
     or (select relreplident from pg_class where oid='public.order_events'::regclass) <> 'f' then
    raise exception 'FALLA PREFLIGHT: replica identity no es full.';
  end if;
  v_report := v_report || E'
' || format('OK 0. Preflight: migración aplicada y replica identity full.');

  select count(*) into v_orders_before from public.orders;
  select count(*) into v_events_before from public.order_events;

  -- Actores reales de staging.
  select o.* into v_order from public.orders o where o.status = 'on_the_way' order by created_at limit 1;
  if not found then
    raise exception 'FALLA: no hay un pedido no terminal para ejercitar transiciones.';
  end if;
  v_business_id := v_order.business_id;
  v_customer := v_order.customer_user_id;
  v_rider := v_order.assigned_rider_user_id;
  v_rev_at_start := v_order.revision;

  select customer_user_id into v_other_customer
    from public.orders
   where customer_user_id is distinct from v_customer and customer_user_id is not null
   limit 1;

  select id into v_outsider from auth.users
   where id <> v_customer and id is distinct from v_other_customer
     and id not in (select user_id from public.business_members)
   limit 1;

  -- ===== 1. Backfill de sequence =====
  if exists (select 1 from public.order_events where sequence is null) then
    raise exception 'FALLA 1: hay eventos con sequence nula.';
  end if;
  if (select count(*) from public.order_events) <> (select count(distinct sequence) from public.order_events) then
    raise exception 'FALLA 1: hay sequence duplicadas.';
  end if;
  v_report := v_report || E'
' || format('OK 1. Backfill: %s eventos, sin nulos ni duplicados.', v_events_before);

  -- ===== 2. Revisión monótona =====
  v_before := v_order.revision;
  update public.orders set customer_notes = coalesce(customer_notes,'') || ' g1'
   where id = v_order.id;
  select revision into v_after from public.orders where id = v_order.id;
  if v_after <> v_before + 1 then
    raise exception 'FALLA 2: revisión % -> %, se esperaba %', v_before, v_after, v_before + 1;
  end if;
  v_report := v_report || E'
' || format('OK 2. Revisión monótona: %s -> %s.', v_before, v_after);

  -- 2b. UPDATE sin cambios no consume revisión.
  v_before := v_after;
  update public.orders set customer_notes = customer_notes where id = v_order.id;
  select revision into v_after from public.orders where id = v_order.id;
  if v_after <> v_before then
    raise exception 'FALLA 2b: UPDATE no-op movió la revisión % -> %', v_before, v_after;
  end if;
  v_report := v_report || E'
' || format('OK 2b. UPDATE sin cambios no consume revisión (sigue en %s).', v_after);

  -- 2c. Revisión forjada por el cliente se ignora.
  v_before := v_after;
  update public.orders set revision = 999999, customer_notes = coalesce(customer_notes,'') || '!'
   where id = v_order.id;
  select revision into v_after from public.orders where id = v_order.id;
  if v_after <> v_before + 1 then
    raise exception 'FALLA 2c: revisión forjada aceptada (quedó en %, se esperaba %)', v_after, v_before + 1;
  end if;
  v_report := v_report || E'
' || format('OK 2c. Revisión forjada ignorada: quedó en %s.', v_after);

  -- ===== 3/4. Sequence única + created_at idéntico =====
  insert into public.order_events (order_id, business_id, actor_role, actor_type, event_type, type, message)
  values (v_order.id, v_business_id, 'system','system','gate1.probe.a','gate1.probe.a','a')
  returning sequence, created_at into v_seq_a, v_created_a;
  insert into public.order_events (order_id, business_id, actor_role, actor_type, event_type, type, message)
  values (v_order.id, v_business_id, 'system','system','gate1.probe.b','gate1.probe.b','b')
  returning sequence, created_at into v_seq_b, v_created_b;

  if v_seq_a = v_seq_b or v_seq_b <= v_seq_a then
    raise exception 'FALLA 3: sequence no desempata (% vs %)', v_seq_a, v_seq_b;
  end if;
  v_report := v_report || E'
' || format('OK 3. Sequence única y creciente en la misma transacción: %s < %s.', v_seq_a, v_seq_b);

  if v_created_a <> v_created_b then
    raise exception 'FALLA 4: created_at NO empató (% vs %); revisar el supuesto de la auditoría.', v_created_a, v_created_b;
  end if;
  v_report := v_report || E'
' || format('OK 4. created_at IDÉNTICO (%s) con sequence mayor: confirma en vivo la causa raíz.', v_created_a);

  -- ===== 5. Rechazo de revisión vieja (CAS) =====
  select revision into v_after from public.orders where id = v_order.id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rider, 'role','authenticated')::text, true);
  begin
    v_result := public.transition_order(v_order.id, v_after - 1, 'arriving');
    raise exception 'FALLA 5: transition_order aceptó una revisión vieja.';
  exception
    when sqlstate '40001' then
      v_report := v_report || E'
' || format('OK 5. Revisión desactualizada rechazada con 40001.');
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise exception 'FALLA 5: se esperaba 40001 y llegó %.', v_sqlstate;
  end;

  -- ===== 6. CAS con la revisión correcta aplica la transición =====
  select revision into v_before from public.orders where id = v_order.id;
  v_result := public.transition_order(v_order.id, v_before, 'arriving');
  select revision, status into v_after, v_order.status from public.orders where id = v_order.id;
  if v_order.status <> 'arrived' then
    raise exception 'FALLA 6: el estado quedó en % y se esperaba arrived.', v_order.status;
  end if;
  if v_after <= v_before then
    raise exception 'FALLA 6: la transición no incrementó la revisión (% -> %)', v_before, v_after;
  end if;
  if (v_result ->> 'idempotent_no_op') <> 'false' then
    raise exception 'FALLA 6: una transición real se marcó como no-op.';
  end if;
  v_report := v_report || E'
' || format('OK 6. CAS correcto: on_the_way -> arrived (vocabulario arriving), revisión %s -> %s.', v_before, v_after);

  -- ===== 7. Doble toque idempotente =====
  select revision into v_before from public.orders where id = v_order.id;
  v_result := public.transition_order(v_order.id, v_before, 'arriving');
  select revision into v_after from public.orders where id = v_order.id;
  if (v_result ->> 'idempotent_no_op') <> 'true' then
    raise exception 'FALLA 7: el doble toque no se reportó como no-op.';
  end if;
  if v_after <> v_before then
    raise exception 'FALLA 7: el doble toque consumió revisión (% -> %)', v_before, v_after;
  end if;
  if (select count(*) from public.order_events
       where order_id = v_order.id and event_type = 'order.status_changed'
         and created_at >= v_created_a) > 1 then
    raise exception 'FALLA 7: el doble toque emitió un evento extra.';
  end if;
  v_report := v_report || E'
' || format('OK 7. Doble toque idempotente: sin evento y sin consumir revisión (sigue en %s).', v_after);

  -- ===== 8. Transición inválida =====
  select revision into v_before from public.orders where id = v_order.id;
  begin
    v_result := public.transition_order(v_order.id, v_before, 'preparing');
    raise exception 'FALLA 8: se aceptó arrived -> preparing.';
  exception
    when sqlstate '23514' then
      v_report := v_report || E'
' || format('OK 8. Transición inválida arrived -> preparing rechazada con 23514.');
    when sqlstate '42501' then
      v_report := v_report || E'
' || format('OK 8. Transición inválida rechazada por rol con 42501.');
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise exception 'FALLA 8: se esperaba 23514/42501 y llegó %.', v_sqlstate;
  end;

  -- ===== 9. Actor no autorizado =====
  if v_outsider is null then
    raise exception 'FALLA 9: no hay un usuario ajeno para probar autorización.';
  end if;
  select revision into v_before from public.orders where id = v_order.id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role','authenticated')::text, true);
  begin
    v_result := public.transition_order(v_order.id, v_before, 'delivered');
    raise exception 'FALLA 9: un usuario ajeno cambió el estado del pedido.';
  exception
    when sqlstate '42501' then
      v_report := v_report || E'
' || format('OK 9. Actor no autorizado rechazado con 42501.');
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise exception 'FALLA 9: se esperaba 42501 y llegó %.', v_sqlstate;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- ===== 10. RLS: sin policies de escritura + aislamiento entre clientes =====
  if exists (select 1 from pg_policies where schemaname='public' and tablename='orders'
              and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
    raise exception 'FALLA 10: orders tiene una policy de escritura.';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.orders'::regclass) then
    raise exception 'FALLA 10: RLS no está habilitado en orders.';
  end if;

  if v_other_customer is null then
    raise exception 'FALLA 10: no hay un segundo cliente para probar aislamiento.';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_customer, 'role','authenticated')::text, true);
  select count(*) into v_visible from public.orders where id = v_order.id;
  if v_visible <> 0 then
    raise exception 'FALLA 10: el cliente % ve el pedido de %.', v_other_customer, v_customer;
  end if;
  -- El dueño legítimo sí debe verlo: si no, la policy sería inútilmente cerrada.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role','authenticated')::text, true);
  select count(*) into v_visible from public.orders where id = v_order.id;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_visible <> 1 then
    raise exception 'FALLA 10: el dueño del pedido no puede verlo.';
  end if;
  v_report := v_report || E'
' || format('OK 10. RLS: sin policies de escritura; cliente ajeno no ve el pedido y el dueño sí.');

  raise exception 'GATE1_ALL_CHECKS_PASSED%', v_report;
end;
$gate1$;

rollback;

-- ===== 11. Rollback completo: el estado de staging quedó intacto =====
select
  (select count(*) from public.orders) as orders_after,
  (select count(*) from public.order_events) as events_after,
  (select count(*) from public.order_events
    where event_type in ('gate1.probe.a','gate1.probe.b')) as synthetic_events_left,
  (select string_agg(code || '=' || status || ' r' || revision, ' | ' order by code)
     from public.orders) as orders_state,
  (select count(*) from public.order_events where sequence is null) as null_sequences;
