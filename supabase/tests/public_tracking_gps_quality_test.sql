-- Contrato público de calidad de GPS (F26 + F36).
--
-- Lo que esta prueba tiene que demostrar, y es el motivo de que exista: la
-- calidad se decide sobre la accuracy ORIGINAL, no sobre la que el servidor
-- publica. El número público lleva piso de 100 m, así que un fix de 12 m y uno
-- de 95 m salen los DOS como 100: si la calidad se dedujera de ahí, serían
-- indistinguibles. Acá se comprueba que no lo son.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('71000000-0000-4000-8000-000000000001','authenticated','authenticated','f26-rider@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active)
values ('72000000-0000-4000-8000-000000000001','TABA F26 fixture','open','taba-f26-fixture',true);
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,payment_method,subtotal,delivery_fee,total,
  assigned_rider_user_id
) values (
  '73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'F26-FIXTURE-1','F26-FIXTURE-1','on_the_way','delivery','delivery',
  'f26-fixture-request-1','CLIENTE_SINTETICO_NO_CACHEAR','cash',1000,0,1000,
  '71000000-0000-4000-8000-000000000001'
);
insert into public.order_public_tokens(order_id,token,token_hash,expires_at)
values ('73000000-0000-4000-8000-000000000001',null,
        extensions.digest('f26_gps_quality_token_0123456789abcdef','sha256'),
        clock_timestamp() + interval '30 days');

set local request.headers = '{"x-order-token":"f26_gps_quality_token_0123456789abcdef"}';

-- Un solo lugar para sembrar el fix del rider, para que cada caso se lea por lo
-- que cambia y no por el andamiaje.
create or replace function pg_temp.seed_fix(p_accuracy double precision, p_age interval)
returns void language sql as $$
  delete from public.rider_locations where order_id = '73000000-0000-4000-8000-000000000001';
  insert into public.rider_locations(order_id,business_id,rider_user_id,lat,lng,accuracy,source,order_revision,captured_at,created_at)
  values ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
          '71000000-0000-4000-8000-000000000001',-38.9460616,-68.0533209,p_accuracy,'gps',1,
          clock_timestamp() - p_age, clock_timestamp() - p_age);
$$;

-- ── Fix bueno y fresco ─────────────────────────────────────────────────────
select pg_temp.seed_fix(12, interval '5 seconds');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'valid','un fix fresco y preciso se declara valido');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')#>>'{rider_location,accuracy}',
  '100','la precision publicada sigue con piso de 100 m: la privacidad no se afloja');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')#>>'{rider_location,lat}',
  '-38.9461','la coordenada publica sigue redondeada a 4 decimales');

-- ── EL CASO QUE JUSTIFICA TODO: mismo numero publico, calidad distinta ──────
select pg_temp.seed_fix(95, interval '5 seconds');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')#>>'{rider_location,accuracy}',
  '100','un fix de 95 m publica exactamente el mismo 100 que uno de 12 m');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'low_accuracy','y sin embargo NO se declara valido: la calidad sale del dato original');

-- ── Accuracy insuficiente, ya visible en el numero ─────────────────────────
select pg_temp.seed_fix(150, interval '5 seconds');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'low_accuracy','una precision pobre no se declara valida');
select isnt(
  public.get_public_order_tracking('F26-FIXTURE-1')#>'{rider_location}',
  null,'pero la ubicacion se sigue entregando: sirve aunque sea orientativa');

-- ── Fix viejo ──────────────────────────────────────────────────────────────
select pg_temp.seed_fix(12, interval '5 minutes');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'stale','un fix fuera de la ventana de 3 minutos se declara stale');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')#>'{rider_location}',
  null,'y no entrega coordenadas viejas disfrazadas de actuales');

-- ── Datos que no sostienen ninguna afirmacion: falla cerrado ───────────────
select pg_temp.seed_fix(null, interval '5 seconds');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'unavailable','una accuracy NULL no habilita a afirmar calidad');
select pg_temp.seed_fix(300, interval '5 seconds');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'unavailable','una accuracy fuera de rango tampoco');

-- ── Rider asignado pero sin ningun fix ─────────────────────────────────────
delete from public.rider_locations where order_id = '73000000-0000-4000-8000-000000000001';
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'unavailable','sin ningun fix no se inventa una ubicacion');

-- ── Sin rider asignado ─────────────────────────────────────────────────────
select pg_temp.seed_fix(12, interval '5 seconds');
update public.orders set assigned_rider_user_id = null where id = '73000000-0000-4000-8000-000000000001';
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'location_quality',
  'unavailable','sin rider asignado el seguimiento no afirma nada');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')#>'{rider_location}',
  null,'y tampoco filtra el punto de un rider que no esta a cargo');

-- ── La clave viaja SIEMPRE ─────────────────────────────────────────────────
select ok(
  public.get_public_order_tracking('F26-FIXTURE-1') ? 'location_quality',
  'location_quality nunca se omite: su ausencia solo puede significar servidor viejo');

-- ── F25 sigue en pie ───────────────────────────────────────────────────────
update public.orders set assigned_rider_user_id = '71000000-0000-4000-8000-000000000001'
 where id = '73000000-0000-4000-8000-000000000001';
-- Se usa un cierre por cancelacion y no por entrega: llegar a 'delivered' exige
-- un codigo de entrega confirmado (prevent_unverified_delivery), que es una
-- regla real y no algo que esta prueba deba esquivar. La ventana terminal cubre
-- los cuatro estados finales por igual.
update public.orders set status = 'canceled', canceled_at = clock_timestamp()
 where id = '73000000-0000-4000-8000-000000000001';
select isnt(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'terminal_visible_until',
  null,'la ventana terminal de F25 se sigue publicando');
select is(
  public.get_public_order_tracking('F26-FIXTURE-1')->>'status',
  'canceled','y el pedido cerrado se sigue viendo dentro de esa ventana');

select * from finish();
rollback;
