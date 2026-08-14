-- H-07 y B3 · Aislamiento por rol sobre las superficies de back office.
--
-- Los seis actores del encargo: owner, admin, staff, rider, cliente autenticado
-- sin membresía y anónimo. Tres tablas representativas de las 28 que cambiaron:
-- caja (pos_sales), auditoría de comandos con payload de pedidos
-- (business_command_receipts) y operación (operational_alerts).
--
-- Y dos invariantes que valen para todo el esquema, no sólo para estas tres:
-- ninguna policy sigue apoyada en `is_business_member`, y no queda ni una tabla
-- de `public` sin RLS.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('10000000-0000-4000-8000-00000000da01','authenticated','authenticated','owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('10000000-0000-4000-8000-00000000da02','authenticated','authenticated','admin@example.invalid','',now(),'{}','{}',now(),now()),
  ('10000000-0000-4000-8000-00000000da03','authenticated','authenticated','staff@example.invalid','',now(),'{}','{}',now(),now()),
  ('10000000-0000-4000-8000-00000000da04','authenticated','authenticated','rider@example.invalid','',now(),'{}','{}',now(),now()),
  ('10000000-0000-4000-8000-00000000da05','authenticated','authenticated','customer@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values('20000000-0000-4000-8000-00000000da01','TABA aislamiento','open','taba-role-isolation',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('20000000-0000-4000-8000-00000000da01','10000000-0000-4000-8000-00000000da01','owner',true),
  ('20000000-0000-4000-8000-00000000da01','10000000-0000-4000-8000-00000000da02','admin',true),
  ('20000000-0000-4000-8000-00000000da01','10000000-0000-4000-8000-00000000da03','staff',true),
  ('20000000-0000-4000-8000-00000000da01','10000000-0000-4000-8000-00000000da04','rider',true);
-- El cliente (…da05) NO tiene membresía. Es el control de «autenticado ajeno».

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('11000000-0000-4000-8000-00000000da01','10000000-0000-4000-8000-00000000da01','20000000-0000-4000-8000-00000000da01','owner','panel_web'),
  ('11000000-0000-4000-8000-00000000da02','10000000-0000-4000-8000-00000000da02','20000000-0000-4000-8000-00000000da01','admin','panel_web'),
  ('11000000-0000-4000-8000-00000000da03','10000000-0000-4000-8000-00000000da03','20000000-0000-4000-8000-00000000da01','staff','panel_web'),
  ('11000000-0000-4000-8000-00000000da04','10000000-0000-4000-8000-00000000da04','20000000-0000-4000-8000-00000000da01','rider','rider_android');

insert into public.pos_sales(business_id,operator_id,idempotency_key,state,total)
values('20000000-0000-4000-8000-00000000da01','10000000-0000-4000-8000-00000000da01','role-isolation-sale','completed',1000);

insert into public.business_command_receipts(business_id,order_id,actor_user_id,command_type,idempotency_key,request_hash,result)
values('20000000-0000-4000-8000-00000000da01',null,'10000000-0000-4000-8000-00000000da01','accept_order','role-isolation-cmd',
       repeat('a',64),'{"customer":"dato personal que un repartidor no tiene por que ver"}'::jsonb);

insert into public.operational_alerts(business_id,fingerprint,severity,alert_code,subject_type,status,summary,required_action)
values('20000000-0000-4000-8000-00000000da01',repeat('b',64),'WARNING','ROLE_ISOLATION_TEST','service_health','open',
       'Alerta de prueba de aislamiento','Ninguna: es una prueba');

-- ── owner ───────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-00000000da01","role":"authenticated","session_id":"11000000-0000-4000-8000-00000000da01"}';
select is((select count(*)::integer from public.pos_sales), 1, 'owner lee la caja');
select is((select count(*)::integer from public.business_command_receipts), 1, 'owner lee la auditoria de comandos');
select is((select count(*)::integer from public.operational_alerts), 1, 'owner lee las alertas operativas');

-- ── admin ───────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-00000000da02","role":"authenticated","session_id":"11000000-0000-4000-8000-00000000da02"}';
select is((select count(*)::integer from public.pos_sales), 1, 'admin lee la caja');
select is((select count(*)::integer from public.business_command_receipts), 1, 'admin lee la auditoria de comandos');
select is((select count(*)::integer from public.operational_alerts), 1, 'admin lee las alertas operativas');

-- ── staff ───────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-00000000da03","role":"authenticated","session_id":"11000000-0000-4000-8000-00000000da03"}';
select is((select count(*)::integer from public.pos_sales), 1, 'staff lee la caja: el Panel no pierde nada');
select is((select count(*)::integer from public.business_command_receipts), 1, 'staff lee la auditoria de comandos');
select is((select count(*)::integer from public.operational_alerts), 1, 'staff lee las alertas operativas');

-- ── rider · EL CAMBIO DE H-07 ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-00000000da04","role":"authenticated","session_id":"11000000-0000-4000-8000-00000000da04"}';
select is((select count(*)::integer from public.pos_sales), 0, 'H-07: el repartidor NO lee la caja');
select is((select count(*)::integer from public.business_command_receipts), 0, 'H-07: el repartidor NO lee la auditoria ni los datos personales que lleva');
select is((select count(*)::integer from public.operational_alerts), 0, 'H-07: el repartidor NO lee las alertas operativas');
-- Sigue siendo miembro: el arreglo le quita superficie de back office, no su
-- pertenencia ni el acceso a los pedidos que tiene asignados.
select is(public.is_business_member('20000000-0000-4000-8000-00000000da01'), true, 'el repartidor sigue siendo miembro del comercio');
select is(public.has_business_role('20000000-0000-4000-8000-00000000da01', array['rider']), true, 'el repartidor conserva su rol');
select is(public.has_business_role('20000000-0000-4000-8000-00000000da01', array['owner','admin','staff']), false, 'el repartidor no pertenece al equipo de back office');

-- ── cliente autenticado sin membresía ───────────────────────────────────────
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-00000000da05","role":"authenticated","session_id":null}';
select is((select count(*)::integer from public.pos_sales), 0, 'un autenticado ajeno no lee la caja');
select is((select count(*)::integer from public.business_command_receipts), 0, 'un autenticado ajeno no lee la auditoria');
select is((select count(*)::integer from public.operational_alerts), 0, 'un autenticado ajeno no lee las alertas');

-- ── anónimo ─────────────────────────────────────────────────────────────────
-- Acá no alcanza con contar: si `anon` no tiene el privilegio, la consulta ni
-- siquiera llega a RLS. Se afirma sobre el privilegio, que es la capa real.
set local role postgres;
select is(has_table_privilege('anon','public.pos_sales','select'), false, 'anon no tiene privilegio de lectura sobre la caja');
select is(has_table_privilege('anon','public.business_command_receipts','select'), false, 'anon no tiene privilegio de lectura sobre la auditoria');
select is(has_table_privilege('anon','public.operational_alerts','select'), false, 'anon no tiene privilegio de lectura sobre las alertas');

-- ── B3 · commercial_contract_remediation ────────────────────────────────────
select is((select relrowsecurity from pg_class where oid='public.commercial_contract_remediation'::regclass), true,
  'B3: la tabla de remediacion tiene RLS');
select is(has_table_privilege('anon','public.commercial_contract_remediation','select'), false,
  'B3: anon no lee la tabla de remediacion');
select is(has_table_privilege('anon','public.commercial_contract_remediation','insert'), false,
  'B3: anon NO PUEDE INSERTAR en la tabla de remediacion');
select is(has_table_privilege('authenticated','public.commercial_contract_remediation','insert'), false,
  'B3: un autenticado cualquiera tampoco inserta');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='commercial_contract_remediation'), 0,
  'B3: sin policies, a proposito: no hay a quien habilitar');

-- ── Invariantes de todo el esquema ──────────────────────────────────────────
select is(
  (select count(*)::integer from pg_policies p
    where p.schemaname='public'
      and (coalesce(p.qual,'') like '%is_business_member%' or coalesce(p.with_check,'') like '%is_business_member%')),
  0,
  'H-07: ninguna policy queda apoyada en is_business_member');

select is(
  (select count(*)::integer from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false),
  0,
  'no queda ni una tabla de public sin RLS');

select * from finish();
rollback;
