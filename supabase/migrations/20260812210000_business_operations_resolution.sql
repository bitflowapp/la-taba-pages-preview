-- ============================================================================
--  Las funciones que deciden: ¿está abierto? ¿llegamos ahí? ¿con qué envío?
-- ============================================================================
--
--  Son la ÚNICA fuente de verdad. El navegador no calcula cobertura ni tarifa:
--  pregunta y recibe una respuesta ya decidida. El checkout llama a las mismas
--  funciones, así que lo que se muestra y lo que se cobra no pueden divergir.
--
--  DOS CAPAS, A PROPÓSITO
--  ----------------------
--  · `business_is_open` y `resolve_delivery_zone` son las internas. Contestan
--    con detalle —incluido POR QUÉ no— y NO están al alcance del navegador.
--  · `commerce_availability` es la del cliente. Contesta lo que hace falta para
--    comprar y nada más: abierto o cerrado, si llegamos, cuánto sale el envío y
--    cuál es el mínimo. Todos los motivos de no-cobertura colapsan en uno solo,
--    con la misma frase. Un atacante no puede usar la respuesta para dibujar el
--    mapa de la cobertura ni para descubrir que existe un tope de distancia.
--
--  EL CRUCE DE MEDIANOCHE, BIEN HECHO
--  ----------------------------------
--  Una franja 22:00–02:00 del lunes termina el MARTES a las 02:00. Preguntar
--  «¿la franja de hoy contiene esta hora?» daría abierto el martes a la 01:00
--  aunque el martes no tenga franja propia —y daría abierto el martes a la 01:00
--  por la franja del martes, que en realidad todavía no empezó—. Por eso el día
--  de hoy aporta sólo su COLA (hora >= apertura) cuando cruza, y el arrastre de
--  la 01:00 lo aporta el día ANTERIOR. Los dos casos tienen ensayo.
-- ============================================================================

-- ── Las franjas vigentes para una fecha local ────────────────────────────────
--
-- Devuelve las ventanas que rigen ESE día para ESE canal. Una excepción manda
-- sobre el horario recurrente; un cierre explícito devuelve cero filas.
create or replace function public.business_day_windows(
  p_business_id uuid,
  p_channel text,
  p_date date
) returns table (opens_at time, closes_at time)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with exception_row as (
    select e.*
      from public.business_service_exceptions e
     where e.business_id = p_business_id
       and e.on_date = p_date
       and e.channel in (p_channel, 'all')
     order by case when e.channel = p_channel then 0 else 1 end
     limit 1
  )
  select x.opens_at, x.closes_at
    from exception_row x
   where not x.is_closed
  union all
  select h.opens_at, h.closes_at
    from public.business_service_hours h
   where h.business_id = p_business_id
     and h.channel = p_channel
     and h.weekday = extract(dow from p_date)::smallint
     and not exists (select 1 from exception_row);
$$;

comment on function public.business_day_windows(uuid, text, date) is
  'Franjas vigentes para una fecha local. La excepción del día reemplaza al horario recurrente; un cierre explícito devuelve cero filas.';

-- ── ¿Está abierto este canal en este instante? ───────────────────────────────
create or replace function public.business_is_open(
  p_business_id uuid,
  p_channel text,
  p_at timestamptz default now()
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_business public.businesses%rowtype;
  v_enforced boolean;
  v_local timestamp;
  v_time time;
  v_date date;
begin
  if p_channel is null or p_channel not in ('delivery', 'pickup', 'alcohol') then
    return false;
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  if not found then return false; end if;

  v_enforced := case
    when p_channel = 'alcohol' then coalesce(v_business.alcohol_hours_enforced, false)
    else coalesce(v_business.hours_enforced, false)
  end;

  -- Mientras nadie lo encienda, esta función no cambia nada: contesta lo mismo
  -- que contestaba el sistema antes de existir.
  if not v_enforced then return true; end if;

  -- Exigir un horario sin saber en qué huso leerlo no se puede evaluar. Cerrado.
  if v_business.operating_timezone is null or btrim(v_business.operating_timezone) = '' then
    return false;
  end if;

  begin
    v_local := p_at at time zone v_business.operating_timezone;
  exception when others then
    return false;   -- huso inválido: no se adivina, se cierra
  end;
  v_time := v_local::time;
  v_date := v_local::date;

  -- Un cierre explícito cierra TODA la fecha local, incluido el arrastre del día
  -- anterior. Es la lectura conservadora y es la que una persona espera de un
  -- feriado.
  if exists (
    select 1 from public.business_service_exceptions e
     where e.business_id = p_business_id
       and e.on_date = v_date
       and e.channel in (p_channel, 'all')
       and e.is_closed
  ) then
    return false;
  end if;

  return
    -- Hoy: la franja normal completa, o sólo la COLA de la que cruza.
    exists (
      select 1 from public.business_day_windows(p_business_id, p_channel, v_date) w
       where (w.opens_at < w.closes_at and v_time >= w.opens_at and v_time < w.closes_at)
          or (w.opens_at > w.closes_at and v_time >= w.opens_at)
    )
    -- Ayer: sólo el arrastre de la que cruzó la medianoche.
    or exists (
      select 1 from public.business_day_windows(p_business_id, p_channel, v_date - 1) w
       where w.opens_at > w.closes_at and v_time < w.closes_at
    );
end;
$$;

comment on function public.business_is_open(uuid, text, timestamptz) is
  'Fuente única de verdad del horario. Admite turno partido y cruce de medianoche. Con la exigencia apagada devuelve true; encendida sin huso configurado, false.';

-- ── ¿Cuándo vuelve a abrir? ──────────────────────────────────────────────────
create or replace function public.business_next_open_at(
  p_business_id uuid,
  p_channel text,
  p_at timestamptz default now()
) returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_business public.businesses%rowtype;
  v_local timestamp;
  v_date date;
  v_day integer;
  v_window record;
  v_candidate timestamptz;
  v_best timestamptz;
begin
  select * into v_business from public.businesses where id = p_business_id;
  if not found then return null; end if;
  if not coalesce(
       case when p_channel = 'alcohol' then v_business.alcohol_hours_enforced else v_business.hours_enforced end,
       false) then
    return null;   -- sin exigencia no hay «próxima apertura»: siempre está abierto
  end if;
  if v_business.operating_timezone is null or btrim(v_business.operating_timezone) = '' then
    return null;
  end if;

  begin
    v_local := p_at at time zone v_business.operating_timezone;
  exception when others then
    return null;
  end;
  v_date := v_local::date;

  -- Catorce días alcanzan para cualquier horario semanal y para un feriado
  -- largo. Si en catorce días no abre, la respuesta honesta es «no sé».
  for v_day in 0..14 loop
    if not exists (
      select 1 from public.business_service_exceptions e
       where e.business_id = p_business_id
         and e.on_date = v_date + v_day
         and e.channel in (p_channel, 'all')
         and e.is_closed
    ) then
      for v_window in
        select * from public.business_day_windows(p_business_id, p_channel, v_date + v_day)
      loop
        v_candidate := ((v_date + v_day)::timestamp + v_window.opens_at)
                       at time zone v_business.operating_timezone;
        if v_candidate > p_at and (v_best is null or v_candidate < v_best) then
          v_best := v_candidate;
        end if;
      end loop;
    end if;
    exit when v_best is not null and v_day >= 1;
  end loop;
  return v_best;
end;
$$;

comment on function public.business_next_open_at(uuid, text, timestamptz) is
  'Próxima apertura del canal dentro de los siguientes catorce días, o NULL si no hay exigencia de horario o no se puede saber.';

-- ── ¿Llegamos ahí? ¿Con qué envío y con qué mínimo? ──────────────────────────
--
-- Devuelve SIEMPRE un objeto, nunca NULL: «no llegamos» es una respuesta, no la
-- ausencia de una. El detalle del motivo es para el backend y para el Panel; al
-- navegador llega colapsado por `commerce_availability`.
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
as $$
declare
  v_business public.businesses%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_area text := public.normalize_zone_name(p_area);
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
  if not coalesce(v_business.delivery_enabled, false) then
    return jsonb_build_object('eligible', false, 'enforced', coalesce(v_business.delivery_zone_enforced, false),
                              'detail', 'delivery_disabled');
  end if;

  -- Exigencia apagada: se comporta exactamente como antes de que estas tablas
  -- existieran, con los valores del negocio. Aplicar la migración no mueve nada.
  if not coalesce(v_business.delivery_zone_enforced, false) then
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

  -- ── TOPE DURO: SÓLO NIEGA ──────────────────────────────────────────────────
  -- Nunca concede. Un punto más lejos que el tope se descarta antes de mirar la
  -- lista blanca; un punto adentro del tope no gana nada por estarlo.
  --
  -- El ancla es el punto del local, que vive en `private.rider_map_business_locations`
  -- y HOY NO ESTÁ VERIFICADO POR UNA PERSONA. Por eso el tope sólo se puede
  -- encender contra un punto `human_verified` —lo exige la RPC del Panel— y acá,
  -- si el punto dejó de estarlo, se NIEGA en vez de ignorar el guardián que
  -- alguien pidió a propósito.
  if v_business.delivery_max_radius_meters is not null then
    select l.latitude::double precision, l.longitude::double precision
      into v_origin_lat, v_origin_lng
      from private.rider_map_business_locations l
     where l.business_id = p_business_id
       and l.human_verified
       and l.latitude is not null
       and l.longitude is not null;
    if p_lat is null or p_lng is null or v_origin_lat is null then
      return jsonb_build_object('eligible', false, 'enforced', true, 'detail', 'max_radius_needs_point');
    end if;
    v_distance := public.haversine_meters(p_lat, p_lng, v_origin_lat, v_origin_lng);
    if v_distance is null or v_distance > v_business.delivery_max_radius_meters then
      return jsonb_build_object('eligible', false, 'enforced', true, 'detail', 'beyond_max_radius');
    end if;
  end if;

  -- ── LA LISTA BLANCA ────────────────────────────────────────────────────────
  -- El polígono se evalúa antes que el barrio declarado: una frontera cargada
  -- pesa más que lo que alguien eligió de una lista. Dentro de cada forma manda
  -- `priority`.
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
         and z.area_normalized = v_area)
     )
   order by case when z.match_kind = 'polygon' then 0 else 1 end, z.priority, z.name
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
$$;

comment on function public.resolve_delivery_zone(uuid, double precision, double precision, text) is
  'Cobertura, envío y mínimo, decididos por el backend. Lista blanca: polígono sobre el punto confirmado o barrio declarado. El radio sólo niega, nunca concede.';

-- ── La respuesta que ve el cliente ───────────────────────────────────────────
--
-- Todos los motivos de no-cobertura salen con la MISMA frase. La respuesta no
-- distingue «tu barrio no está en la lista» de «estás más lejos que el tope»: si
-- lo hiciera, se podría reconstruir la cobertura preguntando.
create or replace function public.commerce_availability(
  p_business_id uuid,
  p_channel text default 'delivery',
  p_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_business public.businesses%rowtype;
  v_channel text := lower(btrim(coalesce(p_channel, 'delivery')));
  v_lat double precision;
  v_lng double precision;
  v_area text;
  v_zone jsonb;
  v_open boolean;
  v_ordering_ready boolean;
  v_delivery jsonb;
  v_areas jsonb;
  v_hours jsonb;
begin
  if v_channel not in ('delivery', 'pickup') then
    raise exception 'canal invalido' using errcode = '22023';
  end if;
  if p_context is not null and jsonb_typeof(p_context) <> 'object' then
    raise exception 'contexto invalido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_context, '{}'::jsonb)) as k(key)
     where k.key not in ('latitude', 'longitude', 'neighborhood')
  ) then
    raise exception 'campo de contexto no permitido' using errcode = '22023';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  if not found or not coalesce(v_business.is_active, false) then
    return jsonb_build_object(
      'business_id', p_business_id, 'channel', v_channel,
      'ordering_ready', false, 'is_open', false, 'next_open_at', null,
      'hours', '[]'::jsonb, 'areas', '[]'::jsonb,
      'delivery', jsonb_build_object('eligible', false, 'reason', 'unavailable',
        'message', 'Por el momento este comercio no está recibiendo pedidos.'));
  end if;

  if nullif(p_context ->> 'latitude', '') is not null
    and (p_context ->> 'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
    and nullif(p_context ->> 'longitude', '') is not null
    and (p_context ->> 'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    v_lat := (p_context ->> 'latitude')::double precision;
    v_lng := (p_context ->> 'longitude')::double precision;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      v_lat := null; v_lng := null;
    end if;
  end if;
  v_area := nullif(btrim(coalesce(p_context ->> 'neighborhood', '')), '');
  if char_length(coalesce(v_area, '')) > 100 then
    raise exception 'barrio invalido' using errcode = '22023';
  end if;

  v_ordering_ready := coalesce(v_business.status, '') = 'open'
    and coalesce(v_business.ordering_enabled, false)
    and coalesce(v_business.ordering_verified, false)
    and case when v_channel = 'delivery'
             then coalesce(v_business.delivery_enabled, false)
             else coalesce(v_business.pickup_enabled, false) end;

  v_open := public.business_is_open(p_business_id, v_channel, now());

  -- Los horarios publicados viajan al cliente para que la tienda los MUESTRE sin
  -- tenerlos escritos adentro. Nada de esto decide: decide `is_open`.
  select coalesce(jsonb_agg(jsonb_build_object(
           'weekday', h.weekday, 'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
         order by h.weekday, h.opens_at), '[]'::jsonb)
    into v_hours
    from public.business_service_hours h
   where h.business_id = p_business_id
     and h.channel = v_channel
     and coalesce(v_business.hours_enforced, false);

  if v_channel = 'pickup' then
    v_delivery := jsonb_build_object('eligible', false, 'reason', 'pickup',
      'message', 'Retiro en el local.');
    v_areas := '[]'::jsonb;
  else
    v_zone := public.resolve_delivery_zone(p_business_id, v_lat, v_lng, v_area);
    if coalesce((v_zone ->> 'eligible')::boolean, false) then
      v_delivery := jsonb_build_object(
        'eligible', true, 'reason', 'ok',
        'zone_name', v_zone ->> 'zone_name',
        'delivery_fee', (v_zone ->> 'delivery_fee')::numeric,
        'minimum_subtotal', nullif(v_zone ->> 'minimum_subtotal', '')::numeric,
        'message', null);
    elsif (v_zone ->> 'detail') = 'delivery_disabled' then
      v_delivery := jsonb_build_object('eligible', false, 'reason', 'unavailable',
        'message', 'Por ahora no estamos haciendo envíos.');
    else
      -- Un solo motivo y una sola frase para todo lo demás. No se dice si faltó
      -- el barrio, si faltó el punto o si el punto quedó lejos.
      v_delivery := jsonb_build_object('eligible', false, 'reason', 'out_of_coverage',
        'message', 'Por el momento no realizamos entregas en esta zona.');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'name', z.name,
             'delivery_fee', coalesce(z.delivery_fee, v_business.delivery_fee),
             'minimum_subtotal', coalesce(z.minimum_subtotal, v_business.minimum_delivery_subtotal))
           order by z.priority, z.name), '[]'::jsonb)
      into v_areas
      from public.delivery_zones z
     where z.business_id = p_business_id
       and z.is_active
       and z.match_kind = 'declared_area'
       and coalesce(v_business.delivery_zone_enforced, false);
  end if;

  return jsonb_build_object(
    'business_id', p_business_id,
    'channel', v_channel,
    'ordering_ready', v_ordering_ready,
    'is_open', v_open,
    'hours_enforced', coalesce(v_business.hours_enforced, false),
    'coverage_enforced', coalesce(v_business.delivery_zone_enforced, false),
    'next_open_at', public.business_next_open_at(p_business_id, v_channel, now()),
    'hours', v_hours,
    'areas', v_areas,
    'delivery', v_delivery);
end;
$$;

comment on function public.commerce_availability(uuid, text, jsonb) is
  'Respuesta comercial para el navegador: abierto o cerrado, horarios publicados, barrios que se pueden elegir, y si llegamos con qué envío y qué mínimo. Los motivos de no-cobertura salen colapsados en uno.';

-- ── Permisos ────────────────────────────────────────────────────────────────
--
-- Las internas NO llegan al navegador. La del cliente sí, y es de sólo lectura.
revoke all on function public.business_day_windows(uuid, text, date) from public, anon, authenticated;
revoke all on function public.business_is_open(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.business_next_open_at(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_delivery_zone(uuid, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.commerce_availability(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.commerce_availability(uuid, text, jsonb) to anon, authenticated;
