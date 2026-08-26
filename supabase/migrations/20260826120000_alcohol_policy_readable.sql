-- La política de alcohol se podía ESCRIBIR y no se podía LEER.
--
-- EL DEFECTO, MEDIDO CONTRA PRODUCCIÓN EL 2026-08-26
-- --------------------------------------------------
-- `20260725120000_business_contact_authority.sql` reemplazó los grants de tabla
-- por grants de columna. En el de UPDATE entraron las cinco columnas de la
-- política de alcohol; en el de SELECT no entró ninguna. Y
-- `get_business_operations_config` —la única lectura de configuración que tiene
-- el Panel— devuelve `alcohol_hours_enforced` pero ninguna de las cinco.
--
-- El resultado es una asimetría que no quiso nadie: el dueño de un comercio
-- puede fijar la edad mínima, la ventana horaria y el huso de su venta de
-- alcohol, y después no tiene ninguna superficie donde ver qué fijó. Un
-- `select` desde la sesión del Panel responde
--
--     42501 · permission denied for table businesses
--
-- Y no es sólo incomodidad. `create_order` valida la política COMPLETA al
-- momento de la venta y rechaza el pedido si falta cualquiera de los cinco
-- campos; sin lectura, la única forma de enterarse de que la configuración está
-- incompleta es que un cliente real no pueda comprar.
--
-- QUÉ CAMBIA ACÁ, Y QUÉ NO
-- ------------------------
-- Cambia UNA cosa: `get_business_operations_config` agrega los cinco campos a
-- lo que ya devolvía. Nada más.
--
--   · NO se toca ningún grant. La columna sigue sin ser legible por `select`
--     directo: la lectura pasa por la función, que ya exige
--     `has_business_role(owner|admin|staff)` y es `security definer`. Ampliar el
--     grant de tabla abriría las cinco columnas a cualquier consulta
--     autenticada; esto las abre exactamente a quien ya puede ver el resto de
--     la configuración del comercio.
--   · NO se toca `alcohol_sales_enabled` como valor. Esta migración no habilita
--     ni deshabilita la venta de alcohol: la hace VISIBLE.
--   · NO se expone nada al cliente anónimo. La tienda sigue sin poder leer la
--     ventana horaria, y por eso hoy sólo puede explicar el rechazo DESPUÉS de
--     intentarlo. Cerrar eso pide una decisión aparte —qué parte de la política
--     de un comercio es pública— y no se toma de costado en una migración de
--     lectura interna.
--
-- REVERSIÓN
-- ---------
-- Volver a crear la función sin las cinco claves. No hay dato que restaurar:
-- esta migración no escribe ninguna fila.

create or replace function public.get_business_operations_config(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_business public.businesses%rowtype;
  v_can_manage boolean := public.can_manage_commercial_settings(p_business_id);
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'sin autorizacion para leer la configuracion' using errcode = '42501';
  end if;
  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'business_id', p_business_id,
    'can_manage', v_can_manage,
    'operating_timezone', v_business.operating_timezone,
    'hours_enforced', v_business.hours_enforced,
    'delivery_zone_enforced', v_business.delivery_zone_enforced,
    'alcohol_hours_enforced', v_business.alcohol_hours_enforced,
    -- Las cinco que `create_order` exige juntas. Se devuelven juntas, y con el
    -- mismo nombre que tienen en la tabla, para que quien lea esto pueda
    -- comparar contra el mensaje de error sin traducir nada.
    'alcohol_sales_enabled', v_business.alcohol_sales_enabled,
    'alcohol_minimum_age', v_business.alcohol_minimum_age,
    'alcohol_sales_start', to_char(v_business.alcohol_sales_start, 'HH24:MI'),
    'alcohol_sales_end', to_char(v_business.alcohol_sales_end, 'HH24:MI'),
    'alcohol_timezone', v_business.alcohol_timezone,
    -- Y la conclusión ya sacada, que es lo que de verdad se quiere saber: si un
    -- pedido con alcohol puede entrar AHORA. Calcularla acá evita que cada
    -- superficie la reimplemente y se equivoque distinto.
    'alcohol_policy_complete', (
      v_business.alcohol_minimum_age is not null
      and v_business.alcohol_sales_start is not null
      and v_business.alcohol_sales_end is not null
      and v_business.alcohol_timezone is not null
      and btrim(coalesce(v_business.alcohol_timezone, '')) <> ''
    ),
    'delivery_enabled', v_business.delivery_enabled,
    'pickup_enabled', v_business.pickup_enabled,
    'delivery_fee', v_business.delivery_fee,
    'minimum_delivery_subtotal', v_business.minimum_delivery_subtotal,
    'delivery_max_radius_meters', v_business.delivery_max_radius_meters,
    'is_open_delivery', public.business_is_open(p_business_id, 'delivery', now()),
    'is_open_pickup', public.business_is_open(p_business_id, 'pickup', now()),
    'next_open_at', public.business_next_open_at(p_business_id, 'delivery', now()),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', h.id, 'channel', h.channel, 'weekday', h.weekday,
               'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
             order by h.channel, h.weekday, h.opens_at), '[]'::jsonb)
        from public.business_service_hours h where h.business_id = p_business_id),
    'exceptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'channel', e.channel, 'on_date', e.on_date, 'is_closed', e.is_closed,
               'opens_at', to_char(e.opens_at, 'HH24:MI'), 'closes_at', to_char(e.closes_at, 'HH24:MI'),
               'note', e.note)
             order by e.on_date, e.channel), '[]'::jsonb)
        from public.business_service_exceptions e
       where e.business_id = p_business_id and e.on_date >= (now() - interval '30 days')::date),
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', z.id, 'name', z.name, 'is_active', z.is_active, 'match_kind', z.match_kind,
               'area', z.area_normalized, 'boundary_points', case when z.boundary is null then 0 else npoints(z.boundary) end,
               'delivery_fee', z.delivery_fee, 'minimum_subtotal', z.minimum_subtotal,
               'priority', z.priority, 'notes', z.notes)
             order by z.priority, z.name), '[]'::jsonb)
        from public.delivery_zones z where z.business_id = p_business_id),
    -- La auditoría la ve quien puede cambiar la configuración. Un staff sin
    -- delegación no ve quién movió los precios.
    'audit', case when v_can_manage then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'scope', a.scope, 'action', a.action,
               'actor_kind', a.actor_kind, 'actor_id', a.actor_id,
               'before', a.before, 'after', a.after, 'created_at', a.created_at)
             order by a.created_at desc), '[]'::jsonb)
        from (select * from public.business_config_audit
               where business_id = p_business_id
               order by created_at desc limit 50) a
    ) else '[]'::jsonb end);
end;
$$;

comment on function public.get_business_operations_config(uuid) is
  'Configuracion operativa que lee el Panel (owner/admin/staff). Desde 2026-08-26 incluye las cinco columnas de la politica de alcohol y la conclusion alcohol_policy_complete: antes eran escribibles y no legibles, asi que un comercio podia fijar su politica y no tenia donde verla.';
