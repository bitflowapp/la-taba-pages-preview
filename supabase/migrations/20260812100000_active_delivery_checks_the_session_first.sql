-- TABA2 · Capa de identidad, parte 10: la entrega activa pregunta primero.
--
-- Al medir la revocacion contra staging alojado despues de 20260812090000,
-- get_rider_queue quedo correctamente cerrado (403) pero get_active_rider_delivery
-- devolvia 200 a una sesion revocada. No era un agujero: la funcion busca el
-- pedido asignado ANTES de exigir el rol, asi que sin entrega activa devolvia
-- null y no llegaba nunca al guard. Un Rider revocado CON entrega si quedaba
-- bloqueado.
--
-- Igual se cierra, por dos motivos. Uno, que una sesion revocada aprenda
-- "no tenes entrega activa" es informacion que no le corresponde. Dos, y mas
-- importante: una RPC que a veces responde 200 y a veces 403 segun el estado
-- de los datos es una que nadie puede auditar de un vistazo. La autorizacion
-- tiene que decidirse antes que los datos, siempre.
--
-- El comercio se resuelve por la membresia del propio llamador —una lectura,
-- no una autorizacion— y la autorizacion sigue siendo la compuerta.
--
-- Aplicar despues de 20260812090000_rider_rpcs_consult_the_gate.sql.

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

  -- Solo para saber CONTRA QUE comercio preguntar. No autoriza nada: de eso se
  -- encarga la linea siguiente.
  select bm.business_id
    into v_business_id
    from public.business_members bm
   where bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true
   order by bm.created_at
   limit 1;

  if v_business_id is null then
    raise exception 'membership rider activa requerida' using errcode = '42501';
  end if;

  -- La autorizacion, antes de mirar un solo pedido.
  perform public.rider_require_active_membership(v_business_id);

  select o.id
    into v_order_id
    from public.orders o
   where o.business_id = v_business_id
     and o.assigned_rider_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
   order by o.updated_at desc, o.id desc
   limit 1;

  if v_order_id is null then return null; end if;

  return public.rider_active_delivery_payload(v_order_id);
end;
$$;

select pg_notify('pgrst', 'reload schema');
