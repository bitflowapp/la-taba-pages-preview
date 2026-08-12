-- TABA2 · Capa de identidad, parte 9: las RPC del Rider consultan la compuerta.
--
-- Defecto encontrado en el gate fisico sobre el Moto G15, revocando de verdad
-- contra staging alojado. Con la sesion del telefono REVOCADA y su access token
-- todavia vigente:
--
--   get_rider_queue ............ 200  SIGUE ABIERTO   <-- el hueco
--   identity_touch_session ..... not_authorized
--   identity_current_context ... rol null
--   refresh del token .......... 400  RECHAZADO
--
-- La causa: el diseno apostaba a que la compuerta viviera dentro de
-- has_business_role, que esta cableada en decenas de politicas. Pero las RPC
-- del Rider NO la usan: resuelven la membresia leyendo public.business_members
-- en linea. Esas consultas miran `is_active`, asi que una BAJA de cuenta las
-- cierra al instante —medido, devuelve 42501—, pero no saben nada de sesiones
-- revocadas. Resultado: revocar una sesion mataba la cadena de refresh y toda
-- la superficie de identidad al instante, y aun asi el Rider seguia leyendo su
-- cola hasta que venciera el access token: hasta una hora.
--
-- Lo que se toca es deliberadamente poco, porque son funciones que mueven
-- entregas:
--
--   * rider_require_active_membership es el ayudante compartido de NUEVE de las
--     doce RPC del Rider (get_rider_queue, claim_delivery_order,
--     mark_delivery_picked_up, start_rider_delivery, mark_rider_arrived,
--     confirm_delivery_code, report_rider_delivery_issue,
--     publish_rider_location_receipt y la reserva de cola). Con la compuerta
--     adentro, las nueve cierran de una vez.
--   * get_active_rider_delivery era la unica RPC alcanzable del Rider que
--     resolvia la membresia por su cuenta. Se le cambia la union por una
--     llamada al ayudante; el resto del cuerpo queda igual.
--
-- Las pesadas que tambien tenian la comprobacion en linea —publish_rider_location,
-- confirm_order_delivery, claim_available_rider_order y la firma vieja de
-- start_rider_delivery— NO se tocan porque ya estan revocadas de `authenticated`
-- por las migraciones de revocacion legado: no son alcanzables por un cliente.
-- Verificado con has_function_privilege antes de escribir esto.
--
-- LO QUE ESTA MIGRACION NO CIERRA, dicho para que nadie lo suponga:
-- assign_order_rider resuelve el rol de QUIEN LLAMA en linea
-- (`bm.role in ('owner','admin','staff')`), asi que una sesion de staff
-- revocada puede seguir asignando riders hasta que venza su token. Son 116
-- lineas de una funcion que mueve pedidos y queda como deuda anotada, no
-- arreglada al pasar.
--
-- Aplicar despues de 20260812080000_identity_membership_guard_sees_the_real_caller.sql.

-- ===========================================================================
-- 1. El ayudante compartido de las RPC del Rider
-- ===========================================================================
-- Misma firma, mismo error, mismo errcode. Lo unico que cambia es que ahora la
-- autoridad es la compuerta y no una lectura suelta de la tabla.

create or replace function public.rider_require_active_membership(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  -- identity_member_role aplica las cinco reglas a la vez: no anonimo,
  -- membresia activa, persona habilitada, sesion no revocada y token posterior
  -- al corte. Antes aca habia un `select ... from business_members` que solo
  -- sabia de la primera y la segunda.
  if public.identity_member_role(p_business_id) is distinct from 'rider' then
    raise exception 'membership rider activa requerida' using errcode = '42501';
  end if;
end;
$$;

-- ===========================================================================
-- 2. La unica RPC alcanzable del Rider que resolvia la membresia sola
-- ===========================================================================
-- El cuerpo es el mismo salvo la union con business_members, que pasa a ser una
-- llamada al ayudante. Se conserva `stable`: la compuerta tambien lo es.

create or replace function public.get_active_rider_delivery()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order_id uuid;
  v_business_id uuid;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;

  -- La entrega activa define el comercio, y el comercio define contra que se
  -- pregunta la compuerta. Se busca primero el pedido asignado y despues se
  -- exige el rol: al reves habria que adivinar el comercio.
  select o.id, o.business_id
    into v_order_id, v_business_id
    from public.orders o
   where o.assigned_rider_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
   order by o.updated_at desc, o.id desc
   limit 1;

  if v_order_id is null then return null; end if;

  perform public.rider_require_active_membership(v_business_id);

  return public.rider_active_delivery_payload(v_order_id);
end;
$$;

-- PostgREST cachea el esquema; sin esto sigue sirviendo la foto vieja.
select pg_notify('pgrst', 'reload schema');
