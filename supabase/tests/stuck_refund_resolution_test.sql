-- TABA · UN REEMBOLSO A MEDIAS TIENE SALIDA Y UN COBRO APROBADO EN REVISIÓN SE PUEDE DEVOLVER
--
-- Un reembolso queda `requested` (la Edge Function murió antes del POST) o
-- `ambiguous` sin identidad del proveedor (el POST venció). Antes no salía nunca
-- de ahí y bloqueaba cualquier otro reembolso del cobro. Acá se prueba la salida
-- (`resolve_stuck_payment_refund` + `prepare_payment_refund_v2`):
--
--   · no autoriza nada mientras la llamada anterior puede seguir en curso;
--   · exige una lectura del proveedor POSTERIOR al envío, y la pide si falta;
--   · esa lectura tiene que ser del pago contra el que salió la solicitud: la de
--     otro pago del mismo checkout no autoriza nada, y si el cobro pasó a apuntar
--     a otro pago no se autoriza ni se reenvía;
--   · sin devoluciones de más en el proveedor autoriza UN reintento: la misma
--     fila, la misma clave de idempotencia, el mismo importe, una sola vez;
--   · si el proveedor muestra justo ese importe sin dueño, NO reintenta: pide la
--     búsqueda de identidad; si muestra otra cosa, no hace nada;
--   · con identidad conocida vuelve a encolar la conciliación;
--   · nunca aparece una segunda solicitud ni una segunda clave para el mismo pedido
--     de reembolso;
--   · el rechazo explícito del proveedor cierra la fila y libera el cobro para una
--     solicitud nueva.
--
-- Y la mitad de base de EDGE-01: un cobro que entró en revisión por un snapshot
-- sin preferencia y después se verificó aprobado se puede reembolsar y rearmar;
-- uno sin aprobación verificada, no.
--
-- El tiempo se simula moviendo `requested_at` y `server_recorded_at` respecto del
-- reloj: no depende de la hora en que corre. Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(95);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table caso (
  k text primary key, business_id uuid, product_id uuid,
  owner_id uuid, customer_id uuid, session_id uuid, intent_id uuid
) on commit drop;

create function pg_temp.usuario(p_tag text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated',p_tag || '-' || replace(v_id::text,'-','') || '@example.invalid','',now(),'{}','{}',now(),now());
  return v_id;
end;
$$;

-- Un negocio, su dueño con sesión registrada, un producto y un checkout de
-- Mercado Pago de 3 unidades (total 3000). El guardián de admisión se apaga.
create function pg_temp.armar(p_k text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('sr-owner-' || p_k);
  v_customer uuid := pg_temp.usuario('sr-cliente-' || p_k);
  v_session uuid;
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values (
    v_business, 'TABA reembolso trabado ' || p_k, 'taba-reembolso-trabado-' || p_k, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
  values (v_owner, v_owner, v_business, 'owner', 'panel_web');
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-sr-' || p_k, 'app-sr-' || p_k, clock_timestamp(), clock_timestamp());
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata reembolso','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    10,true,true,false,'{}',true,now(),v_owner,'sr-' || p_k,'sr-' || p_k,'commercial',1);
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'sr-' || p_k || '-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 3)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Reembolso', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  insert into caso values (p_k, v_business, v_product, v_owner, v_customer, v_session,
    (select id from public.payment_intents where checkout_session_id = v_session));
end;
$$;

create function pg_temp.sid(p_k text) returns uuid language sql as $$ select session_id from caso where k = p_k $$;
create function pg_temp.iid(p_k text) returns uuid language sql as $$ select intent_id from caso where k = p_k $$;

create function pg_temp.snapshot(p_k text, p_status text default 'approved', p_refunded numeric default 0)
returns jsonb language sql as $$
  select jsonb_build_object(
    'provider_payment_id', 'PAY-' || right(replace(c.session_id::text, '-', ''), 12),
    'external_reference', 'taba2:checkout:' || c.session_id::text,
    'preference_id', pi.preference_id, 'merchant_order_id', 'MO-' || right(replace(c.session_id::text, '-', ''), 8),
    'collector_id', ps.collector_id, 'currency', 'ARS',
    'transaction_amount', pi.expected_amount::text, 'status', p_status,
    'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
    'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', p_refunded::text,
    'payer_email_hash', encode(gen_random_bytes(32), 'hex'),
    'raw_response_hash', encode(gen_random_bytes(32), 'hex'))
  from caso c
  join public.payment_intents pi on pi.id = c.intent_id
  join public.business_payment_settings ps on ps.business_id = c.business_id and ps.provider = 'mercadopago'
  where c.k = p_k;
$$;
-- Una lectura del pago en el proveedor, ya verificada.
create function pg_temp.asentar(p_k text, p_status text default 'approved', p_refunded numeric default 0)
returns jsonb language sql as $$
  select public.record_mercadopago_payment_snapshot(pg_temp.iid(p_k), pg_temp.snapshot(p_k, p_status, p_refunded), 'reconciliation', null);
$$;
-- Una lectura, también válida, de OTRO pago del mismo checkout (misma referencia,
-- misma preferencia, misma cuenta, mismo importe): la tarjeta rechazada antes de
-- la aprobada, o un cupón de pago que venció después.
create function pg_temp.asentar_otro_pago(p_k text, p_status text, p_cuando timestamptz)
returns jsonb language sql as $$
  select public.record_mercadopago_payment_snapshot(pg_temp.iid(p_k),
    pg_temp.snapshot(p_k, p_status, 0) || jsonb_build_object(
      'provider_payment_id', 'PAY-otro-' || p_k, 'provider_occurred_at', p_cuando::text),
    'webhook', null);
$$;
create function pg_temp.pago_del_cobro(p_k text) returns text language sql as $$
  select provider_payment_id from public.payment_intents where id = pg_temp.iid(p_k);
$$;
-- Cobro aprobado y pedido creado: el caso normal de un reembolso.
create function pg_temp.con_pedido(p_k text) returns void language plpgsql as $$
begin
  perform pg_temp.armar(p_k);
  perform pg_temp.asentar(p_k);
  perform public.finalize_paid_checkout_session(pg_temp.sid(p_k));
end;
$$;

create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_user)::text, true)::void;
$$;
create function pg_temp.sin_identidad() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;
-- El dueño pide un reembolso desde el Panel (clave nueva en cada toque, como el navegador).
create function pg_temp.pedir(p_k text, p_amount numeric) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.como((select owner_id from caso where k = p_k));
  v := public.prepare_payment_refund_v2(pg_temp.iid(p_k), p_amount, gen_random_uuid(), 'prueba');
  perform pg_temp.sin_identidad();
  return v;
end;
$$;
create function pg_temp.destrabar(p_k text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.como((select owner_id from caso where k = p_k));
  v := public.resolve_stuck_payment_refund(pg_temp.iid(p_k));
  perform pg_temp.sin_identidad();
  return v;
end;
$$;
create function pg_temp.reembolso(p_k text) returns public.payment_refunds language sql as $$
  select r.* from public.payment_refunds r where r.payment_intent_id = pg_temp.iid(p_k) order by r.requested_at limit 1;
$$;
-- Pasaron 30 minutos desde el envío, y lo último que se leyó del proveedor es anterior.
create function pg_temp.pasa_el_tiempo(p_k text) returns void language plpgsql as $$
begin
  update public.payment_refunds set requested_at = clock_timestamp() - interval '30 minutes'
   where payment_intent_id = pg_temp.iid(p_k);
  update public.payment_events set server_recorded_at = clock_timestamp() - interval '40 minutes'
   where payment_intent_id = pg_temp.iid(p_k);
end;
$$;
create function pg_temp.trabajos(p_k text, p_topic text) returns integer language sql as $$
  select count(*)::integer from public.payment_outbox o
   where o.payment_intent_id = pg_temp.iid(p_k) and o.topic = p_topic
     and o.status in ('pending', 'claimed', 'processing', 'retry_wait');
$$;
create function pg_temp.eventos(p_k text, p_type text) returns integer language sql as $$
  select count(*)::integer from public.payment_events e where e.payment_intent_id = pg_temp.iid(p_k) and e.event_type = p_type;
$$;
create function pg_temp.stock(p_k text) returns integer language sql as $$
  select p.stock from public.products p join caso c on p.id = c.product_id where c.k = p_k;
$$;

-- ══ 1 · CONTRATO Y PRIVILEGIOS ══════════════════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.resolve_stuck_payment_refund(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolve_stuck_payment_refund(uuid)', 'EXECUTE'),
  'destrabar un reembolso es del Panel autenticado y nunca de anon');
select ok(
  has_function_privilege('authenticated', 'public.prepare_payment_refund_v2(uuid,numeric,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.prepare_payment_refund_v2(uuid,numeric,uuid,text)', 'EXECUTE'),
  'prepare_payment_refund_v2 conserva sus privilegios');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('resolve_stuck_payment_refund', 'prepare_payment_refund_v2')
      and p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  2, 'las dos son SECURITY DEFINER con search_path fijado');
select is(
  (select count(*)::integer from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'payment_refunds' and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'payment_refunds sigue sin escritura para roles de cliente');

-- ══ 2 · `requested` SIN POST: LA SALIDA COMPLETA ═════════════════════════════
select pg_temp.con_pedido('r1');
create temporary table prep_r1 on commit drop as select pg_temp.pedir('r1', 300) as r;
select is((pg_temp.reembolso('r1')).status || '/' || pg_temp.trabajos('r1', 'refund_reconcile'), 'requested/0',
  'R1: la Edge Function murio antes del POST: fila requested y ningun trabajo en la cola');
select is(pg_temp.pedir('r1', 300) ->> 'reconciliation_required', 'true',
  'R1: otro intento sigue recibiendo reconciliation_required (no se reenvia solo)');

select throws_ok(format('select public.resolve_stuck_payment_refund(%L)', pg_temp.iid('r1')),
  '42501', 'autenticacion requerida', 'R1: destrabar exige identidad');
select pg_temp.como((select customer_id from caso where k = 'r1'));
select throws_ok(format('select public.resolve_stuck_payment_refund(%L)', pg_temp.iid('r1')),
  '42501', 'reembolso no autorizado', 'R1: y que sea dueno o encargado de ese negocio');
select pg_temp.sin_identidad();

select is(pg_temp.destrabar('r1') ->> 'reason', 'refund_request_in_flight',
  'R1: recien pedido no se autoriza nada: la llamada puede seguir en curso');
select pg_temp.pasa_el_tiempo('r1');
create temporary table d1_r1 on commit drop as select pg_temp.destrabar('r1') as r;
select is((select r ->> 'reason' from d1_r1), 'provider_check_pending',
  'R1: pasado el plazo, sin una lectura del proveedor posterior al envio tampoco se autoriza');
select is(pg_temp.trabajos('r1', 'payment_reconcile'), 1, 'R1: y deja encolada esa lectura');
select is(pg_temp.destrabar('r1') ->> 'reason', 'provider_check_pending', 'R1: insistir contesta lo mismo');
select is(pg_temp.trabajos('r1', 'payment_reconcile'), 1, 'R1: sin encolar otra lectura');
select is((pg_temp.reembolso('r1')).resolution_mode, null, 'R1: todavia no hay ninguna autorizacion');

-- El worker lee el pago: aprobado, sin devoluciones.
select pg_temp.asentar('r1', 'approved', 0);
create temporary table d2_r1 on commit drop as select pg_temp.destrabar('r1') as r;
select is((select (r ->> 'ok') || '/' || (r ->> 'action') from d2_r1), 'true/retry_authorized',
  'R1: el proveedor no muestra ninguna devolucion: se autoriza UN reintento');
select is((pg_temp.reembolso('r1')).resolution_mode, 'provider_retry', 'R1: queda anotado en la solicitud');
select is((pg_temp.reembolso('r1')).resolution_requested_by, (select owner_id from caso where k = 'r1'),
  'R1: con quien lo pidio');
select is(pg_temp.destrabar('r1') ->> 'idempotent', 'true', 'R1: pedirlo otra vez es idempotente');
select is(pg_temp.eventos('r1', 'payment.refund_retry_authorized'), 1, 'R1: y deja UN evento de autorizacion');

select is(pg_temp.pedir('r1', 500) ->> 'reconciliation_required', 'true',
  'R1: pedir OTRO importe no consume la autorizacion');
create temporary table retry_r1 on commit drop as select pg_temp.pedir('r1', 300) as r;
select is((select (r ->> 'idempotent') || '/' || (r ->> 'provider_retry') || '/' || (r ->> 'full_refund') from retry_r1),
  'false/true/false', 'R1: pedir el MISMO importe devuelve el reintento, en la forma que la Edge Function envia');
select ok((select r ? 'reconciliation_required' from retry_r1) is false,
  'R1: sin reconciliation_required');
select is((select r ->> 'refund_id' from retry_r1), (select r ->> 'refund_id' from prep_r1), 'R1: es la MISMA solicitud');
select is((select r ->> 'idempotency_key' from retry_r1), (select r ->> 'idempotency_key' from prep_r1),
  'R1: con la MISMA clave de idempotencia');
select is((select (r ->> 'amount')::numeric from retry_r1), 300.00, 'R1: y el mismo importe');
select is((select count(*)::integer from public.payment_refunds where payment_intent_id = pg_temp.iid('r1')), 1,
  'R1: no se creo ninguna solicitud nueva');
select is((pg_temp.reembolso('r1')).provider_attempts || '/' || coalesce((pg_temp.reembolso('r1')).resolution_mode, 'null'),
  '2/null', 'R1: segundo envio contado y autorizacion consumida');
select is(pg_temp.pedir('r1', 300) ->> 'reconciliation_required', 'true',
  'R1: una autorizacion es UN envio: el toque siguiente vuelve a reconciliation_required');
select is(pg_temp.destrabar('r1') ->> 'reason', 'refund_request_in_flight',
  'R1: y no se puede volver a autorizar mientras ese envio puede seguir en curso');

-- El proveedor contesta el reintento con un rechazo explícito.
select is(
  (public.record_payment_refund_response_v2((pg_temp.reembolso('r1')).id, '', 'rejected', 300, encode(gen_random_bytes(32), 'hex')) ->> 'ok'),
  'true', 'R1: el rechazo explicito del proveedor se asienta');
select is((pg_temp.reembolso('r1')).status, 'rejected', 'R1: la solicitud queda cerrada');
select is(pg_temp.destrabar('r1') ->> 'reason', 'no_refund_in_flight', 'R1: ya no hay nada que destrabar');
create temporary table nuevo_r1 on commit drop as select pg_temp.pedir('r1', 300) as r;
select ok((select (r ->> 'idempotent') = 'false' and (r ->> 'refund_id') <> (select r ->> 'refund_id' from prep_r1) from nuevo_r1),
  'R1: y el cobro admite una solicitud nueva');

-- ══ 3 · `ambiguous`: EL ENVÍO SÍ SE EJECUTÓ Y SE PERDIÓ LA RESPUESTA ═════════
select pg_temp.con_pedido('r2');
create temporary table prep_r2 on commit drop as select pg_temp.pedir('r2', 300) as r;
select public.mark_payment_refund_ambiguous((pg_temp.reembolso('r2')).id, encode(gen_random_bytes(32), 'hex'), 'network_or_timeout');
update public.payment_outbox set status = 'dead_letter', attempts = 8
 where payment_intent_id = pg_temp.iid('r2') and topic = 'refund_reconcile';
select is((pg_temp.reembolso('r2')).status || '/' || pg_temp.trabajos('r2', 'refund_reconcile'), 'ambiguous/0',
  'R2: POST vencido: fila dudosa sin identidad y su trabajo en dead_letter');
select pg_temp.pasa_el_tiempo('r2');
-- La lectura posterior muestra 300 devueltos que ninguna solicitud tiene asentados.
select pg_temp.asentar('r2', 'approved', 300);
create temporary table d_r2 on commit drop as select pg_temp.destrabar('r2') as r;
select is((select (r ->> 'ok') || '/' || (r ->> 'reason') || '/' || (r ->> 'action') from d_r2),
  'false/provider_reports_unmatched_refund/identity_lookup_enqueued',
  'R2: el proveedor ya muestra ese importe: NO se autoriza un reenvio');
select is((pg_temp.reembolso('r2')).resolution_mode, 'provider_lookup', 'R2: queda pedida la busqueda de identidad');
select is(pg_temp.trabajos('r2', 'refund_reconcile'), 1, 'R2: con su trabajo de conciliacion otra vez activo');
select is(pg_temp.pedir('r2', 300) ->> 'reconciliation_required', 'true', 'R2: y pedir de nuevo sigue sin reenviar');
select is((pg_temp.reembolso('r2')).provider_attempts, 1, 'R2: un solo envio');
create temporary table d2_r2 on commit drop as select pg_temp.destrabar('r2') as r;
select is((select (r ->> 'reason') || '/' || (r ->> 'idempotent') from d2_r2), 'provider_reports_unmatched_refund/true',
  'R2: insistir contesta lo mismo y avisa que no hizo nada nuevo');
select is(pg_temp.eventos('r2', 'payment.refund_identity_lookup_requested') || '/' || pg_temp.trabajos('r2', 'refund_reconcile'), '1/1',
  'R2: sin otro evento ni otro trabajo por cada toque');
-- El worker encuentra la identidad y asienta el resultado con las funciones de siempre.
select public.record_payment_refund_identity((pg_temp.reembolso('r2')).id, pg_temp.iid('r2'),
  (select r ->> 'provider_payment_id' from prep_r2), (select (r ->> 'idempotency_key')::uuid from prep_r2), '770000002');
select public.record_payment_refund_response_v2((pg_temp.reembolso('r2')).id, '770000002', 'approved', 300, encode(gen_random_bytes(32), 'hex'));
select is(
  (select r.status || ' ' || pi.refunded_amount || ' ' || pi.internal_status
     from public.payment_refunds r join public.payment_intents pi on pi.id = r.payment_intent_id where pi.id = pg_temp.iid('r2')),
  'approved 300.00 partially_refunded', 'R2: resuelto como aprobado, sin contar el importe dos veces');

-- ══ 4 · EL PROVEEDOR MUESTRA OTRA COSA: NO SE ADIVINA ════════════════════════
select pg_temp.con_pedido('r3');
select pg_temp.pedir('r3', 300);
select public.mark_payment_refund_ambiguous((pg_temp.reembolso('r3')).id, encode(gen_random_bytes(32), 'hex'), 'http_502');
select pg_temp.pasa_el_tiempo('r3');
select pg_temp.asentar('r3', 'approved', 500);
create temporary table d_r3 on commit drop as select pg_temp.destrabar('r3') as r;
select is((select (r ->> 'ok') || '/' || (r ->> 'reason') from d_r3), 'false/provider_refunds_do_not_match',
  'R3: una devolucion de 500 en el proveedor no es esta solicitud de 300: ni reintento ni adopcion');
select is((pg_temp.reembolso('r3')).resolution_mode, null, 'R3: sin ninguna autorizacion');
select is(pg_temp.pedir('r3', 300) ->> 'reconciliation_required', 'true', 'R3: y sin reenvio');

-- ══ 5 · CON IDENTIDAD: SE VUELVE A ENCOLAR LA CONCILIACIÓN ═══════════════════
select pg_temp.con_pedido('r4');
create temporary table prep_r4 on commit drop as select pg_temp.pedir('r4', 300) as r;
select public.record_payment_refund_identity((pg_temp.reembolso('r4')).id, pg_temp.iid('r4'),
  (select r ->> 'provider_payment_id' from prep_r4), (select (r ->> 'idempotency_key')::uuid from prep_r4), '770000004');
select public.mark_payment_refund_ambiguous((pg_temp.reembolso('r4')).id, encode(gen_random_bytes(32), 'hex'), 'refund_response_not_persisted');
update public.payment_outbox set status = 'dead_letter', attempts = 8
 where payment_intent_id = pg_temp.iid('r4') and topic = 'refund_reconcile';
select is(pg_temp.destrabar('r4') ->> 'action', 'reconcile_enqueued',
  'R4: con identidad conocida destrabar vuelve a encolar la conciliacion, sin esperar plazos');
select is(pg_temp.trabajos('r4', 'refund_reconcile'), 1, 'R4: un trabajo activo');
select is(pg_temp.destrabar('r4') ->> 'action', 'reconcile_already_queued', 'R4: repetirlo no encola otro');
select is(pg_temp.trabajos('r4', 'refund_reconcile'), 1, 'R4: sigue habiendo uno');
select is((pg_temp.reembolso('r4')).resolution_mode, null, 'R4: y nunca autoriza un reenvio de algo que ya tiene identidad');

-- ══ 6 · NADA EN CURSO / LA AUTORIZACIÓN SE VUELVE A VALIDAR AL USARLA ════════
select pg_temp.con_pedido('r5');
select is(pg_temp.destrabar('r5') ->> 'action', 'none', 'R5: sin reembolso en curso no hay nada que hacer');

select pg_temp.con_pedido('r6');
select pg_temp.pedir('r6', 300);
select pg_temp.pasa_el_tiempo('r6');
select pg_temp.asentar('r6', 'approved', 0);
select is(pg_temp.destrabar('r6') ->> 'action', 'retry_authorized', 'R6: reintento autorizado');
-- Entre la autorización y el toque llega un aviso del proveedor con 300 devueltos.
select pg_temp.asentar('r6', 'approved', 300);
select is(pg_temp.pedir('r6', 300) ->> 'reconciliation_required', 'true',
  'R6: si despues aparece una devolucion en el proveedor, la autorizacion ya no se consume');
select is((pg_temp.reembolso('r6')).provider_attempts, 1, 'R6: no hubo segundo envio');

-- ══ 7 · REEMBOLSO TOTAL DE UN COBRO EN REVISIÓN, TRABADO Y REINTENTADO ═══════
select pg_temp.armar('r7');
update public.checkout_sessions set created_at = clock_timestamp() - interval '20 minutes', expires_at = clock_timestamp() - interval '20 seconds'
 where id = pg_temp.sid('r7');
update public.inventory_reservations set created_at = clock_timestamp() - interval '20 minutes', expires_at = clock_timestamp() - interval '20 seconds'
 where checkout_session_id = pg_temp.sid('r7');
select pg_temp.asentar('r7');
create temporary table prep_r7 on commit drop as select pg_temp.pedir('r7', null) as r;
select pg_temp.pasa_el_tiempo('r7');
select pg_temp.asentar('r7', 'approved', 0);
select is(pg_temp.destrabar('r7') ->> 'action', 'retry_authorized', 'R7: reintento autorizado sobre un cobro en revision');
create temporary table retry_r7 on commit drop as select pg_temp.pedir('r7', null) as r;
select is((select (r ->> 'provider_retry') || '/' || (r ->> 'full_refund') || '/' || ((r ->> 'idempotency_key') = (select r ->> 'idempotency_key' from prep_r7)) from retry_r7),
  'true/true/true', 'R7: reintento total, misma clave');
select is(pg_temp.stock('r7'), 7, 'R7: el stock sigue retenido mientras el dinero no volvio');
select public.record_payment_refund_identity((pg_temp.reembolso('r7')).id, pg_temp.iid('r7'),
  (select r ->> 'provider_payment_id' from prep_r7), (select (r ->> 'idempotency_key')::uuid from prep_r7), '770000007');
select public.record_payment_refund_response_v2((pg_temp.reembolso('r7')).id, '770000007', 'approved', 3000, encode(gen_random_bytes(32), 'hex'));
select is(pg_temp.stock('r7') || ' ' || (pg_temp.reembolso('r7')).status, '10 approved',
  'R7: aprobado el reintento, el stock vuelve completo');

-- ══ 8 · EDGE-01: REVISIÓN POR UN SNAPSHOT SIN PREFERENCIA ════════════════════
-- La preferencia quedó asentada en el cobro; el snapshot llega sin ella porque
-- falló la consulta de la orden del proveedor.
select pg_temp.armar('e1');
update public.payment_intents set preference_id = 'PREF-e1' where id = pg_temp.iid('e1');
select is(
  (public.record_mercadopago_payment_snapshot(pg_temp.iid('e1'), pg_temp.snapshot('e1') - 'preference_id', 'webhook', null) ->> 'reason'),
  'preference_mismatch', 'E1: el snapshot sin preferencia manda el cobro a revision');
select is((select provider_payment_id from public.payment_intents where id = pg_temp.iid('e1')), null,
  'E1: sin identificador de pago asentado');
select pg_temp.como((select owner_id from caso where k = 'e1'));
select throws_ok(format('select public.prepare_payment_refund_v2(%L, null, gen_random_uuid(), null)', pg_temp.iid('e1')),
  '55000', 'pago no reembolsable en su estado actual', 'E1: sin cobro verificado no hay reembolso (no cambia)');
select throws_ok(format('select public.recover_paid_checkout_order(%L)', pg_temp.sid('e1')),
  '55000', 'este checkout no tiene un cobro aprobado y verificado', 'E1: ni rearmado (no cambia)');
select pg_temp.sin_identidad();
-- Llega después un snapshot VÁLIDO (conciliación), con la reserva ya vencida y sin barrer.
update public.checkout_sessions set created_at = clock_timestamp() - interval '30 minutes', expires_at = clock_timestamp() - interval '10 minutes'
 where id = pg_temp.sid('e1');
update public.inventory_reservations set created_at = clock_timestamp() - interval '30 minutes', expires_at = clock_timestamp() - interval '10 minutes'
 where checkout_session_id = pg_temp.sid('e1');
select pg_temp.asentar('e1');
select is(
  (select internal_status || '/' || security_review_reason || '/' || provider_status || '/' || paid_amount from public.payment_intents where id = pg_temp.iid('e1')),
  'security_review_required/preference_mismatch/approved/3000.00',
  'E1: el snapshot valido deja el cobro verificado, todavia en revision');
create temporary table prep_e1 on commit drop as select pg_temp.pedir('e1', null) as r;
select is((select (r ->> 'idempotent') || '/' || (r ->> 'full_refund') || '/' || (r ->> 'amount') from prep_e1), 'false/true/3000.00',
  'E1: ahora el dueno puede pedir el reembolso total');
select public.record_payment_refund_identity((pg_temp.reembolso('e1')).id, pg_temp.iid('e1'),
  (select r ->> 'provider_payment_id' from prep_e1), (select (r ->> 'idempotency_key')::uuid from prep_e1), '770000011');
select public.record_payment_refund_response_v2((pg_temp.reembolso('e1')).id, '770000011', 'approved', 3000, encode(gen_random_bytes(32), 'hex'));
select is(pg_temp.stock('e1'), 10, 'E1: y aprobado el reembolso el stock vuelve completo');

select pg_temp.armar('e2');
update public.payment_intents set preference_id = 'PREF-e2' where id = pg_temp.iid('e2');
select public.record_mercadopago_payment_snapshot(pg_temp.iid('e2'), pg_temp.snapshot('e2') - 'preference_id', 'webhook', null);
update public.checkout_sessions set created_at = clock_timestamp() - interval '30 minutes', expires_at = clock_timestamp() - interval '10 minutes'
 where id = pg_temp.sid('e2');
update public.inventory_reservations set created_at = clock_timestamp() - interval '30 minutes', expires_at = clock_timestamp() - interval '10 minutes'
 where checkout_session_id = pg_temp.sid('e2');
select pg_temp.asentar('e2');
select is(public.can_recover_paid_checkout(pg_temp.iid('e2')), true, 'E2: con el snapshot valido el Panel ofrece rearmar');
select pg_temp.como((select owner_id from caso where k = 'e2'));
select is((public.recover_paid_checkout_order(pg_temp.sid('e2')) ->> 'ok'), 'true', 'E2: y el rearmado funciona');
select pg_temp.sin_identidad();
select is(
  pg_temp.stock('e2') || ' ' || (select count(*) from public.orders o where o.business_id = (select business_id from caso where k = 'e2'))
    || ' ' || (select string_agg(r.status || ':' || r.quantity, ',') from public.inventory_reservations r where r.checkout_session_id = pg_temp.sid('e2')),
  '7 1 converted:3', 'E2: stock descontado una vez, UN pedido, una reserva convertida');

-- Otro motivo de revisión con el cobro verificado y sin pedido posible.
select pg_temp.armar('e3');
select pg_temp.asentar('e3');
update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_confirmed_delivery_location'
 where id = pg_temp.iid('e3');
update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_confirmed_delivery_location'
 where id = pg_temp.sid('e3');
select is(pg_temp.pedir('e3', null) ->> 'full_refund', 'true',
  'E3: un cobro aprobado y verificado en revision se puede devolver cualquiera sea el motivo');

-- La condición no se afloja: en revisión, con identificador de pago, pero SIN aprobación.
select pg_temp.armar('e4');
select pg_temp.asentar('e4', 'pending');
select is(
  (public.record_mercadopago_payment_snapshot(pg_temp.iid('e4'),
     pg_temp.snapshot('e4') || jsonb_build_object('collector_id', 'otra-cuenta'), 'webhook', null) ->> 'reason'),
  'collector_mismatch', 'E4: un snapshot de otra cuenta manda a revision un cobro pendiente');
select ok((select provider_payment_id is not null and provider_status = 'pending' from public.payment_intents where id = pg_temp.iid('e4')),
  'E4: tiene identificador de pago pero nunca se aprobo');
select pg_temp.como((select owner_id from caso where k = 'e4'));
select throws_ok(format('select public.prepare_payment_refund_v2(%L, null, gen_random_uuid(), null)', pg_temp.iid('e4')),
  '55000', 'pago no reembolsable en su estado actual', 'E4: no se puede reembolsar lo que no consta cobrado');
select pg_temp.sin_identidad();
-- En revisión, con identificador, motivo fuera de la lista y estado del proveedor desconocido.
update public.payment_intents set provider_status = null where id = pg_temp.iid('e4');
select pg_temp.como((select owner_id from caso where k = 'e4'));
select throws_ok(format('select public.prepare_payment_refund_v2(%L, null, gen_random_uuid(), null)', pg_temp.iid('e4')),
  '55000', 'pago no reembolsable en su estado actual', 'E4: tampoco con el estado del proveedor desconocido');
select pg_temp.sin_identidad();

-- ══ 9 · VARIOS PAGOS DEL PROVEEDOR BAJO UN MISMO COBRO ══════════════════════
-- El envío se ejecutó y se perdió la respuesta; el aviso de ESE pago todavía no
-- se asentó. Llega tarde el aviso de la tarjeta que había sido rechazada antes.
select pg_temp.con_pedido('v1');
create temporary table prep_v1 on commit drop as select pg_temp.pedir('v1', 300) as r;
select is((pg_temp.reembolso('v1')).provider_payment_id, pg_temp.pago_del_cobro('v1'),
  'V1: la solicitud guarda contra que pago del proveedor salio');
select public.mark_payment_refund_ambiguous((pg_temp.reembolso('v1')).id, encode(gen_random_bytes(32), 'hex'), 'network_or_timeout');
select pg_temp.pasa_el_tiempo('v1');
select pg_temp.asentar_otro_pago('v1', 'rejected', clock_timestamp() - interval '2 hours');
select is(pg_temp.pago_del_cobro('v1'), (select r ->> 'provider_payment_id' from prep_v1),
  'V1: el aviso viejo de otro pago no cambia a que pago apunta el cobro');
select is(pg_temp.destrabar('v1') ->> 'reason', 'provider_check_pending',
  'V1: la lectura valida de OTRO pago del mismo checkout no es evidencia sobre este reembolso');
select is((pg_temp.reembolso('v1')).provider_attempts || '/' || coalesce((pg_temp.reembolso('v1')).resolution_mode, 'null'), '1/null',
  'V1: ninguna autorizacion y un solo envio');
select is(pg_temp.pedir('v1', 300) ->> 'reconciliation_required', 'true', 'V1: y pedir de nuevo no reenvia');
select pg_temp.asentar('v1', 'approved', 0);
select is(pg_temp.destrabar('v1') ->> 'action', 'retry_authorized',
  'V1: la lectura del pago de la solicitud, sin devoluciones, si autoriza');
select is(
  (select (r ->> 'provider_retry') || '/' || ((r ->> 'provider_payment_id') = (select r ->> 'provider_payment_id' from prep_v1))
     from (select pg_temp.pedir('v1', 300) as r) x),
  'true/true', 'V1: y el reintento sale contra ese mismo pago');

-- Autorizado el reintento, el cobro pasa a apuntar a otro pago del checkout. Hoy
-- lo produce el asiento del snapshot de ese otro pago cuando su fecha en el
-- proveedor es más nueva; acá se fuerza con un UPDATE para que la prueba valga
-- igual el día que ese asiento deje de pisar el pago aprobado.
select pg_temp.con_pedido('v2');
create temporary table prep_v2 on commit drop as select pg_temp.pedir('v2', 300) as r;
select pg_temp.pasa_el_tiempo('v2');
select pg_temp.asentar('v2', 'approved', 0);
select is(pg_temp.destrabar('v2') ->> 'action', 'retry_authorized', 'V2: reintento autorizado');
update public.payment_intents set provider_payment_id = 'PAY-otro-v2' where id = pg_temp.iid('v2');
select is(pg_temp.pedir('v2', 300) ->> 'reconciliation_required', 'true',
  'V2: la autorizacion no se consume contra un pago que no es el de la solicitud');
select is((pg_temp.reembolso('v2')).provider_attempts, 1, 'V2: no hubo segundo envio');
select is(pg_temp.destrabar('v2') ->> 'reason', 'provider_payment_changed', 'V2: destrabar lo dice y deriva a soporte');
update public.payment_intents set provider_payment_id = (select r ->> 'provider_payment_id' from prep_v2) where id = pg_temp.iid('v2');
select is(
  (select (r ->> 'provider_retry') || '/' || ((r ->> 'provider_payment_id') = (select r ->> 'provider_payment_id' from prep_v2))
     from (select pg_temp.pedir('v2', 300) as r) x),
  'true/true', 'V2: cuando el cobro vuelve a apuntar al pago de la solicitud, el reintento sale contra ese pago');

-- Una solicitud anterior a la columna no tiene anotado su pago.
select pg_temp.con_pedido('v3');
select pg_temp.pedir('v3', 300);
update public.payment_refunds set provider_payment_id = null where payment_intent_id = pg_temp.iid('v3');
select pg_temp.pasa_el_tiempo('v3');
select pg_temp.asentar('v3', 'approved', 0);
select is(pg_temp.destrabar('v3') ->> 'action', 'retry_authorized',
  'V3: solicitud sin pago anotado, cobro que conocio un unico pago: se deduce y se autoriza');
select is((pg_temp.reembolso('v3')).provider_payment_id, pg_temp.pago_del_cobro('v3'), 'V3: y queda anotado en la solicitud');
update public.payment_refunds set provider_payment_id = null where payment_intent_id = pg_temp.iid('v3');
select is(pg_temp.pedir('v3', 300) ->> 'reconciliation_required', 'true',
  'V3: sin pago anotado no se reenvia aunque haya una autorizacion escrita');

select pg_temp.con_pedido('v4');
select pg_temp.pedir('v4', 300);
update public.payment_refunds set provider_payment_id = null where payment_intent_id = pg_temp.iid('v4');
select pg_temp.pasa_el_tiempo('v4');
select pg_temp.asentar_otro_pago('v4', 'rejected', clock_timestamp() - interval '2 hours');
select pg_temp.asentar('v4', 'approved', 0);
select is(pg_temp.destrabar('v4') ->> 'reason', 'provider_payment_unknown',
  'V4: solicitud sin pago anotado y cobro con varios pagos: no se adivina contra cual salio');
select is(
  coalesce((pg_temp.reembolso('v4')).provider_payment_id, 'null') || '/' || coalesce((pg_temp.reembolso('v4')).resolution_mode, 'null')
    || '/' || (pg_temp.reembolso('v4')).provider_attempts,
  'null/null/1', 'V4: nada anotado, nada autorizado, un solo envio');
select is(pg_temp.pedir('v4', 300) ->> 'reconciliation_required', 'true', 'V4: y sin reenvio');

-- Los contratos de siempre no cambian.
select pg_temp.con_pedido('k');
create temporary table prep_k on commit drop as select pg_temp.pedir('k', null) as r;
select is((select (r ->> 'idempotent') || '/' || (r ->> 'full_refund') || '/' || (r ->> 'amount') from prep_k), 'false/true/3000.00',
  'K: el reembolso total de un pedido completo se prepara como antes');
select ok((select not (r ? 'provider_retry') from prep_k), 'K: sin la clave provider_retry');
select pg_temp.como((select owner_id from caso where k = 'k'));
select is(
  (public.prepare_payment_refund_v2(pg_temp.iid('k'), null, (select (r ->> 'idempotency_key')::uuid from prep_k), null) ->> 'reconciliation_required'),
  'true', 'K: repetir la misma clave nunca autoriza otro POST');
select throws_ok(format('select public.prepare_payment_refund_v2(%L, null, %L, null)', pg_temp.iid('r5'), (select r ->> 'idempotency_key' from prep_k)),
  '42501', 'reembolso no autorizado', 'K: el dueno de un negocio no prepara reembolsos de otro');
select pg_temp.sin_identidad();

select * from finish();
rollback;
