-- TABA · DAR DE BAJA A UN CLIENTE NO PUEDE DEPENDER DE QUE NUNCA HAYA PEDIDO DELIVERY
--
-- El defecto (medido en Staging el 2026-10-01): Auth no podía borrar a un cliente
-- con un pedido delivery. La baja cae en cascada hasta `orders.customer_address_id`
-- (ON DELETE SET NULL), que actualiza el pedido; el trigger DIFERIDO
-- `orders_keep_confirmed_delivery_location` corre al confirmar con el rol de la
-- sesión, y su función releía `public.orders` como SECURITY INVOKER: con el rol de
-- Auth, «permission denied for table orders» y 500.
--
-- Acá no se puede asumir el rol `supabase_auth_admin` (en la plataforma `postgres`
-- no es miembro), así que se usa un rol propio con EXACTAMENTE la misma carencia:
-- puede borrar al cliente y no puede leer `orders`. La cascada es la misma y el
-- momento del trigger también: `set constraints all immediate` es lo que hace el
-- COMMIT.
--
-- Segunda mitad del mismo defecto: si RLS le escondía la fila a quien confirmaba,
-- la relectura no encontraba nada y el resguardo se salteaba en silencio.
--
-- Todo transaccional: termina en rollback y no deja una fila ni un rol.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ── Fixture ────────────────────────────────────────────────────────────────
do $fixture$
declare
  v_cliente uuid := 'a6000000-0000-4000-8000-0000000000c1';
  v_ajeno uuid := 'a6000000-0000-4000-8000-0000000000c2';
  v_negocio uuid := 'b6000000-0000-4000-8000-0000000000c1';
  v_direccion uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (v_cliente,'authenticated','authenticated','baja-cliente@example.invalid','',now(),'{}','{}',now(),now()),
    (v_ajeno,'authenticated','authenticated','baja-ajeno@example.invalid','',now(),'{}','{}',now(),now());

  insert into public.businesses(id,name,status,slug,is_active,currency_code)
  values (v_negocio,'TABA baja de cliente','open','taba-baja-de-cliente',true,'ARS');

  -- La dirección la guarda el propio cliente, por el contrato de la vidriera.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cliente, 'role', 'authenticated')::text, true);
  perform public.upsert_current_customer_profile('Cliente Baja', '2996209137');
  v_direccion := (public.upsert_current_customer_address(jsonb_build_object(
    'label','Casa','street','Calle Baja','streetNumber','100','city','Neuquen','neighborhood','Centro',
    'latitude',-38.9516,'longitude',-68.0591,'geolocationAccuracy',10,'source','gps',
    'locationSource','map_pin','locationConfirmedAt',clock_timestamp(),'isDefault',true
  )) -> 'address' ->> 'id')::uuid;
  perform set_config('request.jwt.claims', '', true);

  -- Un delivery con el punto confirmado, atado a la dirección guardada, y un retiro.
  insert into public.orders(
    id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,
    customer_name,customer_neighborhood,customer_street_address,customer_phone,payment_method,
    subtotal,delivery_fee,total,customer_user_id,customer_address_id,
    delivery_latitude,delivery_longitude,delivery_location_source,delivery_location_confirmed_at
  ) values (
    'd6000000-0000-4000-8000-0000000000c1',v_negocio,'BAJA-1','BAJA-1','delivered','delivery','delivery','baja-request-0001',
    'CLIENTE_SINTETICO_NO_CACHEAR','Centro','Calle Baja 100','2996209137','cash',
    1000,0,1000,v_cliente,v_direccion,
    -38.9516,-68.0591,'map_pin',clock_timestamp()
  );
  insert into public.orders(
    id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,
    customer_name,customer_phone,payment_method,subtotal,delivery_fee,total,customer_user_id
  ) values (
    'd6000000-0000-4000-8000-0000000000c2',v_negocio,'BAJA-2','BAJA-2','delivered','pickup','pickup','baja-request-0002',
    'CLIENTE_SINTETICO_NO_CACHEAR','2996209137','cash',1000,0,1000,v_cliente
  );
end
$fixture$;

-- Lo que el COMMIT de las altas habría verificado; a partir de acá los triggers
-- diferidos que se disparen son sólo los de este test.
set constraints all immediate;
set constraints all deferred;

-- ══ 1 · EL CONTRATO DE LA FUNCIÓN ═══════════════════════════════════════════
select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.enforce_confirmed_delivery_location()'::regprocedure),
  'el resguardo del punto de entrega corre como su dueño (SECURITY DEFINER)');

select ok(
  exists (select 1 from pg_proc p, unnest(coalesce(p.proconfig, '{}')) cfg
           where p.oid = 'public.enforce_confirmed_delivery_location()'::regprocedure and cfg like 'search_path=%'),
  'y con el search_path fijado');

select ok(
  not has_function_privilege('anon', 'public.enforce_confirmed_delivery_location()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enforce_confirmed_delivery_location()', 'EXECUTE'),
  'ningun rol de cliente la ejecuta: es una funcion de trigger');

select is(
  (select count(*)::integer from pg_trigger t
    where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgdeferrable
      and t.tgfoid = 'public.enforce_confirmed_delivery_location()'::regprocedure),
  2, 'sus dos triggers diferidos siguen atados: alta y actualizacion');

-- La clase entera, no sólo este caso: un trigger diferido corre con el rol de la
-- sesión que confirma, así que su función no puede ser SECURITY INVOKER.
select is(
  (select count(*)::integer
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and t.tgdeferrable
      and n.nspname in ('public', 'private')
      and not p.prosecdef),
  0, 'ningun trigger diferido de la aplicacion depende del rol de quien confirma');

-- ══ 2 · LA BAJA, CON UN ROL QUE NO PUEDE LEER `orders` ══════════════════════
create role taba_qa_baja_sin_orders nologin;
grant taba_qa_baja_sin_orders to current_user with set true;
grant select, delete on public.customers to taba_qa_baja_sin_orders;
create policy "qa baja sin orders" on public.customers
  for all to taba_qa_baja_sin_orders using (true) with check (true);

select ok(
  not has_table_privilege('taba_qa_baja_sin_orders', 'public.orders', 'SELECT'),
  'el rol que hace de Auth no puede leer orders: la misma carencia que supabase_auth_admin');

do $baja$
begin
  execute 'set local role taba_qa_baja_sin_orders';
  delete from public.customers where id = 'a6000000-0000-4000-8000-0000000000c1';
  -- Lo que hace el COMMIT de Auth: disparar los triggers diferidos con SU rol.
  set constraints all immediate;
  execute 'reset role';
  perform set_config('taba.test_baja', 'ok', true);
exception when others then
  -- El subbloque se deshace entero: vuelve el rol y vuelve el cliente.
  perform set_config('taba.test_baja', sqlstate || ': ' || sqlerrm, true);
end
$baja$;

select is(
  current_setting('taba.test_baja', true), 'ok',
  'la baja de un cliente con un pedido delivery confirma aunque quien la haga no pueda leer orders');

select is(
  (select count(*)::integer from public.orders
    where id in ('d6000000-0000-4000-8000-0000000000c1', 'd6000000-0000-4000-8000-0000000000c2')),
  2, 'los pedidos del cliente no se borran con el');

select ok(
  (select o.customer_address_id is null
          and o.delivery_latitude is not null and o.delivery_longitude is not null
          and o.delivery_location_source = 'map_pin' and o.delivery_location_confirmed_at is not null
     from public.orders o where o.id = 'd6000000-0000-4000-8000-0000000000c1'),
  'el delivery pierde el vinculo con la direccion guardada y conserva su punto de entrega');

-- El final de la cascada real: Auth borra al usuario y los pedidos quedan sin dueño.
delete from auth.users where id = 'a6000000-0000-4000-8000-0000000000c1';
set constraints all immediate;
set constraints all deferred;

select is(
  (select count(*)::integer from public.orders
    where id in ('d6000000-0000-4000-8000-0000000000c1', 'd6000000-0000-4000-8000-0000000000c2')
      and customer_user_id is null),
  2, 'borrar el usuario desvincula sus dos pedidos y los conserva como registro del comercio');

-- ══ 3 · EL RESGUARDO VALE AUNQUE RLS LE ESCONDA LA FILA A QUIEN CONFIRMA ════
-- Una escritura con privilegios (como las de las RPC) llamada por alguien que no
-- puede ver el pedido. Antes la relectura no encontraba la fila y dejaba pasar un
-- delivery sin punto de entrega.
create function public.taba_test_borrar_punto(p_order uuid)
returns void language sql security definer set search_path = pg_catalog, public as $$
  update public.orders
     set delivery_location_confirmed_at = null, delivery_location_source = null,
         delivery_latitude = null, delivery_longitude = null
   where id = p_order;
$$;
grant execute on function public.taba_test_borrar_punto(uuid) to authenticated;

do $punto$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a6000000-0000-4000-8000-0000000000c2', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.taba_test_borrar_punto('d6000000-0000-4000-8000-0000000000c1');
  set constraints all immediate;
  execute 'reset role';
  perform set_config('taba.test_punto', 'aceptado', true);
exception when others then
  perform set_config('taba.test_punto', sqlstate, true);
end
$punto$;

select is(
  current_setting('taba.test_punto', true), '23514',
  'un delivery no puede quedarse sin punto de entrega aunque quien confirma no vea el pedido');

select ok(
  (select o.delivery_location_confirmed_at is not null and o.delivery_latitude is not null
     from public.orders o where o.id = 'd6000000-0000-4000-8000-0000000000c1'),
  'y el punto confirmado sigue intacto');

select * from finish();
rollback;
