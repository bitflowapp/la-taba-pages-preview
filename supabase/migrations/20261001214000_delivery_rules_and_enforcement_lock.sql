-- El tope de distancia vale siempre que esté cargado, la lista publicada se puede elegir, y un
-- comercio verificado no se queda sin reglas con un clic.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   1. `resolve_delivery_zone` devolvía «elegible» en la rama de cobertura NO exigida antes
--      de mirar `delivery_max_radius_meters`. Con un tope de 5000 m cargado —que sólo se
--      puede cargar contra un punto del local verificado por una persona— y la exigencia
--      de zonas apagada, un pin a 1000 km era elegible con el envío del comercio. El Panel
--      y la preparación de la apertura mostraban el tope como configurado.
--   2. La tienda publica `delivery_zones.name` (`commerce_availability.areas`) y el motor
--      comparaba sólo `area_normalized`. Una zona creada por RPC con nombre «Zona 1» y
--      barrio «Barrio Norte» aparecía en la lista, y elegirla contestaba fuera de cobertura.
--   3. `set_service_enforcement` escribía `coalesce(p_hours_enforced, false)` y
--      `coalesce(p_delivery_zone_enforced, false)`: un NULL —«no toco esto»— apagaba la
--      exigencia. `set_service_enforcement(b, null, true)` encendía la cobertura y dejaba el
--      comercio abierto a cualquier hora. La bandera de alcohol y el huso sí se conservaban.
--   4. La misma RPC no miraba `ordering_verified`. Con el comercio ya verificado por la
--      plataforma, el dueño, el encargado o un integrante con la delegación comercial
--      apagaban las dos exigencias: desde ese momento el alta aceptaba un pedido a las
--      04:00 a una dirección de otra ciudad con el envío del comercio, descontando stock.
--
-- QUÉ QUEDA
--
--   · El tope de distancia se evalúa ANTES de decidir si la cobertura se exige. Sigue sin
--     conceder nada: sólo niega. Sin punto del cliente o sin punto del local verificado,
--     niega (igual que ya hacía con la cobertura exigida).
--   · Una zona por barrio declarado coincide por su barrio normalizado O por su nombre
--     publicado normalizado. Lo que la tienda ofrece se puede elegir, y si el mismo texto
--     es el nombre de una zona y el barrio de otra gana el nombre: se cobra el renglón
--     que la persona vio en la lista.
--   · En `set_service_enforcement`, NULL significa «dejar como está» para las tres banderas.
--     La fila se lee con FOR UPDATE: dos cambios simultáneos no se pisan a ciegas.
--   · Con `ordering_verified = true` la RPC se niega a APAGAR la exigencia de horarios o la
--     de cobertura (55000, ENFORCEMENT_LOCKED). Encender, cambiar el huso o tocar la bandera
--     de alcohol sigue permitido.
--
--     Por qué negarse y no revocar la verificación en la misma transacción: las dos
--     opciones impiden un comercio verificado sin reglas, pero revocar deja la tienda sin
--     tomar pedidos por un clic de un integrante delegado, y sólo la plataforma puede
--     volver a verificar. Negarse no cambia nada y dice qué hacer. Quien de verdad quiere
--     operar sin reglas pide la revocación (`platform_revoke_business_ordering`), que es
--     de la plataforma y queda auditada.
--
--     La RPC no tiene un camino «de plataforma»: `can_manage_commercial_settings` exige
--     una sesión de persona y `service_role` no tiene EXECUTE. La plataforma escribe la
--     tabla con su clave, y ese UPDATE lo audita `audit_business_commercial_change`.
--     `authenticated` no tiene UPDATE por columna sobre `hours_enforced`,
--     `delivery_zone_enforced`, `alcohol_hours_enforced`, `operating_timezone` ni
--     `delivery_max_radius_meters`: esta RPC es la única puerta de una persona.
--
-- QUÉ NO CAMBIA
--
--   · Con la cobertura apagada y sin tope, todo sigue igual: cualquier dirección, con el
--     envío y el mínimo del comercio.
--   · El envío y el mínimo los sigue decidiendo el backend; ninguna clave nueva entra.
--   · Los privilegios de las dos funciones quedan como estaban.
--
-- LO QUE ESTO NO RESUELVE (limitación del modelo, no de esta migración)
--
--   Con zonas por barrio declarado el barrio lo elige el cliente y el pin no se cruza con
--   él: dentro del tope, quien vive en una zona cara puede declarar una barata. El tope es
--   una sola distancia para todo el comercio y no distingue zonas; sólo un polígono lo
--   hace, y no se inventan polígonos. La preparación de la apertura lo informa en
--   DELIVERY_ZONES (`customer_selects_price`) cuando hay barrios declarados de distinto precio.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001214000_delivery_rules_and_enforcement_lock.rollback.sql

-- ── 1. Cobertura, envío y mínimo ────────────────────────────────────────────────────────
create or replace function public.resolve_delivery_zone(
  p_business_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_area text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $resolve_delivery_zone$
declare
  v_business public.businesses%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_area text := public.normalize_zone_name(p_area);
  v_enforced boolean;
  v_distance double precision;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_fee numeric(12, 2);
  v_minimum numeric(12, 2);
begin
  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    return jsonb_build_object('eligible', false, 'enforced', null, 'detail', 'business_not_found');
  end if;
  v_enforced := coalesce(v_business.delivery_zone_enforced, false);
  if not coalesce(v_business.delivery_enabled, false) then
    return jsonb_build_object('eligible', false, 'enforced', v_enforced, 'detail', 'delivery_disabled');
  end if;

  -- ── TOPE DURO: SÓLO NIEGA ──────────────────────────────────────────────────
  -- Nunca concede. Un punto más lejos que el tope se descarta antes de mirar la
  -- lista blanca; un punto adentro del tope no gana nada por estarlo.
  --
  -- Va ANTES de preguntar si la cobertura se exige: quien cargó un tope pidió un
  -- límite, y apagar las zonas no lo retira. Declarar un barrio no lo esquiva.
  --
  -- El ancla es el punto del local, que vive en `private.rider_map_business_locations`.
  -- El tope sólo se puede encender contra un punto `human_verified` —lo exige la
  -- RPC del Panel— y acá, si el punto dejó de estarlo, se NIEGA en vez de ignorar
  -- el guardián que alguien pidió a propósito.
  if v_business.delivery_max_radius_meters is not null then
    select l.latitude::double precision, l.longitude::double precision
      into v_origin_lat, v_origin_lng
      from private.rider_map_business_locations l
     where l.business_id = p_business_id
       and l.human_verified
       and l.latitude is not null
       and l.longitude is not null;
    if p_lat is null or p_lng is null or v_origin_lat is null then
      return jsonb_build_object('eligible', false, 'enforced', v_enforced, 'detail', 'max_radius_needs_point');
    end if;
    v_distance := public.haversine_meters(p_lat, p_lng, v_origin_lat, v_origin_lng);
    if v_distance is null or v_distance > v_business.delivery_max_radius_meters then
      return jsonb_build_object('eligible', false, 'enforced', v_enforced, 'detail', 'beyond_max_radius');
    end if;
  end if;

  -- Exigencia de zonas apagada: se comporta exactamente como antes de que las
  -- zonas existieran, con los valores del negocio.
  if not v_enforced then
    if v_business.delivery_fee is null then
      return jsonb_build_object('eligible', false, 'enforced', false, 'detail', 'business_fee_missing');
    end if;
    return jsonb_build_object(
      'eligible', true, 'enforced', false,
      'zone_id', null, 'zone_name', null,
      'delivery_fee', v_business.delivery_fee,
      'minimum_subtotal', v_business.minimum_delivery_subtotal,
      'detail', 'not_enforced');
  end if;

  -- ── LA LISTA BLANCA ────────────────────────────────────────────────────────
  -- El polígono se evalúa antes que el barrio declarado: una frontera cargada
  -- pesa más que lo que alguien eligió de una lista. Dentro de cada forma manda
  -- `priority`.
  --
  -- El barrio declarado coincide por el barrio de la zona o por su nombre: la
  -- tienda publica el nombre, y lo que se ofrece en la lista tiene que poder
  -- elegirse aunque alguien haya cargado un barrio distinto del nombre. Si el
  -- mismo texto es el nombre de una zona y el barrio de otra, gana el nombre:
  -- es el renglón que la persona vio, con ese envío y ese mínimo.
  select * into v_zone
    from public.delivery_zones z
   where z.business_id = p_business_id
     and z.is_active
     and (
       (z.match_kind = 'polygon'
         and p_lat is not null and p_lng is not null
         and z.boundary @> point(p_lng, p_lat))
       or
       (z.match_kind = 'declared_area'
         and v_area is not null
         and (z.area_normalized = v_area or public.normalize_zone_name(z.name) = v_area))
     )
   order by case
              when z.match_kind = 'polygon' then 0
              when public.normalize_zone_name(z.name) = v_area then 1
              else 2
            end, z.priority, z.name
   limit 1;

  if not found then
    return jsonb_build_object('eligible', false, 'enforced', true, 'detail', 'out_of_zone');
  end if;

  v_fee := coalesce(v_zone.delivery_fee, v_business.delivery_fee);
  v_minimum := coalesce(v_zone.minimum_subtotal, v_business.minimum_delivery_subtotal);

  -- Una zona habilitada sin tarifa en ningún lado no es cobertura: es una fila a
  -- medio cargar. No se entrega gratis por omisión.
  if v_fee is null then
    return jsonb_build_object('eligible', false, 'enforced', true,
                              'zone_id', v_zone.id, 'zone_name', v_zone.name,
                              'detail', 'zone_fee_missing');
  end if;

  return jsonb_build_object(
    'eligible', true, 'enforced', true,
    'zone_id', v_zone.id,
    'zone_name', v_zone.name,
    'match_kind', v_zone.match_kind,
    'delivery_fee', v_fee,
    'minimum_subtotal', v_minimum,   -- NULL es una respuesta válida: sin mínimo
    'detail', 'ok');
end;
$resolve_delivery_zone$;

-- ── 2. La exigencia: NULL no apaga, y un comercio verificado no la apaga ────────────────
create or replace function public.set_service_enforcement(
  p_business_id uuid,
  p_hours_enforced boolean,
  p_delivery_zone_enforced boolean,
  p_alcohol_hours_enforced boolean default null,
  p_timezone text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $set_service_enforcement$
declare
  v_row public.businesses%rowtype;
  v_timezone text;
  v_hours boolean;
  v_zones boolean;
  v_alcohol boolean;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para cambiar la exigencia' using errcode = '42501';
  end if;
  select * into v_row from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- NULL es «no toco esto», para las tres banderas y para el huso.
  v_timezone := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), v_row.operating_timezone);
  v_hours := coalesce(p_hours_enforced, v_row.hours_enforced);
  v_zones := coalesce(p_delivery_zone_enforced, v_row.delivery_zone_enforced);
  v_alcohol := coalesce(p_alcohol_hours_enforced, v_row.alcohol_hours_enforced);

  -- Un comercio verificado no se queda sin reglas: apagar el horario lo deja tomando
  -- pedidos a cualquier hora y apagar la cobertura, a cualquier dirección. No se revoca
  -- la verificación por un clic: se contesta qué hacer.
  if v_row.ordering_verified
     and ((v_row.hours_enforced and not v_hours) or (v_row.delivery_zone_enforced and not v_zones)) then
    raise exception 'ENFORCEMENT_LOCKED'
      using errcode = '55000',
            detail = 'un comercio verificado no apaga la exigencia de horarios ni la de cobertura',
            hint = 'para dejar de vender, pausar o cerrar el negocio; para operar sin estas reglas la plataforma revoca antes la verificacion';
  end if;

  if (v_hours or v_alcohol) then
    if v_timezone is null then
      raise exception 'para exigir horarios hace falta declarar el huso horario' using errcode = '22023';
    end if;
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
      raise exception 'huso horario desconocido' using errcode = '22023';
    end if;
  end if;

  -- Encender la exigencia sin una sola franja cargada declara el comercio
  -- cerrado para siempre con un clic. Se contesta qué falta.
  if v_hours and not v_row.hours_enforced then
    if not exists (
      select 1 from public.business_service_hours h
       where h.business_id = p_business_id and h.channel in ('delivery', 'pickup')
    ) then
      raise exception 'no hay horarios cargados: exigirlos dejaria el comercio cerrado'
        using errcode = '55000';
    end if;
  end if;
  -- Lo mismo del otro lado: sin una zona activa, exigir cobertura cancela todos
  -- los envíos.
  if v_zones and not v_row.delivery_zone_enforced then
    if not exists (
      select 1 from public.delivery_zones z
       where z.business_id = p_business_id and z.is_active
    ) then
      raise exception 'no hay zonas activas: exigir cobertura cancelaria todos los envios'
        using errcode = '55000';
    end if;
  end if;

  update public.businesses
     set hours_enforced = v_hours,
         delivery_zone_enforced = v_zones,
         alcohol_hours_enforced = v_alcohol,
         operating_timezone = v_timezone,
         updated_at = now()
   where id = p_business_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'hours_enforced', v_row.hours_enforced,
    'delivery_zone_enforced', v_row.delivery_zone_enforced,
    'alcohol_hours_enforced', v_row.alcohol_hours_enforced,
    'operating_timezone', v_row.operating_timezone);
end;
$set_service_enforcement$;

-- ── 3. Privilegios: los mismos que tenían ───────────────────────────────────────────────
revoke all on function public.resolve_delivery_zone(uuid, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.set_service_enforcement(uuid, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.set_service_enforcement(uuid, boolean, boolean, boolean, text) to authenticated;
