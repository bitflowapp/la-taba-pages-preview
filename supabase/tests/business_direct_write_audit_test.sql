-- TABA · LA ESCRITURA DIRECTA SOBRE `businesses` QUEDA AUDITADA
--
-- owner y admin tienen UPDATE por columna sobre 25 columnas de `businesses`. El
-- trigger de auditoría sólo miraba el envío, el mínimo y las exigencias: habilitar la
-- venta de alcohol, sacar los topes contra el abuso, pausar el comercio o cambiarle la
-- moneda con un PATCH no dejaba ninguna fila.
--
-- Acá se prueba, con cambio real de rol:
--   · que CADA columna del permiso está cubierta por la auditoría (si mañana se
--     concede una columna más, esta prueba falla hasta que se la audite);
--   · una fila por ámbito, con antes, después y actor;
--   · que las RPC que ya auditaban siguen escribiendo UNA fila, no dos;
--   · que la moneda de un comercio verificado no la cambia nadie;
--   · que quien no es owner ni admin sigue sin poder escribir.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a8000000-0000-4000-8000-0000000000a1','authenticated','authenticated','escritura-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a8000000-0000-4000-8000-0000000000a2','authenticated','authenticated','escritura-admin@example.invalid','',now(),'{}','{}',now(),now()),
  ('a8000000-0000-4000-8000-0000000000a3','authenticated','authenticated','escritura-staff@example.invalid','',now(),'{}','{}',now(),now()),
  ('a8000000-0000-4000-8000-0000000000a4','authenticated','authenticated','escritura-ajeno@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses (
  id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
  currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, address, phone,
  operating_timezone, delivery_zone_enforced
) values
  -- V: verificado y abierto. Con la cobertura exigida y una zona (más abajo): un comercio
  -- verificado no enciende el delivery sin eso (20261001216000), y acá se audita ese encendido.
  ('b8000000-0000-4000-8000-0000000000a1','Escritura V','escritura-directa-v','open',true,true,true,clock_timestamp(),
   'a8000000-0000-4000-8000-0000000000a1','ARS',true,false,0,0,'Calle Uno 100, Neuquen','2990000001','America/Argentina/Buenos_Aires',true),
  -- U: todavía sin verificar
  ('b8000000-0000-4000-8000-0000000000a2','Escritura U','escritura-directa-u','closed',true,false,false,null,
   null,'ARS',true,false,null,null,'Calle Dos 200, Neuquen',null,'America/Argentina/Buenos_Aires',false),
  -- F: otro comercio
  ('b8000000-0000-4000-8000-0000000000a3','Escritura F','escritura-directa-f','open',true,false,false,null,
   null,'ARS',true,false,null,null,null,null,'America/Argentina/Buenos_Aires',false);

insert into public.delivery_zones(id,business_id,name,is_active,match_kind,area_normalized,boundary,delivery_fee,minimum_subtotal,priority)
values ('d8000000-0000-4000-8000-0000000000a1','b8000000-0000-4000-8000-0000000000a1','Centro',true,'declared_area','centro',null,800,0,10);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b8000000-0000-4000-8000-0000000000a1','a8000000-0000-4000-8000-0000000000a1','owner',true),
  ('b8000000-0000-4000-8000-0000000000a1','a8000000-0000-4000-8000-0000000000a2','admin',true),
  ('b8000000-0000-4000-8000-0000000000a1','a8000000-0000-4000-8000-0000000000a3','staff',true),
  ('b8000000-0000-4000-8000-0000000000a2','a8000000-0000-4000-8000-0000000000a1','owner',true),
  ('b8000000-0000-4000-8000-0000000000a3','a8000000-0000-4000-8000-0000000000a4','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c8000000-0000-4000-8000-0000000000a1','a8000000-0000-4000-8000-0000000000a1','b8000000-0000-4000-8000-0000000000a1','owner','panel_web'),
  ('c8000000-0000-4000-8000-0000000000a2','a8000000-0000-4000-8000-0000000000a2','b8000000-0000-4000-8000-0000000000a1','admin','panel_web'),
  ('c8000000-0000-4000-8000-0000000000a3','a8000000-0000-4000-8000-0000000000a3','b8000000-0000-4000-8000-0000000000a1','staff','panel_web'),
  ('c8000000-0000-4000-8000-0000000000a4','a8000000-0000-4000-8000-0000000000a4','b8000000-0000-4000-8000-0000000000a3','owner','panel_web'),
  ('c8000000-0000-4000-8000-0000000000a5','a8000000-0000-4000-8000-0000000000a1','b8000000-0000-4000-8000-0000000000a2','owner','panel_web');

create function pg_temp.como(p_user text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;

-- Cuántas filas de un ámbito tiene el comercio V, y la última.
create function pg_temp.filas(p_scope text, p_business uuid default 'b8000000-0000-4000-8000-0000000000a1')
returns integer language sql as $$
  select count(*)::integer from public.business_config_audit a where a.business_id = p_business and a.scope = p_scope;
$$;
create function pg_temp.ultima(p_scope text, p_business uuid default 'b8000000-0000-4000-8000-0000000000a1')
returns jsonb language sql as $$
  select jsonb_build_object('action', a.action, 'actor_kind', a.actor_kind, 'actor_id', a.actor_id,
                            'before', a.before, 'after', a.after)
    from public.business_config_audit a
   where a.business_id = p_business and a.scope = p_scope
   order by a.id desc limit 1;
$$;

-- ══ 1 · LA COBERTURA ES TOTAL ═══════════════════════════════════════════════
-- La lista de la derecha son las columnas que la auditoría cubre. Si el permiso
-- crece, esta prueba obliga a auditar la columna nueva antes de pasar.
select bag_eq(
  $$select column_name::text from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'businesses'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'$$,
  $$values
     ('delivery_fee'), ('minimum_delivery_subtotal'),
     ('alcohol_sales_enabled'), ('alcohol_minimum_age'), ('alcohol_sales_start'), ('alcohol_sales_end'), ('alcohol_timezone'),
     ('order_rate_limit_per_10_minutes'), ('max_pending_orders_per_customer'), ('stock_reservation_minutes'),
     ('abandoned_order_minutes'), ('captcha_required'), ('order_ip_rate_limit_per_10_minutes'),
     ('max_pending_orders_per_ip'), ('order_business_rate_limit_per_10_minutes'), ('max_units_per_unpaid_order'),
     ('currency_code'),
     ('status'), ('is_active'), ('ordering_enabled'),
     ('delivery_enabled'), ('pickup_enabled'),
     ('name'), ('address'), ('phone')$$,
  'CAT-08: cada columna que authenticated puede escribir en businesses esta cubierta por la auditoria');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('audit_business_commercial_change', 'audit_business_direct_write', 'guard_business_currency_code')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'las funciones de trigger no son ejecutables por un cliente');

select ok(
  (select bool_and(pg_get_constraintdef(c.oid) like '%''' || s || '''%')
     from pg_constraint c,
          unnest(array['hours','exception','zone','delivery_pricing','enforcement','permission','payments','printing',
                       'fulfillment','contact','open_state','platform_verification','alcohol','abuse_limits','currency']) s
    where c.conname = 'business_config_audit_scope_check'),
  'los ambitos nuevos se sumaron a los doce que ya existian: no se perdio ninguno');

-- ══ 2 · ALCOHOL ═════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.como('a8000000-0000-4000-8000-0000000000a2', 'c8000000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$update public.businesses
       set alcohol_sales_enabled = true, alcohol_minimum_age = 18, alcohol_sales_start = '10:00',
           alcohol_sales_end = '23:00', alcohol_timezone = 'America/Argentina/Buenos_Aires'
     where id = 'b8000000-0000-4000-8000-0000000000a1'$$,
  'el encargado habilita la venta de alcohol con un PATCH directo (el permiso no se quito)');
reset role;
select is(pg_temp.filas('alcohol'), 1, 'CAT-08: habilitar el alcohol deja una fila de auditoria');
select is(
  pg_temp.ultima('alcohol'),
  '{"action": "enabled", "actor_kind": "user", "actor_id": "a8000000-0000-4000-8000-0000000000a2",
    "before": {"alcohol_sales_enabled": false, "alcohol_minimum_age": null, "alcohol_sales_start": null,
               "alcohol_sales_end": null, "alcohol_timezone": null},
    "after": {"alcohol_sales_enabled": true, "alcohol_minimum_age": 18, "alcohol_sales_start": "10:00:00",
              "alcohol_sales_end": "23:00:00", "alcohol_timezone": "America/Argentina/Buenos_Aires"}}'::jsonb,
  'con quien, y la politica completa antes y despues');

set local role authenticated;
update public.businesses set alcohol_minimum_age = 21 where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(pg_temp.ultima('alcohol') ->> 'action', 'updated', 'cambiar la edad minima queda como una edicion');

set local role authenticated;
update public.businesses set alcohol_sales_enabled = false where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(pg_temp.ultima('alcohol') ->> 'action', 'disabled', 'y deshabilitarlo, como una baja');
select is(pg_temp.filas('alcohol'), 3, 'tres cambios, tres filas');

-- ══ 3 · TOPES CONTRA EL ABUSO ═══════════════════════════════════════════════
set local role authenticated;
update public.businesses
   set captcha_required = false, order_rate_limit_per_10_minutes = 500, max_pending_orders_per_customer = null,
       max_units_per_unpaid_order = 100000
 where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(pg_temp.filas('abuse_limits'), 1, 'CAT-08: aflojar los topes deja una fila');
select is(
  (pg_temp.ultima('abuse_limits') -> 'after')
    - 'stock_reservation_minutes' - 'abandoned_order_minutes' - 'order_ip_rate_limit_per_10_minutes'
    - 'max_pending_orders_per_ip' - 'order_business_rate_limit_per_10_minutes',
  '{"captcha_required": false, "order_rate_limit_per_10_minutes": 500, "max_pending_orders_per_customer": null,
    "max_units_per_unpaid_order": 100000, "order_intake_guard_mode": "enforce"}'::jsonb,
  'con los valores que quedaron');
select is(
  pg_temp.ultima('abuse_limits') -> 'before' -> 'captcha_required', 'null'::jsonb,
  'y el valor anterior (el captcha no estaba definido)');
select is(pg_temp.ultima('abuse_limits') ->> 'actor_id', 'a8000000-0000-4000-8000-0000000000a2', 'actor: el encargado');

-- El modo del guardián no está en el permiso; cuando la plataforma lo cambia, queda escrito.
select set_config('request.jwt.claims', '', true);
update public.businesses set order_intake_guard_mode = 'monitor' where id = 'b8000000-0000-4000-8000-0000000000a1';
select is(
  (pg_temp.ultima('abuse_limits') ->> 'actor_kind') || ':' || (pg_temp.ultima('abuse_limits') -> 'before' ->> 'order_intake_guard_mode')
    || '>' || (pg_temp.ultima('abuse_limits') -> 'after' ->> 'order_intake_guard_mode'),
  'service:enforce>monitor', 'apagar o relajar el guardian de admision queda auditado como acto de servicio');

-- ══ 4 · ESTADO, ENTREGA Y DATOS DEL LOCAL POR ESCRITURA DIRECTA ═════════════
set local role authenticated;
select pg_temp.como('a8000000-0000-4000-8000-0000000000a1', 'c8000000-0000-4000-8000-0000000000a1');
update public.businesses set status = 'paused' where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(
  pg_temp.ultima('open_state'),
  '{"action": "updated", "actor_kind": "user", "actor_id": "a8000000-0000-4000-8000-0000000000a1",
    "before": {"status": "open", "is_active": true, "ordering_enabled": true},
    "after": {"status": "paused", "is_active": true, "ordering_enabled": true}}'::jsonb,
  'CAT-08: pausar el comercio con un PATCH queda auditado igual que por la RPC');

set local role authenticated;
update public.businesses set ordering_enabled = false where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(pg_temp.ultima('open_state') -> 'after' ->> 'ordering_enabled', 'false', 'apagar los pedidos online tambien');
select is(pg_temp.filas('open_state'), 2, 'dos cambios de estado, dos filas');

set local role authenticated;
update public.businesses set delivery_enabled = true where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(
  pg_temp.ultima('fulfillment') -> 'after',
  '{"delivery_enabled": true, "pickup_enabled": true}'::jsonb, 'encender el delivery queda en el ambito de entrega');

set local role authenticated;
update public.businesses set name = 'Escritura V bis', phone = '2990000009', address = 'Calle Uno 150, Neuquen'
 where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(pg_temp.filas('contact'), 1, 'nombre, telefono y direccion en un PATCH: una sola fila de datos del local');
select is(
  pg_temp.ultima('contact') -> 'after',
  '{"name": "Escritura V bis", "address": "Calle Uno 150, Neuquen", "phone": "2990000009"}'::jsonb,
  'con los tres valores nuevos');

-- El envío y el mínimo ya se auditaban: sigue siendo UNA fila.
set local role authenticated;
update public.businesses set delivery_fee = 800, minimum_delivery_subtotal = 5000 where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(pg_temp.filas('delivery_pricing'), 1, 'el envio y el minimo siguen dejando exactamente una fila');

-- Un PATCH que toca tres ámbitos deja tres filas; uno que no cambia nada, ninguna.
select set_config('taba.test_audit_total',
  (select count(*)::text from public.business_config_audit where business_id = 'b8000000-0000-4000-8000-0000000000a1'), true);
set local role authenticated;
update public.businesses set status = 'open', stock_reservation_minutes = 30, phone = '2990000010'
 where id = 'b8000000-0000-4000-8000-0000000000a1';
update public.businesses set status = 'open', stock_reservation_minutes = 30, phone = '2990000010'
 where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(
  (select count(*)::integer from public.business_config_audit where business_id = 'b8000000-0000-4000-8000-0000000000a1')
    - current_setting('taba.test_audit_total')::integer,
  3, 'un PATCH sobre tres ambitos deja tres filas, y repetirlo sin cambiar nada no agrega ninguna');

-- ══ 5 · LAS RPC SIGUEN ESCRIBIENDO UNA FILA, NO DOS ═════════════════════════
set local role authenticated;
select is(public.set_business_open_state('b8000000-0000-4000-8000-0000000000a1', 'paused') ->> 'status', 'paused',
  'el dueno pausa por la RPC');
reset role;
select is(pg_temp.filas('open_state'), 4, 'la RPC agrega UNA fila de estado (3 directas + 1), no dos');
select is(pg_temp.ultima('open_state') -> 'after', '{"status": "paused"}'::jsonb, 'y es la fila de la RPC, con su forma de siempre');

set local role authenticated;
select is(public.set_business_fulfillment('b8000000-0000-4000-8000-0000000000a1', false, true) ->> 'ok', 'true',
  'el dueno apaga el delivery por la RPC');
select is(public.set_business_address('b8000000-0000-4000-8000-0000000000a1', 'Calle Uno 175, Neuquen') ->> 'ok', 'true',
  'y cambia la direccion por la RPC');
reset role;
select is(pg_temp.filas('fulfillment'), 2, 'entrega: una directa + una de la RPC');
select is(pg_temp.filas('contact'), 3, 'datos del local: dos directas + una de la RPC');

-- Una escritura que no viene por la API (migración, tarea directa) no dispara el trigger directo.
update public.businesses set status = 'open' where id = 'b8000000-0000-4000-8000-0000000000a1';
select is(pg_temp.filas('open_state'), 4, 'una sentencia del dueno de la base no pasa por el trigger de escritura directa');

-- La clave de servicio sí: es un rol de la API.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.businesses set status = 'closed' where id = 'b8000000-0000-4000-8000-0000000000a1';
reset role;
select is(
  (pg_temp.ultima('open_state') ->> 'actor_kind') || ':' || (pg_temp.ultima('open_state') -> 'after' ->> 'status'),
  'service:closed', 'un PATCH con la clave de servicio queda auditado como acto de servicio');

-- ══ 6 · LA MONEDA ═══════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.como('a8000000-0000-4000-8000-0000000000a1', 'c8000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$update public.businesses set currency_code = 'USD' where id = 'b8000000-0000-4000-8000-0000000000a1'$$,
  '55000', 'la moneda de un comercio con pedidos verificados no se cambia',
  'PRICE-08: el dueno no puede cambiar la moneda de un comercio verificado');
select throws_ok(
  $$update public.businesses set currency_code = null where id = 'b8000000-0000-4000-8000-0000000000a1'$$,
  '55000', null, 'ni dejarla vacia');
reset role;
set local role service_role;
select throws_ok(
  $$update public.businesses set currency_code = 'USD' where id = 'b8000000-0000-4000-8000-0000000000a1'$$,
  '55000', null, 'la clave de servicio tampoco');
reset role;
select throws_ok(
  $$update public.businesses set currency_code = 'USD' where id = 'b8000000-0000-4000-8000-0000000000a1'$$,
  '55000', null, 'ni el dueno de la base: vale para todos los roles');
select is(
  (select currency_code from public.businesses where id = 'b8000000-0000-4000-8000-0000000000a1'), 'ARS',
  'la moneda sigue siendo la verificada');
select is(pg_temp.filas('currency'), 0, 'y no hay ninguna fila de moneda: no hubo cambio');
select lives_ok(
  $$update public.businesses set currency_code = 'ARS', updated_at = now() where id = 'b8000000-0000-4000-8000-0000000000a1'$$,
  'reescribir la misma moneda no molesta');

-- Antes de la verificación la moneda se puede corregir, y queda auditada.
set local role authenticated;
select pg_temp.como('a8000000-0000-4000-8000-0000000000a1', 'c8000000-0000-4000-8000-0000000000a5');
select lives_ok(
  $$update public.businesses set currency_code = 'USD' where id = 'b8000000-0000-4000-8000-0000000000a2'$$,
  'en un comercio todavia sin verificar la moneda se puede corregir');
reset role;
select is(
  pg_temp.ultima('currency', 'b8000000-0000-4000-8000-0000000000a2'),
  '{"action": "updated", "actor_kind": "user", "actor_id": "a8000000-0000-4000-8000-0000000000a1",
    "before": {"currency_code": "ARS"}, "after": {"currency_code": "USD"}}'::jsonb,
  'PRICE-08: y el cambio queda escrito con antes, despues y actor');

-- ══ 7 · QUIÉN NO PUEDE ESCRIBIR, SIGUE SIN PODER ════════════════════════════
select set_config('taba.test_audit_total',
  (select count(*)::text from public.business_config_audit where business_id = 'b8000000-0000-4000-8000-0000000000a1'), true);
set local role authenticated;
select pg_temp.como('a8000000-0000-4000-8000-0000000000a3', 'c8000000-0000-4000-8000-0000000000a3');
update public.businesses set alcohol_sales_enabled = true, alcohol_minimum_age = 18, alcohol_sales_start = '10:00',
       alcohol_sales_end = '23:00', alcohol_timezone = 'America/Argentina/Buenos_Aires', captcha_required = true
 where id = 'b8000000-0000-4000-8000-0000000000a1';
select pg_temp.como('a8000000-0000-4000-8000-0000000000a4', 'c8000000-0000-4000-8000-0000000000a4');
update public.businesses set status = 'open', name = 'Tomado' where id = 'b8000000-0000-4000-8000-0000000000a1';
select throws_ok(
  $$update public.businesses set order_intake_guard_mode = 'off' where id = 'b8000000-0000-4000-8000-0000000000a3'$$,
  '42501', null, 'un dueno no puede apagar el guardian de admision ni en su propio comercio');
select throws_ok(
  $$update public.businesses set ordering_verified = true where id = 'b8000000-0000-4000-8000-0000000000a3'$$,
  '42501', null, 'ni verificarse solo');
reset role;
select is(
  (select alcohol_sales_enabled::text || ':' || status || ':' || name from public.businesses
    where id = 'b8000000-0000-4000-8000-0000000000a1'),
  'false:closed:Escritura V bis', 'el empleado y el dueno de otro comercio no cambiaron nada (RLS)');
select is(
  (select count(*)::integer from public.business_config_audit where business_id = 'b8000000-0000-4000-8000-0000000000a1')
    - current_setting('taba.test_audit_total')::integer,
  0, 'y un intento que no escribe no deja filas de auditoria');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$update public.businesses set status = 'closed' where id = 'b8000000-0000-4000-8000-0000000000a3'$$,
  '42501', null, 'anon no tiene el permiso');
reset role;

-- ══ 8 · LA AUDITORÍA LA LEE QUIEN PUEDE CAMBIAR LA CONFIGURACIÓN ════════════
set local role authenticated;
select pg_temp.como('a8000000-0000-4000-8000-0000000000a1', 'c8000000-0000-4000-8000-0000000000a1');
select ok(
  (select count(*) from public.business_config_audit a
    where a.business_id = 'b8000000-0000-4000-8000-0000000000a1' and a.scope in ('alcohol', 'abuse_limits')) >= 4,
  'el dueno lee las filas nuevas por la policy de siempre');
select pg_temp.como('a8000000-0000-4000-8000-0000000000a3', 'c8000000-0000-4000-8000-0000000000a3');
select is(
  (select count(*)::integer from public.business_config_audit a where a.business_id = 'b8000000-0000-4000-8000-0000000000a1'),
  0, 'un empleado sin delegacion no');
select pg_temp.como('a8000000-0000-4000-8000-0000000000a4', 'c8000000-0000-4000-8000-0000000000a4');
select is(
  (select count(*)::integer from public.business_config_audit a where a.business_id = 'b8000000-0000-4000-8000-0000000000a1'),
  0, 'el dueno de otro comercio tampoco');
reset role;

select * from finish();
rollback;
