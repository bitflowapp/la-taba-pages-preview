-- TABA · EL PEDIDO COBRADO POR MERCADO PAGO, SU REEMBOLSO Y SU CANCELACIÓN, DE PUNTA A PUNTA
--
-- Lo que hasta acá estaba «leído en la definición viva» y ahora tiene aserción:
--
--   1  contrato y privilegios
--   2  el camino real hasta el pedido: sesión, preferencia V2 con su autoridad, cobro
--      aprobado, finalización (lo que cubría la suite local `mercadopago_checkout_pro`)
--   3  LA CADENA sobre un mismo pedido con renglones y stock: cobrado -> no se
--      cancela -> reembolso total (preparar, identidad, respuesta) -> cancelar; el
--      stock vuelve una sola vez y cada producto vuelve a la venta sólo si el
--      comercio lo tenía en venta
--   4  lo que la base rechaza de un reembolso: `approved` sin identidad, una respuesta
--      contraria sobre un reembolso final, la clave de otro cobro, un segundo
--      reembolso total; y que un reembolso parcial no habilita cancelar el pedido
--   5  el aviso tardío de un reembolso: nuestra respuesta primero y el snapshot del
--      proveedor después, y al revés. Lo devuelto nunca baja, el estado sólo avanza,
--      y no aparece una segunda solicitud
--   6  el dinero devuelto por el PROVEEDOR sobre un cobro sin pedido devuelve el stock
--      solo, una vez (20261002021000); lo parcial, lo que tiene pedido y lo que nunca
--      se aprobó, no
--   7  lo que la lista de pagos le dice al Panel en cada estado
--   8  `can_refund` contesta exactamente lo que `prepare_payment_refund_v2` acepta,
--      estado por estado (20261002020000)
--   9  el seguimiento público del pedido cancelado: visible mientras dura la ventana
--      terminal, vacío después
--
-- La base del gate no está vacía: cada valor único lleva el nombre de este archivo y
-- ningún conteo mira una tabla entera.
-- No depende de la hora: los vencimientos se llevan al pasado a mano y la ventana
-- terminal del seguimiento se mueve en la fila.
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(202);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table negocio (b text primary key, business_id uuid, owner_id uuid, environment text) on commit drop;
create temporary table prod (b text, n text, product_id uuid, primary key (b, n)) on commit drop;
create temporary table caso (
  k text primary key, b text, business_id uuid, owner_id uuid, customer_id uuid,
  session_id uuid, intent_id uuid, payment_id text
) on commit drop;
create temporary table dato (k text primary key, v jsonb) on commit drop;

create function pg_temp.guardar(p_k text, p_v jsonb) returns void language sql as $$
  insert into dato values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.d(p_k text) returns jsonb language sql stable as $$ select v from dato where k = p_k $$;
create function pg_temp.huella(p_n text) returns text language sql immutable as $$
  select encode(digest('payment_refund_and_reversal_chain_test-' || p_n, 'sha256'), 'hex');
$$;
-- Un id de devolución del proveedor (numérico) que sólo puede ser de este archivo.
create function pg_temp.devolucion(p_n text) returns text language sql immutable as $$
  select (1000000000000 + ('x' || substr(pg_temp.huella('devolucion-' || p_n), 1, 10))::bit(40)::bigint)::text;
$$;

create function pg_temp.usuario(p_tag text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated','payment_refund_and_reversal_chain_test-' || p_tag || '-' || replace(v_id::text,'-','') || '@example.invalid','',now(),'{}','{}',now(),now());
  return v_id;
end $$;

-- Un comercio abierto, con su dueño (sesión registrada), el cobro habilitado y el
-- vendedor conectado. El guardián de admisión se apaga: acá no es lo que se prueba.
create function pg_temp.negocio(p_b text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('owner-' || p_b);
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values (
    v_business, 'TABA cadena de reembolso ' || p_b,
    'payment-refund-and-reversal-chain-test-' || p_b || '-' || right(replace(v_business::text,'-',''), 8),
    'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
  values (v_owner, v_owner, v_business, 'owner', 'panel_web');
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'payment_refund_and_reversal_chain_test-' || p_b, 'app-payment_refund_and_reversal_chain_test-' || p_b,
    clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business, 'test', 'payment_refund_and_reversal_chain_test-' || p_b, 'app-payment_refund_and_reversal_chain_test-' || p_b,
    'connected', 'ciphertext-only-local-fixture', now() + interval '2 days');
  insert into negocio values (p_b, v_business, v_owner, 'test');
end $$;

create function pg_temp.producto(p_b text, p_n text, p_stock integer) returns void language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  select v_id, n.business_id, 'Lata ' || p_n, 'Gaseosas', 'Cola', 1000, 'confirmed', true, 'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    p_stock, true, true, false, '{}', true, now(), n.owner_id,
    'payment_refund_and_reversal_chain_test-' || p_b || '-' || p_n, 'prc-' || p_b || '-' || p_n, 'commercial', 1
    from negocio n where n.b = p_b;
  insert into prod values (p_b, p_n, v_id);
end $$;
create function pg_temp.pid(p_b text, p_n text) returns uuid language sql stable as $$
  select product_id from prod where b = p_b and n = p_n
$$;

-- Un checkout de Mercado Pago del comercio p_b con los renglones p_items
-- ({"a": 3, "b": 2} = 3 del producto a y 2 del b). Con p_preferencia deja además la
-- preferencia asentada por V2: el comprador está en Checkout Pro.
create function pg_temp.checkout(p_k text, p_b text, p_items jsonb, p_preferencia boolean default true)
returns void language plpgsql as $$
declare
  v_business uuid := (select business_id from negocio where b = p_b);
  v_customer uuid := pg_temp.usuario('cliente-' || p_k);
  v_session uuid; v_prepare jsonb;
begin
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'prc-' || p_k || '-0001',
    'items', (select jsonb_agg(jsonb_build_object('product_id', pg_temp.pid(p_b, e.key), 'quantity', e.value::integer) order by e.key)
                from jsonb_each_text(p_items) e),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Zulma Cliente', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  if p_preferencia then
    v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
    perform public.record_mercadopago_preference_created_v2(
      v_business, 'test', v_session, v_customer, (v_prepare ->> 'payment_attempt_id')::uuid,
      public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer,
        (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
      'PREF-payment_refund_and_reversal_chain_test-' || p_k,
      'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=prc-' || p_k,
      'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=prc-' || p_k,
      pg_temp.huella('pref-' || p_k), 'req-prc-' || p_k);
  end if;
  insert into caso
  select p_k, p_b, v_business, n.owner_id, v_customer, v_session,
         (select id from public.payment_intents where checkout_session_id = v_session),
         'payment_refund_and_reversal_chain_test-PAY-' || p_k
    from negocio n where n.b = p_b;
end $$;
-- Lo de siempre: un comercio propio, un producto con p_stock y un checkout de p_qty.
create function pg_temp.armar(p_k text, p_stock integer default 10, p_qty integer default 3) returns void language plpgsql as $$
begin
  perform pg_temp.negocio(p_k);
  perform pg_temp.producto(p_k, 'a', p_stock);
  perform pg_temp.checkout(p_k, p_k, jsonb_build_object('a', p_qty));
end $$;

create function pg_temp.sid(p_k text) returns uuid language sql stable as $$ select session_id from caso where k = p_k $$;
create function pg_temp.iid(p_k text) returns uuid language sql stable as $$ select intent_id from caso where k = p_k $$;
create function pg_temp.bid(p_k text) returns uuid language sql stable as $$ select business_id from caso where k = p_k $$;
create function pg_temp.pago(p_k text) returns text language sql stable as $$ select payment_id from caso where k = p_k $$;
create function pg_temp.dueno(p_k text) returns uuid language sql stable as $$ select owner_id from caso where k = p_k $$;
create function pg_temp.cliente(p_k text) returns uuid language sql stable as $$ select customer_id from caso where k = p_k $$;

create function pg_temp.snapshot(p_k text, p_status text, p_semilla text, p_refunded numeric default 0, p_patch jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'provider_payment_id', c.payment_id,
    'external_reference', pi.external_reference,
    'preference_id', pi.preference_id, 'merchant_order_id', 'MO-prc-' || c.k,
    'collector_id', ps.collector_id, 'application_id', '', 'currency', 'ARS',
    'transaction_amount', pi.expected_amount::text, 'status', p_status,
    'status_detail', 'detalle_de_prueba', 'payment_method', 'visa', 'live_mode', false,
    'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', p_refunded::text,
    'payer_email_hash', repeat('e', 64),
    'raw_response_hash', pg_temp.huella('respuesta-' || p_semilla)) || p_patch
  from caso c
  join public.payment_intents pi on pi.id = c.intent_id
  join public.business_payment_settings ps on ps.business_id = c.business_id and ps.provider = 'mercadopago'
  where c.k = p_k;
$$;
-- Asienta una lectura del pago y guarda la respuesta como p_out (un error, como {"error": sqlstate}).
create function pg_temp.asentar(p_out text, p_k text, p_status text, p_semilla text, p_refunded numeric default 0,
  p_source text default 'webhook', p_patch jsonb default '{}'::jsonb)
returns void language plpgsql as $$
declare v jsonb;
begin
  begin
    v := public.record_mercadopago_payment_snapshot(pg_temp.iid(p_k), pg_temp.snapshot(p_k, p_status, p_semilla, p_refunded, p_patch), p_source, null);
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
-- Cobro aprobado y pedido creado.
create function pg_temp.con_pedido(p_k text, p_stock integer default 10, p_qty integer default 3) returns void language plpgsql as $$
begin
  perform pg_temp.armar(p_k, p_stock, p_qty);
  perform pg_temp.asentar(p_k || '.aprobado', p_k, 'approved', p_k || '-aprobado');
  perform pg_temp.finalizar(p_k || '.fin', p_k);
end $$;
-- Cobro aprobado después de vencida la reserva: en revisión, sin pedido, stock retenido.
create function pg_temp.en_revision(p_k text, p_stock integer default 10, p_qty integer default 3) returns void language plpgsql as $$
begin
  perform pg_temp.armar(p_k, p_stock, p_qty);
  perform pg_temp.envejecer(p_k, interval '20 seconds');
  perform pg_temp.asentar(p_k || '.aprobado', p_k, 'approved', p_k || '-aprobado');
end $$;
create function pg_temp.envejecer(p_k text, p_vencida interval) returns void language sql as $$
  with s as (
    update public.checkout_sessions
       set created_at = clock_timestamp() - p_vencida - interval '15 minutes',
           expires_at = clock_timestamp() - p_vencida
     where id = pg_temp.sid(p_k) returning id
  )
  update public.inventory_reservations
     set created_at = clock_timestamp() - p_vencida - interval '15 minutes',
         expires_at = clock_timestamp() - p_vencida
   where checkout_session_id = (select id from s) and status = 'active';
$$;

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
create function pg_temp.pedido(p_k text) returns public.orders language sql stable as $$
  select o from public.orders o where o.id = (select pi.order_id from public.payment_intents pi where pi.id = pg_temp.iid(p_k))
$$;
create function pg_temp.pedidos(p_k text) returns integer language sql stable as $$
  select count(*)::integer from public.orders o where o.business_id = pg_temp.bid(p_k)
$$;
create function pg_temp.stock(p_b text, p_n text default 'a') returns integer language sql stable as $$
  select p.stock from public.products p where p.id = pg_temp.pid(p_b, p_n)
$$;
create function pg_temp.en_venta(p_b text, p_n text default 'a') returns boolean language sql stable as $$
  select p.available from public.products p where p.id = pg_temp.pid(p_b, p_n)
$$;
create function pg_temp.reservas(p_k text) returns text language sql stable as $$
  select coalesce(string_agg(format('%s:%s:%s', pr.n, r.status, r.quantity), ' ' order by pr.n, r.reservation_generation), 'ninguna')
    from public.inventory_reservations r
    join caso c on c.session_id = r.checkout_session_id
    join prod pr on pr.product_id = r.product_id and pr.b = c.b
   where c.k = p_k
$$;
create function pg_temp.estado(p_k text) returns text language sql stable as $$
  select s.status || '/' || coalesce(s.manual_review_reason, '-') || ' ' || pi.internal_status || '/' || coalesce(pi.provider_status, '-')
           || ' ' || pi.refunded_amount
    from public.checkout_sessions s join public.payment_intents pi on pi.checkout_session_id = s.id
   where s.id = pg_temp.sid(p_k)
$$;
create function pg_temp.eventos(p_k text, p_type text) returns integer language sql stable as $$
  select count(*)::integer from public.payment_events e where e.payment_intent_id = pg_temp.iid(p_k) and e.event_type = p_type
$$;
create function pg_temp.solicitudes(p_k text) returns text language sql stable as $$
  select coalesce(string_agg(r.status || ':' || r.amount, ' ' order by r.requested_at, r.id), 'ninguna')
    from public.payment_refunds r where r.payment_intent_id = pg_temp.iid(p_k)
$$;
-- La fila de este cobro en la lista de pagos del Panel, como la ve p_actor (el dueño si no se dice).
create function pg_temp.fila(p_k text, p_actor uuid default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.como(coalesce(p_actor, pg_temp.dueno(p_k)));
  select value into v from public.list_business_payments(pg_temp.bid(p_k)) value
   where value ->> 'payment_intent_id' = pg_temp.iid(p_k)::text;
  perform pg_temp.sin_identidad();
  return v;
end $$;
-- Lo que el Panel puede hacer con ese cobro: reembolsar/cancelar/consultar/rearmar.
create function pg_temp.botones(p_k text) returns text language sql as $$
  select (f ->> 'can_refund') || '/' || (f ->> 'can_cancel') || '/' || (f ->> 'can_reconcile') || '/' || (f ->> 'can_recover_order')
    from (select pg_temp.fila(p_k) as f) x
$$;
-- El dueño pide un reembolso. Devuelve la respuesta de la base o {"error": sqlstate, "message": ...}.
create function pg_temp.pedir(p_k text, p_amount numeric, p_key uuid default null, p_actor uuid default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  begin
    perform pg_temp.como(coalesce(p_actor, pg_temp.dueno(p_k)));
    v := public.prepare_payment_refund_v2(pg_temp.iid(p_k), p_amount, coalesce(p_key, gen_random_uuid()), 'prueba de la cadena');
  exception when others then
    v := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  perform pg_temp.sin_identidad();
  return v;
end $$;
-- Lo que hace la Edge Function con la respuesta del proveedor: identidad primero, resultado después.
create function pg_temp.aprobar(p_k text, p_prep jsonb, p_n text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  begin
    perform public.record_payment_refund_identity((p_prep ->> 'refund_id')::uuid, pg_temp.iid(p_k),
      p_prep ->> 'provider_payment_id', (p_prep ->> 'idempotency_key')::uuid, pg_temp.devolucion(p_n));
    v := public.record_payment_refund_response_v2((p_prep ->> 'refund_id')::uuid, pg_temp.devolucion(p_n), 'approved',
      (p_prep ->> 'amount')::numeric, pg_temp.huella('respuesta-reembolso-' || p_n));
  exception when others then
    v := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  return v;
end $$;
-- Lo que contesta `prepare_payment_refund_v2` a un pedido NUEVO por el saldo, sin
-- dejarlo escrito: 'acepta' o el SQLSTATE del rechazo.
create function pg_temp.prepare_dice(p_k text, p_actor uuid default null) returns text language plpgsql as $$
begin
  begin
    perform pg_temp.como(coalesce(p_actor, pg_temp.dueno(p_k)));
    perform public.prepare_payment_refund_v2(pg_temp.iid(p_k), null, gen_random_uuid(), 'equivalencia');
    raise exception using errcode = 'P0WP1', message = 'accepted';
  exception
    when sqlstate 'P0WP1' then perform pg_temp.sin_identidad(); return 'acepta';
    when others then perform pg_temp.sin_identidad(); return sqlstate;
  end;
end $$;
create function pg_temp.codigo(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
--  1 · CONTRATO Y PRIVILEGIOS
-- ══════════════════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('authenticated', 'private.payment_refund_refusal(public.payment_intents)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.payment_refund_refusal(public.payment_intents)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.payment_refund_refusal(public.payment_intents)', 'EXECUTE')
  and not has_function_privilege('public', 'private.payment_refund_refusal(public.payment_intents)', 'EXECUTE'),
  '1: la regla del reembolso es privada: ningun rol la ejecuta por su cuenta');
-- Lo que la migración controla: el Panel autenticado sí, anon y public no. Lo que la
-- clave de servicio tenga sale de los privilegios por defecto del stack, como antes.
select ok(
  has_function_privilege('authenticated', 'public.list_business_payments(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_business_payments(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.list_business_payments(uuid)', 'EXECUTE'),
  '1: la lista de pagos conserva sus privilegios: el Panel autenticado si, anon y public no');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in (
      'public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)'::regprocedure,
      'public.finalize_paid_checkout_session(uuid)'::regprocedure,
      'public.record_payment_refund_identity(uuid,uuid,text,uuid,text)'::regprocedure,
      'public.record_payment_refund_response_v2(uuid,text,text,numeric,text)'::regprocedure,
      'public.mark_payment_refund_ambiguous(uuid,text,text)'::regprocedure,
      'public.create_checkout_session(uuid,jsonb)'::regprocedure,
      'public.get_mercadopago_payment_authority_v2(uuid,text,uuid,uuid,uuid)'::regprocedure,
      'public.record_mercadopago_preference_created_v2(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure)
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')),
  8, '1: crear la sesion, leer la autoridad, asentar la preferencia, el pago y el reembolso son solo del servicio');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in ('public.list_business_payments(uuid)'::regprocedure,
                    'public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)'::regprocedure)
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')),
  2, '1: la lista y el asiento siguen SECURITY DEFINER con search_path fijado');
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('public.payment_intents'::regclass, 'public.payment_refunds'::regclass, 'public.payment_events'::regclass,
                    'public.checkout_sessions'::regclass, 'public.inventory_reservations'::regclass)),
  '1: las tablas de pagos tienen RLS');
select is(
  (select count(*)::integer from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('payment_intents', 'payment_refunds', 'payment_events', 'payment_attempts', 'payment_webhook_receipts',
                           'payment_outbox', 'checkout_sessions', 'inventory_reservations')
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, '1: ningun rol de cliente escribe las tablas de pagos');

-- ══════════════════════════════════════════════════════════════════════════
--  2 · EL CAMINO REAL HASTA EL PEDIDO
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.negocio('g');
select pg_temp.producto('g', 'a', 3);
select pg_temp.producto('g', 'b', 10);
select pg_temp.checkout('g', 'g', '{"a": 3, "b": 2}'::jsonb, false);
select is(
  (pg_temp.sesion('g')).status || '/' || (pg_temp.sesion('g')).total || '/' || (pg_temp.intent('g')).internal_status || '/' || (pg_temp.intent('g')).expected_amount,
  'ready_for_payment/5000.00/created/5000.00', '2: la sesion queda lista para pagar con el total que calculo el servidor');
select is(pg_temp.stock('g', 'a') || '/' || pg_temp.stock('g', 'b') || ' ' || pg_temp.reservas('g'), '0/8 a:active:3 b:active:2',
  '2: la reserva descuenta el stock una vez: 3 de 3 y 2 de 10');
select is(pg_temp.en_venta('g', 'a') || '/' || pg_temp.en_venta('g', 'b'), 'false/true', '2: el producto que quedo en cero sale de la venta');
select is(pg_temp.pedidos('g'), 0, '2: no existe ningun pedido antes del pago');
select is(
  (public.create_checkout_session(pg_temp.cliente('g'), jsonb_build_object(
    'business_id', pg_temp.bid('g'), 'client_request_id', 'prc-g-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('g', 'a'), 'quantity', 3), jsonb_build_object('product_id', pg_temp.pid('g', 'b'), 'quantity', 2)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Zulma Cliente', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago')) ->> 'checkout_session_id')::uuid,
  pg_temp.sid('g'), '2: repetir el pedido de sesion con la misma clave devuelve la misma sesion');
select is(pg_temp.stock('g', 'a') || '/' || pg_temp.stock('g', 'b'), '0/8', '2: sin descontar otra vez');
select throws_ok(
  format($$select public.create_checkout_session(%L, %L::jsonb)$$, pg_temp.cliente('g'), jsonb_build_object(
    'business_id', pg_temp.bid('g'), 'client_request_id', 'prc-g-total-0002',
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid('g', 'b'), 'quantity', 1)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Zulma Cliente', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'payment_method', 'mercadopago', 'total', 1)::text),
  '22023', null, '2: un total enviado por el cliente se rechaza');

-- La preferencia: lo que se le manda a Mercado Pago sale de la sesión.
select pg_temp.guardar('g.prep', public.prepare_mercadopago_preference_v2(pg_temp.sid('g'), pg_temp.cliente('g'), false));
select is(
  jsonb_array_length(pg_temp.d('g.prep') -> 'items') || '/' || (pg_temp.d('g.prep') ->> 'currency') || '/' || (pg_temp.d('g.prep') ->> 'total')
    || '/' || (pg_temp.d('g.prep') ->> 'attempt_number') || '/' || ((pg_temp.d('g.prep') ->> 'external_reference') = 'taba2:checkout:' || pg_temp.sid('g')),
  '2/ARS/5000.00/1/true', '2: la preferencia lleva los dos renglones, pesos, el total del servidor y la referencia del checkout');
-- La autoridad con la que se asienta: quién cobra, si puede cobrar, y si el checkout vale.
create function pg_temp.autoridad(p_k text, p_business uuid default null, p_environment text default 'test', p_customer uuid default null)
returns jsonb language sql as $$
  select public.get_mercadopago_payment_authority_v2(coalesce(p_business, pg_temp.bid(p_k)), p_environment, pg_temp.sid(p_k),
    coalesce(p_customer, pg_temp.cliente(p_k)), (pg_temp.d(p_k || '.prep') ->> 'payment_attempt_id')::uuid);
$$;
select pg_temp.guardar('g.aut', pg_temp.autoridad('g'));
select is(
  pg_temp.d('g.aut') #>> '{checkout,reservation_valid}' || '/' || (pg_temp.d('g.aut') #>> '{checkout,business_open}') || '/' || (pg_temp.d('g.aut') #>> '{settings,enabled}')
    || '/' || (pg_temp.d('g.aut') #>> '{seller,status}'),
  'true/true/true/connected', '2: la autoridad dice reserva vigente, comercio abierto, cobro habilitado y vendedor conectado');
select ok(
  pg_temp.autoridad('g', p_environment => 'production') is null
  and pg_temp.autoridad('g', p_customer => gen_random_uuid()) is null
  and pg_temp.autoridad('g', p_business => gen_random_uuid()) is null,
  '2: la autoridad no cruza de entorno, de cliente ni de comercio');
update public.mp_seller_connections set environment = 'production' where business_id = pg_temp.bid('g');
select is(pg_temp.autoridad('g') -> 'seller', 'null'::jsonb, '2: sin un vendedor conectado en ese entorno la autoridad no inventa uno');
update public.mp_seller_connections set environment = 'test' where business_id = pg_temp.bid('g');
update public.business_payment_settings set enabled = false where business_id = pg_temp.bid('g');
select ok(
  pg_temp.autoridad('g') #>> '{settings,enabled}' = 'false' and pg_temp.autoridad('g') ->> 'authority_version' <> pg_temp.d('g.aut') ->> 'authority_version',
  '2: apagar el cobro del comercio cambia la autoridad');
select throws_ok(
  format($$select public.record_mercadopago_preference_created_v2(%L, 'test', %L, %L, %L, %L, 'PREF-prc-vieja', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=prc-vieja', null, %L, 'req-prc-vieja')$$,
    pg_temp.bid('g'), pg_temp.sid('g'), pg_temp.cliente('g'), pg_temp.d('g.prep') ->> 'payment_attempt_id', pg_temp.d('g.aut') ->> 'authority_version', pg_temp.huella('pref-vieja')),
  '55000', 'autoridad del intento cambio', '2: y una preferencia creada con la autoridad anterior no se asienta');
update public.business_payment_settings set enabled = true where business_id = pg_temp.bid('g');
select pg_temp.guardar('g.aut', pg_temp.autoridad('g'));
update public.businesses set status = 'closed' where id = pg_temp.bid('g');
select ok(
  pg_temp.autoridad('g') #>> '{business,status}' = 'closed' and pg_temp.autoridad('g') ->> 'authority_version' <> pg_temp.d('g.aut') ->> 'authority_version',
  '2: cerrar el comercio tambien');
update public.businesses set status = 'open' where id = pg_temp.bid('g');
select pg_temp.guardar('g.aut', pg_temp.autoridad('g'));
update public.mp_seller_connections set protected_tokens = 'otra-credencial-cifrada-de-prueba' where business_id = pg_temp.bid('g');
select ok(
  pg_temp.autoridad('g') #>> '{seller,generation}' = pg_temp.d('g.aut') #>> '{seller,generation}'
  and pg_temp.autoridad('g') ->> 'authority_version' <> pg_temp.d('g.aut') ->> 'authority_version',
  '2: rotar solo la credencial del vendedor cambia la autoridad aunque la generacion sea la misma');
select pg_temp.guardar('g.aut', pg_temp.autoridad('g'));
select lives_ok(
  format($$select public.record_mercadopago_preference_created_v2(%L, 'test', %L, %L, %L, %L, 'PREF-payment_refund_and_reversal_chain_test-g', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=prc-g', null, %L, 'req-prc-g')$$,
    pg_temp.bid('g'), pg_temp.sid('g'), pg_temp.cliente('g'), pg_temp.d('g.prep') ->> 'payment_attempt_id', pg_temp.d('g.aut') ->> 'authority_version', pg_temp.huella('pref-g')),
  '2: con la autoridad vigente la preferencia se asienta');
select is(
  (pg_temp.sesion('g')).status || '/' || (pg_temp.intent('g')).internal_status || '/' || (pg_temp.intent('g')).preference_id,
  'redirected/preference_created/PREF-payment_refund_and_reversal_chain_test-g', '2: sesion redirected, cobro con su preferencia');

-- El cobro aprobado y la finalización.
select pg_temp.asentar('g.aprobado', 'g', 'approved', 'g-aprobado');
select is(pg_temp.d('g.aprobado') ->> 'finalize_required' || '/' || (pg_temp.d('g.aprobado') ->> 'manual_review_required'), 'true/false',
  '2: el pago aprobado y verificado pide finalizar');
select pg_temp.finalizar('g.fin', 'g');
select is(pg_temp.d('g.fin') ->> 'ok' || '/' || (pg_temp.d('g.fin') ->> 'idempotent'), 'true/false', '2: la finalizacion crea el pedido');
select is(public.finalize_paid_checkout_session(pg_temp.sid('g')) ->> 'idempotent', 'true', '2: finalizar otra vez devuelve el mismo pedido');
select is(pg_temp.pedidos('g'), 1, '2: hay exactamente UN pedido');
select is(
  (pg_temp.pedido('g')).status || '/' || (pg_temp.pedido('g')).payment_method || '/' || (pg_temp.pedido('g')).total || '/' || (pg_temp.pedido('g')).fulfillment_type
    || '/' || ((pg_temp.pedido('g')).customer_user_id = pg_temp.cliente('g')) || '/' || ((pg_temp.pedido('g')).inventory_released_at is null),
  'received/mercadopago/5000.00/pickup/true/true', '2: recibido, de Mercado Pago, por el total, del cliente que pago');
select is(
  (select string_agg(pr.n || ':' || oi.quantity::integer || 'x' || oi.unit_price || '=' || oi.subtotal || ':' || oi.sku, ' ' order by pr.n)
     from public.order_items oi join prod pr on pr.product_id = oi.product_uuid and pr.b = 'g' where oi.order_id = (pg_temp.pedido('g')).id),
  'a:3x1000.00=3000.00:prc-g-a b:2x1000.00=2000.00:prc-g-b', '2: con sus dos renglones: cantidad, precio, subtotal y SKU congelados');
select is(pg_temp.stock('g', 'a') || '/' || pg_temp.stock('g', 'b') || ' ' || pg_temp.reservas('g'), '0/8 a:converted:3 b:converted:2',
  '2: la finalizacion convierte la reserva sin descontar otra vez');
select is(
  (pg_temp.intent('g')).internal_status || '/' || ((pg_temp.intent('g')).order_id is not null) || '/' || (pg_temp.intent('g')).paid_amount || '/' || (pg_temp.sesion('g')).status,
  'completed/true/5000.00/completed', '2: cobro y sesion completos, atados al pedido');
select is(
  pg_temp.eventos('g', 'payment.approved') || '/' || pg_temp.eventos('g', 'payment.order_completed') || '/'
    || (select count(*) from public.order_events e where e.order_id = (pg_temp.pedido('g')).id and e.event_type = 'order.received'),
  '1/1/1', '2: un payment.approved, un payment.order_completed y un order.received');

-- ══════════════════════════════════════════════════════════════════════════
--  3 · LA CADENA: COBRADO -> REEMBOLSO TOTAL -> CANCELACIÓN
-- ══════════════════════════════════════════════════════════════════════════
-- Mientras el pedido espera, el comercio saca de la venta el producto b.
update public.products set merchant_available = false, available = false where id = pg_temp.pid('g', 'b');
insert into public.order_public_tokens(order_id, token, token_hash, expires_at)
values ((pg_temp.pedido('g')).id, null, extensions.digest('payment_refund_and_reversal_chain_test-token-g', 'sha256'), clock_timestamp() + interval '30 days');

-- Con el dinero adentro el pedido no se cancela por ninguna puerta.
select pg_temp.como(pg_temp.dueno('g'));
select throws_ok(format($$select public.cancel_order(%L, %s, 'el cliente se arrepintio', 'prc-g-cancelar-0001')$$, (pg_temp.pedido('g')).id, (pg_temp.pedido('g')).revision),
  '55000', 'pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar', '3: el comercio no cancela un pedido cobrado sin devolver el dinero');
select throws_ok(format($$select public.transition_order(%L, %s, 'cancelled', 'prc-g-transicion-0001')$$, (pg_temp.pedido('g')).id, (pg_temp.pedido('g')).revision),
  '55000', 'pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos', '3: tampoco por la transicion generica');
select pg_temp.como(pg_temp.cliente('g'));
select is(
  pg_temp.codigo(format($$select public.cancel_own_order(%L, 'prc-g-cliente-0001', 'me arrepenti')$$, (pg_temp.pedido('g')).id)),
  '55000 pedido pagado por Mercado Pago: pedir la cancelacion al comercio, que gestiona el reembolso', '3: ni el cliente');
select pg_temp.sin_identidad();
select is((pg_temp.pedido('g')).status || '/' || pg_temp.stock('g', 'a') || '/' || pg_temp.stock('g', 'b'), 'received/0/8', '3: el pedido y el stock siguen igual');
select is(pg_temp.botones('g'), 'true/false/false/false', '3: el Panel ofrece reembolsar; ni cancelar el pago, ni consultarlo, ni rearmar');

-- El reembolso total: preparar, identidad, respuesta aprobada.
select pg_temp.guardar('g.prep_reembolso', pg_temp.pedir('g', null));
select is(
  pg_temp.d('g.prep_reembolso') ->> 'idempotent' || '/' || (pg_temp.d('g.prep_reembolso') ->> 'full_refund') || '/' || (pg_temp.d('g.prep_reembolso') ->> 'amount')
    || '/' || ((pg_temp.d('g.prep_reembolso') ->> 'provider_payment_id') = pg_temp.pago('g')),
  'false/true/5000.00/true', '3: el dueno prepara el reembolso total: 5000, contra el pago del pedido');
select is(
  (select r.status || '/' || r.amount || '/' || (r.order_id = (pg_temp.pedido('g')).id) || '/' || (r.requested_by = pg_temp.dueno('g')) || '/' || r.provider_payment_id
       || '/' || (r.provider_refund_id is null) || '/' || r.provider_attempts
     from public.payment_refunds r where r.id = (pg_temp.d('g.prep_reembolso') ->> 'refund_id')::uuid),
  'requested/5000.00/true/true/' || pg_temp.pago('g') || '/true/1', '3: queda UNA solicitud requested, del pedido, con quien la pidio y contra que pago sale');
select is((pg_temp.intent('g')).internal_status || '/' || (pg_temp.intent('g')).refunded_amount, 'completed/0.00', '3: preparar no mueve dinero');
select pg_temp.guardar('g.aprobacion', pg_temp.aprobar('g', pg_temp.d('g.prep_reembolso'), 'g-total'));
select is(pg_temp.d('g.aprobacion') ->> 'ok' || '/' || (pg_temp.d('g.aprobacion') ->> 'idempotent'), 'true/false', '3: la respuesta aprobada del proveedor se asienta');
select is(
  (pg_temp.intent('g')).internal_status || '/' || (pg_temp.intent('g')).refunded_amount || '/' || (pg_temp.intent('g')).paid_amount,
  'refunded/5000.00/5000.00', '3: el cobro queda refunded por el total');
select is(
  (select r.status || '/' || (r.provider_refund_id = pg_temp.devolucion('g-total')) || '/' || (r.completed_at is not null)
     from public.payment_refunds r where r.id = (pg_temp.d('g.prep_reembolso') ->> 'refund_id')::uuid) || '/' || pg_temp.solicitudes('g'),
  'approved/true/true/approved:5000.00', '3: la solicitud queda approved con la identidad del proveedor; es la unica');
select is(
  pg_temp.eventos('g', 'payment.refund_approved') || '/'
    || (select e.details ->> 'amount' from public.payment_events e where e.payment_intent_id = pg_temp.iid('g') and e.event_type = 'payment.refund_approved'),
  '1/5000.00', '3: un evento payment.refund_approved con el importe');
select is(
  public.record_payment_refund_response_v2((pg_temp.d('g.prep_reembolso') ->> 'refund_id')::uuid, pg_temp.devolucion('g-total'), 'approved', 5000,
    pg_temp.huella('respuesta-reembolso-g-total-repetida')) ->> 'idempotent',
  'true', '3: repetir la respuesta aprobada es idempotente');
select is(pg_temp.eventos('g', 'payment.refund_approved') || '/' || (pg_temp.intent('g')).refunded_amount, '1/5000.00', '3: sin otro evento ni otro importe');
-- El reembolso no cancela el pedido ni devuelve el stock: eso es de la cancelación.
select is(
  (pg_temp.pedido('g')).status || '/' || ((pg_temp.pedido('g')).inventory_released_at is null) || '/' || pg_temp.stock('g', 'a') || '/' || pg_temp.stock('g', 'b') || ' ' || pg_temp.reservas('g'),
  'received/true/0/8 a:converted:3 b:converted:2', '3: el reembolso no cancela el pedido ni devuelve stock');
select is(
  (select private.order_payment_state(o) || '/' || public.order_payment_is_financially_reversed(o.id) from public.orders o where o.id = (pg_temp.pedido('g')).id),
  'refunded/true', '3: el pago del pedido figura devuelto y revertido');
select is(pg_temp.botones('g') || ' ' || (pg_temp.fila('g') ->> 'latest_refund_status') || ' ' || (pg_temp.fila('g') ->> 'refunded_amount'),
  'false/false/false/false approved 5000.00', '3: el Panel ya no ofrece nada sobre ese cobro y muestra el reembolso');
select pg_temp.como(pg_temp.dueno('g'));
select throws_ok(format($$select public.transition_order(%L, %s, 'accepted', 'prc-g-avanzar-0001')$$, (pg_temp.pedido('g')).id, (pg_temp.pedido('g')).revision),
  '55000', 'pago revertido: el pedido solo admite cierre operativo', '3: con el dinero devuelto el pedido no avanza');

-- Ahora sí: cancelar.
select pg_temp.guardar('g.rev', to_jsonb((pg_temp.pedido('g')).revision));
select pg_temp.guardar('g.cancelar', public.cancel_order((pg_temp.pedido('g')).id, (pg_temp.pedido('g')).revision, 'reembolso total confirmado', 'prc-g-cancelar-0002'));
select pg_temp.sin_identidad();
select is(pg_temp.d('g.cancelar') ->> 'idempotent_no_op' || '/' || (pg_temp.d('g.cancelar') ->> 'idempotent_replay'), 'false/false', '3: con el reembolso total el comercio cancela el pedido');
select is(
  public.normalize_order_status_vocabulary((pg_temp.pedido('g')).status) || '/' || ((pg_temp.pedido('g')).inventory_released_at is not null)
    || '/' || (coalesce((pg_temp.pedido('g')).cancelled_at, (pg_temp.pedido('g')).canceled_at) is not null)
    || '/' || ((pg_temp.pedido('g')).revision = (pg_temp.d('g.rev') #>> '{}')::bigint + 1),
  'cancelled/true/true/true', '3: el pedido queda cancelado, con la devolucion de stock sellada y una sola revision mas');
select is(pg_temp.stock('g', 'a') || '/' || pg_temp.stock('g', 'b'), '3/10', '3: el stock vuelve exacto: 0 + 3 y 8 + 2');
select is(pg_temp.en_venta('g', 'a') || '/' || pg_temp.en_venta('g', 'b'), 'true/false',
  '3: el producto que el comercio tenia en venta vuelve a ofrecerse; el que oculto sigue oculto');
select is(
  (select count(*)::integer || '/' || min(e.metadata ->> 'inventory_released') from public.order_events e
    where e.order_id = (pg_temp.pedido('g')).id and e.event_type = 'order.status_changed'),
  '1/true', '3: un evento de cambio de estado que dice que el stock volvio');
select is(
  (select count(*)::integer || '/' || min(e.metadata ->> 'reason') from public.order_events e
    where e.order_id = (pg_temp.pedido('g')).id and e.event_type = 'business_cancel_reason')
    || '/' || (select count(*) from public.business_command_receipts r where r.order_id = (pg_temp.pedido('g')).id and r.command_type = 'cancel_order'),
  '1/reembolso total confirmado/1', '3: un motivo y un recibo del comando');
select is(pg_temp.reservas('g') || ' ' || (pg_temp.intent('g')).internal_status || ' ' || (pg_temp.sesion('g')).status,
  'a:converted:3 b:converted:2 refunded completed', '3: la reserva convertida, el cobro y la sesion no se tocan al cancelar');
-- Una sola vez.
select pg_temp.como(pg_temp.dueno('g'));
select is(
  public.cancel_order((pg_temp.pedido('g')).id, (pg_temp.pedido('g')).revision, 'lo cancelo otra vez', 'prc-g-cancelar-0003') ->> 'idempotent_no_op',
  'true', '3: cancelar otra vez no hace nada');
select pg_temp.sin_identidad();
select is(private.release_order_inventory((pg_temp.pedido('g')).id), 0, '3: la devolucion de stock llamada directo devuelve 0');
select is(
  pg_temp.stock('g', 'a') || '/' || pg_temp.stock('g', 'b') || ' '
    || (select count(*) from public.order_events e where e.order_id = (pg_temp.pedido('g')).id and e.event_type = 'business_cancel_reason'),
  '3/10 1', '3: el stock no vuelve dos veces ni queda un segundo motivo');
select is(pg_temp.pedidos('g') || '/' || pg_temp.solicitudes('g'), '1/approved:5000.00', '3: un pedido, un reembolso');

-- ══════════════════════════════════════════════════════════════════════════
--  4 · LO QUE LA BASE RECHAZA DE UN REEMBOLSO
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.con_pedido('f1');
select pg_temp.guardar('f1.prep', pg_temp.pedir('f1', 1000));
-- `approved` sin identidad del proveedor atada a la solicitud.
select throws_ok(
  format($$select public.record_payment_refund_response_v2(%L, %L, 'approved', 1000, %L)$$,
    pg_temp.d('f1.prep') ->> 'refund_id', pg_temp.devolucion('f1-a'), pg_temp.huella('f1-sin-identidad')),
  '23505', 'identidad de reembolso no confirmada', '4: un approved cuya identidad no se guardo antes se rechaza');
select throws_ok(
  format($$select public.record_payment_refund_response_v2(%L, '', 'approved', 1000, %L)$$,
    pg_temp.d('f1.prep') ->> 'refund_id', pg_temp.huella('f1-sin-identidad-2')),
  '23505', 'identidad de reembolso no confirmada', '4: y un approved sin ningun id de devolucion tambien');
select is(pg_temp.solicitudes('f1') || ' ' || (pg_temp.intent('f1')).refunded_amount || ' ' || pg_temp.eventos('f1', 'payment.refund_approved'),
  'requested:1000.00 0.00 0', '4: ninguno de los dos dejo dinero asentado');
select throws_ok(
  format($$select public.record_payment_refund_response_v2(%L, '', 'rejected', 999, %L)$$,
    pg_temp.d('f1.prep') ->> 'refund_id', pg_temp.huella('f1-otro-importe')),
  '22023', 'importe de reembolso no coincide', '4: una respuesta por otro importe se rechaza');
-- Con la identidad guardada, el approved pasa; una identidad distinta, no.
select is(
  public.record_payment_refund_identity((pg_temp.d('f1.prep') ->> 'refund_id')::uuid, pg_temp.iid('f1'), pg_temp.pago('f1'),
    (pg_temp.d('f1.prep') ->> 'idempotency_key')::uuid, pg_temp.devolucion('f1-a')),
  true, '4: la identidad se guarda');
select throws_ok(
  format($$select public.record_payment_refund_identity(%L, %L, %L, %L, %L)$$,
    pg_temp.d('f1.prep') ->> 'refund_id', pg_temp.iid('f1'), pg_temp.pago('f1'), pg_temp.d('f1.prep') ->> 'idempotency_key', pg_temp.devolucion('f1-otra')),
  '23505', 'identidad de reembolso no coincide', '4: y no se reemplaza por otra');
select throws_ok(
  format($$select public.record_payment_refund_response_v2(%L, %L, 'approved', 1000, %L)$$,
    pg_temp.d('f1.prep') ->> 'refund_id', pg_temp.devolucion('f1-otra'), pg_temp.huella('f1-identidad-ajena')),
  '23505', 'identidad de reembolso no confirmada', '4: un approved con un id distinto del guardado se rechaza');
select is(
  public.record_payment_refund_response_v2((pg_temp.d('f1.prep') ->> 'refund_id')::uuid, pg_temp.devolucion('f1-a'), 'approved', 1000, pg_temp.huella('f1-aprobado')) ->> 'idempotent',
  'false', '4: con la identidad correcta se asienta');
-- Final es final.
select throws_ok(
  format($$select public.record_payment_refund_response_v2(%L, %L, 'rejected', 1000, %L)$$,
    pg_temp.d('f1.prep') ->> 'refund_id', pg_temp.devolucion('f1-a'), pg_temp.huella('f1-contraria')),
  '55000', 'resultado de reembolso ya confirmado', '4: una respuesta contraria sobre un reembolso aprobado se rechaza');
select is(public.mark_payment_refund_ambiguous((pg_temp.d('f1.prep') ->> 'refund_id')::uuid, pg_temp.huella('f1-tarde'), 'late_response'), true,
  '4: marcarlo dudoso despues contesta sin error');
select is(pg_temp.solicitudes('f1') || ' ' || (pg_temp.intent('f1')).internal_status || ' ' || (pg_temp.intent('f1')).refunded_amount,
  'approved:1000.00 partially_refunded 1000.00', '4: y no lo degrada: sigue aprobado, cobro devuelto en parte');
select is(
  (select count(*)::integer from public.payment_outbox o where o.refund_id = (pg_temp.d('f1.prep') ->> 'refund_id')::uuid),
  0, '4: ni encola una conciliacion para algo ya resuelto');
-- La identidad de una devolución es de UNA solicitud.
select pg_temp.guardar('f1.prep2', pg_temp.pedir('f1', 500));
select throws_ok(
  format($$select public.record_payment_refund_identity(%L, %L, %L, %L, %L)$$,
    pg_temp.d('f1.prep2') ->> 'refund_id', pg_temp.iid('f1'), pg_temp.pago('f1'), pg_temp.d('f1.prep2') ->> 'idempotency_key', pg_temp.devolucion('f1-a')),
  '23505', null, '4: la identidad de una devolucion no se reutiliza en otra solicitud');
select throws_ok(
  format($$select public.record_payment_refund_identity(%L, %L, 'otro-pago', %L, %L)$$,
    pg_temp.d('f1.prep2') ->> 'refund_id', pg_temp.iid('f1'), pg_temp.d('f1.prep2') ->> 'idempotency_key', pg_temp.devolucion('f1-b')),
  '22023', 'pago del reembolso no coincide', '4: ni se ata a un pago que no es el del cobro');
select is(
  public.record_payment_refund_response_v2((pg_temp.d('f1.prep2') ->> 'refund_id')::uuid, '', 'rejected', 500, pg_temp.huella('f1-rechazado')) ->> 'ok',
  'true', '4: el rechazo explicito del proveedor se asienta sin identidad');
select throws_ok(
  format($$select public.record_payment_refund_response_v2(%L, '', 'ambiguous', 500, %L)$$,
    pg_temp.d('f1.prep2') ->> 'refund_id', pg_temp.huella('f1-rechazado-contraria')),
  '55000', 'resultado de reembolso ya confirmado', '4: y un rechazo tambien es final');
select is(pg_temp.solicitudes('f1') || ' ' || (pg_temp.intent('f1')).refunded_amount, 'approved:1000.00 rejected:500.00 1000.00',
  '4: el rechazo no movio dinero');

-- Un reembolso PARCIAL no habilita cancelar el pedido.
select is(
  (select private.order_payment_state(o) || '/' || public.order_payment_is_financially_reversed(o.id) from public.orders o where o.id = (pg_temp.pedido('f1')).id),
  'refunded/false', '4: con un reembolso parcial el pago figura devuelto pero NO revertido');
select pg_temp.como(pg_temp.dueno('f1'));
select throws_ok(format($$select public.cancel_order(%L, %s, 'devolvi una parte', 'prc-f1-cancelar-0001')$$, (pg_temp.pedido('f1')).id, (pg_temp.pedido('f1')).revision),
  '55000', 'pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar', '4: el comercio no cancela con un reembolso parcial');
select throws_ok(format($$select public.transition_order(%L, %s, 'rejected', 'prc-f1-rechazar-0001')$$, (pg_temp.pedido('f1')).id, (pg_temp.pedido('f1')).revision),
  '55000', 'pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos', '4: ni lo rechaza');
select lives_ok(format($$select public.transition_order(%L, %s, 'accepted', 'prc-f1-aceptar-0001')$$, (pg_temp.pedido('f1')).id, (pg_temp.pedido('f1')).revision),
  '4: y el pedido sigue su curso: se puede aceptar');
select pg_temp.sin_identidad();
select is(pg_temp.stock('f1') || ' ' || pg_temp.reservas('f1'), '7 a:converted:3', '4: el reembolso parcial no toco el stock');

-- La clave de idempotencia de un reembolso es de UN cobro.
select pg_temp.con_pedido('f2');
select pg_temp.guardar('f2.ajena', pg_temp.pedir('f2', 1000, (pg_temp.d('f1.prep') ->> 'idempotency_key')::uuid));
select is(pg_temp.d('f2.ajena') ->> 'error' || ' ' || (pg_temp.d('f2.ajena') ->> 'message'), '23505 idempotency key pertenece a otro reembolso',
  '4: la clave de idempotencia del reembolso de otro cobro se rechaza');
select is(pg_temp.solicitudes('f2'), 'ninguna', '4: sin crear ninguna solicitud');
-- La misma clave sobre su propio cobro devuelve la misma solicitud y nunca autoriza otro envío.
select pg_temp.guardar('f1.misma', pg_temp.pedir('f1', 1000, (pg_temp.d('f1.prep') ->> 'idempotency_key')::uuid));
select is(
  pg_temp.d('f1.misma') ->> 'idempotent' || '/' || (pg_temp.d('f1.misma') ->> 'reconciliation_required') || '/' || ((pg_temp.d('f1.misma') ->> 'refund_id') = (pg_temp.d('f1.prep') ->> 'refund_id')),
  'true/true/true', '4: la misma clave sobre su cobro devuelve la misma solicitud y pide conciliar, no enviar');

-- Un segundo reembolso total.
select pg_temp.guardar('f2.total', pg_temp.pedir('f2', null));
select pg_temp.guardar('f2.aprobacion', pg_temp.aprobar('f2', pg_temp.d('f2.total'), 'f2-total'));
select pg_temp.guardar('f2.segundo', pg_temp.pedir('f2', null));
select is(pg_temp.d('f2.segundo') ->> 'error' || ' ' || (pg_temp.d('f2.segundo') ->> 'message'), '55000 pago no reembolsable en su estado actual',
  '4: con pedido, un segundo reembolso total se rechaza: el cobro ya esta devuelto');
select is(pg_temp.pedir('f2', 1) ->> 'error', '55000', '4: y uno parcial tambien (con pedido)');
select is(pg_temp.solicitudes('f2') || ' ' || (pg_temp.intent('f2')).refunded_amount, 'approved:3000.00 3000.00', '4: una sola solicitud, un solo importe');
select pg_temp.en_revision('f3');
select pg_temp.guardar('f3.total', pg_temp.pedir('f3', null));
select pg_temp.guardar('f3.aprobacion', pg_temp.aprobar('f3', pg_temp.d('f3.total'), 'f3-total'));
select is(
  (pg_temp.intent('f3')).internal_status || '/' || (pg_temp.intent('f3')).refunded_amount || '/' || pg_temp.stock('f3') || '/' || pg_temp.reservas('f3'),
  'security_review_required/3000.00/10/a:released:3', '4: control, el reembolso total de un cobro en revision devuelve el stock');
select pg_temp.guardar('f3.segundo', pg_temp.pedir('f3', null));
select is(pg_temp.d('f3.segundo') ->> 'error' || ' ' || (pg_temp.d('f3.segundo') ->> 'message'), '22023 importe de reembolso invalido',
  '4: sin pedido, un segundo reembolso total se rechaza por importe: no queda saldo');
select is(pg_temp.pedir('f3', 1) ->> 'error', '22023', '4: y uno parcial tambien (sin pedido)');
select is(pg_temp.solicitudes('f3') || ' ' || (pg_temp.intent('f3')).refunded_amount || ' ' || pg_temp.stock('f3'), 'approved:3000.00 3000.00 10',
  '4: una sola solicitud, y el stock no vuelve otra vez');
-- Más que el saldo, o nada.
select pg_temp.con_pedido('f4');
select is(pg_temp.pedir('f4', 3000.01) ->> 'error' || '/' || (pg_temp.pedir('f4', 0) ->> 'error') || '/' || (pg_temp.pedir('f4', -5) ->> 'error'), '22023/22023/22023',
  '4: un importe mayor que el saldo, cero o negativo se rechaza');
-- Quién.
select is(pg_temp.pedir('f4', 100, null, pg_temp.cliente('f4')) ->> 'error' || '/' || (pg_temp.pedir('f4', 100, null, pg_temp.dueno('f2')) ->> 'error'), '42501/42501',
  '4: ni el cliente ni el dueno de otro comercio preparan un reembolso');
select is(pg_temp.solicitudes('f4'), 'ninguna', '4: ninguno de los rechazos dejo una solicitud');

-- ══════════════════════════════════════════════════════════════════════════
--  5 · EL AVISO TARDÍO DE UN REEMBOLSO
-- ══════════════════════════════════════════════════════════════════════════
-- Nuestra respuesta primero, el snapshot del proveedor después (total).
select pg_temp.con_pedido('h1');
select pg_temp.guardar('h1.prep', pg_temp.pedir('h1', null));
select pg_temp.guardar('h1.aprobacion', pg_temp.aprobar('h1', pg_temp.d('h1.prep'), 'h1-total'));
select pg_temp.guardar('h1.antes', to_jsonb(pg_temp.estado('h1')));
select pg_temp.asentar('h1.aviso', 'h1', 'refunded', 'h1-devuelto', 3000);
select is(pg_temp.d('h1.aviso') ->> 'ok' || '/' || (pg_temp.d('h1.aviso') ->> 'internal_status') || '/' || (pg_temp.d('h1.aviso') ->> 'finalize_required'), 'true/refunded/false',
  '5: el aviso del proveedor que llega despues de nuestra respuesta se asienta');
select is(pg_temp.estado('h1'), 'completed/- refunded/refunded 3000.00', '5: el importe devuelto no sube ni baja y el estado sigue refunded');
select is(pg_temp.solicitudes('h1') || ' ' || pg_temp.eventos('h1', 'payment.refund_approved') || ' ' || pg_temp.eventos('h1', 'payment.refunded'),
  'approved:3000.00 1 1', '5: no aparece otra solicitud ni otro evento de reembolso; queda el evento de la lectura');
select pg_temp.asentar('h1.aviso2', 'h1', 'refunded', 'h1-devuelto', 3000);
select is(pg_temp.eventos('h1', 'payment.refunded') || ' ' || pg_temp.estado('h1'), '1 completed/- refunded/refunded 3000.00', '5: el mismo aviso repetido no escribe nada');
select is(pg_temp.stock('h1') || ' ' || pg_temp.reservas('h1') || ' ' || (pg_temp.pedido('h1')).status, '7 a:converted:3 received',
  '5: ni el reembolso ni su aviso tocan el stock de un cobro con pedido, ni cancelan el pedido');

-- Nuestra respuesta primero (parcial), el aviso después, y un aviso viejo al final.
select pg_temp.con_pedido('h2');
select pg_temp.guardar('h2.prep', pg_temp.pedir('h2', 1000));
select pg_temp.guardar('h2.aprobacion', pg_temp.aprobar('h2', pg_temp.d('h2.prep'), 'h2-parcial'));
select pg_temp.asentar('h2.aviso', 'h2', 'approved', 'h2-con-1000', 1000);
select is(pg_temp.estado('h2') || ' ' || pg_temp.solicitudes('h2'), 'completed/- partially_refunded/approved 1000.00 approved:1000.00',
  '5: parcial: el aviso posterior confirma los 1000 sin sumarlos de nuevo');
select pg_temp.asentar('h2.viejo', 'h2', 'approved', 'h2-sin-devolucion', 0,
  'webhook', jsonb_build_object('provider_occurred_at', (clock_timestamp() - interval '2 hours')::text));
select is(pg_temp.d('h2.viejo') ->> 'ok' || ' ' || pg_temp.estado('h2'), 'true completed/- partially_refunded/approved 1000.00',
  '5: un aviso viejo, de antes del reembolso, no baja lo devuelto ni retrocede el estado');
select is(pg_temp.solicitudes('h2') || ' ' || pg_temp.pedidos('h2'), 'approved:1000.00 1', '5: ni crea solicitudes ni pedidos');

-- Al revés: el aviso del proveedor primero, nuestra respuesta después.
select pg_temp.con_pedido('h3');
select pg_temp.guardar('h3.prep', pg_temp.pedir('h3', 1000));
select pg_temp.asentar('h3.aviso', 'h3', 'approved', 'h3-con-1000', 1000);
select is(pg_temp.estado('h3') || ' ' || pg_temp.solicitudes('h3'), 'completed/- partially_refunded/approved 1000.00 requested:1000.00',
  '5: el aviso llega antes: el cobro ya figura devuelto en parte y la solicitud sigue pedida');
select pg_temp.guardar('h3.aprobacion', pg_temp.aprobar('h3', pg_temp.d('h3.prep'), 'h3-parcial'));
select is(pg_temp.d('h3.aprobacion') ->> 'ok', 'true', '5: asentar despues nuestra respuesta aprobada no falla');
select is(pg_temp.estado('h3') || ' ' || pg_temp.solicitudes('h3'), 'completed/- partially_refunded/approved 1000.00 approved:1000.00',
  '5: y no cuenta el importe dos veces: 1000, no 2000');
select pg_temp.con_pedido('h4');
select pg_temp.guardar('h4.prep', pg_temp.pedir('h4', null));
select pg_temp.asentar('h4.aviso', 'h4', 'refunded', 'h4-devuelto', 3000);
select is(pg_temp.estado('h4') || ' ' || pg_temp.solicitudes('h4'), 'completed/- refunded/refunded 3000.00 requested:3000.00',
  '5: total: el aviso llega antes y el cobro ya figura refunded');
select pg_temp.guardar('h4.aprobacion', pg_temp.aprobar('h4', pg_temp.d('h4.prep'), 'h4-total'));
select is(
  pg_temp.d('h4.aprobacion') ->> 'ok' || ' ' || pg_temp.estado('h4') || ' ' || pg_temp.solicitudes('h4') || ' ' || pg_temp.eventos('h4', 'payment.refund_approved'),
  'true completed/- refunded/refunded 3000.00 approved:3000.00 1', '5: nuestra respuesta posterior cierra la solicitud sin retroceder el estado ni duplicar nada');
select pg_temp.como(pg_temp.dueno('h4'));
select lives_ok(format($$select public.cancel_order(%L, %s, 'devuelto en Mercado Pago', 'prc-h4-cancelar-0001')$$, (pg_temp.pedido('h4')).id, (pg_temp.pedido('h4')).revision),
  '5: y el pedido se puede cancelar: el dinero volvio entero');
select pg_temp.sin_identidad();
select is(pg_temp.stock('h4'), 10, '5: con el stock de vuelta, una vez');
-- Un reembolso hecho en Mercado Pago sin ninguna solicitud nuestra.
select pg_temp.con_pedido('h5');
select pg_temp.asentar('h5.aviso', 'h5', 'refunded', 'h5-devuelto', 3000);
select is(pg_temp.estado('h5') || ' ' || pg_temp.solicitudes('h5') || ' ' || public.order_payment_is_financially_reversed((pg_temp.pedido('h5')).id),
  'completed/- refunded/refunded 3000.00 ninguna true', '5: una devolucion hecha en Mercado Pago deja el cobro refunded sin inventar una solicitud local');
select is(pg_temp.botones('h5'), 'false/false/false/false', '5: y el Panel no ofrece reembolsar lo que ya volvio');

-- ══════════════════════════════════════════════════════════════════════════
--  6 · EL DINERO DEVUELTO POR EL PROVEEDOR, SIN PEDIDO
-- ══════════════════════════════════════════════════════════════════════════
-- En revisión manual, y la devolución se hace en Mercado Pago.
select pg_temp.en_revision('x1', 4, 4);
select is(pg_temp.estado('x1') || ' ' || pg_temp.stock('x1') || ' ' || pg_temp.reservas('x1') || ' ' || pg_temp.en_venta('x1'),
  'manual_review_required/approved_after_reservation_expired security_review_required/approved 0.00 0 a:active:4 false',
  '6: control, cobro en revision reteniendo las ultimas 4 unidades');
select pg_temp.asentar('x1.devuelto', 'x1', 'refunded', 'x1-devuelto', 4000);
select is(pg_temp.d('x1.devuelto') ->> 'ok', 'true', '6: el aviso de la devolucion se asienta');
select is(pg_temp.stock('x1') || ' ' || pg_temp.reservas('x1') || ' ' || pg_temp.en_venta('x1'), '4 a:released:4 true',
  '6: el stock vuelve solo y el producto vuelve a la venta');
select is(
  (select r.release_reason from public.inventory_reservations r where r.checkout_session_id = pg_temp.sid('x1')),
  'provider_refunded_without_order', '6: con el motivo de la devolucion del proveedor');
select is(
  (select count(*)::integer || '/' || min(e.details ->> 'released') || '/' || min(e.details ->> 'attested_by_support') from public.payment_events e
    where e.payment_intent_id = pg_temp.iid('x1') and e.event_type = 'payment.manual_review_stock_released'),
  '1/1/false', '6: un evento de liberacion, sin atestacion de soporte');
select is(pg_temp.estado('x1'), 'manual_review_required/approved_after_reservation_expired security_review_required/refunded 4000.00',
  '6: la sesion sigue en revision: no admite otra preferencia sobre dinero devuelto');
select pg_temp.asentar('x1.devuelto2', 'x1', 'refunded', 'x1-devuelto', 4000);
select pg_temp.asentar('x1.devuelto3', 'x1', 'refunded', 'x1-devuelto-otro-cuerpo', 4000);
select pg_temp.guardar('x1.repetida', public.release_manual_review_checkout_inventory(pg_temp.iid('x1'), 'repetida', false));
select is(
  pg_temp.stock('x1') || ' ' || pg_temp.eventos('x1', 'payment.manual_review_stock_released') || ' ' || (pg_temp.d('x1.repetida') ->> 'released'),
  '4 1 0', '6: el mismo aviso otra vez, otra lectura y la liberacion directa: el stock no vuelve dos veces');
select is(public.can_recover_paid_checkout(pg_temp.iid('x1')) || ' ' || pg_temp.botones('x1') || ' ' || pg_temp.pedidos('x1'), 'false false/false/true/false 0',
  '6: sobre ese dinero no se rearma un pedido ni se ofrece otro reembolso');
select is(
  pg_temp.codigo(format($$select set_config('request.jwt.claims', %L, true); select public.recover_paid_checkout_order(%L)$$,
    json_build_object('sub', pg_temp.dueno('x1'), 'role', 'authenticated', 'session_id', pg_temp.dueno('x1'))::text, pg_temp.sid('x1'))) like '55000 %',
  true, '6: y el rearmado llamado directo se niega');
select pg_temp.sin_identidad();

-- El proveedor sigue diciendo `approved`, con todo el importe devuelto.
select pg_temp.en_revision('x2');
select pg_temp.asentar('x2.devuelto', 'x2', 'approved', 'x2-con-todo-devuelto', 3000);
select is(pg_temp.estado('x2') || ' ' || pg_temp.stock('x2') || ' ' || pg_temp.reservas('x2'),
  'manual_review_required/approved_after_reservation_expired security_review_required/approved 3000.00 10 a:released:3',
  '6: approved con el total devuelto tambien libera');
-- Un contracargo que llega como estado del pago.
select pg_temp.en_revision('x3');
select pg_temp.asentar('x3.contracargo', 'x3', 'charged_back', 'x3-contracargo');
select is(pg_temp.estado('x3') || ' ' || pg_temp.stock('x3') || ' ' || pg_temp.reservas('x3'),
  'manual_review_required/approved_after_reservation_expired security_review_required/charged_back 0.00 10 a:released:3',
  '6: un contracargo tambien libera');
select is((select r.release_reason from public.inventory_reservations r where r.checkout_session_id = pg_temp.sid('x3')), 'provider_charged_back_without_order',
  '6: con su motivo');

-- Lo que NO libera.
select pg_temp.en_revision('x4');
select pg_temp.asentar('x4.parcial', 'x4', 'approved', 'x4-con-1000', 1000);
select is(pg_temp.estado('x4') || ' ' || pg_temp.stock('x4') || ' ' || pg_temp.reservas('x4'),
  'manual_review_required/approved_after_reservation_expired security_review_required/approved 1000.00 7 a:active:3',
  '6: una devolucion PARCIAL del proveedor no libera nada');
select pg_temp.asentar('x4.resto', 'x4', 'approved', 'x4-con-3000', 3000);
select is(pg_temp.stock('x4') || ' ' || pg_temp.reservas('x4'), '10 a:released:3', '6: cuando el proveedor informa el total devuelto, recien ahi vuelve, una vez');

select pg_temp.armar('x5');
select pg_temp.asentar('x5.invalido', 'x5', 'approved', 'x5-otro-importe', 0, 'webhook', jsonb_build_object('transaction_amount', '1.00'));
select pg_temp.asentar('x5.rechazado', 'x5', 'rejected', 'x5-rechazado');
select pg_temp.asentar('x5.cancelado', 'x5', 'cancelled', 'x5-cancelado');
select pg_temp.asentar('x5.vencido', 'x5', 'expired', 'x5-vencido');
select is(pg_temp.d('x5.invalido') ->> 'reason' || ' ' || (pg_temp.sesion('x5')).status || ' ' || pg_temp.stock('x5') || ' ' || pg_temp.reservas('x5'),
  'amount_mismatch manual_review_required 7 a:active:3',
  '6: un pago que el proveedor cerro sin haberlo aprobado nunca no libera solo el stock de una sesion en revision');
select is(pg_temp.eventos('x5', 'payment.manual_review_stock_released'), 0, '6: sin evento de liberacion');
select pg_temp.envejecer('x5', interval '10 minutes');
select is(
  (select a.action from public.list_stock_reservation_alerts() a where a.checkout_session_id = pg_temp.sid('x5')),
  'run_release_manual_review_checkout_inventory_for_the_payment_intent', '6: eso sigue siendo de soporte: la alerta receta la liberacion del servicio');
select is(public.release_manual_review_checkout_inventory(pg_temp.iid('x5'), 'verificado por soporte', false) ->> 'released', '1', '6: que sigue funcionando');

select pg_temp.con_pedido('x6');
select pg_temp.asentar('x6.devuelto', 'x6', 'refunded', 'x6-devuelto', 3000);
select is(
  pg_temp.estado('x6') || ' ' || pg_temp.stock('x6') || ' ' || pg_temp.reservas('x6') || ' ' || (pg_temp.pedido('x6')).status || ' ' || pg_temp.eventos('x6', 'payment.manual_review_stock_released'),
  'completed/- refunded/refunded 3000.00 7 a:converted:3 received 0',
  '6: con pedido, la devolucion del proveedor no toca la sesion ni el stock: eso lo decide la cancelacion del pedido');

-- Un segundo pago del mismo checkout devuelto no es el dinero de este cobro.
select pg_temp.en_revision('x7');
select pg_temp.asentar('x7.duplicado', 'x7', 'refunded', 'x7-duplicado-devuelto', 3000, 'webhook',
  jsonb_build_object('provider_payment_id', 'payment_refund_and_reversal_chain_test-PAY-x7-duplicado'));
select is(
  pg_temp.d('x7.duplicado') ->> 'secondary_payment' || ' ' || pg_temp.estado('x7') || ' ' || pg_temp.stock('x7') || ' ' || pg_temp.reservas('x7'),
  'true manual_review_required/approved_after_reservation_expired security_review_required/approved 0.00 7 a:active:3',
  '6: la devolucion de OTRO pago del mismo checkout no libera el stock del cobro');

-- Un pago que estuvo aprobado y después figura cancelado en el proveedor, sin
-- ningún importe devuelto: la base no da ese dinero por devuelto, así que el aviso
-- no libera. Lo verifica soporte en Mercado Pago y lo atestigua.
select pg_temp.en_revision('x8');
select pg_temp.asentar('x8.cancelado', 'x8', 'cancelled', 'x8-cancelado');
select is(pg_temp.estado('x8') || ' ' || pg_temp.stock('x8') || ' ' || pg_temp.reservas('x8'),
  'manual_review_required/approved_after_reservation_expired security_review_required/cancelled 0.00 7 a:active:3',
  '6: un pago aprobado que despues figura cancelado, sin importe devuelto, no libera el stock por su cuenta');
select is(public.release_manual_review_checkout_inventory(pg_temp.iid('x8'), 'sin atestar', false) ->> 'reason', 'money_not_returned',
  '6: y la liberacion del servicio tampoco lo da por devuelto sin atestacion');
select pg_temp.guardar('x8.atestada', public.release_manual_review_checkout_inventory(pg_temp.iid('x8'), 'soporte lo verifico en Mercado Pago', true));
select is(pg_temp.d('x8.atestada') ->> 'released' || ' ' || pg_temp.stock('x8') || ' ' || pg_temp.reservas('x8'), '1 10 a:released:3',
  '6: con la atestacion de soporte, si: ese sigue siendo el camino para lo que la base no puede saber sola');

-- Pagado a tiempo, sin finalizar, y el dinero vuelve antes de que exista el pedido.
select pg_temp.armar('y1', 4, 4);
select pg_temp.asentar('y1.aprobado', 'y1', 'approved', 'y1-aprobado');
select is(pg_temp.estado('y1') || ' ' || pg_temp.stock('y1') || ' ' || pg_temp.reservas('y1'), 'payment_approved/- approved_order_pending/approved 0.00 0 a:active:4',
  '6: control, cobro aprobado a tiempo que todavia no se finalizo');
select pg_temp.asentar('y1.devuelto', 'y1', 'refunded', 'y1-devuelto', 4000);
select is(pg_temp.estado('y1'), 'manual_review_required/money_returned_before_order refunded/refunded 4000.00',
  '6: el dinero vuelve antes del pedido: la sesion pasa a revision con su motivo y el cobro queda refunded');
select is(pg_temp.stock('y1') || ' ' || pg_temp.reservas('y1') || ' ' || pg_temp.en_venta('y1'), '4 a:released:4 true', '6: y el stock vuelve, en vez de quedar retenido para siempre');
select pg_temp.finalizar('y1.fin', 'y1');
select is(pg_temp.d('y1.fin') ->> 'error' || ' ' || (pg_temp.d('y1.fin') ->> 'message') || ' ' || pg_temp.pedidos('y1'), '55000 pago no aprobado verificadamente 0',
  '6: la finalizacion tardia no arma un pedido sobre dinero devuelto');
select pg_temp.asentar('y1.aprobado_viejo', 'y1', 'approved', 'y1-aprobado');
select is(pg_temp.estado('y1') || ' ' || pg_temp.stock('y1') || ' ' || pg_temp.pedidos('y1'), 'manual_review_required/money_returned_before_order refunded/refunded 4000.00 4 0',
  '6: releer el aprobado viejo no revive el cobro ni vuelve a reservar');
select is(
  pg_temp.codigo(format($$select public.prepare_mercadopago_preference_v2(%L, %L, true)$$, pg_temp.sid('y1'), pg_temp.cliente('y1'))),
  '55000 checkout no admite otra preferencia', '6: ni se puede pedir otra preferencia sobre ese checkout');
select pg_temp.armar('y2');
select pg_temp.asentar('y2.aprobado', 'y2', 'approved', 'y2-aprobado');
update public.checkout_sessions set status = 'finalizing_order' where id = pg_temp.sid('y2');
select pg_temp.asentar('y2.contracargo', 'y2', 'charged_back', 'y2-contracargo');
select is(pg_temp.estado('y2') || ' ' || pg_temp.stock('y2') || ' ' || pg_temp.reservas('y2'),
  'manual_review_required/money_returned_before_order charged_back/charged_back 0.00 10 a:released:3',
  '6: lo mismo si la sesion habia quedado a medio finalizar, y con un contracargo');
select pg_temp.armar('y3');
select pg_temp.asentar('y3.aprobado', 'y3', 'approved', 'y3-aprobado');
select pg_temp.asentar('y3.parcial', 'y3', 'approved', 'y3-con-1000', 1000);
select is(pg_temp.estado('y3') || ' ' || pg_temp.stock('y3') || ' ' || pg_temp.reservas('y3'), 'payment_approved/- partially_refunded/approved 1000.00 7 a:active:3',
  '6: una devolucion parcial antes del pedido no cambia la sesion ni libera');
-- Una sesión todavía pagable no se toca: su stock lo devuelve el vencimiento.
select pg_temp.armar('y4');
select pg_temp.asentar('y4.devuelto', 'y4', 'refunded', 'y4-devuelto', 3000);
select is((pg_temp.sesion('y4')).status || ' ' || pg_temp.stock('y4') || ' ' || pg_temp.reservas('y4'), 'redirected 7 a:active:3',
  '6: una sesion que todavia no estaba pagada no pasa a revision: su reserva la devuelve el vencimiento');
select pg_temp.envejecer('y4', interval '1 minute');
select pg_temp.barrer();
select is((pg_temp.sesion('y4')).status || ' ' || pg_temp.stock('y4') || ' ' || pg_temp.reservas('y4'), 'expired 10 a:released:3', '6: y el barrido la libera como siempre');

-- ══════════════════════════════════════════════════════════════════════════
--  7 · LO QUE LA LISTA DE PAGOS LE DICE AL PANEL
-- ══════════════════════════════════════════════════════════════════════════
-- botones = reembolsar / cancelar el pago / consultar al proveedor / rearmar el pedido.
create function pg_temp.resumen(p_k text) returns text language sql as $$
  select (f ->> 'internal_status') || ' ' || coalesce(f ->> 'provider_status', '-') || ' ' || (f ->> 'reservation_state')
           || ' ' || coalesce(f ->> 'latest_refund_status', '-') || ' ' || (f ->> 'refunded_amount')
           || ' | ' || (f ->> 'can_refund') || '/' || (f ->> 'can_cancel') || '/' || (f ->> 'can_reconcile') || '/' || (f ->> 'can_recover_order')
    from (select pg_temp.fila(p_k) as f) x
$$;
select pg_temp.armar('p1');
select is(pg_temp.resumen('p1'), 'preference_created - active - 0.00 | false/false/true/false',
  '7: checkout con preferencia y sin pago: solo se puede consultar al proveedor');
select pg_temp.asentar('p1.pendiente', 'p1', 'pending', 'p1-pendiente');
select is(pg_temp.resumen('p1'), 'pending pending active - 0.00 | false/true/true/false', '7: pago pendiente: se puede cancelar o consultar');
select pg_temp.asentar('p1.rechazado', 'p1', 'rejected', 'p1-rechazado');
select is(pg_temp.resumen('p1'), 'rejected rejected active - 0.00 | false/false/true/false', '7: pago rechazado: solo consultar; la reserva sigue activa para el reintento');
select pg_temp.envejecer('p1', interval '1 minute');
select pg_temp.guardar('p1.eventos', to_jsonb((select count(*) from public.payment_events e where e.payment_intent_id = pg_temp.iid('p1'))));
select pg_temp.barrer();
select is(pg_temp.resumen('p1'), 'expired rejected expired - 0.00 | false/false/true/false', '7: checkout vencido: reserva vencida, solo consultar');
select is(
  (select r.release_reason from public.inventory_reservations r where r.checkout_session_id = pg_temp.sid('p1')) || ' ' || pg_temp.stock('p1')
    || ' ' || ((select count(*) from public.payment_events e where e.payment_intent_id = pg_temp.iid('p1')) - (pg_temp.d('p1.eventos') #>> '{}')::bigint),
  'checkout_expired 10 0', '7: el vencimiento devuelve el stock con su motivo en la reserva y no escribe ningun evento de pago');

-- Un checkout que se cancela antes de pagar: la reserva vuelve una vez aunque la liberación se pida dos veces.
select pg_temp.armar('p0');
select pg_temp.guardar('p0.1', public.release_checkout_session_inventory(pg_temp.sid('p0'), 'prueba de la cadena', 'cancelled'));
select pg_temp.guardar('p0.2', public.release_checkout_session_inventory(pg_temp.sid('p0'), 'prueba de la cadena otra vez', 'cancelled'));
select is(
  (pg_temp.d('p0.1') ->> 'released') || '/' || (pg_temp.d('p0.2') ->> 'released') || '/' || pg_temp.stock('p0') || '/' || pg_temp.reservas('p0')
    || '/' || (pg_temp.sesion('p0')).status || '/' || (pg_temp.intent('p0')).internal_status,
  '1/0/10/a:released:3/cancelled/cancelled', '7: liberar dos veces la reserva de un checkout sin pagar devuelve el stock una sola vez');
select is(pg_temp.resumen('p0'), 'cancelled - none - 0.00 | false/false/true/false', '7: checkout cancelado antes de pagar: sin reserva, solo consultar');
select is(pg_temp.resumen('f4'), 'completed approved none - 0.00 | true/false/false/false', '7: cobro con pedido: se puede reembolsar');
select is(pg_temp.resumen('f1'), 'partially_refunded approved none rejected 1000.00 | true/false/false/false',
  '7: devuelto en parte: se puede reembolsar el resto; muestra el estado de la ultima solicitud');
select is(pg_temp.resumen('f2'), 'refunded approved none approved 3000.00 | false/false/false/false', '7: devuelto entero: nada que hacer');
select pg_temp.en_revision('p2');
select is(pg_temp.resumen('p2'), 'security_review_required approved expired - 0.00 | true/false/true/true',
  '7: aprobado con la reserva vencida: reembolsar, consultar o rearmar el pedido');
select is(pg_temp.fila('p2') ->> 'security_review_reason', 'approved_after_reservation_expired', '7: con el motivo de la revision');
select pg_temp.guardar('p2.prep', pg_temp.pedir('p2', 1000));
select is(pg_temp.resumen('p2'), 'security_review_required approved expired requested 0.00 | true/false/true/false',
  '7: con un reembolso pedido ya no se ofrece rearmar; pedir otro contesta con la solicitud en curso');
select is(pg_temp.pedir('p2', null) ->> 'reconciliation_required', 'true', '7: que es lo que la base hace: devuelve la solicitud y no envia nada');
select is(pg_temp.resumen('f3'), 'security_review_required approved expired approved 3000.00 | false/false/true/false',
  '7: en revision y devuelto entero: ya no se ofrece reembolsar ni rearmar');
select is(pg_temp.resumen('x5'), 'security_review_required expired expired - 0.00 | false/false/true/false',
  '7: en revision sin cobro verificado: solo consultar');

-- Un contracargo abierto (credencial directa: el worker asienta la disputa).
select pg_temp.con_pedido('p3');
select public.record_mercadopago_dispute_snapshot(pg_temp.iid('p3'), 'chargeback', jsonb_build_object(
  'provider_dispute_id', 'payment_refund_and_reversal_chain_test-cb-p3', 'provider_payment_id', pg_temp.pago('p3'), 'status', 'opened',
  'documentation_required', true, 'raw_response_hash', pg_temp.huella('disputa-p3')));
select is(pg_temp.resumen('p3') || ' ' || (pg_temp.fila('p3') ->> 'dispute_type') || ' ' || (pg_temp.fila('p3') ->> 'documentation_required'),
  'charged_back approved none - 0.00 | false/false/false/false chargeback true', '7: con un contracargo abierto no se ofrece nada y se muestra la disputa');
select pg_temp.con_pedido('p4');
select public.record_mercadopago_dispute_snapshot(pg_temp.iid('p4'), 'claim', jsonb_build_object(
  'provider_dispute_id', 'payment_refund_and_reversal_chain_test-claim-p4', 'provider_payment_id', pg_temp.pago('p4'), 'status', 'opened',
  'raw_response_hash', pg_temp.huella('disputa-p4')));
select is(pg_temp.resumen('p4') || ' ' || (pg_temp.fila('p4') ->> 'dispute_type'), 'completed approved none - 0.00 | true/false/false/false claim',
  '7: con un reclamo abierto el reembolso se ofrece: es lo que la base acepta, y devolver el dinero es como se resuelve');

-- Quién ve qué.
create temporary table equipo on commit drop as select pg_temp.usuario('staff-f4') as staff, pg_temp.usuario('admin-f4') as admin;
insert into public.business_members (business_id, user_id, role, is_active)
select pg_temp.bid('f4'), staff, 'staff', true from equipo union all select pg_temp.bid('f4'), admin, 'admin', true from equipo;
insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
select staff, staff, pg_temp.bid('f4'), 'staff', 'panel_web' from equipo union all select admin, admin, pg_temp.bid('f4'), 'admin', 'panel_web' from equipo;
select is(
  pg_temp.fila('f4', (select staff from equipo)) ->> 'can_operate' || '/' || (pg_temp.fila('f4', (select staff from equipo)) ->> 'can_refund')
    || '/' || (pg_temp.fila('f4', (select staff from equipo)) ->> 'can_reconcile') || '/' || (pg_temp.fila('f4', (select staff from equipo)) ->> 'can_revive_job'),
  'false/false/false/false', '7: un empleado ve la lista y no puede operar nada');
select is(pg_temp.prepare_dice('f4', (select staff from equipo)), '42501', '7: y la base tampoco le acepta el reembolso');
select is(
  pg_temp.fila('f4', (select admin from equipo)) ->> 'can_operate' || '/' || (pg_temp.fila('f4', (select admin from equipo)) ->> 'can_refund') || '/' || pg_temp.prepare_dice('f4', (select admin from equipo)),
  'true/true/acepta', '7: el encargado opera igual que el dueno');
select pg_temp.como(pg_temp.cliente('f4'));
select throws_ok(format('select * from public.list_business_payments(%L)', pg_temp.bid('f4')), '42501', 'pagos no autorizados', '7: el cliente no lista los pagos del comercio');
select pg_temp.como(pg_temp.dueno('f2'));
select throws_ok(format('select * from public.list_business_payments(%L)', pg_temp.bid('f4')), '42501', 'pagos no autorizados', '7: ni el dueno de otro comercio');
select pg_temp.sin_identidad();
select throws_ok(format('select * from public.list_business_payments(%L)', pg_temp.bid('f4')), '42501', 'pagos no autorizados', '7: ni nadie sin identidad');
select is(
  pg_temp.fila('f4') ->> 'customer_label' || ' ' || (pg_temp.fila('f4') ->> 'payment_id_short') || ' ' || (pg_temp.fila('f4') ->> 'amount') || ' ' || (pg_temp.fila('f4') ->> 'currency')
    || ' ' || ((pg_temp.fila('f4') ->> 'order_public_code') = (pg_temp.pedido('f4')).public_code),
  'Z… PAY-f4 3000.00 ARS true', '7: la fila lleva la inicial del cliente, el final del id del pago, el importe y el codigo del pedido');
select is(
  (select count(*)::integer from jsonb_each_text(pg_temp.fila('f4')) e
    where e.value like '%Zulma%' or e.value like '%5492990000000%' or e.value like '%@%' or e.value = pg_temp.pago('f4')),
  0, '7: y ningun dato del cliente ni el id completo del pago');

-- ══════════════════════════════════════════════════════════════════════════
--  8 · can_refund = LO QUE prepare_payment_refund_v2 ACEPTA, ESTADO POR ESTADO
-- ══════════════════════════════════════════════════════════════════════════
-- Un comercio con un pedido real y una celda por combinación. Cada celda es un
-- cobro propio llevado a mano al estado que se quiere medir; la respuesta de la
-- base es la de `prepare_payment_refund_v2` a un pedido nuevo por el saldo.
select pg_temp.negocio('m');
select pg_temp.producto('m', 'a', 500);
select pg_temp.checkout('m-pedido', 'm', '{"a": 1}'::jsonb);
select pg_temp.asentar('m-pedido.aprobado', 'm-pedido', 'approved', 'm-pedido-aprobado');
select pg_temp.finalizar('m-pedido.fin', 'm-pedido');
create temporary table celda (k text primary key, n integer generated always as identity, panel text, base text) on commit drop;
-- p_cobro: columnas del cobro que se fuerzan (jsonb). `order` = true lo ata al pedido real.
create function pg_temp.celda(p_k text, p_status text, p_con_pedido boolean, p_cobro jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.checkout(p_k, 'm', '{"a": 1}'::jsonb, false);
  update public.payment_intents pi
     set internal_status = p_status,
         order_id = case when p_con_pedido then (pg_temp.pedido('m-pedido')).id end,
         provider_payment_id = case when coalesce((p_cobro ->> 'sin_pago')::boolean, false) then null else pg_temp.pago(p_k) end,
         provider_status = coalesce(p_cobro ->> 'provider_status', 'approved'),
         paid_amount = case when p_cobro ? 'paid_amount' then (p_cobro ->> 'paid_amount')::numeric else pi.expected_amount end,
         refunded_amount = coalesce((p_cobro ->> 'refunded_amount')::numeric, 0),
         security_review_reason = p_cobro ->> 'security_review_reason'
   where pi.id = pg_temp.iid(p_k);
  if p_cobro ? 'provider_status_null' then
    update public.payment_intents set provider_status = null where id = pg_temp.iid(p_k);
  end if;
end $$;
create function pg_temp.medir(p_k text) returns text language plpgsql as $$
declare v_panel text; v_base text;
begin
  v_panel := pg_temp.fila(p_k) ->> 'can_refund';
  v_base := pg_temp.prepare_dice(p_k);
  insert into celda (k, panel, base) values (p_k, v_panel, v_base)
  on conflict (k) do update set panel = excluded.panel, base = excluded.base;
  return v_panel || '/' || v_base;
end $$;

-- Los dieciocho estados de un cobro, con pedido y sin pedido.
select pg_temp.celda('m-' || s.status || '-con', s.status, true), pg_temp.celda('m-' || s.status || '-sin', s.status, false)
  from unnest(array['created', 'preference_creating', 'ambiguous', 'preference_created', 'redirected', 'pending', 'in_process',
    'rejected', 'cancelled', 'expired', 'failed', 'approved', 'approved_order_pending', 'completed', 'partially_refunded',
    'refunded', 'charged_back', 'security_review_required']) s(status);
select is(
  (select count(distinct pi.internal_status)::integer from caso c join public.payment_intents pi on pi.id = c.intent_id where c.b = 'm'),
  (select count(*)::integer from regexp_matches(
     (select pg_get_constraintdef(oid) from pg_constraint where conname = 'payment_intents_status_check'), '''[a-z_]+''::text', 'g')),
  '8: la matriz cubre TODOS los estados que la tabla admite');
select is(pg_temp.medir('m-completed-con'), 'true/acepta', '8: completed con pedido: se ofrece y se acepta');
select is(pg_temp.medir('m-partially_refunded-con'), 'true/acepta', '8: partially_refunded con pedido: se ofrece y se acepta');
select is(
  (select string_agg(s.status || '=' || pg_temp.medir('m-' || s.status || '-con'), ' ' order by s.o)
     from unnest(array['created', 'preference_creating', 'ambiguous', 'preference_created', 'redirected', 'pending', 'in_process',
       'rejected', 'cancelled', 'expired', 'failed', 'approved', 'approved_order_pending', 'refunded', 'charged_back']) with ordinality s(status, o)),
  'created=false/55000 preference_creating=false/55000 ambiguous=false/55000 preference_created=false/55000 redirected=false/55000 pending=false/55000 in_process=false/55000 rejected=false/55000 cancelled=false/55000 expired=false/55000 failed=false/55000 approved=false/55000 approved_order_pending=false/55000 refunded=false/55000 charged_back=false/55000',
  '8: con pedido, ningun otro estado se ofrece ni se acepta');
select is(pg_temp.medir('m-security_review_required-con'), 'false/55000', '8: en revision CON pedido tampoco');
select is(
  (select string_agg(s.status || '=' || pg_temp.medir('m-' || s.status || '-sin'), ' ' order by s.o)
     from unnest(array['created', 'preference_creating', 'ambiguous', 'preference_created', 'redirected', 'pending', 'in_process',
       'rejected', 'cancelled', 'expired', 'failed', 'approved', 'approved_order_pending', 'completed', 'partially_refunded',
       'refunded', 'charged_back']) with ordinality s(status, o)),
  'created=false/55000 preference_creating=false/55000 ambiguous=false/55000 preference_created=false/55000 redirected=false/55000 pending=false/55000 in_process=false/55000 rejected=false/55000 cancelled=false/55000 expired=false/55000 failed=false/55000 approved=false/55000 approved_order_pending=false/55000 completed=false/55000 partially_refunded=false/55000 refunded=false/55000 charged_back=false/55000',
  '8: sin pedido, fuera de la revision, ninguno');
select is(pg_temp.medir('m-security_review_required-sin'), 'true/acepta',
  '8: en revision sin pedido, aprobado por el importe esperado y sin motivo de los de siempre: se ofrece y se acepta (lo que el Panel no ofrecia)');

-- La revisión sin pedido, por dentro.
select pg_temp.celda('m-rev-motivo-1', 'security_review_required', false, '{"security_review_reason": "approved_after_reservation_expired", "provider_status": "pending", "paid_amount": null}');
select pg_temp.celda('m-rev-motivo-2', 'security_review_required', false, '{"security_review_reason": "finalization_without_active_reservation", "provider_status_null": true, "paid_amount": null}');
select pg_temp.celda('m-rev-otro-motivo', 'security_review_required', false, '{"security_review_reason": "preference_mismatch"}');
select pg_temp.celda('m-rev-sin-aprobar', 'security_review_required', false, '{"security_review_reason": "collector_mismatch", "provider_status": "pending"}');
select pg_temp.celda('m-rev-estado-nulo', 'security_review_required', false, '{"security_review_reason": "amount_mismatch", "provider_status_null": true}');
select pg_temp.celda('m-rev-otro-importe', 'security_review_required', false, '{"security_review_reason": "amount_mismatch", "paid_amount": 1}');
select pg_temp.celda('m-rev-importe-nulo', 'security_review_required', false, '{"security_review_reason": "preference_mismatch", "paid_amount": null}');
select pg_temp.celda('m-rev-sin-pago', 'security_review_required', false, '{"security_review_reason": "approved_after_reservation_expired", "sin_pago": true}');
select pg_temp.celda('m-rev-devuelto', 'security_review_required', false, '{"security_review_reason": "approved_after_reservation_expired", "refunded_amount": 1000}');
select pg_temp.celda('m-rev-devuelto-de-mas', 'security_review_required', false, '{"refunded_amount": 1500}');
select pg_temp.celda('m-rev-devuelto-parte', 'security_review_required', false, '{"refunded_amount": 400}');
select is(pg_temp.medir('m-rev-motivo-1') || ' ' || pg_temp.medir('m-rev-motivo-2'), 'true/acepta true/acepta',
  '8: los dos motivos de siempre alcanzan por si solos');
select is(pg_temp.medir('m-rev-otro-motivo'), 'true/acepta', '8: otro motivo con el cobro verificado aprobado: se ofrece y se acepta');
select is(pg_temp.medir('m-rev-sin-aprobar') || ' ' || pg_temp.medir('m-rev-estado-nulo') || ' ' || pg_temp.medir('m-rev-otro-importe') || ' ' || pg_temp.medir('m-rev-importe-nulo'),
  'false/55000 false/55000 false/55000 false/55000', '8: otro motivo sin aprobacion, sin estado del proveedor, por otro importe o sin importe: no');
select is(pg_temp.medir('m-rev-sin-pago'), 'false/55000', '8: sin el identificador del pago no hay contra que pedirlo');
select is(pg_temp.medir('m-rev-devuelto') || ' ' || pg_temp.medir('m-rev-devuelto-de-mas'), 'false/22023 false/22023',
  '8: en revision y sin saldo (devuelto entero o de mas): no se ofrece, y la base lo rechaza por importe');
select is(pg_temp.medir('m-rev-devuelto-parte'), 'true/acepta', '8: en revision y devuelto en parte: queda saldo, se ofrece y se acepta');

-- Con pedido: saldo, solicitudes en curso y disputas.
select pg_temp.celda('m-sin-pago', 'completed', true, '{"sin_pago": true}');
select pg_temp.celda('m-sin-saldo', 'completed', true, '{"refunded_amount": 1000}');
select pg_temp.celda('m-importe-nulo', 'completed', true, '{"paid_amount": null}');
select is(pg_temp.medir('m-sin-pago') || ' ' || pg_temp.medir('m-sin-saldo') || ' ' || pg_temp.medir('m-importe-nulo'), 'false/55000 false/22023 true/acepta',
  '8: sin id de pago no; sin saldo no; sin importe cobrado anotado vale el esperado');
select pg_temp.celda('m-en-curso', 'completed', true);
select pg_temp.celda('m-en-curso-sin-saldo', 'security_review_required', false, '{"refunded_amount": 1000}');
select pg_temp.celda('m-resuelto', 'completed', true);
insert into public.payment_refunds (payment_intent_id, amount, status, requested_by)
values (pg_temp.iid('m-en-curso'), 300, 'ambiguous', pg_temp.dueno('m-en-curso')),
       (pg_temp.iid('m-en-curso-sin-saldo'), 300, 'requested', pg_temp.dueno('m-en-curso')),
       (pg_temp.iid('m-resuelto'), 300, 'rejected', pg_temp.dueno('m-en-curso'));
select is(pg_temp.medir('m-en-curso') || ' ' || pg_temp.medir('m-en-curso-sin-saldo') || ' ' || pg_temp.medir('m-resuelto'), 'true/acepta true/acepta true/acepta',
  '8: con una solicitud en curso la base contesta con esa solicitud (no rechaza), aun sin saldo; una rechazada no cuenta');
select pg_temp.celda('m-contracargo', 'completed', true);
select pg_temp.celda('m-contracargo-resuelto', 'completed', true);
select pg_temp.celda('m-reclamo', 'completed', true);
select pg_temp.celda('m-reclamo-y-contracargo', 'partially_refunded', true);
insert into public.payment_disputes (payment_intent_id, provider_dispute_id, dispute_type, status, opened_at, resolved_at, created_at)
values (pg_temp.iid('m-contracargo'), 'payment_refund_and_reversal_chain_test-m-1', 'chargeback', 'opened', clock_timestamp(), null, clock_timestamp()),
       (pg_temp.iid('m-contracargo-resuelto'), 'payment_refund_and_reversal_chain_test-m-2', 'chargeback', 'closed', clock_timestamp(), clock_timestamp(), clock_timestamp()),
       (pg_temp.iid('m-reclamo'), 'payment_refund_and_reversal_chain_test-m-3', 'claim', 'opened', clock_timestamp(), null, clock_timestamp()),
       (pg_temp.iid('m-reclamo-y-contracargo'), 'payment_refund_and_reversal_chain_test-m-4', 'chargeback', 'opened', clock_timestamp(), null, clock_timestamp() - interval '1 hour'),
       (pg_temp.iid('m-reclamo-y-contracargo'), 'payment_refund_and_reversal_chain_test-m-5', 'claim', 'opened', clock_timestamp(), null, clock_timestamp());
select is(pg_temp.medir('m-contracargo') || ' ' || pg_temp.medir('m-contracargo-resuelto'), 'false/55000 true/acepta',
  '8: un contracargo abierto bloquea; uno resuelto, no');
select is(pg_temp.medir('m-reclamo') || ' ' || pg_temp.medir('m-reclamo-y-contracargo'), 'true/acepta false/55000',
  '8: un reclamo abierto no bloquea; si ademas hay un contracargo abierto, si, aunque el reclamo sea mas nuevo');

-- La equivalencia, sobre todas las celdas medidas.
select is((select count(*)::integer from celda), 57, '8: se midieron las 57 celdas');
select is(
  (select coalesce(string_agg(c.k || '=' || c.panel || '/' || c.base, ' ' order by c.n), 'ninguna') from celda c
    where (c.panel = 'true') is distinct from (c.base = 'acepta')),
  'ninguna', '8: en ninguna celda el Panel ofrece lo que la base rechaza ni calla lo que la base acepta');
select is(
  (select count(*)::integer from caso c join public.payment_intents pi on pi.id = c.intent_id
    where c.b = 'm' and c.k <> 'm-pedido'
      and (private.payment_refund_refusal(pi) is null) is distinct from ((select ce.base from celda ce where ce.k = c.k) = 'acepta')),
  0, '8: y la regla privada contesta lo mismo que la base en cada una');
select is(
  (select string_agg(distinct private.payment_refund_refusal(pi), ',' order by private.payment_refund_refusal(pi))
     from caso c join public.payment_intents pi on pi.id = c.intent_id where c.b = 'm'),
  'nothing_left_to_refund,open_chargeback,payment_not_refundable_in_current_state', '8: con sus tres motivos');
select is(
  (select count(*)::integer from public.payment_refunds r join caso c on c.intent_id = r.payment_intent_id where c.b = 'm' and r.reason = 'equivalencia'),
  0, '8: medir no dejo ninguna solicitud escrita');

-- ══════════════════════════════════════════════════════════════════════════
--  9 · EL SEGUIMIENTO PÚBLICO DEL PEDIDO CANCELADO
-- ══════════════════════════════════════════════════════════════════════════
select set_config('request.headers', '{"x-order-token":"payment_refund_and_reversal_chain_test-token-g"}', true);
select pg_temp.guardar('g.seguimiento', public.get_public_order_tracking((pg_temp.pedido('g')).public_code));
select is(
  pg_temp.d('g.seguimiento') ->> 'status' || '/' || ((pg_temp.d('g.seguimiento') ->> 'cancelled_at') is not null) || '/' || (pg_temp.d('g.seguimiento') ->> 'is_delivered')
    || '/' || ((pg_temp.d('g.seguimiento') ->> 'public_code') = (pg_temp.pedido('g')).public_code),
  'cancelled/true/false/true', '9: dentro de la ventana terminal el seguimiento muestra el pedido cancelado, con su fecha');
select ok(
  (pg_temp.d('g.seguimiento') ->> 'terminal_visible_until')::timestamptz between clock_timestamp() + interval '25 minutes' and clock_timestamp() + interval '30 minutes',
  '9: y dice hasta cuando se va a ver: treinta minutos desde la cancelacion');
select is(
  (select count(*)::integer from jsonb_object_keys(pg_temp.d('g.seguimiento')) k
    where k in ('estimated_arrival_at', 'estimated_minutes', 'rider_location', 'customer_name', 'customer_phone', 'total', 'payment_method', 'cancel_reason', 'reason')),
  0, '9: sin hora estimada, sin posicion, sin motivo, sin datos del cliente ni del pago');
select is(public.get_public_order_tracking((pg_temp.pedido('g')).id::text) ->> 'status', 'cancelled', '9: tambien por el id del pedido');
select set_config('request.headers', '{"x-order-token":"payment_refund_and_reversal_chain_test-otro-token"}', true);
select is(public.get_public_order_tracking((pg_temp.pedido('g')).public_code), null, '9: con otro token no se ve nada');
select set_config('request.headers', '{"x-order-token":"payment_refund_and_reversal_chain_test-token-g"}', true);
update public.order_public_tokens set terminal_visible_until = clock_timestamp() - interval '1 second' where order_id = (pg_temp.pedido('g')).id;
select is(public.get_public_order_tracking((pg_temp.pedido('g')).public_code), null, '9: vencida la ventana terminal el seguimiento contesta vacio, igual que para un pedido que no existe');
select is(public.get_public_order_tracking('payment_refund_and_reversal_chain_test-no-existe'), null, '9: que es lo mismo que contesta por un codigo cualquiera');
-- Un pedido cobrado y vivo se sigue viendo, sin importar la ventana.
insert into public.order_public_tokens(order_id, token, token_hash, expires_at)
values ((pg_temp.pedido('f4')).id, null, extensions.digest('payment_refund_and_reversal_chain_test-token-f4', 'sha256'), clock_timestamp() + interval '30 days');
select set_config('request.headers', '{"x-order-token":"payment_refund_and_reversal_chain_test-token-f4"}', true);
select is(
  public.get_public_order_tracking((pg_temp.pedido('f4')).public_code) ->> 'status' || '/'
    || coalesce(public.get_public_order_tracking((pg_temp.pedido('f4')).public_code) ->> 'terminal_visible_until', 'sin-ventana'),
  'received/sin-ventana', '9: control, un pedido cobrado y vivo se ve sin ventana terminal');
select set_config('request.headers', '', true);

select * from finish();
rollback;
