-- El cliente puede cancelar su propio pedido mientras el comercio no lo tomó.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 en una base PG17 local con las
-- migraciones anteriores)
--
--   La regla existe desde 20260725030000: `change_order_status` deja que el cliente
--   dueño del pedido lo pase de `received`/`submitted` a `cancelled`. Pero ninguna
--   puerta llegaba a esa regla:
--
--     cliente -> change_order_status   42501 permission denied (sólo service_role)
--     cliente -> transition_order      42501 operador no autorizado
--     cliente -> cancel_order          42501 operador no autorizado
--
--   Quien se equivocó de pedido, o pidió dos veces, no podía retirarlo: el stock
--   quedaba tomado y el comercio podía prepararlo y despacharlo. El único remedio
--   era avisar por fuera de la aplicación.
--
-- QUÉ QUEDA
--
--   Una sola RPC nueva: `public.cancel_own_order(p_order_id, p_idempotency_key,
--   p_reason default null)`. Sólo `authenticated`.
--
--     · El pedido tiene que ser de quien llama (`orders.customer_user_id =
--       auth.uid()`). Un pedido ajeno responde EXACTAMENTE igual que uno que no
--       existe (P0002 «pedido inexistente») y ni siquiera se bloquea su fila: no
--       hay forma de averiguar si un id existe.
--     · Sólo mientras el comercio no lo tomó: estado `received`/`submitted`, pago
--       `cash` o `coordinate` y `manual_payment_status = 'pending'`. Cualquier otra
--       cosa se rechaza con 55000 y un `detail` estable para que el cliente web
--       elija el texto:
--         ORDER_PAID_ONLINE         pedido de Mercado Pago (o con un intento de
--                                   pago): se cancela con el comercio, que gestiona
--                                   el reembolso
--         ORDER_ALREADY_TAKEN       el comercio ya lo aceptó o lo está preparando
--         ORDER_CLOSED              entregado o rechazado
--         MANUAL_PAYMENT_RECORDED   el comercio ya registró un cobro
--         ORDER_NOT_CANCELLABLE     cualquier otro medio de pago
--     · La transición la hace `change_order_status`: mismo lock, misma regla de
--       cliente que ya estaba escrita, y el stock vuelve una sola vez por
--       `private.release_order_inventory`.
--     · Deja un evento con actor cliente, `order.cancelled_by_customer`, con el
--       motivo si lo dio (texto libre, hasta 300 caracteres, sin caracteres de
--       control) y la clave de idempotencia.
--     · Un pedido que ya está cancelado —por esta puerta, por el comercio o por
--       vencimiento— devuelve el pedido actual con `idempotent_no_op: true` y no
--       escribe nada. `cancelled_by_customer` dice si fue esta puerta, e
--       `idempotent_replay` si fue con esta misma clave.
--
--   La clave de idempotencia tiene el formato de los demás comandos
--   (`^[A-Za-z0-9:_-]{8,128}$`). No se guarda en `business_command_receipts`: esa
--   tabla es del comercio y su clave única es por negocio; un cliente no debe poder
--   ocupar claves ahí. La idempotencia sale del estado del pedido, bajo su lock.
--
-- QUÉ NO CAMBIA
--
--   · `change_order_status`, `transition_order` y `cancel_order`: ni cuerpo ni
--     permisos. El cliente sigue sin poder ejecutarlas.
--   · Lo que el comercio puede cancelar y cómo.
--   · Un pedido de Mercado Pago sigue necesitando el reembolso antes de cancelarse.
--
-- Depende de 20261001190000 para que la cancelación vuelva a ofrecer el producto.
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001192000_customer_cancels_own_unattended_order.rollback.sql

create or replace function public.cancel_own_order(
  p_order_id uuid,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_status text;
  v_reason text;
  v_prior_key text;
  v_cancelled_here boolean;
  v_result jsonb;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  -- El tope va sobre lo que llegó, antes de limpiarlo: un texto enorme se rechaza
  -- sin recorrerlo. Limpiar sólo puede acortarlo.
  if char_length(p_reason) > 300 then
    raise exception 'motivo de cancelacion demasiado largo' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g')), '');

  -- El dueño va en el WHERE, no en un IF posterior: un pedido ajeno no se bloquea ni
  -- se distingue de uno inexistente, ni por la respuesta ni por la espera de un lock.
  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = v_customer_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  v_status := public.normalize_order_status_vocabulary(v_order.status);

  if v_status = 'cancelled' then
    select e.metadata ->> 'idempotency_key'
      into v_prior_key
      from public.order_events e
     where e.order_id = v_order.id
       and e.event_type = 'order.cancelled_by_customer'
     order by e.sequence desc
     limit 1;
    v_cancelled_here := found;

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
                'rider_locations', '[]'::jsonb
              )
      into v_result
      from public.orders o
     where o.id = v_order.id;

    return v_result || jsonb_build_object(
      'idempotent_no_op', true,
      'idempotent_replay', coalesce(v_prior_key = btrim(p_idempotency_key), false),
      'cancelled_by_customer', v_cancelled_here
    );
  end if;

  if lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'
     or exists (select 1 from public.payment_intents pi where pi.order_id = v_order.id) then
    raise exception 'pedido pagado por Mercado Pago: pedir la cancelacion al comercio, que gestiona el reembolso'
      using errcode = '55000', detail = 'ORDER_PAID_ONLINE';
  end if;
  if lower(btrim(coalesce(v_order.payment_method, ''))) not in ('cash', 'coordinate') then
    raise exception 'este pedido no se puede cancelar desde la aplicacion'
      using errcode = '55000', detail = 'ORDER_NOT_CANCELLABLE';
  end if;
  if v_status in ('delivered', 'rejected') then
    raise exception 'el pedido ya esta cerrado'
      using errcode = '55000', detail = 'ORDER_CLOSED';
  end if;
  if v_status <> 'submitted' then
    raise exception 'el comercio ya tomo el pedido: pedir la cancelacion al comercio'
      using errcode = '55000', detail = 'ORDER_ALREADY_TAKEN';
  end if;
  if v_order.manual_payment_status is distinct from 'pending' then
    raise exception 'el pedido ya tiene un cobro registrado: pedir la cancelacion al comercio'
      using errcode = '55000', detail = 'MANUAL_PAYMENT_RECORDED';
  end if;

  v_result := public.change_order_status(v_order.id, v_order.status, 'cancelled');

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id, v_order.business_id, v_customer_id, 'customer', 'customer', v_customer_id,
    'order.cancelled_by_customer', 'order.cancelled_by_customer',
    'Pedido cancelado por el cliente.',
    jsonb_build_object(
      'reason', v_reason,
      'previous_status', v_order.status,
      'idempotency_key', btrim(p_idempotency_key)
    ),
    jsonb_build_object(
      'reason', v_reason,
      'previous_status', v_order.status,
      'idempotency_key', btrim(p_idempotency_key)
    )
  );

  return v_result || jsonb_build_object(
    'idempotent_no_op', false,
    'idempotent_replay', false,
    'cancelled_by_customer', true
  );
end;
$$;

-- `service_role` también: en Supabase los privilegios por defecto del esquema se lo
-- darían, y esta puerta no tiene sentido sin la sesión de un cliente.
revoke all on function public.cancel_own_order(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_own_order(uuid, text, text) to authenticated;

comment on function public.cancel_own_order(uuid, text, text) is
  'El cliente cancela su propio pedido manual mientras el comercio no lo tomo. Un pedido ajeno responde igual que uno inexistente. Delega la transicion en change_order_status.';
