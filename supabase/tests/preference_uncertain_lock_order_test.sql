-- TABA · LA MARCA DE «ENVÍO DUDOSO» DE LA PREFERENCIA (20261002061000)
--
-- Lo que pgTAP sí puede probar: que la marca contesta lo mismo que antes y que toma el cobro antes que el
-- intento (texto de la definición). Que dos llegadas a la vez ya no se traban lo prueban las sondas con la
-- llegada fijada (wp18 repro-5: X1 y X2 daban 40P01 antes y «sin deadlock» después).
-- Todo transaccional (rollback); ids aleatorios; cuentas acotadas a la fixture.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create temporary table pu_ids (name text primary key, id uuid not null) on commit drop;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from pu_ids where name = p_name
$$;

create function pg_temp.usuario(p_name text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
  insert into pu_ids values (p_name, v_id);
  return v_id;
end $$;

create function pg_temp.negocio() returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('owner');
  v_slug text := 'pref-uncertain-' || right(replace(v_business::text, '-', ''), 8);
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, alcohol_sales_enabled
  ) values (
    v_business, 'TABA marca dudosa', v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', false
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata marca dudosa','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    20,true,true,false,null,'{}',true,now(),v_owner,
    v_slug || '-sku',v_slug || '-sku','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-pu-' || v_slug, 'app-pu-' || v_slug, clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-pu-' || v_slug,'app-pu-' || v_slug,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into pu_ids values ('business', v_business), ('product', v_product);
end $$;

-- Sesión con la preferencia PREPARADA (el intento está en camino al proveedor): guarda sesión, cliente,
-- intento (attempt) y cobro (intent) con el prefijo p_name.
create function pg_temp.preparada(p_name text) returns uuid language plpgsql as $$
declare
  v_customer uuid := pg_temp.usuario(p_name || ':customer');
  v_session uuid;
  v_prepare jsonb;
begin
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', pg_temp.id('business'),
    'client_request_id', 'pu_' || md5(p_name || pg_temp.id('business')::text),
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('product'), 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Prueba', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago')) ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  insert into pu_ids values (p_name, v_session), (p_name || ':attempt', (v_prepare ->> 'payment_attempt_id')::uuid);
  insert into pu_ids select p_name || ':intent', pi.id from public.payment_intents pi where pi.checkout_session_id = v_session;
  return v_session;
end $$;

select pg_temp.negocio();
select pg_temp.preparada('a');

-- ── Respuestas, iguales que antes ──────────────────────────────────────────
select is((select internal_status from public.payment_intents where id = pg_temp.id('a:intent')), 'preference_creating',
  'precondición: el cobro está creando la preferencia');
select is(public.record_mercadopago_preference_uncertain(pg_temp.id('a:attempt'), repeat('a', 64), 'network_or_timeout'), true,
  'la marca contesta true');
select is((select status from public.payment_attempts where id = pg_temp.id('a:attempt')), 'ambiguous',
  'el intento queda dudoso');
select is((select internal_status from public.payment_intents where id = pg_temp.id('a:intent')), 'ambiguous',
  'y el cobro que estaba creando la preferencia también');
select is((select last_error_code from public.payment_attempts where id = pg_temp.id('a:attempt')), 'network_or_timeout',
  'con el código de error');
select throws_ok($$ select public.record_mercadopago_preference_uncertain(pg_temp.id('a:attempt'), 'no-es-un-hash', null) $$,
  '22023', null, 'un hash inválido es 22023, como antes');
select throws_ok($$ select public.record_mercadopago_preference_uncertain(gen_random_uuid(), repeat('b', 64), null) $$,
  'P0002', null, 'un intento que no existe es P0002, como antes');

-- Un cobro que ya no está creando la preferencia no cambia de estado (igual que antes).
select pg_temp.preparada('b');
update public.payment_intents set internal_status = 'preference_created' where id = pg_temp.id('b:intent');
select public.record_mercadopago_preference_uncertain(pg_temp.id('b:attempt'), repeat('c', 64), null);
select is((select internal_status from public.payment_intents where id = pg_temp.id('b:intent')), 'preference_created',
  'un cobro con la preferencia ya creada no se degrada');

-- ── Orden de candados: cobro, después intento ─────────────────────────────
select ok(
  (select position('from public.payment_intents where id = v_intent_id for no key update' in p.prosrc) > 0
      and position('from public.payment_intents where id = v_intent_id for no key update' in p.prosrc)
        < position('update public.payment_attempts set status' in p.prosrc)
     from pg_proc p where p.oid = 'public.record_mercadopago_preference_uncertain(uuid,text,text)'::regprocedure),
  'toma el cobro (FOR NO KEY UPDATE) antes de actualizar el intento');
select ok(
  (select position('returning payment_intent_id into v_intent_id' in p.prosrc) = 0
     from pg_proc p where p.oid = 'public.record_mercadopago_preference_uncertain(uuid,text,text)'::regprocedure),
  'ya no actualiza el intento antes de tener el cobro');

-- ── Permisos y configuración, sin cambios ─────────────────────────────────
select ok(
  (select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')
     from pg_proc p where p.oid = 'public.record_mercadopago_preference_uncertain(uuid,text,text)'::regprocedure),
  'sigue SECURITY DEFINER con search_path fijado');
select is(
  (select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, 'public.record_mercadopago_preference_uncertain(uuid,text,text)'::regprocedure, 'EXECUTE')),
  'service_role', 'y sólo service_role la ejecuta');

select * from finish();
rollback;
