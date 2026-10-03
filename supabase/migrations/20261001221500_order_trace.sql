-- La traza de un pedido: una sola llamada, cualquier identificador, ningún dato personal.
--
-- QUÉ HABÍA (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   Para contestar «pagué y no me llegó nada» no existía ninguna función. Había
--   que entrar con la clave de servicio y unir a mano unas quince tablas, leyendo
--   de paso nombre, teléfono, dirección y coordenadas del cliente:
--
--     · `orders` no tiene columna de checkout ni de intento de pago. El vínculo es
--       `checkout_sessions.completed_order_id` o `payment_intents.order_id`, y
--       ninguno de los dos tenía índice.
--     · La clave que eligió el cliente no está en el pedido: un pedido de Mercado
--       Pago guarda `client_request_id = 'mp_' || <sesión sin guiones>`. Buscar el
--       pedido por la clave del cliente devolvía cero filas con la plata adentro.
--     · El dueño no puede leer `checkout_sessions`, `payment_intents`,
--       `payment_events`, `payment_webhook_receipts`, `inventory_reservations`,
--       `order_public_tokens` ni ninguna tabla del repartidor (a propósito: el
--       límite es por RPC). `list_business_payments` corta en 200 filas sin filtro.
--     · Lo más parecido, `list_operational_pipeline`, devuelve el nombre del cliente.
--
-- QUÉ AGREGA
--
--   public.get_order_trace(p_business_id, p_reference)
--       Dueño, administrador o personal de ESE negocio. Una referencia de otro
--       negocio contesta exactamente lo mismo que una que no existe.
--   public.get_order_trace_service(p_reference, p_business_id default null)
--       Sólo `service_role` (soporte). Sin negocio busca en todos; si la
--       referencia calza en más de uno contesta `ambiguous` con los candidatos.
--
--   `p_reference` acepta: id del pedido, código público (LT-0001), clave de
--   idempotencia del pedido o del checkout, id de la sesión de checkout, id del
--   intento de pago, id de un intento de preferencia, id del pago en el
--   proveedor, referencia externa, id de preferencia, id del token de
--   seguimiento (nunca el token) e id de correlación.
--
--   Devuelve UN documento:
--     identifiers  todos los identificadores de la cadena, ya unidos
--     state        estado actual: pedido, pago, checkout, stock, entrega, repartidor
--     timeline     una sola línea de tiempo ordenada: {at, stage, source, event,
--                  actor_role, actor_ref, details}
--     gaps         lo que NO se pudo unir, dicho con un código estable
--
-- QUÉ NO SALE NUNCA
--
--   Nombre, teléfono, dirección, notas, coordenadas, correo, el token de
--   seguimiento, el código de entrega, el id de usuario del cliente, la huella de
--   red, los hashes de idempotencia ni el `result` de ningún comando (trae el
--   pedido entero). No se usa `to_jsonb(fila)` en ninguna parte: cada columna que
--   sale está escrita. De los JSON libres (`order_events.metadata`,
--   `payment_events.details`) sale sólo una lista cerrada de claves, y sólo si el
--   valor es un número, un booleano o un texto sin espacios: un motivo escrito a
--   mano no pasa aunque alguien lo guarde bajo una clave permitida. De un error
--   (de la cola de cobros, de un aviso, de una impresión) sale su código si tiene
--   forma de código, y si no, sólo que hay un error: nunca el texto. El personal
--   y los repartidores figuran con su rol y una referencia corta derivada
--   (`op_…`), estable dentro del negocio y distinta en cada negocio.
--
-- LÍMITES
--
--   Cada fuente aporta hasta 200 filas, las MÁS NUEVAS: en un pedido con una
--   historia desmedida lo que hace falta ver es lo último que pasó. La línea de
--   tiempo devuelve hasta 500 entradas; si hay más, quedan las primeras 100 (cómo
--   nació) y las últimas 400 (cómo está), y `timeline_omitted` dice cuántas del
--   medio no se muestran. `truncated` y `sources_at_cap` lo dicen cuando pasa.
--   Es de sólo lectura (STABLE): no escribe ni una fila.
--
-- QUÉ NO CAMBIA
--
--   Ninguna función existente, ningún privilegio de tabla: las tablas de pagos y
--   del repartidor siguen cerradas para `authenticated`. Cuatro índices nuevos
--   para que la traza no recorra tablas enteras (los dos primeros los pedía el
--   vínculo pedido → checkout → pago; los otros dos, los avisos por id de pago y
--   los movimientos de stock por referencia).
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001221500_order_trace.rollback.sql

-- ── 1. Índices del vínculo ──────────────────────────────────────────────────
create index if not exists checkout_sessions_completed_order_idx
  on public.checkout_sessions (completed_order_id)
  where completed_order_id is not null;

create index if not exists payment_intents_order_idx
  on public.payment_intents (order_id)
  where order_id is not null;

-- Los avisos rechazados también se guardan y cualquiera puede mandarlos: sin
-- índice, buscar los de un pago sería recorrer una tabla que crece desde afuera.
create index if not exists payment_webhook_receipts_resource_idx
  on public.payment_webhook_receipts (resource_id, received_at);

create index if not exists inventory_movements_reference_idx
  on public.inventory_movements (reference_id)
  where reference_id is not null;

-- ── 2. Piezas chicas ────────────────────────────────────────────────────────
-- La referencia de una persona del negocio: corta, estable, y con el negocio
-- adentro para que la misma persona no sea rastreable entre negocios.
create or replace function private.order_trace_actor_ref(p_business_id uuid, p_user_id uuid)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_user_id is null then null
    else 'op_' || substr(encode(sha256(convert_to(
      coalesce(p_business_id::text, '-') || ':' || p_user_id::text, 'UTF8')), 'hex'), 1, 12)
  end;
$$;
revoke all on function private.order_trace_actor_ref(uuid, uuid) from public, anon, authenticated;

-- De un JSON libre sale sólo lo que está en la lista, y sólo si tiene forma de
-- dato de máquina (número, booleano, o texto sin espacios de hasta 80 caracteres:
-- un estado, un id, una fecha). La forma es la segunda traba: la lista es la primera.
create or replace function private.order_trace_safe_details(p_source jsonb, p_keys text[])
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p_source) = 'object' then p_source else '{}'::jsonb end) e
   where e.key = any (p_keys)
     and (
       jsonb_typeof(e.value) in ('number', 'boolean')
       or (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[A-Za-z0-9_.:+-]{1,80}$')
     );
$$;
revoke all on function private.order_trace_safe_details(jsonb, text[]) from public, anon, authenticated;

-- Un texto que la base guarda como código (un motivo de revisión, un estado del
-- proveedor): pasa si tiene forma de código; si no, no se muestra.
create or replace function private.order_trace_code(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_value ~ '^[A-Za-z0-9_.:-]{1,80}$' then p_value end;
$$;
revoke all on function private.order_trace_code(text) from public, anon, authenticated;

-- Un id que llega como texto (la referencia que escribe quien pregunta, o un id
-- guardado adentro de un JSON libre): es un uuid sólo si tiene su forma exacta.
-- Cualquier otra cosa es NULL; nunca un error de conversión que tire la traza.
create or replace function private.order_trace_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
  end;
$$;
revoke all on function private.order_trace_uuid(text) from public, anon, authenticated;

-- ── 3. El documento ─────────────────────────────────────────────────────────
-- p_business_id NULL = sin límite de negocio. Sólo la variante de servicio puede
-- llamarla así: esta función no tiene EXECUTE para ningún rol de la API.
create or replace function private.order_trace_document(p_business_id uuid, p_reference text)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_timeline_limit constant integer := 500;
  -- Cuando la historia no entra: las primeras tantas y el resto del cupo para las últimas.
  c_timeline_head constant integer := 100;
  c_source_cap constant integer := 200;
  v_now timestamptz := clock_timestamp();
  v_ref text := btrim(coalesce(p_reference, ''));
  v_uuid uuid;
  v_mp_session uuid;
  v_candidates jsonb;
  v_pick jsonb;
  v_kind text;
  v_business uuid;
  v_order_id uuid;
  v_session_id uuid;
  v_intent_id uuid;
  v_order record;
  v_session record;
  v_intent record;
  v_receipt_ids uuid[] := '{}'::uuid[];
  v_receipt_only boolean := false;
  v_intake jsonb := '[]'::jsonb;
  v_intake_available boolean := true;
  v_tokens jsonb := '[]'::jsonb;
  v_timeline jsonb;
  v_total integer;
  v_at_cap jsonb;
  v_reservations jsonb;
  v_handoff jsonb;
  v_rider jsonb;
  v_units numeric;
  v_item_lines integer;
  v_movements integer := 0;
  v_notifications integer := 0;
  v_gaps jsonb := '[]'::jsonb;
  c_not_found constant jsonb := jsonb_build_object('found', false, 'reason', 'not_found');
begin
  if v_ref = '' or char_length(v_ref) > 200 then
    return c_not_found;
  end if;
  v_uuid := private.order_trace_uuid(v_ref);
  -- La clave que `finalize_paid_checkout_session` le pone al pedido lleva adentro
  -- el id de la sesión: sirve aunque el pedido todavía no haya nacido.
  if v_ref ~ '^mp_[0-9a-f]{32}$' then
    v_mp_session := substr(v_ref, 4)::uuid;
  end if;

  -- ── Resolver: gana el primer criterio que encuentra algo ──────────────────
  with candidate as materialized (
    select 10 as priority, 'order_id'::text as kind, o.id as order_id, null::uuid as session_id,
           null::uuid as intent_id, o.business_id, o.created_at
      from public.orders o
     where v_uuid is not null and o.id = v_uuid
       and (p_business_id is null or o.business_id = p_business_id)
    union all
    select 20, 'checkout_session_id', null, cs.id, null, cs.business_id, cs.created_at
      from public.checkout_sessions cs
     where v_uuid is not null and cs.id = v_uuid
       and (p_business_id is null or cs.business_id = p_business_id)
    union all
    select 30, 'payment_intent_id', null, null, pi.id, pi.business_id, pi.created_at
      from public.payment_intents pi
     where v_uuid is not null and pi.id = v_uuid
       and (p_business_id is null or pi.business_id = p_business_id)
    union all
    select 40, 'tracking_token_id', o.id, null, null, o.business_id, o.created_at
      from public.order_public_tokens t
      join public.orders o on o.id = t.order_id
     where v_uuid is not null and t.id = v_uuid
       and (p_business_id is null or o.business_id = p_business_id)
    union all
    select 50, 'payment_attempt_id', null, null, pi.id, pi.business_id, pi.created_at
      from public.payment_attempts a
      join public.payment_intents pi on pi.id = a.payment_intent_id
     where v_uuid is not null and a.id = v_uuid
       and (p_business_id is null or pi.business_id = p_business_id)
    union all
    -- La correlación es la misma en el pedido, la sesión y el intento: se prefiere
    -- el eslabón más avanzado para no contar la misma cadena tres veces.
    select 60, 'correlation_id', o.id, null, null, o.business_id, o.created_at
      from public.orders o
     where v_uuid is not null and o.correlation_id = v_uuid
       and (p_business_id is null or o.business_id = p_business_id)
    union all
    select 61, 'correlation_id', null, cs.id, null, cs.business_id, cs.created_at
      from public.checkout_sessions cs
     where v_uuid is not null and cs.correlation_id = v_uuid
       and (p_business_id is null or cs.business_id = p_business_id)
    union all
    select 62, 'correlation_id', null, null, pi.id, pi.business_id, pi.created_at
      from public.payment_intents pi
     where v_uuid is not null and pi.correlation_id = v_uuid
       and (p_business_id is null or pi.business_id = p_business_id)
    union all
    select 70, 'public_code', o.id, null, null, o.business_id, o.created_at
      from public.orders o
     where o.public_code in (v_ref, upper(v_ref))
       and (p_business_id is null or o.business_id = p_business_id)
    union all
    select 71, 'public_code', o.id, null, null, o.business_id, o.created_at
      from public.orders o
     where o.code in (v_ref, upper(v_ref))
       and (p_business_id is null or o.business_id = p_business_id)
    union all
    select 80, 'order_client_request_id', o.id, null, null, o.business_id, o.created_at
      from public.orders o
     where o.client_request_id = v_ref
       and (p_business_id is null or o.business_id = p_business_id)
    union all
    select 81, 'order_client_request_id', null, cs.id, null, cs.business_id, cs.created_at
      from public.checkout_sessions cs
     where v_mp_session is not null and cs.id = v_mp_session
       and (p_business_id is null or cs.business_id = p_business_id)
    union all
    select 90, 'checkout_client_request_id', null, cs.id, null, cs.business_id, cs.created_at
      from public.checkout_sessions cs
     where cs.client_request_id = v_ref
       and (p_business_id is null or cs.business_id = p_business_id)
    union all
    select 100, 'provider_payment_id', null, null, pi.id, pi.business_id, pi.created_at
      from public.payment_intents pi
     where pi.provider = 'mercadopago' and pi.environment in ('test', 'production')
       and pi.provider_payment_id = v_ref
       and (p_business_id is null or pi.business_id = p_business_id)
    union all
    select 110, 'external_reference', null, null, pi.id, pi.business_id, pi.created_at
      from public.payment_intents pi
     where pi.external_reference = v_ref
       and (p_business_id is null or pi.business_id = p_business_id)
    union all
    select 120, 'preference_id', null, null, pi.id, pi.business_id, pi.created_at
      from public.payment_attempts a
      join public.payment_intents pi on pi.id = a.payment_intent_id
     where a.preference_id = v_ref
       and (p_business_id is null or pi.business_id = p_business_id)
    union all
    select 121, 'merchant_order_id', null, null, pi.id, pi.business_id, pi.created_at
      from public.payment_intents pi
     where pi.provider_merchant_order_id = v_ref
       and (p_business_id is null or pi.business_id = p_business_id)
  ),
  scoped as (
    select c.* from candidate c
     where p_business_id is null or c.business_id = p_business_id
  )
  select jsonb_agg(distinct jsonb_build_object(
           'kind', s.kind, 'order_id', s.order_id, 'checkout_session_id', s.session_id,
           'payment_intent_id', s.intent_id, 'business_id', s.business_id, 'created_at', s.created_at))
    into v_candidates
    from scoped s
   where s.priority = (select min(s2.priority) from scoped s2);

  if v_candidates is null then
    -- Último criterio: avisos del proveedor por id de pago que ningún intento
    -- registró. Es el caso «Mercado Pago dice que cobró y acá no hay nada».
    select coalesce(array_agg(x.id), '{}'::uuid[]), max(x.seller_business_id::text)::uuid
      into v_receipt_ids, v_business
      from (
        select r.id, r.seller_business_id
          from public.payment_webhook_receipts r
         where r.resource_id = v_ref
           and (p_business_id is null or r.seller_business_id = p_business_id)
         order by r.received_at desc
         limit c_source_cap
      ) x;
    if coalesce(array_length(v_receipt_ids, 1), 0) = 0 then
      return c_not_found;
    end if;
    v_receipt_only := true;
    v_kind := 'webhook_resource_id';
    if p_business_id is not null then
      v_business := p_business_id;
    end if;
  elsif jsonb_array_length(v_candidates) > 1 then
    return jsonb_build_object(
      'found', false,
      'reason', 'ambiguous',
      'matched_by', v_candidates -> 0 ->> 'kind',
      'candidates', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'order_id', c.value -> 'order_id',
                 'checkout_session_id', c.value -> 'checkout_session_id',
                 'payment_intent_id', c.value -> 'payment_intent_id',
                 -- El negocio sólo se nombra cuando quien pregunta es soporte.
                 'business_id', case when p_business_id is null then c.value -> 'business_id' end,
                 'created_at', c.value -> 'created_at')) order by c.value ->> 'created_at')
          from (select e.value from jsonb_array_elements(v_candidates) e(value) limit 10) c));
  else
    v_pick := v_candidates -> 0;
    v_kind := v_pick ->> 'kind';
    v_business := (v_pick ->> 'business_id')::uuid;
    v_order_id := (v_pick ->> 'order_id')::uuid;
    v_session_id := (v_pick ->> 'checkout_session_id')::uuid;
    v_intent_id := (v_pick ->> 'payment_intent_id')::uuid;
  end if;

  -- ── Completar la cadena pedido ⇄ sesión ⇄ intento ─────────────────────────
  if v_intent_id is not null and v_session_id is null then
    select pi.checkout_session_id into v_session_id
      from public.payment_intents pi where pi.id = v_intent_id;
  end if;
  if v_order_id is not null and v_session_id is null then
    select cs.id into v_session_id
      from public.checkout_sessions cs
     where cs.completed_order_id = v_order_id and cs.business_id = v_business
     order by cs.created_at
     limit 1;
    if v_session_id is null then
      select pi.checkout_session_id into v_session_id
        from public.payment_intents pi
       where pi.order_id = v_order_id and pi.business_id = v_business
       order by pi.created_at
       limit 1;
    end if;
  end if;
  if v_session_id is not null then
    if v_intent_id is null then
      select pi.id into v_intent_id
        from public.payment_intents pi
       where pi.checkout_session_id = v_session_id and pi.business_id = v_business;
    end if;
    if v_order_id is null then
      select coalesce(cs.completed_order_id, (
               select pi.order_id from public.payment_intents pi
                where pi.checkout_session_id = cs.id and pi.business_id = v_business))
        into v_order_id
        from public.checkout_sessions cs
       where cs.id = v_session_id and cs.business_id = v_business;
    end if;
  end if;

  -- Sólo las columnas que la traza usa: ni una de contacto ni de domicilio.
  select o.id, o.business_id, o.public_code, o.client_request_id, o.correlation_id, o.status, o.revision,
         o.origin, o.fulfillment_type, o.delivery_mode, o.payment_method, o.total, o.currency_code,
         o.created_at, o.updated_at, o.acknowledged_at, o.accepted_at, o.preparing_at, o.ready_at,
         o.dispatched_at, o.picked_up_at, o.arrived_at, o.delivered_at,
         coalesce(o.cancelled_at, o.canceled_at) as cancelled_at, o.rejected_at,
         o.inventory_released_at, o.manual_payment_status, o.manual_payment_method,
         o.manual_payment_confirmed_at, o.manual_payment_reversed_at,
         o.assigned_rider_user_id, o.delivery_code_required, o.preparation_estimate_minutes,
         o.estimated_arrival_at
    into v_order
    from public.orders o
   where o.id = v_order_id and o.business_id = v_business;

  select cs.id, cs.business_id, cs.client_request_id, cs.correlation_id, cs.status, cs.revision, cs.origin,
         cs.fulfillment_type, cs.total, cs.currency, cs.contains_alcohol, cs.created_at, cs.updated_at,
         cs.expires_at, cs.completed_order_id, cs.manual_review_reason
    into v_session
    from public.checkout_sessions cs
   where cs.id = v_session_id and cs.business_id = v_business;

  select pi.id, pi.business_id, pi.correlation_id, pi.environment, pi.external_reference, pi.preference_id,
         pi.provider_payment_id, pi.provider_merchant_order_id, pi.provider_status, pi.provider_status_detail,
         pi.provider_payment_method, pi.internal_status, pi.currency, pi.expected_amount, pi.paid_amount,
         pi.refunded_amount, pi.live_mode, pi.preference_created_at, pi.approved_at, pi.rejected_at,
         pi.security_review_reason, pi.revision, pi.created_at, pi.updated_at
    into v_intent
    from public.payment_intents pi
   where pi.id = v_intent_id and pi.business_id = v_business;

  if not v_receipt_only and v_order.id is null and v_session.id is null and v_intent.id is null then
    return c_not_found;
  end if;

  -- ── Avisos del proveedor que hablan de este pago ──────────────────────────
  if not v_receipt_only and v_intent.id is not null then
    select coalesce(array_agg(distinct x.id), '{}'::uuid[])
      into v_receipt_ids
      from (
        (select e.webhook_receipt_id as id
           from public.payment_events e
          where e.payment_intent_id = v_intent.id and e.webhook_receipt_id is not null
          order by e.sequence desc
          limit c_source_cap)
        union all
        (select po.webhook_receipt_id
           from public.payment_outbox po
          where po.payment_intent_id = v_intent.id and po.webhook_receipt_id is not null
          order by po.created_at desc
          limit c_source_cap)
        union all
        -- El id de pago es único por proveedor y ambiente, y el intento que lo
        -- tiene es de este negocio: un aviso con ese id habla de este pago.
        (select r.id
           from public.payment_webhook_receipts r
          where v_intent.provider_payment_id is not null
            and r.resource_id = v_intent.provider_payment_id
            and r.environment = v_intent.environment
            and (r.seller_business_id is null or r.seller_business_id = v_business)
          order by r.received_at desc
          limit c_source_cap)
      ) x;
  end if;

  -- ── Guardián de admisión: tabla de otra migración, se lee sin depender ────
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'at', l.created_at, 'channel', l.channel, 'units', l.units,
             'network_fingerprint_present', l.fingerprint_hash is not null) order by l.created_at), '[]'::jsonb)
      into v_intake
      from (
        select g.created_at, g.channel, g.units, g.fingerprint_hash
          from private.order_intake_log g
         where g.business_id = v_business
           and (g.order_id = v_order.id or g.checkout_session_id = v_session.id)
         order by g.created_at desc
         limit c_source_cap
      ) l;
  exception when undefined_table or undefined_column or invalid_schema_name or insufficient_privilege then
    v_intake := '[]'::jsonb;
    v_intake_available := false;
  end;

  -- ── Línea de tiempo ───────────────────────────────────────────────────────
  -- Cada fuente con tope trae sus filas más nuevas (order by … desc limit): el
  -- orden final lo da `ordered`, de la más vieja a la más nueva.
  with entries as materialized (
    -- checkout
    (select cs.created_at::timestamptz as at, 10::integer as rank, 0::bigint as ord,
            'checkout'::text as stage, 'checkout_sessions'::text as source, 'cs_created'::text as branch,
            'checkout.session_created'::text as event, 'customer'::text as actor_role, null::text as actor_ref,
            jsonb_build_object(
              'checkout_session_id', cs.id, 'fulfillment_type', cs.fulfillment_type, 'total', cs.total,
              'currency', cs.currency, 'origin', cs.origin, 'contains_alcohol', cs.contains_alcohol,
              'expires_at', cs.expires_at,
              'item_lines', (select count(*) from public.checkout_session_items i where i.checkout_session_id = cs.id),
              'units', (select coalesce(sum(i.quantity), 0) from public.checkout_session_items i where i.checkout_session_id = cs.id)
            ) as details, cs.id::text as tie
       from public.checkout_sessions cs
      where cs.id = v_session.id)
    union all
    (select cs.updated_at, 38, 0, 'checkout', 'checkout_sessions', 'cs_state',
            'checkout.session_' || cs.status, 'system', null,
            jsonb_build_object('checkout_session_id', cs.id, 'status', cs.status, 'revision', cs.revision,
              'manual_review_reason', private.order_trace_code(cs.manual_review_reason),
              'has_order', cs.completed_order_id is not null),
            cs.id::text
       from public.checkout_sessions cs
      where cs.id = v_session.id and cs.updated_at > cs.created_at)
    union all
    -- guardián de admisión
    (select (g.value ->> 'at')::timestamptz, 12, 0, 'intake', 'order_intake_log', 'intake',
            'intake.admitted', 'customer', null,
            g.value - 'at', (g.value ->> 'at') || ':' || (g.value ->> 'channel')
       from jsonb_array_elements(v_intake) g(value))
    union all
    -- stock: reservas del checkout
    (select r.created_at, 14, 0, 'stock', 'inventory_reservations', 'res_created',
            'stock.reserved', 'system', null,
            jsonb_build_object('product_id', r.product_id, 'quantity', r.quantity, 'expires_at', r.expires_at,
              'generation', r.reservation_generation),
            r.id::text
       from public.inventory_reservations r
      where r.checkout_session_id = v_session.id
      order by r.created_at desc limit c_source_cap)
    union all
    (select r.released_at, 36, 0, 'stock', 'inventory_reservations', 'res_released',
            'stock.reservation_released', 'system', null,
            jsonb_build_object('product_id', r.product_id, 'quantity', r.quantity,
              'reason', private.order_trace_code(r.release_reason), 'generation', r.reservation_generation),
            r.id::text
       from public.inventory_reservations r
      where r.checkout_session_id = v_session.id and r.released_at is not null
      order by r.released_at desc limit c_source_cap)
    union all
    (select r.converted_at, 36, 0, 'stock', 'inventory_reservations', 'res_converted',
            'stock.reservation_converted', 'system', null,
            jsonb_build_object('product_id', r.product_id, 'quantity', r.quantity, 'generation', r.reservation_generation),
            r.id::text
       from public.inventory_reservations r
      where r.checkout_session_id = v_session.id and r.converted_at is not null
      order by r.converted_at desc limit c_source_cap)
    union all
    -- pago en línea
    (select pi.created_at, 20, 0, 'payment', 'payment_intents', 'pi_created',
            'payment.intent_created', 'system', null,
            jsonb_build_object('payment_intent_id', pi.id, 'environment', pi.environment,
              'expected_amount', pi.expected_amount, 'currency', pi.currency),
            pi.id::text
       from public.payment_intents pi
      where pi.id = v_intent.id)
    union all
    (select a.created_at, 22, a.attempt_number, 'payment', 'payment_attempts', 'pa',
            'payment.attempt_' || a.attempt_type, 'system', null,
            jsonb_build_object('payment_attempt_id', a.id, 'attempt_number', a.attempt_number, 'status', a.status,
              'has_preference', a.preference_id is not null,
              'last_error_code', private.order_trace_code(a.last_error_code), 'updated_at', a.updated_at),
            a.id::text
       from public.payment_attempts a
      where a.payment_intent_id = v_intent.id
      order by a.created_at desc limit c_source_cap)
    union all
    (select r.received_at, 24, 0, 'payment', 'payment_webhook_receipts', 'wr',
            'webhook.received', 'provider', null,
            jsonb_build_object('receipt_id', r.id, 'topic', private.order_trace_code(r.event_type),
              'signature_valid', r.signature_valid, 'processing_status', r.processing_status,
              'attempt_count', r.attempt_count, 'processed_at', r.processed_at,
              'has_error', r.last_error is not null),
            r.id::text
       from public.payment_webhook_receipts r
      where r.id = any (v_receipt_ids)
      order by r.received_at desc limit c_source_cap)
    union all
    (select po.created_at, 26, 0, 'payment', 'payment_outbox', 'po',
            'payment.outbox_' || po.topic, 'system', null,
            jsonb_build_object('job_id', po.id, 'status', po.status, 'attempts', po.attempts,
              'completed_at', po.completed_at,
              'next_attempt_at', case when po.status in ('pending', 'retry_wait') then po.next_attempt_at end,
              'receipt_id', po.webhook_receipt_id,
              -- Hoy el procesador guarda un código; si mañana guardara un mensaje
              -- del proveedor, de acá no sale: sólo que hay un error.
              'last_error_code', private.order_trace_code(po.last_error),
              'has_error', po.last_error is not null),
            po.id::text
       from public.payment_outbox po
      where (v_intent.id is not null and po.payment_intent_id = v_intent.id)
         or po.webhook_receipt_id = any (v_receipt_ids)
      order by po.created_at desc limit c_source_cap)
    union all
    (select e.server_recorded_at, 28, e.sequence, 'payment', 'payment_events', 'pe',
            e.event_type,
            case
              when e.webhook_receipt_id is not null then 'provider'
              when e.event_type = 'payment.order_recovered_by_operator' then 'business'
              when e.event_type = 'checkout.session_created' then 'customer'
              else 'system'
            end,
            private.order_trace_actor_ref(v_business, private.order_trace_uuid(e.details ->> 'actor_user_id')),
            private.order_trace_safe_details(e.details, array[
              'source', 'order_id', 'checkout_session_id', 'reservation_expires_at', 'dispute_id', 'status',
              'reason', 'cancellation_id', 'refund_id', 'amount', 'reservation_generation'])
            || jsonb_build_object(
              'provider_status', private.order_trace_code(e.provider_status),
              'provider_status_detail', private.order_trace_code(e.provider_status_detail),
              'receipt_id', e.webhook_receipt_id),
            e.id::text
       from public.payment_events e
      where e.payment_intent_id = v_intent.id
      order by e.sequence desc limit c_source_cap)
    union all
    (select pi.updated_at, 37, 0, 'payment', 'payment_intents', 'pi_state',
            'payment.intent_' || pi.internal_status, 'system', null,
            jsonb_build_object('payment_intent_id', pi.id, 'internal_status', pi.internal_status,
              'provider_status', private.order_trace_code(pi.provider_status),
              'paid_amount', pi.paid_amount, 'refunded_amount', pi.refunded_amount, 'revision', pi.revision,
              'security_review_reason', private.order_trace_code(pi.security_review_reason)),
            pi.id::text
       from public.payment_intents pi
      where pi.id = v_intent.id and pi.updated_at > pi.created_at)
    union all
    (select f.requested_at, 70, 0, 'payment', 'payment_refunds', 'refund_requested',
            'payment.refund_requested', case when f.requested_by is null then 'system' else 'business' end,
            private.order_trace_actor_ref(v_business, f.requested_by),
            jsonb_build_object('refund_id', f.id, 'amount', f.amount, 'status', f.status),
            f.id::text
       from public.payment_refunds f
      where f.payment_intent_id = v_intent.id
      order by f.requested_at desc limit c_source_cap)
    union all
    (select f.completed_at, 71, 0, 'payment', 'payment_refunds', 'refund_completed',
            'payment.refund_' || f.status, 'provider', null,
            jsonb_build_object('refund_id', f.id, 'amount', f.amount),
            f.id::text
       from public.payment_refunds f
      where f.payment_intent_id = v_intent.id and f.completed_at is not null
      order by f.completed_at desc limit c_source_cap)
    union all
    (select k.requested_at, 72, 0, 'payment', 'payment_cancellations', 'cancel_requested',
            'payment.cancellation_requested', case when k.requested_by is null then 'system' else 'business' end,
            private.order_trace_actor_ref(v_business, k.requested_by),
            jsonb_build_object('cancellation_id', k.id, 'status', k.status),
            k.id::text
       from public.payment_cancellations k
      where k.payment_intent_id = v_intent.id
      order by k.requested_at desc limit c_source_cap)
    union all
    (select k.completed_at, 73, 0, 'payment', 'payment_cancellations', 'cancel_completed',
            'payment.cancellation_' || k.status, 'provider', null,
            jsonb_build_object('cancellation_id', k.id),
            k.id::text
       from public.payment_cancellations k
      where k.payment_intent_id = v_intent.id and k.completed_at is not null
      order by k.completed_at desc limit c_source_cap)
    union all
    (select coalesce(d.opened_at, d.created_at), 74, 0, 'payment', 'payment_disputes', 'dispute',
            'payment.dispute_' || d.dispute_type, 'provider', null,
            jsonb_build_object('dispute_id', d.id, 'status', private.order_trace_code(d.status), 'due_at', d.due_at,
              'documentation_required', d.documentation_required,
              'documentation_status', private.order_trace_code(d.documentation_status),
              'resolved_at', d.resolved_at),
            d.id::text
       from public.payment_disputes d
      where d.payment_intent_id = v_intent.id
      order by d.created_at desc limit c_source_cap)
    union all
    -- el pedido
    (select o.created_at, 39, 0, 'order', 'orders', 'order_created',
            'order.created', 'customer', null,
            jsonb_build_object('order_id', o.id, 'payment_method', o.payment_method,
              'fulfillment_type', o.fulfillment_type, 'total', o.total, 'currency', o.currency_code,
              'origin', o.origin,
              'item_lines', (select count(*) from public.order_items i where i.order_id = o.id),
              'units', (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id),
              'combos', (select count(*) from public.order_combos c where c.order_id = o.id)),
            o.id::text
       from public.orders o
      where o.id = v_order.id)
    union all
    -- stock: lo que el pedido se llevó. Un pedido manual descuenta al nacer; uno
    -- pagado en línea ya lo tenía descontado por la reserva del checkout.
    (select i.created_at, 40, 0, 'stock', 'order_items', 'order_items',
            'stock.order_item_committed', 'system', null,
            jsonb_build_object('product_id', i.product_uuid, 'quantity', i.quantity,
              'stock_effect', case when v_session.id is null then 'decremented_at_order_creation'
                                   else 'covered_by_converted_reservation' end),
            i.id::text
       from public.order_items i
      where i.order_id = v_order.id
      order by i.created_at desc, i.id desc limit c_source_cap)
    union all
    (select m.created_at, 41, 0, 'stock', 'inventory_movements', 'movements',
            'stock.movement', 'business', private.order_trace_actor_ref(v_business, m.operator_id),
            jsonb_build_object('movement_type', m.movement_type, 'quantity_delta', m.quantity_delta,
              'reference_type', private.order_trace_code(m.reference_type), 'product_id', m.product_id),
            m.id::text
       from public.inventory_movements m
      where m.reference_id in (v_order.id, v_session.id) and m.business_id = v_business
      order by m.created_at desc limit c_source_cap)
    union all
    (select o.inventory_released_at, 60, 0, 'stock', 'orders', 'order_released',
            'stock.released_to_shelf', 'system', null,
            jsonb_build_object('status', o.status,
              'units', (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id)),
            o.id::text
       from public.orders o
      where o.id = v_order.id and o.inventory_released_at is not null)
    union all
    (select e.created_at, 42, e.sequence,
            case
              when e.event_type like 'order.manual_payment%' then 'payment'
              when e.event_type like 'order.delivery_%' then 'delivery_handoff'
              when e.event_type like 'order.tracking%' then 'tracking'
              when e.event_type like 'order.rider%' or e.actor_role = 'rider' then 'rider'
              else 'order'
            end,
            'order_events', 'order_events',
            e.event_type, coalesce(e.actor_role, 'system'),
            case when e.actor_role in ('business', 'rider')
              then private.order_trace_actor_ref(v_business, e.actor_user_id) end,
            private.order_trace_safe_details(e.metadata, array[
              'previous_status', 'next_status', 'inventory_released', 'source', 'payment_intent_id', 'offer_id',
              'reason_code', 'issue_type', 'actual_method', 'amount', 'failed_attempts', 'locked_until',
              'confirmed_at', 'rotated_at', 'minutes', 'origin', 'previous_origin', 'delivery_mode',
              'expected_revision', 'rider_active_orders', 'rider_max_active_orders', 'code_verified'])
            || jsonb_strip_nulls(jsonb_build_object(
              'rider_ref', private.order_trace_actor_ref(v_business,
                private.order_trace_uuid(e.metadata ->> 'rider_user_id')),
              'previous_rider_ref', private.order_trace_actor_ref(v_business,
                private.order_trace_uuid(e.metadata ->> 'previous_rider_user_id')),
              'next_rider_ref', private.order_trace_actor_ref(v_business,
                private.order_trace_uuid(e.metadata ->> 'next_rider_user_id')),
              -- Un motivo escrito a mano no sale: sólo se dice que existe.
              'has_free_text_reason', case when e.metadata ? 'reason' or e.metadata ? 'origin_reason' then true end)),
            e.id::text
       from public.order_events e
      where e.order_id = v_order.id
      order by e.sequence desc limit c_source_cap)
    union all
    (select c.created_at, 44, 0, 'order', 'business_command_receipts', 'commands',
            'command.' || coalesce(private.order_trace_code(c.command_type), 'unknown'), 'business',
            private.order_trace_actor_ref(v_business, c.actor_user_id),
            '{}'::jsonb, c.id::text
       from public.business_command_receipts c
      where c.order_id = v_order.id and c.business_id = v_business
      order by c.created_at desc, c.id desc limit c_source_cap)
    union all
    (select s.created_at, 46, 0, 'order', 'order_packing_sessions', 'packing_started',
            'packing.started', 'business', private.order_trace_actor_ref(v_business, s.operator_id),
            jsonb_build_object('packing_session_id', s.id, 'status', s.status, 'order_revision', s.order_revision),
            s.id::text
       from public.order_packing_sessions s
      where s.order_id = v_order.id and s.business_id = v_business
      order by s.created_at desc limit c_source_cap)
    union all
    (select s.confirmed_at, 47, 0, 'order', 'order_packing_sessions', 'packing_confirmed',
            'packing.confirmed', 'business', private.order_trace_actor_ref(v_business, s.operator_id),
            jsonb_build_object('packing_session_id', s.id, 'has_exception', s.exception_reason is not null,
              'scans', (select count(*) from public.order_packing_scans x where x.session_id = s.id and x.reverted_at is null)),
            s.id::text
       from public.order_packing_sessions s
      where s.order_id = v_order.id and s.business_id = v_business and s.confirmed_at is not null
      order by s.confirmed_at desc limit c_source_cap)
    union all
    -- seguimiento: el id del token, nunca el token
    (select t.created_at, 45, 0, 'tracking', 'order_public_tokens', 'token_issued',
            'tracking.token_issued', 'system', null,
            jsonb_build_object('token_id', t.id, 'expires_at', t.expires_at),
            t.id::text
       from public.order_public_tokens t
      where t.order_id = v_order.id
      order by t.created_at desc, t.id desc limit c_source_cap)
    union all
    (select t.revoked_at, 45, 1, 'tracking', 'order_public_tokens', 'token_revoked',
            'tracking.token_revoked', 'system', null,
            jsonb_build_object('token_id', t.id),
            t.id::text
       from public.order_public_tokens t
      where t.order_id = v_order.id and t.revoked_at is not null
      order by t.revoked_at desc limit c_source_cap)
    union all
    -- avisos al comercio e impresión
    (select n.created_at, 50, 0, 'notification', 'notification_outbox', 'notifications',
            'notification.' || coalesce(private.order_trace_code(n.event_type), 'unknown'), 'system', null,
            jsonb_build_object('state', n.state, 'attempt_count', n.attempt_count, 'processed_at', n.processed_at,
              'has_error', n.last_error is not null),
            n.id::text
       from public.notification_outbox n
      where n.business_id = v_business and n.aggregate_id = v_order.id
      order by n.created_at desc, n.id desc limit c_source_cap)
    union all
    (select j.created_at, 52, 0, 'print', 'print_jobs', 'print_jobs',
            'print.job_' || j.document_type, case when j.request_source = 'automatic' then 'system' else 'business' end,
            private.order_trace_actor_ref(v_business, j.requested_by),
            jsonb_build_object('print_job_id', j.id, 'status', j.status, 'request_source', j.request_source,
              'attempt_count', j.attempt_count, 'printed_at', j.printed_at, 'cancelled_at', j.cancelled_at,
              'last_error', private.order_trace_code(j.last_error), 'is_reprint', j.reprint_of is not null),
            j.id::text
       from public.print_jobs j
      where j.business_id = v_business and j.source_entity_id = v_order.id
      order by j.created_at desc, j.id desc limit c_source_cap)
    union all
    (select pe.created_at, 54, pe.id, 'print', 'print_job_events', 'print_events',
            'print.' || pe.event_type,
            case pe.actor_kind when 'user' then 'business' else pe.actor_kind end,
            case when pe.actor_kind = 'user' then private.order_trace_actor_ref(v_business, pe.actor_id) end,
            jsonb_build_object('print_job_id', pe.print_job_id, 'from_status', pe.from_status, 'to_status', pe.to_status),
            pe.id::text
       from public.print_job_events pe
       join public.print_jobs j on j.id = pe.print_job_id
      where j.business_id = v_business and j.source_entity_id = v_order.id
      order by pe.id desc limit c_source_cap)
    union all
    -- repartidor: ofertas, operaciones, incidencias. Sin coordenadas.
    (select f.offered_at, 60, 0, 'rider', 'rider_order_offers', 'offer_sent',
            'rider.offer_sent', 'business', private.order_trace_actor_ref(v_business, f.offered_by_user_id),
            jsonb_build_object('offer_id', f.id, 'rider_ref', private.order_trace_actor_ref(v_business, f.rider_user_id),
              'expected_order_revision', f.expected_order_revision),
            f.id::text
       from public.rider_order_offers f
      where f.order_id = v_order.id and f.business_id = v_business
      order by f.offered_at desc limit c_source_cap)
    union all
    (select f.responded_at, 61, 0, 'rider', 'rider_order_offers', 'offer_answered',
            'rider.offer_' || f.status, case when f.status = 'withdrawn' then 'business' else 'rider' end,
            case when f.status <> 'withdrawn' then private.order_trace_actor_ref(v_business, f.rider_user_id) end,
            jsonb_build_object('offer_id', f.id, 'response_reason', f.response_reason),
            f.id::text
       from public.rider_order_offers f
      where f.order_id = v_order.id and f.business_id = v_business and f.responded_at is not null
      order by f.responded_at desc limit c_source_cap)
    union all
    (select p.created_at, 62, 0, 'rider', 'rider_delivery_operations', 'rider_ops',
            'rider.operation_' || p.operation, 'rider', private.order_trace_actor_ref(v_business, p.rider_user_id),
            jsonb_build_object(
              'ok', case when jsonb_typeof(p.result -> 'ok') = 'boolean' then p.result -> 'ok' end,
              'outcome', private.order_trace_code(coalesce(p.result ->> 'outcome', p.result ->> 'code')),
              'idempotent_no_op', case when jsonb_typeof(p.result -> 'idempotent_no_op') = 'boolean'
                then p.result -> 'idempotent_no_op' end),
            p.operation || ':' || p.idempotency_key
       from public.rider_delivery_operations p
      where p.order_id = v_order.id
      order by p.created_at desc limit c_source_cap)
    union all
    (select q.reported_at, 63, 0, 'rider', 'rider_delivery_issues', 'rider_issues',
            'rider.issue_reported', 'rider', private.order_trace_actor_ref(v_business, q.rider_id),
            jsonb_build_object('issue_type', q.issue_type),
            q.id::text
       from public.rider_delivery_issues q
      where q.order_id = v_order.id and q.business_id = v_business
      order by q.reported_at desc limit c_source_cap)
    union all
    (select min(l.recorded_at), 64, 0, 'rider', 'rider_locations', 'rider_locations',
            'rider.location_reports', 'rider', null,
            jsonb_build_object('reports', count(*), 'first_at', min(l.recorded_at), 'last_at', max(l.recorded_at)),
            'locations'
       from public.rider_locations l
      where l.order_id = v_order.id and l.business_id = v_business
     having count(*) > 0)
    union all
    -- entrega con código: cuándo se emitió, cada intento, cuándo se confirmó. Nunca el código.
    (select h.created_at, 48, 0, 'delivery_handoff', 'order_delivery_handoffs', 'handoff_issued',
            'handoff.code_issued', 'system', null,
            jsonb_build_object('expires_at', h.expires_at),
            h.order_id::text
       from public.order_delivery_handoffs h
      where h.order_id = v_order.id)
    union all
    (select t.attempted_at, 65, 0, 'delivery_handoff', 'delivery_confirmation_attempts', 'handoff_attempts',
            'handoff.attempt_' || t.result, 'rider', private.order_trace_actor_ref(v_business, t.rider_id),
            jsonb_build_object('lock_level', t.lock_level, 'retry_after_seconds', t.retry_after_seconds),
            t.id::text
       from public.delivery_confirmation_attempts t
      where t.order_id = v_order.id and t.business_id = v_business
      order by t.attempted_at desc limit c_source_cap)
    union all
    (select h.confirmed_at, 66, 0, 'delivery_handoff', 'order_delivery_handoffs', 'handoff_confirmed',
            'handoff.confirmed', 'rider', private.order_trace_actor_ref(v_business, h.confirmed_by_user_id),
            jsonb_build_object('failed_attempts', h.failed_attempts),
            h.order_id::text
       from public.order_delivery_handoffs h
      where h.order_id = v_order.id and h.confirmed_at is not null)
    union all
    (select x.created_at, 67, 0, 'delivery_handoff', 'delivery_outbox', 'delivery_outbox',
            'handoff.outbox_' || x.event_type, 'system', null,
            jsonb_build_object('dispatched', x.dispatched_at is not null, 'dispatched_at', x.dispatched_at),
            x.id::text
       from public.delivery_outbox x
      where x.order_id = v_order.id and x.business_id = v_business
      order by x.created_at desc limit c_source_cap)
    union all
    -- alertas operativas que nombran a este pedido, su checkout o su pago
    (select a.first_seen_at, 80, 0, 'alert', 'operational_alerts', 'alerts',
            'alert.' || a.alert_code, 'system', null,
            jsonb_build_object('alert_id', a.id, 'severity', a.severity, 'status', a.status,
              'occurrence_count', a.occurrence_count, 'last_seen_at', a.last_seen_at, 'resolved_at', a.resolved_at),
            a.id::text
       from public.operational_alerts a
      where a.business_id = v_business
        and (a.subject_id in (v_order.id, v_session.id, v_intent.id)
          or a.correlation_id in (v_order.correlation_id, v_session.correlation_id, v_intent.correlation_id))
      order by a.first_seen_at desc limit c_source_cap)
  ),
  ordered as (
    select e.*,
           row_number() over (order by e.at, e.rank, e.ord, e.source, e.tie) as position,
           count(*) over () as total
      from entries e
     where e.at is not null
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'at', o.at, 'stage', o.stage, 'source', o.source, 'event', o.event,
             'actor_role', o.actor_role, 'actor_ref', o.actor_ref, 'details', o.details))
           order by o.position) filter (
             where o.position <= c_timeline_head
                or o.position > o.total - (c_timeline_limit - c_timeline_head)), '[]'::jsonb),
         coalesce(max(o.total), 0)::integer,
         (select coalesce(jsonb_agg(distinct b.source), '[]'::jsonb)
            from (select e.source from entries e group by e.branch, e.source having count(*) >= c_source_cap) b)
    into v_timeline, v_total, v_at_cap
    from ordered o;

  -- ── Estado actual ─────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'created_at', t.created_at, 'expires_at', t.expires_at,
           'expired', t.expires_at <= v_now, 'revoked', t.revoked_at is not null,
           'revoked_at', t.revoked_at) order by t.created_at, t.id), '[]'::jsonb)
    into v_tokens
    from (select k.id, k.created_at, k.expires_at, k.revoked_at
            from public.order_public_tokens k
           where k.order_id = v_order.id
           order by k.created_at, k.id limit 20) t;

  select jsonb_build_object(
           'active', count(*) filter (where r.status = 'active'),
           'released', count(*) filter (where r.status = 'released'),
           'converted', count(*) filter (where r.status = 'converted'),
           'active_past_expiry', count(*) filter (where r.status = 'active' and r.expires_at <= v_now))
    into v_reservations
    from public.inventory_reservations r
   where r.checkout_session_id = v_session.id;

  select coalesce(sum(i.quantity), 0), count(*)::integer
    into v_units, v_item_lines
    from public.order_items i
   where i.order_id = v_order.id;

  select count(*)::integer into v_movements
    from public.inventory_movements m
   where m.reference_id in (v_order.id, v_session.id) and m.business_id = v_business;

  select count(*)::integer into v_notifications
    from public.notification_outbox n
   where n.business_id = v_business and n.aggregate_id = v_order.id;

  select jsonb_build_object(
           'code_issued', h.order_id is not null,
           'issued_at', h.created_at,
           'expires_at', h.expires_at,
           'confirmed_at', h.confirmed_at,
           'failed_attempts', coalesce(h.failed_attempts, 0),
           'locked_until', h.locked_until,
           'attempts', (
             select coalesce(jsonb_object_agg(x.result, x.total), '{}'::jsonb)
               from (select t.result, count(*) as total
                       from public.delivery_confirmation_attempts t
                      where t.order_id = v_order.id and t.business_id = v_business
                      group by t.result) x))
    into v_handoff
    from (select v_order.id as wanted) w
    left join public.order_delivery_handoffs h on h.order_id = w.wanted;

  select jsonb_build_object(
           'assigned', v_order.assigned_rider_user_id is not null,
           'assigned_rider_ref', private.order_trace_actor_ref(v_business, v_order.assigned_rider_user_id),
           'offers', (
             select coalesce(jsonb_object_agg(x.status, x.total), '{}'::jsonb)
               from (select f.status, count(*) as total
                       from public.rider_order_offers f
                      where f.order_id = v_order.id and f.business_id = v_business
                      group by f.status) x),
           'issues', (select count(*) from public.rider_delivery_issues q
                       where q.order_id = v_order.id and q.business_id = v_business),
           'location_reports', (select count(*) from public.rider_locations l
                                 where l.order_id = v_order.id and l.business_id = v_business))
    into v_rider;

  -- ── Lo que no se pudo unir ────────────────────────────────────────────────
  if v_receipt_only then
    v_gaps := v_gaps || jsonb_build_object('code', 'payment_not_linked_to_checkout',
      'detail', 'Hay avisos del proveedor para este id de pago y ningún intento de pago lo registra: no se sabe de qué checkout es.');
  else
    if v_order.id is null then
      v_gaps := v_gaps || jsonb_build_object('code', 'order_not_created',
        'detail', 'La referencia llega a un checkout o a un intento de pago que no tiene pedido.');
      if v_intent.internal_status in ('approved', 'approved_order_pending') or v_intent.approved_at is not null then
        v_gaps := v_gaps || jsonb_build_object('code', 'payment_approved_without_order',
          'detail', 'El pago figura aprobado y el pedido no nació.');
      end if;
    elsif v_session.id is null then
      if v_order.payment_method = 'mercadopago' then
        v_gaps := v_gaps || jsonb_build_object('code', 'checkout_session_not_linked',
          'detail', 'El pedido se pagó por Mercado Pago y no se encontró su sesión de checkout.');
      else
        v_gaps := v_gaps || jsonb_build_object('code', 'checkout_not_applicable',
          'detail', 'Pedido de pago manual: no pasa por checkout, reserva ni intento de pago.');
      end if;
    end if;
    if v_session.id is not null then
      -- No hay tabla de transiciones del checkout: sólo su estado actual.
      v_gaps := v_gaps || jsonb_build_object('code', 'checkout_transitions_not_recorded',
        'detail', 'checkout_sessions guarda sólo su estado actual: los pasos intermedios se leen de payment_events.');
      if v_intent.id is null then
        v_gaps := v_gaps || jsonb_build_object('code', 'payment_intent_missing',
          'detail', 'La sesión de checkout no tiene intento de pago.');
      end if;
      if coalesce((v_reservations ->> 'active')::integer, 0) + coalesce((v_reservations ->> 'released')::integer, 0)
         + coalesce((v_reservations ->> 'converted')::integer, 0) = 0 then
        v_gaps := v_gaps || jsonb_build_object('code', 'stock_reservation_missing',
          'detail', 'La sesión de checkout no tiene ninguna reserva de stock.');
      end if;
    end if;
    if v_intent.id is not null and v_intent.provider_payment_id is null then
      v_gaps := v_gaps || jsonb_build_object('code', 'provider_payment_not_recorded',
        'detail', 'El intento de pago todavía no tiene id de pago del proveedor.');
    elsif v_intent.id is not null and coalesce(array_length(v_receipt_ids, 1), 0) = 0 then
      v_gaps := v_gaps || jsonb_build_object('code', 'webhook_receipts_not_found',
        'detail', 'El pago tiene id del proveedor y no hay ningún aviso guardado: se confirmó por consulta, no por aviso.');
    end if;
    if v_order.id is not null then
      if jsonb_array_length(v_tokens) = 0 then
        v_gaps := v_gaps || jsonb_build_object('code', 'tracking_token_missing',
          'detail', 'El pedido no tiene token de seguimiento.');
      end if;
      if v_notifications = 0 then
        v_gaps := v_gaps || jsonb_build_object('code', 'notification_not_enqueued',
          'detail', 'No hay aviso al comercio encolado para este pedido.');
      end if;
    end if;
    if v_movements = 0 then
      v_gaps := v_gaps || jsonb_build_object('code', 'stock_ledger_has_no_rows',
        'detail', 'Ningún movimiento de inventario nombra a este pedido: el efecto en stock se deduce de sus renglones y de las reservas.');
    end if;
    if not v_intake_available then
      v_gaps := v_gaps || jsonb_build_object('code', 'intake_log_unavailable',
        'detail', 'El registro del guardián de admisión no se pudo leer.');
    elsif jsonb_array_length(v_intake) = 0 then
      v_gaps := v_gaps || jsonb_build_object('code', 'intake_log_not_found',
        'detail', 'Sin fila del guardián de admisión: estaba apagado, el pedido es anterior a él o la fila ya se podó.');
    end if;
    if (select count(distinct c.value) from (values
          (v_order.correlation_id), (v_session.correlation_id), (v_intent.correlation_id)) c(value)
         where c.value is not null) > 1 then
      v_gaps := v_gaps || jsonb_build_object('code', 'correlation_mismatch',
        'detail', 'El pedido, la sesión y el intento de pago no comparten el id de correlación.');
    end if;
  end if;

  return jsonb_build_object(
    'found', true,
    'resolved_by', v_kind,
    'generated_at', v_now,
    'identifiers', jsonb_build_object(
      'business_id', v_business,
      'order_id', v_order.id,
      'public_code', v_order.public_code,
      'client_request_id', v_order.client_request_id,
      'checkout_session_id', v_session.id,
      'checkout_client_request_id', v_session.client_request_id,
      'payment_intent_id', v_intent.id,
      'provider_payment_id', case when v_receipt_only then v_ref else v_intent.provider_payment_id end,
      'external_reference', v_intent.external_reference,
      'preference_id', v_intent.preference_id,
      'merchant_order_id', v_intent.provider_merchant_order_id,
      'correlation_id', coalesce(v_order.correlation_id, v_session.correlation_id, v_intent.correlation_id),
      'tracking_tokens', v_tokens),
    'state', jsonb_build_object(
      'order', case when v_order.id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'status', v_order.status, 'revision', v_order.revision, 'origin', v_order.origin,
        'fulfillment_type', v_order.fulfillment_type, 'delivery_mode', v_order.delivery_mode,
        'total', v_order.total, 'currency', v_order.currency_code,
        'item_lines', v_item_lines, 'units', v_units,
        'created_at', v_order.created_at, 'acknowledged_at', v_order.acknowledged_at,
        'accepted_at', v_order.accepted_at, 'preparing_at', v_order.preparing_at, 'ready_at', v_order.ready_at,
        'dispatched_at', v_order.dispatched_at, 'picked_up_at', v_order.picked_up_at,
        'arrived_at', v_order.arrived_at, 'delivered_at', v_order.delivered_at,
        'cancelled_at', v_order.cancelled_at, 'rejected_at', v_order.rejected_at,
        'preparation_estimate_minutes', v_order.preparation_estimate_minutes,
        'estimated_arrival_at', v_order.estimated_arrival_at)) end,
      'payment', jsonb_strip_nulls(jsonb_build_object(
        'method', v_order.payment_method,
        'state', coalesce(v_intent.internal_status,
                          case when v_order.manual_payment_status is not null
                            then 'manual_' || v_order.manual_payment_status end,
                          'unknown'),
        'manual_payment_status', v_order.manual_payment_status,
        'manual_payment_method', v_order.manual_payment_method,
        'manual_payment_confirmed_at', v_order.manual_payment_confirmed_at,
        'manual_payment_reversed_at', v_order.manual_payment_reversed_at,
        'intent_status', v_intent.internal_status,
        'provider_status', private.order_trace_code(v_intent.provider_status),
        'provider_status_detail', private.order_trace_code(v_intent.provider_status_detail),
        'provider_payment_method', private.order_trace_code(v_intent.provider_payment_method),
        'environment', v_intent.environment,
        'live_mode', v_intent.live_mode,
        'expected_amount', v_intent.expected_amount,
        'paid_amount', v_intent.paid_amount,
        'refunded_amount', v_intent.refunded_amount,
        'approved_at', v_intent.approved_at,
        'rejected_at', v_intent.rejected_at,
        'security_review_reason', private.order_trace_code(v_intent.security_review_reason))),
      'checkout', case when v_session.id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'status', v_session.status, 'revision', v_session.revision, 'origin', v_session.origin,
        'created_at', v_session.created_at, 'updated_at', v_session.updated_at,
        'expires_at', v_session.expires_at, 'past_expiry', v_session.expires_at <= v_now,
        'manual_review_reason', private.order_trace_code(v_session.manual_review_reason))) end,
      'stock', jsonb_build_object(
        'released', v_order.inventory_released_at is not null,
        'inventory_released_at', v_order.inventory_released_at,
        'order_units', v_units,
        'reservations', v_reservations,
        'ledger_rows', v_movements),
      'delivery_handoff', case when v_order.id is null then null
        else v_handoff || jsonb_build_object('code_required', v_order.delivery_code_required) end,
      'rider', case when v_order.id is null then null else v_rider end),
    'timeline', v_timeline,
    'timeline_rows', v_total,
    'timeline_limit', c_timeline_limit,
    'timeline_omitted', greatest(v_total - c_timeline_limit, 0),
    'source_row_cap', c_source_cap,
    'truncated', v_total > c_timeline_limit or jsonb_array_length(v_at_cap) > 0,
    'sources_at_cap', v_at_cap,
    'gaps', v_gaps);
end;
$$;
revoke all on function private.order_trace_document(uuid, text) from public, anon, authenticated;

comment on function private.order_trace_document(uuid, text) is
  'Arma la traza de un pedido sin datos personales. Sin EXECUTE para roles de la API: se entra por get_order_trace o get_order_trace_service.';

-- ── 4. Las dos puertas ──────────────────────────────────────────────────────
create or replace function public.get_order_trace(p_business_id uuid, p_reference text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  -- Sin negocio no hay traza por esta puerta: NULL nunca significa «todos».
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return private.order_trace_document(p_business_id, p_reference);
end;
$$;
-- También de service_role: en Supabase lo recibe por los privilegios por defecto
-- del esquema, y esta puerta exige un miembro del negocio. Soporte entra por la otra.
revoke all on function public.get_order_trace(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.get_order_trace(uuid, text) to authenticated;

comment on function public.get_order_trace(uuid, text) is
  'Traza de un pedido del negocio por cualquier identificador (id, codigo publico, clave de idempotencia, checkout, intento de pago, id de pago del proveedor, token de seguimiento por id, correlacion). Sin datos personales. Dueno, administrador o personal.';

create or replace function public.get_order_trace_service(p_reference text, p_business_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  return private.order_trace_document(p_business_id, p_reference);
end;
$$;
revoke all on function public.get_order_trace_service(text, uuid) from public, anon, authenticated;
grant execute on function public.get_order_trace_service(text, uuid) to service_role;

comment on function public.get_order_trace_service(text, uuid) is
  'Traza de un pedido para soporte, en cualquier negocio (o en uno, si se pasa). Solo service_role. Sin datos personales.';
