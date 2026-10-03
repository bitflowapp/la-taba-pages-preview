-- TABA · EL RECIBO DE UN AVISO DE MERCADO PAGO Y LA COLA DE PAGOS, EJECUTADOS
--
-- Lo que hasta acá estaba «leído en el código» o «leído en la definición viva» y
-- ahora tiene aserción:
--
--   1  contrato y privilegios del recibo, de la cola y de la reanimación
--   2  el recibo: primera entrega, reentrega idéntica, el mismo aviso 20 veces
--   3  el recibo sin firma, su promoción por una entrega válida, y que una entrega
--      inválida posterior no toca el recibo válido
--   4  temas (pago, contracargo, reclamo, otro) y entradas inválidas
--   5  la puerta del vendedor conectado (`mp_record_seller_webhook`)
--   6  una entrega firmada repetida con otro cuerpo deja un solo recibo y un solo
--      trabajo (20261002022000), sin perder una reentrega ni un aviso nuevo
--   7  el ciclo de la cola: reclamo (plazo, tope, dueño), otro worker no reclama un
--      trabajo con plazo vigente, el plazo vencido lo devuelve, empezar y terminar
--   8  reintentos con espera creciente hasta `dead_letter`, con el estado del
--      proveedor en el motivo, y el recibo siguiendo a su trabajo
--   9  reanimar un trabajo en `dead_letter` (20261002023000): quién puede, cuáles
--      temas, un intento más, rastro, repetición sin efecto
--  10  la consulta de estado antes que el aviso, y el aviso antes que la consulta:
--      un evento, un pedido, un descuento de stock
--  11  el estado `authorized` y los snapshots que no coinciden en la referencia, la
--      moneda o el modo
--  12  un pago desconocido: ningún cobro creado, nada cambiado, y el rastro que queda
--
-- La base del gate no está vacía: cada valor único lleva el nombre de este archivo,
-- ningún conteo mira una tabla entera, y los trabajos ajenos de la cola se apartan
-- (dentro de esta transacción) antes de cada reclamo.
-- No depende de la hora: los plazos y las esperas se miden contra el reloj de la
-- base y los vencimientos se llevan al pasado a mano.
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(210);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table caso (
  k text primary key, business_id uuid, product_id uuid,
  owner_id uuid, customer_id uuid, session_id uuid, intent_id uuid, payment_id text
) on commit drop;
create temporary table dato (k text primary key, v jsonb) on commit drop;

create function pg_temp.guardar(p_k text, p_v jsonb) returns void language sql as $$
  insert into dato values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.d(p_k text) returns jsonb language sql stable as $$ select v from dato where k = p_k $$;
create function pg_temp.huella(p_n text) returns text language sql immutable as $$
  select encode(digest('payment_queue_and_receipts_test-' || p_n, 'sha256'), 'hex');
$$;
-- Un id fijo que sólo puede ser de este archivo.
create function pg_temp.uid(p_n text) returns uuid language sql immutable as $$
  select md5('payment_queue_and_receipts_test-' || p_n)::uuid;
$$;

create function pg_temp.usuario(p_tag text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated','payment_queue_and_receipts_test-' || p_tag || '-' || replace(v_id::text,'-','') || '@example.invalid','',now(),'{}','{}',now(),now());
  return v_id;
end $$;

-- Un comercio con su dueño (sesión registrada), el cobro habilitado, el vendedor
-- conectado, un producto y un checkout de Mercado Pago de p_qty unidades con su
-- preferencia asentada por V2. p_environment decide el entorno del cobro.
create function pg_temp.armar(p_k text, p_stock integer default 10, p_qty integer default 3, p_environment text default 'test')
returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('owner-' || p_k);
  v_customer uuid := pg_temp.usuario('cliente-' || p_k);
  v_session uuid; v_prepare jsonb;
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values (
    v_business, 'TABA cola de pagos ' || p_k, 'payment-queue-and-receipts-test-' || p_k || '-' || right(replace(v_business::text,'-',''), 8),
    'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
  values (v_owner, v_owner, v_business, 'owner', 'panel_web');
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at, production_review_status
  ) values (v_business, true, p_environment, 'checkout_pro', 'ARS', true,
    'payment_queue_and_receipts_test-' || p_k, 'app-payment_queue_and_receipts_test-' || p_k, clock_timestamp(), clock_timestamp(),
    case when p_environment = 'production' then 'approved' else 'not_requested' end);
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business, p_environment, 'payment_queue_and_receipts_test-' || p_k, 'app-payment_queue_and_receipts_test-' || p_k,
    'connected', 'ciphertext-only-local-fixture', now() + interval '2 days');
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata cola de pagos','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    p_stock,true,true,false,'{}',true,now(),v_owner,
    'payment_queue_and_receipts_test-' || p_k,'payment_queue_and_receipts_test-' || p_k,'commercial',1);
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'pqr-' || p_k || '-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', p_qty)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Cola', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  perform public.record_mercadopago_preference_created_v2(
    v_business, p_environment, v_session, v_customer, (v_prepare ->> 'payment_attempt_id')::uuid,
    public.get_mercadopago_payment_authority_v2(v_business, p_environment, v_session, v_customer,
      (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
    'PREF-payment_queue_and_receipts_test-' || p_k,
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pqr-' || p_k,
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pqr-' || p_k,
    pg_temp.huella('pref-' || p_k), 'req-pqr-' || p_k);
  insert into caso values (p_k, v_business, v_product, v_owner, v_customer, v_session,
    (select id from public.payment_intents where checkout_session_id = v_session),
    'payment_queue_and_receipts_test-PAY-' || p_k);
end $$;

create function pg_temp.sid(p_k text) returns uuid language sql stable as $$ select session_id from caso where k = p_k $$;
create function pg_temp.iid(p_k text) returns uuid language sql stable as $$ select intent_id from caso where k = p_k $$;
create function pg_temp.bid(p_k text) returns uuid language sql stable as $$ select business_id from caso where k = p_k $$;
create function pg_temp.pago(p_k text) returns text language sql stable as $$ select payment_id from caso where k = p_k $$;

-- Lo que el worker persiste después de leer el pago en Mercado Pago. p_semilla
-- decide el hash de la respuesta: misma semilla = misma respuesta del proveedor.
create function pg_temp.snapshot(p_k text, p_status text, p_semilla text, p_patch jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'provider_payment_id', c.payment_id,
    'external_reference', pi.external_reference,
    'preference_id', pi.preference_id, 'merchant_order_id', 'MO-pqr-' || c.k,
    'collector_id', ps.collector_id, 'application_id', '', 'currency', 'ARS',
    'transaction_amount', pi.expected_amount::text, 'status', p_status,
    'status_detail', 'detalle_de_prueba', 'payment_method', 'visa', 'live_mode', false,
    'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
    'payer_email_hash', repeat('e', 64),
    'raw_response_hash', pg_temp.huella('respuesta-' || p_semilla)) || p_patch
  from caso c
  join public.payment_intents pi on pi.id = c.intent_id
  join public.business_payment_settings ps on ps.business_id = c.business_id and ps.provider = 'mercadopago'
  where c.k = p_k;
$$;
-- Asienta y guarda la respuesta como p_out; un error se guarda como {"error": sqlstate}.
create function pg_temp.asentar(p_out text, p_k text, p_snapshot jsonb, p_source text default 'webhook', p_receipt uuid default null)
returns void language plpgsql as $$
declare v jsonb;
begin
  begin
    v := public.record_mercadopago_payment_snapshot(pg_temp.iid(p_k), p_snapshot, p_source, p_receipt);
  exception when others then
    v := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  perform pg_temp.guardar(p_out, v);
end $$;
-- Finaliza y hace lo que haría el COMMIT del worker: correr los triggers
-- diferidos de `orders`. Todo este archivo termina en rollback.
create function pg_temp.finalizar(p_out text, p_k text) returns void language plpgsql as $$
declare v jsonb;
begin
  begin
    v := public.finalize_paid_checkout_session(pg_temp.sid(p_k));
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    v := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  perform pg_temp.guardar(p_out, v);
end $$;

-- El barrido toma de a 500 sesiones, las mas viejas primero, y la base del gate trae
-- las suyas: se repite hasta que no queda ninguna vencida por barrer.
create function pg_temp.barrer() returns void language plpgsql as $$
declare n integer := 0;
begin
  loop
    exit when public.expire_checkout_sessions(500) = 0 or n >= 40;
    n := n + 1;
  end loop;
end $$;

create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_user)::text, true)::void;
$$;
create function pg_temp.sin_identidad() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;

create function pg_temp.intent(p_k text) returns public.payment_intents language sql stable as $$
  select pi from public.payment_intents pi where pi.id = pg_temp.iid(p_k)
$$;
create function pg_temp.sesion(p_k text) returns public.checkout_sessions language sql stable as $$
  select s from public.checkout_sessions s where s.id = pg_temp.sid(p_k)
$$;
create function pg_temp.stock(p_k text) returns integer language sql stable as $$
  select p.stock from public.products p join caso c on p.id = c.product_id where c.k = p_k
$$;
create function pg_temp.reservas(p_k text) returns text language sql stable as $$
  select coalesce(string_agg(format('g%s:%s:%s', r.reservation_generation, r.status, r.quantity), ' ' order by r.reservation_generation), 'ninguna')
    from public.inventory_reservations r where r.checkout_session_id = pg_temp.sid(p_k)
$$;
create function pg_temp.pedidos(p_k text) returns integer language sql stable as $$
  select count(*)::integer from public.orders o where o.business_id = pg_temp.bid(p_k)
$$;
create function pg_temp.eventos(p_k text, p_type text) returns integer language sql stable as $$
  select count(*)::integer from public.payment_events e where e.payment_intent_id = pg_temp.iid(p_k) and e.event_type = p_type
$$;

-- El id de evento de este archivo, y el recibo y el trabajo que le corresponden.
create function pg_temp.evt(p_n text) returns text language sql immutable as $$
  select 'payment_queue_and_receipts_test-evt-' || p_n
$$;
create function pg_temp.recibo(p_n text) returns public.payment_webhook_receipts language sql stable as $$
  select r from public.payment_webhook_receipts r
   where r.environment = 'test' and r.webhook_event_id = pg_temp.evt(p_n)
   order by r.received_at limit 1
$$;
create function pg_temp.recibos(p_n text) returns integer language sql stable as $$
  select count(*)::integer from public.payment_webhook_receipts r
   where r.environment = 'test' and r.webhook_event_id = pg_temp.evt(p_n)
$$;
create function pg_temp.trabajo(p_n text) returns public.payment_outbox language sql stable as $$
  select o from public.payment_outbox o where o.webhook_receipt_id = (pg_temp.recibo(p_n)).id
$$;
create function pg_temp.trabajos(p_n text) returns integer language sql stable as $$
  select count(*)::integer from public.payment_outbox o
    join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
   where r.environment = 'test' and r.webhook_event_id = pg_temp.evt(p_n)
$$;
-- La entrega de un aviso por la puerta de credencial directa (sin comercio).
create function pg_temp.entregar(p_n text, p_resource text, p_valid boolean, p_request text, p_cuerpo text, p_type text default 'payment')
returns jsonb language sql as $$
  select public.record_mercadopago_webhook_receipt('test', pg_temp.evt(p_n), p_type, p_resource, p_valid, p_request, pg_temp.huella('cuerpo-' || p_cuerpo));
$$;
-- La cola del gate trae trabajos de otros pasos. Se apartan dentro de esta
-- transacción para que un reclamo devuelva sólo los de la prueba.
create function pg_temp.apartar_la_cola() returns void language sql as $$
  update public.payment_outbox
     set next_attempt_at = clock_timestamp() + interval '1 day'
   where status in ('pending', 'retry_wait');
  update public.payment_outbox
     set lease_expires_at = clock_timestamp() + interval '1 day'
   where status in ('claimed', 'processing');
$$;
-- El trabajo está listo para reclamarse ya.
create function pg_temp.vencer_espera(p_job uuid) returns void language sql as $$
  update public.payment_outbox set next_attempt_at = clock_timestamp() - interval '1 second' where id = p_job;
$$;
create function pg_temp.reclamar(p_owner text, p_limit integer default 100, p_lease integer default 150)
returns setof uuid language sql as $$
  select j.id from public.claim_payment_outbox_v2(p_owner, p_limit, p_lease) j;
$$;
-- Ocho vueltas de reclamar, empezar y fallar: el camino real hasta `dead_letter`.
create function pg_temp.matar(p_job uuid, p_error text) returns void language plpgsql as $$
declare n integer;
begin
  for n in 1..8 loop
    perform pg_temp.vencer_espera(p_job);
    perform pg_temp.reclamar('pqr-worker-a', 100, 150);
    perform public.start_payment_outbox_job(p_job, 'pqr-worker-a');
    perform public.fail_payment_outbox_job(p_job, 'pqr-worker-a', p_error);
  end loop;
end $$;
-- Una vuelta completa de un worker sobre un trabajo: reclamar, empezar y terminar.
create function pg_temp.procesar(p_job uuid, p_owner text) returns boolean language plpgsql as $$
begin
  perform pg_temp.vencer_espera(p_job);
  perform pg_temp.reclamar(p_owner, 100, 150);
  return public.start_payment_outbox_job(p_job, p_owner) and public.complete_payment_outbox_job(p_job, p_owner);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
--  1 · CONTRATO Y PRIVILEGIOS
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in (
      'public.record_mercadopago_webhook_receipt(text,text,text,text,boolean,text,text)'::regprocedure,
      'public.mp_record_seller_webhook(text,text,text,text,boolean,text,text,uuid)'::regprocedure,
      'public.claim_payment_outbox_v2(text,integer,integer)'::regprocedure,
      'public.start_payment_outbox_job(uuid,text)'::regprocedure,
      'public.complete_payment_outbox_job(uuid,text)'::regprocedure,
      'public.fail_payment_outbox_job(uuid,text,text)'::regprocedure)
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('public', p.oid, 'EXECUTE')),
  6, '1: el recibo y la cola son solo del servicio: ningun rol de cliente las ejecuta');
select ok(
  has_function_privilege('authenticated', 'public.revive_payment_outbox_job(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.revive_payment_outbox_job(uuid,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.revive_payment_outbox_job(uuid,text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.revive_payment_outbox_job(uuid,text)', 'EXECUTE'),
  '1: reanimar un trabajo es del Panel autenticado: ni anon ni la clave de servicio');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in (
      'public.record_mercadopago_webhook_receipt(text,text,text,text,boolean,text,text)'::regprocedure,
      'public.revive_payment_outbox_job(uuid,text)'::regprocedure)
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')),
  2, '1: el recibo y la reanimacion son SECURITY DEFINER con search_path fijado');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.payment_outbox_revivals'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'payment_outbox_revivals') = 0,
  '1: el rastro de reanimaciones tiene RLS y ninguna politica: ningun cliente lo lee');
select is(
  (select coalesce(string_agg(g.grantee || ':' || g.privilege_type, ',' order by g.grantee, g.privilege_type), '')
     from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = 'payment_outbox_revivals'
      and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  'service_role:SELECT', '1: y solo la clave de servicio lo lee; nadie lo escribe por tabla');
select is(
  (select count(*)::integer from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name in ('payment_outbox', 'payment_webhook_receipts')
      and g.grantee in ('anon', 'authenticated')),
  0, '1: la cola y los recibos no tienen ningun permiso para roles de cliente');

-- ══════════════════════════════════════════════════════════════════════════
--  2 · EL RECIBO: PRIMERA ENTREGA, REENTREGA, EL MISMO AVISO 20 VECES
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('a1.primera', pg_temp.entregar('a1', 'pqr-PAY-a1', true, 'pqr-req-a1-1', 'a1'));
select is(pg_temp.d('a1.primera') ->> 'queued' || '/' || (pg_temp.d('a1.primera') ->> 'duplicate') || '/' || (pg_temp.d('a1.primera') ->> 'promoted'),
  'true/false/false', '2: la primera entrega valida queda encolada, sin ser duplicada ni promovida');
select is((pg_temp.d('a1.primera') ->> 'receipt_id')::uuid, (pg_temp.recibo('a1')).id, '2: y devuelve el id de su recibo');
select is(
  (pg_temp.recibo('a1')).processing_status || '/' || (pg_temp.recibo('a1')).signature_valid || '/' || (pg_temp.recibo('a1')).attempt_count
    || '/' || (pg_temp.recibo('a1')).event_type || '/' || (pg_temp.recibo('a1')).resource_id || '/' || (pg_temp.recibo('a1')).request_id,
  'queued/true/0/payment/pqr-PAY-a1/pqr-req-a1-1', '2: el recibo queda queued, con firma valida, su recurso y su x-request-id');
select is((pg_temp.recibo('a1')).payload_hash, pg_temp.huella('cuerpo-a1'), '2: guarda el hash del cuerpo, no el cuerpo');
select is(
  (pg_temp.trabajo('a1')).topic || '/' || (pg_temp.trabajo('a1')).status || '/' || (pg_temp.trabajo('a1')).resource_id
    || '/' || (pg_temp.trabajo('a1')).attempts || '/' || ((pg_temp.trabajo('a1')).payment_intent_id is null),
  'payment/pending/pqr-PAY-a1/0/true', '2: con UN trabajo pendiente del tema payment, sin cobro asociado todavia');
select ok((pg_temp.trabajo('a1')).next_attempt_at <= clock_timestamp(), '2: listo para reclamarse ya');

-- La misma notificación otra vez (Mercado Pago reentrega con otro x-request-id).
select pg_temp.guardar('a1.segunda', pg_temp.entregar('a1', 'pqr-PAY-a1', true, 'pqr-req-a1-2', 'a1'));
select is(
  pg_temp.d('a1.segunda') ->> 'duplicate' || '/' || (pg_temp.d('a1.segunda') ->> 'queued') || '/' || (pg_temp.d('a1.segunda') ->> 'signature_valid'),
  'true/false/true', '2: la reentrega identica contesta duplicate y no encola');
select is((pg_temp.d('a1.segunda') ->> 'receipt_id')::uuid, (pg_temp.recibo('a1')).id, '2: sobre el MISMO recibo');
select is(pg_temp.recibos('a1') || '/' || pg_temp.trabajos('a1') || '/' || (pg_temp.recibo('a1')).attempt_count, '1/1/1',
  '2: un recibo, un trabajo, y un intento mas anotado en el recibo');
select is((pg_temp.recibo('a1')).request_id || '/' || (pg_temp.recibo('a1')).processing_status, 'pqr-req-a1-1/queued',
  '2: la reentrega no pisa el x-request-id ni el estado del recibo');

-- El mismo aviso veinte veces más.
select is(
  (select count(*)::integer from generate_series(1, 20) n
    where (pg_temp.entregar('a1', 'pqr-PAY-a1', true, 'pqr-req-a1-x' || n, 'a1') ->> 'duplicate') = 'true'),
  20, '2: el mismo aviso 20 veces mas: las 20 contestan duplicate');
select is(pg_temp.recibos('a1') || '/' || pg_temp.trabajos('a1') || '/' || (pg_temp.recibo('a1')).attempt_count, '1/1/21',
  '2: sigue habiendo UN recibo y UN trabajo, con las 21 repeticiones contadas');

-- ══════════════════════════════════════════════════════════════════════════
--  3 · SIN FIRMA, PROMOCIÓN, Y EL RECIBO VÁLIDO NO SE DEGRADA
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('b1.rechazo', pg_temp.entregar('b1', 'pqr-PAY-b1', false, 'pqr-req-b1-malo', 'b1-malo'));
select is(pg_temp.d('b1.rechazo') ->> 'queued' || '/' || (pg_temp.d('b1.rechazo') ->> 'duplicate'), 'false/false',
  '3: una entrega sin firma valida no entra a la cola');
select is(
  (pg_temp.recibo('b1')).processing_status || '/' || (pg_temp.recibo('b1')).signature_valid || '/' || pg_temp.trabajos('b1'),
  'rejected_signature/false/0', '3: deja un recibo rejected_signature y ningun trabajo');
select pg_temp.guardar('b1.rechazo2', pg_temp.entregar('b1', 'pqr-PAY-b1', false, 'pqr-req-b1-malo-2', 'b1-malo-2'));
select is(
  pg_temp.d('b1.rechazo2') ->> 'duplicate' || '/' || (pg_temp.d('b1.rechazo2') ->> 'signature_valid') || '/' || pg_temp.recibos('b1')
    || '/' || (pg_temp.recibo('b1')).attempt_count || '/' || pg_temp.trabajos('b1'),
  'true/false/1/1/0', '3: repetir el rechazo no agrega fila: suma un intento y sigue sin trabajo');

-- Llega la misma notificación con firma válida: el recibo rechazado se promueve.
select pg_temp.guardar('b1.valida', pg_temp.entregar('b1', 'pqr-PAY-b1', true, 'pqr-req-b1-bueno', 'b1-bueno'));
select is(
  pg_temp.d('b1.valida') ->> 'promoted' || '/' || (pg_temp.d('b1.valida') ->> 'queued') || '/' || (pg_temp.d('b1.valida') ->> 'duplicate'),
  'true/true/true', '3: la entrega valida posterior promueve el recibo rechazado y lo encola');
select is(
  (pg_temp.recibo('b1')).processing_status || '/' || (pg_temp.recibo('b1')).signature_valid || '/' || (pg_temp.recibo('b1')).request_id
    || '/' || ((pg_temp.recibo('b1')).payload_hash = pg_temp.huella('cuerpo-b1-bueno')),
  'queued/true/pqr-req-b1-bueno/true', '3: el recibo pasa a valido con el x-request-id y el hash de la entrega firmada');
select is(pg_temp.recibos('b1') || '/' || pg_temp.trabajos('b1'), '1/1', '3: un recibo y exactamente UN trabajo');
select is(pg_temp.entregar('b1', 'pqr-PAY-b1', true, 'pqr-req-b1-bueno-2', 'b1-bueno-2') ->> 'queued', 'false',
  '3: una segunda entrega valida ya no encola otra vez');
select pg_temp.entregar('b1', 'pqr-PAY-b1', false, 'pqr-req-b1-malo-3', 'b1-malo-3');
select is(
  (pg_temp.recibo('b1')).signature_valid || '/' || (pg_temp.recibo('b1')).request_id || '/' || ((pg_temp.recibo('b1')).payload_hash = pg_temp.huella('cuerpo-b1-bueno'))
    || '/' || (pg_temp.recibo('b1')).processing_status || '/' || pg_temp.trabajos('b1'),
  'true/pqr-req-b1-bueno/true/queued/1', '3: una entrega invalida posterior no toca el recibo valido ni su trabajo');

-- ══════════════════════════════════════════════════════════════════════════
--  4 · TEMAS Y ENTRADAS INVÁLIDAS
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.entregar('t-chargeback', 'pqr-CB-1', true, 'pqr-req-t-cb', 't-cb', 'Chargebacks');
select pg_temp.entregar('t-claim', 'pqr-CL-1', true, 'pqr-req-t-cl', 't-cl', 'claim');
select pg_temp.entregar('t-updated', 'pqr-PAY-t3', true, 'pqr-req-t-up', 't-up', 'payment.updated');
select is(
  (pg_temp.trabajo('t-chargeback')).topic || '/' || (pg_temp.trabajo('t-claim')).topic || '/' || (pg_temp.trabajo('t-updated')).topic,
  'chargeback/claim/payment', '4: el tema del trabajo sale del tipo del aviso: contracargo, reclamo, pago');
select is((pg_temp.recibo('t-chargeback')).event_type, 'chargebacks', '4: el tipo se guarda en minusculas');
select pg_temp.guardar('t.otro', pg_temp.entregar('t-otro', 'pqr-MO-1', true, 'pqr-req-t-otro', 't-otro', 'merchant_order'));
select is(
  pg_temp.d('t.otro') ->> 'queued' || '/' || (pg_temp.recibo('t-otro')).processing_status || '/' || pg_temp.trabajos('t-otro')
    || '/' || ((pg_temp.recibo('t-otro')).processed_at is not null),
  'false/completed/0/true', '4: un tipo que no se procesa queda con recibo completed y sin trabajo');
select throws_ok(
  $$select public.record_mercadopago_webhook_receipt('staging', 'payment_queue_and_receipts_test-evt-inv1', 'payment', 'pqr-X', true, 'r', repeat('a', 64))$$,
  '22023', 'receipt de webhook invalido', '4: un entorno que no es test ni production se rechaza');
select throws_ok(
  $$select public.record_mercadopago_webhook_receipt('test', '  ', 'payment', 'pqr-X', true, 'r', repeat('a', 64))$$,
  '22023', 'receipt de webhook invalido', '4: sin id de evento se rechaza');
select throws_ok(
  $$select public.record_mercadopago_webhook_receipt('test', 'payment_queue_and_receipts_test-evt-inv3', 'payment', '', true, 'r', repeat('a', 64))$$,
  '22023', 'receipt de webhook invalido', '4: sin recurso se rechaza');
select throws_ok(
  $$select public.record_mercadopago_webhook_receipt('test', 'payment_queue_and_receipts_test-evt-inv4', 'payment', 'pqr-X', true, 'r', 'no-es-un-hash')$$,
  '22023', 'receipt de webhook invalido', '4: sin un hash sha-256 del cuerpo se rechaza');
select is(
  (select count(*)::integer from public.payment_webhook_receipts r
    where r.webhook_event_id like 'payment_queue_and_receipts_test-evt-inv%'),
  0, '4: ninguna de las entradas invalidas dejo recibo');

-- ══════════════════════════════════════════════════════════════════════════
--  5 · LA PUERTA DEL VENDEDOR CONECTADO
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.armar('s1');
select pg_temp.armar('s2');
select pg_temp.guardar('s1.aviso', public.mp_record_seller_webhook('test', pg_temp.evt('s1'), 'payment', pg_temp.pago('s1'),
  true, 'pqr-req-s1', pg_temp.huella('cuerpo-s1'), pg_temp.bid('s1')));
select is(pg_temp.d('s1.aviso') ->> 'queued', 'true', '5: el aviso de un vendedor conectado queda encolado');
select is((pg_temp.recibo('s1')).seller_business_id, pg_temp.bid('s1'), '5: y el recibo queda atado a ese comercio');
select is(
  public.mp_record_seller_webhook('test', pg_temp.evt('s1'), 'payment', pg_temp.pago('s1'), true, 'pqr-req-s1-b',
    pg_temp.huella('cuerpo-s1'), pg_temp.bid('s1')) ->> 'duplicate',
  'true', '5: la reentrega por la puerta del vendedor tambien es duplicate');
select is(pg_temp.recibos('s1') || '/' || pg_temp.trabajos('s1'), '1/1', '5: un recibo, un trabajo');
select throws_like(
  format($$select public.mp_record_seller_webhook('test', %L, 'payment', %L, true, 'pqr-req-s1-c', %L, %L)$$,
    pg_temp.evt('s1'), pg_temp.pago('s1'), pg_temp.huella('cuerpo-s1'), pg_temp.bid('s2')),
  'webhook_business_mismatch', '5: el mismo aviso presentado para OTRO comercio se rechaza');
select is((pg_temp.recibo('s1')).seller_business_id, pg_temp.bid('s1'), '5: y el recibo sigue siendo del comercio original');
update public.mp_seller_connections set status = 'requires_reauthorization' where business_id = pg_temp.bid('s2');
select throws_like(
  format($$select public.mp_record_seller_webhook('test', %L, 'payment', %L, true, 'pqr-req-s2', %L, %L)$$,
    pg_temp.evt('s2'), pg_temp.pago('s2'), pg_temp.huella('cuerpo-s2'), pg_temp.bid('s2')),
  'seller_not_connected', '5: sin vendedor conectado la puerta se niega');
select is(pg_temp.recibos('s2') || '/' || pg_temp.trabajos('s2'), '0/0', '5: y no deja recibo ni trabajo');
update public.mp_seller_connections set status = 'connected' where business_id = pg_temp.bid('s2');

-- ══════════════════════════════════════════════════════════════════════════
--  6 · UNA ENTREGA FIRMADA REPETIDA CON OTRO CUERPO
-- ══════════════════════════════════════════════════════════════════════════
-- La firma cubre el recurso, el x-request-id y el ts. El id del evento y el tipo
-- salen del cuerpo. Quien repite una entrega capturada no puede cambiar el
-- x-request-id sin invalidar la firma; el id y el tipo, sí.
select pg_temp.guardar('r1.original', pg_temp.entregar('r1', 'pqr-PAY-r1', true, 'pqr-req-r1-firmado', 'r1'));
select is(pg_temp.d('r1.original') ->> 'queued', 'true', '6: control, la entrega original queda encolada');
select pg_temp.guardar('r1.repeticion', pg_temp.entregar('r1-otro-id', 'pqr-PAY-r1', true, 'pqr-req-r1-firmado', 'r1-otro-cuerpo'));
select is(
  pg_temp.d('r1.repeticion') ->> 'duplicate' || '/' || (pg_temp.d('r1.repeticion') ->> 'queued') || '/' || (pg_temp.d('r1.repeticion') ->> 'signed_replay'),
  'true/false/true', '6: la misma entrega firmada con OTRO id en el cuerpo contesta duplicate y no encola');
select is((pg_temp.d('r1.repeticion') ->> 'receipt_id')::uuid, (pg_temp.recibo('r1')).id, '6: y apunta al recibo de la entrega original');
select is(
  (select count(*)::integer from generate_series(1, 20) n
    where (pg_temp.entregar('r1-forjado-' || n, 'pqr-PAY-r1', true, 'pqr-req-r1-firmado', 'r1-forjado-' || n) ->> 'signed_replay') = 'true'),
  20, '6: veinte repeticiones mas con veinte ids distintos: las veinte son la misma entrega');
select is(
  (select count(*)::integer from public.payment_webhook_receipts r where r.environment = 'test' and r.resource_id = 'pqr-PAY-r1')
    || '/' || (select count(*)::integer from public.payment_outbox o join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
                where r.environment = 'test' and r.resource_id = 'pqr-PAY-r1'),
  '1/1', '6: UN recibo y UN trabajo para ese pago, no veintidos');
select is((pg_temp.recibo('r1')).attempt_count, 21, '6: las repeticiones quedan contadas en el recibo original');
select pg_temp.guardar('r1.tema', pg_temp.entregar('r1-como-contracargo', 'pqr-PAY-r1', true, 'pqr-req-r1-firmado', 'r1-tema', 'chargeback'));
select is(
  pg_temp.d('r1.tema') ->> 'signed_replay' || '/' || (select count(*)::integer from public.payment_outbox o
      join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
     where r.environment = 'test' and r.resource_id = 'pqr-PAY-r1' and o.topic = 'chargeback'),
  'true/0', '6: cambiarle el tipo tampoco fabrica un trabajo de contracargo sobre el id de un pago');
-- Lo legítimo sigue pasando.
select is(pg_temp.entregar('r1', 'pqr-PAY-r1', true, 'pqr-req-r1-firmado', 'r1') ->> 'duplicate' || '/'
    || coalesce(pg_temp.entregar('r1', 'pqr-PAY-r1', true, 'pqr-req-r1-firmado', 'r1') ->> 'signed_replay', 'no'),
  'true/no', '6: la reentrega byte a byte de la original sigue siendo un duplicate comun');
select pg_temp.guardar('r1.nuevo', pg_temp.entregar('r1-reembolso', 'pqr-PAY-r1', true, 'pqr-req-r1-otra-entrega', 'r1-reembolso'));
select is(
  pg_temp.d('r1.nuevo') ->> 'queued' || '/' || (pg_temp.d('r1.nuevo') ->> 'duplicate') || '/' || pg_temp.trabajos('r1-reembolso'),
  'true/false/1', '6: un aviso NUEVO del mismo pago (otro id, otro x-request-id) deja su recibo y su trabajo');
select is(
  (select count(*)::integer from public.payment_outbox o join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
    where r.environment = 'test' and r.resource_id = 'pqr-PAY-r1'),
  2, '6: dos avisos legitimos del pago, dos trabajos');
-- Sólo cuentan los recibos válidos: uno rechazado con el mismo x-request-id no ocupa el lugar.
select pg_temp.entregar('r2-forjado', 'pqr-PAY-r2', false, 'pqr-req-r2-firmado', 'r2-forjado');
select pg_temp.guardar('r2.real', pg_temp.entregar('r2', 'pqr-PAY-r2', true, 'pqr-req-r2-firmado', 'r2'));
select is(
  pg_temp.d('r2.real') ->> 'queued' || '/' || coalesce(pg_temp.d('r2.real') ->> 'signed_replay', 'no') || '/' || pg_temp.trabajos('r2'),
  'true/no/1', '6: un recibo rechazado con ese x-request-id no le quita el lugar a la entrega firmada');
select is(
  pg_temp.entregar('r3', 'pqr-PAY-r3', true, null, 'r3') ->> 'queued' || '/' || (pg_temp.entregar('r3-b', 'pqr-PAY-r3', true, null, 'r3-b') ->> 'queued'),
  'true/true', '6: sin x-request-id no hay con que reconocer una repeticion: vale la clave de siempre');
select is(
  pg_temp.entregar('r4', 'pqr-PAY-r4', true, 'pqr-req-compartido', 'r4') ->> 'queued' || '/' || (pg_temp.entregar('r5', 'pqr-PAY-r5', true, 'pqr-req-compartido', 'r5') ->> 'queued'),
  'true/true', '6: el mismo x-request-id sobre OTRO pago no es una repeticion');
-- Por la puerta del vendedor es el mismo recibo.
select pg_temp.guardar('s1.repeticion', public.mp_record_seller_webhook('test', pg_temp.evt('s1-otro-id'), 'payment', pg_temp.pago('s1'),
  true, 'pqr-req-s1', pg_temp.huella('cuerpo-s1-otro'), pg_temp.bid('s1')));
select is(
  pg_temp.d('s1.repeticion') ->> 'signed_replay' || '/' || ((pg_temp.d('s1.repeticion') ->> 'receipt_id')::uuid = (pg_temp.recibo('s1')).id)
    || '/' || pg_temp.recibos('s1-otro-id'),
  'true/true/0', '6: por la puerta del vendedor la repeticion tambien cae en el recibo original');

-- Hasta acá el trabajo de la entrega original estaba esperando: su lectura del
-- proveedor estaba por venir, y la repetición no tenía nada que agregar. Cuando el
-- trabajo YA leyó es distinto. El cuerpo no está firmado: lo que llega puede ser
-- una repetición o un aviso nuevo que el proveedor mandó con la misma firma, y no
-- hay cómo distinguirlos. No nace otro recibo ni otro trabajo: el mismo trabajo
-- vuelve a la cola para una lectura más, así el aviso nuevo no se pierde.
select pg_temp.apartar_la_cola();
select pg_temp.entregar('w1', 'pqr-PAY-w1', true, 'pqr-req-w1', 'w1');
select pg_temp.guardar('w1.vuelta', to_jsonb(pg_temp.procesar((pg_temp.trabajo('w1')).id, 'pqr-worker-w')));
select is(
  (pg_temp.d('w1.vuelta') #>> '{}') || '/' || (pg_temp.trabajo('w1')).status || '/' || (pg_temp.recibo('w1')).processing_status
    || '/' || (pg_temp.trabajo('w1')).attempts || '/' || (pg_temp.recibo('w1')).attempt_count,
  'true/completed/completed/1/1', '6: control, el trabajo de la entrega original ya leyo al proveedor y termino');
select pg_temp.guardar('w1.repeticion', pg_temp.entregar('w1-otro-id', 'pqr-PAY-w1', true, 'pqr-req-w1', 'w1-otro-cuerpo'));
select is(
  pg_temp.d('w1.repeticion') ->> 'signed_replay' || '/' || (pg_temp.d('w1.repeticion') ->> 'duplicate') || '/' || (pg_temp.d('w1.repeticion') ->> 'queued')
    || '/' || ((pg_temp.d('w1.repeticion') ->> 'receipt_id')::uuid = (pg_temp.recibo('w1')).id),
  'true/true/true/true', '6: la misma entrega firmada con otro cuerpo, cuando su trabajo ya termino, contesta queued sobre el recibo original');
select is(
  (pg_temp.trabajo('w1')).status || '/' || (pg_temp.trabajo('w1')).attempts || '/' || ((pg_temp.trabajo('w1')).owner is null)
    || '/' || ((pg_temp.trabajo('w1')).lease_expires_at is null) || '/' || ((pg_temp.trabajo('w1')).completed_at is null)
    || '/' || ((pg_temp.trabajo('w1')).next_attempt_at <= clock_timestamp()),
  'pending/0/true/true/true/true', '6: el MISMO trabajo vuelve a la cola, listo ya, con el presupuesto de reintentos de una entrega nueva');
select is(
  (pg_temp.recibo('w1')).processing_status || '/' || ((pg_temp.recibo('w1')).processed_at is null) || '/' || (pg_temp.recibo('w1')).attempt_count,
  'queued/true/2', '6: y su recibo vuelve a queued, con la repeticion contada');
select is(
  (select count(*)::integer from public.payment_webhook_receipts r where r.environment = 'test' and r.resource_id = 'pqr-PAY-w1')
    || '/' || (select count(*)::integer from public.payment_outbox o join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
                where r.environment = 'test' and r.resource_id = 'pqr-PAY-w1'),
  '1/1', '6: sigue habiendo UN recibo y UN trabajo: se relee, no se multiplica');
select is(
  (select count(*)::integer from generate_series(1, 20) n
    where (pg_temp.entregar('w1-forjado-' || n, 'pqr-PAY-w1', true, 'pqr-req-w1', 'w1-forjado-' || n) ->> 'queued') = 'false'),
  20, '6: veinte repeticiones mas mientras espera no agregan nada: una lectura pendiente alcanza');
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-w', 100, 150)) || '/' || (select count(*)::integer from pg_temp.reclamar('pqr-worker-x', 100, 150)), '1/0',
  '6: el worker lo reclama una vez');
-- Reclamado y sin empezar: todavía no leyó. No se toca.
select pg_temp.guardar('w1.reclamado', pg_temp.entregar('w1-otro-id-2', 'pqr-PAY-w1', true, 'pqr-req-w1', 'w1-otro-cuerpo-2'));
select is(
  pg_temp.d('w1.reclamado') ->> 'queued' || '/' || (pg_temp.trabajo('w1')).status || '/' || (pg_temp.trabajo('w1')).owner || '/' || (pg_temp.trabajo('w1')).attempts,
  'false/claimed/pqr-worker-w/1', '6: un trabajo reclamado que todavia no empezo no se toca: su lectura esta por venir');
-- En proceso: pudo haber leído ya. Vuelve a la cola, y el worker que lo tenía no
-- puede terminarlo ni darlo por fallido: lo corre el siguiente reclamo.
select public.start_payment_outbox_job((pg_temp.trabajo('w1')).id, 'pqr-worker-w');
select pg_temp.guardar('w1.en_proceso', pg_temp.entregar('w1-otro-id-3', 'pqr-PAY-w1', true, 'pqr-req-w1', 'w1-otro-cuerpo-3'));
select is(
  pg_temp.d('w1.en_proceso') ->> 'queued' || '/' || (pg_temp.trabajo('w1')).status || '/' || ((pg_temp.trabajo('w1')).owner is null) || '/' || (pg_temp.trabajo('w1')).attempts,
  'true/pending/true/0', '6: un trabajo en proceso pudo haber leido antes del aviso: vuelve a la cola');
select pg_temp.guardar('w1.tarde', to_jsonb(
  public.complete_payment_outbox_job((pg_temp.trabajo('w1')).id, 'pqr-worker-w') || '/'
    || coalesce(public.fail_payment_outbox_job((pg_temp.trabajo('w1')).id, 'pqr-worker-w', 'tarde'), 'null')));
select is((pg_temp.d('w1.tarde') #>> '{}') || '/' || (pg_temp.trabajo('w1')).status || '/' || (pg_temp.trabajo('w1')).attempts,
  'false/null/pending/0', '6: el worker que lo estaba corriendo ya no lo termina ni lo falla: queda para el proximo reclamo');
-- En espera de reintento: no se adelanta la espera ni se toca la cuenta.
select pg_temp.reclamar('pqr-worker-w', 100, 150);
select public.start_payment_outbox_job((pg_temp.trabajo('w1')).id, 'pqr-worker-w');
select public.fail_payment_outbox_job((pg_temp.trabajo('w1')).id, 'pqr-worker-w', 'provider_http_503');
select pg_temp.guardar('w1.en_espera', pg_temp.entregar('w1-otro-id-4', 'pqr-PAY-w1', true, 'pqr-req-w1', 'w1-otro-cuerpo-4'));
select is(
  pg_temp.d('w1.en_espera') ->> 'queued' || '/' || (pg_temp.trabajo('w1')).status || '/' || (pg_temp.trabajo('w1')).attempts
    || '/' || ((pg_temp.trabajo('w1')).next_attempt_at > clock_timestamp() + interval '20 seconds'),
  'false/retry_wait/1/true', '6: un trabajo esperando su reintento no se toca: una repeticion no adelanta la espera ni gasta intentos');
-- En dead_letter: no vuelve solo por una repetición. Eso lo decide una persona.
select pg_temp.matar((pg_temp.trabajo('w1')).id, 'provider_http_503');
select pg_temp.guardar('w1.caido', pg_temp.entregar('w1-otro-id-5', 'pqr-PAY-w1', true, 'pqr-req-w1', 'w1-otro-cuerpo-5'));
select is(
  pg_temp.d('w1.caido') ->> 'signed_replay' || '/' || (pg_temp.d('w1.caido') ->> 'queued') || '/' || (pg_temp.trabajo('w1')).status || '/' || (pg_temp.recibo('w1')).processing_status,
  'true/false/dead_letter/dead_letter', '6: un trabajo en dead_letter no vuelve a la cola por una repeticion');
select is(
  (select count(*)::integer from public.payment_webhook_receipts r where r.environment = 'test' and r.resource_id = 'pqr-PAY-w1')
    || '/' || (select count(*)::integer from public.payment_outbox o join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
                where r.environment = 'test' and r.resource_id = 'pqr-PAY-w1'),
  '1/1', '6: despues de todo eso, un recibo y un trabajo');
-- La reentrega del MISMO aviso (el mismo id) es otra cosa: ese aviso ya se leyó.
select pg_temp.entregar('w2', 'pqr-PAY-w2', true, 'pqr-req-w2', 'w2');
select pg_temp.procesar((pg_temp.trabajo('w2')).id, 'pqr-worker-w');
select pg_temp.guardar('w2.reentrega', pg_temp.entregar('w2', 'pqr-PAY-w2', true, 'pqr-req-w2-otra', 'w2'));
select is(
  pg_temp.d('w2.reentrega') ->> 'duplicate' || '/' || (pg_temp.d('w2.reentrega') ->> 'queued') || '/' || coalesce(pg_temp.d('w2.reentrega') ->> 'signed_replay', 'no')
    || '/' || (pg_temp.trabajo('w2')).status,
  'true/false/no/completed', '6: la reentrega del mismo aviso sobre un trabajo terminado sigue sin releer nada');
select pg_temp.guardar('w2.misma_firma', pg_temp.entregar('w2', 'pqr-PAY-w2', true, 'pqr-req-w2', 'w2'));
select is(
  pg_temp.d('w2.misma_firma') ->> 'duplicate' || '/' || (pg_temp.d('w2.misma_firma') ->> 'queued') || '/' || coalesce(pg_temp.d('w2.misma_firma') ->> 'signed_replay', 'no')
    || '/' || (pg_temp.trabajo('w2')).status,
  'true/false/no/completed', '6: y la repeticion byte a byte de esa entrega tampoco');

-- ══════════════════════════════════════════════════════════════════════════
--  7 · EL CICLO DE LA COLA
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.apartar_la_cola();
select pg_temp.entregar('q1', 'pqr-PAY-q1', true, 'pqr-req-q1', 'q1');
select pg_temp.entregar('q2', 'pqr-PAY-q2', true, 'pqr-req-q2', 'q2');
select pg_temp.entregar('q3', 'pqr-PAY-q3', true, 'pqr-req-q3', 'q3');
-- Orden de la cola: por next_attempt_at y después por creación.
update public.payment_outbox set next_attempt_at = clock_timestamp() - interval '3 seconds' where id = (pg_temp.trabajo('q1')).id;
update public.payment_outbox set next_attempt_at = clock_timestamp() - interval '2 seconds' where id = (pg_temp.trabajo('q2')).id;
update public.payment_outbox set next_attempt_at = clock_timestamp() - interval '1 second' where id = (pg_temp.trabajo('q3')).id;

select throws_ok($$select * from public.claim_payment_outbox_v2('  ', 5, 150)$$, '22023', 'owner requerido',
  '7: reclamar exige decir quien reclama');
create temporary table reclamo_1 on commit drop as select id from pg_temp.reclamar('pqr-worker-a', 2, 150) as id;
select is((select count(*)::integer from reclamo_1), 2, '7: el reclamo respeta el tope: pide 2 y se lleva 2');
select is(
  (select string_agg(case id when (pg_temp.trabajo('q1')).id then 'q1' when (pg_temp.trabajo('q2')).id then 'q2' when (pg_temp.trabajo('q3')).id then 'q3' else 'ajeno' end, ',' order by 1) from reclamo_1),
  'q1,q2', '7: y son los dos mas antiguos de la cola');
select is(
  (pg_temp.trabajo('q1')).status || '/' || (pg_temp.trabajo('q1')).owner || '/' || (pg_temp.trabajo('q1')).attempts || '/' || (pg_temp.trabajo('q3')).status,
  'claimed/pqr-worker-a/1/pending', '7: quedan claimed, con su dueno y un intento contado; el tercero sigue pendiente');
select ok(
  (pg_temp.trabajo('q1')).lease_expires_at between clock_timestamp() + interval '140 seconds' and clock_timestamp() + interval '150 seconds',
  '7: con el plazo pedido (150 s) contado desde el reclamo');
select is((pg_temp.recibo('q1')).processing_status, 'queued', '7: reclamar no cambia el recibo: todavia no empezo');

-- Otro worker, con el plazo del primero vigente.
create temporary table reclamo_2 on commit drop as select id from pg_temp.reclamar('pqr-worker-b', 100, 150) as id;
select is(
  (select string_agg(case id when (pg_temp.trabajo('q3')).id then 'q3' else 'otro' end, ',') from reclamo_2),
  'q3', '7: otro worker solo se lleva lo que nadie tiene: no reclama un trabajo con plazo vigente');
select is((pg_temp.trabajo('q1')).owner || '/' || (pg_temp.trabajo('q1')).attempts, 'pqr-worker-a/1', '7: el trabajo del primero sigue siendo suyo');
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-c', 100, 150)), 0, '7: con todo reclamado un tercer worker no se lleva nada');

-- Los plazos fuera de rango se acotan.
select pg_temp.entregar('q4', 'pqr-PAY-q4', true, 'pqr-req-q4', 'q4');
select pg_temp.vencer_espera((pg_temp.trabajo('q4')).id);
select pg_temp.reclamar('pqr-worker-corto', 1, 1);
select ok(
  (pg_temp.trabajo('q4')).lease_expires_at between clock_timestamp() + interval '10 seconds' and clock_timestamp() + interval '15 seconds',
  '7: un plazo pedido de 1 s se sube al minimo de 15 s');
select pg_temp.entregar('q5', 'pqr-PAY-q5', true, 'pqr-req-q5', 'q5');
select pg_temp.vencer_espera((pg_temp.trabajo('q5')).id);
select pg_temp.reclamar('pqr-worker-largo', 1, 100000);
select ok(
  (pg_temp.trabajo('q5')).lease_expires_at between clock_timestamp() + interval '590 seconds' and clock_timestamp() + interval '600 seconds',
  '7: y uno de 100000 s se baja al maximo de 600 s');

-- Empezar: sólo el dueño del reclamo, con el plazo vigente.
select is(public.start_payment_outbox_job((pg_temp.trabajo('q1')).id, 'pqr-worker-b'), false, '7: otro worker no puede empezar un trabajo ajeno');
select is(public.start_payment_outbox_job((pg_temp.trabajo('q1')).id, 'pqr-worker-a'), true, '7: su dueno si');
select is(
  (pg_temp.trabajo('q1')).status || '/' || (pg_temp.recibo('q1')).processing_status || '/' || (pg_temp.recibo('q1')).attempt_count,
  'processing/processing/1', '7: el trabajo y su recibo pasan a processing, con el intento contado en el recibo');
select is(public.start_payment_outbox_job((pg_temp.trabajo('q1')).id, 'pqr-worker-a'), false, '7: empezar dos veces no vale: la segunda contesta false');
select is(public.complete_payment_outbox_job((pg_temp.trabajo('q2')).id, 'pqr-worker-a'), false, '7: no se termina un trabajo que no se empezo');
select is(public.complete_payment_outbox_job((pg_temp.trabajo('q1')).id, 'pqr-worker-b'), false, '7: ni lo termina otro worker');
select is(public.complete_payment_outbox_job((pg_temp.trabajo('q1')).id, 'pqr-worker-a'), true, '7: su dueno lo termina');
select is(
  (pg_temp.trabajo('q1')).status || '/' || ((pg_temp.trabajo('q1')).completed_at is not null) || '/' || ((pg_temp.trabajo('q1')).lease_expires_at is null)
    || '/' || (pg_temp.recibo('q1')).processing_status || '/' || ((pg_temp.recibo('q1')).processed_at is not null),
  'completed/true/true/completed/true', '7: trabajo completed sin plazo, recibo completed con su fecha');
select is(public.complete_payment_outbox_job((pg_temp.trabajo('q1')).id, 'pqr-worker-a'), false, '7: terminar dos veces contesta false');
select is(public.fail_payment_outbox_job((pg_temp.trabajo('q1')).id, 'pqr-worker-a', 'tarde'), null, '7: y un trabajo terminado ya no se puede dar por fallido');
select is((pg_temp.trabajo('q1')).status, 'completed', '7: sigue completed');

-- El plazo vencido devuelve el trabajo a la cola.
update public.payment_outbox set lease_expires_at = clock_timestamp() - interval '1 second' where id = (pg_temp.trabajo('q2')).id;
select is(public.start_payment_outbox_job((pg_temp.trabajo('q2')).id, 'pqr-worker-a'), false, '7: con el plazo vencido su dueno ya no puede empezarlo');
create temporary table reclamo_3 on commit drop as select id from pg_temp.reclamar('pqr-worker-b', 100, 150) as id;
select is(
  (select string_agg(case id when (pg_temp.trabajo('q2')).id then 'q2' else 'otro' end, ',') from reclamo_3),
  'q2', '7: vencido el plazo, otro worker lo vuelve a reclamar');
select is((pg_temp.trabajo('q2')).owner || '/' || (pg_temp.trabajo('q2')).attempts || '/' || (pg_temp.trabajo('q2')).status, 'pqr-worker-b/2/claimed',
  '7: pasa a ser del nuevo worker, con el segundo intento contado');
select is(
  public.start_payment_outbox_job((pg_temp.trabajo('q2')).id, 'pqr-worker-a') || '/' || coalesce(public.fail_payment_outbox_job((pg_temp.trabajo('q2')).id, 'pqr-worker-a', 'viejo'), 'null'),
  'false/null', '7: el worker anterior ya no puede empezarlo ni darlo por fallido');
select is(public.start_payment_outbox_job((pg_temp.trabajo('q2')).id, 'pqr-worker-b'), true, '7: el nuevo si lo empieza');
-- Un trabajo en proceso cuyo plazo vence también vuelve.
update public.payment_outbox set lease_expires_at = clock_timestamp() - interval '1 second' where id = (pg_temp.trabajo('q2')).id;
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-c', 100, 150)), 1, '7: un trabajo en proceso con el plazo vencido tambien se reclama de nuevo');
select is((pg_temp.trabajo('q2')).owner || '/' || (pg_temp.trabajo('q2')).attempts, 'pqr-worker-c/3', '7: y cuenta el tercer intento');
select is(public.complete_payment_outbox_job((pg_temp.trabajo('q2')).id, 'pqr-worker-b'), false, '7: el worker que lo perdio no puede terminarlo');

-- ══════════════════════════════════════════════════════════════════════════
--  8 · REINTENTOS, ESPERA CRECIENTE Y dead_letter
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.apartar_la_cola();
select pg_temp.entregar('f1', 'pqr-PAY-f1', true, 'pqr-req-f1', 'f1');
select is(public.fail_payment_outbox_job((pg_temp.trabajo('f1')).id, 'pqr-worker-a', 'sin_empezar'), null,
  '8: un trabajo que no esta en proceso no se puede dar por fallido');

-- Ocho vueltas: reclamar, empezar, fallar. Entre una y otra «pasa» la espera.
create temporary table vueltas (n integer primary key, estado text, espera integer, intentos integer, recibo text) on commit drop;
do $$
declare
  v_job uuid := (pg_temp.trabajo('f1')).id;
  v_estado text;
  n integer;
begin
  for n in 1..8 loop
    perform pg_temp.vencer_espera(v_job);
    perform pg_temp.reclamar('pqr-worker-a', 100, 150);
    perform public.start_payment_outbox_job(v_job, 'pqr-worker-a');
    v_estado := public.fail_payment_outbox_job(v_job, 'pqr-worker-a', 'provider_http_429');
    insert into vueltas
    select n, v_estado, round(extract(epoch from (o.next_attempt_at - clock_timestamp())))::integer, o.attempts,
           (select r.processing_status from public.payment_webhook_receipts r where r.id = o.webhook_receipt_id)
      from public.payment_outbox o where o.id = v_job;
  end loop;
end $$;
select is(
  (select string_agg(estado || ':' || case when estado = 'retry_wait' then espera::text else '-' end, ' ' order by n) from vueltas),
  'retry_wait:30 retry_wait:60 retry_wait:120 retry_wait:240 retry_wait:480 retry_wait:960 retry_wait:1920 dead_letter:-',
  '8: siete reintentos con la espera duplicandose (30 s a 32 min) y al octavo fallo, dead_letter');
select is((select string_agg(intentos::text, ',' order by n) from vueltas), '1,2,3,4,5,6,7,8', '8: un intento contado por vuelta');
select is(
  (select string_agg(distinct recibo, ',' order by recibo) from vueltas where n <= 7) || '/' || (select recibo from vueltas where n = 8),
  'retry_wait/dead_letter', '8: el recibo sigue a su trabajo: retry_wait en cada reintento y dead_letter al final');
select is(
  (pg_temp.trabajo('f1')).status || '/' || (pg_temp.trabajo('f1')).last_error || '/' || ((pg_temp.trabajo('f1')).lease_expires_at is null),
  'dead_letter/provider_http_429/true', '8: el trabajo queda en dead_letter con el estado del proveedor en el motivo');
select is((pg_temp.recibo('f1')).last_error || '/' || (pg_temp.recibo('f1')).attempt_count, 'provider_http_429/8',
  '8: y el recibo lleva el mismo motivo y los ocho intentos');
select pg_temp.vencer_espera((pg_temp.trabajo('f1')).id);
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-b', 100, 150)), 0, '8: un trabajo en dead_letter no se vuelve a reclamar solo');
select is(pg_temp.entregar('f1', 'pqr-PAY-f1', true, 'pqr-req-f1-reentrega', 'f1') ->> 'queued', 'false',
  '8: ni lo reencola la reentrega del mismo aviso');
select ok(
  exists (select 1 from public.list_payment_outbox_operational_alerts() a
           where a.correlation_id = (pg_temp.trabajo('f1')).id and a.severity = 'critical' and a.state = 'payment_outbox_dead_letter'),
  '8: queda a la vista de la operacion como alerta critica de la cola');

-- La espera se respeta: antes de tiempo no se reclama.
select pg_temp.entregar('f2', 'pqr-PAY-f2', true, 'pqr-req-f2', 'f2');
select pg_temp.reclamar('pqr-worker-a', 100, 150);
select public.start_payment_outbox_job((pg_temp.trabajo('f2')).id, 'pqr-worker-a');
select is(public.fail_payment_outbox_job((pg_temp.trabajo('f2')).id, 'pqr-worker-a', null), 'retry_wait', '8: un fallo sin motivo tambien reintenta');
select is((pg_temp.trabajo('f2')).last_error, 'worker_failed', '8: con el motivo generico');
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-b', 100, 150)), 0, '8: mientras dura la espera nadie lo reclama');
select pg_temp.vencer_espera((pg_temp.trabajo('f2')).id);
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-b', 100, 150)), 1, '8: pasada la espera, si');
select is(
  public.start_payment_outbox_job((pg_temp.trabajo('f2')).id, 'pqr-worker-b') || '/' || public.complete_payment_outbox_job((pg_temp.trabajo('f2')).id, 'pqr-worker-b'),
  'true/true', '8: el reintento empieza y termina');
select is((pg_temp.trabajo('f2')).status || '/' || (pg_temp.recibo('f2')).processing_status || '/' || (pg_temp.trabajo('f2')).attempts, 'completed/completed/2',
  '8: y deja el trabajo y el recibo completed, en su segundo intento');

-- ══════════════════════════════════════════════════════════════════════════
--  9 · REANIMAR UN TRABAJO EN dead_letter
-- ══════════════════════════════════════════════════════════════════════════
-- Un pedido cobrado; el aviso posterior de ese pago (un reembolso hecho en Mercado
-- Pago) llega, falla ocho veces con el proveedor caído y queda en dead_letter.
select pg_temp.armar('v1', 10, 3);
select pg_temp.asentar('v1.aprobado', 'v1', pg_temp.snapshot('v1', 'approved', 'v1-aprobado'));
select pg_temp.finalizar('v1.fin', 'v1');
select pg_temp.guardar('v1.aviso', public.mp_record_seller_webhook('test', pg_temp.evt('v1'), 'payment', pg_temp.pago('v1'),
  true, 'pqr-req-v1', pg_temp.huella('cuerpo-v1'), pg_temp.bid('v1')));
select pg_temp.apartar_la_cola();
select pg_temp.matar((pg_temp.trabajo('v1')).id, 'provider_http_503');
select is((pg_temp.d('v1.fin') ->> 'ok') || '/' || (pg_temp.trabajo('v1')).status || '/' || (pg_temp.trabajo('v1')).attempts, 'true/dead_letter/8',
  '9: control, pedido cobrado y el aviso posterior de su pago en dead_letter');

-- Lo que el Panel sabe de ese cobro.
create function pg_temp.fila(p_k text, p_actor uuid default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.como(coalesce(p_actor, (select owner_id from caso where k = p_k)));
  select value into v from public.list_business_payments(pg_temp.bid(p_k)) value
   where value ->> 'payment_intent_id' = pg_temp.iid(p_k)::text;
  perform pg_temp.sin_identidad();
  return v;
end $$;
select is((pg_temp.fila('v1') ->> 'dead_letter_job_id')::uuid, (pg_temp.trabajo('v1')).id,
  '9: la lista de pagos del Panel le dice al dueno cual es el trabajo caido de ese cobro');
select is(pg_temp.fila('v1') ->> 'can_revive_job', 'true', '9: y que lo puede reanimar');
select is(pg_temp.fila('s1') ->> 'can_revive_job' || '/' || coalesce(pg_temp.fila('s1') ->> 'dead_letter_job_id', 'null'), 'false/null',
  '9: un cobro sin trabajos caidos no ofrece nada');

-- Quién puede.
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v1')).id, 'el proveedor volvio'),
  '42501', 'autenticacion requerida', '9: reanimar exige identidad');
select pg_temp.como((select customer_id from caso where k = 'v1'));
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v1')).id, 'el proveedor volvio'),
  '42501', 'reanimacion no autorizada', '9: el cliente del pedido no puede');
select pg_temp.como((select owner_id from caso where k = 's1'));
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v1')).id, 'el proveedor volvio'),
  '42501', 'reanimacion no autorizada', '9: el dueno de OTRO comercio tampoco');
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', gen_random_uuid(), 'el proveedor volvio'),
  '42501', 'reanimacion no autorizada', '9: y un trabajo que no existe contesta lo mismo que uno ajeno');
select pg_temp.sin_identidad();
-- Un empleado del mismo comercio: ve la lista, no opera.
create temporary table empleado on commit drop as select pg_temp.usuario('staff-v1') as id;
insert into public.business_members (business_id, user_id, role, is_active) select pg_temp.bid('v1'), id, 'staff', true from empleado;
insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client) select id, id, pg_temp.bid('v1'), 'staff', 'panel_web' from empleado;
select pg_temp.como((select id from empleado));
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v1')).id, 'el proveedor volvio'),
  '42501', 'reanimacion no autorizada', '9: un empleado no reanima: es del dueno o del encargado');
select pg_temp.sin_identidad();
select is(pg_temp.fila('v1', (select id from empleado)) ->> 'can_revive_job', 'false', '9: y la lista se lo dice: can_revive_job en falso para el empleado');

-- El motivo.
select pg_temp.como((select owner_id from caso where k = 'v1'));
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v1')).id, '  '),
  '22023', 'motivo requerido (3 a 200 caracteres)', '9: sin motivo no se reanima');
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v1')).id, 'avisar a cliente@example.invalid'),
  '22023', 'el motivo no puede llevar datos de contacto', '9: el motivo no admite un correo');
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v1')).id, 'llamar al 2994123456'),
  '22023', 'el motivo no puede llevar datos de contacto', '9: ni un telefono');
select is((pg_temp.trabajo('v1')).status, 'dead_letter', '9: ninguno de los rechazos toco el trabajo');

-- Reanimar.
select pg_temp.guardar('v1.revivir', public.revive_payment_outbox_job((pg_temp.trabajo('v1')).id, '  Mercado Pago   volvio a responder  '));
select is(
  pg_temp.d('v1.revivir') ->> 'ok' || '/' || (pg_temp.d('v1.revivir') ->> 'action') || '/' || (pg_temp.d('v1.revivir') ->> 'idempotent')
    || '/' || (pg_temp.d('v1.revivir') ->> 'topic') || '/' || (pg_temp.d('v1.revivir') ->> 'attempts'),
  'true/revived/false/payment/8', '9: el dueno reanima el trabajo');
select is(
  (pg_temp.trabajo('v1')).status || '/' || (pg_temp.trabajo('v1')).attempts || '/' || ((pg_temp.trabajo('v1')).owner is null)
    || '/' || ((pg_temp.trabajo('v1')).lease_expires_at is null) || '/' || ((pg_temp.trabajo('v1')).next_attempt_at <= clock_timestamp())
    || '/' || (pg_temp.trabajo('v1')).last_error,
  'pending/8/true/true/true/provider_http_503', '9: vuelve a pending, listo ya, sin dueno ni plazo, y conserva sus ocho intentos y su ultimo error');
select is((pg_temp.recibo('v1')).processing_status || '/' || (pg_temp.recibo('v1')).attempt_count, 'queued/8',
  '9: su recibo vuelve a queued sin perder la cuenta');
select is(
  (select count(*)::integer || '/' || min(v.reason) || '/' || min(v.previous_status) || '/' || min(v.previous_attempts) || '/' || min(v.previous_last_error)
       || '/' || min(v.topic) || '/' || bool_and(v.actor_user_id = (select owner_id from caso where k = 'v1'))
       || '/' || bool_and(v.business_id = pg_temp.bid('v1')) || '/' || bool_and(v.payment_intent_id = pg_temp.iid('v1'))
       || '/' || bool_and(v.revived_at <= clock_timestamp())
     from public.payment_outbox_revivals v where v.job_id = (pg_temp.trabajo('v1')).id),
  '1/Mercado Pago volvio a responder/dead_letter/8/provider_http_503/payment/true/true/true/true',
  '9: queda UNA fila de rastro: quien, cuando, por que (sin espacios de mas) y como estaba el trabajo');
select is((pg_temp.d('v1.revivir') ->> 'revival_id')::uuid,
  (select v.id from public.payment_outbox_revivals v where v.job_id = (pg_temp.trabajo('v1')).id), '9: la respuesta nombra esa fila');
select is(
  (select e.details ->> 'job_id' || '/' || (e.details ->> 'topic') || '/' || (e.details ->> 'previous_attempts') || '/' || (e.details ? 'reason')
     from public.payment_events e where e.payment_intent_id = pg_temp.iid('v1') and e.event_type = 'payment.outbox_job_revived'),
  (pg_temp.trabajo('v1')).id || '/payment/8/false', '9: y un evento en la historia del cobro, sin el texto del motivo');
select is(
  (select count(*)::integer from jsonb_object_keys((select to_jsonb(v) from public.payment_outbox_revivals v where v.job_id = (pg_temp.trabajo('v1')).id)) k
    where k ~ '(name|phone|email|address|contact|customer)'),
  0, '9: el rastro no tiene ninguna columna de datos del cliente');
select is(pg_temp.fila('v1') ->> 'can_revive_job' || '/' || coalesce(pg_temp.fila('v1') ->> 'dead_letter_job_id', 'null'), 'false/null',
  '9: reanimado, la lista deja de ofrecerlo');

-- Repetir no hace nada.
select pg_temp.como((select owner_id from caso where k = 'v1'));
select pg_temp.guardar('v1.revivir2', public.revive_payment_outbox_job((pg_temp.trabajo('v1')).id, 'otra vez por las dudas'));
select is(
  pg_temp.d('v1.revivir2') ->> 'ok' || '/' || (pg_temp.d('v1.revivir2') ->> 'action') || '/' || (pg_temp.d('v1.revivir2') ->> 'idempotent') || '/' || (pg_temp.d('v1.revivir2') ->> 'status'),
  'true/already_active/true/pending', '9: reanimar otra vez mientras esta en la cola contesta que ya esta activo');
select is(
  (select count(*)::integer from public.payment_outbox_revivals v where v.job_id = (pg_temp.trabajo('v1')).id) || '/' || pg_temp.eventos('v1', 'payment.outbox_job_revived')
    || '/' || (pg_temp.trabajo('v1')).attempts,
  '1/1/8', '9: sin otra fila de rastro, sin otro evento y sin tocar el trabajo');
select pg_temp.sin_identidad();

-- Un intento más, no una ronda nueva.
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-b', 100, 150)), 1, '9: el worker lo reclama una vez');
select is((select count(*)::integer from pg_temp.reclamar('pqr-worker-c', 100, 150)), 0, '9: y solo una');
select public.start_payment_outbox_job((pg_temp.trabajo('v1')).id, 'pqr-worker-b');
select is(public.fail_payment_outbox_job((pg_temp.trabajo('v1')).id, 'pqr-worker-b', 'provider_http_500'), 'dead_letter',
  '9: si vuelve a fallar vuelve a dead_letter de inmediato, sin otra ronda de reintentos');
select is((pg_temp.trabajo('v1')).attempts || '/' || (pg_temp.trabajo('v1')).last_error || '/' || (pg_temp.recibo('v1')).processing_status,
  '9/provider_http_500/dead_letter', '9: con el noveno intento contado y el motivo nuevo');
select pg_temp.como((select owner_id from caso where k = 'v1'));
select is(public.revive_payment_outbox_job((pg_temp.trabajo('v1')).id, 'segundo intento, ya con la cuenta reconectada') ->> 'action', 'revived',
  '9: se puede reanimar de nuevo: cada vez la decide una persona');
select pg_temp.sin_identidad();
select is(
  (select count(*)::integer || '/' || string_agg(v.previous_attempts || ':' || v.previous_last_error, ',' order by v.revived_at)
     from public.payment_outbox_revivals v where v.job_id = (pg_temp.trabajo('v1')).id),
  '2/8:provider_http_503,9:provider_http_500', '9: y el rastro guarda la historia de intentos de cada reanimacion');
-- Esta vez el proveedor responde: el worker asienta lo que leyó y termina.
select pg_temp.reclamar('pqr-worker-b', 100, 150);
select public.start_payment_outbox_job((pg_temp.trabajo('v1')).id, 'pqr-worker-b');
select pg_temp.asentar('v1.devuelto', 'v1', pg_temp.snapshot('v1', 'refunded', 'v1-devuelto', jsonb_build_object('refunded_amount', '3000.00')),
  'webhook', (pg_temp.recibo('v1')).id);
select is(public.complete_payment_outbox_job((pg_temp.trabajo('v1')).id, 'pqr-worker-b'), true, '9: el trabajo reanimado termina');
select is(
  (pg_temp.intent('v1')).internal_status || '/' || (pg_temp.intent('v1')).refunded_amount || '/' || (pg_temp.trabajo('v1')).status || '/' || (pg_temp.recibo('v1')).processing_status,
  'refunded/3000.00/completed/completed', '9: y el cobro por fin refleja el reembolso que habia quedado sin leer');
select pg_temp.como((select owner_id from caso where k = 'v1'));
select is(
  public.revive_payment_outbox_job((pg_temp.trabajo('v1')).id, 'ya no hace falta') ->> 'reason', 'job_not_dead_lettered',
  '9: un trabajo terminado no se reanima');
select pg_temp.sin_identidad();

-- Los temas que no se reaniman por acá.
select pg_temp.armar('v2', 10, 3);
select pg_temp.asentar('v2.aprobado', 'v2', pg_temp.snapshot('v2', 'approved', 'v2-aprobado'));
select pg_temp.finalizar('v2.fin', 'v2');
select pg_temp.como((select owner_id from caso where k = 'v2'));
create temporary table prep_v2 on commit drop as
  select public.prepare_payment_refund_v2(pg_temp.iid('v2'), 300, gen_random_uuid(), 'prueba de la cola') as r;
select pg_temp.sin_identidad();
select public.mark_payment_refund_ambiguous((select (r ->> 'refund_id')::uuid from prep_v2), pg_temp.huella('v2-dudoso'), 'network_or_timeout');
update public.payment_outbox set status = 'dead_letter', attempts = 8
 where refund_id = (select (r ->> 'refund_id')::uuid from prep_v2) and topic = 'refund_reconcile';
select pg_temp.como((select owner_id from caso where k = 'v2'));
select pg_temp.guardar('v2.revivir', public.revive_payment_outbox_job(
  (select o.id from public.payment_outbox o where o.refund_id = (select (r ->> 'refund_id')::uuid from prep_v2) and o.topic = 'refund_reconcile'), 'quiero reintentar el reembolso'));
select is(
  pg_temp.d('v2.revivir') ->> 'ok' || '/' || (pg_temp.d('v2.revivir') ->> 'reason') || '/' || (pg_temp.d('v2.revivir') ->> 'topic') || '/' || (pg_temp.d('v2.revivir') ->> 'action'),
  'false/topic_not_revivable/refund_reconcile/resolve_stuck_payment_refund',
  '9: la conciliacion de un reembolso no se reanima: la respuesta manda a destrabar el reembolso');
select is(
  (select o.status || '/' || o.attempts from public.payment_outbox o where o.refund_id = (select (r ->> 'refund_id')::uuid from prep_v2) and o.topic = 'refund_reconcile')
    || '/' || (select count(*)::integer from public.payment_outbox_revivals v where v.business_id = pg_temp.bid('v2')),
  'dead_letter/8/0', '9: el trabajo queda como estaba y sin rastro de reanimacion');
select is(public.resolve_stuck_payment_refund(pg_temp.iid('v2')) ->> 'reason', 'refund_request_in_flight',
  '9: y ese camino existe y contesta por ese reembolso');
select pg_temp.sin_identidad();
insert into public.payment_cancellations (id, payment_intent_id, status, requested_by)
values (pg_temp.uid('cancelacion-s1'), pg_temp.iid('s1'), 'ambiguous', (select owner_id from caso where k = 's1'));
insert into public.payment_outbox (id, payment_intent_id, cancellation_id, topic, resource_id, status, attempts, last_error)
values (pg_temp.uid('trabajo-cancelacion-s1'), pg_temp.iid('s1'), pg_temp.uid('cancelacion-s1'), 'cancellation_reconcile', pg_temp.pago('s1'), 'dead_letter', 8, 'provider_http_503');
select pg_temp.como((select owner_id from caso where k = 's1'));
select is(
  public.revive_payment_outbox_job(pg_temp.uid('trabajo-cancelacion-s1'), 'quiero saber si se cancelo') ->> 'reason' || '/'
    || (public.revive_payment_outbox_job(pg_temp.uid('trabajo-cancelacion-s1'), 'quiero saber si se cancelo') ->> 'action'),
  'topic_not_revivable/enqueue_payment_reconciliation', '9: la conciliacion de una cancelacion tampoco: manda a consultar el pago');
select is((select status from public.payment_outbox where id = pg_temp.uid('trabajo-cancelacion-s1')), 'dead_letter', '9: sin tocar el trabajo');
select pg_temp.sin_identidad();

-- La consulta de un pago (tema payment_reconcile), que sí tiene cobro.
select pg_temp.armar('v3', 10, 3);
select pg_temp.como((select owner_id from caso where k = 'v3'));
select pg_temp.guardar('v3.consulta', public.enqueue_payment_reconciliation(pg_temp.iid('v3')));
select pg_temp.sin_identidad();
select pg_temp.apartar_la_cola();
select pg_temp.matar((pg_temp.d('v3.consulta') ->> 'job_id')::uuid, 'provider_http_429');
select is((select status || '/' || attempts from public.payment_outbox where id = (pg_temp.d('v3.consulta') ->> 'job_id')::uuid), 'dead_letter/8',
  '9: control, la consulta de un pago en dead_letter');
select is((pg_temp.fila('v3') ->> 'dead_letter_job_id')::uuid, (pg_temp.d('v3.consulta') ->> 'job_id')::uuid, '9: la lista del Panel la muestra en su cobro');
select pg_temp.como((select owner_id from caso where k = 'v3'));
select is(public.revive_payment_outbox_job((pg_temp.d('v3.consulta') ->> 'job_id')::uuid, 'el cupo del proveedor se libero') ->> 'action', 'revived',
  '9: la consulta de un pago se reanima');
select is(
  (select status || '/' || attempts from public.payment_outbox where id = (pg_temp.d('v3.consulta') ->> 'job_id')::uuid)
    || '/' || pg_temp.eventos('v3', 'payment.outbox_job_revived'),
  'pending/8/1', '9: vuelve a la cola con su cuenta y deja el evento en el cobro');
-- Con otra consulta del mismo cobro ya en la cola, la caída no hace falta.
update public.payment_outbox set status = 'dead_letter' where id = (pg_temp.d('v3.consulta') ->> 'job_id')::uuid;
select pg_temp.guardar('v3.consulta2', public.enqueue_payment_reconciliation(pg_temp.iid('v3')));
select pg_temp.guardar('v3.revivir2', public.revive_payment_outbox_job((pg_temp.d('v3.consulta') ->> 'job_id')::uuid, 'por las dudas'));
select is(
  pg_temp.d('v3.revivir2') ->> 'action' || '/' || ((pg_temp.d('v3.revivir2') ->> 'job_id') = (pg_temp.d('v3.consulta2') ->> 'job_id'))
    || '/' || (select status from public.payment_outbox where id = (pg_temp.d('v3.consulta') ->> 'job_id')::uuid),
  'already_active/true/dead_letter', '9: si ya hay otra consulta de ese cobro en la cola, contesta esa y no reanima la caida');
select pg_temp.sin_identidad();

-- Un aviso recibido con credencial directa: el recibo no tiene comercio.
select pg_temp.armar('v4', 10, 3);
select pg_temp.asentar('v4.aprobado', 'v4', pg_temp.snapshot('v4', 'approved', 'v4-aprobado'));
select pg_temp.finalizar('v4.fin', 'v4');
select pg_temp.entregar('v4', pg_temp.pago('v4'), true, 'pqr-req-v4', 'v4');
select pg_temp.entregar('v5', 'pqr-PAY-de-nadie', true, 'pqr-req-v5', 'v5');
select pg_temp.apartar_la_cola();
update public.payment_outbox set status = 'dead_letter', attempts = 8, last_error = 'provider_http_503'
 where id in ((pg_temp.trabajo('v4')).id, (pg_temp.trabajo('v5')).id);
update public.payment_webhook_receipts set processing_status = 'dead_letter' where id in ((pg_temp.recibo('v4')).id, (pg_temp.recibo('v5')).id);
select is((pg_temp.recibo('v4')).seller_business_id, null, '9: control, un recibo de credencial directa no tiene comercio');
select is((pg_temp.fila('v4') ->> 'dead_letter_job_id')::uuid, (pg_temp.trabajo('v4')).id,
  '9: el Panel lo reconoce por el pago que ese cobro tiene guardado');
select pg_temp.como((select owner_id from caso where k = 'v4'));
select is(public.revive_payment_outbox_job((pg_temp.trabajo('v4')).id, 'credencial renovada') ->> 'action', 'revived',
  '9: y el dueno de ese cobro lo reanima');
select throws_ok(format('select public.revive_payment_outbox_job(%L, %L)', (pg_temp.trabajo('v5')).id, 'credencial renovada'),
  '42501', 'reanimacion no autorizada', '9: un aviso cuyo pago no es de ningun cobro conocido no tiene dueno que lo reanime');
select pg_temp.sin_identidad();
select is(
  (select v.business_id = pg_temp.bid('v4') and v.payment_intent_id = pg_temp.iid('v4') from public.payment_outbox_revivals v where v.job_id = (pg_temp.trabajo('v4')).id),
  true, '9: el rastro queda con el comercio y el cobro deducidos');

-- ══════════════════════════════════════════════════════════════════════════
--  10 · LA CONSULTA ANTES QUE EL AVISO, Y EL AVISO ANTES QUE LA CONSULTA
-- ══════════════════════════════════════════════════════════════════════════
-- La pantalla de estado lee el pago aprobado, lo asienta (origen reconciliation,
-- sin recibo) y arma el pedido. El aviso llega después.
select pg_temp.armar('c1', 10, 2);
select pg_temp.asentar('c1.consulta', 'c1', pg_temp.snapshot('c1', 'approved', 'c1-aprobado'), 'reconciliation', null);
select pg_temp.finalizar('c1.fin', 'c1');
select is(
  pg_temp.d('c1.consulta') ->> 'finalize_required' || '/' || (pg_temp.d('c1.fin') ->> 'ok') || '/' || pg_temp.pedidos('c1') || '/' || pg_temp.stock('c1') || '/' || pg_temp.reservas('c1'),
  'true/true/1/8/g1:converted:2', '10: la consulta asienta el aprobado y arma el pedido: 1 pedido, stock 10 - 2');
select pg_temp.guardar('c1.antes', jsonb_build_object('revision', (pg_temp.intent('c1')).revision, 'sesion', (pg_temp.sesion('c1')).revision,
  'eventos', (select count(*) from public.payment_events e where e.payment_intent_id = pg_temp.iid('c1')),
  'eventos_pedido', (select count(*) from public.order_events e where e.business_id = pg_temp.bid('c1'))));
select pg_temp.guardar('c1.aviso', public.mp_record_seller_webhook('test', pg_temp.evt('c1'), 'payment', pg_temp.pago('c1'),
  true, 'pqr-req-c1', pg_temp.huella('cuerpo-c1'), pg_temp.bid('c1')));
select pg_temp.apartar_la_cola();
select pg_temp.vencer_espera((pg_temp.trabajo('c1')).id);
select pg_temp.reclamar('pqr-worker-a', 100, 150);
select public.start_payment_outbox_job((pg_temp.trabajo('c1')).id, 'pqr-worker-a');
-- El worker relee el pago: el proveedor contesta lo mismo.
select pg_temp.asentar('c1.worker', 'c1', pg_temp.snapshot('c1', 'approved', 'c1-aprobado'), 'webhook', (pg_temp.recibo('c1')).id);
select is(
  pg_temp.d('c1.worker') ->> 'ok' || '/' || (pg_temp.d('c1.worker') ->> 'finalize_required') || '/' || (pg_temp.d('c1.worker') ->> 'internal_status'),
  'true/false/completed', '10: el trabajo del aviso encuentra el snapshot ya asentado: no pide finalizar');
select is(public.complete_payment_outbox_job((pg_temp.trabajo('c1')).id, 'pqr-worker-a'), true, '10: y termina');
select is(pg_temp.eventos('c1', 'payment.approved') || '/' || pg_temp.eventos('c1', 'payment.order_completed'), '1/1',
  '10: sin un segundo payment.approved ni un segundo payment.order_completed');
select is(
  (select count(*) from public.payment_events e where e.payment_intent_id = pg_temp.iid('c1'))::text || '/'
    || (select count(*) from public.payment_events e where e.webhook_receipt_id = (pg_temp.recibo('c1')).id)::text,
  (pg_temp.d('c1.antes') ->> 'eventos') || '/0', '10: ningun evento de pago nuevo, ni uno atado a ese recibo');
select is(pg_temp.pedidos('c1') || '/' || pg_temp.stock('c1') || '/' || pg_temp.reservas('c1'), '1/8/g1:converted:2',
  '10: sin un segundo pedido y sin otro efecto sobre el stock');
select is(
  (pg_temp.intent('c1')).revision || '/' || (pg_temp.sesion('c1')).revision || '/' || (select count(*) from public.order_events e where e.business_id = pg_temp.bid('c1')),
  (pg_temp.d('c1.antes') ->> 'revision') || '/' || (pg_temp.d('c1.antes') ->> 'sesion') || '/' || (pg_temp.d('c1.antes') ->> 'eventos_pedido'),
  '10: el cobro, la sesion y el pedido quedan sin una sola escritura');
select is((pg_temp.recibo('c1')).processing_status, 'completed', '10: el recibo queda completed');
-- Finalizar otra vez (el worker lo haría si el asiento lo pidiera) devuelve el mismo pedido.
select is(public.finalize_paid_checkout_session(pg_temp.sid('c1')) ->> 'idempotent', 'true',
  '10: y finalizar de nuevo devuelve el mismo pedido');
select is(pg_temp.pedidos('c1'), 1, '10: sigue habiendo uno');
-- Si el proveedor contesta otro cuerpo para el mismo pago y estado, es otra lectura:
-- queda su evento, pero ni pedido ni stock ni importe cambian.
select pg_temp.asentar('c1.otra_lectura', 'c1', pg_temp.snapshot('c1', 'approved', 'c1-aprobado-otro-cuerpo'), 'webhook', (pg_temp.recibo('c1')).id);
select is(
  pg_temp.d('c1.otra_lectura') ->> 'finalize_required' || '/' || pg_temp.eventos('c1', 'payment.approved') || '/' || pg_temp.pedidos('c1') || '/' || pg_temp.stock('c1')
    || '/' || (pg_temp.intent('c1')).paid_amount || '/' || (pg_temp.intent('c1')).internal_status,
  'false/2/1/8/2000.00/completed', '10: otra respuesta del proveedor para el mismo pago deja su evento y nada mas: 1 pedido, mismo stock, mismo importe');

-- Al revés: el aviso primero, la consulta después.
select pg_temp.armar('c2', 10, 2);
select pg_temp.guardar('c2.aviso', public.mp_record_seller_webhook('test', pg_temp.evt('c2'), 'payment', pg_temp.pago('c2'),
  true, 'pqr-req-c2', pg_temp.huella('cuerpo-c2'), pg_temp.bid('c2')));
select pg_temp.apartar_la_cola();
select pg_temp.vencer_espera((pg_temp.trabajo('c2')).id);
select pg_temp.reclamar('pqr-worker-a', 100, 150);
select public.start_payment_outbox_job((pg_temp.trabajo('c2')).id, 'pqr-worker-a');
select pg_temp.asentar('c2.worker', 'c2', pg_temp.snapshot('c2', 'approved', 'c2-aprobado'), 'webhook', (pg_temp.recibo('c2')).id);
select pg_temp.finalizar('c2.fin', 'c2');
select public.complete_payment_outbox_job((pg_temp.trabajo('c2')).id, 'pqr-worker-a');
select is(
  pg_temp.d('c2.worker') ->> 'finalize_required' || '/' || (pg_temp.d('c2.fin') ->> 'ok') || '/' || pg_temp.pedidos('c2') || '/' || pg_temp.stock('c2')
    || '/' || (select count(*) from public.payment_events e where e.webhook_receipt_id = (pg_temp.recibo('c2')).id and e.event_type = 'payment.approved'),
  'true/true/1/8/1', '10: el aviso asienta con su recibo y arma el pedido');
select pg_temp.guardar('c2.antes', jsonb_build_object('revision', (pg_temp.intent('c2')).revision, 'sesion', (pg_temp.sesion('c2')).revision,
  'eventos', (select count(*) from public.payment_events e where e.payment_intent_id = pg_temp.iid('c2'))));
select pg_temp.asentar('c2.consulta', 'c2', pg_temp.snapshot('c2', 'approved', 'c2-aprobado'), 'reconciliation', null);
select is(
  pg_temp.d('c2.consulta') ->> 'ok' || '/' || (pg_temp.d('c2.consulta') ->> 'finalize_required') || '/' || pg_temp.eventos('c2', 'payment.approved')
    || '/' || pg_temp.eventos('c2', 'payment.order_completed') || '/' || pg_temp.pedidos('c2') || '/' || pg_temp.stock('c2') || '/' || pg_temp.reservas('c2'),
  'true/false/1/1/1/8/g1:converted:2', '10: la consulta posterior no escribe otro evento, otro pedido ni toca el stock');
select is(
  (pg_temp.intent('c2')).revision || '/' || (pg_temp.sesion('c2')).revision || '/' || (select count(*) from public.payment_events e where e.payment_intent_id = pg_temp.iid('c2')),
  (pg_temp.d('c2.antes') ->> 'revision') || '/' || (pg_temp.d('c2.antes') ->> 'sesion') || '/' || (pg_temp.d('c2.antes') ->> 'eventos'),
  '10: ni sube una revision');

-- La consulta asienta, el pedido todavía no se armó (la finalización falló), y
-- llega el aviso: el trabajo vuelve a pedir la finalización pendiente.
select pg_temp.armar('c3', 10, 2);
select pg_temp.asentar('c3.consulta', 'c3', pg_temp.snapshot('c3', 'approved', 'c3-aprobado'), 'reconciliation', null);
select pg_temp.entregar('c3', pg_temp.pago('c3'), true, 'pqr-req-c3', 'c3');
select pg_temp.asentar('c3.worker', 'c3', pg_temp.snapshot('c3', 'approved', 'c3-aprobado'), 'webhook', (pg_temp.recibo('c3')).id);
select pg_temp.finalizar('c3.fin', 'c3');
select is(
  pg_temp.d('c3.worker') ->> 'finalize_required' || '/' || (pg_temp.d('c3.fin') ->> 'ok') || '/' || pg_temp.eventos('c3', 'payment.approved') || '/' || pg_temp.pedidos('c3') || '/' || pg_temp.stock('c3'),
  'true/true/1/1/8', '10: si el pedido habia quedado sin armar, el aviso lo completa: un evento, un pedido, un descuento');

-- ══════════════════════════════════════════════════════════════════════════
--  11 · `authorized` Y LOS SNAPSHOTS QUE NO COINCIDEN
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.armar('au', 10, 3);
select pg_temp.asentar('au.autorizado', 'au', pg_temp.snapshot('au', 'authorized', 'au-autorizado'));
select is(
  pg_temp.d('au.autorizado') ->> 'ok' || '/' || (pg_temp.d('au.autorizado') ->> 'internal_status') || '/' || (pg_temp.d('au.autorizado') ->> 'finalize_required')
    || '/' || (pg_temp.d('au.autorizado') ->> 'manual_review_required'),
  'true/in_process/false/false', '11: un pago authorized se asienta como en proceso: ni pedido ni revision');
select is(
  (pg_temp.sesion('au')).status || '/' || (pg_temp.intent('au')).internal_status || '/' || (pg_temp.intent('au')).provider_status
    || '/' || ((pg_temp.intent('au')).approved_at is null) || '/' || ((pg_temp.intent('au')).paid_amount is null),
  'payment_pending/in_process/authorized/true/true', '11: sesion payment_pending, cobro in_process, sin fecha de aprobacion ni importe cobrado');
select is(pg_temp.eventos('au', 'payment.authorized') || '/' || pg_temp.pedidos('au') || '/' || pg_temp.stock('au') || '/' || pg_temp.reservas('au'),
  '1/0/7/g1:active:3', '11: deja su evento, ningun pedido, y la reserva sigue activa');
select throws_ok(format('select public.finalize_paid_checkout_session(%L)', pg_temp.sid('au')), '55000', 'pago no aprobado verificadamente',
  '11: y la finalizacion se niega: authorized no es cobrado');
select is(
  pg_temp.fila('au') ->> 'can_cancel' || '/' || (pg_temp.fila('au') ->> 'can_refund') || '/' || (pg_temp.fila('au') ->> 'can_reconcile') || '/' || (pg_temp.fila('au') ->> 'can_recover_order'),
  'true/false/true/false', '11: el Panel ofrece cancelarlo o consultarlo, no reembolsarlo ni rearmar un pedido');
select pg_temp.asentar('au.capturado', 'au', pg_temp.snapshot('au', 'approved', 'au-aprobado'));
select pg_temp.finalizar('au.fin', 'au');
select is(pg_temp.d('au.capturado') ->> 'finalize_required' || '/' || (pg_temp.d('au.fin') ->> 'ok') || '/' || pg_temp.pedidos('au') || '/' || pg_temp.stock('au'),
  'true/true/1/7', '11: cuando ese pago se aprueba termina en un pedido, con el stock descontado una vez');

-- Lo que comparten los tres rechazos: sesión y cobro en revisión, sin pedido, la
-- reserva intacta y el pago sin asentar como identidad del cobro.
create function pg_temp.en_revision(p_k text) returns text language sql stable as $$
  select (pg_temp.sesion(p_k)).status || '/' || (pg_temp.sesion(p_k)).manual_review_reason || '/' || (pg_temp.intent(p_k)).internal_status
    || '/' || (pg_temp.intent(p_k)).security_review_reason || '/' || coalesce((pg_temp.intent(p_k)).provider_payment_id, 'sin-pago')
    || '/' || pg_temp.pedidos(p_k) || '/' || pg_temp.stock(p_k) || '/' || pg_temp.reservas(p_k)
$$;

select pg_temp.armar('er', 10, 3);
select pg_temp.armar('er2', 10, 3);
select pg_temp.asentar('er.ajena', 'er', pg_temp.snapshot('er', 'approved', 'er-ajena',
  jsonb_build_object('external_reference', (pg_temp.intent('er2')).external_reference)));
select is(
  pg_temp.d('er.ajena') ->> 'ok' || '/' || (pg_temp.d('er.ajena') ->> 'reason') || '/' || (pg_temp.d('er.ajena') ->> 'manual_review_required') || '/' || (pg_temp.d('er.ajena') ->> 'finalize_required'),
  'false/external_reference_mismatch/true/false', '11: un pago aprobado con la referencia de OTRO checkout se rechaza como external_reference_mismatch');
select is(pg_temp.en_revision('er'),
  'manual_review_required/external_reference_mismatch/security_review_required/external_reference_mismatch/sin-pago/0/7/g1:active:3',
  '11: sesion y cobro en revision con ese motivo, sin pedido, sin identidad de pago y con la reserva activa (stock retenido, no liberado)');
select is(
  (select e.details ->> 'reason' || '/' || (e.details ->> 'source') || '/' || e.provider_status from public.payment_events e
    where e.payment_intent_id = pg_temp.iid('er') and e.event_type = 'payment.security_review_required'),
  'external_reference_mismatch/webhook/approved', '11: queda el evento de revision con el motivo y el origen');
select is(
  (pg_temp.sesion('er2')).status || '/' || (pg_temp.intent('er2')).internal_status || '/' || coalesce((pg_temp.intent('er2')).provider_payment_id, 'sin-pago')
    || '/' || (select count(*) from public.payment_events e where e.payment_intent_id = pg_temp.iid('er2') and e.event_type like 'payment.%'),
  'redirected/preference_created/sin-pago/0', '11: el checkout cuya referencia se uso no se entera de nada');
select throws_ok(format('select public.finalize_paid_checkout_session(%L)', pg_temp.sid('er')), '55000', 'pago no aprobado verificadamente',
  '11: la finalizacion se niega sobre un cobro en revision');
select is(
  pg_temp.fila('er') ->> 'can_refund' || '/' || (pg_temp.fila('er') ->> 'can_recover_order') || '/' || (pg_temp.fila('er') ->> 'can_cancel') || '/' || (pg_temp.fila('er') ->> 'can_reconcile')
    || '/' || (pg_temp.fila('er') ->> 'security_review_reason'),
  'false/false/false/true/external_reference_mismatch', '11: el Panel muestra el motivo y solo ofrece consultar al proveedor');

select pg_temp.armar('cu', 10, 3);
select pg_temp.asentar('cu.dolares', 'cu', pg_temp.snapshot('cu', 'approved', 'cu-dolares', jsonb_build_object('currency', 'USD')));
select is(pg_temp.d('cu.dolares') ->> 'reason' || '/' || (pg_temp.d('cu.dolares') ->> 'manual_review_required'), 'currency_mismatch/true',
  '11: un pago en otra moneda se rechaza como currency_mismatch');
select is(pg_temp.en_revision('cu'),
  'manual_review_required/currency_mismatch/security_review_required/currency_mismatch/sin-pago/0/7/g1:active:3',
  '11: mismo final que con la referencia: revision, sin pedido, reserva activa');
select pg_temp.asentar('cu.vacia', 'cu', pg_temp.snapshot('cu', 'approved', 'cu-sin-moneda', jsonb_build_object('currency', '')));
select is(pg_temp.d('cu.vacia') ->> 'reason', 'currency_mismatch', '11: sin moneda tambien es currency_mismatch');

select pg_temp.armar('lm', 10, 3, 'production');
select is((pg_temp.intent('lm')).environment || '/' || (pg_temp.intent('lm')).live_mode, 'production/true', '11: control, un cobro del entorno production');
select pg_temp.asentar('lm.prueba', 'lm', pg_temp.snapshot('lm', 'approved', 'lm-prueba'));
select is(pg_temp.d('lm.prueba') ->> 'reason' || '/' || (pg_temp.d('lm.prueba') ->> 'manual_review_required'), 'live_mode_mismatch/true',
  '11: en production un pago que no es live_mode se rechaza como live_mode_mismatch');
select is(pg_temp.en_revision('lm'),
  'manual_review_required/live_mode_mismatch/security_review_required/live_mode_mismatch/sin-pago/0/7/g1:active:3',
  '11: y mismo final con el modo: revision, sin pedido, reserva activa');
select pg_temp.armar('lm2', 10, 3, 'production');
select pg_temp.asentar('lm2.real', 'lm2', pg_temp.snapshot('lm2', 'approved', 'lm2-real', jsonb_build_object('live_mode', true)));
select is(pg_temp.d('lm2.real') ->> 'finalize_required', 'true', '11: el mismo pago con live_mode verdadero se acepta');
select pg_temp.armar('lm3', 10, 3);
select pg_temp.asentar('lm3.prueba', 'lm3', pg_temp.snapshot('lm3', 'approved', 'lm3-real', jsonb_build_object('live_mode', true)));
select is(pg_temp.d('lm3.prueba') ->> 'finalize_required', 'true', '11: en test no se exige: un usuario de prueba informa live_mode verdadero');

-- La reserva de un cobro en revisión no la suelta el barrido: la decide una persona.
update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour'
 where id in (pg_temp.sid('er'), pg_temp.sid('cu'));
update public.inventory_reservations set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour'
 where checkout_session_id in (pg_temp.sid('er'), pg_temp.sid('cu'));
select pg_temp.barrer();
select is(pg_temp.stock('er') || '/' || pg_temp.reservas('er') || '/' || pg_temp.stock('cu') || '/' || pg_temp.reservas('cu'), '7/g1:active:3/7/g1:active:3',
  '11: vencida la sesion, el barrido no libera el stock de un cobro en revision');

-- ══════════════════════════════════════════════════════════════════════════
--  12 · UN PAGO DESCONOCIDO
-- ══════════════════════════════════════════════════════════════════════════
-- El worker lee el pago del aviso y busca el cobro por la referencia que trae.
select throws_ok(
  format($$select public.find_payment_intent_by_external_reference('test', %L)$$, 'taba2:checkout:' || gen_random_uuid()),
  'P0002', 'referencia de pago desconocida', '12: una referencia que no es de ningun checkout no encuentra cobro');
select throws_ok(
  format($$select public.find_payment_intent_by_external_reference('production', %L)$$, (pg_temp.intent('s1')).external_reference),
  'P0002', 'referencia de pago desconocida', '12: ni la de un checkout de otro entorno');
select throws_ok(
  $$select public.find_payment_intent_by_external_reference('test', 'cualquier-cosa-que-no-es-una-referencia')$$,
  'P0002', 'referencia de pago desconocida', '12: ni un texto cualquiera');
select is(
  (public.find_payment_intent_by_external_reference('test', (pg_temp.intent('s1')).external_reference) ->> 'payment_intent_id')::uuid,
  pg_temp.iid('s1'), '12: control, la referencia de un checkout propio si lo encuentra');
select throws_ok(
  format($$select public.record_mercadopago_payment_snapshot(%L, %L::jsonb, 'webhook', null)$$, gen_random_uuid(), pg_temp.snapshot('s1', 'approved', 'desconocido')::text),
  'P0002', 'payment intent inexistente', '12: asentar sobre un cobro que no existe se rechaza');

-- El rastro: el aviso se recibió, el trabajo falla con ese motivo y reintenta.
select pg_temp.guardar('u1.cobros', to_jsonb((select count(*) from public.payment_intents pi where pi.provider_payment_id = 'pqr-PAY-desconocido')));
select pg_temp.entregar('u1', 'pqr-PAY-desconocido', true, 'pqr-req-u1', 'u1');
select pg_temp.apartar_la_cola();
select pg_temp.vencer_espera((pg_temp.trabajo('u1')).id);
select pg_temp.reclamar('pqr-worker-a', 100, 150);
select public.start_payment_outbox_job((pg_temp.trabajo('u1')).id, 'pqr-worker-a');
select is(
  public.fail_payment_outbox_job((pg_temp.trabajo('u1')).id, 'pqr-worker-a', 'Provider_payment_does_not_match_a_checkout_session'),
  'retry_wait', '12: el trabajo de un pago que no es de ningun checkout falla y reintenta');
select is(
  (pg_temp.trabajo('u1')).last_error || '/' || (pg_temp.recibo('u1')).processing_status || '/' || (pg_temp.recibo('u1')).last_error,
  'Provider_payment_does_not_match_a_checkout_session/retry_wait/Provider_payment_does_not_match_a_checkout_session',
  '12: el motivo queda en el trabajo y en el recibo');
select is(
  (select count(*) from public.payment_intents pi where pi.provider_payment_id = 'pqr-PAY-desconocido')::text || '/'
    || (select count(*) from public.payment_events e where e.webhook_receipt_id = (pg_temp.recibo('u1')).id)::text
    || '/' || ((pg_temp.trabajo('u1')).payment_intent_id is null),
  (pg_temp.d('u1.cobros') #>> '{}') || '/0/true', '12: no se crea ningun cobro, ningun evento de pago, y el trabajo sigue sin cobro');
select pg_temp.matar((pg_temp.trabajo('u1')).id, 'Provider_payment_does_not_match_a_checkout_session');
select ok(
  (pg_temp.trabajo('u1')).status = 'dead_letter'
  and exists (select 1 from public.list_payment_outbox_operational_alerts() a where a.correlation_id = (pg_temp.trabajo('u1')).id and a.severity = 'critical'),
  '12: agotados los intentos queda en dead_letter y a la vista como alerta critica');
select is(
  (select count(*)::integer from caso c
    where exists (select 1 from public.payment_events e where e.payment_intent_id = c.intent_id and e.webhook_receipt_id = (pg_temp.recibo('u1')).id)),
  0, '12: y ningun cobro de los comercios de la prueba quedo tocado por ese aviso');

select * from finish();
rollback;
