-- ─────────────────────────────────────────────────────────────────────────────
-- UNA LECTURA DEL CLIENTE NO PUEDE INVALIDAR LA OFERTA DEL REPARTIDOR
--
-- ## Qué se rompía
--
-- El cliente abre su pantalla de seguimiento. Si el navegador no tiene guardado
-- un acceso vigente —una pestaña nueva, otro dispositivo, la caché limpia— la
-- aplicación llama a `recover_order_tracking_access` para emitirle un token
-- nuevo. Es, desde donde el cliente está parado, una LECTURA: mirar dónde viene
-- su pedido.
--
-- Esa función rota credenciales de seguimiento —eso sí es su trabajo— y además
-- hacía un `update public.orders set delivery_code_required = true` sin
-- condición. Como `orders_set_updated_at` mueve `updated_at` en cada UPDATE, el
-- trigger `orders_zz_bump_revision` veía la fila distinta y subía la revisión
-- del pedido aunque el valor escrito fuera el que ya estaba.
--
-- Y `rider_order_offers` guarda `expected_order_revision`. Subida la revisión,
-- la oferta viva queda atada a un número que ya no existe: el repartidor toca
-- «Aceptar», la app llama al servidor, el servidor rechaza, y la pantalla dice
-- «La solicitud cambió. Actualizamos la lista.». Para siempre — la revisión no
-- vuelve atrás—. La única salida era que el comercio retirara la oferta y
-- volviera a ofrecerla.
--
-- ## Medido, con números, en LT-0002 el 2026-08-22
--
--   19:10:02  order.rider_offered              → expected_order_revision = 7
--   19:13:18  order.tracking_access_recovered  → orders.revision = 8
--   desde ahí  «Aceptar» en el teléfono → rechazado, sin excepción
--
-- ## Qué cambia acá, y qué NO
--
-- CAMBIA: el UPDATE pasa a ser condicional. Se escribe sólo si el valor tiene
-- que cambiar. Nada más.
--
-- NO CAMBIA: la concurrencia optimista sigue igual de estricta. Un cambio real
-- del pedido —que el comercio lo cancele, que cambie de estado, que se
-- reasigne— sigue subiendo la revisión y sigue invalidando las ofertas viejas,
-- que es exactamente para lo que está el mecanismo. Tampoco se toca el CAS de
-- asignación, ni se acepta una oferta obsoleta, ni se relaja ninguna política.
--
--
-- ## Un cuidado que esta migración tuvo que aprender a los golpes
--
-- El cuerpo de esta función se reescribe entero, así que arrastra TODO lo que
-- se le haya corregido desde que se creó. Y había algo corregido: la migración
-- 20260725130000 ya había cambiado el regex del token de `{32,256}` a
-- `{32,255}[A-Za-z0-9_-]?`, porque PostgreSQL no acepta repeticiones mayores a
-- 255 y la función levantaba `2201B: invalid regular expression` en cada
-- llamada. Copiar el cuerpo de 20260725100000 tal cual REVIRTIÓ ese arreglo, y
-- se descubrió recién al probar la función viva contra producción —el ensayo
-- estático no lo veía—. Queda escrito acá: al reemplazar una función, lo que
-- hay que mirar es la definición DESPLEGADA, no el archivo donde nació.
--
-- Forward-only. No toca 1..112.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.recover_order_tracking_access(
  p_order_id uuid,
  p_new_tracking_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_random bytea;
  v_code text;
  v_token_expires_at timestamptz;
  v_code_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_new_tracking_token is null
    or p_new_tracking_token !~ '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$' then
    raise exception 'credenciales de seguimiento invalidas' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
   for update;

  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if found and v_handoff.confirmed_at is not null then
    raise exception 'entrega ya confirmada' using errcode = '55000';
  end if;

  v_token_expires_at := clock_timestamp() + interval '30 days';
  v_code_expires_at := clock_timestamp() + interval '48 hours';

  v_random := gen_random_bytes(3);
  v_code := (
    1000 + (
      get_byte(v_random, 0)::bigint * 65536
      + get_byte(v_random, 1)::bigint * 256
      + get_byte(v_random, 2)::bigint
    ) % 9000
  )::text;

  update public.order_public_tokens
     set revoked_at = coalesce(revoked_at, clock_timestamp())
   where order_id = v_order.id
     and revoked_at is null;

  insert into public.order_public_tokens (
    order_id,
    token_hash,
    expires_at
  ) values (
    v_order.id,
    digest(p_new_tracking_token, 'sha256'),
    v_token_expires_at
  );

  -- A rotated digest has no operational value. Remove prior revoked digests for
  -- this order so repeated recovery does not create indefinite bearer history.
  delete from public.order_public_tokens
   where order_id = v_order.id
     and revoked_at is not null;

  insert into public.order_delivery_handoffs (
    order_id,
    code_hash,
    code_ciphertext,
    failed_attempts,
    locked_until,
    confirmed_at,
    confirmed_by_user_id,
    expires_at
  ) values (
    v_order.id,
    crypt(v_code, gen_salt('bf', 10)),
    pgp_sym_encrypt(v_code, p_new_tracking_token, 'cipher-algo=aes256,compress-algo=0'),
    0,
    null,
    null,
    null,
    least(v_token_expires_at, v_code_expires_at)
  )
  on conflict (order_id) do update
     set code_hash = excluded.code_hash,
         code_ciphertext = excluded.code_ciphertext,
         failed_attempts = 0,
         locked_until = null,
         confirmed_at = null,
         confirmed_by_user_id = null,
         expires_at = excluded.expires_at;

  -- ── EL ARREGLO DE 2026-08-22 ─────────────────────────────────────────────
  -- Este UPDATE era incondicional, y ahí estaba el defecto. `delivery_code_required`
  -- ya vale `true` en todo pedido con entrega desde que se creó, así que escribirlo
  -- de nuevo no cambiaba nada... salvo que `orders_set_updated_at` mueve `updated_at`
  -- en cada UPDATE, con lo cual `orders_zz_bump_revision` veía la fila distinta y
  -- subía `orders.revision`.
  --
  -- Consecuencia medida en LT-0002: la oferta al repartidor se emitió esperando la
  -- revisión 7; el cliente abrió su pantalla de seguimiento; esta función corrió;
  -- la revisión pasó a 8; y desde entonces el botón «Aceptar» del teléfono llamaba
  -- al servidor y volvía rechazado —«La solicitud cambió»— para siempre, porque la
  -- revisión no vuelve atrás. Un cliente mirando dónde viene su pedido dejaba al
  -- repartidor sin poder aceptarlo.
  --
  -- La condición no debilita nada: la garantía sigue siendo la misma —al salir de
  -- acá el pedido exige código de entrega— y sólo se escribe cuando hace falta
  -- escribir. La concurrencia optimista queda intacta: un cambio REAL del pedido
  -- sigue subiendo la revisión e invalidando ofertas viejas, que es para lo que
  -- está.
  update public.orders
     set delivery_code_required = true
   where id = v_order.id
     and delivery_code_required is distinct from true;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    auth.uid(),
    'customer',
    'customer',
    auth.uid(),
    'order.tracking_access_recovered',
    'order.tracking_access_recovered',
    'Acceso de seguimiento recuperado por el cliente',
    jsonb_build_object('rotated_at', clock_timestamp()),
    jsonb_build_object('rotated_at', clock_timestamp())
  );

  return jsonb_build_object(
    'ok', true,
    'public_code', v_order.public_code,
    'delivery_code', v_code,
    'token_expires_at', v_token_expires_at,
    'code_expires_at', least(v_token_expires_at, v_code_expires_at)
  );
end;
$$;

comment on function public.recover_order_tracking_access(uuid, text) is
  'Rota el acceso de seguimiento del cliente. Desde 2026-08-22 no sube orders.revision cuando no cambia nada: una lectura del cliente no invalida la oferta viva del repartidor.';
