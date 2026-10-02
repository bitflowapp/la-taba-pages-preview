-- TABA · EL SNAPSHOT DE MERCADO PAGO Y LA FINALIZACIÓN DEL CHECKOUT PAGADO
--
-- Cubre 20261001200000 .. 20261001200200:
--
--   A  un rechazo no libera la reserva: rechazado -> aprobado en la misma
--      preferencia termina en UN pedido con el stock descontado una vez
--   B  el stock de un rechazo vuelve cuando vence la sesión (barrido), una vez
--   C  nuestra propia cancelación y el `expired` del proveedor siguen liberando
--   D  con las últimas unidades, el rechazo no se las deja a otro comprador
--   E  reintento controlado: el pago rechazado de la preferencia anterior no manda
--      el intento nuevo a revisión; una preferencia ajena sí
--   F  identidad del pago: aprobado X + rechazado Y (X queda), aprobado X +
--      aprobado Y (cobro duplicado marcado), en proceso más nuevo + aprobado más
--      viejo (el aprobado gana)
--   G  `completed` es terminal para la sesión y su intent; trigger de transición
--   H  reintentar un trabajo de webhook es idempotente, y el mismo recibo con el
--      pago en otro estado no pierde el evento
--   I  un snapshot idéntico no escribe evento ni sube revisiones
--   J  la confirmación de edad llega al pedido
--   K  la guarda de pago de la finalización no deja pasar un NULL
--   L  el pedido que entra con el comercio cerrado, en pausa, con los pedidos
--      apagados o con el canal deshabilitado queda marcado
--   M  la sonda encola sin el id de un pago rechazado (la mitad SQL: que el worker
--      busque por referencia es un cambio de la función Edge)
--   N  permisos, volatilidad y orden de locks (el orden se prueba con dos
--      conexiones reales fuera de pgTAP; acá queda fijado en la definición)
--
-- No depende de la hora: los horarios se fuerzan cerrados o abiertos por
-- configuración y los vencimientos se llevan al pasado a mano.
-- Todo transaccional: termina en rollback. Por eso `pg_temp.finalizar` dispara a
-- mano los triggers diferidos de `orders`, que de otro modo no correrían nunca.

begin;
create extension if not exists pgtap with schema extensions;
select plan(146);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table mp_ids (name text primary key, id uuid not null) on commit drop;
create temporary table mp_out (name text primary key, value jsonb) on commit drop;

create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from mp_ids where name = p_name
$$;

create function pg_temp.out(p_name text) returns jsonb language sql stable as $$
  select value from mp_out where name = p_name
$$;

create function pg_temp.usuario(p_name text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
  insert into mp_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio abierto con un producto. Con p_alcohol vende alcohol todo el día:
-- la ventana 00:00-24:00 no depende de la hora en que corra la prueba.
create function pg_temp.negocio(p_key text, p_stock integer, p_alcohol boolean default false)
returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario(p_key || ':owner');
  v_slug text := 'wp3a-' || replace(p_key, '_', '-') || '-' || right(replace(v_business::text, '-', ''), 8);
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode,
    alcohol_sales_enabled, alcohol_minimum_age, alcohol_sales_start, alcohol_sales_end, alcohol_timezone
  ) values (
    v_business, 'TABA snapshot ' || p_key, v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off',
    p_alcohol,
    case when p_alcohol then 18 end,
    case when p_alcohol then time '00:00' end,
    case when p_alcohol then time '24:00' end,
    case when p_alcohol then 'America/Argentina/Buenos_Aires' end
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata ' || p_key,
    case when p_alcohol then 'Cervezas' else 'Gaseosas' end,
    case when p_alcohol then 'Rubia' else 'Cola' end,
    1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    p_stock,true,true,p_alcohol,case when p_alcohol then 18 end,'{}',true,now(),v_owner,
    v_slug || '-sku',v_slug || '-sku','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-' || p_key, 'app-' || p_key, clock_timestamp(), clock_timestamp());
  -- El vendedor conectado por OAuth: sin él la autoridad V2 no deja asentar la preferencia.
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-' || p_key,'app-' || p_key,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into mp_ids values (p_key || ':business', v_business), (p_key || ':product', v_product);
end $$;

-- Asienta la preferencia que devolvió Mercado Pago por el mismo camino que la
-- función Edge (V2, con la autoridad leída en el momento). El registrador
-- anterior queda retirado por el interlock A1-A4 y en CI ya no existe.
create function pg_temp.preferencia(p_session uuid, p_customer uuid, p_attempt uuid, p_ref text)
returns void language plpgsql as $$
declare
  v_business uuid := (select business_id from public.checkout_sessions where id = p_session);
begin
  perform public.record_mercadopago_preference_created_v2(
    v_business, 'test', p_session, p_customer, p_attempt,
    public.get_mercadopago_payment_authority_v2(v_business, 'test', p_session, p_customer, p_attempt) ->> 'authority_version',
    'PREF-' || p_ref,
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_ref,
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_ref,
    encode(digest('pref-' || p_ref, 'sha256'), 'hex'), 'req-' || p_ref);
end $$;

create function pg_temp.stock(p_key text) returns integer language sql stable as $$
  select stock from public.products where id = pg_temp.id(p_key || ':product')
$$;

-- Sesión de retiro lista para pagar, con su preferencia creada: el comprador
-- está en Checkout Pro. Guarda la sesión como p_name y el intent como p_name:intent.
create function pg_temp.checkout(p_name text, p_business_key text, p_quantity integer, p_age_confirmed boolean default false)
returns uuid language plpgsql as $$
declare
  v_customer uuid := pg_temp.usuario(p_name || ':customer');
  v_result jsonb;
  v_prepare jsonb;
  v_session uuid;
begin
  v_result := public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', pg_temp.id(p_business_key || ':business'),
    'client_request_id', 'wp3a_' || md5(p_name),
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', pg_temp.id(p_business_key || ':product'), 'quantity', p_quantity)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Prueba', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', p_age_confirmed, 'payment_method', 'mercadopago'));
  v_session := (v_result ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  perform pg_temp.preferencia(v_session, v_customer, (v_prepare ->> 'payment_attempt_id')::uuid, p_name || '-1');
  insert into mp_ids values (p_name, v_session);
  insert into mp_ids select p_name || ':intent', pi.id from public.payment_intents pi where pi.checkout_session_id = v_session;
  return v_session;
end $$;

-- Lo que el worker persiste después de leer el pago en Mercado Pago. p_seed
-- decide el hash de la respuesta: misma semilla = misma respuesta del proveedor.
create function pg_temp.snap(p_name text, p_payment_id text, p_status text, p_seed text,
  p_at timestamptz default null, p_patch jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
      'provider_payment_id', p_payment_id,
      'external_reference', pi.external_reference,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-' || p_payment_id,
      'collector_id', ps.collector_id,
      'application_id', '',
      'currency', 'ARS',
      'transaction_amount', cs.total::text,
      'status', p_status,
      'status_detail', 'detalle_de_prueba',
      'payment_method', 'visa',
      'live_mode', false,
      'provider_occurred_at', coalesce(p_at, clock_timestamp())::text,
      'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(digest(p_seed, 'sha256'), 'hex')) || p_patch
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
   where pi.checkout_session_id = pg_temp.id(p_name)
$$;

-- Registra el snapshot y guarda la respuesta de la función como p_out. Un error
-- se guarda como {"error": sqlstate}: la prueba sigue y lo cuenta la aserción.
create function pg_temp.registrar(p_out text, p_name text, p_snapshot jsonb,
  p_source text default 'webhook', p_receipt uuid default null)
returns void language plpgsql as $$
declare v_result jsonb;
begin
  begin
    v_result := public.record_mercadopago_payment_snapshot(pg_temp.id(p_name || ':intent'), p_snapshot, p_source, p_receipt);
  exception when others then
    v_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  insert into mp_out values (p_out, v_result)
  on conflict (name) do update set value = excluded.value;
end $$;

-- Finaliza y hace lo que haría el COMMIT del worker: correr los triggers
-- diferidos de `orders` (modalidad de pago, punto de entrega). Todo este archivo
-- es una sola transacción que termina en rollback; sin esto nunca correrían.
create function pg_temp.finalizar(p_out text, p_name text) returns void language plpgsql as $$
declare v_result jsonb;
begin
  begin
    v_result := public.finalize_paid_checkout_session(pg_temp.id(p_name));
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    v_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  insert into mp_out values (p_out, v_result)
  on conflict (name) do update set value = excluded.value;
end $$;

create function pg_temp.sesion(p_name text) returns public.checkout_sessions language sql stable as $$
  select s from public.checkout_sessions s where s.id = pg_temp.id(p_name)
$$;

create function pg_temp.intent(p_name text) returns public.payment_intents language sql stable as $$
  select pi from public.payment_intents pi where pi.checkout_session_id = pg_temp.id(p_name)
$$;

create function pg_temp.eventos(p_name text, p_type text) returns integer language sql stable as $$
  select count(*)::integer from public.payment_events pe
   where pe.payment_intent_id = pg_temp.id(p_name || ':intent') and pe.event_type = p_type
$$;

create function pg_temp.pedidos(p_business_key text) returns integer language sql stable as $$
  select count(*)::integer from public.orders o where o.business_id = pg_temp.id(p_business_key || ':business')
$$;

create function pg_temp.reservas(p_name text, p_status text) returns integer language sql stable as $$
  select count(*)::integer from public.inventory_reservations r
   where r.checkout_session_id = pg_temp.id(p_name) and r.status = p_status
$$;

-- La sesión y sus reservas vencieron hace un minuto.
create function pg_temp.vencer(p_name text) returns void language plpgsql as $$
begin
  update public.checkout_sessions
     set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
   where id = pg_temp.id(p_name);
  update public.inventory_reservations
     set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
   where checkout_session_id = pg_temp.id(p_name);
end $$;

select pg_temp.negocio('a', 10);
select pg_temp.negocio('d', 2);
select pg_temp.negocio('f', 50);
select pg_temp.negocio('g', 50);
select pg_temp.negocio('j', 20, true);
select pg_temp.negocio('l', 20);
select pg_temp.negocio('la', 20, true);

-- ══════════════════════════════════════════════════════════════════════════
--  A · rechazado -> aprobado en la misma preferencia
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('a1', 'a', 2);
select is(pg_temp.stock('a'), 8, 'A: la sesion reserva 2 de 10');

select pg_temp.registrar('a1.rechazo', 'a1', pg_temp.snap('a1', 'PAY-A1-X', 'rejected', 'a1-x-rejected'));
select is(pg_temp.out('a1.rechazo') ->> 'ok', 'true', 'A: el rechazo se registra');
select is(pg_temp.stock('a'), 8, 'A: el rechazo NO devuelve el stock mientras la sesion vale');
select is(pg_temp.reservas('a1', 'active'), 1, 'A: la reserva sigue activa despues del rechazo');
select is((pg_temp.sesion('a1')).status, 'redirected', 'A: la sesion no se cancela por un rechazo del proveedor');
select is((pg_temp.intent('a1')).internal_status, 'rejected', 'A: el intent queda rejected');
select is(pg_temp.eventos('a1', 'payment.rejected'), 1, 'A: el rechazo deja su evento');

select pg_temp.registrar('a1.aprobado', 'a1', pg_temp.snap('a1', 'PAY-A1-Y', 'approved', 'a1-y-approved'));
select is(pg_temp.out('a1.aprobado') ->> 'finalize_required', 'true',
  'A: el aprobado del reintento pide finalizar (CS-01)');
select is(pg_temp.out('a1.aprobado') ->> 'manual_review_required', 'false',
  'A: el aprobado del reintento no va a revision manual');
select is((pg_temp.intent('a1')).provider_payment_id, 'PAY-A1-Y', 'A: el pago aprobado pasa a ser la identidad del intent');
select is((pg_temp.intent('a1')).provider_status, 'approved', 'A: el estado del proveedor es el del pago aprobado');
select is((pg_temp.sesion('a1')).status, 'payment_approved', 'A: la sesion queda payment_approved');

select pg_temp.finalizar('a1.fin', 'a1');
select is(pg_temp.out('a1.fin') ->> 'ok', 'true', 'A: la finalizacion crea el pedido');
select is(pg_temp.pedidos('a'), 1, 'A: exactamente UN pedido');
select is(pg_temp.stock('a'), 8, 'A: el stock se desconto exactamente una vez');
select is(pg_temp.reservas('a1', 'converted') || '/' || pg_temp.reservas('a1', 'active') || '/' || pg_temp.reservas('a1', 'released'),
  '1/0/0', 'A: una reserva convertida, ninguna activa ni liberada');

-- El rechazo viejo vuelve a llegar despues del pedido: no cambia nada.
select pg_temp.registrar('a1.rechazo_tardio', 'a1', pg_temp.snap('a1', 'PAY-A1-X', 'rejected', 'a1-x-rejected'));
select is(pg_temp.out('a1.rechazo_tardio') ->> 'ok', 'true', 'A: el rechazo tardio del primer pago se acepta');
select is((pg_temp.intent('a1')).internal_status || '/' || (pg_temp.intent('a1')).provider_payment_id || '/' || (pg_temp.intent('a1')).provider_status,
  'completed/PAY-A1-Y/approved', 'A: el rechazo tardio no toca el intent completado');
select is((pg_temp.sesion('a1')).status, 'completed', 'A: el rechazo tardio no toca la sesion completada');
select is(pg_temp.pedidos('a') || ':' || pg_temp.stock('a'), '1:8', 'A: sigue habiendo un pedido y el mismo stock');

-- ══════════════════════════════════════════════════════════════════════════
--  B · el stock de un rechazo vuelve cuando vence la sesión
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('b1', 'a', 3);
select is(pg_temp.stock('a'), 5, 'B: la segunda sesion reserva 3');
select pg_temp.registrar('b1.rechazo', 'b1', pg_temp.snap('b1', 'PAY-B1-X', 'rejected', 'b1-x-rejected'));
select pg_temp.vencer('b1');
select ok(public.expire_checkout_sessions(100) >= 1, 'B: el barrido alcanza la sesion vencida con pago rechazado');
select is(pg_temp.stock('a'), 8, 'B: el barrido devuelve el stock');
select is((pg_temp.sesion('b1')).status, 'expired', 'B: la sesion queda expired');
select is(pg_temp.reservas('b1', 'released'), 1, 'B: la reserva queda liberada');
select is(public.expire_checkout_sessions(100) >= 0 and pg_temp.stock('a') = 8, true, 'B: un segundo barrido no devuelve el stock otra vez');
-- Un aprobado que llega con la sesion vencida y sin reserva sigue yendo a revision.
select pg_temp.registrar('b1.aprobado', 'b1', pg_temp.snap('b1', 'PAY-B1-Y', 'approved', 'b1-y-approved'));
select is(pg_temp.out('b1.aprobado') ->> 'manual_review_required', 'true',
  'B: aprobado despues del vencimiento sigue yendo a revision manual');
select is((pg_temp.sesion('b1')).manual_review_reason, 'approved_after_reservation_expired',
  'B: con el motivo que ahora si es cierto');

-- ══════════════════════════════════════════════════════════════════════════
--  C · lo que SÍ sigue liberando
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('c1', 'a', 1);
select pg_temp.registrar('c1.cancelado', 'c1', pg_temp.snap('c1', 'PAY-C1-X', 'cancelled', 'c1-x-cancelled'), 'cancellation');
select is(pg_temp.stock('a'), 8, 'C: nuestra propia cancelacion devuelve el stock');
select is((pg_temp.sesion('c1')).status, 'cancelled', 'C: y cancela la sesion');

select pg_temp.checkout('c2', 'a', 1);
select pg_temp.registrar('c2.vencido', 'c2', pg_temp.snap('c2', 'PAY-C2-X', 'expired', 'c2-x-expired'));
select is(pg_temp.stock('a'), 8, 'C: el expired del proveedor devuelve el stock');
select is((pg_temp.sesion('c2')).status, 'expired', 'C: y deja la sesion expired');

select pg_temp.checkout('c3', 'a', 1);
select pg_temp.registrar('c3.cancelado', 'c3', pg_temp.snap('c3', 'PAY-C3-X', 'cancelled', 'c3-x-cancelled'), 'webhook');
select is(pg_temp.stock('a') || ':' || (pg_temp.sesion('c3')).status, '7:redirected',
  'C: un cancelled que no es nuestro tampoco libera con la sesion vigente');
-- La pantalla de estado vuelve a leer el mismo pago: no escribe nada.
insert into mp_out values ('c3.antes', jsonb_build_object('intent_revision', (pg_temp.intent('c3')).revision, 'session_revision', (pg_temp.sesion('c3')).revision));
select pg_temp.registrar('c3.relectura', 'c3', pg_temp.snap('c3', 'PAY-C3-X', 'cancelled', 'c3-x-cancelled'), 'reconciliation');
select is(pg_temp.eventos('c3', 'payment.cancelled') || ':' || (pg_temp.intent('c3')).revision || ':' || (pg_temp.sesion('c3')).revision,
  '1:' || (pg_temp.out('c3.antes') ->> 'intent_revision') || ':' || (pg_temp.out('c3.antes') ->> 'session_revision'),
  'C: releer el mismo pago cancelado no agrega evento ni sube revisiones');
-- El mismo snapshot, ahora como parte de NUESTRA cancelacion, si libera.
select pg_temp.registrar('c3.cancelacion', 'c3', pg_temp.snap('c3', 'PAY-C3-X', 'cancelled', 'c3-x-cancelled'), 'cancellation');
select is(pg_temp.stock('a') || ':' || (pg_temp.sesion('c3')).status || ':' || pg_temp.eventos('c3', 'payment.cancelled'), '8:cancelled:1',
  'C: el mismo snapshot ya registrado, llegado por nuestra cancelacion, libera la reserva');

-- ══════════════════════════════════════════════════════════════════════════
--  D · últimas unidades
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('d1', 'd', 2);
select pg_temp.registrar('d1.rechazo', 'd1', pg_temp.snap('d1', 'PAY-D1-X', 'rejected', 'd1-x-rejected'));
select is(pg_temp.stock('d'), 0, 'D: tras el rechazo las 2 ultimas unidades siguen reservadas');
select throws_ok(
  $$select pg_temp.checkout('d2', 'd', 2)$$, '55000', null,
  'D: otro comprador no puede llevarse las unidades del que esta reintentando (55000, sin stock para pagar)');
select throws_like(
  $$select pg_temp.checkout('d3', 'd', 1)$$, 'producto no disponible para pago%',
  'D: y el rechazo es el del producto sin stock, no otro error del fixture');
select pg_temp.registrar('d1.aprobado', 'd1', pg_temp.snap('d1', 'PAY-D1-Y', 'approved', 'd1-y-approved'));
select pg_temp.finalizar('d1.fin', 'd1');
select is(pg_temp.out('d1.fin') ->> 'ok' || ':' || pg_temp.pedidos('d') || ':' || pg_temp.stock('d'), 'true:1:0',
  'D: el reintento aprobado termina en pedido con el stock en 0');

-- ══════════════════════════════════════════════════════════════════════════
--  E · reintento controlado desde la app
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('e1', 'f', 2);
select pg_temp.registrar('e1.rechazo', 'e1', pg_temp.snap('e1', 'PAY-E1-X', 'rejected', 'e1-x-rejected'));
-- La foto del pago rechazado se toma ANTES del reintento: lleva la preferencia 1.
insert into mp_out values ('e1.foto_rechazo', pg_temp.snap('e1', 'PAY-E1-X', 'rejected', 'e1-x-rejected'));
create function pg_temp.reintentar(p_name text) returns void language plpgsql as $$
declare v_prepare jsonb;
begin
  v_prepare := public.prepare_mercadopago_preference_v2(pg_temp.id(p_name), pg_temp.id(p_name || ':customer'), true);
  perform pg_temp.preferencia(pg_temp.id(p_name), pg_temp.id(p_name || ':customer'), (v_prepare ->> 'payment_attempt_id')::uuid, p_name || '-2');
  insert into mp_out values (p_name || '.intento', v_prepare);
end $$;
select pg_temp.reintentar('e1');
select is(pg_temp.out('e1.intento') ->> 'attempt_number', '2', 'E: el rechazo sin liberar admite el reintento controlado');
select is((pg_temp.intent('e1')).preference_id || '/' || (pg_temp.intent('e1')).internal_status, 'PREF-e1-2/preference_created',
  'E: el intent apunta a la preferencia nueva');
select is(pg_temp.reservas('e1', 'active') || ':' || pg_temp.stock('f'), '1:48', 'E: el reintento usa la misma reserva, sin descontar de nuevo');

-- La sonda (o la pantalla de estado) vuelve a leer el unico pago que existe: el rechazado.
select pg_temp.registrar('e1.relectura', 'e1', pg_temp.out('e1.foto_rechazo'), 'reconciliation');
select is(pg_temp.out('e1.relectura') ->> 'ok', 'true',
  'E: el pago rechazado de la preferencia anterior no es preference_mismatch');
select is((pg_temp.sesion('e1')).status || '/' || (pg_temp.intent('e1')).internal_status, 'redirected/preference_created',
  'E: el intento nuevo sigue vivo despues de releer el rechazo viejo');
select is(pg_temp.eventos('e1', 'payment.rejected'), 1, 'E: releer el mismo rechazo no agrega eventos');

select pg_temp.registrar('e1.aprobado', 'e1', pg_temp.snap('e1', 'PAY-E1-Y', 'approved', 'e1-y-approved'));
select pg_temp.finalizar('e1.fin', 'e1');
select is(pg_temp.out('e1.aprobado') ->> 'finalize_required' || ':' || (pg_temp.out('e1.fin') ->> 'ok') || ':' || pg_temp.stock('f'),
  'true:true:48', 'E: rechazado -> intento nuevo -> aprobado termina en pedido, stock descontado una vez');

-- Un pago aprobado sobre la preferencia ANTERIOR del mismo intent tambien es nuestro.
select pg_temp.checkout('e2', 'f', 1);
insert into mp_out values ('e2.foto_aprobado_pref1', pg_temp.snap('e2', 'PAY-E2-OLD', 'approved', 'e2-old-approved'));
select pg_temp.registrar('e2.rechazo', 'e2', pg_temp.snap('e2', 'PAY-E2-X', 'rejected', 'e2-x-rejected'));
select pg_temp.reintentar('e2');
select pg_temp.registrar('e2.aprobado_pref1', 'e2', pg_temp.out('e2.foto_aprobado_pref1'));
select is(pg_temp.out('e2.aprobado_pref1') ->> 'finalize_required', 'true',
  'E: un aprobado sobre la preferencia anterior del mismo intent se finaliza');

-- Una preferencia que NO es de este intent sigue siendo una discrepancia.
select pg_temp.checkout('e3', 'f', 1);
select pg_temp.registrar('e3.ajena', 'e3',
  pg_temp.snap('e3', 'PAY-E3-X', 'approved', 'e3-x-approved', null, jsonb_build_object('preference_id', 'PREF-e1-2')));
select is(pg_temp.out('e3.ajena') ->> 'reason', 'preference_mismatch',
  'E: la preferencia de OTRO intent sigue siendo preference_mismatch');
select is((pg_temp.sesion('e3')).status || '/' || (pg_temp.intent('e3')).internal_status,
  'manual_review_required/security_review_required', 'E: y sigue fallando cerrado sobre un checkout sin pedido');
select pg_temp.registrar('e3.vacia', 'e3',
  pg_temp.snap('e3', 'PAY-E3-X', 'approved', 'e3-x-approved-b', null, jsonb_build_object('preference_id', '')));
select is(pg_temp.out('e3.vacia') ->> 'reason', 'preference_mismatch', 'E: una preferencia vacia tambien');

-- ══════════════════════════════════════════════════════════════════════════
--  F · identidad del pago
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('f1', 'f', 2);
select pg_temp.registrar('f1.x', 'f1', pg_temp.snap('f1', 'PAY-F1-X', 'approved', 'f1-x-approved', timestamptz '2026-03-01 12:00:00+00'));
select pg_temp.finalizar('f1.fin', 'f1');
select is((pg_temp.intent('f1')).internal_status || '/' || (pg_temp.intent('f1')).provider_payment_id, 'completed/PAY-F1-X',
  'F: control, aprobado X y pedido creado');

-- aprobado X, despues rechazado Y mas nuevo: X queda.
select pg_temp.registrar('f1.y', 'f1', pg_temp.snap('f1', 'PAY-F1-Y', 'rejected', 'f1-y-rejected', timestamptz '2026-03-01 12:05:00+00'));
select is(pg_temp.out('f1.y') ->> 'ok' || ':' || (pg_temp.out('f1.y') ->> 'secondary_payment'), 'true:true',
  'F: el rechazado posterior se acepta como pago secundario');
select is((pg_temp.intent('f1')).provider_payment_id || '/' || (pg_temp.intent('f1')).provider_status || '/' || (pg_temp.intent('f1')).internal_status,
  'PAY-F1-X/approved/completed', 'F: aprobado X + rechazado Y: X sigue siendo la identidad (PAY-04b)');
select is(pg_temp.eventos('f1', 'payment.secondary_payment'), 1, 'F: el pago secundario deja su evento');
select is(
  (select pe.provider_event_id from public.payment_events pe
    where pe.payment_intent_id = pg_temp.id('f1:intent') and pe.event_type = 'payment.secondary_payment'),
  'PAY-F1-Y', 'F: el evento nombra el pago secundario');

-- aprobado X, despues aprobado Z: cobro duplicado, marcado y sin fusionar.
select pg_temp.registrar('f1.z', 'f1', pg_temp.snap('f1', 'PAY-F1-Z', 'approved', 'f1-z-approved', timestamptz '2026-03-01 12:10:00+00'));
select is(pg_temp.out('f1.z') ->> 'duplicate_approved', 'true', 'F: el segundo aprobado se informa como cobro duplicado');
select is(pg_temp.out('f1.z') ->> 'finalize_required', 'false', 'F: y no pide finalizar otra vez');
select is((pg_temp.intent('f1')).provider_payment_id || '/' || (pg_temp.intent('f1')).paid_amount::text || '/' || (pg_temp.intent('f1')).internal_status,
  'PAY-F1-X/2000.00/completed', 'F: aprobado X + aprobado Z: identidad e importe intactos (PAY-04a)');
select is(pg_temp.eventos('f1', 'payment.duplicate_approved'), 1, 'F: el cobro duplicado deja payment.duplicate_approved');
select is(
  (select pe.provider_event_id || '|' || (pe.details ->> 'refund_review_required') || '|' || (pe.details ->> 'pinned_provider_payment_id')
       || '|' || (pe.details ->> 'refunded_amount')
     from public.payment_events pe
    where pe.payment_intent_id = pg_temp.id('f1:intent') and pe.event_type = 'payment.duplicate_approved'),
  'PAY-F1-Z|true|PAY-F1-X|0.00', 'F: el evento marca el pago a revisar para devolucion y cual es el original');
select is(pg_temp.out('f1.z') ->> 'refund_review_required', 'true', 'F: y la respuesta tambien pide revisar la devolucion');
select is(pg_temp.pedidos('f') , 2, 'F: el duplicado no crea otro pedido (e1 + f1)');
select is((pg_temp.sesion('f1')).status, 'completed', 'F: la sesion sigue completed');
select pg_temp.registrar('f1.z2', 'f1', pg_temp.snap('f1', 'PAY-F1-Z', 'approved', 'f1-z-approved', timestamptz '2026-03-01 12:10:00+00'));
select is(pg_temp.eventos('f1', 'payment.duplicate_approved'), 1, 'F: repetir el mismo duplicado no agrega otro evento');

-- en proceso B (mas nuevo) llega primero, aprobado A (mas viejo) despues.
select pg_temp.checkout('f2', 'f', 1);
select pg_temp.registrar('f2.b', 'f2', pg_temp.snap('f2', 'PAY-F2-B', 'in_process', 'f2-b-in-process', timestamptz '2026-03-02 12:10:00+00'));
select pg_temp.registrar('f2.a', 'f2', pg_temp.snap('f2', 'PAY-F2-A', 'approved', 'f2-a-approved', timestamptz '2026-03-02 12:00:00+00'));
select is((pg_temp.intent('f2')).provider_payment_id || '/' || (pg_temp.intent('f2')).provider_status, 'PAY-F2-A/approved',
  'F: sin pago aprobado previo, el aprobado gana la identidad aunque sea mas viejo (PAY-04c)');
select pg_temp.finalizar('f2.fin', 'f2');
select is(pg_temp.out('f2.fin') ->> 'ok', 'true', 'F: y la finalizacion crea el pedido en lugar de responder 55000');

-- El MISMO pago sigue evolucionando: un reembolso total del pago del pedido.
select pg_temp.registrar('f2.reembolso', 'f2', pg_temp.snap('f2', 'PAY-F2-A', 'refunded', 'f2-a-refunded',
  timestamptz '2026-03-02 13:00:00+00', jsonb_build_object('refunded_amount', '1000.00')));
select is((pg_temp.intent('f2')).internal_status || '/' || (pg_temp.intent('f2')).provider_status || '/' || (pg_temp.intent('f2')).refunded_amount::text
    || '/' || (pg_temp.sesion('f2')).status,
  'refunded/refunded/1000.00/completed', 'F: el reembolso del pago del pedido se sigue registrando sobre el intent');
-- El duplicado de f1 fue devuelto desde Mercado Pago: queda en la traza, sin tocar el intent.
select pg_temp.registrar('f1.z_devuelto', 'f1', pg_temp.snap('f1', 'PAY-F1-Z', 'refunded', 'f1-z-refunded',
  timestamptz '2026-03-01 13:00:00+00', jsonb_build_object('refunded_amount', '2000.00')));
select is((pg_temp.intent('f1')).internal_status || '/' || (pg_temp.intent('f1')).refunded_amount::text || '/' || pg_temp.eventos('f1', 'payment.secondary_payment'),
  'completed/0.00/2', 'F: la devolucion del pago duplicado no marca como reembolsado el pago del pedido');

-- Una fila anterior a la migracion: el pedido se cobro con X y un rechazado
-- posterior le piso la identidad. No queda fijada al rechazado: el proximo
-- snapshot del pago real la recupera.
select pg_temp.checkout('f3', 'f', 1);
select pg_temp.registrar('f3.x', 'f3', pg_temp.snap('f3', 'PAY-F3-X', 'approved', 'f3-x-approved', timestamptz '2026-03-04 12:00:00+00'));
select pg_temp.finalizar('f3.fin', 'f3');
update public.payment_intents
   set provider_payment_id = 'PAY-F3-VIEJO-RECHAZADO', provider_status = 'rejected', provider_event_at = timestamptz '2026-03-04 12:05:00+00'
 where id = pg_temp.id('f3:intent');
select pg_temp.registrar('f3.x_devuelto', 'f3', pg_temp.snap('f3', 'PAY-F3-X', 'refunded', 'f3-x-refunded',
  timestamptz '2026-03-04 13:00:00+00', jsonb_build_object('refunded_amount', '1000.00')));
select is((pg_temp.intent('f3')).provider_payment_id || '/' || (pg_temp.intent('f3')).provider_status || '/' || (pg_temp.intent('f3')).internal_status,
  'PAY-F3-X/refunded/refunded', 'F: una identidad pisada antes de la migracion se recupera con el snapshot del pago real');

-- Un duplicado que llega ya devuelto entero: queda en la traza, no pide otra devolucion.
select pg_temp.checkout('f4', 'f', 1);
select pg_temp.registrar('f4.x', 'f4', pg_temp.snap('f4', 'PAY-F4-X', 'approved', 'f4-x-approved', timestamptz '2026-03-05 12:00:00+00'));
select pg_temp.finalizar('f4.fin', 'f4');
select pg_temp.registrar('f4.z', 'f4', pg_temp.snap('f4', 'PAY-F4-Z', 'approved', 'f4-z-approved-refunded',
  timestamptz '2026-03-05 12:10:00+00', jsonb_build_object('refunded_amount', '1000.00')));
select is(
  (select pe.details ->> 'refund_review_required' || '|' || (pe.details ->> 'refunded_amount')
     from public.payment_events pe
    where pe.payment_intent_id = pg_temp.id('f4:intent') and pe.event_type = 'payment.duplicate_approved'),
  'false|1000.00', 'F: un duplicado que llega devuelto entero no pide revisar devolucion');
select is((pg_temp.intent('f4')).provider_payment_id || '/' || (pg_temp.intent('f4')).internal_status || '/' || (pg_temp.intent('f4')).refunded_amount::text,
  'PAY-F4-X/completed/0.00', 'F: y tampoco toca el pago del pedido');

-- rechazado X, despues Y en proceso, despues Y aprobado. El estado interno no
-- puede bajar de `rejected` a `in_process` (rango monotono del intent), pero los
-- datos del proveedor pasan a ser los de Y y el aprobado termina en pedido.
select pg_temp.checkout('f5', 'f', 1);
select pg_temp.registrar('f5.x', 'f5', pg_temp.snap('f5', 'PAY-F5-X', 'rejected', 'f5-x-rejected', timestamptz '2026-03-06 12:00:00+00'));
select pg_temp.registrar('f5.y1', 'f5', pg_temp.snap('f5', 'PAY-F5-Y', 'in_process', 'f5-y-in-process', timestamptz '2026-03-06 12:01:00+00'));
select is((pg_temp.intent('f5')).provider_payment_id || '/' || (pg_temp.intent('f5')).provider_status || '/' || (pg_temp.sesion('f5')).status,
  'PAY-F5-Y/in_process/payment_pending', 'F: rechazado X + en proceso Y: el intent sigue a Y y la sesion queda payment_pending');
select pg_temp.registrar('f5.y2', 'f5', pg_temp.snap('f5', 'PAY-F5-Y', 'approved', 'f5-y-approved', timestamptz '2026-03-06 12:02:00+00'));
select pg_temp.finalizar('f5.fin', 'f5');
select is(pg_temp.out('f5.y2') ->> 'finalize_required' || ':' || (pg_temp.out('f5.fin') ->> 'ok') || ':' || (pg_temp.intent('f5')).internal_status,
  'true:true:completed', 'F: y cuando Y se aprueba termina en pedido');

-- ══════════════════════════════════════════════════════════════════════════
--  G · `completed` es terminal
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('g1', 'g', 2);
select pg_temp.registrar('g1.x', 'g1', pg_temp.snap('g1', 'PAY-G1-X', 'approved', 'g1-x-approved'));
select pg_temp.finalizar('g1.fin', 'g1');
insert into mp_ids select 'g1:order', (pg_temp.sesion('g1')).completed_order_id;

select pg_temp.registrar('g1.mediacion', 'g1', pg_temp.snap('g1', 'PAY-G1-X', 'in_mediation', 'g1-x-mediation'));
select is(pg_temp.out('g1.mediacion') ->> 'ok' || ':' || (pg_temp.out('g1.mediacion') ->> 'reason') || ':' || (pg_temp.out('g1.mediacion') ->> 'post_completion'),
  'false:unknown_provider_status:true', 'G: un estado desconocido sobre un pedido creado se informa como anomalia posterior');
select is((pg_temp.sesion('g1')).status, 'completed', 'G: la sesion completada NO pasa a manual_review_required (CS-05)');
select is((pg_temp.intent('g1')).internal_status, 'completed', 'G: el intent completado NO pasa a security_review_required (PAY-05)');
select is((pg_temp.intent('g1')).security_review_reason, null, 'G: sin motivo de revision escrito en el intent');
select is(pg_temp.out('g1.mediacion') ->> 'manual_review_required', 'false', 'G: la respuesta no declara revision manual del checkout');
select is(pg_temp.eventos('g1', 'payment.post_completion_anomaly'), 1, 'G: queda payment.post_completion_anomaly como senal operativa');
select is(
  (select pe.details ->> 'reason' from public.payment_events pe
    where pe.payment_intent_id = pg_temp.id('g1:intent') and pe.event_type = 'payment.post_completion_anomaly'),
  'unknown_provider_status', 'G: el evento lleva el motivo');
select is(
  (select private.order_payment_state(o) from public.orders o where o.id = pg_temp.id('g1:order')),
  'confirmed', 'G: el pago del pedido sigue confirmado');

select pg_temp.registrar('g1.sin_preferencia', 'g1',
  pg_temp.snap('g1', 'PAY-G1-X', 'approved', 'g1-x-nopref', null, jsonb_build_object('preference_id', '')));
select is(pg_temp.out('g1.sin_preferencia') ->> 'reason' || ':' || (pg_temp.sesion('g1')).status || ':' || (pg_temp.intent('g1')).internal_status,
  'preference_mismatch:completed:completed', 'G: una preferencia vacia posterior tampoco reabre el pedido');

update public.business_payment_settings set collector_id = 'collector-otra-cuenta' where business_id = pg_temp.id('g:business');
select pg_temp.registrar('g1.otro_collector', 'g1',
  pg_temp.snap('g1', 'PAY-G1-X', 'approved', 'g1-x-collector', null, jsonb_build_object('collector_id', 'collector-g')));
select is(pg_temp.out('g1.otro_collector') ->> 'reason' || ':' || (pg_temp.sesion('g1')).status || ':' || (pg_temp.intent('g1')).internal_status,
  'collector_mismatch:completed:completed', 'G: reconectar otra cuenta no reabre un pedido ya cobrado');
update public.business_payment_settings set collector_id = 'collector-g' where business_id = pg_temp.id('g:business');
select is(pg_temp.eventos('g1', 'payment.post_completion_anomaly'), 3, 'G: cada anomalia distinta deja su evento');
select pg_temp.registrar('g1.mediacion_2', 'g1', pg_temp.snap('g1', 'PAY-G1-X', 'in_mediation', 'g1-x-mediation'));
select is(pg_temp.eventos('g1', 'payment.post_completion_anomaly'), 3, 'G: la misma anomalia repetida no se duplica');

-- Sobre un checkout SIN pedido el snapshot invalido sigue fallando cerrado.
select pg_temp.checkout('g2', 'g', 1);
select pg_temp.registrar('g2.mediacion', 'g2', pg_temp.snap('g2', 'PAY-G2-X', 'in_mediation', 'g2-x-mediation'));
select is((pg_temp.sesion('g2')).status || '/' || (pg_temp.intent('g2')).internal_status,
  'manual_review_required/security_review_required', 'G: sin pedido, el snapshot invalido sigue yendo a revision');

-- El trigger de transicion, sobre una sesion completada sin ninguna anomalia.
-- Si el UPDATE se aceptara, el bloque levanta UPDATE_ACCEPTED: la asercion falla
-- nombrando lo que paso y el cambio se deshace, asi la siguiente parte de la
-- misma sesion completada.
select pg_temp.checkout('g3', 'g', 1);
select pg_temp.registrar('g3.x', 'g3', pg_temp.snap('g3', 'PAY-G3-X', 'approved', 'g3-x-approved'));
select pg_temp.finalizar('g3.fin', 'g3');
select is((pg_temp.sesion('g3')).status, 'completed', 'G: control, sesion completada');
select throws_ok(
  format($sql$do $do$ begin
    update public.checkout_sessions set status = 'manual_review_required' where id = %L;
    raise exception 'UPDATE_ACCEPTED';
  end $do$$sql$, pg_temp.id('g3')),
  'PT409', null, 'G: nadie saca una sesion de completed (trigger)');
select throws_ok(
  format($sql$do $do$ begin
    update public.checkout_sessions set status = 'ready_for_payment' where id = %L;
    raise exception 'UPDATE_ACCEPTED';
  end $do$$sql$, pg_temp.id('g3')),
  'PT409', null, 'G: tampoco hacia un estado pagable');
select throws_ok(
  format($sql$do $do$ begin
    update public.checkout_sessions set completed_order_id = null where id = %L;
    raise exception 'UPDATE_ACCEPTED';
  end $do$$sql$, pg_temp.id('g3')),
  'PT409', null, 'G: el pedido de una sesion completada no se desvincula');
select lives_ok(
  format($$update public.checkout_sessions set manual_review_reason = null, status = 'completed' where id = %L$$, pg_temp.id('g3')),
  'G: una escritura que deja completed en completed pasa');
select is((pg_temp.sesion('g3')).status || ':' || ((pg_temp.sesion('g3')).completed_order_id is not null)::text, 'completed:true',
  'G: la sesion sigue completed y con su pedido');
select lives_ok(
  format($$update public.checkout_sessions set status = 'payment_approved', manual_review_reason = null where id = %L$$, pg_temp.id('g2')),
  'G: manual_review_required -> payment_approved (recuperacion) sigue permitido');
select is(
  (select count(*)::integer from pg_trigger t
    where t.tgrelid = 'public.checkout_sessions'::regclass and t.tgname = 'checkout_sessions_guard_completed_terminal' and not t.tgisinternal),
  1, 'G: el trigger esta atado a checkout_sessions');

-- ══════════════════════════════════════════════════════════════════════════
--  H · reintentar un trabajo de webhook es idempotente
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('h1', 'g', 1);
insert into public.payment_webhook_receipts (id, environment, webhook_event_id, event_type, resource_id, signature_valid, payload_hash, processing_status)
values ('a8000000-0000-4000-8000-000000000001', 'test', 'evt-wp3a-h1', 'payment', 'PAY-H1-X', true, repeat('9', 64), 'processing');

select pg_temp.registrar('h1.intento_1', 'h1', pg_temp.snap('h1', 'PAY-H1-X', 'approved', 'h1-x-approved'), 'webhook', 'a8000000-0000-4000-8000-000000000001');
select pg_temp.registrar('h1.intento_2', 'h1', pg_temp.snap('h1', 'PAY-H1-X', 'approved', 'h1-x-approved'), 'webhook', 'a8000000-0000-4000-8000-000000000001');
select is(pg_temp.out('h1.intento_2') ->> 'error', null,
  'H: el segundo snapshot con el mismo recibo no viola payment_events (PAY-03)');
select is(pg_temp.out('h1.intento_2') ->> 'finalize_required', 'true', 'H: el reintento vuelve a pedir la finalizacion pendiente');
select pg_temp.registrar('h1.intento_3', 'h1', pg_temp.snap('h1', 'PAY-H1-X', 'approved', 'h1-x-approved-otra-respuesta'), 'webhook', 'a8000000-0000-4000-8000-000000000001');
select is(pg_temp.out('h1.intento_3') ->> 'error', null,
  'H: tampoco cuando el proveedor devuelve otra respuesta para el mismo pago y estado');
select is(
  (select count(*)::integer from public.payment_events pe
    where pe.payment_intent_id = pg_temp.id('h1:intent')
      and pe.webhook_receipt_id = 'a8000000-0000-4000-8000-000000000001' and pe.event_type = 'payment.approved'),
  1, 'H: un solo evento payment.approved para ese recibo');
-- La otra respuesta no se pierde contra la clave unica: queda escrita sin recibo,
-- y por eso la proxima vez se reconoce como ya registrada.
select is(pg_temp.eventos('h1', 'payment.approved'), 2, 'H: la segunda respuesta del mismo recibo queda registrada, sin recibo');
insert into mp_out values ('h1.antes', jsonb_build_object('intent_revision', (pg_temp.intent('h1')).revision));
select pg_temp.registrar('h1.intento_3b', 'h1', pg_temp.snap('h1', 'PAY-H1-X', 'approved', 'h1-x-approved-otra-respuesta'), 'webhook', 'a8000000-0000-4000-8000-000000000001');
select is(pg_temp.eventos('h1', 'payment.approved') || ':' || (pg_temp.intent('h1')).revision,
  '2:' || (pg_temp.out('h1.antes') ->> 'intent_revision'), 'H: y repetirla no escribe ni sube la revision del intent');
select pg_temp.finalizar('h1.fin', 'h1');
select pg_temp.registrar('h1.intento_4', 'h1', pg_temp.snap('h1', 'PAY-H1-X', 'approved', 'h1-x-approved'), 'webhook', 'a8000000-0000-4000-8000-000000000001');
select is(pg_temp.out('h1.fin') ->> 'ok' || ':' || (pg_temp.out('h1.intento_4') ->> 'ok') || ':' || (pg_temp.out('h1.intento_4') ->> 'finalize_required'),
  'true:true:false', 'H: repetido despues del pedido responde ok sin pedir finalizar');

-- El mismo recibo reintentado cuando el pago secundario ya cambio de estado.
insert into public.payment_webhook_receipts (id, environment, webhook_event_id, event_type, resource_id, signature_valid, payload_hash, processing_status)
values ('a8000000-0000-4000-8000-000000000003', 'test', 'evt-wp3a-h3', 'payment', 'PAY-H1-Y', true, repeat('7', 64), 'processing');
select pg_temp.registrar('h1.y_rechazado', 'h1', pg_temp.snap('h1', 'PAY-H1-Y', 'rejected', 'h1-y-rejected'), 'webhook', 'a8000000-0000-4000-8000-000000000003');
select pg_temp.registrar('h1.y_cancelado', 'h1', pg_temp.snap('h1', 'PAY-H1-Y', 'cancelled', 'h1-y-cancelled'), 'webhook', 'a8000000-0000-4000-8000-000000000003');
select is(pg_temp.out('h1.y_cancelado') ->> 'error', null, 'H: el reintento con el pago secundario en otro estado no falla');
select is(
  (select count(*)::text || ':' || count(pe.webhook_receipt_id)::text from public.payment_events pe
    where pe.payment_intent_id = pg_temp.id('h1:intent') and pe.event_type = 'payment.secondary_payment'),
  '2:1', 'H: los dos estados del pago secundario quedan en la traza, el recibo atado al primero');

-- Un snapshot invalido con recibo tambien se puede reintentar.
select pg_temp.checkout('h2', 'g', 1);
insert into public.payment_webhook_receipts (id, environment, webhook_event_id, event_type, resource_id, signature_valid, payload_hash, processing_status)
values ('a8000000-0000-4000-8000-000000000002', 'test', 'evt-wp3a-h2', 'payment', 'PAY-H2-X', true, repeat('8', 64), 'processing');
select pg_temp.registrar('h2.intento_1', 'h2', pg_temp.snap('h2', 'PAY-H2-X', 'in_mediation', 'h2-x-mediation'), 'webhook', 'a8000000-0000-4000-8000-000000000002');
select pg_temp.registrar('h2.intento_2', 'h2', pg_temp.snap('h2', 'PAY-H2-X', 'in_mediation', 'h2-x-mediation'), 'webhook', 'a8000000-0000-4000-8000-000000000002');
select is(pg_temp.out('h2.intento_2') ->> 'error', null,
  'H: el snapshot invalido con el mismo recibo tampoco viola la clave');

-- ══════════════════════════════════════════════════════════════════════════
--  I · un snapshot idéntico no escribe
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('i1', 'g', 1);
select pg_temp.registrar('i1.p1', 'i1', pg_temp.snap('i1', 'PAY-I1-X', 'pending', 'i1-x-pending', timestamptz '2026-03-03 12:00:00+00'), 'reconciliation');
insert into mp_out values ('i1.antes', jsonb_build_object(
  'intent_revision', (pg_temp.intent('i1')).revision, 'session_revision', (pg_temp.sesion('i1')).revision,
  'intent_updated_at', (pg_temp.intent('i1')).updated_at, 'session_updated_at', (pg_temp.sesion('i1')).updated_at));
select pg_temp.registrar('i1.p2', 'i1', pg_temp.snap('i1', 'PAY-I1-X', 'pending', 'i1-x-pending', timestamptz '2026-03-03 12:00:00+00'), 'reconciliation');
select pg_temp.registrar('i1.p3', 'i1', pg_temp.snap('i1', 'PAY-I1-X', 'pending', 'i1-x-pending', timestamptz '2026-03-03 12:00:00+00'), 'reconciliation');
select is(pg_temp.out('i1.p3') ->> 'ok' || ':' || (pg_temp.out('i1.p3') ->> 'internal_status'), 'true:pending', 'I: el snapshot repetido responde lo mismo');
select is(pg_temp.eventos('i1', 'payment.pending'), 1, 'I: tres consultas identicas dejan UN evento (PAY-11)');
select is((pg_temp.intent('i1')).revision, (pg_temp.out('i1.antes') ->> 'intent_revision')::bigint, 'I: la revision del intent no sube');
select is((pg_temp.sesion('i1')).revision, (pg_temp.out('i1.antes') ->> 'session_revision')::bigint, 'I: la revision de la sesion no sube');
select is((pg_temp.sesion('i1')).updated_at, (pg_temp.out('i1.antes') ->> 'session_updated_at')::timestamptz,
  'I: ni se mueve updated_at de la sesion (lo usa la alerta de checkouts trabados)');
select is((pg_temp.sesion('i1')).status, 'payment_pending', 'I: la sesion quedo payment_pending desde el primero');
-- Un cambio real si se registra.
select pg_temp.registrar('i1.p4', 'i1', pg_temp.snap('i1', 'PAY-I1-X', 'in_process', 'i1-x-in-process', timestamptz '2026-03-03 12:01:00+00'), 'reconciliation');
select is(pg_temp.eventos('i1', 'payment.in_process') || ':' || (pg_temp.intent('i1')).internal_status, '1:in_process',
  'I: un estado nuevo del mismo pago si se registra');
select pg_temp.registrar('i1.p5', 'i1', pg_temp.snap('i1', 'PAY-I1-X', 'pending', 'i1-x-pending-viejo', timestamptz '2026-03-03 11:59:00+00'), 'reconciliation');
select is((pg_temp.intent('i1')).provider_status || ':' || (pg_temp.intent('i1')).internal_status, 'in_process:in_process',
  'I: un snapshot mas viejo del mismo pago no hace retroceder el estado del proveedor');

-- ══════════════════════════════════════════════════════════════════════════
--  J · la confirmación de edad llega al pedido
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('j1', 'j', 2, true);
select is((pg_temp.sesion('j1')).contains_alcohol || ':' || (pg_temp.sesion('j1')).age_confirmation_policy, 'true:18',
  'J: la sesion con alcohol guarda la politica de edad');
select pg_temp.registrar('j1.x', 'j1', pg_temp.snap('j1', 'PAY-J1-X', 'approved', 'j1-x-approved'));
select pg_temp.finalizar('j1.fin', 'j1');
insert into mp_ids select 'j1:order', (pg_temp.sesion('j1')).completed_order_id;
select is(
  (select o.age_confirmation_policy from public.orders o where o.id = pg_temp.id('j1:order')),
  18, 'J: el pedido de Mercado Pago lleva age_confirmation_policy (CS-03)');
select is(
  (select o.age_confirmed_at from public.orders o where o.id = pg_temp.id('j1:order')),
  (pg_temp.sesion('j1')).age_confirmed_at, 'J: y el mismo age_confirmed_at que la sesion (PRICE-07)');
select ok(public.rider_order_rpc_payload(pg_temp.id('j1:order')) ? 'age_confirmation_policy',
  'J: el payload del rider trae la politica de edad');
select is(
  (select (o.age_confirmed_at is null and o.age_confirmation_policy is null) from public.orders o where o.id = pg_temp.id('g1:order')),
  true, 'J: un pedido sin alcohol sigue con las dos columnas en NULL');
select is(pg_temp.out('j1.fin') ->> 'ok', 'true', 'J: la finalizacion con alcohol crea el pedido');

-- ══════════════════════════════════════════════════════════════════════════
--  K · la guarda de pago no deja pasar un NULL
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('k1', 'g', 1);
select pg_temp.registrar('k1.x', 'k1', pg_temp.snap('k1', 'PAY-K1-X', 'approved', 'k1-x-approved'));
update public.payment_intents set paid_amount = null where id = pg_temp.id('k1:intent');
select throws_ok(
  $$select public.finalize_paid_checkout_session(pg_temp.id('k1'))$$,
  '55000', 'pago no aprobado verificadamente', 'K: con paid_amount NULL la finalizacion frena (CS-09 / PRICE-06)');
update public.payment_intents set paid_amount = expected_amount, provider_status = null where id = pg_temp.id('k1:intent');
select throws_ok(
  $$select public.finalize_paid_checkout_session(pg_temp.id('k1'))$$,
  '55000', 'pago no aprobado verificadamente', 'K: con provider_status NULL tambien');
update public.payment_intents set provider_status = 'approved' where id = pg_temp.id('k1:intent');
select pg_temp.finalizar('k1.fin', 'k1');
select is(pg_temp.out('k1.fin') ->> 'ok', 'true', 'K: con el pago completo la finalizacion sigue funcionando');

-- ══════════════════════════════════════════════════════════════════════════
--  L · el pedido que entra con el comercio cerrado o en pausa
-- ══════════════════════════════════════════════════════════════════════════
create function pg_temp.marcas(p_name text) returns integer language sql stable as $$
  select count(*)::integer from public.order_events e
   where e.order_id = (select s.completed_order_id from public.checkout_sessions s where s.id = pg_temp.id(p_name))
     and e.event_type = 'order.created_after_closing'
$$;
create function pg_temp.marca(p_name text) returns jsonb language sql stable as $$
  select e.metadata from public.order_events e
   where e.order_id = (select s.completed_order_id from public.checkout_sessions s where s.id = pg_temp.id(p_name))
     and e.event_type = 'order.created_after_closing'
$$;

-- Abierto: sin marca.
select pg_temp.checkout('l1', 'l', 1);
select pg_temp.registrar('l1.x', 'l1', pg_temp.snap('l1', 'PAY-L1-X', 'approved', 'l1-x-approved'));
select pg_temp.finalizar('l1.fin', 'l1');
select is(pg_temp.out('l1.fin') ->> 'ok' || ':' || pg_temp.marcas('l1'), 'true:0', 'L: con el comercio abierto el pedido no lleva marca');

-- En pausa despues de crear la sesion.
select pg_temp.checkout('l2', 'l', 1);
select pg_temp.registrar('l2.x', 'l2', pg_temp.snap('l2', 'PAY-L2-X', 'approved', 'l2-x-approved'));
update public.businesses set status = 'paused' where id = pg_temp.id('l:business');
select pg_temp.finalizar('l2.fin', 'l2');
select is(pg_temp.out('l2.fin') ->> 'ok', 'true', 'L: el pedido pagado se crea igual con el comercio en pausa (F-02)');
select is(pg_temp.marcas('l2'), 1, 'L: y lleva UNA marca order.created_after_closing');
select is(pg_temp.marca('l2') -> 'closed_reasons', '["business_paused"]'::jsonb, 'L: con el motivo business_paused');
select is(pg_temp.marca('l2') ->> 'channel' || ':' || (pg_temp.marca('l2') ->> 'business_status'), 'pickup:paused', 'L: el canal y el estado del comercio');
select is(
  (select o.status from public.orders o where o.id = (pg_temp.sesion('l2')).completed_order_id),
  'received', 'L: el pedido queda received: no se bloquea ni se cancela');
select is(
  (select e.actor_role || ':' || (e.actor_user_id is null)::text from public.order_events e
    where e.order_id = (pg_temp.sesion('l2')).completed_order_id and e.event_type = 'order.created_after_closing'),
  'system:true', 'L: la marca es del sistema, sin usuario');
select is(
  (select count(*)::integer from jsonb_object_keys(pg_temp.marca('l2')) k
    where k in ('name', 'phone', 'customer_name', 'customer_phone', 'address', 'email', 'contact')),
  0, 'L: la marca no lleva datos del cliente');
select is(
  (select count(*)::integer from public.order_events e
    where e.order_id = (pg_temp.sesion('l2')).completed_order_id and e.event_type = 'order.received'),
  1, 'L: order.received sigue estando, una vez');
update public.businesses set status = 'open' where id = pg_temp.id('l:business');

-- Fuera del horario del canal: horario exigido y ninguna franja cargada.
select pg_temp.checkout('l3', 'l', 1);
select pg_temp.registrar('l3.x', 'l3', pg_temp.snap('l3', 'PAY-L3-X', 'approved', 'l3-x-approved'));
update public.businesses set hours_enforced = true, operating_timezone = 'America/Argentina/Buenos_Aires' where id = pg_temp.id('l:business');
select pg_temp.finalizar('l3.fin', 'l3');
select is(pg_temp.out('l3.fin') ->> 'ok' || ':' || (pg_temp.marca('l3') -> 'closed_reasons')::text, 'true:["channel_closed"]',
  'L: fuera del horario del canal el pedido se crea y queda marcado channel_closed');
update public.businesses set hours_enforced = false where id = pg_temp.id('l:business');

-- Alcohol fuera de ventana despues de crear la sesion.
select pg_temp.checkout('l4', 'la', 1, true);
select pg_temp.registrar('l4.x', 'l4', pg_temp.snap('l4', 'PAY-L4-X', 'approved', 'l4-x-approved'));
update public.businesses set alcohol_sales_enabled = false where id = pg_temp.id('la:business');
select pg_temp.finalizar('l4.fin', 'l4');
select is(pg_temp.out('l4.fin') ->> 'ok' || ':' || (pg_temp.marca('l4') -> 'closed_reasons')::text, 'true:["alcohol_window_closed"]',
  'L: con la venta de alcohol cerrada el pedido se crea y queda marcado alcohol_window_closed');
select is(
  (select o.age_confirmation_policy from public.orders o where o.id = (pg_temp.sesion('l4')).completed_order_id),
  18, 'L: y conserva la confirmacion de edad');

-- Pedidos apagados y canal deshabilitado despues de crear la sesion: las otras
-- compuertas de `create_checkout_session`.
select pg_temp.checkout('l5', 'l', 1);
select pg_temp.registrar('l5.x', 'l5', pg_temp.snap('l5', 'PAY-L5-X', 'approved', 'l5-x-approved'));
-- Para apagar el retiro tiene que quedar el delivery, y un comercio verificado no lo
-- enciende sin cobertura (20261001216000): se le carga una zona y se exige la cobertura.
insert into public.delivery_zones(business_id,name,is_active,match_kind,area_normalized,boundary,delivery_fee,minimum_subtotal,priority)
values (pg_temp.id('l:business'),'Centro',true,'declared_area','centro',null,800,0,10);
update public.businesses set ordering_enabled = false, delivery_enabled = true, pickup_enabled = false, delivery_zone_enforced = true
 where id = pg_temp.id('l:business');
select pg_temp.finalizar('l5.fin', 'l5');
select is(pg_temp.out('l5.fin') ->> 'ok', 'true', 'L: con los pedidos apagados y el canal deshabilitado el pedido pagado se crea igual');
select is(pg_temp.marca('l5') -> 'closed_reasons', '["ordering_disabled", "channel_disabled"]'::jsonb,
  'L: y queda marcado ordering_disabled + channel_disabled');
select ok(nullif(pg_temp.marca('l5') ->> 'payment_approved_at', '') is not null,
  'L: la marca lleva el momento del cobro, para distinguir «pago antes del cierre»');
update public.businesses set ordering_enabled = true, delivery_enabled = false, pickup_enabled = true where id = pg_temp.id('l:business');

-- ══════════════════════════════════════════════════════════════════════════
--  M · la sonda no se clava en un pago rechazado
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.checkout('m1', 'g', 1);
select pg_temp.registrar('m1.rechazo', 'm1', pg_temp.snap('m1', 'PAY-M1-X', 'rejected', 'm1-x-rejected'));
select pg_temp.checkout('m2', 'g', 1);
select pg_temp.registrar('m2.pendiente', 'm2', pg_temp.snap('m2', 'PAY-M2-X', 'pending', 'm2-x-pending'));
update public.checkout_sessions set created_at = clock_timestamp() - interval '3 minutes'
 where id in (pg_temp.id('m1'), pg_temp.id('m2'));
select ok(public.enqueue_checkout_provider_probes(200) >= 2, 'M: la sonda encola los dos checkouts');
select is(
  (select count(*)::integer from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('m1:intent') and po.topic = 'payment_reconcile' and po.resource_id is null),
  1, 'M: con el pago guardado rechazado encola SIN resource_id (la mitad SQL de la busqueda por referencia)');
-- La otra mitad es del worker: con el trabajo sin `resource_id` hoy lee
-- `provider_payment_id`. Lo que tiene que mirar para NO releer el rechazado es
-- `provider_status`, que queda guardado junto al id.
select is((pg_temp.intent('m1')).provider_payment_id || '/' || (pg_temp.intent('m1')).provider_status, 'PAY-M1-X/rejected',
  'M: el intent conserva el id rechazado con su estado: el worker decide con ese estado');
select is(
  (select po.resource_id from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('m2:intent') and po.topic = 'payment_reconcile'),
  'PAY-M2-X', 'M: con el pago guardado pendiente sigue fijando su id');

-- ══════════════════════════════════════════════════════════════════════════
--  N · permisos, volatilidad y orden de locks
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'public.checkout_pipeline_state(text,timestamptz)'::regprocedure),
  's', 'N: checkout_pipeline_state es STABLE (llama a clock_timestamp)');
select is(public.checkout_pipeline_state('redirected', clock_timestamp() - interval '1 minute') || '/'
  || public.checkout_pipeline_state('redirected', clock_timestamp() + interval '1 hour') || '/'
  || public.checkout_pipeline_state('completed', null),
  'expired/pending/received', 'N: y responde lo mismo que antes');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in ('public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)'::regprocedure,
                    'public.finalize_paid_checkout_session(uuid)'::regprocedure,
                    'public.enqueue_checkout_provider_probes(integer)'::regprocedure,
                    to_regprocedure('public.guard_checkout_session_completed_terminal()'))
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0, 'N: ninguna de las cuatro funciones es ejecutable por anon, authenticated ni PUBLIC');
select isnt(to_regprocedure('public.guard_checkout_session_completed_terminal()'), null,
  'N: la funcion del trigger de transicion existe');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in ('public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)'::regprocedure,
                    'public.finalize_paid_checkout_session(uuid)'::regprocedure,
                    'public.enqueue_checkout_provider_probes(integer)'::regprocedure)
      and p.prosecdef and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')),
  3, 'N: las tres RPC siguen SECURITY DEFINER, con search_path fijado y EXECUTE para service_role');
select ok(
  (select position('from public.checkout_sessions s where s.id = v_session_id for update' in p.prosrc) > 0
      and position('from public.checkout_sessions s where s.id = v_session_id for update' in p.prosrc)
        < position('from public.payment_intents pi where pi.id = p_payment_intent_id for update' in p.prosrc)
     from pg_proc p where p.oid = 'public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)'::regprocedure),
  'N: el snapshot toma el lock de la sesion antes que el del intent (CS-10 / PAY-10)');

select * from finish();
rollback;
