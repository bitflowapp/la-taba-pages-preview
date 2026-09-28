-- DOS INVARIANTES QUE NO RESISTÍAN UN NULL (20260928170000)
--
--   · Una cuenta que aceptó una invitación se puede borrar: la aceptación queda
--     como constancia y un usuario sin aceptación sigue prohibido.
--   · La venta de alcohol no se enciende con la edad mínima vacía.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('cd000000-0000-4000-8000-0000000000a1','authenticated','authenticated','owner@nullsafe.invalid','',now(),'{}','{}',now(),now()),
  ('cd000000-0000-4000-8000-0000000000a2','authenticated','authenticated','rider@nullsafe.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code)
values ('cd000000-0000-4000-8000-0000000000b1','Invariantes','closed','nullsafe',true,'America/Argentina/Buenos_Aires','ARS');
insert into public.business_members(business_id,user_id,role,is_active)
values
  ('cd000000-0000-4000-8000-0000000000b1','cd000000-0000-4000-8000-0000000000a1','owner',true),
  ('cd000000-0000-4000-8000-0000000000b1','cd000000-0000-4000-8000-0000000000a2','rider',true);
-- Una invitación aceptada por el repartidor y otra todavía pendiente.
insert into public.identity_invitations(id,business_id,invited_email,invited_role,full_name,token_hash,invited_by,invited_by_role,
  expires_at,accepted_at,accepted_user_id)
values
  ('cd000000-0000-4000-8000-0000000000e1','cd000000-0000-4000-8000-0000000000b1','rider@nullsafe.invalid','rider','Rider Uno',
    repeat('a',64),'cd000000-0000-4000-8000-0000000000a1','owner',now() + interval '1 day',now(),'cd000000-0000-4000-8000-0000000000a2'),
  ('cd000000-0000-4000-8000-0000000000e2','cd000000-0000-4000-8000-0000000000b1','pendiente@nullsafe.invalid','staff','Pendiente',
    repeat('b',64),'cd000000-0000-4000-8000-0000000000a1','owner',now() + interval '1 day',null,null);

-- ── 1 · La cuenta que aceptó una invitación se puede borrar ────────────────
select lives_ok($$delete from auth.users where id = 'cd000000-0000-4000-8000-0000000000a2'$$,
  'se borra la cuenta de alguien que entró al equipo por invitación');
select is((select accepted_user_id from public.identity_invitations where id = 'cd000000-0000-4000-8000-0000000000e1'), null::uuid,
  'la invitación ya no apunta a nadie');
select isnt((select accepted_at from public.identity_invitations where id = 'cd000000-0000-4000-8000-0000000000e1'), null::timestamptz,
  'y conserva la constancia de que se aceptó');
select is((select count(*) from public.business_members where user_id = 'cd000000-0000-4000-8000-0000000000a2'), 0::bigint,
  'la membresía se fue con la cuenta');
select throws_ok($$update public.identity_invitations set accepted_user_id = 'cd000000-0000-4000-8000-0000000000a1'
  where id = 'cd000000-0000-4000-8000-0000000000e2'$$, '23514', null,
  'un usuario aceptante sin fecha de aceptación sigue prohibido');
select lives_ok($$insert into public.identity_invitations(business_id,invited_email,invited_role,full_name,token_hash,invited_by,
  invited_by_role,expires_at) values ('cd000000-0000-4000-8000-0000000000b1','rider@nullsafe.invalid','rider','Rider Uno',
  repeat('c',64),'cd000000-0000-4000-8000-0000000000a1','owner',now() + interval '1 day')$$,
  'el mismo correo se puede volver a invitar');

-- ── 2 · Alcohol: nunca encendido con la edad vacía ─────────────────────────
select throws_ok($$update public.businesses set alcohol_sales_enabled = true, alcohol_minimum_age = null,
  alcohol_sales_start = '10:00', alcohol_sales_end = '23:00', alcohol_timezone = 'America/Argentina/Buenos_Aires'
  where id = 'cd000000-0000-4000-8000-0000000000b1'$$, '23514', null,
  'la venta de alcohol no se enciende con la edad mínima vacía');
select throws_ok($$update public.businesses set alcohol_sales_enabled = true, alcohol_minimum_age = 17,
  alcohol_sales_start = '10:00', alcohol_sales_end = '23:00', alcohol_timezone = 'America/Argentina/Buenos_Aires'
  where id = 'cd000000-0000-4000-8000-0000000000b1'$$, '23514', null,
  'ni con una edad menor a 18');
select throws_ok($$update public.businesses set alcohol_sales_enabled = true, alcohol_minimum_age = 18,
  alcohol_sales_start = null, alcohol_sales_end = '23:00', alcohol_timezone = 'America/Argentina/Buenos_Aires'
  where id = 'cd000000-0000-4000-8000-0000000000b1'$$, '23514', null,
  'ni sin franja horaria');
select lives_ok($$update public.businesses set alcohol_sales_enabled = true, alcohol_minimum_age = 18,
  alcohol_sales_start = '10:00', alcohol_sales_end = '23:00', alcohol_timezone = 'America/Argentina/Buenos_Aires'
  where id = 'cd000000-0000-4000-8000-0000000000b1'$$,
  'con la política completa se enciende');
select throws_ok($$update public.businesses set alcohol_minimum_age = null
  where id = 'cd000000-0000-4000-8000-0000000000b1'$$, '23514', null,
  'encendida, no se puede vaciar la edad');
select lives_ok($$update public.businesses set alcohol_sales_enabled = false, alcohol_minimum_age = null
  where id = 'cd000000-0000-4000-8000-0000000000b1'$$,
  'apagada, la edad puede quedar vacía');

select * from finish();
rollback;
