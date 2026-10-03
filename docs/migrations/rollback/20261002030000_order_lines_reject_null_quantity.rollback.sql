-- Rollback de 20261002030000: devuelve las dos puertas de pedidos a su definición
-- anterior (la de 20261001180000, capturada con pg_get_functiondef) y quita la función
-- privada que agregó.
--
-- Qué vuelve a quedar abierto: un renglón con la cantidad en null vuelve a rechazarse
-- con el error crudo de la tabla o, junto a otro renglón válido del mismo producto, a
-- ignorarse en silencio.
--
-- No toca ninguna fila.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002030000', 0)
);

CREATE OR REPLACE FUNCTION public.create_order_with_items(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_customer_id uuid := auth.uid();
  v_business_id uuid;
  v_client_request_id text;
  v_business public.businesses%rowtype;
  v_guarded boolean := false;
  v_units bigint;
  v_block jsonb;
  v_payload jsonb := payload;
  v_key text;
  v_result jsonb;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  -- Higiene de entrada. Lo que el resto de las capas no mide.
  if octet_length(payload::text) > 32768 then
    raise exception 'payload demasiado grande' using errcode = '22023';
  end if;
  if char_length(coalesce(payload ->> 'address_label', '')) > 300 then
    raise exception 'datos del cliente demasiado largos' using errcode = '22023';
  end if;
  -- Los caracteres de control no llegan al Panel ni a la comandera (misma regla que
  -- ya aplicaba el checkout de Mercado Pago a sus observaciones).
  foreach v_key in array array['customer_notes', 'notes', 'customer_reference'] loop
    if jsonb_typeof(v_payload -> v_key) = 'string' and (v_payload ->> v_key) ~ '[[:cntrl:]]' then
      v_payload := jsonb_set(v_payload, array[v_key],
        to_jsonb(btrim(regexp_replace(v_payload ->> v_key, '[[:cntrl:]]+', ' ', 'g'))));
    end if;
  end loop;

  -- El guardián sólo actúa sobre un pedido que se puede identificar. Todo lo demás lo
  -- rechazan las capas de adentro con sus errores de siempre.
  if coalesce(payload ->> 'business_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and btrim(coalesce(payload ->> 'client_request_id', '')) ~ '^[A-Za-z0-9_-]{8,128}$' then
    v_business_id := (payload ->> 'business_id')::uuid;
    v_client_request_id := btrim(payload ->> 'client_request_id');
    select b.* into v_business from public.businesses b where b.id = v_business_id;
    if found and v_business.order_intake_guard_mode <> 'off' then
      -- Un cliente, una admisión a la vez por negocio: el conteo queda exacto aunque
      -- lleguen veinte pedidos juntos con veinte claves distintas.
      perform pg_advisory_xact_lock(
        hashtext('taba.order_intake.customer'),
        hashtext(v_business_id::text || ':' || v_customer_id::text));
      -- Un reintento idempotente no es una admisión nueva: no se cuenta ni se frena.
      -- Se mira DESPUÉS del lock, para que el segundo de dos envíos iguales ya vea
      -- el pedido del primero.
      v_guarded := not exists (
        select 1 from public.orders o
         where o.business_id = v_business_id
           and o.client_request_id = v_client_request_id);
    end if;
  end if;

  if v_guarded then
    if jsonb_typeof(payload -> 'items') = 'array' then
      select sum((item.value ->> 'quantity')::bigint) into v_units
        from jsonb_array_elements(payload -> 'items') as item(value)
       where jsonb_typeof(item.value) = 'object'
         and (item.value ->> 'quantity') ~ '^[1-9][0-9]{0,8}$';
    end if;
    v_block := private.order_intake_guard(
      v_business, v_customer_id, 'manual', v_units, 'PT429', 'ORDER_RATE_LIMITED');
    if v_block is not null then
      return v_block;
    end if;
  end if;

  v_result := public.create_order_with_items_confirmed_location(v_payload);

  if v_guarded and nullif(v_result ->> 'id', '') is not null then
    perform private.order_intake_record_accept(
      v_business_id, v_customer_id, 'manual', (v_result ->> 'id')::uuid, null, v_units);
  end if;
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
  v_client_request_id text;
  v_business public.businesses%rowtype;
  v_guarded boolean := false;
  v_units bigint;
  v_block jsonb;
  v_result jsonb;
begin
  if p_customer_id is not null
    and p_payload is not null
    and jsonb_typeof(p_payload) = 'object'
    and coalesce(p_payload ->> 'business_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and btrim(coalesce(p_payload ->> 'client_request_id', '')) ~ '^[A-Za-z0-9_-]{8,128}$' then
    v_business_id := (p_payload ->> 'business_id')::uuid;
    v_client_request_id := btrim(p_payload ->> 'client_request_id');
    select b.* into v_business from public.businesses b where b.id = v_business_id;
    if found and v_business.order_intake_guard_mode <> 'off' then
      perform pg_advisory_xact_lock(
        hashtext('taba.order_intake.customer'),
        hashtext(v_business_id::text || ':' || p_customer_id::text));
      v_guarded := not exists (
        select 1 from public.checkout_sessions s
         where s.business_id = v_business_id
           and s.customer_id = p_customer_id
           and s.client_request_id = v_client_request_id);
    end if;
  end if;

  if v_guarded then
    -- Unidades que la sesión va a reservar: productos sueltos más los componentes de
    -- cada combo. Un combo desconocido lo rechaza la capa de adentro.
    if jsonb_typeof(p_payload -> 'items') = 'array' then
      select coalesce(sum(
               case
                 when item.value ? 'combo_id' then
                   (item.value ->> 'quantity')::bigint * coalesce((
                     select sum(cc.quantity)::bigint
                       from public.product_combos pc
                       join public.product_combo_components cc on cc.combo_id = pc.id
                      where pc.business_id = v_business_id
                        and pc.combo_id = (item.value ->> 'combo_id')), 0)
                 else (item.value ->> 'quantity')::bigint
               end), 0)
        into v_units
        from jsonb_array_elements(p_payload -> 'items') as item(value)
       where jsonb_typeof(item.value) = 'object'
         and (item.value ->> 'quantity') ~ '^[1-9][0-9]{0,8}$';
    end if;
    -- Mismo código y mismo mensaje que el freno que ya existía en este canal: la
    -- Edge Function no cambia.
    v_block := private.order_intake_guard(
      v_business, p_customer_id, 'checkout', v_units,
      '54000', 'demasiados intentos de checkout; reintenta mas tarde');
    if v_block is not null then
      return v_block;
    end if;
  end if;

  v_result := public.create_checkout_session_reserving(p_customer_id, p_payload);

  if v_guarded and nullif(v_result ->> 'checkout_session_id', '') is not null then
    perform private.order_intake_record_accept(
      v_business_id, p_customer_id, 'checkout', null, (v_result ->> 'checkout_session_id')::uuid, v_units);
  end if;
  return v_result;
end;
$function$;

drop function if exists private.order_items_have_null_quantity(jsonb);

commit;
