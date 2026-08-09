-- MEDICION de la mitad de despacho: Panel -> Rider -> claim.
-- Depende del fixture del archivo de intake; se redefine aca para poder correr
-- ambos por separado.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.nuevo_usuario(p_prefix text)
returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated', p_prefix || '-' || replace(v_id::text, '-', '') || '@example.invalid',
    '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  return v_id;
end;
$$;

do $$
declare
  v_business uuid := gen_random_uuid();
  v_owner uuid; v_staff uuid; v_rider_a uuid; v_rider_b uuid; v_customer uuid;
  v_order uuid; v_rev bigint; v_code text;
  v_visible integer; v_claim_a jsonb; v_claim_b jsonb; v_asignado uuid;
  v_pipeline record; v_estados text;
begin
  raise notice '';
  raise notice '########## G · PANEL -> RIDER -> CLAIM ##########';
  v_owner := pg_temp.nuevo_usuario('disp-owner');
  v_staff := pg_temp.nuevo_usuario('disp-staff');
  v_rider_a := pg_temp.nuevo_usuario('disp-rider-a');
  v_rider_b := pg_temp.nuevo_usuario('disp-rider-b');
  v_customer := pg_temp.nuevo_usuario('disp-cust');

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'Despacho QA', 'despacho-qa-' || right(replace(v_business::text, '-', ''), 8),
    'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00
  );
  insert into public.business_members (business_id, user_id, role, is_active) values
    (v_business, v_owner, 'owner', true),
    (v_business, v_staff, 'staff', true),
    (v_business, v_rider_a, 'rider', true),
    (v_business, v_rider_b, 'rider', true);

  -- El pedido lleva ubicacion confirmada porque DELIVERY_LOCATION_REQUIRED lo
  -- exige y ese gate no se toca: se satisface como lo haria un pedido real.
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, currency_code, customer_name, customer_phone,
    payment_method, subtotal, discount_total, delivery_fee, total,
    delivery_latitude, delivery_longitude, delivery_location_source, delivery_location_confirmed_at
  ) values (
    v_business, 'QA-DISPATCH-1', 'QA-DISPATCH-1', 'received', 'delivery', 'delivery',
    v_customer, 'qa_dispatch_' || right(replace(v_business::text, '-', ''), 10), 'ARS',
    'Cliente QA', '5492990000000', 'cash', 1000.00, 0, 500.00, 1500.00,
    -38.9539, -68.0596, 'map_pin', clock_timestamp()
  ) returning id, revision into v_order, v_rev;

  -- ---- Panel ve el pedido apenas nace ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  select count(*)::integer into v_visible
    from public.list_operational_pipeline(v_business, true) p
   where p.reference_id = v_order;
  raise notice 'G1 el Panel ve el pedido recien creado: % fila(s)', v_visible;

  select string_agg(p.pipeline_state, ',') into v_estados
    from public.list_operational_pipeline(v_business, true) p where p.reference_id = v_order;
  raise notice 'G2 estado en el vocabulario unico: %', v_estados;

  -- ---- Panel lo mueve hasta listo ----
  perform public.transition_order(v_order, v_rev, 'accepted', 'qa-disp-acc-' || right(replace(v_order::text,'-',''),8));
  select revision into v_rev from public.orders where id = v_order;
  perform public.transition_order(v_order, v_rev, 'preparing', 'qa-disp-pre-' || right(replace(v_order::text,'-',''),8));
  select revision into v_rev from public.orders where id = v_order;
  perform public.transition_order(v_order, v_rev, 'ready', 'qa-disp-rdy-' || right(replace(v_order::text,'-',''),8));
  select revision, status into v_rev, v_code from public.orders where id = v_order;
  raise notice 'G3 el Panel lo dejo en: % (revision %)', v_code, v_rev;

  -- ---- El rider lo ve en su cola ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_rider_a::text, 'role', 'authenticated')::text, true);
  select count(*)::integer into v_visible
    from public.list_available_rider_orders(v_business) o where o.public_code = 'QA-DISPATCH-1';
  raise notice 'G4 el rider A ve el pedido asignable: % fila(s)', v_visible;

  -- ---- Dos riders lo toman: solo uno gana ----
  begin
    v_claim_a := public.claim_delivery_order(v_business, 'QA-DISPATCH-1', v_rev, 'qa-claim-a-' || right(replace(v_order::text,'-',''),8));
    raise notice 'G5 rider A reclama -> %', coalesce(v_claim_a ->> 'ok', v_claim_a::text);
  exception when others then
    raise notice 'G5 rider A reclama -> RECHAZADO (%)', sqlerrm;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_rider_b::text, 'role', 'authenticated')::text, true);
  begin
    v_claim_b := public.claim_delivery_order(v_business, 'QA-DISPATCH-1', v_rev, 'qa-claim-b-' || right(replace(v_order::text,'-',''),8));
    raise notice 'G6 rider B reclama con la MISMA revision -> %', coalesce(v_claim_b ->> 'ok', v_claim_b::text);
  exception when others then
    raise notice 'G6 rider B reclama con la MISMA revision -> RECHAZADO (%)', sqlerrm;
  end;

  select assigned_rider_user_id into v_asignado from public.orders where id = v_order;
  raise notice 'G7 asignado finalmente a: %', case
    when v_asignado = v_rider_a then 'rider A' when v_asignado = v_rider_b then 'rider B'
    when v_asignado is null then 'NADIE' else 'otro' end;
  raise notice 'G8 un solo ganador: %', case when v_asignado is not null then 'SI' else 'NO' end;

  -- ---- Observabilidad de despacho ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  perform public.refresh_operational_alerts(v_business);
  raise notice 'G9 alertas abiertas tras el circuito:';
  for v_pipeline in
    select a.alert_code, a.severity, a.status from public.operational_alerts a
     where a.business_id = v_business order by a.alert_code
  loop
    raise notice '    % [%] %', v_pipeline.alert_code, v_pipeline.severity, v_pipeline.status;
  end loop;
end $$;

-- ============================================================
-- H · Un pedido LISTO que nadie toma: lo ve la operacion?
do $$
declare
  v_business uuid := gen_random_uuid();
  v_owner uuid; v_staff uuid; v_customer uuid; v_order uuid; v_rev bigint;
  v_alertas integer; v_center jsonb;
begin
  raise notice '';
  raise notice '########## H · PEDIDO LISTO SIN RIDER ##########';
  v_owner := pg_temp.nuevo_usuario('h-owner');
  v_staff := pg_temp.nuevo_usuario('h-staff');
  v_customer := pg_temp.nuevo_usuario('h-cust');
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'Listo sin rider', 'listo-sin-rider-' || right(replace(v_business::text, '-', ''), 8),
    'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00
  );
  insert into public.business_members (business_id, user_id, role, is_active) values
    (v_business, v_owner, 'owner', true), (v_business, v_staff, 'staff', true);
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, currency_code, customer_name, customer_phone,
    payment_method, subtotal, discount_total, delivery_fee, total,
    delivery_latitude, delivery_longitude, delivery_location_source, delivery_location_confirmed_at
  ) values (
    v_business, 'QA-LISTO-1', 'QA-LISTO-1', 'ready', 'delivery', 'delivery',
    v_customer, 'qa_listo_' || right(replace(v_business::text, '-', ''), 10), 'ARS',
    'Cliente QA', '5492990000000', 'cash', 1000.00, 0, 500.00, 1500.00,
    -38.9539, -68.0596, 'map_pin', clock_timestamp()
  ) returning id, revision into v_order, v_rev;
  -- Lleva 40 minutos listo y sin rider.
  update public.orders set updated_at = clock_timestamp() - interval '40 minutes',
    created_at = clock_timestamp() - interval '50 minutes' where id = v_order;

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  perform public.refresh_operational_alerts(v_business);
  select count(*)::integer into v_alertas from public.operational_alerts a
   where a.business_id = v_business and a.status <> 'resolved';
  raise notice 'H1 alertas abiertas para un pedido listo hace 40 min sin rider: %', v_alertas;

  v_center := public.get_production_operation_center(v_business);
  raise notice 'H2 metricas: pedidos_nuevos=% demorados=% entregas_activas=%',
    v_center -> 'metrics' ->> 'new_orders',
    v_center -> 'metrics' ->> 'delayed_orders',
    v_center -> 'metrics' ->> 'active_deliveries';
  raise notice 'H3 >>> no hay deteccion de LISTO SIN RIDER; cae en demorados solo por estimacion <<<';
end $$;
