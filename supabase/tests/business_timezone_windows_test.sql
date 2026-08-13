-- El día comercial pertenece al negocio (F32).
--
-- El cierre de caja es el único registro de día que este sistema congela para
-- siempre. Lo que estas pruebas sostienen es que su ventana sale de
-- `businesses.operating_timezone` y de ningún otro lado: ni del parámetro que
-- manda el cliente, ni del huso del servidor, ni de un offset fijo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('81000000-0000-4000-8000-000000000001','authenticated','authenticated','f32-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values ('82000000-0000-4000-8000-000000000001','TABA F32 fixture','open','taba-f32-fixture',true,'America/Argentina/Buenos_Aires');
insert into public.business_members(business_id,user_id,role,is_active)
values ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner',true);

-- Un negocio en otro huso, para que «día comercial» no se confunda nunca con
-- «día UTC» por accidente de que Argentina esté a -3.
insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values ('82000000-0000-4000-8000-000000000002','TABA F32 Tokio','open','taba-f32-tokio',true,'Asia/Tokyo');
insert into public.business_members(business_id,user_id,role,is_active)
values ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','owner',true);

-- Un negocio SIN huso: tiene que negarse a cerrar en vez de inventar uno.
insert into public.businesses(id,name,status,slug,is_active)
values ('82000000-0000-4000-8000-000000000003','TABA F32 sin huso','open','taba-f32-sin-huso',true);
insert into public.business_members(business_id,user_id,role,is_active)
values ('82000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('81100000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','owner','panel_web'),
  ('81100000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','owner','panel_web'),
  ('81100000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000003','owner','panel_web');

set local role authenticated;
set local request.jwt.claims = '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"81100000-0000-4000-8000-000000000001"}';

-- ── La ventana sale del negocio, no del parámetro ──────────────────────────
-- Se pasa 'UTC' a propósito: es exactamente lo que mandaría un teléfono mal
-- configurado, y es lo que antes torcía el día tres horas.
select lives_ok(
  $$select public.prepare_daily_reconciliation(
      '82000000-0000-4000-8000-000000000001','2026-08-13','UTC',0,null,'f32-ar-window-1')$$,
  'el cierre se prepara aunque el cliente mande un huso ajeno');
select is(
  (select window_start from public.daily_reconciliations
    where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13'),
  '2026-08-13 03:00:00+00'::timestamptz,
  'la ventana arranca a medianoche ARGENTINA (03:00Z), no a medianoche UTC');
select is(
  (select window_end from public.daily_reconciliations
    where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13'),
  '2026-08-14 03:00:00+00'::timestamptz,
  'y termina 24 h despues, en la medianoche argentina siguiente');
select is(
  (select timezone from public.daily_reconciliations
    where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13'),
  'America/Argentina/Buenos_Aires',
  'la fila guarda el huso REALMENTE usado, no el que mando el cliente');

-- ── El borde: 21:30 y 23:30 locales caen en el dia correcto ───────────────
-- Con el bug, un cobro de las 21:30 ART del 13 caia fuera del cierre del 13,
-- porque en UTC ya era el 14.
select ok(
  '2026-08-13 21:30:00-03'::timestamptz >= (select window_start from public.daily_reconciliations
     where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13')
  and '2026-08-13 21:30:00-03'::timestamptz < (select window_end from public.daily_reconciliations
     where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13'),
  'un cobro de las 21:30 locales pertenece a su propio dia comercial');
select ok(
  '2026-08-13 23:59:00-03'::timestamptz < (select window_end from public.daily_reconciliations
     where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13'),
  'las 23:59 locales todavia son del mismo dia');
select ok(
  '2026-08-14 00:01:00-03'::timestamptz >= (select window_end from public.daily_reconciliations
     where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13'),
  'pasada la medianoche local ya es el dia siguiente');
select ok(
  '2026-08-13 09:30:00-03'::timestamptz <> '2026-08-13 21:30:00-03'::timestamptz
  and '2026-08-13 09:30:00-03'::timestamptz >= (select window_start from public.daily_reconciliations
     where business_id='82000000-0000-4000-8000-000000000001' and business_date='2026-08-13'),
  '09:30 y 21:30 son momentos distintos y ambos del mismo dia comercial');

-- ── Otro huso, otro dia ────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"81100000-0000-4000-8000-000000000002"}';
select lives_ok(
  $$select public.prepare_daily_reconciliation(
      '82000000-0000-4000-8000-000000000002','2026-08-13','America/Argentina/Buenos_Aires',0,null,'f32-jp-window-1')$$,
  'un negocio en otro huso tambien prepara su cierre');
select is(
  (select window_start from public.daily_reconciliations
    where business_id='82000000-0000-4000-8000-000000000002' and business_date='2026-08-13'),
  '2026-08-12 15:00:00+00'::timestamptz,
  'el negocio de Tokio arranca su dia en SU medianoche, no en la argentina');
select is(
  (select timezone from public.daily_reconciliations
    where business_id='82000000-0000-4000-8000-000000000002' and business_date='2026-08-13'),
  'Asia/Tokyo','y su fila lo declara');

-- ── Sin huso configurado: se niega, no adivina ────────────────────────────
set local request.jwt.claims = '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"81100000-0000-4000-8000-000000000003"}';
select throws_ok(
  $$select public.prepare_daily_reconciliation(
      '82000000-0000-4000-8000-000000000003','2026-08-13','America/Argentina/Buenos_Aires',0,null,'f32-nohuso-1')$$,
  '55000','el negocio no tiene huso horario configurado: no se puede cerrar el dia',
  'un negocio sin huso no cierra el dia: falla cerrado en vez de inventar uno');

-- ── El huso se valida contra el catalogo, no contra una lista a mano ───────
reset role;
select throws_ok(
  $$update public.businesses set operating_timezone = 'America/Nowhere'
     where id = '82000000-0000-4000-8000-000000000001'$$,
  '22023',null,'un huso inexistente se rechaza al escribirlo');
select lives_ok(
  $$update public.businesses set operating_timezone = 'America/Argentina/Cordoba'
     where id = '82000000-0000-4000-8000-000000000001'$$,
  'un huso IANA real se acepta');

select * from finish();
rollback;
