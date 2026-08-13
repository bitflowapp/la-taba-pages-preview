-- TABA2 · Capa de identidad, parte 11: asignar un rider pasa por la compuerta.
--
-- Ultimo hueco de autorizacion de la tanda, y el unico que quedaba del lado del
-- Panel. Reproducido contra staging alojado con un token real por PostgREST,
-- sin mutar ningun pedido:
--
--   staff ACTIVO ................. AUTORIZACION PASO
--   staff REVOCADO, token vigente  AUTORIZACION PASO   <-- el hueco
--
-- La causa es la misma que ya se cerro en las RPC del Rider: la funcion
-- resolvia el rol de QUIEN LLAMA leyendo public.business_members en linea
--
--     perform 1 from public.business_members bm
--      where bm.business_id = v_order.business_id
--        and bm.user_id = v_user_id
--        and bm.role in ('owner','admin','staff')
--        and bm.is_active = true;
--
-- en vez de preguntarle a has_business_role, que es donde vive la compuerta.
-- Esa consulta ve `is_active` —asi que una BAJA de cuenta la cerraba— pero no
-- sabe nada de sesiones revocadas.
--
-- DOS CAMBIOS, y ninguno mas:
--
-- 1. La autorizacion del llamador pasa por public.has_business_role, con los
--    mismos tres roles y el mismo error. Un staff activo sigue asignando igual.
--
-- 2. La autorizacion ocurre ANTES de leer y BLOQUEAR el pedido. Antes, la
--    funcion hacia `select ... for update` sobre el pedido y recien despues
--    miraba quien llamaba: cualquiera con un token podia tomar un lock de fila
--    sobre un pedido ajeno y quedarse esperando el de otro. Se midio de paso al
--    reproducir: una llamada quedo colgada hasta el 504 del gateway. Ahora el
--    orden es comercio -> autorizacion -> bloqueo.
--
-- LO QUE NO CAMBIA, a proposito:
--   * la validacion del DESTINATARIO sigue siendo una lectura de membresia. Es
--     correcta: lo que importa de quien recibe la asignacion es que sea un rider
--     activo del comercio, no en que estado esta su sesion. Tocarla cambiaria la
--     semantica del despacho;
--   * el CAS, los estados, los eventos y el payload de retorno, identicos;
--   * SECURITY DEFINER y el search_path, identicos;
--   * los grants, sin ampliar;
--   * el codigo y el mensaje de error del rechazo, identicos: 42501 con
--     'rol de negocio requerido'. El Panel no ve nada distinto.
--
-- Aplicar despues de 20260812100000_active_delivery_checks_the_session_first.sql.

create or replace function public.assign_order_rider(
  p_order_id uuid,
  p_expected_status text,
  p_expected_rider_user_id uuid,
  p_new_rider_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_business_id uuid;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_new_rider_user_id is null then
    raise exception 'order_id y rider requeridos' using errcode = '22023';
  end if;

  -- Solo para saber CONTRA QUE comercio autorizar. Sin bloqueo: un llamador que
  -- todavia no demostro nada no puede tomar el lock de una fila.
  select o.business_id
    into v_business_id
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  -- La compuerta: membresia activa, persona habilitada, sesion no revocada y
  -- token posterior al corte. Mismo error que antes.
  if not public.has_business_role(v_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  -- Recien ahora se bloquea la fila.
  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;

  -- El destinatario: lo que importa es que sea un rider activo del comercio.
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = p_new_rider_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rider activo del negocio requerido' using errcode = '42501';
  end if;

  if v_expected_status not in ('ready', 'assigned')
    or v_order.status <> v_expected_status
    or v_order.status not in ('ready', 'assigned')
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id then
    raise exception 'conflicto de asignacion: estado o rider esperado cambio'
      using errcode = '40001';
  end if;

  if v_order.assigned_rider_user_id = p_new_rider_user_id
    and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id);
  end if;

  update public.orders
     set assigned_rider_user_id = p_new_rider_user_id,
         status = 'assigned'
   where id = v_order.id;

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
    v_user_id,
    'business',
    'business',
    v_user_id,
    case
      when v_order.assigned_rider_user_id is null
        then 'order.rider_assigned'
      else 'order.rider_reassigned'
    end,
    case
      when v_order.assigned_rider_user_id is null
        then 'order.rider_assigned'
      else 'order.rider_reassigned'
    end,
    case
      when v_order.assigned_rider_user_id is null
        then 'Rider asignado por el negocio'
      else 'Rider reasignado por el negocio'
    end,
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    )
  );

  return public.rider_order_rpc_payload(v_order.id);
end;
$function$;

select pg_notify('pgrst', 'reload schema');
