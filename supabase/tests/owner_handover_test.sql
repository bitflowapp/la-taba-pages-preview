-- EL TRASPASO DE DUEÑO: MARCO (DUEÑO TÉCNICO) → WALTER (DUEÑO COMERCIAL)
--
-- Es el camino de docs/STORE-OPENING-RUNBOOK.md, «Walter como dueño, Marco como
-- encargado técnico», contra la base real:
--   · un encargado no invita dueños; el dueño sí;
--   · el invitado acepta con SU cuenta y queda dueño;
--   · el dueño nuevo pasa al dueño técnico a encargado, y eso le cierra las
--     sesiones abiertas (tiene que volver a entrar con su rol nuevo);
--   · ya encargado, Marco no puede tocar al dueño;
--   · nadie deja al comercio sin dueño (`last_owner`), ni cambiando el rol ni
--     desactivando.
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('cf000000-0000-4000-8000-0000000000a1','authenticated','authenticated','marco@handover.invalid','',now(),'{}','{}',now(),now()),
  ('cf000000-0000-4000-8000-0000000000a2','authenticated','authenticated','walter@handover.invalid','',now(),'{}','{}',now(),now()),
  ('cf000000-0000-4000-8000-0000000000a3','authenticated','authenticated','ana@handover.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code)
values ('cf000000-0000-4000-8000-0000000000b1','Traspaso','closed','owner-handover',true,'America/Argentina/Buenos_Aires','ARS');
insert into public.business_members(business_id,user_id,role,is_active)
values
  ('cf000000-0000-4000-8000-0000000000b1','cf000000-0000-4000-8000-0000000000a1','owner',true),
  ('cf000000-0000-4000-8000-0000000000b1','cf000000-0000-4000-8000-0000000000a3','admin',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('cf000000-0000-4000-8000-0000000000c1','cf000000-0000-4000-8000-0000000000a1','cf000000-0000-4000-8000-0000000000b1','owner','panel_web'),
  ('cf000000-0000-4000-8000-0000000000c3','cf000000-0000-4000-8000-0000000000a3','cf000000-0000-4000-8000-0000000000b1','admin','panel_web');

create temporary table handover(token text) on commit drop;
grant insert, select on handover to authenticated;

-- ── 1 · Quién invita a un dueño ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"cf000000-0000-4000-8000-0000000000a3","role":"authenticated","session_id":"cf000000-0000-4000-8000-0000000000c3"}';
select is(public.identity_create_invitation('cf000000-0000-4000-8000-0000000000b1','walter@handover.invalid','owner','Walter',
  interval '2 days') ->> 'code', 'role_above_actor', 'un encargado no invita dueños');

set local request.jwt.claims = '{"sub":"cf000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"cf000000-0000-4000-8000-0000000000c1"}';
insert into handover select public.identity_create_invitation('cf000000-0000-4000-8000-0000000000b1','walter@handover.invalid',
  'owner','Walter', interval '2 days') ->> 'token';
select ok((select token ~ '^[0-9a-f]{64}$' from handover), 'el dueño técnico invita a Walter como dueño');

-- ── 2 · Walter acepta con su propia cuenta ──────────────────────────────────
set local request.jwt.claims = '{"sub":"cf000000-0000-4000-8000-0000000000a2","role":"authenticated","email":"walter@handover.invalid"}';
select is(public.identity_accept_invitation((select token from handover)) ->> 'role', 'owner', 'Walter acepta y queda dueño');
reset role;
select is(public.identity_count_active_owners('cf000000-0000-4000-8000-0000000000b1'), 2, 'por un momento hay dos dueños');

-- ── 3 · Walter pasa a Marco a encargado ─────────────────────────────────────
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('cf000000-0000-4000-8000-0000000000c2','cf000000-0000-4000-8000-0000000000a2','cf000000-0000-4000-8000-0000000000b1','owner','panel_web');
set local role authenticated;
set local request.jwt.claims = '{"sub":"cf000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"cf000000-0000-4000-8000-0000000000c2"}';
select is(public.identity_set_member_role('cf000000-0000-4000-8000-0000000000b1','cf000000-0000-4000-8000-0000000000a1','admin') ->> 'ok',
  'true', 'Walter pasa a Marco a encargado');
reset role;
select is((select role from public.business_members where business_id='cf000000-0000-4000-8000-0000000000b1'
  and user_id='cf000000-0000-4000-8000-0000000000a1'), 'admin', 'Marco queda encargado técnico');
select is((select revoked_reason from public.identity_sessions where session_id='cf000000-0000-4000-8000-0000000000c1'),
  'role_changed', 'la sesión que Marco tenía como dueño se cierra: vuelve a entrar con su rol nuevo');

-- ── 4 · Ya encargado, Marco no toca al dueño ────────────────────────────────
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('cf000000-0000-4000-8000-0000000000c4','cf000000-0000-4000-8000-0000000000a1','cf000000-0000-4000-8000-0000000000b1','admin','panel_web');
set local role authenticated;
set local request.jwt.claims = '{"sub":"cf000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"cf000000-0000-4000-8000-0000000000c4"}';
select throws_ok($$select public.identity_set_member_role('cf000000-0000-4000-8000-0000000000b1','cf000000-0000-4000-8000-0000000000a2','admin')$$,
  '42501', null, 'el encargado no puede quitarle el rol al dueño');
select is(public.identity_create_invitation('cf000000-0000-4000-8000-0000000000b1','repartidor@handover.invalid','rider','Repartidor',
  interval '2 days') ->> 'ok', 'true', 'pero sigue invitando repartidores (y empleados)');

-- ── 5 · Nunca sin dueño ─────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"cf000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"cf000000-0000-4000-8000-0000000000c2"}';
select is(public.identity_set_member_role('cf000000-0000-4000-8000-0000000000b1','cf000000-0000-4000-8000-0000000000a2','admin') ->> 'code',
  'last_owner', 'el único dueño no puede dejar de serlo');
select is(public.identity_set_member_active('cf000000-0000-4000-8000-0000000000b1','cf000000-0000-4000-8000-0000000000a2',false,
  'probar el tope') ->> 'code', 'last_owner', 'ni desactivarse');
reset role;
select is(public.identity_count_active_owners('cf000000-0000-4000-8000-0000000000b1'), 1, 'queda exactamente un dueño: Walter');

select * from finish();
rollback;
