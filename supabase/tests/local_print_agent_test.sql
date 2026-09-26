-- TABA · IMPRESIÓN DEL MOSTRADOR: AGENTE LOCAL Y COLA print_jobs
--
-- Lo que esta suite tiene que demostrar:
--
--   1. identidad por instalación sin service_role en el agente: emparejamiento
--      de un solo uso, credencial guardada como hash, rotación en dos fases y
--      revocación que corta el acceso;
--   2. la cola no imprime dos veces: reclamo atómico con token, «printing»
--      antes de imprimir, lease vencido sin reimpresión automática,
--      reimpresión siempre explícita y auditada;
--   3. aislamiento: el negocio A ve y reclama sólo lo suyo; B, el repartidor,
--      el cliente y anon no ven nada;
--   4. un ticket fiscal sólo existe con CAE, y su QR es el mismo que genera el
--      worker fiscal (services/arca-fiscal-bridge/src/qr.ts);
--   5. la impresión automática nunca frena un pedido.
--
-- anon se verifica con has_*_privilege: un `set local role anon` seguido de
-- throws_ok tiró abajo el servidor de CI (ver alta_propuesta_comercial_test).
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(104);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a7000000-0000-4000-8000-000000000001','authenticated','authenticated','print-owner-a@example.invalid','',now(),'{}','{"display_name":"Duenia A"}',now(),now()),
  ('a7000000-0000-4000-8000-000000000002','authenticated','authenticated','print-staff-a@example.invalid','',now(),'{}','{"display_name":"Cajero A"}',now(),now()),
  ('a7000000-0000-4000-8000-000000000003','authenticated','authenticated','print-rider-a@example.invalid','',now(),'{}','{"display_name":"Rider A"}',now(),now()),
  ('a7000000-0000-4000-8000-000000000004','authenticated','authenticated','print-owner-b@example.invalid','',now(),'{}','{"display_name":"Duenio B"}',now(),now()),
  ('a7000000-0000-4000-8000-000000000005','authenticated','authenticated','print-cliente@example.invalid','',now(),'{}','{"display_name":"Cliente"}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values
  ('b7000000-0000-4000-8000-000000000001','TABA IMPRIME A','open','taba-imprime-a',true,'America/Argentina/Buenos_Aires'),
  ('b7000000-0000-4000-8000-000000000002','TABA IMPRIME B','open','taba-imprime-b',true,'America/Argentina/Buenos_Aires');

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','owner',true),
  ('b7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002','staff',true),
  ('b7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000003','rider',true),
  ('b7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000004','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','owner','panel_web'),
  ('c7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000001','staff','panel_web'),
  ('c7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000003','b7000000-0000-4000-8000-000000000001','rider','rider_android'),
  ('c7000000-0000-4000-8000-000000000004','a7000000-0000-4000-8000-000000000004','b7000000-0000-4000-8000-000000000002','owner','panel_web');

insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total,customer_notes
)
select ('d7000000-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 9 then 'b7000000-0000-4000-8000-000000000002' else 'b7000000-0000-4000-8000-000000000001' end::uuid,
       'PRINT-' || n, 'PRINT-' || n, 'submitted', 'delivery', 'delivery',
       'print-request-' || n, 'CLIENTE_SINTETICO_NO_IMPRIMIR', 'Centro', 'Mendoza ' || n,
       '+540000000000', 'cash', 2500, 0, 2500, 'sin cebolla'
  from unnest(array[1,2,3,4,5,9]) as n;

insert into public.order_items(order_id,product_id,name,quantity,unit,unit_price,subtotal)
select o.id, 'sku-print', 'Fernet Branca 750 ml', 2, 'u', 1250, 2500 from public.orders o
 where o.id::text like 'd7000000-%';

create temporary table t_ctx(k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
create or replace function pg_temp.ctx(p_key text) returns text language sql as $$ select v from t_ctx where k = p_key $$;
create or replace function pg_temp.put(p_key text, p_value text) returns text language sql as $$
  insert into t_ctx values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create or replace function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;
-- Igual que private.print_sha256_hex, pero invocable con el rol authenticated.
create or replace function pg_temp.h(p_secret text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex') $$;
create or replace function pg_temp.jobs(p_business uuid, p_status text default null) returns integer language sql as $$
  select count(*)::integer from public.print_jobs where business_id = p_business and (p_status is null or status = p_status) $$;

-- ══ 0 · SUPERFICIE Y MENOR PRIVILEGIO ════════════════════════════════════════
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('local_devices','local_device_pairings','business_print_settings','print_jobs','print_job_events')),
  5, 'las 5 tablas de impresion tienen RLS');

select ok(not exists (
  select 1 from unnest(array['local_devices','local_device_pairings','business_print_settings','print_jobs','print_job_events']) t,
                unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
   where has_table_privilege('anon', 'public.' || t, p)),
  'anon no tiene ningun privilegio sobre las tablas de impresion');

select ok(
  has_table_privilege('authenticated', 'public.print_jobs', 'SELECT')
  and has_table_privilege('authenticated', 'public.print_job_events', 'SELECT')
  and not exists (
    select 1 from unnest(array['local_devices','local_device_pairings','business_print_settings']) t
     where has_table_privilege('authenticated', 'public.' || t, 'SELECT'))
  and not exists (
    select 1 from unnest(array['local_devices','local_device_pairings','business_print_settings','print_jobs','print_job_events']) t,
                  unnest(array['INSERT','UPDATE','DELETE']) p
     where has_table_privilege('authenticated', 'public.' || t, p)),
  'authenticated solo LEE print_jobs y su auditoria; dispositivos, codigos y ajustes no se leen directo');

select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'agent\_%' or p.proname like 'operator\_%local\_device%')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'ninguna RPC agent_* ni operator_*_local_device es ejecutable por anon o authenticated');

select ok(
  has_function_privilege('service_role', 'public.agent_claim_print_jobs(uuid,text,text[],integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.agent_update_print_job(uuid,text,uuid,uuid,text,text,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.agent_register_device(text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.operator_revoke_local_device(uuid,text)', 'EXECUTE'),
  'la gateway (service_role) si ejecuta las RPC del agente y del operador');

select ok(
  not exists (
    select 1 from unnest(array[
      'public.create_local_device_pairing(uuid,text)', 'public.revoke_local_device(uuid,text)',
      'public.get_local_print_status(uuid)', 'public.configure_business_print_settings(uuid,jsonb)',
      'public.request_order_print_job(uuid,text,text)', 'public.request_print_job_reprint(uuid,text,text)',
      'public.resolve_print_job_review(uuid,text,text)', 'public.cancel_print_job(uuid,text)']) f
     where has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE')),
  'las 8 RPC del Panel: authenticated si, anon no');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')),
  8, 'siguen siendo exactamente 8 SECURITY DEFINER ejecutables por anon');

select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and (p.proname like 'print\_%' or p.proname like 'local\_device\_%' or p.proname like 'fiscal\_%')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'los helpers privados de impresion no son ejecutables por anon ni authenticated');

-- ══ 1 · EMPAREJAMIENTO ════════════════════════════════════════════════════
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select pg_temp.put('code_a1', public.create_local_device_pairing('b7000000-0000-4000-8000-000000000001', 'Mostrador') ->> 'pairing_code');
select matches(pg_temp.ctx('code_a1'), '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$',
  'el duenio obtiene un codigo de 10 caracteres sin letras ambiguas');
select pg_temp.put('code_a2', public.create_local_device_pairing('b7000000-0000-4000-8000-000000000001', 'Cocina') ->> 'pairing_code');

select ok(
  exists (select 1 from public.local_device_pairings
           where code_hash = private.print_sha256_hex('taba-pairing:v1:' || replace(pg_temp.ctx('code_a1'), '-', '')))
  and not exists (select 1 from public.local_device_pairings p
                   where p::text like '%' || replace(pg_temp.ctx('code_a1'), '-', '') || '%'),
  'la base guarda solo el hash del codigo, nunca el codigo');

select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002');
select throws_ok($$select public.create_local_device_pairing('b7000000-0000-4000-8000-000000000001', 'Caja')$$,
  '42501', null, 'el cajero no empareja agentes');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000004','c7000000-0000-4000-8000-000000000004');
select throws_ok($$select public.create_local_device_pairing('b7000000-0000-4000-8000-000000000001', 'Intruso')$$,
  '42501', null, 'el duenio de B no empareja agentes en A');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000005','c7000000-0000-4000-8000-000000000001');
select throws_ok($$select public.create_local_device_pairing('b7000000-0000-4000-8000-000000000001', 'Cliente')$$,
  '42501', null, 'un cliente autenticado no empareja agentes');
select pg_temp.sin_sesion();
select throws_ok($$select public.create_local_device_pairing('b7000000-0000-4000-8000-000000000001', 'Anonimo')$$,
  '42501', null, 'sin sesion no hay emparejamiento');

-- ══ 2 · REGISTRO DEL AGENTE ════════════════════════════════════════════════
select pg_temp.put('dev_a1', public.agent_register_device(pg_temp.ctx('code_a1'), pg_temp.h('secreto-a1'), 'Mostrador', 'windows', '0.1.0') ->> 'device_id');
select is(
  (select business_id from public.local_devices where id = pg_temp.ctx('dev_a1')::uuid),
  'b7000000-0000-4000-8000-000000000001'::uuid,
  'el codigo registra el agente en el negocio que lo emitio');
select ok(
  (select status = 'active' and secret_hash = pg_temp.h('secreto-a1') and pending_secret_hash is null
     from public.local_devices where id = pg_temp.ctx('dev_a1')::uuid),
  'el dispositivo queda activo con el hash de su secreto (el secreto no viaja ni se guarda)');
select throws_ok(
  format($$select public.agent_register_device(%L, %L, 'Otro', 'windows', '0.1.0')$$, pg_temp.ctx('code_a1'), pg_temp.h('secreto-reuso')),
  '42501', null, 'un codigo ya usado no registra un segundo agente');
select throws_ok(
  format($$select public.agent_register_device(%L, %L, 'Cocina', 'windows', 'uno')$$, pg_temp.ctx('code_a2'), pg_temp.h('secreto-a2')),
  '22023', null, 'una version que no es SemVer se rechaza');
select throws_ok(
  format($$select public.agent_register_device(%L, %L, 'Cocina', 'windows', '0.1.0')$$, pg_temp.ctx('code_a2'), pg_temp.h('secreto-a1')),
  '22023', null, 'no se registra un secreto que ya usa otro agente');
select pg_temp.put('dev_a2', public.agent_register_device(lower(pg_temp.ctx('code_a2')), pg_temp.h('secreto-a2'), 'Cocina', 'windows', '0.1.0') ->> 'device_id');
select isnt(pg_temp.ctx('dev_a2'), null, 'el codigo se acepta en minusculas (se normaliza)');

-- Código vencido.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select pg_temp.put('code_vencido', public.create_local_device_pairing('b7000000-0000-4000-8000-000000000001', 'Vencido') ->> 'pairing_code');
update public.local_device_pairings set created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
 where code_hash = private.print_sha256_hex('taba-pairing:v1:' || replace(pg_temp.ctx('code_vencido'), '-', ''));
select throws_ok(
  format($$select public.agent_register_device(%L, %L, 'Vencido', 'windows', '0.1.0')$$, pg_temp.ctx('code_vencido'), pg_temp.h('secreto-vencido')),
  '42501', null, 'un codigo vencido no registra');

-- ══ 3 · AUTENTICACIÓN DEL AGENTE ═══════════════════════════════════════════
select is(
  public.agent_heartbeat(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'),
    '{"agent_version":"0.1.0","queue_depth":0,"printers":[{"name":"POS-80","role":"counter","status":"READY","token":"no-se-guarda"}]}'::jsonb) ->> 'poll_seconds',
  '10', 'con el negocio abierto el agente consulta cada 10 s');
select is(
  (select last_report->'printers' from public.local_devices where id = pg_temp.ctx('dev_a1')::uuid),
  '[{"name":"POS-80","role":"counter","status":"READY"}]'::jsonb,
  'del reporte se guarda solo nombre, rol y estado de la impresora');
select throws_ok(
  format($$select public.agent_heartbeat(%L, %L, '{}'::jsonb)$$, pg_temp.ctx('dev_a1'), pg_temp.h('secreto-equivocado')),
  '42501', 'dispositivo no autorizado', 'un secreto equivocado no entra');
select throws_ok(
  format($$select public.agent_heartbeat('e7000000-0000-4000-8000-0000000000ff', %L, '{}'::jsonb)$$, pg_temp.h('secreto-a1')),
  '42501', 'dispositivo no autorizado', 'un dispositivo inexistente recibe exactamente el mismo error');

-- ══ 4 · IMPRESIÓN AUTOMÁTICA ══════════════════════════════════════════════
update public.orders set status = 'accepted' where id = 'd7000000-0000-4000-8000-000000000001';
select is(pg_temp.jobs('b7000000-0000-4000-8000-000000000001'), 0,
  'sin configuracion no se imprime nada automaticamente');

select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.configure_business_print_settings('b7000000-0000-4000-8000-000000000001', '{"auto_print_enabled":true}'::jsonb)$$,
  '42501', null, 'el cajero no cambia la configuracion de impresion');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.configure_business_print_settings('b7000000-0000-4000-8000-000000000001', '{"fiscal_receipt_auto":true}'::jsonb)$$,
  'P0001', null, 'no hay ticket fiscal automatico sin facturacion electronica habilitada');
select throws_ok(
  $$select public.configure_business_print_settings('b7000000-0000-4000-8000-000000000001', '{"imprimir_todo":true}'::jsonb)$$,
  '22023', null, 'una clave de configuracion desconocida se rechaza');
select is(
  public.configure_business_print_settings('b7000000-0000-4000-8000-000000000001',
    '{"auto_print_enabled":true,"kitchen_ticket_on":"accepted","order_ticket_on":"accepted"}'::jsonb) ->> 'kitchen_ticket_on',
  'accepted', 'el duenio configura comanda y ticket al aceptar');
select ok(
  exists (select 1 from public.business_config_audit where business_id = 'b7000000-0000-4000-8000-000000000001'
            and scope = 'printing' and actor_kind = 'user' and actor_id = 'a7000000-0000-4000-8000-000000000001'),
  'el cambio queda auditado con su autor');

update public.orders set status = 'accepted' where id = 'd7000000-0000-4000-8000-000000000002';
select is(pg_temp.jobs('b7000000-0000-4000-8000-000000000001', 'queued'), 2,
  'aceptar el pedido encola comanda y ticket');
update public.orders set status = 'preparing' where id = 'd7000000-0000-4000-8000-000000000002';
update public.orders set status = 'ready' where id = 'd7000000-0000-4000-8000-000000000002';
select is(pg_temp.jobs('b7000000-0000-4000-8000-000000000001'), 2,
  'los estados siguientes no duplican trabajos (clave idempotente por pedido y tipo)');

select ok(
  (select not (payload ? 'business' and payload->'order' ? 'payment') and not (payload->'order'->'items'->0 ? 'subtotal')
     from public.print_jobs where source_entity_id = 'd7000000-0000-4000-8000-000000000002' and document_type = 'kitchen_ticket'),
  'la comanda no lleva precios ni forma de pago');
select ok(
  (select (payload->'order'->>'total')::numeric = 2500 and payload->'order'->'payment'->>'label' = 'Efectivo'
          and payload->'order'->>'notes' = 'sin cebolla'
     from public.print_jobs where source_entity_id = 'd7000000-0000-4000-8000-000000000002' and document_type = 'order_ticket'),
  'el ticket de pedido lleva total, forma de pago y notas');
select ok(not exists (
  select 1 from public.print_jobs where business_id = 'b7000000-0000-4000-8000-000000000001'
     and (payload::text like '%CLIENTE_SINTETICO%' or payload::text like '%+5400%' or payload::text like '%Mendoza%')),
  'ningun ticket lleva nombre, telefono ni direccion del cliente');

-- B configura impresión pero todavía no tiene agente: no se encola nada.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000004','c7000000-0000-4000-8000-000000000004');
select lives_ok(
  $$select public.configure_business_print_settings('b7000000-0000-4000-8000-000000000002',
      '{"auto_print_enabled":true,"kitchen_ticket_on":"accepted"}'::jsonb)$$,
  'B configura impresion automatica');
update public.orders set status = 'accepted' where id = 'd7000000-0000-4000-8000-000000000009';
select is(pg_temp.jobs('b7000000-0000-4000-8000-000000000002'), 0,
  'sin un agente activo no se encola nada (no se acumulan trabajos huerfanos)');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000004','c7000000-0000-4000-8000-000000000004');
select pg_temp.put('code_b', public.create_local_device_pairing('b7000000-0000-4000-8000-000000000002', 'Mostrador B') ->> 'pairing_code');
select pg_temp.put('dev_b', public.agent_register_device(pg_temp.ctx('code_b'), pg_temp.h('secreto-b'), 'Mostrador B', 'windows', '0.1.0') ->> 'device_id');

-- Un pedido anulado no imprime la comanda que nadie reclamó.
update public.orders set status = 'accepted' where id = 'd7000000-0000-4000-8000-000000000003';
update public.orders set status = 'cancelled' where id = 'd7000000-0000-4000-8000-000000000003';
select is(
  (select count(*)::integer from public.print_jobs where source_entity_id = 'd7000000-0000-4000-8000-000000000003' and status = 'cancelled'),
  2, 'anular el pedido cancela sus trabajos todavia en cola');

-- ══ 5 · RECLAMO ═══════════════════════════════════════════════════════════
select pg_temp.put('claim_a1', public.agent_claim_print_jobs(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'),
  array['kitchen_ticket','order_ticket'], 5)::text);
select is(jsonb_array_length(pg_temp.ctx('claim_a1')::jsonb->'jobs'), 2, 'el primer agente reclama los dos trabajos');
select pg_temp.put('job_k', (select j->>'id' from jsonb_array_elements(pg_temp.ctx('claim_a1')::jsonb->'jobs') j where j->>'document_type' = 'kitchen_ticket'));
select pg_temp.put('tok_k', (select j->>'claim_token' from jsonb_array_elements(pg_temp.ctx('claim_a1')::jsonb->'jobs') j where j->>'document_type' = 'kitchen_ticket'));
select pg_temp.put('job_o', (select j->>'id' from jsonb_array_elements(pg_temp.ctx('claim_a1')::jsonb->'jobs') j where j->>'document_type' = 'order_ticket'));
select pg_temp.put('tok_o', (select j->>'claim_token' from jsonb_array_elements(pg_temp.ctx('claim_a1')::jsonb->'jobs') j where j->>'document_type' = 'order_ticket'));
select is(pg_temp.ctx('claim_a1')::jsonb->>'poll_seconds', '2', 'con trabajo en mano el agente vuelve a consultar pronto');
select is(
  jsonb_array_length(public.agent_claim_print_jobs(pg_temp.ctx('dev_a2')::uuid, pg_temp.h('secreto-a2'),
    array['kitchen_ticket','order_ticket'], 5)->'jobs'),
  0, 'el segundo agente no obtiene nada: un solo ganador por trabajo');
select is(
  jsonb_array_length(public.agent_claim_print_jobs(pg_temp.ctx('dev_b')::uuid, pg_temp.h('secreto-b'),
    array['kitchen_ticket','order_ticket','fiscal_receipt'], 5)->'jobs'),
  0, 'el agente de B no ve la cola de A');
select throws_ok(
  format($$select public.agent_claim_print_jobs(%L, %L, array['kitchen_ticket'], 50)$$, pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1')),
  '22023', null, 'un reclamo desmedido se rechaza');
select throws_ok(
  format($$select public.agent_claim_print_jobs(%L, %L, array['factura_inventada'], 1)$$, pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1')),
  '22023', null, 'un tipo de documento desconocido se rechaza');

-- ══ 6 · TRANSICIONES ═════════════════════════════════════════════════════
select throws_ok(
  format($$select public.agent_update_print_job(%L, %L, %L, gen_random_uuid(), 'printing')$$,
    pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1'), pg_temp.ctx('job_k')),
  'PT409', null, 'sin el claim_token vigente no se marca «printing» (y el agente no imprime)');
select throws_ok(
  format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$,
    pg_temp.ctx('dev_a2'), pg_temp.h('secreto-a2'), pg_temp.ctx('job_k'), pg_temp.ctx('tok_k')),
  'PT409', null, 'otro agente del mismo negocio no usa un reclamo ajeno');
select throws_ok(
  format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$,
    pg_temp.ctx('dev_b'), pg_temp.h('secreto-b'), pg_temp.ctx('job_k'), pg_temp.ctx('tok_k')),
  'P0002', null, 'el agente de B no puede tocar un trabajo de A (ni saber si existe)');
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.ctx('job_k')::uuid, pg_temp.ctx('tok_k')::uuid, 'printing') ->> 'status',
  'printing', '«printing» queda registrado antes de mandar bytes');
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.ctx('job_k')::uuid, pg_temp.ctx('tok_k')::uuid, 'printing') ->> 'idempotent_replay',
  'true', 'repetir «printing» es idempotente');
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.ctx('job_k')::uuid, pg_temp.ctx('tok_k')::uuid, 'printed', null, 850) ->> 'status',
  'printed', 'la comanda queda impresa');
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.ctx('job_k')::uuid, pg_temp.ctx('tok_k')::uuid, 'printed') ->> 'idempotent_replay',
  'true', 'un «printed» repetido (reintento de red) no duplica nada');

-- Impresora apagada antes de empezar: vuelve a la cola con espera.
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.ctx('job_o')::uuid, pg_temp.ctx('tok_o')::uuid, 'not_printed', 'PRINTER_OFFLINE') ->> 'status',
  'queued', 'impresora apagada antes de enviar: el trabajo vuelve a la cola');
select ok(
  (select next_attempt_at > now() and last_error = 'PRINTER_OFFLINE' from public.print_jobs where id = pg_temp.ctx('job_o')::uuid),
  'con espera y el motivo guardado');
select is(
  jsonb_array_length(public.agent_claim_print_jobs(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), array['order_ticket'], 5)->'jobs'),
  0, 'no se reintenta antes de la espera');
update public.print_jobs set next_attempt_at = now() where id = pg_temp.ctx('job_o')::uuid;
select pg_temp.put('tok_o2', public.agent_claim_print_jobs(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), array['order_ticket'], 5)->'jobs'->0->>'claim_token');
select isnt(pg_temp.ctx('tok_o2'), pg_temp.ctx('tok_o'), 'cada reclamo tiene un token nuevo');
select throws_ok(
  format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$,
    pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1'), pg_temp.ctx('job_o'), pg_temp.ctx('tok_o')),
  'PT409', null, 'el token del reclamo anterior ya no sirve');
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.ctx('job_o')::uuid, pg_temp.ctx('tok_o2')::uuid, 'printing') ->> 'status',
  'printing', 'el reintento marca «printing»');
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.ctx('job_o')::uuid, pg_temp.ctx('tok_o2')::uuid, 'unknown', 'PRINTER_WRITE_PARTIAL') ->> 'status',
  'needs_review', 'un corte a mitad de camino queda para revision, no se reimprime');

-- ══ 7 · LEASES VENCIDOS ══════════════════════════════════════════════════
update public.orders set status = 'accepted' where id = 'd7000000-0000-4000-8000-000000000004';
select pg_temp.put('claim_l', public.agent_claim_print_jobs(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), array['kitchen_ticket'], 1)::text);
select pg_temp.put('job_l', pg_temp.ctx('claim_l')::jsonb->'jobs'->0->>'id');
select pg_temp.put('tok_l', pg_temp.ctx('claim_l')::jsonb->'jobs'->0->>'claim_token');
update public.print_jobs set lease_expires_at = now() - interval '1 second' where id = pg_temp.ctx('job_l')::uuid;
select throws_ok(
  format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$,
    pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1'), pg_temp.ctx('job_l'), pg_temp.ctx('tok_l')),
  'PT409', null, 'con el reclamo vencido el agente no puede empezar a imprimir');
select pg_temp.put('tok_l2', public.agent_claim_print_jobs(pg_temp.ctx('dev_a2')::uuid, pg_temp.h('secreto-a2'), array['kitchen_ticket'], 1)->'jobs'->0->>'claim_token');
select ok(
  (select status = 'claimed' and claimed_by_device_id = pg_temp.ctx('dev_a2')::uuid and claim_token = pg_temp.ctx('tok_l2')::uuid
     from public.print_jobs where id = pg_temp.ctx('job_l')::uuid),
  'un reclamo vencido sin «printing» vuelve a la cola y lo toma otro agente');
select lives_ok(
  format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$,
    pg_temp.ctx('dev_a2'), pg_temp.h('secreto-a2'), pg_temp.ctx('job_l'), pg_temp.ctx('tok_l2')),
  'el nuevo duenio del reclamo empieza a imprimir');
update public.print_jobs set lease_expires_at = now() - interval '1 second' where id = pg_temp.ctx('job_l')::uuid;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select is(
  (public.get_local_print_status('b7000000-0000-4000-8000-000000000001')->'queue'->>'needs_review')::integer,
  2, 'un «printing» sin resultado pasa a revision al vencer (nunca a la cola)');
select is(
  public.agent_update_print_job(pg_temp.ctx('dev_a2')::uuid, pg_temp.h('secreto-a2'), pg_temp.ctx('job_l')::uuid, pg_temp.ctx('tok_l2')::uuid, 'printed') ->> 'status',
  'printed', 'la confirmacion tardia del mismo reclamo cierra la revision');

-- ══ 8 · REIMPRESIÓN ══════════════════════════════════════════════════════
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select pg_temp.put('reprint_1', public.request_print_job_reprint(pg_temp.ctx('job_k')::uuid, 'se mancho la comanda', 'panel-reprint-0001')::text);
select ok(
  (select reprint_of = pg_temp.ctx('job_k')::uuid and request_source = 'panel' and status = 'queued'
          and requested_by = 'a7000000-0000-4000-8000-000000000001' and reprint_reason = 'se mancho la comanda'
          and (payload->>'reprint')::boolean
     from public.print_jobs where id = (pg_temp.ctx('reprint_1')::jsonb->>'print_job_id')::uuid),
  'reimprimir crea OTRO trabajo: original, quien, por que, marcado como reimpresion');
select ok(
  exists (select 1 from public.print_job_events
           where print_job_id = pg_temp.ctx('job_k')::uuid and event_type = 'reprinted_as' and actor_kind = 'user'
             and actor_id = 'a7000000-0000-4000-8000-000000000001' and detail->>'reason' = 'se mancho la comanda'),
  'el trabajo original registra que fue reimpreso, por quien y por que');
select is(
  public.request_print_job_reprint(pg_temp.ctx('job_k')::uuid, 'se mancho la comanda', 'panel-reprint-0001') ->> 'print_job_id',
  pg_temp.ctx('reprint_1')::jsonb->>'print_job_id', 'un doble toque con la misma clave no reimprime dos veces');
select throws_ok(
  format($$select public.request_print_job_reprint(%L, '', 'panel-reprint-0002')$$, pg_temp.ctx('job_k')),
  '22023', null, 'reimprimir exige un motivo');
select throws_ok(
  format($$select public.request_print_job_reprint(%L, 'todavia no salio', 'panel-reprint-0003')$$, pg_temp.ctx('reprint_1')::jsonb->>'print_job_id'),
  'P0001', null, 'no se reimprime lo que todavia esta en la cola');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000003');
select throws_ok(
  format($$select public.request_print_job_reprint(%L, 'rider curioso', 'rider-reprint-0001')$$, pg_temp.ctx('job_k')),
  '42501', null, 'el repartidor no reimprime');
select pg_temp.put('reprint_agent', public.agent_request_reprint(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'),
  pg_temp.ctx('job_l')::uuid, 'papel trabado', 'Caja 1', 'agent-reprint-0001') ->> 'print_job_id');
select ok(
  (select request_source = 'agent' and requested_by is null and reprint_of = pg_temp.ctx('job_l')::uuid
     from public.print_jobs where id = pg_temp.ctx('reprint_agent')::uuid)
  and exists (select 1 from public.print_job_events
               where print_job_id = pg_temp.ctx('job_l')::uuid and event_type = 'reprinted_as' and actor_kind = 'device'
                 and device_id = pg_temp.ctx('dev_a1')::uuid and detail->>'operator_label' = 'Caja 1'),
  'la reimpresion desde el agente queda registrada como tal: agente, operador declarado y motivo');
select throws_ok(
  format($$insert into public.print_jobs(business_id,document_type,source_entity_id,payload,request_source,idempotency_key,reprint_of)
           values ('b7000000-0000-4000-8000-000000000001','kitchen_ticket','d7000000-0000-4000-8000-000000000002','{}'::jsonb,'automatic','auto-reprint-sin-motivo',%L)$$,
    pg_temp.ctx('job_k')),
  '23514', null, 'ni siquiera un INSERT directo crea una reimpresion automatica sin motivo');

-- ══ 9 · REVISIÓN Y CANCELACIÓN ═══════════════════════════════════════════
select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002');
select is(
  public.resolve_print_job_review(pg_temp.ctx('job_o')::uuid, 'not_printed', 'no salio nada') ->> 'status',
  'failed', 'el cajero confirma que no salio: queda fallido (reimprimir es otra accion)');
select throws_ok(
  format($$select public.resolve_print_job_review(%L, 'printed', null)$$, pg_temp.ctx('job_o')),
  'P0001', null, 'una revision ya resuelta no se vuelve a resolver');
select is(
  public.cancel_print_job((pg_temp.ctx('reprint_1')::jsonb->>'print_job_id')::uuid, 'ya no hace falta') ->> 'status',
  'cancelled', 'un trabajo en cola se puede cancelar con motivo');
select throws_ok(
  format($$select public.cancel_print_job(%L, 'tarde')$$, pg_temp.ctx('job_k')),
  'P0001', null, 'lo ya impreso no se cancela');

-- ══ 10 · RLS ═════════════════════════════════════════════════════════════
select pg_temp.put('total_a', pg_temp.jobs('b7000000-0000-4000-8000-000000000001')::text);
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select is((select count(*)::text from public.print_jobs), pg_temp.ctx('total_a'), 'el duenio de A ve todos los trabajos de A');
select is((select count(*)::integer from public.print_jobs where business_id <> 'b7000000-0000-4000-8000-000000000001'), 0,
  'y ninguno de otro negocio');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000004','c7000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.print_jobs where business_id = 'b7000000-0000-4000-8000-000000000001'), 0,
  'el duenio de B no ve la cola de A');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000003');
select is((select count(*)::integer from public.print_jobs), 0, 'el repartidor no ve la cola de impresion');
select is((select count(*)::integer from public.print_job_events), 0, 'ni su auditoria');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000005','c7000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.print_jobs), 0, 'un cliente autenticado no ve nada');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select throws_ok($$select count(*) from public.local_devices$$, '42501', null,
  'ni el duenio lee local_devices directo (los hashes no se exponen)');
select throws_ok(
  $$insert into public.print_jobs(business_id,document_type,source_entity_id,payload,request_source,idempotency_key)
    values ('b7000000-0000-4000-8000-000000000001','kitchen_ticket','d7000000-0000-4000-8000-000000000001','{}'::jsonb,'panel','insert-directo-0001')$$,
  '42501', null, 'authenticated no inserta trabajos directo');
select throws_ok($$update public.print_jobs set status = 'printed'$$, '42501', null, 'authenticated no cambia estados directo');
select throws_ok(
  format($$select public.agent_claim_print_jobs(%L, %L, array['kitchen_ticket'], 1)$$, pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1')),
  '42501', null, 'con sesion de usuario no se llama la RPC del agente');
reset role;

-- ══ 11 · AUDITORÍA INMUTABLE ═════════════════════════════════════════════
select throws_ok($$update public.print_job_events set event_type = 'printed'$$, '55000', null, 'la auditoria no se edita');
select throws_ok($$delete from public.print_job_events$$, '55000', null, 'ni se borra');

-- ══ 12 · ROTACIÓN ════════════════════════════════════════════════════════
select is(
  public.agent_rotate_device_secret(pg_temp.ctx('dev_a1')::uuid, pg_temp.h('secreto-a1'), pg_temp.h('secreto-a1-v2')) ->> 'rotation',
  'pending', 'la rotacion queda pendiente hasta el primer uso');
select lives_ok(
  format($$select public.agent_heartbeat(%L, %L, '{}'::jsonb)$$, pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1')),
  'mientras tanto el secreto anterior sigue valiendo (perder la respuesta no deja al agente afuera)');
select lives_ok(
  format($$select public.agent_heartbeat(%L, %L, '{}'::jsonb)$$, pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1-v2')),
  'el secreto nuevo entra y queda promovido');
select throws_ok(
  format($$select public.agent_heartbeat(%L, %L, '{}'::jsonb)$$, pg_temp.ctx('dev_a1'), pg_temp.h('secreto-a1')),
  '42501', null, 'despues de la promocion el secreto viejo ya no vale');

-- ══ 13 · REVOCACIÓN ══════════════════════════════════════════════════════
update public.orders set status = 'accepted' where id = 'd7000000-0000-4000-8000-000000000005';
select pg_temp.put('job_rv', public.agent_claim_print_jobs(pg_temp.ctx('dev_a2')::uuid, pg_temp.h('secreto-a2'), array['kitchen_ticket'], 1)->'jobs'->0->>'id');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002');
select throws_ok(
  format($$select public.revoke_local_device(%L, 'lo pide el cajero')$$, pg_temp.ctx('dev_a2')),
  '42501', null, 'el cajero no revoca agentes');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select is(
  public.revoke_local_device(pg_temp.ctx('dev_a2')::uuid, 'PC de cocina robada') ->> 'status',
  'revoked', 'el duenio revoca el agente de la cocina');
select ok(
  (select status = 'queued' from public.print_jobs where id = pg_temp.ctx('job_rv')::uuid),
  'lo que ese agente habia reclamado sin empezar vuelve a la cola');
select ok(
  (select secret_hash is null and pending_secret_hash is null and revoke_reason = 'PC de cocina robada'
     from public.local_devices where id = pg_temp.ctx('dev_a2')::uuid),
  'el agente revocado no conserva credencial alguna');
select throws_ok(
  format($$select public.agent_claim_print_jobs(%L, %L, array['kitchen_ticket'], 1)$$, pg_temp.ctx('dev_a2'), pg_temp.h('secreto-a2')),
  '42501', 'dispositivo no autorizado', 'un agente revocado no vuelve a entrar');

-- ══ 14 · TICKET FISCAL ═══════════════════════════════════════════════════
insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,environment,point_of_sale,is_enabled,
  accountant_review_status,homologation_authorized_at,homologation_authorized_by,default_recipient_condition,default_concept)
values ('b7000000-0000-4000-8000-000000000001','TABA IMPRIME SA','20123456789','monotributo','homologation',1,true,
  'approved',now(),'a7000000-0000-4000-8000-000000000001','consumidor_final',1);
insert into public.fiscal_documents(id,business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,
  document_type,document_number,issue_date,currency,currency_rate,recipient_type,recipient_document_type,recipient_document_number,
  net_amount,total_amount,state,idempotency_key,issuer_snapshot,recipient_snapshot,concept)
values ('f7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','pos_sale','f7000000-0000-4000-8000-0000000000aa',
  'invoice','homologation','20123456789',1,11,123,'2026-09-26','PES',1,'consumidor_final',99,'0',1234.50,1234.50,
  'authorizing','fiscal-print-test-0001','{"legal_name":"TABA IMPRIME SA","tax_condition":"monotributo"}',
  '{"condition":"consumidor_final","document_type":99,"document_number":"0"}',1);

select throws_ok(
  $$insert into public.print_jobs(business_id,document_type,source_entity_id,payload,request_source,idempotency_key)
    values ('b7000000-0000-4000-8000-000000000001','fiscal_receipt','f7000000-0000-4000-8000-000000000001','{}'::jsonb,'operator','fiscal-sin-cae-0001')$$,
  '23514', null, 'ni un INSERT directo crea un ticket fiscal sin CAE');
select throws_ok($$select private.fiscal_receipt_print_payload('f7000000-0000-4000-8000-000000000001')$$,
  'P0001', null, 'no se arma un comprobante para imprimir antes de la autorizacion');

select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select is(
  public.configure_business_print_settings('b7000000-0000-4000-8000-000000000001', '{"fiscal_receipt_auto":true}'::jsonb) ->> 'fiscal_receipt_auto',
  'true', 'con facturacion habilitada el duenio activa el ticket fiscal automatico');
select is(
  (select count(*)::integer from public.print_jobs where document_type = 'fiscal_receipt'), 0,
  'mientras ARCA no autoriza, no hay ticket fiscal');
update public.fiscal_documents set state = 'authorized', cae = '12345678901234', cae_expiration = '2026-10-06', authorized_at = now()
 where id = 'f7000000-0000-4000-8000-000000000001';
select ok(
  (select payload->>'cae' = '12345678901234' and payload->'voucher'->>'label' = 'Factura C' and payload->>'environment' = 'homologation'
     from public.print_jobs where document_type = 'fiscal_receipt' and source_entity_id = 'f7000000-0000-4000-8000-000000000001'),
  'autorizado el comprobante, se encola su ticket con CAE, tipo y ambiente');
select is(
  private.fiscal_qr_url((select d from public.fiscal_documents d where d.id = 'f7000000-0000-4000-8000-000000000001')),
  'https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0yNiIsImN1aXQiOjIwMTIzNDU2Nzg5LCJwdG9WdGEiOjEsInRpcG9DbXAiOjExLCJucm9DbXAiOjEyMywiaW1wb3J0ZSI6MTIzNC41LCJtb25lZGEiOiJQRVMiLCJjdHoiOjEsInRpcG9Eb2NSZWMiOjk5LCJucm9Eb2NSZWMiOjAsInRpcG9Db2RBdXQiOiJFIiwiY29kQXV0IjoxMjM0NTY3ODkwMTIzNH0%3D',
  'el QR fiscal es byte a byte el de qr.ts (mismo JSON, mismo orden, mismos numeros)');
select is(
  (select payload->>'qr_url' from public.print_jobs where document_type = 'fiscal_receipt'),
  private.fiscal_qr_url((select d from public.fiscal_documents d where d.id = 'f7000000-0000-4000-8000-000000000001')),
  'y es el que viaja en el ticket');

select * from finish();
rollback;
