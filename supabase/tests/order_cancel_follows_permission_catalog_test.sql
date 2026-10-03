-- TABA · CANCELAR UN PEDIDO SIGUE EL CATÁLOGO DE PERMISOS
--
-- Las dos puertas por las que el comercio cancela o rechaza un pedido (`cancel_order` y
-- `transition_order`) miraban una lista de roles —dueño, encargado y empleado— y no el
-- catálogo de permisos, que le da `orders.cancel` sólo al dueño y al encargado. Un
-- empleado cancelaba y rechazaba pedidos que su propio Panel dice que no puede tocar
-- (AUTHZ-04). Desde 20261002050000 las dos preguntan el permiso.
--
-- Acá se prueba, con cambio real de rol y SIN deshacer cada intento (para poder mirar
-- qué quedó escrito):
--
--   · la negativa del empleado: 42501, su mensaje y su detalle, por las dos puertas y
--     con cualquier forma de escribir el destino;
--   · que sale antes que todo lo demás (el cobro, la clave ya usada, la revisión vieja,
--     el pedido ya cancelado) y que no escribe nada;
--   · que quien no es del comercio recibe exactamente lo de antes;
--   · que el dueño y el encargado cancelan y rechazan como siempre;
--   · lo que no cambió: el empleado sigue haciendo las demás transiciones, y cualquiera
--     —también un empleado— cancela SU propio pedido sin atender por la puerta del
--     cliente;
--   · que las dos funciones conservan firma, seguridad y permisos.
--
-- La matriz completa de quién puede qué está en authorization_matrix_test.sql. El
-- vencimiento automático de pedidos sin atender, que no pasa por estas puertas, sigue
-- cubierto por unattended_order_expiry_test.sql.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table ids (k text primary key, id uuid not null) on commit drop;
create temporary table actores (actor text primary key, db_role text not null, claims text not null) on commit drop;
grant select on ids to anon, authenticated;

do $fixture$
declare
  v_a uuid := 'b19b0000-0000-4000-8000-00000000000a';
  v_b uuid := 'b19b0000-0000-4000-8000-00000000000b';
  v_owner uuid := 'a19b0000-0000-4000-8000-000000000001';
  v_admin uuid := 'a19b0000-0000-4000-8000-000000000002';
  v_staff uuid := 'a19b0000-0000-4000-8000-000000000003';
  v_foreign uuid := 'a19b0000-0000-4000-8000-00000000000a';
  v_c1 uuid := 'a19b0000-0000-4000-8000-0000000000c1';
  v_p1 uuid := 'c19b0000-0000-4000-8000-000000000001';
  v_pb uuid := 'c19b0000-0000-4000-8000-00000000000b';
  v_actor record;
  v_result jsonb;
  v_key text;
  v_order uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values
    (v_owner,'authenticated','authenticated','order-cancel-permission-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_admin,'authenticated','authenticated','order-cancel-permission-admin@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_staff,'authenticated','authenticated','order-cancel-permission-staff@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_foreign,'authenticated','authenticated','order-cancel-permission-ajeno@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_c1,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

  -- El guardián de admisión se apaga: acá se prueba autorización, no cupos.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
    currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values
    (v_a, 'Cancelar con permiso A', 'order-cancel-permission-test-a', 'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'),
    (v_b, 'Cancelar con permiso B', 'order-cancel-permission-test-b', 'open', true, true, true, clock_timestamp(), v_foreign, 'ARS', true, false, 0.00, 0.00, 'off');
  insert into public.business_members(business_id,user_id,role,is_active)
  values (v_a, v_owner, 'owner', true), (v_a, v_admin, 'admin', true), (v_a, v_staff, 'staff', true), (v_b, v_foreign, 'owner', true);

  for v_actor in
    select * from (values
      ('owner', v_owner, v_a, 'owner', 'e19b0000-0000-4000-8000-000000000001'::uuid),
      ('admin', v_admin, v_a, 'admin', 'e19b0000-0000-4000-8000-000000000002'::uuid),
      ('staff', v_staff, v_a, 'staff', 'e19b0000-0000-4000-8000-000000000003'::uuid),
      ('ajeno', v_foreign, v_b, 'owner', 'e19b0000-0000-4000-8000-00000000000a'::uuid)
    ) as t(actor, user_id, business_id, member_role, session_id)
  loop
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values (v_actor.session_id, v_actor.user_id, v_actor.business_id, v_actor.member_role, 'panel_web');
    insert into actores values (v_actor.actor, 'authenticated',
      json_build_object('sub', v_actor.user_id, 'role', 'authenticated', 'session_id', v_actor.session_id)::text);
  end loop;
  insert into actores values
    ('cliente', 'authenticated', json_build_object('sub', v_c1, 'role', 'authenticated', 'is_anonymous', true,
      'session_id', 'e19b0000-0000-4000-8000-0000000000c1')::text);

  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values
    (v_p1,v_a,'Lata Cancelar Permiso','Gaseosas','Cola',1000,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',100,true,true,false,'{}',true,now(),v_owner,
     'order-cancel-permission-lata','order-cancel-permission-lata','commercial',1),
    (v_pb,v_b,'Lata Cancelar Permiso B','Gaseosas','Cola',800,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',100,true,true,false,'{}',true,now(),v_foreign,
     'order-cancel-permission-lata-b','order-cancel-permission-lata-b','commercial',1);
  insert into ids values ('a', v_a), ('b', v_b), ('p1', v_p1), ('owner', v_owner), ('admin', v_admin), ('staff', v_staff);

  -- Pedidos del cliente en A: retiros en efectivo, dos unidades cada uno.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'cliente'), true);
  for v_key in select unnest(array['o_intentos', 'o_aceptado', 'o_cobrado', 'o_ya_cancelado', 'o_dueno', 'o_encargado', 'o_avance']) loop
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', v_a, 'client_request_id', 'cancel-permission-' || replace(v_key, '_', '-') || '-01',
      'tracking_token', md5(v_key) || md5(v_key || 'order-cancel-permission'),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 2)),
      'customer_name', 'Clara Permiso', 'customer_phone', '2994111129',
      'delivery_mode', 'pickup', 'payment_method', 'cash'));
    insert into ids values (v_key, (v_result ->> 'id')::uuid);
  end loop;
  -- Un pedido del mismo cliente en el comercio B.
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_b, 'client_request_id', 'cancel-permission-o-ajeno-01',
    'tracking_token', md5('o_ajeno') || md5('o_ajeno' || 'order-cancel-permission'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_pb, 'quantity', 1)),
    'customer_name', 'Clara Permiso', 'customer_phone', '2994111129',
    'delivery_mode', 'pickup', 'payment_method', 'cash'));
  insert into ids values ('o_ajeno', (v_result ->> 'id')::uuid);

  -- El empleado también compra: un pedido hecho con SU cuenta en su propio comercio.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'staff'), true);
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_a, 'client_request_id', 'cancel-permission-o-del-empleado-01',
    'tracking_token', md5('o_del_empleado') || md5('o_del_empleado' || 'order-cancel-permission'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 2)),
    'customer_name', 'Empleado Que Compra', 'customer_phone', '2994111139',
    'delivery_mode', 'pickup', 'payment_method', 'cash'));
  insert into ids values ('o_del_empleado', (v_result ->> 'id')::uuid);

  -- El dueño deja listos tres pedidos: uno aceptado, uno cobrado y uno ya cancelado.
  perform set_config('request.jwt.claims', (select claims from actores where actor = 'owner'), true);
  select id into v_order from ids where k = 'o_aceptado';
  perform public.transition_order(v_order, (select revision from public.orders where id = v_order), 'accepted', 'cancel-permission-fixture-aceptar');
  select id into v_order from ids where k = 'o_cobrado';
  perform public.confirm_manual_order_payment(v_order, (select revision from public.orders where id = v_order), 'cash', 'cancel-permission-fixture-cobrar');
  select id into v_order from ids where k = 'o_ya_cancelado';
  perform public.cancel_order(v_order, (select revision from public.orders where id = v_order), 'cancelado en el fixture', 'cancel-permission-fixture-cancelar');
  perform set_config('request.jwt.claims', '', true);
end
$fixture$;

-- Lo que el COMMIT de las altas habría verificado.
set constraints all immediate;
set constraints all deferred;

-- ── Herramientas ───────────────────────────────────────────────────────────
create function pg_temp.id(p_key text) returns uuid language sql stable as $$ select id from ids where k = p_key $$;
create function pg_temp.rev(p_order uuid) returns bigint language sql stable security definer as $$
  select o.revision from public.orders o where o.id = p_order $$;

-- Ejecuta la consulta con el rol de base y los claims del actor, SIN deshacerla. Devuelve
-- «ok <valor>» o «<SQLSTATE> <mensaje> [<detalle>]».
create function pg_temp.hacer(p_actor text, p_sql text) returns text
language plpgsql as $$
declare
  v_actor actores%rowtype;
  v_out text;
  v_state text;
  v_message text;
  v_detail text;
begin
  select * into strict v_actor from actores where actor = p_actor;
  begin
    perform set_config('request.jwt.claims', v_actor.claims, true);
    execute format('set local role %I', v_actor.db_role);
    execute p_sql into v_out;
    v_out := 'ok ' || coalesce(v_out, 'NULL');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_out := v_state || ' ' || v_message || case when coalesce(v_detail, '') <> '' then ' [' || v_detail || ']' else '' end;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$$;

-- Todo lo que un comando sobre un pedido puede escribir, en una línea.
create function pg_temp.foto(p_key text) returns text language sql stable as $$
  select format('%s rev=%s eventos=%s recibos=%s stock_devuelto=%s lata=%s',
    o.status, o.revision,
    (select count(*) from public.order_events e where e.order_id = o.id),
    (select count(*) from public.business_command_receipts r where r.order_id = o.id),
    (o.inventory_released_at is not null)::text,
    (select p.stock from public.products p where p.id = pg_temp.id('p1')))
    from public.orders o where o.id = pg_temp.id(p_key) $$;

-- La negativa de permisos, tal como la recibe el cliente de la API.
create function pg_temp.negativa() returns text language sql immutable as $$
  select '42501 operador sin permiso para cancelar o rechazar pedidos [PERMISSION_REQUIRED: orders.cancel]' $$;

-- ══ 1 · LAS DOS PUERTAS CONSERVAN FIRMA, SEGURIDAD Y PERMISOS ═══════════════
select ok(
  has_function_privilege('authenticated', 'public.cancel_order(uuid, bigint, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.cancel_order(uuid, bigint, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.transition_order(uuid, bigint, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.transition_order(uuid, bigint, text, text)', 'EXECUTE'),
  'las dos puertas las ejecuta el equipo autenticado, nunca anon');
select is(
  (select string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' | ' order by p.oid::regprocedure::text)
     from pg_proc p
    where p.oid in ('public.cancel_order(uuid,bigint,text,text)'::regprocedure, 'public.transition_order(uuid,bigint,text,text)'::regprocedure)),
  'cancel_order(uuid,bigint,text,text):true:search_path=pg_catalog, public, extensions, pg_temp | '
  || 'transition_order(uuid,bigint,text,text):true:search_path=pg_catalog, public, extensions, pg_temp',
  'siguen siendo SECURITY DEFINER con el search_path fijo');
-- Preguntar el permiso en las dos puertas alcanza porque las dos autoridades de adentro
-- no se pueden llamar desde afuera.
select ok(
  not has_function_privilege('authenticated', 'public.transition_order(uuid, bigint, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.transition_order(uuid, bigint, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.change_order_status(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.change_order_status(uuid, text, text)', 'EXECUTE'),
  'la transicion de tres argumentos y change_order_status no son ejecutables por ningun cliente');
select ok(
  (select bool_and(p.prosrc ~ 'identity_has_permission\(v_order\.business_id, ''orders\.cancel''\)')
     from pg_proc p
    where p.oid in ('public.cancel_order(uuid,bigint,text,text)'::regprocedure, 'public.transition_order(uuid,bigint,text,text)'::regprocedure)),
  'las dos preguntan el permiso al catalogo (identity_has_permission), no a una lista de roles');

-- ══ 2 · LO QUE DICE EL CATÁLOGO ES LO QUE EL PANEL RECIBE ═══════════════════
select is(
  (select string_agg(p.role, ',' order by p.role) from public.identity_role_permissions p where p.permission = 'orders.cancel'),
  'admin,owner', 'el catalogo le da orders.cancel al dueno y al encargado');
select is(
  (select count(*)::integer from public.identity_permissions p where p.permission ~ '^orders\.' and p.permission ~ 'reject'),
  0, 'el catalogo no tiene un permiso propio para rechazar: rechazar pide orders.cancel');
select is(
  pg_temp.hacer('staff', $q$select (public.identity_current_context(pg_temp.id('a')) -> 'permissions') ? 'orders.cancel'$q$),
  'ok false', 'al empleado, identity_current_context no le lista orders.cancel');
select is(
  pg_temp.hacer('admin', $q$select (public.identity_current_context(pg_temp.id('a')) -> 'permissions') ? 'orders.cancel'$q$),
  'ok true', 'al encargado, si');

-- ══ 3 · LA NEGATIVA DEL EMPLEADO ════════════════════════════════════════════
select set_config('taba.test_intentos_antes', pg_temp.foto('o_intentos'), true);
select is(current_setting('taba.test_intentos_antes'), 'received rev=3 eventos=1 recibos=0 stock_devuelto=false lata=86',
  'el pedido de los intentos: recibido, con sus dos unidades reservadas');

select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'el empleado quiere cancelar', 'cancel-permission-staff-0001') ->> 'status'$q$),
  pg_temp.negativa(), 'cancel_order: 42501, con el permiso que falta en el detalle');
select is(
  pg_temp.hacer('staff', $q$select public.transition_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'cancelled', 'cancel-permission-staff-0002') ->> 'status'$q$),
  pg_temp.negativa(), 'transition_order a cancelled: la misma negativa');
select is(
  pg_temp.hacer('staff', $q$select public.transition_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'rejected', 'cancel-permission-staff-0003') ->> 'status'$q$),
  pg_temp.negativa(), 'transition_order a rejected: la misma negativa');

-- El destino se normaliza igual que en la transición: ninguna forma de escribirlo esquiva
-- la pregunta.
select is(
  (select jsonb_object_agg(d.destino, pg_temp.hacer('staff', format(
       $q$select public.transition_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')), %L, 'cancel-permission-staff-alias') ->> 'status'$q$,
       d.destino)))
     from unnest(array['canceled', 'CANCELLED', '  Cancelled  ', 'Canceled', 'REJECTED', ' rejected ']) as d(destino)),
  (select jsonb_object_agg(d.destino, pg_temp.negativa())
     from unnest(array['canceled', 'CANCELLED', '  Cancelled  ', 'Canceled', 'REJECTED', ' rejected ']) as d(destino)),
  'canceled, CANCELLED, con espacios o con mayusculas: la misma negativa');
-- Un destino que la transición no reconoce tampoco es una forma de cancelar: lo rechaza
-- la transición, como antes.
select is(
  pg_temp.hacer('staff', $q$select public.transition_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    E'cancelled\t', 'cancel-permission-staff-0004') ->> 'status'$q$),
  '22023 estado destino invalido', 'un destino con un tabulador pegado no es «cancelled»: destino invalido, sin cambiar nada');

-- En cualquier estado del pedido.
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_aceptado'), pg_temp.rev(pg_temp.id('o_aceptado')),
    'el empleado quiere cancelar', 'cancel-permission-staff-0005') ->> 'status'$q$),
  pg_temp.negativa(), 'sobre un pedido ya aceptado: la misma negativa');
select is(
  pg_temp.hacer('staff', $q$select public.transition_order(pg_temp.id('o_aceptado'), pg_temp.rev(pg_temp.id('o_aceptado')),
    'rejected', 'cancel-permission-staff-0006') ->> 'status'$q$),
  pg_temp.negativa(), 'rechazar un pedido ya aceptado: la negativa de permisos, no la de la maquina de estados');

-- ══ 4 · SALE ANTES QUE TODO LO DEMÁS ════════════════════════════════════════
-- Antes que la regla del cobro: el dueño llega a ella, el empleado no.
select is(
  pg_temp.hacer('owner', $q$select public.cancel_order(pg_temp.id('o_cobrado'), pg_temp.rev(pg_temp.id('o_cobrado')),
    'cancelar un pedido cobrado', 'cancel-permission-owner-cobrado') ->> 'status'$q$),
  '55000 Devolvé y registrá el cobro manual antes de cancelar el pedido',
  'el dueno, sobre un pedido con el cobro confirmado, recibe la regla del cobro (55000)');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_cobrado'), pg_temp.rev(pg_temp.id('o_cobrado')),
    'cancelar un pedido cobrado', 'cancel-permission-staff-cobrado') ->> 'status'$q$),
  pg_temp.negativa(), 'el empleado, sobre el mismo pedido, recibe la negativa de permisos: no se entera del cobro');

-- Antes que el pedido ya cancelado: para quien puede cancelar es un no-op exitoso; el
-- empleado no recibe ni eso.
select is(
  pg_temp.hacer('admin', $q$select public.cancel_order(pg_temp.id('o_ya_cancelado'), pg_temp.rev(pg_temp.id('o_ya_cancelado')),
    'llego tarde', 'cancel-permission-admin-tarde') ->> 'idempotent_no_op'$q$),
  'ok true', 'el encargado que llega tarde a un pedido ya cancelado recibe un no-op');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_ya_cancelado'), pg_temp.rev(pg_temp.id('o_ya_cancelado')),
    'llego tarde', 'cancel-permission-staff-tarde') ->> 'idempotent_no_op'$q$),
  pg_temp.negativa(), 'el empleado, sobre un pedido ya cancelado, recibe la negativa');
select is(
  pg_temp.hacer('staff', $q$select public.transition_order(pg_temp.id('o_ya_cancelado'), pg_temp.rev(pg_temp.id('o_ya_cancelado')),
    'cancelled', 'cancel-permission-staff-tarde-2') ->> 'idempotent_no_op'$q$),
  pg_temp.negativa(), 'y por transition_order tambien');

-- Antes que la clave ya usada: la clave con la que el dueño canceló no le devuelve al
-- empleado el recibo guardado.
select is(
  pg_temp.hacer('owner', $q$select public.cancel_order(pg_temp.id('o_ya_cancelado'), 3,
    'cancelado en el fixture', 'cancel-permission-fixture-cancelar') ->> 'idempotent_replay'$q$),
  'ok true', 'el dueno repite su cancelacion con la misma clave: recibe el recibo guardado');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_ya_cancelado'), 3,
    'cancelado en el fixture', 'cancel-permission-fixture-cancelar') ->> 'idempotent_replay'$q$),
  pg_temp.negativa(), 'el empleado con esa misma clave: la negativa, no el recibo');

-- Antes que la revisión vieja.
select is(
  pg_temp.hacer('owner', $q$select public.cancel_order(pg_temp.id('o_intentos'), 1, 'con revision vieja', 'cancel-permission-owner-vieja') ->> 'status'$q$),
  'PT409 revision desactualizada: esperada 1, actual 3', 'el dueno con una revision vieja recibe el conflicto (PT409)');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_intentos'), 1, 'con revision vieja', 'cancel-permission-staff-vieja') ->> 'status'$q$),
  pg_temp.negativa(), 'el empleado con la misma revision vieja recibe la negativa de permisos');

-- Lo único que sale antes es lo que ya salía antes de mirar el pedido: los datos del
-- comando mal escritos. No dicen nada del pedido.
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_intentos'), 3, 'no', 'cancel-permission-staff-corto') ->> 'status'$q$),
  '22023 motivo de cancelacion requerido', 'un motivo de dos letras se sigue rechazando por el motivo');
select is(
  pg_temp.hacer('staff', $q$select public.transition_order(pg_temp.id('o_intentos'), 3, 'cancelled', 'corta') ->> 'status'$q$),
  '22023 idempotency_key invalida', 'y una clave mal formada, por la clave');

-- ══ 5 · NINGÚN INTENTO DEL EMPLEADO ESCRIBIÓ NADA ═══════════════════════════
select is(pg_temp.foto('o_intentos'), current_setting('taba.test_intentos_antes'),
  'el pedido de los intentos quedo igual: mismo estado, misma revision, sin eventos ni recibos nuevos, stock sin devolver');
select is(pg_temp.foto('o_aceptado'), 'accepted rev=4 eventos=2 recibos=1 stock_devuelto=false lata=86',
  'el pedido aceptado tambien: sigue aceptado, con el recibo de quien lo acepto');
select is(pg_temp.foto('o_cobrado'), 'received rev=4 eventos=2 recibos=1 stock_devuelto=false lata=86',
  'y el cobrado: sigue recibido y cobrado');
select is(
  (select count(*)::integer from public.business_command_receipts r
    where r.business_id = pg_temp.id('a') and r.actor_user_id = pg_temp.id('staff')),
  0, 'el empleado no dejo ningun recibo en el comercio');

-- ══ 6 · QUIEN NO ES DEL COMERCIO RECIBE LO DE ANTES ═════════════════════════
-- Nada de esto cambió. El dueño de otro comercio recibe «operador no autorizado» sobre un
-- pedido que existe y «pedido inexistente» sobre uno que no: nunca la negativa nueva,
-- que es para quien sí es del comercio.
select is(
  pg_temp.hacer('ajeno', $q$select public.cancel_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'desde otro comercio', 'cancel-permission-ajeno-0001') ->> 'status'$q$),
  '42501 operador no autorizado', 'cancel_order desde otro comercio: operador no autorizado, sin detalle');
select is(
  pg_temp.hacer('ajeno', $q$select public.transition_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'cancelled', 'cancel-permission-ajeno-0002') ->> 'status'$q$),
  '42501 operador no autorizado', 'transition_order a cancelled desde otro comercio: lo mismo');
select is(
  pg_temp.hacer('ajeno', $q$select public.transition_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'rejected', 'cancel-permission-ajeno-0003') ->> 'status'$q$),
  '42501 operador no autorizado', 'y a rejected');
select is(
  pg_temp.hacer('ajeno', $q$select public.cancel_order('00000000-0000-4000-8000-000000000019', 1, 'un pedido que no existe', 'cancel-permission-ajeno-0004') ->> 'status'$q$),
  'P0002 pedido inexistente', 'un pedido que no existe: pedido inexistente, como antes');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order('00000000-0000-4000-8000-000000000019', 1, 'un pedido que no existe', 'cancel-permission-staff-0007') ->> 'status'$q$),
  'P0002 pedido inexistente', 'tambien para el empleado: el permiso se pregunta sobre un pedido que existe');
-- El empleado de A sobre un pedido del comercio B no es «del comercio»: recibe lo mismo
-- que cualquier ajeno.
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_ajeno'), pg_temp.rev(pg_temp.id('o_ajeno')),
    'pedido de otro comercio', 'cancel-permission-staff-0008') ->> 'status'$q$),
  '42501 operador no autorizado', 'el empleado de A sobre un pedido de B: operador no autorizado');
select is(
  pg_temp.hacer('owner', $q$select public.transition_order(pg_temp.id('o_ajeno'), pg_temp.rev(pg_temp.id('o_ajeno')),
    'rejected', 'cancel-permission-owner-ajeno') ->> 'status'$q$),
  '42501 operador no autorizado', 'y el dueno de A tampoco rechaza un pedido de B');
select is(
  pg_temp.hacer('cliente', $q$select public.cancel_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'el cliente por la puerta del comercio', 'cancel-permission-cliente-01') ->> 'status'$q$),
  '42501 operador no autorizado', 'el cliente no usa la puerta del comercio ni sobre su propio pedido');
select is(pg_temp.foto('o_ajeno'), 'received rev=3 eventos=1 recibos=0 stock_devuelto=false lata=86', 'el pedido del comercio B quedo intacto');

-- ══ 7 · EL DUEÑO Y EL ENCARGADO CANCELAN Y RECHAZAN COMO SIEMPRE ════════════
select is(
  pg_temp.hacer('owner', $q$select public.cancel_order(pg_temp.id('o_dueno'), pg_temp.rev(pg_temp.id('o_dueno')),
    'el cliente no viene', 'cancel-permission-owner-0001') ->> 'status'$q$),
  'ok cancelled', 'el dueno cancela');
select is(pg_temp.foto('o_dueno'), 'cancelled rev=4 eventos=3 recibos=1 stock_devuelto=true lata=88',
  'queda cancelado, con su motivo y su recibo, y las 2 unidades vuelven a la gondola');
select is(
  (select e.metadata ->> 'reason' from public.order_events e
    where e.order_id = pg_temp.id('o_dueno') and e.event_type = 'business_cancel_reason'),
  'el cliente no viene', 'el motivo es el que escribio');
select is(
  pg_temp.hacer('owner', $q$select public.cancel_order(pg_temp.id('o_dueno'), 3, 'el cliente no viene', 'cancel-permission-owner-0001') ->> 'idempotent_replay'$q$),
  'ok true', 'repetir con la misma clave devuelve el recibo guardado');
select is(
  pg_temp.hacer('admin', $q$select public.transition_order(pg_temp.id('o_encargado'), pg_temp.rev(pg_temp.id('o_encargado')),
    'rejected', 'cancel-permission-admin-0001') ->> 'status'$q$),
  'ok rejected', 'el encargado rechaza un pedido recien recibido');
select is(pg_temp.foto('o_encargado'), 'rejected rev=4 eventos=2 recibos=1 stock_devuelto=true lata=90',
  'queda rechazado, con su recibo, y sus 2 unidades tambien vuelven');
select is(
  pg_temp.hacer('admin', $q$select public.cancel_order(pg_temp.id('o_aceptado'), pg_temp.rev(pg_temp.id('o_aceptado')),
    'se rompio la heladera', 'cancel-permission-admin-0002') ->> 'status'$q$),
  'ok cancelled', 'el encargado cancela el pedido aceptado que el empleado no pudo cancelar');

-- ══ 8 · LO QUE NO CAMBIÓ: LAS DEMÁS TRANSICIONES ════════════════════════════
select is(
  (select string_agg(pg_temp.hacer('staff', format(
       $q$select public.transition_order(pg_temp.id('o_avance'), pg_temp.rev(pg_temp.id('o_avance')), %L, %L) ->> 'status'$q$,
       d.destino, 'cancel-permission-avance-' || d.destino)), ' / ' order by d.n)
     from unnest(array['accepted', 'preparing', 'ready', 'delivered']) with ordinality as d(destino, n)),
  'ok accepted / ok preparing / ok ready / ok delivered',
  'el empleado sigue llevando un pedido de recibido a entregado');
select is(pg_temp.foto('o_avance'), 'delivered rev=7 eventos=5 recibos=4 stock_devuelto=false lata=92',
  'cuatro transiciones, cuatro eventos y cuatro recibos, a su nombre');
select is(
  pg_temp.hacer('staff', $q$select public.acknowledge_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')), 'cancel-permission-staff-acuse') ->> 'status'$q$),
  'ok received', 'y sigue acusando recibo de un pedido');
select is(
  pg_temp.hacer('staff', $q$select public.confirm_manual_order_payment(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')), 'cash', 'cancel-permission-staff-cobro') ->> 'manual_payment_status'$q$),
  'ok confirmed', 'y cobrando en efectivo');

-- ══ 9 · LO QUE NO CAMBIÓ: EL CLIENTE CANCELA SU PROPIO PEDIDO ═══════════════
-- `cancel_own_order` no pasa por estas puertas ni pide el permiso del comercio: es el
-- derecho del cliente sobre SU pedido sin atender. Vale para cualquiera que haya hecho
-- el pedido, también para un empleado que compró en su propio comercio: como operador
-- no lo puede cancelar; como cliente, sí.
select is(pg_temp.foto('o_del_empleado'), 'received rev=3 eventos=1 recibos=0 stock_devuelto=false lata=92',
  'el pedido que el empleado hizo como cliente: recibido, sin atender');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_del_empleado'), pg_temp.rev(pg_temp.id('o_del_empleado')),
    'es mi propio pedido', 'cancel-permission-staff-propio') ->> 'status'$q$),
  pg_temp.negativa(), 'por la puerta del comercio no lo cancela, aunque sea suyo: no tiene el permiso');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_own_order(pg_temp.id('o_del_empleado'), 'cancel-permission-propio-01', 'me arrepenti') ->> 'status'$q$),
  'ok cancelled', 'por la puerta del cliente si: es su pedido y nadie lo atendio');
select is(pg_temp.foto('o_del_empleado'), 'cancelled rev=4 eventos=3 recibos=0 stock_devuelto=true lata=94',
  'queda cancelado por el cliente, sin recibo de comando del comercio, y su stock vuelve');
select is(
  (select e.actor_role from public.order_events e
    where e.order_id = pg_temp.id('o_del_empleado') and e.event_type = 'order.cancelled_by_customer'),
  'customer', 'y el historial dice que lo cancelo el cliente');
-- La puerta del cliente no es un atajo para los pedidos de otros: el empleado no cancela
-- por ahí el pedido de un cliente, que contesta igual que uno que no existe.
select is(
  pg_temp.hacer('staff', $q$select public.cancel_own_order(pg_temp.id('o_cobrado'), 'cancel-permission-propio-02', 'no es mio') ->> 'status'$q$),
  'P0002 pedido inexistente', 'el pedido de otro cliente, por la puerta del cliente: pedido inexistente');
-- Y el cliente de verdad conserva su derecho, sin sesión de equipo.
select is(
  pg_temp.hacer('cliente', $q$select public.cancel_own_order(pg_temp.id('o_cobrado'), 'cancel-permission-propio-03', 'ya no lo quiero') ->> 'status'$q$),
  '55000 el pedido ya tiene un cobro registrado: pedir la cancelacion al comercio [MANUAL_PAYMENT_RECORDED]',
  'el cliente no cancela solo un pedido que ya pago: tiene que pedirselo al comercio');

-- ══ 10 · EL PERMISO SE LEE EN CADA LLAMADA ══════════════════════════════════
-- No hay nada guardado: en cuanto el catálogo cambia, las dos puertas cambian. (La
-- matriz completa con el permiso dado al rol `staff` está en authorization_matrix_test.sql.)
insert into public.identity_role_permissions(role, permission) values ('staff', 'orders.cancel');
select is(
  pg_temp.hacer('staff', $q$select (public.identity_current_context(pg_temp.id('a')) -> 'permissions') ? 'orders.cancel'$q$),
  'ok true', 'con la fila en el catalogo, al empleado se le lista el permiso');
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'ahora si puedo', 'cancel-permission-staff-0009') ->> 'status'$q$),
  '55000 Devolvé y registrá el cobro manual antes de cancelar el pedido',
  'y pasa la autorizacion: ahora lo frena la regla del cobro, como a cualquiera que puede cancelar');
delete from public.identity_role_permissions where role = 'staff' and permission = 'orders.cancel';
select is(
  pg_temp.hacer('staff', $q$select public.cancel_order(pg_temp.id('o_intentos'), pg_temp.rev(pg_temp.id('o_intentos')),
    'ya no puedo', 'cancel-permission-staff-0010') ->> 'status'$q$),
  pg_temp.negativa(), 'sin la fila, la negativa vuelve en la llamada siguiente');

select * from finish();
rollback;
