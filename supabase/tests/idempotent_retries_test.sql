-- TABA · EL MISMO COMANDO DOS VECES, EN SERIE: LO QUE UNA SOLA TRANSACCIÓN PUEDE PROBAR
--
-- La carrera `scripts/order-intake/idempotency-race.mjs` encontró cuatro defectos, una
-- inversión de candados en la oferta al repartidor y otra en la libreta de direcciones
-- (archivar contra elegir la principal). Las migraciones 20261002040000 a 20261002043000
-- los corrigen. Acá queda fijado, con un comando detrás del otro:
--
--   1. CIERRE DEL COMERCIO CON EL CÓDIGO DEL CLIENTE (`confirm_business_delivery_code`).
--      El mismo envío repetido (misma clave, mismo código equivocado) cuenta UN intento y
--      contesta `idempotent_replay: true` con los intentos que quedan; otro código
--      equivocado con la misma clave es otro intento; con la demora activa nadie cuenta;
--      pasada la demora la repetición sigue sin contar; el código bueno entrega; y del
--      código tipeado no se guarda nada que se pueda leer.
--   2. LA PUERTA DEL REPARTIDOR (`confirm_delivery_code`) sigue igual: deduplica por clave.
--   3. ACEPTAR UNA OFERTA (`accept_rider_order_offer`) contesta lo mismo que antes en cada
--      caso: oferta ajena, versión vieja, aceptada, repetida, retirada, repartidor ausente.
--   4. LA LIBRETA DE DIRECCIONES contesta lo mismo que antes en serie (`duplicate`, elegir
--      la principal, archivar) y cada una de sus tres funciones toma el candado del cliente.
--   5. Las siete funciones conservan sus permisos y su `search_path`.
--
-- LO QUE ESTA SUITE NO PRUEBA, Y NO PUEDE
--
--   pgTAP corre en una transacción: no hay una segunda llamada llegando al mismo tiempo.
--   Que el mismo guardado x10 deje UNA dirección, que dos pedidos de principal no devuelvan
--   un 23505, y que ninguno de los cruces de candados termine en deadlock (cancelación de
--   pago contra su segundo toque, contra la marca dudosa y contra el aviso de pago; oferta
--   contra aceptación; archivar la principal contra elegir otra) lo prueba la carrera, con
--   conexiones reales y las llegadas en orden. De esos cruces acá sólo hay testigos: que
--   cada función de la libreta toma el candado del cliente (sección 4) y, de texto
--   (sección 6), que la definición vigente sigue tomando los candados en el orden acordado.
--   Avisan si otra migración pisa la función con una copia vieja; no demuestran nada sobre
--   concurrencia.
--   Las respuestas de los asientos de cancelación las fija `payment_cancellation_terminal_test`.
--
-- Todo transaccional: termina en rollback. Sin horas ni fechas fijas: la demora se mueve
-- escribiendo `locked_until`, no esperando.

begin;
create extension if not exists pgtap with schema extensions;
select plan(96);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- Todo lo que cae bajo una restricción única lleva el nombre de este archivo: la base del
-- gate no está vacía cuando esto corre.
create temporary table irt_ids (k text primary key, id uuid not null) on commit drop;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from irt_ids where k = p_k $$;

create function pg_temp.persona(p_k text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated','idempotent_retries_test-' || p_k || '@example.invalid','',now(),'{}','{}',now(),now());
  insert into irt_ids values (p_k, v_id);
  return v_id;
end;
$$;

select pg_temp.persona(k) from unnest(array['owner','staff','rider1','rider2','cliente1','cliente2','cliente3']) as k;
insert into irt_ids values ('business', gen_random_uuid());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values (pg_temp.id('business'),'IDEMPOTENT RETRIES TEST','open','idempotent-retries-test',true,'America/Argentina/Buenos_Aires');
insert into public.business_members(business_id,user_id,role,is_active)
values (pg_temp.id('business'), pg_temp.id('owner'), 'owner', true),
       (pg_temp.id('business'), pg_temp.id('staff'), 'staff', true),
       (pg_temp.id('business'), pg_temp.id('rider1'), 'rider', true),
       (pg_temp.id('business'), pg_temp.id('rider2'), 'rider', true);
-- La sesión registrada de cada integrante: su id de sesión es su propio id.
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
select pg_temp.id(k), pg_temp.id(k), pg_temp.id('business'), r, c
  from (values ('owner','owner','panel_web'),('staff','staff','panel_web'),
               ('rider1','rider','rider_android'),('rider2','rider','rider_android')) as t(k, r, c);

-- Cuatro pedidos con envío, listos. A lo cierra el comercio; B, C y D son del repartidor.
insert into irt_ids select 'pedido_' || n, gen_random_uuid() from unnest(array['a','b','c','d']) as n;
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total
)
select pg_temp.id('pedido_' || n), pg_temp.id('business'),
       'IRT18-' || upper(n), 'IRT18-' || upper(n), 'ready', 'delivery', 'delivery',
       'idempotent_retries_test-' || n, 'CLIENTE IDEMPOTENT RETRIES', 'Centro', 'Calle de prueba ' || n,
       '+540000000000', 'cash', 1000, 0, 1000
  from unnest(array['a','b','c','d']) as n;

-- El código que recibió el cliente: A = 4417, B = 2580. Costo bajo: la suite compara muchas veces.
insert into public.order_delivery_handoffs(order_id, code_hash, code_ciphertext, expires_at)
values (pg_temp.id('pedido_a'), extensions.crypt('4417', extensions.gen_salt('bf', 6)), '\x00'::bytea, clock_timestamp() + interval '1 day'),
       (pg_temp.id('pedido_b'), extensions.crypt('2580', extensions.gen_salt('bf', 6)), '\x00'::bytea, clock_timestamp() + interval '1 day');

create function pg_temp.como(p_k text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_k), 'role', 'authenticated', 'session_id', pg_temp.id(p_k))::text, true)::void;
$$;
-- El comprador: sesión anónima, sin sesión de equipo.
create function pg_temp.como_cliente(p_k text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_k), 'role', 'authenticated', 'is_anonymous', true)::text, true)::void;
$$;
create function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;
create function pg_temp.rev(p_k text) returns bigint language sql as $$
  select revision from public.orders where id = pg_temp.id(p_k);
$$;
create function pg_temp.estado(p_k text) returns text language sql as $$
  select status from public.orders where id = pg_temp.id(p_k);
$$;
create function pg_temp.fallidos(p_k text) returns integer language sql as $$
  select failed_attempts from public.order_delivery_handoffs where order_id = pg_temp.id(p_k);
$$;
create function pg_temp.anotados(p_k text) returns integer language sql as $$
  select count(*)::integer from public.delivery_confirmation_attempts where order_id = pg_temp.id(p_k);
$$;
-- El cierre del comercio sobre el pedido A, resumido: código/intentos restantes/repetición.
create function pg_temp.cerrar(p_code text, p_key text) returns jsonb language sql as $$
  select public.confirm_business_delivery_code(pg_temp.id('pedido_a'), pg_temp.rev('pedido_a'), p_code, p_key);
$$;
create function pg_temp.resumen(p jsonb) returns text language sql as $$
  select concat_ws('/', coalesce(p ->> 'code', p ->> 'outcome'), coalesce(p ->> 'remaining_attempts', '-'),
                   coalesce(p ->> 'idempotent_replay', '-'));
$$;
-- La huella que la función tiene que haber anotado para un intento equivocado: clave + HMAC
-- del código tipeado con el hash del código vigente como clave.
create function pg_temp.huella(p_k text, p_key text, p_code text) returns text language sql as $$
  select left(regexp_replace(p_key, '[^A-Za-z0-9_-]', '-', 'g'), 111) || '-'
         || substr(encode(extensions.hmac(p_key || ':' || p_code, h.code_hash, 'sha256'), 'hex'), 1, 16)
    from public.order_delivery_handoffs h where h.order_id = pg_temp.id(p_k);
$$;

-- ══ 1 · EL CIERRE DEL COMERCIO: EL REINTENTO DE UN CÓDIGO EQUIVOCADO ══════════
select pg_temp.como('staff');
select is(
  public.transition_order(pg_temp.id('pedido_a'), pg_temp.rev('pedido_a'), 'on_the_way', 'idempotent_retries_test-salida-a') ->> 'status',
  'on_the_way', 'A: el comercio despacha su propio envio');

-- Primer envío: código equivocado.
create temporary table r1 on commit drop as select pg_temp.cerrar('9038', 'idempotent_retries_test-cierre-0001') as r;
select is(pg_temp.resumen((select r from r1)), 'incorrect_code/4/-', 'A: un codigo equivocado se rechaza: quedan 4 intentos');
select is(pg_temp.fallidos('pedido_a') || '/' || pg_temp.anotados('pedido_a'), '1/1', 'A: un intento contado y una fila anotada');

-- El MISMO envío otra vez (misma clave, mismo código): reintento de red, doble toque, outbox.
create temporary table r2 on commit drop as select pg_temp.cerrar('9038', 'idempotent_retries_test-cierre-0001') as r;
select is(pg_temp.resumen((select r from r2)), 'incorrect_code/4/true',
  'A: el mismo envio repetido contesta lo mismo, con los mismos 4 intentos, y dice que es repeticion');
select is(pg_temp.fallidos('pedido_a') || '/' || pg_temp.anotados('pedido_a'), '1/1',
  'A: y no gasto otro intento ni anoto otra fila');
select ok((select r ? 'retry_after_seconds' and r ->> 'retry_after_seconds' is null
              and (r ->> 'revision')::bigint = pg_temp.rev('pedido_a') and r ->> 'ok' = 'false' from r2),
  'A: la repeticion trae los mismos campos que la primera respuesta (sin demora, con la revision vigente)');
select is(pg_temp.resumen(pg_temp.cerrar('9038', 'idempotent_retries_test-cierre-0001')), 'incorrect_code/4/true',
  'A: una tercera copia, igual');
select is(pg_temp.fallidos('pedido_a'), 1, 'A: tres copias del mismo envio, un solo intento');

-- Otro código equivocado con la MISMA clave: el Panel no pone el código en la clave.
select is(pg_temp.resumen(pg_temp.cerrar('5126', 'idempotent_retries_test-cierre-0001')), 'incorrect_code/3/-',
  'A: otro codigo equivocado con la misma clave es un intento nuevo: quedan 3');
select is(pg_temp.fallidos('pedido_a') || '/' || pg_temp.anotados('pedido_a'), '2/2', 'A: dos intentos, dos filas');
select is(pg_temp.resumen(pg_temp.cerrar('9038', 'idempotent_retries_test-cierre-0001')), 'incorrect_code/3/true',
  'A: repetir el primero contesta con lo que queda AHORA (3), sin contar');
select is(pg_temp.resumen(pg_temp.cerrar('5126', 'idempotent_retries_test-cierre-0001')), 'incorrect_code/3/true',
  'A: y repetir el segundo, tambien');
select is(pg_temp.fallidos('pedido_a') || '/' || pg_temp.anotados('pedido_a'), '2/2', 'A: siguen siendo dos');

-- El intento es de quien lo tipeó: otra persona con la misma clave y el mismo código es otro intento.
select pg_temp.como('owner');
select is(pg_temp.resumen(pg_temp.cerrar('9038', 'idempotent_retries_test-cierre-0001')), 'incorrect_code/2/-',
  'A: el mismo codigo equivocado tipeado por OTRA persona cuenta: no es su reintento');
select pg_temp.como('staff');
-- Otra clave (otra pestaña, otra revisión) con un código ya probado: intento nuevo.
select is(pg_temp.resumen(pg_temp.cerrar('9038', 'idempotent_retries_test-cierre-0002')), 'incorrect_code/1/-',
  'A: el mismo codigo con OTRA clave es otro envio: cuenta');
select is(pg_temp.fallidos('pedido_a') || '/' || pg_temp.anotados('pedido_a'), '4/4', 'A: cuatro intentos, cuatro filas');

-- El quinto activa la demora, como siempre.
create temporary table r5 on commit drop as select pg_temp.cerrar('5126', 'idempotent_retries_test-cierre-0002') as r;
select is(pg_temp.resumen((select r from r5)) || '/' || (select r ->> 'retry_after_seconds' from r5), 'temporarily_locked/0/-/300',
  'A: el quinto intento equivocado activa la demora de 5 minutos');
select ok((select locked_until > clock_timestamp() + interval '4 minutes' from public.order_delivery_handoffs where order_id = pg_temp.id('pedido_a'))
  and pg_temp.fallidos('pedido_a') = 5, 'A: cinco intentos y la demora escrita en la fila del pedido');

-- Con la demora activa nadie cuenta: ni la repetición, ni un código nuevo, ni el bueno.
create temporary table r6 on commit drop as select pg_temp.cerrar('5126', 'idempotent_retries_test-cierre-0002') as r;
select ok((select r ->> 'code' = 'temporarily_locked' and (r ->> 'retry_after_seconds')::integer between 1 and 300 from r6),
  'A: repetir el envio que activo la demora contesta temporarily_locked con los segundos que faltan');
select is(pg_temp.resumen(pg_temp.cerrar('4417', 'idempotent_retries_test-cierre-0003')), 'temporarily_locked/-/-',
  'A: con la demora activa ni el codigo bueno entra');
select is(pg_temp.fallidos('pedido_a') || '/' || pg_temp.estado('pedido_a'), '5/on_the_way',
  'A: la demora no conto intentos y el pedido sigue en reparto');

-- Pasa la demora.
update public.order_delivery_handoffs set locked_until = clock_timestamp() - interval '1 second' where order_id = pg_temp.id('pedido_a');
select is(pg_temp.resumen(pg_temp.cerrar('9038', 'idempotent_retries_test-cierre-0001')), 'incorrect_code/0/true',
  'A: pasada la demora, la repeticion de un envio ya contado sigue sin contar (quedan 0)');
select is(pg_temp.resumen(pg_temp.cerrar('5126', 'idempotent_retries_test-cierre-0002')), 'incorrect_code/0/true',
  'A: tambien la del envio que habia activado la demora');
select ok((select locked_until < clock_timestamp() from public.order_delivery_handoffs where order_id = pg_temp.id('pedido_a'))
  and pg_temp.fallidos('pedido_a') = 5, 'A: y ninguna de las dos volvio a activar la demora');
-- Un código equivocado NUEVO sí: sexto intento, demora doble.
create temporary table r7 on commit drop as select pg_temp.cerrar('7340', 'idempotent_retries_test-cierre-0002') as r;
select is(pg_temp.resumen((select r from r7)) || '/' || (select r ->> 'retry_after_seconds' from r7), 'temporarily_locked/0/-/600',
  'A: un codigo equivocado nuevo despues de la demora la activa otra vez, por el doble');
select is(pg_temp.fallidos('pedido_a'), 6, 'A: seis intentos');

-- Del código tipeado no queda nada legible.
select is(
  (select array_agg(a.request_id order by a.request_id) from public.delivery_confirmation_attempts a
    where a.order_id = pg_temp.id('pedido_a') and a.request_id ~ '-[0-9a-f]{16}$'),
  (select array_agg(h order by h) from unnest(array[
     pg_temp.huella('pedido_a', 'idempotent_retries_test-cierre-0001', '9038'),
     pg_temp.huella('pedido_a', 'idempotent_retries_test-cierre-0001', '9038'),
     pg_temp.huella('pedido_a', 'idempotent_retries_test-cierre-0001', '5126'),
     pg_temp.huella('pedido_a', 'idempotent_retries_test-cierre-0002', '9038'),
     pg_temp.huella('pedido_a', 'idempotent_retries_test-cierre-0002', '5126'),
     pg_temp.huella('pedido_a', 'idempotent_retries_test-cierre-0002', '7340')]) as h),
  'A: cada intento equivocado se anota como clave + huella CON CLAVE del codigo tipeado (la de dos personas con la misma clave y codigo es la misma)');
select is(
  (select count(*)::integer from public.delivery_confirmation_attempts a
    where a.order_id = pg_temp.id('pedido_a')
      and (right(a.request_id, 16) in (
             select substr(encode(extensions.digest(c, 'sha256'), 'hex'), 1, 16) from unnest(array['9038','5126','7340','4417']) as c
             union all select substr(md5(c), 1, 16) from unnest(array['9038','5126','7340','4417']) as c)
           or a.request_id ~ '-(9038|5126|7340|4417)$')),
  0, 'A: ninguna fila lleva el codigo ni una huella sin clave, que se revierte probando diez mil codigos');
select is(
  (select count(*)::integer
     from public.delivery_confirmation_attempts a, lateral jsonb_each_text(to_jsonb(a)) as campo
    where a.order_id = pg_temp.id('pedido_a') and campo.value in ('9038', '5126', '7340', '4417')),
  0, 'A: ninguna columna de los intentos guarda un codigo tipeado');
select is((select count(*)::integer from public.business_command_receipts where order_id = pg_temp.id('pedido_a')), 1,
  'A: un codigo equivocado no deja recibo de comando: el unico es el del despacho');

-- Pasa la demora otra vez: el código bueno entrega.
update public.order_delivery_handoffs set locked_until = clock_timestamp() - interval '1 second' where order_id = pg_temp.id('pedido_a');
create temporary table r8 on commit drop as select pg_temp.cerrar('4417', 'idempotent_retries_test-cierre-0004') as r;
select is((select r ->> 'outcome' from r8) || '/' || (select r ->> 'code_verified' from r8) || '/' || (select r ->> 'idempotent_replay' from r8),
  'confirmed/true/false', 'A: despues de todo eso, el codigo bueno cierra la entrega');
select is(pg_temp.estado('pedido_a') || '/' || pg_temp.fallidos('pedido_a'), 'delivered/0', 'A: entregado, y los intentos fallidos en cero');
select is(
  public.confirm_business_delivery_code(pg_temp.id('pedido_a'), pg_temp.rev('pedido_a') - 1, '4417', 'idempotent_retries_test-cierre-0004') ->> 'idempotent_replay',
  'true', 'A: repetir el cierre confirmado devuelve su recibo');
select is(
  public.confirm_business_delivery_code(pg_temp.id('pedido_a'), pg_temp.rev('pedido_a') - 1, '9038', 'idempotent_retries_test-cierre-0001') ->> 'outcome',
  'already_delivered', 'A: y un envio viejo con codigo equivocado encuentra el pedido entregado');
select is(
  (select count(*)::integer
     from (select r.result as doc from public.business_command_receipts r where r.order_id = pg_temp.id('pedido_a')
           union all select e.metadata from public.order_events e where e.order_id = pg_temp.id('pedido_a')
           union all select e.payload from public.order_events e where e.order_id = pg_temp.id('pedido_a')) docs,
          lateral jsonb_each_text(docs.doc) as campo
    where campo.value in ('9038', '5126', '7340', '4417')),
  0, 'A: ni el recibo ni los eventos del pedido guardan un codigo');
select ok(obj_description('public.confirm_business_delivery_code(uuid,bigint,text,text)'::regprocedure, 'pg_proc') like '%no gasta otro intento%',
  'el comentario de la funcion dice lo que pasa con el reintento de un codigo equivocado');

-- ══ 2 · ACEPTAR UNA OFERTA: LAS RESPUESTAS DE SIEMPRE ═════════════════════════
create temporary table ofertas (k text primary key, r jsonb) on commit drop;
select pg_temp.como('staff');
insert into ofertas select 'b', public.offer_order_to_rider(pg_temp.id('pedido_b'), 'ready', null, pg_temp.id('rider1'));
insert into ofertas select 'c', public.offer_order_to_rider(pg_temp.id('pedido_c'), 'ready', null, pg_temp.id('rider1'));
insert into ofertas select 'd', public.offer_order_to_rider(pg_temp.id('pedido_d'), 'ready', null, pg_temp.id('rider2'));
select is((select string_agg(r ->> 'code', ',' order by k) from ofertas), 'offered,offered,offered', 'B, C y D quedan ofrecidos');
create function pg_temp.oferta(p_k text) returns uuid language sql as $$ select (r ->> 'offer_id')::uuid from ofertas where k = p_k $$;

-- Una oferta ajena es indistinguible de una inexistente.
select pg_temp.como('rider2');
select throws_ok(format('select public.accept_rider_order_offer(%L, 1, %L)', pg_temp.oferta('b'), 'idempotent_retries_test-acepta-ajena'),
  'P0002', 'oferta inexistente', 'B: otro repartidor no puede aceptar una oferta que no es suya');
select pg_temp.como('rider1');
select is(public.accept_rider_order_offer(pg_temp.oferta('b'), 7, 'idempotent_retries_test-acepta-vieja') ->> 'code', 'stale_version',
  'B: con una version vieja de la oferta contesta stale_version');
select is(pg_temp.estado('pedido_b') || '/' || (select status from public.rider_order_offers where id = pg_temp.oferta('b')), 'ready/pending',
  'B: y nada se movio');
create temporary table a1 on commit drop as
  select public.accept_rider_order_offer(pg_temp.oferta('b'), 1, 'idempotent_retries_test-acepta-0001') as r;
select is((select concat_ws('/', r ->> 'ok', r ->> 'code', r ->> 'idempotent_no_op', r ->> 'active_orders') from a1), 'true/accepted/false/1',
  'B: el repartidor acepta su oferta');
select is(pg_temp.estado('pedido_b') || '/' || (select assigned_rider_user_id = pg_temp.id('rider1') from public.orders where id = pg_temp.id('pedido_b'))::text
    || '/' || (select status from public.rider_order_offers where id = pg_temp.oferta('b')),
  'assigned/true/accepted', 'B: el pedido queda asignado a el y la oferta aceptada');
select is((select concat_ws('/', r ->> 'code', r ->> 'idempotent_no_op') from
    (select public.accept_rider_order_offer(pg_temp.oferta('b'), 1, 'idempotent_retries_test-acepta-0001') as r) x),
  'accepted/true', 'B: el mismo envio otra vez devuelve el resultado guardado');
select is((select concat_ws('/', r ->> 'code', r ->> 'idempotent_no_op') from
    (select public.accept_rider_order_offer(pg_temp.oferta('b'), 2, 'idempotent_retries_test-acepta-0002') as r) x),
  'already_accepted/true', 'B: y otro envio encuentra la oferta ya aceptada');
select is((select count(*)::integer from public.order_events where order_id = pg_temp.id('pedido_b') and event_type = 'order.rider_accepted_offer'), 1,
  'B: un solo evento de aceptacion');

-- La oferta retirada por el comercio ya no se acepta.
select pg_temp.como('staff');
select is(public.withdraw_rider_order_offer(pg_temp.oferta('c')) ->> 'code', 'withdrawn', 'C: el comercio retira la oferta');
select pg_temp.como('rider1');
select is((select concat_ws('/', r ->> 'ok', r ->> 'code', r ->> 'offer_status') from
    (select public.accept_rider_order_offer(pg_temp.oferta('c'), 1, 'idempotent_retries_test-acepta-0003') as r) x),
  'false/offer_not_available/withdrawn', 'C: aceptar una oferta retirada contesta offer_not_available');
select is(pg_temp.estado('pedido_c') || '/' || coalesce((select assigned_rider_user_id::text from public.orders where id = pg_temp.id('pedido_c')), 'sin repartidor'),
  'ready/sin repartidor', 'C: el pedido sigue listo y sin repartidor');

-- El comercio exige presencia y el repartidor no esta disponible: la rama propia de esta función.
select pg_temp.como('owner');
select is(public.set_business_rider_presence_policy(pg_temp.id('business'), true) ->> 'changed', 'true', 'el comercio pasa a exigir presencia');
select pg_temp.como('rider2');
select is(public.accept_rider_order_offer(pg_temp.oferta('d'), 1, 'idempotent_retries_test-acepta-0004')::text,
  '{"ok": false, "code": "rider_unavailable"}', 'D: sin presencia vigente contesta rider_unavailable');
select is(pg_temp.estado('pedido_d') || '/' || (select status from public.rider_order_offers where id = pg_temp.oferta('d')), 'ready/pending',
  'D: y la oferta sigue pendiente');
select is(public.set_rider_availability(pg_temp.id('business'), true, 0, 'idempotent_retries_test-presente-0001') ->> 'code', 'updated',
  'D: el repartidor se marca disponible');
select is(public.accept_rider_order_offer(pg_temp.oferta('d'), 1, 'idempotent_retries_test-acepta-0004') ->> 'code', 'accepted',
  'D: y ahora si acepta, con la misma clave');
select is(pg_temp.estado('pedido_d'), 'assigned', 'D: pedido asignado');
select pg_temp.como('rider1');
select is(public.accept_rider_order_offer(pg_temp.oferta('b'), 1, 'idempotent_retries_test-acepta-0001') ->> 'idempotent_no_op', 'true',
  'B: con presencia exigida y el repartidor ausente, repetir una aceptacion ya hecha sigue devolviendo su resultado');
select pg_temp.como('owner');
select is(public.set_business_rider_presence_policy(pg_temp.id('business'), false) ->> 'changed', 'true', 'el comercio deja de exigir presencia');

-- ══ 3 · LA PUERTA DEL REPARTIDOR NO CAMBIÓ ═════════════════════════════════════
select pg_temp.como('rider1');
select is(public.mark_delivery_picked_up(pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), 'idempotent_retries_test-retira-b') ->> 'outcome', 'picked_up', 'B: retirado');
select is(public.start_rider_delivery(pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), 'idempotent_retries_test-sale-b') ->> 'outcome', 'route_started', 'B: en camino');
select is(public.mark_rider_arrived(pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), 'idempotent_retries_test-llega-b') ->> 'outcome', 'arrived', 'B: llego');
select is((select concat_ws('/', r ->> 'code', r ->> 'remaining_attempts', coalesce(r ->> 'idempotent_no_op', '-')) from
    (select public.confirm_delivery_code(pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), '9038', 'idempotent_retries_test-entrega-b-0001') as r) x),
  'incorrect_code/4/-', 'B: el repartidor tipea un codigo equivocado: quedan 4');
select is((select concat_ws('/', r ->> 'code', r ->> 'remaining_attempts', coalesce(r ->> 'idempotent_no_op', '-')) from
    (select public.confirm_delivery_code(pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), '9038', 'idempotent_retries_test-entrega-b-0001') as r) x),
  'incorrect_code/4/true', 'B: su reintento devuelve el resultado guardado de esa clave');
select is((select concat_ws('/', r ->> 'code', r ->> 'remaining_attempts', coalesce(r ->> 'idempotent_no_op', '-')) from
    (select public.confirm_delivery_code(pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), '5126', 'idempotent_retries_test-entrega-b-0001') as r) x),
  'incorrect_code/4/true', 'B: en esta puerta la clave sola identifica el envio (la app del repartidor pone el codigo en la clave)');
select is(pg_temp.fallidos('pedido_b') || '/' || pg_temp.anotados('pedido_b'), '1/1', 'B: un intento contado');
-- El comercio no puede cerrar un pedido que lleva un repartidor, tampoco para «reintentar».
select pg_temp.como('staff');
select throws_ok(format('select public.confirm_business_delivery_code(%L, %s, %L, %L)', pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), '2580',
    'idempotent_retries_test-cierre-b-0001'),
  '42501', 'la entrega la confirma el repartidor asignado', 'B: el cierre del comercio sigue sin tocar un pedido con repartidor');
select pg_temp.como('rider1');
select is(public.confirm_delivery_code(pg_temp.id('pedido_b'), pg_temp.rev('pedido_b'), '2580', 'idempotent_retries_test-entrega-b-0002') ->> 'outcome',
  'confirmed', 'B: con el codigo bueno el repartidor entrega');
select is(pg_temp.estado('pedido_b') || '/' || pg_temp.fallidos('pedido_b'), 'delivered/0', 'B: entregado');

-- ══ 4 · LA LIBRETA DE DIRECCIONES, EN SERIE ════════════════════════════════════
-- ¿Tiene esta transacción el candado de la libreta de ese cliente?
create function pg_temp.libreta_tomada(p_k text) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 2
       and l.database = (select d.oid from pg_database d where d.datname = current_database())
       and l.classid = hashtext('taba.customer_addresses')::oid
       and l.objid = hashtext(pg_temp.id(p_k)::text)::oid);
$$;
select pg_temp.sin_sesion();
select throws_ok($$select public.upsert_current_customer_address('{"label":"Casa","street":"Calle IRT","streetNumber":"10","city":"Neuquen"}'::jsonb)$$,
  '42501', 'autenticacion de cliente requerida', 'sin sesion, guardar una direccion es 42501');
select throws_ok(format('select public.set_current_customer_default_address(%L)', gen_random_uuid()),
  '42501', 'autenticacion de cliente requerida', 'sin sesion, elegir la principal es 42501');
select throws_ok(format('select public.archive_current_customer_address(%L)', gen_random_uuid()),
  '42501', 'autenticacion de cliente requerida', 'sin sesion, archivar es 42501');

select pg_temp.como_cliente('cliente1');
select throws_ok($$select public.upsert_current_customer_address('{"label":"Casa","street":"Calle IRT","streetNumber":"10","city":"Neuquen"}'::jsonb)$$,
  '22023', null, 'una direccion sin perfil de cliente se rechaza como antes');
select is(public.upsert_current_customer_profile('Cliente Uno', '2996000001') ->> 'name', 'Cliente Uno', 'cliente1 guarda su perfil');
-- (El intento rechazado de arriba corrio en un subbloque que se deshizo, con su candado.)
select ok(not pg_temp.libreta_tomada('cliente1'), 'guardar el perfil no toma el candado de la libreta');

create temporary table d1 on commit drop as
  select public.upsert_current_customer_address('{"label":"Casa","street":"Calle IRT","streetNumber":"10","city":"Neuquen"}'::jsonb) as r;
select is((select concat_ws('/', r ->> 'ok', r -> 'address' ->> 'isDefault') from d1), 'true/true', 'la primera direccion se guarda y queda como principal');
select ok(pg_temp.libreta_tomada('cliente1') and not pg_temp.libreta_tomada('cliente2') and not pg_temp.libreta_tomada('cliente3'),
  'guardar una direccion toma el candado de la libreta de ESE cliente y de nadie mas');
create temporary table d2 on commit drop as
  select public.upsert_current_customer_address('{"label":"Casa otra vez","street":"calle  irt","streetNumber":"10","city":"NEUQUEN"}'::jsonb) as r;
select is((select concat_ws('/', r ->> 'ok', r ->> 'code') from d2), 'false/duplicate', 'el mismo guardado otra vez contesta duplicate');
select is((select r -> 'address' ->> 'id' from d2), (select r -> 'address' ->> 'id' from d1), 'y devuelve la direccion que ya estaba');
select is((select count(*)::integer from public.customer_addresses where customer_id = pg_temp.id('cliente1')), 1, 'una sola fila');
create temporary table d3 on commit drop as
  select public.upsert_current_customer_address('{"label":"Trabajo","street":"Calle IRT","streetNumber":"20","city":"Neuquen"}'::jsonb) as r;
select is((select concat_ws('/', r ->> 'ok', r -> 'address' ->> 'isDefault') from d3), 'true/false', 'otra direccion se guarda y no se roba la principal');
select is(public.set_current_customer_default_address(((select r from d3) -> 'address' ->> 'id')::uuid) ->> 'isDefault', 'true',
  'elegirla como principal la marca');
select is(
  (select string_agg(a.street_number, ',' order by a.street_number) from public.customer_addresses a
    where a.customer_id = pg_temp.id('cliente1') and a.is_default and a.deleted_at is null),
  '20', 'y queda una sola principal: la elegida');
select is(public.set_current_customer_default_address(((select r from d3) -> 'address' ->> 'id')::uuid) ->> 'isDefault', 'true',
  'elegir la que ya es principal no falla');
create temporary table d4 on commit drop as
  select public.archive_current_customer_address(((select r from d3) -> 'address' ->> 'id')::uuid) as r;
select is((select concat_ws('/', r ->> 'archived', r ->> 'replacementId') from d4), 'true/' || (select r -> 'address' ->> 'id' from d1),
  'archivar la principal la archiva y pasa la principal a la otra');
select is(
  (select string_agg(a.street_number, ',' order by a.street_number) from public.customer_addresses a
    where a.customer_id = pg_temp.id('cliente1') and a.is_default and a.deleted_at is null),
  '10', 'la principal vuelve a ser la primera');
select throws_ok(format('select public.archive_current_customer_address(%L)', (select r -> 'address' ->> 'id' from d3)),
  '42501', 'direccion no encontrada', 'archivarla otra vez contesta 42501, como antes');
select throws_ok(format('select public.set_current_customer_default_address(%L)', (select r -> 'address' ->> 'id' from d3)),
  '42501', 'direccion no encontrada', 'y una direccion archivada no se puede elegir como principal');

-- Las otras dos funciones también toman el candado por sí mismas: las direcciones de estos dos
-- clientes se cargan a mano, sin pasar por la función de guardar.
select pg_temp.como_cliente('cliente2');
select public.upsert_current_customer_profile('Cliente Dos', '2996000002');
select pg_temp.como_cliente('cliente3');
select public.upsert_current_customer_profile('Cliente Tres', '2996000003');
insert into irt_ids select 'dir_' || c || '_' || n, gen_random_uuid() from unnest(array['cliente2','cliente3']) as c, unnest(array['1','2']) as n;
insert into public.customer_addresses(id, customer_id, label, formatted_address, street, street_number, city, normalized_address, is_default)
select pg_temp.id('dir_' || c || '_' || n), pg_temp.id(c), 'Direccion ' || n, 'Calle IRT ' || n || '0, Neuquen', 'Calle IRT', n || '0', 'Neuquen',
       'idempotent_retries_test ' || c || ' ' || n, n = '1'
  from unnest(array['cliente2','cliente3']) as c, unnest(array['1','2']) as n;
select ok(not pg_temp.libreta_tomada('cliente2') and not pg_temp.libreta_tomada('cliente3'),
  'hasta aca nadie tomo el candado de la libreta de cliente2 ni de cliente3');
select pg_temp.como_cliente('cliente2');
select is(public.set_current_customer_default_address(pg_temp.id('dir_cliente2_2')) ->> 'isDefault', 'true', 'cliente2 elige su segunda direccion como principal');
select ok(pg_temp.libreta_tomada('cliente2') and not pg_temp.libreta_tomada('cliente3'),
  'elegir la principal toma el candado de la libreta de ese cliente');
select pg_temp.como_cliente('cliente3');
select is(public.archive_current_customer_address(pg_temp.id('dir_cliente3_1')) ->> 'replacementId', pg_temp.id('dir_cliente3_2')::text,
  'cliente3 archiva su principal: pasa a la otra');
select ok(pg_temp.libreta_tomada('cliente3'), 'archivar toma el candado de la libreta de ese cliente');
select is(
  (select count(*)::integer from (select a.customer_id from public.customer_addresses a
     where a.customer_id in (pg_temp.id('cliente1'), pg_temp.id('cliente2'), pg_temp.id('cliente3')) and a.is_default and a.deleted_at is null
     group by a.customer_id having count(*) = 1) uno),
  3, 'los tres clientes terminan con exactamente una direccion principal');
select pg_temp.sin_sesion();

-- ══ 5 · PERMISOS Y SEARCH_PATH DE LAS SIETE FUNCIONES ══════════════════════════
select is(
  (select string_agg(p.proname || ':' || coalesce((select string_agg(r.rolname, '+' order by r.rolname) from pg_roles r
       where r.rolname in ('anon', 'authenticated', 'service_role') and has_function_privilege(r.oid, p.oid, 'execute')), 'nadie'),
     ' ' order by p.proname)
     from pg_proc p where p.oid in (
       'public.record_payment_cancellation_response(uuid,text,text)'::regprocedure,
       'public.mark_payment_cancellation_ambiguous(uuid,text,text)'::regprocedure,
       'public.upsert_current_customer_address(jsonb)'::regprocedure,
       'public.set_current_customer_default_address(uuid)'::regprocedure,
       'public.archive_current_customer_address(uuid)'::regprocedure,
       'public.confirm_business_delivery_code(uuid,bigint,text,text)'::regprocedure,
       'public.accept_rider_order_offer(uuid,bigint,text)'::regprocedure)),
  'accept_rider_order_offer:authenticated archive_current_customer_address:authenticated confirm_business_delivery_code:authenticated'
  || ' mark_payment_cancellation_ambiguous:service_role record_payment_cancellation_response:service_role'
  || ' set_current_customer_default_address:authenticated upsert_current_customer_address:authenticated',
  'cada funcion la ejecuta quien la ejecutaba, y nadie mas');
select is(
  (select count(*)::integer from pg_proc p where p.oid in (
       'public.record_payment_cancellation_response(uuid,text,text)'::regprocedure,
       'public.mark_payment_cancellation_ambiguous(uuid,text,text)'::regprocedure,
       'public.upsert_current_customer_address(jsonb)'::regprocedure,
       'public.set_current_customer_default_address(uuid)'::regprocedure,
       'public.archive_current_customer_address(uuid)'::regprocedure,
       'public.confirm_business_delivery_code(uuid,bigint,text,text)'::regprocedure,
       'public.accept_rider_order_offer(uuid,bigint,text)'::regprocedure)
     and p.prosecdef and not has_function_privilege('public', p.oid, 'execute')
     and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=pg_catalog, public%pg_temp')),
  7, 'las siete son SECURITY DEFINER con search_path fijado y sin permiso para PUBLIC');

-- ══ 6 · TESTIGO DE TEXTO: EL ORDEN DE LOS CANDADOS EN LA DEFINICIÓN VIGENTE ════
-- No prueba concurrencia (eso es de la carrera). Avisa si alguien redefine una de estas
-- funciones a partir de una copia anterior al orden acordado.
create function pg_temp.donde(p_fn regprocedure, p_patron text, p_ocurrencia integer default 1) returns integer language sql as $$
  select regexp_instr(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), p_patron, 1, p_ocurrencia, 0, 'i')
    from pg_proc p where p.oid = p_fn;
$$;
select ok(
  pg_temp.donde('public.record_payment_cancellation_response(uuid,text,text)', 'from\s+public\.checkout_sessions\M[^;]*for\s+update') > 0
  and pg_temp.donde('public.record_payment_cancellation_response(uuid,text,text)', 'from\s+public\.checkout_sessions\M[^;]*for\s+update')
    < pg_temp.donde('public.record_payment_cancellation_response(uuid,text,text)', 'from\s+public\.payment_intents\M[^;]*for\s+update')
  and pg_temp.donde('public.record_payment_cancellation_response(uuid,text,text)', 'from\s+public\.payment_intents\M[^;]*for\s+update')
    < pg_temp.donde('public.record_payment_cancellation_response(uuid,text,text)', 'from\s+public\.payment_cancellations\M[^;]*for\s+update'),
  'record_payment_cancellation_response toma sesion -> cobro -> solicitud');
select ok(
  pg_temp.donde('public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'from\s+public\.payment_intents\M[^;]*for\s+share') > 0
  and pg_temp.donde('public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'from\s+public\.payment_intents\M[^;]*for\s+share')
    < pg_temp.donde('public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'from\s+public\.payment_cancellations\M[^;]*for\s+update'),
  'mark_payment_cancellation_ambiguous toma cobro -> solicitud');
select ok(
  pg_temp.donde('public.accept_rider_order_offer(uuid,bigint,text)', 'from\s+public\.orders\M[^;]*for\s+no\s+key\s+update') > 0
  and pg_temp.donde('public.accept_rider_order_offer(uuid,bigint,text)', 'from\s+public\.orders\M[^;]*for\s+no\s+key\s+update')
    < pg_temp.donde('public.accept_rider_order_offer(uuid,bigint,text)', 'from\s+public\.rider_order_offers\M[^;]*for\s+update')
  and pg_temp.donde('public.accept_rider_order_offer(uuid,bigint,text)', 'from\s+public\.rider_order_offers\M[^;]*for\s+update')
    < pg_temp.donde('public.accept_rider_order_offer(uuid,bigint,text)', 'accept_rider_order_offer_pre_presence', 2),
  'accept_rider_order_offer toma pedido (sin bloquear claves foraneas) -> oferta antes de delegar');

select * from finish();
rollback;
