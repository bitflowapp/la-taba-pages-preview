-- La Taba — Backend Phase 1 hardening
-- 1) Creación de pedidos transaccional (order + items + evento en UNA transacción).
-- 2) RLS más estricta: la creación deja de ser un INSERT anónimo directo y pasa
--    exclusivamente por la función validada de abajo.
--
-- NOTA DE SEGURIDAD (leer): las policies de lectura/escritura de estado siguen
-- abiertas a anon porque la Fase 1 NO tiene auth todavía. Es un piloto controlado,
-- NO una configuración productiva. Auth real, roles negocio/rider y scoping por
-- business_id quedan para Fase 2 (ver docs/supabase-backend-phase-1.md).

-- ===== Creación transaccional de pedidos =====
-- SECURITY DEFINER: corre con privilegios del owner y valida la entrada, así el
-- cliente anónimo no puede insertar order/order_items arbitrarios por su cuenta.
create or replace function public.create_order_with_items(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed_status text[] := array[
    'draft', 'submitted', 'accepted', 'preparing', 'ready', 'assigned',
    'picked_up', 'on_the_way', 'arrived', 'delivered', 'canceled'
  ];
  v_business_id uuid;
  v_status text;
  v_fulfillment text;
  v_items jsonb;
  v_order_id uuid;
  v_result jsonb;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload inválido' using errcode = '22023';
  end if;

  v_business_id := nullif(payload->>'business_id', '')::uuid;
  v_status := coalesce(nullif(payload->>'status', ''), 'submitted');
  v_fulfillment := coalesce(nullif(payload->>'fulfillment_type', ''), 'delivery');
  v_items := coalesce(payload->'items', '[]'::jsonb);

  if v_business_id is null then
    raise exception 'business_id requerido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.businesses b where b.id = v_business_id) then
    raise exception 'business_id inexistente' using errcode = '23503';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'el pedido necesita al menos un ítem' using errcode = '22023';
  end if;
  if not (v_status = any (v_allowed_status)) then
    raise exception 'status inicial no permitido: %', v_status using errcode = '22023';
  end if;
  if v_fulfillment not in ('delivery', 'pickup') then
    raise exception 'fulfillment_type no permitido: %', v_fulfillment using errcode = '22023';
  end if;
  if coalesce((payload->>'total')::numeric, 0) < 0 then
    raise exception 'total inválido' using errcode = '22023';
  end if;

  insert into public.orders (
    id, business_id, code, status, fulfillment_type,
    customer_name, customer_phone, customer_whatsapp,
    address_label, address_lat, address_lng, notes, payment_method,
    subtotal, delivery_fee, total
  ) values (
    coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid()),
    v_business_id,
    coalesce(nullif(payload->>'code', ''), 'LT-' || substr(gen_random_uuid()::text, 1, 8)),
    v_status,
    v_fulfillment,
    nullif(payload->>'customer_name', ''),
    nullif(payload->>'customer_phone', ''),
    nullif(payload->>'customer_whatsapp', ''),
    nullif(payload->>'address_label', ''),
    nullif(payload->>'address_lat', '')::double precision,
    nullif(payload->>'address_lng', '')::double precision,
    nullif(payload->>'notes', ''),
    nullif(payload->>'payment_method', ''),
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'delivery_fee')::numeric, 0),
    coalesce((payload->>'total')::numeric, 0)
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, name, quantity, unit, unit_price, subtotal)
  select
    v_order_id,
    elem->>'product_id',
    elem->>'name',
    coalesce((elem->>'quantity')::numeric, 0),
    nullif(elem->>'unit', ''),
    coalesce((elem->>'unit_price')::numeric, 0),
    coalesce((elem->>'subtotal')::numeric, 0)
  from jsonb_array_elements(v_items) as elem;

  insert into public.order_events (order_id, type, actor_type, payload)
  values (
    v_order_id,
    'order.submitted',
    'web',
    jsonb_build_object('code', payload->>'code', 'source', 'web_checkout')
  );

  select to_jsonb(o.*)
         || jsonb_build_object(
              'order_items',
              coalesce(
                (select jsonb_agg(to_jsonb(oi.*) order by oi.created_at)
                   from public.order_items oi where oi.order_id = o.id),
                '[]'::jsonb
              ),
              'rider_locations', '[]'::jsonb
            )
    into v_result
    from public.orders o
   where o.id = v_order_id;

  return v_result;
end;
$$;

grant execute on function public.create_order_with_items(jsonb) to anon, authenticated;

-- ===== RLS más estricta para la creación =====
-- La creación de pedidos/ítems ya NO se hace por INSERT directo anónimo:
-- se quitan esas policies y queda únicamente la función validada de arriba.
drop policy if exists "phase1 public create orders" on public.orders;
drop policy if exists "phase1 public create order items" on public.order_items;

-- Las siguientes policies SIGUEN abiertas a anon a propósito (piloto sin auth):
-- lectura de pedidos/ítems/negocio/riders/ubicaciones y actualización de estado.
-- NO usar con datos sensibles. Endurecer en Fase 2 con auth + scoping por business_id.
comment on policy "phase1 public read orders" on public.orders is
  'DEMO/PILOTO: lectura anónima sin auth. Reemplazar por scoping por business_id en Fase 2.';
comment on policy "phase1 public update orders" on public.orders is
  'DEMO/PILOTO: update anónimo de estado (whitelist de status). Restringir por rol/negocio en Fase 2.';
comment on function public.create_order_with_items(jsonb) is
  'Creación transaccional de pedido + ítems + evento. SECURITY DEFINER con validación de entrada.';
