-- ============================================================================
--  El checkout pregunta: ¿abierto? ¿llegamos? ¿cuánto sale? ¿alcanza el mínimo?
-- ============================================================================
--
--  DÓNDE SE IMPONE, Y POR QUÉ AHÍ
--  ------------------------------
--  En los DOS caminos que crean un pedido, en el mismo punto donde ya se
--  rechazaba por mínimo:
--
--    · `create_order_with_items_core`  — pedido directo (efectivo).
--    · `create_checkout_session`       — pago online, ANTES de dejar la sesión
--      pagable. Ahí todavía se puede abortar y la transacción devuelve el stock
--      sola. En `finalize_paid_checkout_session` NO se comprueba nada de esto:
--      corre después de que el dinero se movió, y un `raise` ahí sería pago
--      tomado con transacción revertida en loop.
--
--  LA AUTORIDAD NO SE MUEVE: GANA DOS PREGUNTAS
--  --------------------------------------------
--  El navegador nunca mandó un peso y sigue sin mandarlo. `delivery_fee` no está
--  entre las claves aceptadas de ninguno de los dos contratos, y las capas de
--  entrada rechazan toda clave que no conozcan. Lo que cambia es de dónde sale
--  el número: antes era la columna del negocio, ahora es la zona resuelta —con
--  caída a la columna del negocio cuando la zona no define la suya.
--
--  EL MISMO PUNTO QUE SE ENTREGA ES EL QUE RESUELVE LA COBERTURA
--  ------------------------------------------------------------
--  No se vuelve a leer la dirección guardada, que para entonces pudo cambiar: se
--  usa la coordenada confirmada que ya pasó la compuerta `DELIVERY_LOCATION_REQUIRED`
--  y que se sella en el pedido.
--
--  CON LAS BANDERAS APAGADAS, ESTE ARCHIVO NO CAMBIA NADA
--  -----------------------------------------------------
--  `business_is_open` devuelve true y `resolve_delivery_zone` devuelve los
--  valores del negocio con `enforced=false`, y en ese caso el mínimo sigue
--  siendo obligatorio exactamente como hoy. Encendida la cobertura, un mínimo
--  NULL pasa a ser una decisión legítima —«sin mínimo»— y no una configuración
--  incompleta.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_order_with_items_core(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_customer_user_id uuid := auth.uid();
  v_client_request_id text;
  v_request_fingerprint text;
  v_tracking_token text;
  v_tracking_token_hash bytea;
  v_items jsonb;
  v_delivery_mode text;
  v_customer_name text;
  v_customer_phone text;
  v_street_address text;
  v_neighborhood text;
  v_reference text;
  v_customer_notes text;
  v_payment_method text;
  v_age_confirmed boolean := false;
  v_contains_alcohol boolean := false;
  v_address_label text;
  v_order_id uuid := gen_random_uuid();
  v_public_code text;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_zone jsonb;
  v_minimum numeric(12, 2);
  v_pending_location jsonb;
  v_delivery_lat double precision;
  v_delivery_lng double precision;
  v_total numeric(12, 2) := 0;
  v_intent_items jsonb := '[]'::jsonb;
  v_locked_items jsonb := '[]'::jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_line_subtotal numeric(12, 2);
  v_existing_order public.orders%rowtype;
  v_existing_token_hash bytea;
  v_result jsonb;
  v_unexpected_key text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;
  if v_customer_user_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;

  select key
    into v_unexpected_key
    from jsonb_object_keys(payload) as keys(key)
   where key not in (
     'business_id',
     'client_request_id',
     'tracking_token',
     'items',
     'customer_name',
     'customer_phone',
     'delivery_mode',
     'fulfillment_type',
     'customer_street_address',
     'address_label',
     'customer_neighborhood',
     'customer_reference',
     'customer_notes',
     'notes',
     'payment_method'
     ,'age_confirmed'
   )
   limit 1;

  if v_unexpected_key is not null then
    raise exception 'campo no permitido en pedido: %', v_unexpected_key
      using errcode = '22023';
  end if;

  v_business_id := nullif(payload->>'business_id', '')::uuid;
  v_client_request_id := btrim(coalesce(payload->>'client_request_id', ''));
  v_tracking_token := btrim(coalesce(payload->>'tracking_token', ''));
  v_items := coalesce(payload->'items', '[]'::jsonb);
  v_delivery_mode := lower(coalesce(
    nullif(payload->>'delivery_mode', ''),
    nullif(payload->>'fulfillment_type', ''),
    'delivery'
  ));
  v_customer_name := nullif(btrim(coalesce(payload->>'customer_name', '')), '');
  v_customer_phone := nullif(btrim(coalesce(payload->>'customer_phone', '')), '');
  v_street_address := nullif(btrim(coalesce(
    payload->>'customer_street_address',
    payload->>'address_label',
    ''
  )), '');
  v_neighborhood := nullif(btrim(coalesce(payload->>'customer_neighborhood', '')), '');
  v_reference := nullif(btrim(coalesce(payload->>'customer_reference', '')), '');
  v_customer_notes := nullif(btrim(coalesce(
    payload->>'customer_notes',
    payload->>'notes',
    ''
  )), '');
  v_payment_method := nullif(btrim(coalesce(payload->>'payment_method', '')), '');
  v_age_confirmed := coalesce((payload->>'age_confirmed')::boolean, false);

  if v_business_id is null then
    raise exception 'business_id requerido' using errcode = '22023';
  end if;
  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if v_tracking_token !~ '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$' then
    raise exception 'tracking_token invalido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'product_id')
        or not (item.value ? 'quantity')
        or (item.value->>'quantity') !~ '^[1-9][0-9]*$'
        or (item.value->>'quantity')::numeric > 1000
        or exists (
          select 1
            from jsonb_object_keys(item.value) as item_keys(key)
           where item_keys.key not in ('product_id', 'quantity')
        )
  ) then
    raise exception 'cada item acepta solo product_id UUID y quantity entero'
      using errcode = '22023';
  end if;

  if v_delivery_mode not in ('delivery', 'pickup') then
    raise exception 'delivery_mode invalido' using errcode = '22023';
  end if;
  if v_customer_name is null or char_length(v_customer_name) > 120 then
    raise exception 'customer_name requerido o demasiado largo'
      using errcode = '22023';
  end if;
  if v_customer_phone is null
    or char_length(v_customer_phone) < 6
    or char_length(v_customer_phone) > 40 then
    raise exception 'customer_phone invalido' using errcode = '22023';
  end if;
  if v_delivery_mode = 'delivery' and v_street_address is null then
    raise exception 'customer_street_address requerido para delivery'
      using errcode = '22023';
  end if;
  if coalesce(char_length(v_street_address), 0) > 180
    or coalesce(char_length(v_neighborhood), 0) > 100
    or coalesce(char_length(v_reference), 0) > 180
    or coalesce(char_length(v_customer_notes), 0) > 500
    or coalesce(char_length(v_payment_method), 0) > 40 then
    raise exception 'datos del cliente demasiado largos' using errcode = '22023';
  end if;

  v_tracking_token_hash := digest(v_tracking_token, 'sha256');

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'product_id', normalized.product_id,
               'quantity', normalized.quantity
             )
             order by normalized.product_id
           ),
           '[]'::jsonb
         )
    into v_intent_items
    from (
      select
        (item.value->>'product_id')::uuid as product_id,
        sum((item.value->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(v_items) as item(value)
      group by (item.value->>'product_id')::uuid
    ) as normalized;

  -- Fingerprint the normalized intent, not raw JSON or current product prices.
  -- Equivalent retries remain equivalent even if item order or accepted legacy
  -- aliases differ.
  v_request_fingerprint := encode(
    digest(
      jsonb_build_object(
        'business_id', v_business_id,
        'items', v_intent_items,
        'customer_name', v_customer_name,
        'customer_phone', v_customer_phone,
        'delivery_mode', v_delivery_mode,
        'customer_street_address', v_street_address,
        'customer_neighborhood', v_neighborhood,
        'customer_reference', v_reference,
        'customer_notes', v_customer_notes,
        'payment_method', v_payment_method
        ,'age_confirmed', v_age_confirmed
      )::text,
      'sha256'
    ),
    'hex'
  );

  -- Serializes retries for the same business/idempotency key. Hash collisions
  -- only reduce concurrency; they cannot merge orders because the unique key
  -- and exact lookup remain authoritative.
  perform pg_advisory_xact_lock(
    hashtext(v_business_id::text),
    hashtext(v_client_request_id)
  );

  select o.*
    into v_existing_order
    from public.orders o
   where o.business_id = v_business_id
     and o.client_request_id = v_client_request_id
   for update;

  if found then
    select opt.token_hash
      into v_existing_token_hash
      from public.order_public_tokens opt
     where opt.order_id = v_existing_order.id
       and opt.revoked_at is null
     order by opt.created_at desc
     limit 1;

    if v_existing_token_hash is distinct from v_tracking_token_hash
      or v_existing_order.customer_user_id is distinct from v_customer_user_id then
      raise exception 'client_request_id ya pertenece a otro pedido'
        using errcode = '23505';
    end if;

    if v_existing_order.client_request_fingerprint is not null
      and v_existing_order.client_request_fingerprint <> v_request_fingerprint then
      raise exception 'client_request_id reutilizado con un payload diferente'
        using errcode = '23505';
    end if;

    select to_jsonb(o)
           || jsonb_build_object(
                'order_items',
                coalesce(
                  (
                    select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                      from public.order_items oi
                     where oi.order_id = o.id
                  ),
                  '[]'::jsonb
                ),
                'rider_locations', '[]'::jsonb,
                'tracking_token', v_tracking_token
              )
      into v_result
      from public.orders o
     where o.id = v_existing_order.id;

    return v_result;
  end if;

  select b.*
    into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;

  if not found then
    raise exception 'business_id inexistente' using errcode = '23503';
  end if;
  if not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_verified
    or not v_business.ordering_enabled then
    raise exception 'el negocio no esta habilitado para recibir pedidos'
      using errcode = '55000';
  end if;
  if v_business.currency_code is null then
    raise exception 'moneda del negocio no verificada' using errcode = '55000';
  end if;
  if v_delivery_mode = 'delivery' and not v_business.delivery_enabled then
    raise exception 'delivery no habilitado' using errcode = '55000';
  end if;
  if v_delivery_mode = 'pickup' and not v_business.pickup_enabled then
    raise exception 'retiro no habilitado' using errcode = '55000';
  end if;

  -- Lock products in deterministic UUID order to avoid deadlocks. Duplicate
  -- product lines are aggregated before checking and decrementing stock.
  for v_item in
    select
      (item.value->>'product_id')::uuid as product_id,
      sum((item.value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(v_items) as item(value)
    group by (item.value->>'product_id')::uuid
    order by (item.value->>'product_id')::uuid
  loop
    if v_item.quantity > 1000 then
      raise exception 'quantity total demasiado alta para producto: %', v_item.product_id
        using errcode = '22023';
    end if;

    select p.*
      into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;

    if not found then
      raise exception 'producto inexistente para el negocio: %', v_item.product_id
        using errcode = '23503';
    end if;
    if not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.stock is null then
      raise exception 'producto no disponible: %', v_item.product_id
        using errcode = '55000';
    end if;
    if v_product.price <= 0 then
      raise exception 'precio no verificado para producto: %', v_item.product_id
        using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id
        using errcode = '23514';
    end if;
    if v_product.is_alcoholic is true then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada'
          using errcode = '55000';
      end if;
    end if;

    v_line_subtotal := v_product.price * v_item.quantity;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_locked_items := v_locked_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'name', v_product.name,
        'quantity', v_item.quantity,
        'unit', v_product.presentation,
        'unit_price', v_product.price,
        'subtotal', v_line_subtotal
      )
    );
  end loop;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null then
      raise exception 'politica de alcohol no configurada' using errcode = '55000';
    end if;
    if not v_age_confirmed then
      raise exception 'confirmacion de mayoria de edad requerida' using errcode = '22023';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (
      (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start
    ) then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  -- ── HORARIO ────────────────────────────────────────────────────────────────
  -- Con la exigencia apagada devuelve true y nada cambia. Encendida, un pedido
  -- fuera de hora no nace: no se reserva stock y no se cobra.
  if not public.business_is_open(v_business_id, v_delivery_mode, clock_timestamp()) then
    raise exception 'BUSINESS_CLOSED'
      using errcode = '55000',
            detail = 'el comercio no esta abierto para este canal',
            hint = 'reintentar dentro del horario de atencion';
  end if;
  if v_contains_alcohol and coalesce(v_business.alcohol_hours_enforced, false)
    and not public.business_is_open(v_business_id, 'alcohol', clock_timestamp()) then
    raise exception 'ALCOHOL_WINDOW_CLOSED'
      using errcode = '55000',
            detail = 'la venta de alcohol esta fuera de la ventana configurada';
  end if;

  if v_delivery_mode = 'delivery' then
    -- El punto confirmado que ya validó la capa de arriba viaja por el ajuste
    -- local a la transacción. Es la MISMA coordenada que se sella en el pedido:
    -- no se resuelve la cobertura con un punto distinto del que se entrega.
    v_pending_location := nullif(current_setting('taba.pending_delivery_location', true), '')::jsonb;
    v_delivery_lat := nullif(v_pending_location ->> 'latitude', '')::double precision;
    v_delivery_lng := nullif(v_pending_location ->> 'longitude', '')::double precision;

    -- ── COBERTURA, ENVÍO Y MÍNIMO: LOS DECIDE EL BACKEND ─────────────────────
    -- El navegador no manda un peso. Ni acá ni antes: `create_order_with_items`
    -- rechaza toda clave que no conozca, y `delivery_fee` no está entre ellas.
    v_zone := public.resolve_delivery_zone(
      v_business_id, v_delivery_lat, v_delivery_lng, v_neighborhood);

    if not coalesce((v_zone ->> 'eligible')::boolean, false) then
      raise exception 'OUT_OF_DELIVERY_ZONE'
        using errcode = '55000',
              detail = 'la direccion no esta dentro de la cobertura declarada',
              hint = 'ofrecer retiro en el local';
    end if;

    v_delivery_fee := (v_zone ->> 'delivery_fee')::numeric(12, 2);
    v_minimum := nullif(v_zone ->> 'minimum_subtotal', '')::numeric(12, 2);
    if v_delivery_fee is null then
      raise exception 'configuracion de delivery no verificada' using errcode = '55000';
    end if;

    -- Con la cobertura apagada el mínimo sigue siendo obligatorio, igual que
    -- antes de esta migración. Con la cobertura encendida, un mínimo NULL es una
    -- decisión legítima —«sin mínimo»— y no una configuración incompleta.
    if not coalesce((v_zone ->> 'enforced')::boolean, false) and v_minimum is null then
      raise exception 'configuracion de delivery no verificada' using errcode = '55000';
    end if;
    if v_minimum is not null and v_subtotal < v_minimum then
      raise exception 'subtotal inferior al minimo de delivery'
        using errcode = '23514';
    end if;
  else
    v_delivery_fee := 0;
  end if;

  v_total := v_subtotal + v_delivery_fee;
  v_address_label := v_street_address;
  if v_address_label is not null and v_neighborhood is not null then
    v_address_label := v_address_label || ', ' || v_neighborhood;
  end if;

  loop
    v_public_code := public.next_order_public_code();
    exit when not exists (
      select 1
        from public.orders o
       where o.code = v_public_code
          or (
            o.business_id = v_business_id
            and o.public_code = v_public_code
          )
    );
  end loop;

  insert into public.orders (
    id,
    business_id,
    code,
    public_code,
    status,
    fulfillment_type,
    delivery_mode,
    customer_user_id,
    client_request_id,
    client_request_fingerprint,
    currency_code,
    customer_name,
    customer_phone,
    customer_whatsapp,
    address_label,
    customer_street_address,
    customer_neighborhood,
    customer_reference,
    delivery_zone_id,
    delivery_zone_name,
    delivery_area_declared,
    notes,
    customer_notes,
    payment_method,
    age_confirmed_at,
    age_confirmation_policy,
    subtotal,
    delivery_fee,
    total
  ) values (
    v_order_id,
    v_business_id,
    v_public_code,
    v_public_code,
    'received',
    v_delivery_mode,
    v_delivery_mode,
    v_customer_user_id,
    v_client_request_id,
    v_request_fingerprint,
    v_business.currency_code,
    v_customer_name,
    v_customer_phone,
    v_customer_phone,
    v_address_label,
    v_street_address,
    v_neighborhood,
    v_reference,
    nullif(v_zone ->> 'zone_id', '')::uuid,
    nullif(v_zone ->> 'zone_name', ''),
    case when v_delivery_mode = 'delivery' then v_neighborhood end,
    v_customer_notes,
    v_customer_notes,
    v_payment_method,
    case when v_contains_alcohol then clock_timestamp() else null end,
    case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
    v_subtotal,
    v_delivery_fee,
    v_total
  );

  for v_item in
    select *
      from jsonb_to_recordset(v_locked_items) as locked_item(
        product_id uuid,
        name text,
        quantity integer,
        unit text,
        unit_price numeric,
        subtotal numeric
      )
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_uuid,
      name,
      quantity,
      unit,
      unit_price,
      subtotal
    ) values (
      v_order_id,
      v_item.product_id::text,
      v_item.product_id,
      v_item.name,
      v_item.quantity,
      v_item.unit,
      v_item.unit_price,
      v_item.subtotal
    );

    update public.products
       set stock = stock - v_item.quantity,
           available = (stock - v_item.quantity) > 0
     where id = v_item.product_id;
  end loop;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order_id,
    v_business_id,
    v_customer_user_id,
    'customer',
    'customer',
    'order.received',
    'order.received',
    'Pedido recibido',
    jsonb_build_object('source', 'production_checkout'),
    jsonb_build_object('source', 'production_checkout')
  );

  insert into public.order_public_tokens (
    order_id,
    token,
    token_hash,
    expires_at
  ) values (
    v_order_id,
    null,
    v_tracking_token_hash,
    now() + interval '30 days'
  );

  select to_jsonb(o)
         || jsonb_build_object(
              'order_items',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                    from public.order_items oi
                   where oi.order_id = o.id
                ),
                '[]'::jsonb
              ),
              'rider_locations', '[]'::jsonb,
              'tracking_token', v_tracking_token
            )
    into v_result
    from public.orders o
   where o.id = v_order_id;

  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_checkout_session(p_customer_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_client_request_id text;
  v_items jsonb;
  v_contact jsonb;
  v_address jsonb;
  v_fulfillment_type text;
  v_age_confirmed boolean := false;
  v_name text;
  v_phone text;
  v_address_id uuid;
  v_saved_address public.customer_addresses%rowtype;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_reference text;
  v_city text;
  v_province text;
  v_neighborhood text;
  v_zone jsonb;
  v_minimum numeric(12, 2);
  v_postal_code text;
  v_address_label text;
  v_address_source text;
  v_location_source text;
  v_location_confirmed_at timestamptz;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_geolocation_accuracy numeric(10, 2);
  v_address_snapshot jsonb;
  v_contact_snapshot jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_request_hash text;
  v_session public.checkout_sessions%rowtype;
  v_existing public.checkout_sessions%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_contains_alcohol boolean := false;
  v_expires_at timestamptz;
  v_payment_intent_id uuid;
  v_unexpected_key text;
  v_rate_count integer;
  v_normalized_products jsonb := '[]'::jsonb;
  v_normalized_combos jsonb := '[]'::jsonb;
  v_combo record;
  v_combo_row public.product_combos%rowtype;
  v_combo_components jsonb;
  v_combo_component_count integer;
  v_combo_declared_count integer;
  v_combo_list_price numeric(12, 2);
  v_combo_promotional numeric(12, 2);
  v_discount_total numeric(12, 2) := 0;
begin
  if p_customer_id is null then
    raise exception 'cliente autenticado requerido' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload de checkout invalido' using errcode = '22023';
  end if;

  select key into v_unexpected_key
    from jsonb_object_keys(p_payload) as keys(key)
   where key not in (
     'business_id', 'client_request_id', 'items', 'fulfillment_type',
     'contact', 'address', 'age_confirmed', 'payment_method'
   )
   limit 1;
  if v_unexpected_key is not null then
    raise exception 'campo no permitido en checkout: %', v_unexpected_key using errcode = '22023';
  end if;

  if coalesce(p_payload ->> 'business_id', '') !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'business_id invalido' using errcode = '22023';
  end if;
  v_business_id := (p_payload ->> 'business_id')::uuid;
  v_client_request_id := btrim(coalesce(p_payload ->> 'client_request_id', ''));
  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_contact := p_payload -> 'contact';
  v_address := coalesce(p_payload -> 'address', '{}'::jsonb);
  v_fulfillment_type := lower(btrim(coalesce(p_payload ->> 'fulfillment_type', '')));
  v_age_confirmed := coalesce((p_payload ->> 'age_confirmed')::boolean, false);

  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_payload ->> 'payment_method', ''))) <> 'mercadopago' then
    raise exception 'medio de pago invalido para Checkout Pro' using errcode = '22023';
  end if;
  if v_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'modalidad de entrega invalida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos' using errcode = '22023';
  end if;
  if jsonb_typeof(v_contact) <> 'object' then
    raise exception 'contacto requerido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_contact) as keys(key)
     where key not in ('name', 'phone')
  ) then
    raise exception 'campo de contacto no permitido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_address) <> 'object' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_address) as keys(key)
     where key not in (
       'customer_address_id', 'label', 'street', 'street_number', 'floor',
       'apartment', 'reference', 'city', 'province', 'postal_code',
       'neighborhood',
       'latitude', 'longitude', 'geolocation_accuracy', 'source',
       'location_source', 'location_confirmed_at'
     )
  ) then
    raise exception 'campo de direccion no permitido' using errcode = '22023';
  end if;
  -- Una linea es de producto o de combo, nunca las dos. Un combo viaja por su
  -- identificador estable y NUNCA con un precio: el precio lo decide el backend.
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'quantity')
        or (item.value ->> 'quantity') !~ '^[1-9][0-9]*$'
        or (item.value ? 'product_id') = (item.value ? 'combo_id')
        or (
          (item.value ? 'product_id')
          and (
            (item.value ->> 'product_id') !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            or (item.value ->> 'quantity')::numeric > 1000
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('product_id', 'quantity')
            )
          )
        )
        or (
          (item.value ? 'combo_id')
          and (
            (item.value ->> 'combo_id') !~ '^[a-z0-9][a-z0-9-]{2,63}$'
            or (item.value ->> 'quantity')::numeric > 100
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('combo_id', 'quantity')
            )
          )
        )
  ) then
    raise exception 'cada item acepta product_id UUID o combo_id, con quantity entero' using errcode = '22023';
  end if;

  v_name := nullif(regexp_replace(btrim(coalesce(v_contact ->> 'name', '')), '[[:space:]]+', ' ', 'g'), '');
  v_phone := regexp_replace(coalesce(v_contact ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'nombre de contacto invalido' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'telefono de contacto invalido' using errcode = '22023';
  end if;

  if nullif(v_address ->> 'customer_address_id', '') is not null then
    if (v_address ->> 'customer_address_id') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (v_address ->> 'customer_address_id')::uuid;
    select * into v_saved_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = p_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_address_label := v_saved_address.label;
    v_street := v_saved_address.street;
    v_street_number := v_saved_address.street_number;
    v_floor := v_saved_address.floor;
    v_apartment := v_saved_address.apartment;
    v_reference := v_saved_address.reference;
    v_city := v_saved_address.city;
    v_province := v_saved_address.province;
    v_neighborhood := v_saved_address.neighborhood;
    v_postal_code := v_saved_address.postal_code;
    v_address_source := v_saved_address.source;
    v_latitude := v_saved_address.latitude;
    v_longitude := v_saved_address.longitude;
    v_geolocation_accuracy := v_saved_address.geolocation_accuracy;
    v_location_source := v_saved_address.location_source;
    v_location_confirmed_at := v_saved_address.location_confirmed_at;
    -- Una direccion cuya huella dejo de describir su propio texto no sostiene un
    -- pedido: hay que volver a marcar el pin.
    if v_location_confirmed_at is not null
      and coalesce(v_saved_address.location_confirmed_address, '') <> public.delivery_location_address_fingerprint(
        v_saved_address.street, v_saved_address.street_number,
        v_saved_address.city, v_saved_address.province, v_saved_address.postal_code
      ) then
      v_location_confirmed_at := null;
      v_location_source := null;
    end if;
  else
    v_address_label := nullif(btrim(coalesce(v_address ->> 'label', '')), '');
    v_street := nullif(btrim(coalesce(v_address ->> 'street', '')), '');
    v_street_number := nullif(btrim(coalesce(v_address ->> 'street_number', '')), '');
    v_floor := nullif(btrim(coalesce(v_address ->> 'floor', '')), '');
    v_apartment := nullif(btrim(coalesce(v_address ->> 'apartment', '')), '');
    v_reference := nullif(btrim(coalesce(v_address ->> 'reference', '')), '');
    v_city := nullif(btrim(coalesce(v_address ->> 'city', '')), '');
    v_province := nullif(btrim(coalesce(v_address ->> 'province', '')), '');
    v_neighborhood := nullif(btrim(coalesce(v_address ->> 'neighborhood', '')), '');
    v_postal_code := nullif(btrim(coalesce(v_address ->> 'postal_code', '')), '');
    v_address_source := nullif(btrim(coalesce(v_address ->> 'source', 'manual')), '');
    v_location_source := lower(nullif(btrim(coalesce(v_address ->> 'location_source', '')), ''));
    if nullif(v_address ->> 'latitude', '') is not null or nullif(v_address ->> 'longitude', '') is not null then
      if (v_address ->> 'latitude') !~ '^-?[0-9]+(\.[0-9]+)?$'
        or (v_address ->> 'longitude') !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'coordenadas invalidas' using errcode = '22023';
      end if;
      v_latitude := (v_address ->> 'latitude')::numeric(9, 6);
      v_longitude := (v_address ->> 'longitude')::numeric(9, 6);
    end if;
    if nullif(v_address ->> 'geolocation_accuracy', '') is not null then
      if (v_address ->> 'geolocation_accuracy') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'precision invalida' using errcode = '22023';
      end if;
      v_geolocation_accuracy := (v_address ->> 'geolocation_accuracy')::numeric(10, 2);
    end if;
    if nullif(v_address ->> 'location_confirmed_at', '') is not null then
      begin
        v_location_confirmed_at := (v_address ->> 'location_confirmed_at')::timestamptz;
      exception when others then
        raise exception 'momento de confirmacion invalido' using errcode = '22023';
      end;
    end if;
  end if;

  if v_fulfillment_type = 'delivery'
    and (v_street is null or v_street_number is null or v_city is null) then
    raise exception 'direccion de delivery incompleta' using errcode = '22023';
  end if;
  if char_length(coalesce(v_address_label, '')) > 60
    or char_length(coalesce(v_street, '')) > 120
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_reference, '')) > 180
    or char_length(coalesce(v_city, '')) > 100
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20
    or char_length(coalesce(v_neighborhood, '')) > 100
    or v_address_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if v_location_source is not null
    and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
    raise exception 'origen de ubicacion invalido' using errcode = '22023';
  end if;
  if v_location_confirmed_at is not null
    and v_location_confirmed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
  end if;
  if (v_latitude is null) <> (v_longitude is null) then
    raise exception 'coordenadas incompletas' using errcode = '22023';
  end if;
  if v_latitude is not null
    and (v_latitude not between -90 and 90 or v_longitude not between -180 and 180) then
    raise exception 'coordenadas fuera de rango' using errcode = '22023';
  end if;
  -- Una confirmacion son cuatro piezas juntas o no es nada.
  if v_latitude is null or v_location_source is null or v_location_confirmed_at is null then
    v_location_source := null;
    v_location_confirmed_at := null;
  end if;

  -- LA COMPUERTA. Antes de la sesion, antes de la reserva de stock y antes de la
  -- intencion de pago: si la entrega no tiene punto confirmado, no pasa nada.
  if v_fulfillment_type = 'delivery' and v_location_confirmed_at is null then
    raise exception 'DELIVERY_LOCATION_REQUIRED'
      using errcode = '22023',
            detail = 'la entrega necesita un punto confirmado por el cliente',
            hint = 'confirmar la ubicacion en el mapa antes de pagar';
  end if;

  -- Sin punto, el origen no puede afirmar que hubo uno. Se degrada en vez de
  -- abortar: la direccion postal sigue siendo valida y un pedido de retiro tiene
  -- que poder avanzar; lo que no puede es viajar diciendo `gps` sin coordenadas.
  if v_latitude is null and v_address_source in ('gps', 'geocoder') then
    v_address_source := 'manual';
  end if;
  if v_geolocation_accuracy is not null and v_latitude is null then
    v_geolocation_accuracy := null;
  end if;
  -- El origen del contrato manda sobre la columna historica, cuyo vocabulario no
  -- se amplia porque un consumidor remoto lo restringe.
  if v_location_confirmed_at is not null then
    v_address_source := case v_location_source
      when 'gps' then 'gps'
      when 'geocoded_confirmed' then 'geocoder'
      else 'manual'
    end;
  end if;

  v_contact_snapshot := jsonb_build_object('name', v_name, 'phone', v_phone);
  v_address_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'address_id', v_address_id,
    'label', v_address_label,
    'street', v_street,
    'street_number', v_street_number,
    'floor', v_floor,
    'apartment', v_apartment,
    'reference', v_reference,
    'city', v_city,
    'province', v_province,
    'postal_code', v_postal_code,
    'neighborhood', v_neighborhood,
    'source', v_address_source,
    'latitude', v_latitude,
    'longitude', v_longitude,
    'geolocation_accuracy', v_geolocation_accuracy,
    'location_source', v_location_source,
    'location_confirmed_at', v_location_confirmed_at
  ));

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', normalized.product_id, 'quantity', normalized.quantity)
    order by normalized.product_id
  ), '[]'::jsonb)
    into v_normalized_products
    from (
      select (item.value ->> 'product_id')::uuid as product_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'product_id'
       group by (item.value ->> 'product_id')::uuid
    ) as normalized;

  select coalesce(jsonb_agg(
    jsonb_build_object('combo_id', normalized.combo_id, 'quantity', normalized.quantity)
    order by normalized.combo_id
  ), '[]'::jsonb)
    into v_normalized_combos
    from (
      select (item.value ->> 'combo_id') as combo_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'combo_id'
       group by (item.value ->> 'combo_id')
    ) as normalized;

  if exists (
    select 1 from jsonb_to_recordset(v_normalized_combos) as normalized(combo_id text, quantity integer)
     where quantity > 100
  ) then
    raise exception 'quantity total demasiado alta para combo' using errcode = '22023';
  end if;

  -- El hash de intencion incluye los combos: reintentar el mismo carrito
  -- devuelve la misma sesion, y reusar el client_request_id con otros combos se
  -- rechaza igual que si hubieran cambiado los productos.
  v_request_hash := encode(digest(jsonb_build_object(
    'business_id', v_business_id,
    'items', v_normalized_products,
    'combos', v_normalized_combos,
    'fulfillment_type', v_fulfillment_type,
    'contact', v_contact_snapshot,
    'address', v_address_snapshot,
    'age_confirmed', v_age_confirmed
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext(v_business_id::text), hashtext(v_client_request_id));
  select * into v_existing
    from public.checkout_sessions s
   where s.business_id = v_business_id
     and s.customer_id = p_customer_id
     and s.client_request_id = v_client_request_id
   for update;
  if found then
    if v_existing.normalized_intent_hash <> v_request_hash then
      raise exception 'client_request_id reutilizado con un checkout diferente' using errcode = '23505';
    end if;
    return public.checkout_session_customer_payload(v_existing.id, p_customer_id);
  end if;

  select b.* into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;
  if not found
    or not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_enabled
    or not v_business.ordering_verified
    or upper(coalesce(v_business.currency_code, '')) <> 'ARS' then
    raise exception 'negocio no habilitado para pagos online' using errcode = '55000';
  end if;
  if (v_fulfillment_type = 'delivery' and not v_business.delivery_enabled)
    or (v_fulfillment_type = 'pickup' and not v_business.pickup_enabled) then
    raise exception 'modalidad de entrega no habilitada' using errcode = '55000';
  end if;

  select s.* into v_settings
    from public.business_payment_settings s
   where s.business_id = v_business_id
     and s.provider = 'mercadopago'
   for share;
  if not found
    or not v_settings.enabled
    or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro'
    or v_settings.currency <> 'ARS'
    or nullif(btrim(v_settings.collector_id), '') is null
    or nullif(btrim(v_settings.application_id), '') is null
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta configurado para este negocio' using errcode = '55000';
  end if;

  if v_business.order_rate_limit_per_10_minutes is not null then
    select count(*) into v_rate_count
      from public.checkout_sessions s
     where s.business_id = v_business_id
       and s.customer_id = p_customer_id
       and s.created_at >= clock_timestamp() - interval '10 minutes';
    if v_rate_count >= v_business.order_rate_limit_per_10_minutes then
      raise exception 'demasiados intentos de checkout; reintenta mas tarde' using errcode = '54000';
    end if;
  end if;

  -- Los combos se expanden a componentes DESPUES de verificar que el negocio
  -- esta habilitado y ANTES de tomar los locks de producto, para que el bucle de
  -- reserva vea una sola cantidad consolidada por producto y no pueda sobrevender
  -- entre una linea suelta y la misma lata dentro de un combo.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id
     for share;
    if not found or not v_combo_row.is_active then
      raise exception 'combo no disponible: %', v_combo.combo_id using errcode = '55000';
    end if;
    if v_combo_row.approval_status <> 'APROBADO_COMERCIAL' then
      raise exception 'combo sin aprobacion comercial: %', v_combo.combo_id using errcode = '55000';
    end if;
    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;
    if v_combo_declared_count = 0 then
      raise exception 'combo sin componentes: %', v_combo.combo_id using errcode = '55000';
    end if;
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', totals.product_id, 'quantity', totals.quantity)
    order by totals.product_id
  ), '[]'::jsonb)
    into v_normalized_items
    from (
      select merged.product_id, sum(merged.quantity)::integer as quantity
        from (
          select (p.value ->> 'product_id')::uuid as product_id,
                 (p.value ->> 'quantity')::integer as quantity
            from jsonb_array_elements(v_normalized_products) as p(value)
          union all
          select cc.product_id,
                 cc.quantity * (c.value ->> 'quantity')::integer
            from jsonb_array_elements(v_normalized_combos) as c(value)
            join public.product_combos pc
              on pc.business_id = v_business_id
             and pc.combo_id = (c.value ->> 'combo_id')
            join public.product_combo_components cc on cc.combo_id = pc.id
        ) as merged
       group by merged.product_id
    ) as totals;

  if jsonb_array_length(v_normalized_items) < 1 then
    raise exception 'el checkout quedo sin productos' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     where quantity > 1000
  ) then
    raise exception 'quantity total demasiado alta para producto' using errcode = '22023';
  end if;

  v_expires_at := clock_timestamp() + make_interval(mins => v_settings.preference_expiration_minutes);
  insert into public.checkout_sessions (
    business_id, customer_id, client_request_id, normalized_intent_hash,
    fulfillment_type, address_snapshot, contact_snapshot, currency,
    subtotal, discount_total, delivery_fee, total, status, expires_at
  ) values (
    v_business_id, p_customer_id, v_client_request_id, v_request_hash,
    v_fulfillment_type, v_address_snapshot, v_contact_snapshot, 'ARS',
    0, 0, 0, 0, 'validating', v_expires_at
  ) returning * into v_session;

  -- Lock products in deterministic UUID order. Reserving decrements the same
  -- authoritative stock used by the legacy direct-order RPC, so both flows see
  -- active reservations and cannot oversell each other.
  for v_item in
    select * from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     order by product_id
  loop
    select p.* into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;
    if not found
      or not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.price_status <> 'confirmed'
      or v_product.stock is null
      or v_product.price is null
      or v_product.price <= 0 then
      raise exception 'producto no disponible para pago: %', v_item.product_id using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id using errcode = '23514';
    end if;
    if v_product.is_alcoholic then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada' using errcode = '55000';
      end if;
    end if;

    insert into public.checkout_session_items (
      checkout_session_id, product_id, product_snapshot, quantity, unit_price, subtotal
    ) values (
      v_session.id,
      v_product.id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', v_product.name,
        'presentation', v_product.presentation,
        'category', v_product.category,
        'image_url', v_product.image_url,
        'sku', v_product.sku
      )),
      v_item.quantity,
      v_product.price,
      v_product.price * v_item.quantity
    );
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at
    ) values (
      v_session.id, v_product.id, v_item.quantity, v_expires_at
    );
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_product.id;
    v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
  end loop;

  -- El precio de lista del combo se calcula con los precios BLOQUEADOS recien
  -- ahora: usar el precio leido antes del lock permitiria que una actualizacion
  -- concurrente moviera el ahorro anunciado respecto del cobrado.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id;

    select
        coalesce(sum(cc.quantity * i.unit_price), 0),
        count(*)::integer,
        coalesce(jsonb_agg(jsonb_build_object(
          'product_id', cc.product_id,
          'sku', i.product_snapshot ->> 'sku',
          'name', i.product_snapshot ->> 'name',
          'quantity', cc.quantity,
          'unit_price', i.unit_price,
          'line_price', cc.quantity * i.unit_price
        ) order by cc.sort_order, cc.product_id), '[]'::jsonb)
      into v_combo_list_price, v_combo_component_count, v_combo_components
      from public.product_combo_components cc
      join public.checkout_session_items i
        on i.checkout_session_id = v_session.id
       and i.product_id = cc.product_id
     where cc.combo_id = v_combo_row.id;

    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;

    -- Si un componente no llego a reservarse, el combo no se cobra a medias.
    if v_combo_component_count <> v_combo_declared_count or v_combo_list_price <= 0 then
      raise exception 'combo incompleto al reservar: %', v_combo.combo_id using errcode = '55000';
    end if;

    v_combo_promotional := floor(
      (v_combo_list_price * (100 - v_combo_row.discount_percentage) / 100) / v_combo_row.price_rounding
    ) * v_combo_row.price_rounding;
    if v_combo_promotional <= 0 or v_combo_promotional > v_combo_list_price then
      raise exception 'precio promocional invalido para el combo: %', v_combo.combo_id using errcode = '55000';
    end if;

    insert into public.checkout_session_combos (
      checkout_session_id, combo_uuid, combo_id, name, quantity,
      discount_percentage, list_price, promotional_price, discount_amount, combo_snapshot
    ) values (
      v_session.id, v_combo_row.id, v_combo_row.combo_id, v_combo_row.name, v_combo.quantity,
      v_combo_row.discount_percentage, v_combo_list_price, v_combo_promotional,
      (v_combo_list_price - v_combo_promotional) * v_combo.quantity,
      jsonb_build_object(
        'combo_id', v_combo_row.combo_id,
        'name', v_combo_row.name,
        'tagline', v_combo_row.tagline,
        'terms', v_combo_row.terms,
        'discount_percentage', v_combo_row.discount_percentage,
        'price_rounding', v_combo_row.price_rounding,
        'approval_status', v_combo_row.approval_status,
        'approved_at', v_combo_row.approved_at,
        'components', v_combo_components
      )
    );

    v_discount_total := v_discount_total + (v_combo_list_price - v_combo_promotional) * v_combo.quantity;
  end loop;

  if v_discount_total > v_subtotal then
    raise exception 'el descuento de combos supera el subtotal' using errcode = '23514';
  end if;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null
      or not v_age_confirmed then
      raise exception 'politica o confirmacion de edad incompleta' using errcode = '55000';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  -- ── HORARIO, COBERTURA, ENVÍO Y MÍNIMO ─────────────────────────────────────
  -- Se pregunta DESPUÉS de bloquear los productos y ANTES de dejar la sesión
  -- pagable: acá todavía se puede abortar y la transacción devuelve el stock
  -- sola. Un `raise` después del pago sería lo peor posible, y por eso ninguna
  -- de estas comprobaciones vive en la finalización.
  if not public.business_is_open(v_business_id, v_fulfillment_type, clock_timestamp()) then
    raise exception 'BUSINESS_CLOSED'
      using errcode = '55000',
            detail = 'el comercio no esta abierto para este canal',
            hint = 'reintentar dentro del horario de atencion';
  end if;
  if v_contains_alcohol and coalesce(v_business.alcohol_hours_enforced, false)
    and not public.business_is_open(v_business_id, 'alcohol', clock_timestamp()) then
    raise exception 'ALCOHOL_WINDOW_CLOSED'
      using errcode = '55000',
            detail = 'la venta de alcohol esta fuera de la ventana configurada';
  end if;

  if v_fulfillment_type = 'delivery' then
    -- La cobertura se resuelve con el MISMO punto confirmado que ya pasó la
    -- compuerta de arriba y que viaja en la instantánea de la sesión.
    v_zone := public.resolve_delivery_zone(
      v_business_id, v_latitude::double precision, v_longitude::double precision, v_neighborhood);
    if not coalesce((v_zone ->> 'eligible')::boolean, false) then
      raise exception 'OUT_OF_DELIVERY_ZONE'
        using errcode = '55000',
              detail = 'la direccion no esta dentro de la cobertura declarada',
              hint = 'ofrecer retiro en el local';
    end if;
    v_delivery_fee := (v_zone ->> 'delivery_fee')::numeric(12, 2);
    v_minimum := nullif(v_zone ->> 'minimum_subtotal', '')::numeric(12, 2);
    if v_delivery_fee is null then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
    if not coalesce((v_zone ->> 'enforced')::boolean, false) and v_minimum is null then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
    if v_minimum is not null and (v_subtotal - v_discount_total) < v_minimum then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
  end if;
  v_total := v_subtotal - v_discount_total + v_delivery_fee;

  update public.checkout_sessions
     set subtotal = v_subtotal,
         discount_total = v_discount_total,
         delivery_fee = v_delivery_fee,
         delivery_zone_id = nullif(v_zone ->> 'zone_id', '')::uuid,
         delivery_zone_name = nullif(v_zone ->> 'zone_name', ''),
         delivery_minimum_subtotal = v_minimum,
         total = v_total,
         contains_alcohol = v_contains_alcohol,
         age_confirmed_at = case when v_contains_alcohol then clock_timestamp() else null end,
         age_confirmation_policy = case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
         status = 'ready_for_payment'
   where id = v_session.id
   returning * into v_session;

  insert into public.payment_intents (
    checkout_session_id, business_id, provider, environment, external_reference,
    internal_status, currency, expected_amount, live_mode
  ) values (
    v_session.id, v_business_id, 'mercadopago', v_settings.environment,
    'taba2:checkout:' || v_session.id::text,
    'created', 'ARS', v_total, v_settings.environment = 'production'
  ) returning id into v_payment_intent_id;

  insert into public.payment_events (
    payment_intent_id, event_type, details
  ) values (
    v_payment_intent_id,
    'checkout.session_created',
    jsonb_build_object('checkout_session_id', v_session.id, 'reservation_expires_at', v_expires_at)
  );

  return public.checkout_session_customer_payload(v_session.id, p_customer_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_paid_checkout_session(p_checkout_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_reservation public.inventory_reservations%rowtype;
  v_code text;
  v_tracking_token text;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found or v_intent.internal_status not in ('approved_order_pending', 'approved')
    or v_intent.provider_status <> 'approved' or v_intent.paid_amount <> v_session.total or v_intent.currency <> 'ARS' then
    raise exception 'pago no aprobado verificadamente' using errcode = '55000';
  end if;
  if v_session.expires_at <= clock_timestamp() or not exists (
    select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_active_reservation' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_active_reservation' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true);
  end if;
  -- El dinero ya se movio: aca no se aborta. Una sesion delivery sin punto
  -- confirmado es imposible por construccion -`create_checkout_session` la
  -- rechaza antes de reservar stock-, asi que si aparece es una anomalia y la
  -- decide una persona, no un raise que revierta el pago en loop.
  if v_session.fulfillment_type = 'delivery' and (
    nullif(v_session.address_snapshot ->> 'latitude', '') is null
    or nullif(v_session.address_snapshot ->> 'longitude', '') is null
    or nullif(v_session.address_snapshot ->> 'location_source', '') is null
    or nullif(v_session.address_snapshot ->> 'location_confirmed_at', '') is null
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'code', 'DELIVERY_LOCATION_REQUIRED');
  end if;
  update public.checkout_sessions set status = 'finalizing_order' where id = v_session.id;
  loop
    v_code := public.next_order_public_code();
    exit when not exists (select 1 from public.orders o where o.code = v_code or o.public_code = v_code);
  end loop;
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, client_request_fingerprint, currency_code,
    customer_name, customer_phone, customer_whatsapp, address_label,
    customer_street_address, customer_neighborhood, customer_reference,
    customer_address_id, delivery_address_formatted, delivery_street, delivery_street_number,
    delivery_floor, delivery_apartment, delivery_reference, delivery_city, delivery_province,
    delivery_postal_code, delivery_address_label, delivery_address_source, delivery_snapshot_created_at,
    delivery_latitude, delivery_longitude, delivery_geolocation_accuracy,
    delivery_location_source, delivery_location_confirmed_at,
    delivery_zone_id, delivery_zone_name, delivery_area_declared,
    payment_method, subtotal, discount_total, delivery_fee, total
  ) values (
    v_session.business_id, v_code, v_code, 'received', v_session.fulfillment_type, v_session.fulfillment_type,
    v_session.customer_id, 'mp_' || replace(v_session.id::text, '-', ''), v_session.normalized_intent_hash, 'ARS',
    v_session.contact_snapshot ->> 'name', v_session.contact_snapshot ->> 'phone', v_session.contact_snapshot ->> 'phone',
    coalesce(v_session.address_snapshot ->> 'label', case when v_session.fulfillment_type = 'delivery' then 'Entrega' else null end),
    btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))),
    v_session.address_snapshot ->> 'city', v_session.address_snapshot ->> 'reference',
    nullif(v_session.address_snapshot ->> 'address_id', '')::uuid,
    case when v_session.fulfillment_type = 'delivery' then nullif(btrim(concat_ws(', ',
      nullif(btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))), ''),
      nullif(v_session.address_snapshot ->> 'city', ''),
      nullif(v_session.address_snapshot ->> 'province', ''))), '') end,
    v_session.address_snapshot ->> 'street', v_session.address_snapshot ->> 'street_number',
    v_session.address_snapshot ->> 'floor', v_session.address_snapshot ->> 'apartment',
    v_session.address_snapshot ->> 'reference', v_session.address_snapshot ->> 'city',
    v_session.address_snapshot ->> 'province', v_session.address_snapshot ->> 'postal_code',
    v_session.address_snapshot ->> 'label',
    case when v_session.fulfillment_type = 'delivery'
      then coalesce(nullif(v_session.address_snapshot ->> 'source', ''), 'checkout_session') end,
    case when v_session.fulfillment_type = 'delivery' then clock_timestamp() end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'latitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'longitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'geolocation_accuracy', '')::numeric(10, 2) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_source', '') end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_confirmed_at', '')::timestamptz end,
    v_session.delivery_zone_id, v_session.delivery_zone_name,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'neighborhood', '') end,
    'mercadopago', v_session.subtotal, v_session.discount_total, v_session.delivery_fee, v_session.total
  ) returning * into v_order;
  for v_item in select * from public.checkout_session_items i where i.checkout_session_id = v_session.id order by i.product_id loop
    insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit, unit_price, subtotal)
    values (v_order.id, v_item.product_id::text, v_item.product_id, coalesce(v_item.product_snapshot ->> 'name', 'Producto TABA2'),
      v_item.quantity, nullif(v_item.product_snapshot ->> 'presentation', ''), v_item.unit_price, v_item.subtotal);
  end loop;
  insert into public.order_combos (
    order_id, combo_uuid, combo_id, name, quantity, discount_percentage,
    list_price, promotional_price, discount_amount, combo_snapshot
  )
  select v_order.id, c.combo_uuid, c.combo_id, c.name, c.quantity, c.discount_percentage,
         c.list_price, c.promotional_price, c.discount_amount, c.combo_snapshot
    from public.checkout_session_combos c
   where c.checkout_session_id = v_session.id
   order by c.combo_id;
  for v_reservation in select * from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' order by r.product_id for update loop
    update public.inventory_reservations set status = 'converted', converted_at = clock_timestamp() where id = v_reservation.id and status = 'active';
  end loop;
  insert into public.order_events (order_id, business_id, actor_user_id, actor_role, actor_type, event_type, type, message, metadata, payload)
  values (v_order.id, v_session.business_id, v_session.customer_id, 'customer', 'customer', 'order.received', 'order.received',
    'Pedido recibido y pago aprobado', jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id),
    jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id));
  v_tracking_token := encode(gen_random_bytes(32), 'hex');
  insert into public.order_public_tokens (order_id, token, token_hash, expires_at)
  values (v_order.id, null, digest(v_tracking_token, 'sha256'), clock_timestamp() + interval '30 days');
  update public.payment_intents set order_id = v_order.id, internal_status = 'completed' where id = v_intent.id;
  update public.checkout_sessions set completed_order_id = v_order.id, status = 'completed' where id = v_session.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, 'payment.order_completed', jsonb_build_object('order_id', v_order.id));
  return jsonb_build_object('ok', true, 'order_id', v_order.id, 'order_code', v_order.public_code, 'idempotent', false);
end;
$function$;

comment on function public.create_order_with_items_core(jsonb) is
  'Alta autoritativa del pedido directo. Horario, cobertura, envío y mínimo salen del backend; el cliente no manda ninguno de los cuatro.';
comment on function public.create_checkout_session(uuid, jsonb) is
  'Sesión de Checkout Pro. Verifica horario y cobertura antes de dejarla pagable, y congela zona, envío y mínimo en la sesión.';
comment on function public.finalize_paid_checkout_session(uuid) is
  'Cierra la sesión pagada. No vuelve a evaluar horario ni cobertura: corre despues del dinero. Copia al pedido la zona que decidio la sesion.';
