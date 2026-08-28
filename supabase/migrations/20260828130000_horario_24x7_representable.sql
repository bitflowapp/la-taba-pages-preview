-- TABA 24/7 · «Abierto las 24 horas» se puede escribir.
--
-- ## EL DEFECTO
--
-- El modelo de horarios de la 20260812200000 admite turno partido y cruce de
-- medianoche, y no admite el caso más simple de una tienda de conveniencia: el
-- día entero.
--
-- La tabla lo prohíbe a propósito —`business_service_hours_not_empty` rechaza
-- `opens_at = closes_at`, porque «franja de cero» y «todo el día» se escribirían
-- igual y hay que poder distinguirlos— y la RPC del Panel lo remata: su regla de
-- formato es `^([01][0-9]|2[0-3]):[0-5][0-9]$`, así que la hora más alta que
-- acepta es `23:59`.
--
-- Resultado: con `hours_enforced = true` no existe ninguna combinación de filas
-- que deje el canal abierto a las 03:00. La única forma de operar 24 horas es
-- `hours_enforced = false`, que NO es lo mismo:
--
--   · apaga la exigencia para delivery Y pickup a la vez, así que deja de poder
--     representarse «tomo pedidos siempre, pero el reparto sale de 08 a 22»;
--   · confunde «este comercio atiende las 24 horas» con «este comercio todavía
--     no cargó su horario», que son dos estados distintos y se leen igual en el
--     Panel;
--   · y `business_next_open_at` devuelve NULL para los dos, así que la tienda no
--     puede decir nada útil cuando de verdad esté cerrada.
--
-- ## LO QUE CAMBIA, Y POR QUÉ ES TAN CHICO
--
-- Una sola cosa: la RPC acepta `24:00` como hora de CIERRE.
--
-- El día entero pasa a escribirse `00:00 – 24:00`, una fila por día y por canal.
-- No hace falta una columna, ni una bandera, ni una tabla: `time` en PostgreSQL
-- admite `24:00:00` como valor máximo, la hora local de un instante siempre es
-- menor —a lo sumo `23:59:59.999999`—, y con eso la comparación que ya existe
-- en `business_is_open`
--
--     opens_at < closes_at and v_time >= opens_at and v_time < closes_at
--
-- da verdadero a cualquier hora del día sin tocar una línea de esa función. Los
-- cinco instantes del encargo —23:59, 00:00, 02:00, 05:00 y 12:00— entran por el
-- mismo camino que ya cubría el turno partido.
--
-- Tampoco cambia la aritmética de solapamiento: `extract(epoch from time
-- '24:00')/60` vale 1440, que es exactamente el borde superior de la recta de
-- minutos que la RPC ya usa. Un día completo choca con cualquier otro tramo del
-- mismo día, que es lo que corresponde.
--
-- `24:00` sólo vale como CIERRE. Como apertura sería una franja que empieza
-- cuando el día terminó: `opens_at > closes_at` la haría cruzar la medianoche y
-- quedaría equivalente a `00:00 – closes_at`, con otro nombre. Se rechaza con un
-- motivo escrito en vez de dejar dos formas de decir lo mismo.
--
-- ## LO QUE NO CAMBIA
--
--   · **el alcohol.** `business_is_open(business, 'alcohol', …)` sigue leyendo
--     `alcohol_hours_enforced` y las franjas del canal `alcohol`, que son filas
--     distintas de las de `delivery` y `pickup`. Poner el comercio 24 horas NO
--     abre el canal de alcohol: hay que cargarle sus propias franjas, y además
--     `create_order` exige `alcohol_sales_enabled`, edad mínima, ventana y huso
--     antes de aceptar una línea con alcohol. Que la tienda abra a las 03:00 no
--     autoriza a vender una cerveza a las 03:00, y esta migración no acerca esas
--     dos decisiones ni un milímetro;
--   · **el delivery.** Que el comercio ACEPTE pedidos no dice que haya reparto
--     disponible: son dos canales con dos grillas —`delivery` y `pickup`— y la
--     cobertura la sigue decidiendo `resolve_delivery_zone`, que esta migración
--     no toca;
--   · **el huso.** La hora la sigue poniendo el backend con
--     `operating_timezone`. El navegador nunca decide si el comercio está
--     abierto;
--   · **el estado actual.** Esta migración no escribe una sola fila de horario.
--     Ningún comercio queda 24/7 por aplicarla: alguien tiene que cargar la
--     grilla desde el Panel, a propósito.
--
-- ## REVERSIÓN
--
-- Volver a declarar la RPC con la regla de formato anterior. Las filas ya
-- cargadas con `24:00` seguirían funcionando —la tabla las admite y
-- `business_is_open` las lee igual—, pero dejarían de poder editarse desde el
-- Panel hasta reponer esta versión.
--
-- Forward-only. No toca 1..116.

create or replace function public.set_business_service_hours(
  p_business_id uuid,
  p_channel text,
  p_hours jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $set_business_service_hours_24x7$
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

  -- `24:00` es la única hora fuera del reloj de 24 que se acepta, y sólo como
  -- cierre: es como se escribe «hasta que termine el día». Ver la cabecera.
  if exists (
    select 1 from jsonb_array_elements(p_hours) as e(value)
     where jsonb_typeof(e.value) <> 'object'
        or exists (select 1 from jsonb_object_keys(e.value) as k(key)
                    where k.key not in ('weekday', 'opens_at', 'closes_at'))
        or (e.value ->> 'weekday') !~ '^[0-6]$'
        or (e.value ->> 'opens_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        or (e.value ->> 'closes_at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$|^24:00(:00)?$'
        or (e.value ->> 'opens_at')::time = (e.value ->> 'closes_at')::time
  ) then
    raise exception 'franja invalida: se espera weekday 0-6 y horas HH:MM distintas (el cierre admite 24:00 para el dia completo)'
      using errcode = '22023';
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
  -- no, «22:00–02:00» y «01:00–03:00» parecerían no tocarse. El día completo
  -- ocupa la recta entera —`00:00–24:00` son los minutos 0 a 1440— así que choca
  -- con cualquier otro tramo del mismo día, que es lo correcto.
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
  values (
    p_business_id,
    'hours',
    'replaced',
    case when auth.uid() is null then 'service' else 'user' end,
    auth.uid(),
    jsonb_build_object('channel', v_channel, 'hours', v_before),
    jsonb_build_object('channel', v_channel, 'hours', v_after)
  );

  return jsonb_build_object('ok', true, 'channel', v_channel, 'count', v_count, 'hours', v_after);
end;
$set_business_service_hours_24x7$;

comment on function public.set_business_service_hours(uuid, text, jsonb) is
  'Reemplaza la grilla semanal de un canal, en una transaccion y con auditoria. El cierre admite 24:00: «00:00 – 24:00» es el dia completo, y siete de esas filas son un canal abierto las 24 horas. No habilita alcohol: ese canal tiene su propia grilla y su propia compuerta.';

comment on table public.business_service_hours is
  'Franjas horarias recurrentes por canal y dia. Varias filas por dia admiten el turno partido; closes_at < opens_at cruza la medianoche; closes_at = 24:00 es el dia completo, y siete de esas filas son el canal abierto las 24 horas.';
