-- Cancelar o rechazar un pedido devuelve el stock Y vuelve a ofrecer el producto.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 158 migraciones anteriores más
-- 20261001180000, en una base PG17 local)
--
--   Un producto con 2 unidades. Un cliente pide las 2 en efectivo: `stock = 0`,
--   `available = false` (lo escribe el alta del pedido). El comercio cancela:
--
--     antes de cancelar   stock=0 available=f merchant_available=t
--     después de cancelar stock=2 available=f merchant_available=t
--
--   El stock vuelve y el producto sigue fuera de la tienda. La política pública de
--   `products` exige `available`, así que nadie lo ve hasta que un dueño lo
--   republica a mano, SKU por SKU. Con el rechazo pasa lo mismo.
--
--   No era un descuido de una línea: `change_order_status` decía a propósito
--   «Availability remains fail-closed when stock is restored». Esa frase es anterior
--   a `merchant_available` (20260918010000), que separó la intención del comercio
--   del estado del stock. Las otras dos devoluciones de stock —el checkout vencido
--   (`release_checkout_session_inventory`) y la caja (`private.pos_try_reoffer`)—
--   ya republicaban; el pedido cancelado era el único camino que no.
--
-- QUÉ CAMBIA
--
--   1. `private.release_order_inventory(p_order_id)`: UNA función devuelve el stock
--      de un pedido. La usan todos los caminos que cierran un pedido sin entregarlo
--      (este cambio de estado hoy; el vencimiento de pedidos sin atender y la
--      cancelación del cliente en las migraciones que siguen).
--        · exactamente una vez: mira `orders.inventory_released_at` con la fila del
--          pedido bloqueada; si ya está escrito, no hace nada y devuelve 0;
--        · bloquea los productos en orden de id, igual que el alta del pedido;
--        · recalcula `available` con la MISMA expresión que el checkout vencido:
--          merchant_available and is_active and is_verified and stock nuevo > 0
--          and price_status = 'confirmed' and price > 0;
--        · un producto que el comercio ocultó (`merchant_available = false`) sigue
--          oculto: la devolución nunca decide por el comercio.
--   2. `change_order_status` llama a esa función en lugar de llevar su propia copia
--      del UPDATE. Es el único cambio en su cuerpo.
--
-- QUÉ NO CAMBIA
--
--   · La matriz de transiciones, los errores, el lock del pedido, el CAS por estado
--     esperado y la respuesta de `change_order_status`: idénticos.
--   · `inventory_released_at` lo sigue escribiendo `change_order_status` en el MISMO
--     UPDATE que cambia el estado. Por eso la revisión avanza una sola vez y el
--     evento `order.status_changed` sigue diciendo `inventory_released: true`.
--   · Cancelar después del retiro (`picked_up`, `on_the_way`, `arrived`) sigue sin
--     devolver stock: la mercadería no volvió al local.
--   · Los resguardos de `products` siguen mandando: `products_pos_conflict_hold`
--     mantiene despublicado un producto con conflicto de caja abierto, y los CHECK
--     de publicación siguen vigentes. Si un CHECK no deja republicar (por ejemplo
--     `cp_published_requires_approved_image`), el stock vuelve igual y el producto
--     queda como estaba: una regla de publicación no puede trabar una cancelación.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001190000_order_cancel_returns_stock_and_republishes.rollback.sql

create or replace function private.release_order_inventory(p_order_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_released_at timestamptz;
  v_line record;
  v_rows integer;
  v_touched integer := 0;
begin
  -- El lock es reentrante: quien llama ya suele tener la fila. Tomarlo acá hace que
  -- la marca se lea siempre bajo lock, llame quien llame.
  select o.inventory_released_at
    into v_released_at
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  if v_released_at is not null then
    return 0;
  end if;

  -- Mismo orden de bloqueo que el alta del pedido y que el checkout: por id.
  perform p.id
    from public.products p
   where p.id in (
     select distinct oi.product_uuid
       from public.order_items oi
      where oi.order_id = p_order_id
        and oi.product_uuid is not null
   )
   order by p.id
   for update;

  for v_line in
    select
      oi.product_uuid,
      sum(oi.quantity)::integer as quantity
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.product_uuid is not null
    group by oi.product_uuid
    order by oi.product_uuid
  loop
    begin
      update public.products p
         set stock = coalesce(p.stock, 0) + v_line.quantity,
             available = p.merchant_available
                         and p.is_active
                         and p.is_verified
                         and (coalesce(p.stock, 0) + v_line.quantity) > 0
                         and p.price_status = 'confirmed'
                         and p.price > 0
       where p.id = v_line.product_uuid;
      get diagnostics v_rows = row_count;
    exception
      when check_violation then
        -- Una regla de publicación no deja ofrecerlo. El stock vuelve igual: lo que
        -- no puede pasar es que el pedido quede sin poder cancelarse.
        raise warning 'stock repuesto sin republicar el producto % (%)', v_line.product_uuid, sqlerrm;
        update public.products p
           set stock = coalesce(p.stock, 0) + v_line.quantity
         where p.id = v_line.product_uuid;
        get diagnostics v_rows = row_count;
    end;
    v_touched := v_touched + v_rows;
  end loop;

  return v_touched;
end;
$$;

revoke all on function private.release_order_inventory(uuid) from public, anon, authenticated;

comment on function private.release_order_inventory(uuid) is
  'Devuelve el stock de un pedido y recalcula available. No hace nada si orders.inventory_released_at ya esta escrito. Quien llama escribe esa marca en el mismo UPDATE que cierra el pedido.';

create or replace function public.change_order_status(
  p_order_id uuid,
  p_expected_status text,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_current_status text;
  v_expected_status text;
  v_new_status text;
  v_is_business boolean := false;
  v_is_rider boolean := false;
  v_is_customer boolean := false;
  v_allowed boolean := false;
  v_claim_rider boolean := false;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;

  v_expected_status := case lower(btrim(coalesce(p_expected_status, '')))
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else lower(btrim(coalesce(p_expected_status, '')))
  end;
  v_new_status := case lower(btrim(coalesce(p_new_status, '')))
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else lower(btrim(coalesce(p_new_status, '')))
  end;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  v_current_status := case v_order.status
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else v_order.status
  end;

  if v_expected_status = ''
    or v_new_status = ''
    or v_current_status <> v_expected_status then
    raise exception 'conflicto de estado: esperado %, actual %',
      v_expected_status,
      v_current_status
      using errcode = 'PT409';
  end if;

  if v_new_status not in (
    'accepted',
    'preparing',
    'ready',
    'assigned',
    'picked_up',
    'on_the_way',
    'arrived',
    'delivered',
    'cancelled',
    'rejected'
  ) then
    raise exception 'estado destino invalido' using errcode = '22023';
  end if;

  v_is_business := public.has_business_role(
    v_order.business_id,
    array['owner', 'admin', 'staff']
  );
  v_is_rider := public.has_business_role(
    v_order.business_id,
    array['rider']
  );
  v_is_customer := v_order.customer_user_id = v_user_id;

  if v_is_business then
    v_allowed :=
      (
        v_current_status in ('received', 'submitted')
        and v_new_status in ('accepted', 'rejected', 'cancelled')
      )
      or (
        v_current_status = 'accepted'
        and v_new_status in ('preparing', 'cancelled')
      )
      or (
        v_current_status = 'preparing'
        and v_new_status in ('ready', 'cancelled')
      )
      or (
        v_current_status = 'ready'
        and v_order.delivery_mode = 'pickup'
        and v_new_status = 'delivered'
      )
      -- ===== Reparto propio del comercio (20260919) ==========================
      -- El negocio solo despacha su propia entrega. El cierre no es una arista
      -- de esta matriz: lo hace confirm_business_delivery_code despues de
      -- validar el codigo del cliente.
      or (
        v_current_status = 'ready'
        and v_order.delivery_mode = 'delivery'
        and v_order.assigned_rider_user_id is null
        and v_new_status = 'on_the_way'
      )
      or (
        v_current_status not in ('delivered', 'cancelled', 'rejected')
        and v_new_status = 'cancelled'
      );
  -- A rider may also be the customer who placed an order. Preserve the
  -- customer's right to cancel an initial order before evaluating rider-only
  -- transitions; later states still fall through to the rider rules.
  elsif v_is_customer
    and v_current_status in ('received', 'submitted')
    and v_new_status = 'cancelled' then
    v_allowed := true;
  elsif v_is_rider then
    if v_order.delivery_mode <> 'delivery' then
      raise exception 'los pedidos con retiro no admiten operacion de rider'
        using errcode = '42501';
    end if;

    if v_order.assigned_rider_user_id is not null
      and v_order.assigned_rider_user_id <> v_user_id then
      raise exception 'pedido asignado a otro rider' using errcode = '42501';
    end if;

    v_allowed :=
      (v_current_status = 'ready' and v_new_status in ('assigned', 'on_the_way'))
      or (v_current_status = 'assigned' and v_new_status in ('picked_up', 'on_the_way'))
      or (v_current_status = 'picked_up' and v_new_status = 'on_the_way')
      or (v_current_status = 'on_the_way' and v_new_status in ('arrived', 'delivered'))
      or (v_current_status = 'arrived' and v_new_status = 'delivered');

    v_claim_rider := v_allowed and v_order.assigned_rider_user_id is null;
  elsif v_is_customer then
    v_allowed := false;
  else
    raise exception 'sin permiso para cambiar este pedido' using errcode = '42501';
  end if;

  if not v_allowed then
    raise exception 'transicion no permitida: % -> %',
      v_current_status,
      v_new_status
      using errcode = '23514';
  end if;

  -- A pre-dispatch cancellation/rejection releases the reservation exactly
  -- once. Once picked up or dispatched, a status cancellation does not mean
  -- merchandise is physically back at the store, so stock remains unchanged
  -- until a separate, human-verified inventory adjustment. La devolucion vuelve
  -- a ofrecer el producto solo si el comercio no lo oculto: la regla vive en
  -- private.release_order_inventory, compartida por todos los cierres.
  if v_new_status in ('cancelled', 'rejected')
    and v_current_status not in ('picked_up', 'on_the_way', 'arrived')
    and v_order.inventory_released_at is null then
    perform private.release_order_inventory(v_order.id);
  end if;

  update public.orders
     set status = v_new_status,
         assigned_rider_user_id = case
           when v_claim_rider then v_user_id
           else assigned_rider_user_id
         end,
          inventory_released_at = case
            when v_new_status in ('cancelled', 'rejected')
              and v_current_status not in ('picked_up', 'on_the_way', 'arrived')
              then coalesce(inventory_released_at, now())
            else inventory_released_at
         end
   where id = v_order.id;

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
              'rider_locations',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(rl) order by rl.created_at desc, rl.id)
                    from public.rider_locations rl
                   where rl.order_id = o.id
                     and rl.source = 'gps'
                ),
                '[]'::jsonb
              )
            )
    into v_result
    from public.orders o
   where o.id = v_order.id;

  return v_result;
end;
$$;

comment on function public.change_order_status(uuid, text, text) is
  'Authenticated, role-aware order transition with expected-status concurrency control. El negocio puede despachar su propio delivery; solo confirm_business_delivery_code puede entregarlo. Cancelar o rechazar antes del retiro devuelve el stock una sola vez y vuelve a ofrecer lo que el comercio no oculto.';

-- Mismos permisos que tenía: ningún rol de cliente. No se agrega ninguno.
revoke all on function public.change_order_status(uuid, text, text)
from public, anon, authenticated;
