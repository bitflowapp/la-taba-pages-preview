-- ============================================================================
--  El Panel: la configuración comercial se edita por acá, y sólo por acá
-- ============================================================================
--
--  Las tablas de configuración NO tienen grant de insert/update/delete para el
--  navegador. Estas RPC son la única puerta, y cada una hace las tres cosas en
--  la misma transacción: AUTORIZA, VALIDA y AUDITA. Si algo falla, no queda un
--  cambio a medias ni una fila de auditoría sin su cambio.
--
--  QUIÉN PUEDE
--  -----------
--  `can_manage_commercial_settings` = owner, admin, o un miembro activo con la
--  delegación explícita encendida. Un staff común recibe 42501. La delegación
--  la enciende un owner o un admin, y también queda auditada.
--
--  LAS DOS NEGATIVAS QUE EVITAN UN APAGÓN
--  --------------------------------------
--  · No se puede exigir horarios sin una sola franja cargada: sería declarar el
--    comercio cerrado para siempre con un clic.
--  · No se puede exigir cobertura sin una sola zona activa: sería cancelar todos
--    los envíos con un clic.
--  Las dos se contestan con un mensaje que dice qué falta. Cerrar el comercio a
--  propósito ya tiene su camino: `status` y `ordering_enabled`.
--
--  ESTE ARCHIVO NO CARGA UN SOLO DATO COMERCIAL.
-- ============================================================================

-- ── Horarios de un canal, reemplazados en una transacción ────────────────────
create or replace function public.set_business_service_hours(
  p_business_id uuid,
  p_channel text,
  p_hours jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_before jsonb;
  v_after jsonb;
  v_count integer;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar horarios' using errcode = '42501';
  end if;
  if v_channel not in ('delivery', 'pickup', 'alcohol') then
    raise exception 'canal invalido' using errcode = '22023';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'horarios debe ser un arreglo' using errcode = '22023';
  end if;
  if jsonb_array_length(p_hours) > 28 then
    raise exception 'demasiadas franjas' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_hours) as e(value)
     where jsonb_typeof(e.value) <> 'object'
        or exists (select 1 from jsonb_object_keys(e.value) as k(key)
                    where k.key not in ('weekday', 'opens_at', 'closes_at'))
        or (e.value ->> 'weekday') !~ '^[0-6]$'
        or (e.value ->> 'opens_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        or (e.value ->> 'closes_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        or (e.value ->> 'opens_at')::time = (e.value ->> 'closes_at')::time
  ) then
    raise exception 'franja invalida: se espera weekday 0-6 y horas HH:MM distintas' using errcode = '22023';
  end if;

  -- Más de cuatro tramos en un día no es un turno partido, es un error de carga.
  if exists (
    select 1 from jsonb_array_elements(p_hours) as e(value)
     group by (e.value ->> 'weekday')
    having count(*) > 4
  ) then
    raise exception 'demasiadas franjas para un mismo dia' using errcode = '22023';
  end if;

  -- Solapamiento dentro del mismo día. Una franja que cruza la medianoche se
  -- parte en dos tramos sobre la recta de 0 a 1440 minutos antes de comparar; si
  -- no, «22:00–02:00» y «01:00–03:00» parecerían no tocarse.
  if exists (
    with slots as (
      select (e.value ->> 'weekday')::int as weekday,
             row_number() over () as slot_no,
             extract(epoch from (e.value ->> 'opens_at')::time)::int / 60 as opens_min,
             extract(epoch from (e.value ->> 'closes_at')::time)::int / 60 as closes_min
        from jsonb_array_elements(p_hours) as e(value)
    ), spans as (
      select weekday, slot_no, int4range(opens_min, closes_min) as span
        from slots where opens_min < closes_min
      union all
      select weekday, slot_no, int4range(opens_min, 1440) from slots where opens_min > closes_min
      union all
      select weekday, slot_no, int4range(0, closes_min) from slots where opens_min > closes_min and closes_min > 0
    )
    select 1
      from spans a
      join spans b
        on a.weekday = b.weekday and a.slot_no < b.slot_no and a.span && b.span
  ) then
    raise exception 'hay franjas superpuestas en el mismo dia' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'weekday', h.weekday, 'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
         order by h.weekday, h.opens_at), '[]'::jsonb)
    into v_before
    from public.business_service_hours h
   where h.business_id = p_business_id and h.channel = v_channel;

  delete from public.business_service_hours
   where business_id = p_business_id and channel = v_channel;

  insert into public.business_service_hours (business_id, channel, weekday, opens_at, closes_at)
  select p_business_id, v_channel,
         (e.value ->> 'weekday')::smallint,
         (e.value ->> 'opens_at')::time,
         (e.value ->> 'closes_at')::time
    from jsonb_array_elements(p_hours) as e(value);
  get diagnostics v_count = row_count;

  select coalesce(jsonb_agg(jsonb_build_object(
           'weekday', h.weekday, 'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
         order by h.weekday, h.opens_at), '[]'::jsonb)
    into v_after
    from public.business_service_hours h
   where h.business_id = p_business_id and h.channel = v_channel;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'hours', 'replaced',
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          jsonb_build_object('channel', v_channel, 'slots', v_before),
          jsonb_build_object('channel', v_channel, 'slots', v_after));

  return jsonb_build_object('ok', true, 'channel', v_channel, 'slots', v_count);
end;
$$;

comment on function public.set_business_service_hours(uuid, text, jsonb) is
  'Reemplaza los tramos horarios de un canal en una transacción. Rechaza solapamientos, más de cuatro tramos por día y horas mal formadas. Auditado.';

-- ── Excepción de un día: feriado, corte, horario especial ────────────────────
create or replace function public.set_business_service_exception(
  p_business_id uuid,
  p_channel text,
  p_on_date date,
  p_is_closed boolean,
  p_opens_at time default null,
  p_closes_at time default null,
  p_note text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_before jsonb;
  v_row public.business_service_exceptions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar excepciones' using errcode = '42501';
  end if;
  if v_channel not in ('delivery', 'pickup', 'alcohol', 'all') then
    raise exception 'canal invalido' using errcode = '22023';
  end if;
  if p_on_date is null then
    raise exception 'fecha requerida' using errcode = '22023';
  end if;
  if coalesce(p_is_closed, true) then
    p_opens_at := null; p_closes_at := null;
  elsif p_opens_at is null or p_closes_at is null or p_opens_at = p_closes_at then
    raise exception 'una excepcion abierta necesita apertura y cierre distintos' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 200 then
    raise exception 'nota demasiado larga' using errcode = '22023';
  end if;

  select to_jsonb(e) into v_before
    from public.business_service_exceptions e
   where e.business_id = p_business_id and e.channel = v_channel and e.on_date = p_on_date;

  insert into public.business_service_exceptions (business_id, channel, on_date, is_closed, opens_at, closes_at, note)
  values (p_business_id, v_channel, p_on_date, coalesce(p_is_closed, true), p_opens_at, p_closes_at, v_note)
  on conflict (business_id, channel, on_date) do update
    set is_closed = excluded.is_closed,
        opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        note = excluded.note,
        updated_at = clock_timestamp()
  returning * into v_row;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'exception', case when v_before is null then 'created' else 'updated' end,
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          v_before, to_jsonb(v_row));

  return jsonb_build_object('ok', true, 'exception_id', v_row.id);
end;
$$;

create or replace function public.delete_business_service_exception(
  p_business_id uuid,
  p_exception_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.business_service_exceptions%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar excepciones' using errcode = '42501';
  end if;
  delete from public.business_service_exceptions
   where id = p_exception_id and business_id = p_business_id
  returning * into v_row;
  if not found then
    raise exception 'excepcion inexistente' using errcode = 'P0002';
  end if;
  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'exception', 'deleted',
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          to_jsonb(v_row), null);
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Alta y edición de una zona ───────────────────────────────────────────────
create or replace function public.upsert_delivery_zone(
  p_business_id uuid,
  p_zone jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
  v_name text;
  v_match_kind text;
  v_area text;
  v_boundary polygon;
  v_boundary_text text;
  v_points integer;
  v_fee numeric(12, 2);
  v_minimum numeric(12, 2);
  v_priority integer;
  v_notes text;
  v_active boolean;
  v_before jsonb;
  v_row public.delivery_zones%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar zonas' using errcode = '42501';
  end if;
  if p_zone is null or jsonb_typeof(p_zone) <> 'object' then
    raise exception 'zona invalida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_zone) as k(key)
     where k.key not in ('id', 'name', 'match_kind', 'area', 'boundary',
                         'delivery_fee', 'minimum_subtotal', 'priority', 'notes', 'is_active')
  ) then
    raise exception 'campo de zona no permitido' using errcode = '22023';
  end if;

  v_id := nullif(p_zone ->> 'id', '')::uuid;
  v_name := nullif(regexp_replace(btrim(coalesce(p_zone ->> 'name', '')), '[[:space:]]+', ' ', 'g'), '');
  v_match_kind := lower(btrim(coalesce(p_zone ->> 'match_kind', '')));
  v_notes := nullif(btrim(coalesce(p_zone ->> 'notes', '')), '');
  v_active := coalesce((p_zone ->> 'is_active')::boolean, true);
  v_priority := coalesce(nullif(p_zone ->> 'priority', '')::integer, 100);

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'nombre de zona invalido' using errcode = '22023';
  end if;
  if v_match_kind not in ('declared_area', 'polygon') then
    raise exception 'tipo de zona invalido: solo declared_area o polygon' using errcode = '22023';
  end if;
  if v_priority < 0 or v_priority > 10000 then
    raise exception 'prioridad fuera de rango' using errcode = '22023';
  end if;

  if nullif(p_zone ->> 'delivery_fee', '') is not null then
    if (p_zone ->> 'delivery_fee') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'costo de envio invalido' using errcode = '22023';
    end if;
    v_fee := (p_zone ->> 'delivery_fee')::numeric(12, 2);
  end if;
  if nullif(p_zone ->> 'minimum_subtotal', '') is not null then
    if (p_zone ->> 'minimum_subtotal') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'minimo invalido' using errcode = '22023';
    end if;
    v_minimum := (p_zone ->> 'minimum_subtotal')::numeric(12, 2);
  end if;

  if v_match_kind = 'declared_area' then
    v_area := public.normalize_zone_name(coalesce(nullif(p_zone ->> 'area', ''), v_name));
    if v_area is null then
      raise exception 'el barrio de la zona no puede quedar vacio' using errcode = '22023';
    end if;
    if p_zone ? 'boundary' and jsonb_typeof(p_zone -> 'boundary') <> 'null' then
      raise exception 'una zona por barrio no lleva borde' using errcode = '22023';
    end if;
  else
    -- `jsonb_typeof` de una clave ausente devuelve NULL, y `NULL <> 'array'` no
    -- es verdadero: sin el coalesce, una zona sin borde se colaba hasta el
    -- conteo de vértices y salía con el mensaje equivocado.
    if coalesce(jsonb_typeof(p_zone -> 'boundary'), 'null') <> 'array' then
      raise exception 'una zona por poligono necesita un borde' using errcode = '22023';
    end if;
    select count(*)::integer into v_points from jsonb_array_elements(p_zone -> 'boundary');
    if v_points < 3 or v_points > 200 then
      raise exception 'el borde necesita entre 3 y 200 vertices' using errcode = '22023';
    end if;
    -- Cada vértice es [lng, lat] y se valida antes de armar el polígono. El
    -- texto se construye a partir de números ya casteados: no hay forma de que
    -- entre otra cosa.
    if exists (
      select 1 from jsonb_array_elements(p_zone -> 'boundary') as v(value)
       where jsonb_typeof(v.value) <> 'array'
          or jsonb_array_length(v.value) <> 2
          or jsonb_typeof(v.value -> 0) <> 'number'
          or jsonb_typeof(v.value -> 1) <> 'number'
          or (v.value ->> 0)::double precision not between -180 and 180
          or (v.value ->> 1)::double precision not between -90 and 90
    ) then
      raise exception 'vertice invalido: se espera [lng, lat] dentro de rango' using errcode = '22023';
    end if;
    select '(' || string_agg(format('(%s,%s)', (v.value ->> 0)::double precision, (v.value ->> 1)::double precision), ',' order by v.ord) || ')'
      into v_boundary_text
      from jsonb_array_elements(p_zone -> 'boundary') with ordinality as v(value, ord);
    v_boundary := v_boundary_text::polygon;
  end if;

  if v_id is not null then
    select to_jsonb(z) into v_before from public.delivery_zones z
     where z.id = v_id and z.business_id = p_business_id;
    if v_before is null then
      raise exception 'zona inexistente' using errcode = 'P0002';
    end if;
    update public.delivery_zones
       set name = v_name, is_active = v_active, match_kind = v_match_kind,
           area_normalized = v_area, boundary = v_boundary,
           delivery_fee = v_fee, minimum_subtotal = v_minimum,
           priority = v_priority, notes = v_notes, updated_at = clock_timestamp()
     where id = v_id and business_id = p_business_id
    returning * into v_row;
  else
    insert into public.delivery_zones (
      business_id, name, is_active, match_kind, area_normalized, boundary,
      delivery_fee, minimum_subtotal, priority, notes
    ) values (
      p_business_id, v_name, v_active, v_match_kind, v_area, v_boundary,
      v_fee, v_minimum, v_priority, v_notes
    ) returning * into v_row;
  end if;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'zone', case when v_before is null then 'created' else 'updated' end,
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          v_before, to_jsonb(v_row));

  return jsonb_build_object('ok', true, 'zone_id', v_row.id, 'zone_name', v_row.name);
end;
$$;

comment on function public.upsert_delivery_zone(uuid, jsonb) is
  'Alta o edición de una zona de la lista blanca. Sólo dos formas de cobertura: barrio declarado o polígono. Auditado con el estado completo antes y después.';

-- ── Apagar o encender una zona sin borrar su historia ────────────────────────
create or replace function public.set_delivery_zone_active(
  p_business_id uuid,
  p_zone_id uuid,
  p_active boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_before jsonb;
  v_row public.delivery_zones%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar zonas' using errcode = '42501';
  end if;
  select to_jsonb(z) into v_before from public.delivery_zones z
   where z.id = p_zone_id and z.business_id = p_business_id;
  if v_before is null then
    raise exception 'zona inexistente' using errcode = 'P0002';
  end if;
  update public.delivery_zones
     set is_active = coalesce(p_active, false), updated_at = clock_timestamp()
   where id = p_zone_id and business_id = p_business_id
  returning * into v_row;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'zone', case when v_row.is_active then 'enabled' else 'disabled' end,
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          v_before, to_jsonb(v_row));

  return jsonb_build_object('ok', true, 'zone_id', v_row.id, 'is_active', v_row.is_active);
end;
$$;

create or replace function public.delete_delivery_zone(
  p_business_id uuid,
  p_zone_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.delivery_zones%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar zonas' using errcode = '42501';
  end if;
  delete from public.delivery_zones
   where id = p_zone_id and business_id = p_business_id
  returning * into v_row;
  if not found then
    raise exception 'zona inexistente' using errcode = 'P0002';
  end if;
  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'zone', 'deleted',
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          to_jsonb(v_row), null);
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Envío y mínimo del negocio (los valores por defecto de las zonas) ────────
create or replace function public.set_delivery_pricing(
  p_business_id uuid,
  p_delivery_fee numeric default null,
  p_minimum_subtotal numeric default null,
  p_max_radius_meters integer default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.businesses%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar precios de envio' using errcode = '42501';
  end if;
  if p_delivery_fee is not null and p_delivery_fee < 0 then
    raise exception 'costo de envio invalido' using errcode = '22023';
  end if;
  if p_minimum_subtotal is not null and p_minimum_subtotal < 0 then
    raise exception 'minimo invalido' using errcode = '22023';
  end if;
  if p_max_radius_meters is not null then
    if p_max_radius_meters <= 0 then
      raise exception 'tope de distancia invalido' using errcode = '22023';
    end if;
    -- El tope se mide desde el punto del local. Encenderlo contra un punto que
    -- nadie confirmó pararía pedidos legítimos por un pin que puede estar a
    -- cientos de metros. Se exige la verificación humana ANTES.
    if not exists (
      select 1 from private.rider_map_business_locations l
       where l.business_id = p_business_id and l.human_verified
         and l.latitude is not null and l.longitude is not null
    ) then
      raise exception 'el tope de distancia necesita el punto del local verificado por una persona'
        using errcode = '55000';
    end if;
  end if;

  update public.businesses
     set delivery_fee = p_delivery_fee,
         minimum_delivery_subtotal = p_minimum_subtotal,
         delivery_max_radius_meters = p_max_radius_meters,
         updated_at = now()
   where id = p_business_id
  returning * into v_row;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- La auditoría la escribe el trigger de `businesses`, que atrapa este cambio
  -- y también cualquier UPDATE suelto que no pase por acá.
  return jsonb_build_object(
    'ok', true,
    'delivery_fee', v_row.delivery_fee,
    'minimum_delivery_subtotal', v_row.minimum_delivery_subtotal,
    'delivery_max_radius_meters', v_row.delivery_max_radius_meters);
end;
$$;

-- ── Las banderas: acá empieza a exigir ───────────────────────────────────────
create or replace function public.set_service_enforcement(
  p_business_id uuid,
  p_hours_enforced boolean,
  p_delivery_zone_enforced boolean,
  p_alcohol_hours_enforced boolean default null,
  p_timezone text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.businesses%rowtype;
  v_timezone text;
  v_alcohol boolean;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para cambiar la exigencia' using errcode = '42501';
  end if;
  select * into v_row from public.businesses where id = p_business_id;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  v_timezone := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), v_row.operating_timezone);
  v_alcohol := coalesce(p_alcohol_hours_enforced, v_row.alcohol_hours_enforced);

  if (coalesce(p_hours_enforced, false) or v_alcohol) then
    if v_timezone is null then
      raise exception 'para exigir horarios hace falta declarar el huso horario' using errcode = '22023';
    end if;
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
      raise exception 'huso horario desconocido' using errcode = '22023';
    end if;
  end if;

  -- Encender la exigencia sin una sola franja cargada declara el comercio
  -- cerrado para siempre con un clic. Se contesta qué falta.
  if coalesce(p_hours_enforced, false) and not v_row.hours_enforced then
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
  if coalesce(p_delivery_zone_enforced, false) and not v_row.delivery_zone_enforced then
    if not exists (
      select 1 from public.delivery_zones z
       where z.business_id = p_business_id and z.is_active
    ) then
      raise exception 'no hay zonas activas: exigir cobertura cancelaria todos los envios'
        using errcode = '55000';
    end if;
  end if;

  update public.businesses
     set hours_enforced = coalesce(p_hours_enforced, false),
         delivery_zone_enforced = coalesce(p_delivery_zone_enforced, false),
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
$$;

comment on function public.set_service_enforcement(uuid, boolean, boolean, boolean, text) is
  'Enciende o apaga la exigencia de horarios y de cobertura. Se niega a encender una exigencia que no se puede cumplir con los datos cargados.';

-- ── Delegación explícita a un staff ──────────────────────────────────────────
create or replace function public.set_commercial_settings_delegation(
  p_business_id uuid,
  p_user_id uuid,
  p_can_manage boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.business_members%rowtype;
begin
  -- La delegación no se delega: sólo owner o admin. Un staff con el permiso
  -- encendido puede editar la configuración, pero no repartirlo.
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'solo owner o admin delegan la configuracion comercial' using errcode = '42501';
  end if;
  -- Tiene que ser miembro del comercio, y eso se pregunta sin escribir su fila:
  -- `business_members` la administra la capa de identidad.
  select * into v_row
    from public.business_members
   where business_id = p_business_id and user_id = p_user_id and is_active;
  if not found then
    raise exception 'miembro inexistente' using errcode = 'P0002';
  end if;
  if v_row.role not in ('staff', 'admin', 'owner') then
    raise exception 'ese rol no administra configuracion comercial' using errcode = '22023';
  end if;

  if coalesce(p_can_manage, false) then
    insert into public.business_commercial_managers (business_id, user_id, granted_by)
    values (p_business_id, p_user_id, auth.uid())
    on conflict (business_id, user_id) do update
      set granted_by = excluded.granted_by, granted_at = clock_timestamp();
  else
    delete from public.business_commercial_managers
     where business_id = p_business_id and user_id = p_user_id;
  end if;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'permission',
          case when coalesce(p_can_manage, false) then 'enabled' else 'disabled' end,
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          jsonb_build_object('user_id', p_user_id, 'role', v_row.role,
            'can_manage_commercial_settings', not coalesce(p_can_manage, false)),
          jsonb_build_object('user_id', p_user_id, 'role', v_row.role,
            'can_manage_commercial_settings', coalesce(p_can_manage, false)));

  return jsonb_build_object('ok', true, 'user_id', p_user_id,
                            'can_manage_commercial_settings', coalesce(p_can_manage, false));
end;
$$;

-- ── Lo que el Panel lee ──────────────────────────────────────────────────────
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
  'Todo lo que el Panel necesita para mostrar y editar horarios, zonas, tarifa, mínimo y auditoría. La auditoría sólo llega a quien puede cambiar la configuración.';

-- ── Permisos ────────────────────────────────────────────────────────────────
revoke all on function public.set_business_service_hours(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.set_business_service_exception(uuid, text, date, boolean, time, time, text) from public, anon, authenticated;
revoke all on function public.delete_business_service_exception(uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_delivery_zone(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_delivery_zone_active(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.delete_delivery_zone(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_delivery_pricing(uuid, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function public.set_service_enforcement(uuid, boolean, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.set_commercial_settings_delegation(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_business_operations_config(uuid) from public, anon, authenticated;

grant execute on function public.set_business_service_hours(uuid, text, jsonb) to authenticated;
grant execute on function public.set_business_service_exception(uuid, text, date, boolean, time, time, text) to authenticated;
grant execute on function public.delete_business_service_exception(uuid, uuid) to authenticated;
grant execute on function public.upsert_delivery_zone(uuid, jsonb) to authenticated;
grant execute on function public.set_delivery_zone_active(uuid, uuid, boolean) to authenticated;
grant execute on function public.delete_delivery_zone(uuid, uuid) to authenticated;
grant execute on function public.set_delivery_pricing(uuid, numeric, numeric, integer) to authenticated;
grant execute on function public.set_service_enforcement(uuid, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.set_commercial_settings_delegation(uuid, uuid, boolean) to authenticated;
grant execute on function public.get_business_operations_config(uuid) to authenticated;
