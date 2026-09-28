-- FRONTERA DE SECRETOS FISCALES
--
-- El Panel (y cualquier navegador) nunca recibe ni entrega la clave privada, los
-- bytes del certificado, su contraseña, el ticket de WSAA (token y sign) ni
-- credenciales de servicio. La base guarda sólo METADATA del certificado
-- (huella, vencimiento, CUIT del sujeto, última verificación); el worker lee sus
-- secretos de archivos del servidor. Esta prueba fija esa frontera para que una
-- migración futura no la cruce sin que falle el CI.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ── 1 · El esquema no tiene dónde guardar un secreto fiscal ─────────────────
select is(
  (select count(*)::integer
     from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
      and c.relname ~* '(fiscal|arca|afip|wsaa)'
      and a.attnum > 0 and not a.attisdropped
      and a.attname ~* '(private|secret|password|passphrase|pem|pkcs|p12|wsaa|access_token|refresh_token|\msign\M)'),
  0, 'ninguna tabla fiscal tiene una columna para clave, contraseña, PEM/PKCS o ticket de WSAA');

select ok(
  (select bool_and(has_column_privilege('authenticated', 'public.fiscal_profiles', col, 'SELECT'))
     from unnest(array['certificate_fingerprint_sha256', 'certificate_expires_at', 'certificate_subject_cuit']) col),
  'el Panel ve la METADATA del certificado: huella, vencimiento y CUIT del sujeto');

-- ── 2 · Por el Panel no entra material secreto ──────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('ce000000-0000-4000-8000-0000000000a1','authenticated','authenticated','owner@secret-boundary.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code)
values ('ce000000-0000-4000-8000-0000000000b1','Frontera fiscal','closed','secret-boundary',true,'America/Argentina/Buenos_Aires','ARS');
insert into public.business_members(business_id,user_id,role,is_active)
values ('ce000000-0000-4000-8000-0000000000b1','ce000000-0000-4000-8000-0000000000a1','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('ce000000-0000-4000-8000-0000000000c1','ce000000-0000-4000-8000-0000000000a1','ce000000-0000-4000-8000-0000000000b1','owner','panel_web');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ce000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"ce000000-0000-4000-8000-0000000000c1"}';

select throws_ok(
  $$select public.configure_fiscal_profile('ce000000-0000-4000-8000-0000000000b1', jsonb_build_object(
      'legal_name','Frontera','cuit','20123456789','tax_condition','Responsable Inscripto','environment','homologation',
      'point_of_sale',1,'is_enabled',true,'default_recipient_condition','Consumidor Final',
      'private_key','contenido de una clave privada'))$$,
  '22023', 'payload fiscal no permitido', 'una clave privada no entra por el Panel');

select throws_ok(
  $$select public.configure_fiscal_profile('ce000000-0000-4000-8000-0000000000b1', jsonb_build_object(
      'legal_name','Frontera','cuit','20123456789','tax_condition','Responsable Inscripto','environment','homologation',
      'point_of_sale',1,'is_enabled',true,'default_recipient_condition','Consumidor Final',
      'certificate_pem','contenido de un certificado','certificate_password','x'))$$,
  '22023', 'payload fiscal no permitido', 'ni un certificado ni su contraseña');

-- ── 3 · Lo que el Panel lee del estado de ARCA no trae secretos ─────────────
select is(
  (select count(*)::integer
     from jsonb_object_keys(public.get_arca_activation_status('ce000000-0000-4000-8000-0000000000b1')) k
    where k ~* '(private|secret|password|passphrase|pem|pkcs|p12|token|\msign\M)'),
  0, 'el estado de ARCA que ve el Panel no tiene ningún campo secreto');

select ok(
  (public.get_arca_activation_status('ce000000-0000-4000-8000-0000000000b1') ? 'certificate_loaded'),
  'dice si hay certificado cargado, sin mostrarlo');

reset role;

-- ── 4 · El trabajo del worker no es del navegador ───────────────────────────
select ok(
  not has_function_privilege('authenticated', 'public.claim_fiscal_outbox(text,text,text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_fiscal_outbox(text,text,text,integer,integer)', 'EXECUTE'),
  'reclamar trabajo fiscal es sólo del worker (clave de servicio)');

select * from finish();
rollback;
