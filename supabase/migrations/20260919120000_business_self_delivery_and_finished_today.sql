-- ============================================================================
-- EL COMERCIO PUEDE CERRAR SU PROPIA ENTREGA
-- ============================================================================
--
-- EL DEFECTO, Y POR QUE NO ERA DEL PANEL
-- --------------------------------------
-- Un pedido de DELIVERY en `ready` no tenia ninguna transicion de negocio. La
-- rama `v_is_business` de `change_order_status` habilita `ready -> delivered`
-- solo cuando el pedido es de RETIRO, y la cadena
-- assigned/picked_up/on_the_way/arrived pertenece al rol `rider`.
--
-- Como `business_members` tiene `unique (business_id, user_id)`, una persona
-- tiene UN rol por comercio: el dueno no puede ser ademas repartidor del
-- negocio propio. Consecuencia medida en el Panel: un comercio que atiende su
-- dueno solo -que es como arranca cualquiera- no podia cerrar NINGUNA entrega.
-- El pedido se quedaba en «Listos» hasta que alguien lo cancelaba, y cancelarlo
-- es lo contrario de lo que paso: la mercaderia se entrego.
--
-- QUE HABILITA ESTA MIGRACION
-- ---------------------------
--   ready       -> on_the_way   (negocio, delivery, SIN rider asignado)
--   on_the_way  -> delivered    (negocio, delivery, SIN rider asignado)
--
-- `assigned_rider_user_id is null` no es una comodidad: es la linea que separa
-- los dos mundos. Con un repartidor asignado, el pedido es suyo y se cierra
-- como siempre se cerro, con el codigo del cliente. El comercio nunca puede
-- "entregar por" un repartidor que esta en la calle.
--
-- POR QUE ESTO NO DEBILITA EL CODIGO DE ENTREGA
-- ---------------------------------------------
-- `prevent_rider_unverified_delivery` exige el codigo cuando
--
--     new.assigned_rider_user_id = auth.uid()
--     AND has_business_role(business_id, array['rider'])
--
-- es decir: cuando quien entrega es EL REPARTIDOR ASIGNADO. Ese control existe
-- para que un repartidor no pueda declarar entregado algo que no entrego; es su
-- prueba de haber llegado hasta el cliente. No es -y nunca fue- un control
-- sobre el comercio, que responde con su propia plata y su propio nombre.
--
-- Las dos clausulas nuevas exigen `assigned_rider_user_id is null`, asi que
-- jamas coinciden con la condicion del guard: el codigo sigue siendo
-- obligatorio exactamente donde ya lo era. Y para que eso no dependa de que
-- nadie toque la matriz mas adelante, se agrega el guard SIMETRICO
-- `prevent_business_delivery_over_rider`, que corta por si mismo cualquier
-- cierre de negocio sobre un pedido con repartidor asignado.
--
-- UNA VEZ DESPACHADO, EL PEDIDO ES DEL COMERCIO
-- ---------------------------------------------
-- `assign_order_rider` y `release_or_reassign_delivery` exigen estado
-- `ready` o `assigned`. Un pedido que el comercio puso `on_the_way` ya no
-- admite rider: no hay forma de que los dos caminos se crucen a mitad de
-- camino. Si el comercio se equivoco, el pedido sigue admitiendo cancelacion
-- como cualquier otro no terminal.
--
-- LO QUE NO CAMBIA
-- ----------------
-- CAS por `expected_revision`, idempotencia por `business_command_receipts`,
-- `order_events` automatico con el actor, `delivered_at` por trigger,
-- publicacion realtime, RLS y el seguimiento del cliente: todo sigue siendo el
-- mismo camino. Esta migracion agrega dos aristas al grafo de estados y un
-- guard; no toca ninguna de esas capas.
-- ============================================================================

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
      using errcode = '40001';
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
      -- El negocio despacha y cierra su propia entrega, y SOLO mientras no haya
      -- un repartidor con el pedido en la mano. `assigned_rider_user_id is null`
      -- es la condicion entera: con rider asignado estas dos clausulas no
      -- existen y la entrega sigue siendo suya, con su codigo.
      --
      -- No se agrega 'arrived': para quien lleva el pedido en su propia moto,
      -- "llegue" y "entregue" ocurren con dos segundos de diferencia y serian
      -- dos toques para el mismo hecho. La cadena completa sigue disponible
      -- para el rider, que si necesita distinguirlas.
      or (
        v_current_status = 'ready'
        and v_order.delivery_mode = 'delivery'
        and v_order.assigned_rider_user_id is null
        and v_new_status = 'on_the_way'
      )
      or (
        v_current_status = 'on_the_way'
        and v_order.delivery_mode = 'delivery'
        and v_order.assigned_rider_user_id is null
        and v_new_status = 'delivered'
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
  -- until a separate, human-verified inventory adjustment. Availability remains
  -- fail-closed when stock is restored.
  if v_new_status in ('cancelled', 'rejected')
    and v_current_status not in ('picked_up', 'on_the_way', 'arrived')
    and v_order.inventory_released_at is null then
    perform p.id
      from public.products p
     where p.id in (
       select distinct oi.product_uuid
         from public.order_items oi
        where oi.order_id = v_order.id
          and oi.product_uuid is not null
     )
     order by p.id
     for update;

    update public.products p
       set stock = coalesce(p.stock, 0) + released.quantity
      from (
        select
          oi.product_uuid,
          sum(oi.quantity)::integer as quantity
        from public.order_items oi
        where oi.order_id = v_order.id
          and oi.product_uuid is not null
        group by oi.product_uuid
      ) as released
     where p.id = released.product_uuid;
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
  'Authenticated, role-aware order transition with expected-status concurrency control. El negocio puede despachar y entregar su propio delivery mientras no haya repartidor asignado.';

revoke all on function public.change_order_status(uuid, text, text)
from public, anon, authenticated;

-- ── El guard simetrico: el negocio no cierra la entrega de un repartidor ─────
--
-- La matriz de `change_order_status` ya lo impide. Este trigger lo impide OTRA
-- VEZ, y a proposito: la matriz es una expresion booleana de veinte lineas que
-- alguien va a volver a editar, y el dia que una clausula pierda su
-- `assigned_rider_user_id is null` el sistema dejaria de exigir el codigo sin
-- que nada avise. Un invariante que sostiene la prueba de entrega de un
-- repartidor no puede depender de que nadie se equivoque al leer un `or`.
--
-- Es el espejo exacto de `prevent_rider_unverified_delivery`: aquel cubre al
-- repartidor asignado, este cubre a todos los demas.
create or replace function public.prevent_business_delivery_over_rider()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $business_delivery_guard$
begin
  if public.normalize_order_status_vocabulary(new.status) = 'delivered'
    and public.normalize_order_status_vocabulary(old.status) is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.assigned_rider_user_id is not null
    and new.assigned_rider_user_id is distinct from auth.uid()
    and coalesce(current_setting('taba.delivery_code_confirmed', true), '') <> 'true' then
    raise exception 'la entrega la confirma el repartidor asignado con el codigo del cliente'
      using errcode = '42501';
  end if;
  return new;
end;
$business_delivery_guard$;

drop trigger if exists orders_prevent_business_delivery_over_rider on public.orders;
create trigger orders_prevent_business_delivery_over_rider
before update of status on public.orders
for each row execute function public.prevent_business_delivery_over_rider();

-- Una funcion de trigger no necesita que NADIE pueda ejecutarla: la corre el
-- trigger, con el dueno de la tabla. Sin este revoke queda con EXECUTE para
-- PUBLIC -el valor por defecto de PostgreSQL- y entra en el recuento de
-- `production_least_privilege_test`, que cuenta cuantas SECURITY DEFINER puede
-- ejecutar `anon`. Es la misma linea que lleva `prevent_rider_unverified_delivery`.
revoke all on function public.prevent_business_delivery_over_rider()
from public, anon, authenticated;

comment on function public.prevent_business_delivery_over_rider() is
  'Un pedido con repartidor asignado solo se entrega con el codigo del cliente. Espejo de prevent_rider_unverified_delivery para el resto de los actores.';

-- ── La huella de auditoria: quien entrego, y con que prueba ─────────────────
--
-- El trigger de `order.status_changed` ya registra actor y rol en cada cambio,
-- asi que la entrega del comercio NO queda sin rastro sin esto. Lo que agrega
-- este evento es la distincion que un cambio de estado generico no puede hacer:
-- «lo entrego el comercio, sin repartidor y sin codigo» y «lo entrego el
-- repartidor probando el codigo del cliente» son dos hechos con consecuencias
-- distintas -uno tiene prueba de haber llegado al cliente y el otro no- y en un
-- reclamo hay que poder separarlos sin reconstruirlo desde la ausencia de otra
-- fila.
create or replace function public.record_business_self_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $self_delivery_event$
begin
  if public.normalize_order_status_vocabulary(new.status) = 'delivered'
    and public.normalize_order_status_vocabulary(old.status) is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.assigned_rider_user_id is null
    and auth.uid() is not null
    and public.has_business_role(new.business_id, array['owner', 'admin', 'staff']) then
    -- `code_verified` NO es una constante: se lee de la fila de handoff. Un
    -- pedido con `delivery_code_required` -o sea, todos desde 20260725090000-
    -- se cierra con el codigo del cliente, y el evento tiene que poder decirlo.
    -- Escribir `false` fijo convertiria en «sin prueba» una entrega que si la
    -- tiene, que es mentir en el unico registro que queda para un reclamo.
    declare
      v_verified boolean := exists (
        select 1 from public.order_delivery_handoffs h
         where h.order_id = new.id and h.confirmed_at is not null
      );
    begin
      insert into public.order_events (
        order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
        event_type, type, message, metadata, payload
      ) values (
        new.id, new.business_id, auth.uid(), 'business', 'business', auth.uid(),
        'order.business_self_delivery', 'order.business_self_delivery',
        case when v_verified
          then 'Entrega cerrada por el comercio con el codigo del cliente.'
          else 'Entrega cerrada por el comercio, sin repartidor y sin codigo.' end,
        jsonb_build_object('previous_status', old.status, 'delivery_mode', new.delivery_mode, 'code_verified', v_verified),
        jsonb_build_object('previous_status', old.status, 'delivery_mode', new.delivery_mode, 'code_verified', v_verified)
      );
    end;
  end if;
  return null;
end;
$self_delivery_event$;

drop trigger if exists orders_record_business_self_delivery on public.orders;
create trigger orders_record_business_self_delivery
after update of status on public.orders
for each row execute function public.record_business_self_delivery();

revoke all on function public.record_business_self_delivery()
from public, anon, authenticated;

comment on function public.record_business_self_delivery() is
  'Deja explicito en order_events que una entrega la cerro el comercio sin repartidor y sin codigo del cliente.';

-- ============================================================================
-- EL COMERCIO CIERRA SU ENTREGA CON EL CÓDIGO DEL CLIENTE
-- ============================================================================
--
-- POR QUE ESTA FUNCION EXISTE
-- ---------------------------
-- Habilitar `on_the_way -> delivered` en la matriz de `change_order_status` NO
-- alcanza, y el motivo es una tercera compuerta que no depende de quien entrega:
--
--     prevent_unverified_delivery()  (20260725090000)
--       status -> 'delivered' AND delivery_mode = 'delivery'
--       AND new.delivery_code_required
--       AND no hay handoff confirmado          ->  55000
--
-- `orders.delivery_code_required` es NOT NULL con DEFAULT true: todo pedido de
-- delivery nace exigiendo el codigo del cliente. O sea que un boton «Marcar
-- entregado» que llamara a `transition_order` moriria con 55000 en el primer
-- pedido real. Seria el defecto H1 otra vez -una accion que la pantalla ofrece
-- y el servidor rechaza- y por eso el camino del comercio necesita confirmar el
-- codigo igual que el del repartidor.
--
-- Y esta bien que asi sea. El codigo no protege al repartidor de su patron:
-- protege al CLIENTE, y prueba que la mercaderia llego hasta el. Quien la lleve
-- no cambia que haya que probarlo.
--
-- POR QUE NO SE EXTENDIO `confirm_delivery_code`
-- ----------------------------------------------
-- Aquella escribe en `rider_delivery_operations` y en el alfabeto de claves del
-- Rider (`^[A-Za-z0-9_-]{8,128}$`, sin `:`), y el Panel del negocio usa otro
-- (`^[A-Za-z0-9:_-]{8,128}$`) y su propia tabla de recibos. Mezclar los dos
-- caminos en una sola funcion obligaria a que cada `if` de adentro supiera de
-- que lado viene, que es como se rompe una funcion que hoy anda.
--
-- Lo que SI se comparte -y es lo que importa- es el ESTADO: la misma fila de
-- `order_delivery_handoffs`, con su `code_hash`, sus `failed_attempts` y su
-- `locked_until`. Los intentos fallidos de los dos caminos cuentan en el mismo
-- contador y la demora que impone uno la sufre el otro: no hay una segunda
-- ventana de intentos por haber entrado por otra puerta.
--
-- LO QUE NO HACE
-- --------------
-- No toca un pedido con repartidor asignado: ese sigue siendo del Rider y se
-- cierra por `confirm_delivery_code`. No revela el codigo -lo compara contra el
-- hash, nunca lo devuelve-. Y con `delivery_code_required = false` -pedidos
-- anteriores a 20260725090000- no inventa un codigo que nunca se emitio: cierra
-- la entrega y lo deja dicho en el resultado.
create or replace function public.confirm_business_delivery_code(
  p_order_id uuid,
  p_expected_revision bigint,
  p_delivery_code text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $confirm_business$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_retry_seconds integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'este cierre es para pedidos con envio' using errcode = '42501';
  end if;
  -- Con repartidor asignado el pedido es suyo: lo cierra el, por su camino.
  if v_order.assigned_rider_user_id is not null then
    raise exception 'la entrega la confirma el repartidor asignado' using errcode = '42501';
  end if;

  -- La idempotencia del Panel: la misma tabla y la misma huella que el resto de
  -- sus comandos, asi que un reintento del outbox devuelve el recibo en vez de
  -- gastar un intento del codigo.
  v_hash := public.business_command_request_hash(
    'confirm_business_delivery_code', p_order_id,
    jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Doble toque sobre un pedido ya entregado: exito, sin tocar nada.
  if public.normalize_order_status_vocabulary(v_order.status) = 'delivered' then
    select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
    return v_result || jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_replay', false);
  end if;

  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision, v_order.revision using errcode = '40001';
  end if;
  if public.normalize_order_status_vocabulary(v_order.status) <> 'on_the_way' then
    raise exception 'el pedido tiene que estar en reparto para cerrarlo' using errcode = '23514';
  end if;

  if v_order.delivery_code_required then
    if v_code !~ '^[0-9]{4}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_format', 'revision', v_order.revision);
    end if;

    select h.* into v_handoff from public.order_delivery_handoffs h
     where h.order_id = v_order.id for update;
    if not found or v_handoff.expires_at <= v_now then
      return jsonb_build_object('ok', false, 'code', 'code_unavailable', 'revision', v_order.revision);
    end if;

    -- La demora vive en la fila del pedido, no en el actor: un intento fallido
    -- del Rider deja esperando tambien al mostrador, y al reves. Una segunda
    -- ventana de intentos por entrar por otra puerta seria justamente el agujero.
    if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
      v_retry_seconds := greatest(1, ceil(extract(epoch from (v_handoff.locked_until - v_now)))::integer);
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128),
              'temporarily_locked', greatest(1, v_handoff.failed_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false, 'code', 'temporarily_locked',
                                'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
      v_attempts := least(20, v_handoff.failed_attempts + 1);
      v_retry_seconds := case when v_attempts < 5 then null
                              else least(86400, 300 * power(2, least(8, v_attempts - 5))::integer) end;
      update public.order_delivery_handoffs
         set failed_attempts = v_attempts,
             locked_until = case when v_retry_seconds is null then null
                                 else v_now + make_interval(secs => v_retry_seconds) end
       where order_id = v_order.id;
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128),
              case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
              greatest(0, v_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false,
        'code', case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
        'remaining_attempts', greatest(0, 5 - v_attempts),
        'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    -- El codigo es el bueno. Se marca ANTES del update: `prevent_unverified_delivery`
    -- mira esta fila, no una variable de sesion.
    update public.order_delivery_handoffs
       set confirmed_at = v_now, confirmed_by_user_id = auth.uid(),
           failed_attempts = 0, locked_until = null
     where order_id = v_order.id;
    insert into public.delivery_confirmation_attempts(
      business_id, order_id, rider_id, request_id, result)
    values (v_order.business_id, v_order.id, auth.uid(),
            left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128), 'confirmed')
    on conflict do nothing;
  end if;

  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered' where id = v_order.id and status = v_order.status;

  select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
  v_result := v_result || jsonb_build_object(
    'ok', true, 'outcome', 'confirmed',
    'code_verified', v_order.delivery_code_required,
    'idempotent_replay', false);

  insert into public.business_command_receipts(
    business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'confirm_business_delivery_code',
          p_idempotency_key, v_hash, v_result);

  return v_result;
end;
$confirm_business$;

revoke all on function public.confirm_business_delivery_code(uuid, bigint, text, text)
from public, anon;
grant execute on function public.confirm_business_delivery_code(uuid, bigint, text, text)
to authenticated;

comment on function public.confirm_business_delivery_code(uuid, bigint, text, text) is
  'El comercio cierra su propio reparto con el codigo del cliente. Comparte la fila de handoff -y su demora- con el camino del Rider; nunca toca un pedido con repartidor asignado.';

-- ============================================================================
-- «FINALIZADOS HOY», CONTADO POR EL SERVIDOR
-- ============================================================================
--
-- La bandeja del Panel trae solo estados ACTIVOS: `fetchBusinessOrderSnapshot`
-- filtra por `BUSINESS_INBOX_STATUSES` y `delivered` no esta entre ellos. Un
-- «finalizados hoy» contado en el navegador seria cero al abrir, cero despues
-- de recargar, y distinto en cada pestana: exactamente el tipo de numero que
-- hace desconfiar de todos los demas.
--
-- Traer los pedidos del dia para contarlos tampoco sirve: en una noche buena
-- son cientos de filas con sus items para mostrar UN numero de dos digitos.
-- Esto cuenta en el servidor y devuelve el numero.
--
-- LA ZONA SALE DE LA FILA DEL NEGOCIO, NO DEL LLAMADOR
-- ---------------------------------------------------
-- Es el mismo contrato que `prepare_daily_reconciliation` desde la migracion
-- 20260814020000, y por el mismo motivo (F32): el dia comercial lo define el
-- NEGOCIO, no el aparato que abre el Panel. Un telefono en UTC corria el dia
-- tres horas y la noche entera -el horario pico de una bebida- caia fuera de
-- su propio dia.
--
-- La primera version de esta funcion aceptaba `p_timezone` del cliente y lo
-- validaba contra `pg_timezone_names`. Validar que una zona EXISTE no es lo
-- mismo que validar que es LA DEL NEGOCIO: 'UTC' existe. El parametro se
-- conserva en la firma por compatibilidad de llamada, pero no decide nada, y
-- si viene distinto del huso del negocio se rechaza en vez de ignorarse en
-- silencio: un cliente que pide un dia que no es el del comercio esta pidiendo
-- otra cosa, y contestarle con el numero equivocado es peor que no contestarle.
--
-- POR QUE DOS NUMEROS Y NO UNO
-- ----------------------------
-- «Entregados» y «cancelados» son los dos finales posibles de una jornada y no
-- significan lo mismo: sumarlos en un solo «finalizados» esconde justo el que
-- hay que mirar. La tira del turno muestra los ENTREGADOS; el otro queda
-- disponible sin costo para quien lo necesite.
create or replace function public.get_business_finished_today(
  p_business_id uuid,
  p_timezone text,
  p_business_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $finished_today$
declare
  v_timezone text;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_delivered integer;
  v_cancelled integer;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  -- La misma compuerta de rol que el resto del Panel. `security definer` hace
  -- que esta funcion vea la tabla entera, asi que el filtro por negocio tiene
  -- que ser explicito y estar ANTES de contar: sin esto, cualquier cuenta
  -- autenticada podria contar los pedidos de otro comercio.
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  select nullif(btrim(coalesce(b.operating_timezone, '')), '')
    into v_timezone
    from public.businesses b
   where b.id = p_business_id;
  if v_timezone is null then
    raise exception 'el negocio no tiene huso horario configurado: no se puede contar el dia'
      using errcode = '55000',
            detail = 'businesses.operating_timezone esta vacio',
            hint = 'configurar el huso del negocio antes de contar pedidos cerrados';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'el huso horario del negocio no es valido: %', v_timezone using errcode = '22023';
  end if;
  -- El parametro del cliente no decide, pero tampoco se ignora: si pide otra
  -- zona esta pidiendo otro dia, y devolverle el del comercio como si fuera el
  -- suyo seria contestar otra pregunta.
  if p_timezone is not null and btrim(p_timezone) <> '' and btrim(p_timezone) <> v_timezone then
    raise exception 'la zona pedida no es la del negocio' using errcode = '22023';
  end if;

  v_date := coalesce(p_business_date, (now() at time zone v_timezone)::date);
  v_start := v_date::timestamp at time zone v_timezone;
  v_end := (v_date + 1)::timestamp at time zone v_timezone;

  -- Se cuenta por `updated_at` y no por `created_at`: la pregunta es «cuanto
  -- cerre hoy», y un pedido que entro a las 23:50 y se entrego a las 00:10
  -- pertenece al trabajo de la madrugada, no al del dia anterior. `delivered_at`
  -- seria mas preciso para los entregados pero no existe para los cancelados,
  -- y dos ventanas distintas en el mismo contador se explican peor de lo que
  -- valen.
  select
    count(*) filter (where public.normalize_order_status_vocabulary(o.status) = 'delivered'),
    count(*) filter (where public.normalize_order_status_vocabulary(o.status) in ('cancelled', 'rejected'))
    into v_delivered, v_cancelled
    from public.orders o
   where o.business_id = p_business_id
     and o.origin = 'production'
     and o.updated_at >= v_start
     and o.updated_at < v_end
     and public.normalize_order_status_vocabulary(o.status) in ('delivered', 'cancelled', 'rejected');

  return jsonb_build_object(
    'ok', true,
    'business_id', p_business_id,
    'business_date', v_date,
    'timezone', v_timezone,
    'window_start', v_start,
    'window_end', v_end,
    'delivered', coalesce(v_delivered, 0),
    'cancelled', coalesce(v_cancelled, 0),
    'generated_at', now()
  );
end;
$finished_today$;

revoke all on function public.get_business_finished_today(uuid, text, date)
from public, anon;
grant execute on function public.get_business_finished_today(uuid, text, date)
to authenticated;

comment on function public.get_business_finished_today(uuid, text, date) is
  'Cuenta en el servidor los pedidos cerrados del dia comercial de un negocio. Exige rol de negocio y una zona horaria valida; nunca devuelve filas de pedidos.';

-- El indice que sostiene el contador. Sin el, contar una noche pico recorre
-- todos los pedidos del comercio.
create index if not exists orders_business_updated_status_idx
  on public.orders (business_id, updated_at desc, status);
