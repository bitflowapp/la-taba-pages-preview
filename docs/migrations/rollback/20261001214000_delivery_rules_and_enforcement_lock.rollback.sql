-- REVERSIÓN de 20261001214000_delivery_rules_and_enforcement_lock.sql
--
-- Qué hace: devuelve `resolve_delivery_zone` y `set_service_enforcement` a su definición
-- anterior, capturada con pg_get_functiondef sobre las 159 migraciones previas.
--
-- Ojo con lo que vuelve a quedar abierto:
--   · un comercio VERIFICADO vuelve a poder apagar la exigencia de horarios y la de
--     cobertura desde el Panel: desde ahí toma pedidos a cualquier hora y a cualquier
--     dirección con el envío del comercio;
--   · `set_service_enforcement(b, null, true)` vuelve a apagar el horario: NULL vuelve a
--     leerse como «apagar»;
--   · el tope de distancia vuelve a ignorarse mientras la cobertura no se exija;
--   · elegir de la lista publicada una zona cuyo nombre no es su barrio vuelve a contestar
--     fuera de cobertura.
--
-- Qué NO hace: no toca una fila. Las exigencias, las zonas y los topes quedan como están.
-- No depende de las otras dos migraciones del paquete ni ellas de ésta.
--
-- El cuerpo anterior de `set_service_enforcement` está guardado en la base con fin de
-- línea CRLF (así lo dejó 20260812230000). Este archivo es LF: para restaurar el cuerpo
-- byte por byte la definición se ejecuta con los saltos convertidos. El de
-- `resolve_delivery_zone` siempre fue LF.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001214000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001214000', 0)
);

-- resolve_delivery_zone anterior. CREATE OR REPLACE conserva sus privilegios.
CREATE OR REPLACE FUNCTION public.resolve_delivery_zone(p_business_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_area text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

-- set_service_enforcement anterior, con su fin de línea original.
do $restore$
begin
  execute replace($definition$
CREATE OR REPLACE FUNCTION public.set_service_enforcement(p_business_id uuid, p_hours_enforced boolean, p_delivery_zone_enforced boolean, p_alcohol_hours_enforced boolean DEFAULT NULL::boolean, p_timezone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$
$definition$, E'\n', E'\r\n');
end
$restore$;

revoke all on function public.resolve_delivery_zone(uuid, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.set_service_enforcement(uuid, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.set_service_enforcement(uuid, boolean, boolean, boolean, text) to authenticated;

commit;
