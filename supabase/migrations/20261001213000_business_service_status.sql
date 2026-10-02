-- El estado del servicio se pregunta en un solo lugar, y contesta lo mismo que cobra el pedido.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   1. No existía un contrato público que dijera ABIERTO / CERRADO / ABRE A LAS / CIERRA A
--      LAS por canal. `commerce_availability` contesta `is_open` y `next_open_at` de un
--      canal por llamada, rechaza el canal `alcohol` («canal invalido»), no calcula ningún
--      instante de cierre y deja la pausa manual en un booleano aparte: con el comercio
--      pausado devuelve `is_open: true` y una «próxima apertura». El cliente se entera de
--      que cerró recién cuando el pedido rebota con BUSINESS_CLOSED.
--   2. Ninguna función calculaba un cierre. La única que mira el reloj hacia adelante,
--      `business_next_open_at`, sólo contesta aperturas.
--   3. `business_day_windows` no cumplía su propio contrato («un cierre explícito devuelve
--      cero filas») cuando la misma fecha tenía un cierre `all` y un horario especial del
--      canal: elegía el especial. `business_is_open` cerraba esa fecha —mira el cierre
--      aparte— pero el día siguiente abría de 00:00 a 02:00 por el arrastre de una franja
--      de un día que estuvo cerrado, y `business_next_open_at` decía que recién abría a
--      las 09:00. Dos primitivas del mismo motor contestaban distinto por el mismo instante.
--   4. Un horario especial cargado para `all` reemplazaba también la grilla del canal
--      `alcohol`: un feriado con horario extendido 08:00–23:30 volvía vendible el alcohol
--      a las 23:00 con una ventana propia de 10:00 a 22:00. El horario general no autoriza
--      alcohol en ningún otro lugar del sistema; acá sí.
--
-- QUÉ QUEDA
--
--   · `get_business_service_status(negocio, instante)`: una sola respuesta, determinística,
--     para `delivery`, `pickup` y `alcohol`. Por canal: OPEN o CLOSED, el motivo cuando
--     está cerrado (vocabulario cerrado), `opens_at` y `closes_at`. Más el huso del
--     comercio, si el horario se exige y el instante evaluado.
--   · El estado NO se recalcula con otra lógica: sale de `business_is_open`, que es la
--     misma llamada que hace el alta del pedido. OPEN acá es exactamente «el alta no va a
--     levantar BUSINESS_CLOSED por este canal». Para `alcohol` suma las dos compuertas que
--     el alta aplica: la ventana de la política (`alcohol_sales_start/end` en
--     `alcohol_timezone`) y, si se exige, la grilla del canal.
--   · Los instantes de apertura y de cierre salen de las mismas franjas
--     (`business_day_windows` y los cierres por excepción), llevadas a tiempo real con el
--     huso del comercio. La conversión es exacta en los cambios de hora: la hora que no
--     existe y la hora que se repite se resuelven igual que las resuelve `business_is_open`.
--   · En `business_day_windows` un cierre gana siempre sobre un horario especial de la
--     misma fecha, y un horario especial `all` deja de aplicarse al canal `alcohol` (un
--     cierre `all` sigue cerrándolo).
--
-- QUÉ NO CAMBIA
--
--   · `business_is_open` y `business_next_open_at` no se tocan.
--   · `commerce_availability` no se toca: sigue contestando lo mismo, con las mismas claves.
--   · Con `hours_enforced = false` todo sigue abierto mientras el comercio esté abierto a
--     mano: el estado es OPEN y `closes_at` es null.
--   · No se escribe un solo horario, una sola excepción ni un solo huso.
--   · Nada de esto sale de un valor fijo para un comercio: todo se lee de sus filas.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001213000_business_service_status.rollback.sql

-- ── 1. Las franjas de una fecha: un cierre gana, y `all` no ensancha el alcohol ─────────
create or replace function public.business_day_windows(
  p_business_id uuid,
  p_channel text,
  p_date date
) returns table (opens_at time, closes_at time)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $business_day_windows$
  with exception_row as (
    select e.*
      from public.business_service_exceptions e
     where e.business_id = p_business_id
       and e.on_date = p_date
       and (
         e.channel = p_channel
         -- Un horario especial general no es una autorización para vender alcohol:
         -- al canal `alcohol` sólo le llega de `all` el cierre.
         or (e.channel = 'all' and (e.is_closed or p_channel <> 'alcohol'))
       )
     -- El cierre va primero. Si la fecha tiene un cierre y un horario especial, la fecha
     -- está cerrada y no deja franja que arrastrar al día siguiente.
     order by e.is_closed desc, case when e.channel = p_channel then 0 else 1 end
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
$business_day_windows$;

comment on function public.business_day_windows(uuid, text, date) is
  'Franjas que rigen esa fecha local para ese canal. Una excepción reemplaza al horario semanal; un cierre (del canal o `all`) gana sobre un horario especial de la misma fecha y devuelve cero filas; un horario especial `all` no se aplica al canal `alcohol`.';

-- ── 2. Los tramos de desplazamiento UTC de un huso ──────────────────────────────────────
-- Para llevar una franja local a tiempo real hace falta saber qué desplazamiento rige en
-- cada instante. `at time zone` contesta UN instante por hora local: en la hora que se
-- repite (fin del horario de verano) elige la segunda pasada y en la hora que no existe
-- (comienzo) corre la hora hacia adelante. `business_is_open` no razona así —mira la hora
-- de pared de cada instante—, de modo que una franja que empieza o termina dentro de esa
-- hora abre y cierra en instantes que `at time zone` no devuelve. Con los tramos, la
-- imagen de una franja local es exacta.
create or replace function public.timezone_offset_segments(
  p_timezone text,
  p_from timestamptz,
  p_to timestamptz
) returns table (valid_from timestamptz, valid_to timestamptz, utc_offset interval)
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $timezone_offset_segments$
declare
  v_cursor timestamptz := date_trunc('second', p_from);
  v_end timestamptz := date_trunc('second', p_to);
  v_segment_start timestamptz := '-infinity';
  v_offset interval;
  v_next timestamptz;
  v_low timestamptz;
  v_high timestamptz;
  v_middle timestamptz;
begin
  if p_timezone is null or p_from is null or p_to is null or p_to < p_from then
    return;
  end if;
  v_offset := (v_cursor at time zone p_timezone) - (v_cursor at time zone 'UTC');
  while v_cursor < v_end loop
    -- Pasos de 24 horas reales (no «1 day», que depende del huso de la sesión). Ningún
    -- huso cambia dos veces en un día.
    v_next := least(v_cursor + interval '24 hours', v_end);
    if (v_next at time zone p_timezone) - (v_next at time zone 'UTC') = v_offset then
      v_cursor := v_next;
    else
      -- Los cambios caen en segundos enteros: se busca el primero con el desplazamiento nuevo.
      v_low := v_cursor;
      v_high := v_next;
      while v_high - v_low > interval '1 second' loop
        v_middle := v_low + make_interval(secs => floor(extract(epoch from (v_high - v_low)) / 2));
        if (v_middle at time zone p_timezone) - (v_middle at time zone 'UTC') = v_offset then
          v_low := v_middle;
        else
          v_high := v_middle;
        end if;
      end loop;
      valid_from := v_segment_start;
      valid_to := v_high;
      utc_offset := v_offset;
      return next;
      v_segment_start := v_high;
      v_offset := (v_high at time zone p_timezone) - (v_high at time zone 'UTC');
      v_cursor := v_high;
    end if;
  end loop;
  valid_from := v_segment_start;
  valid_to := 'infinity';
  utc_offset := v_offset;
  return next;
end;
$timezone_offset_segments$;

comment on function public.timezone_offset_segments(text, timestamptz, timestamptz) is
  'Tramos [valid_from, valid_to) de desplazamiento UTC constante de un huso entre dos instantes; el primero empieza en -infinity y el último termina en infinity. Interna: la usa el estado del servicio para convertir franjas locales sin errar en los cambios de hora.';

-- ── 3. Las franjas de un rango de fechas, de una sola vez ───────────────────────────────
-- `business_day_windows` contesta una fecha por llamada y es la primitiva que usa el alta.
-- Para mirar dos semanas hacia adelante, llamarla dieciocho veces por canal cuesta más que
-- todo el resto de la consulta. Ésta aplica LA MISMA regla sobre un rango, en una sola
-- lectura. Que las dos contesten lo mismo fecha por fecha lo fija el ensayo pgTAP de este
-- paquete: si alguien cambia una, la otra lo delata.
create or replace function public.business_windows_between(
  p_business_id uuid,
  p_channel text,
  p_from date,
  p_to date
) returns table (local_date date, opens_at time, closes_at time)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $business_windows_between$
begin
  -- plpgsql y no sql: el plan queda en la sesión, y esta lectura se hace tres veces por
  -- consulta de estado.
  return query
  with exception_rows as (
    select distinct on (e.on_date) e.on_date, e.is_closed, e.opens_at, e.closes_at
      from public.business_service_exceptions e
     where e.business_id = p_business_id
       and e.on_date between p_from and p_to
       and (
         e.channel = p_channel
         or (e.channel = 'all' and (e.is_closed or p_channel <> 'alcohol'))
       )
     order by e.on_date, e.is_closed desc, case when e.channel = p_channel then 0 else 1 end
  )
  select x.on_date, x.opens_at, x.closes_at
    from exception_rows x
   where not x.is_closed
  union all
  select d.day::date, h.opens_at, h.closes_at
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d(day)
    join public.business_service_hours h
      on h.business_id = p_business_id
     and h.channel = p_channel
     and h.weekday = extract(dow from d.day)::smallint
   where not exists (select 1 from exception_rows x where x.on_date = d.day::date);
end;
$business_windows_between$;

comment on function public.business_windows_between(uuid, text, date, date) is
  'Franjas que rigen cada fecha local de un rango para un canal, con la misma regla que business_day_windows (que es la primitiva del alta del pedido y la referencia). Interna.';

-- ── 3b. Los tramos abiertos de la grilla de un canal, en tiempo real ────────────────────
-- Es `business_is_open` contado hacia adelante: la franja normal, la cola de la que cruza
-- la medianoche, su arrastre al día siguiente, y un cierre por excepción que apaga la
-- fecha local entera (incluido el arrastre que le llegaba). NO mira si el horario se
-- exige: eso lo decide quien llama.
create or replace function public.business_schedule_runs(
  p_business_id uuid,
  p_channel text,
  p_at timestamptz default now()
) returns tstzmultirange
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $business_schedule_runs$
declare
  v_timezone text;
  v_date date;
  v_runs tstzmultirange;
begin
  if p_at is null or p_channel is null or p_channel not in ('delivery', 'pickup', 'alcohol') then
    return null;
  end if;
  select b.operating_timezone into v_timezone from public.businesses b where b.id = p_business_id;
  if not found or v_timezone is null or btrim(v_timezone) = '' then
    return null;
  end if;
  begin
    v_date := (p_at at time zone v_timezone)::date;
  exception when others then
    return null;   -- huso inválido: igual que `business_is_open`, no se adivina
  end;

  -- De ayer (por el arrastre que llega a hoy) a quince días adelante: uno más de los que
  -- mira `business_next_open_at`, para que un cierre al final del horizonte sea un cierre
  -- visto y no el borde de lo que se calculó.
  with closed_days as (
    -- La misma pregunta que hace `business_is_open`: ¿hay un cierre del canal o de `all`?
    select distinct e.on_date
      from public.business_service_exceptions e
     where e.business_id = p_business_id
       and e.on_date between v_date - 1 and v_date + 16
       and e.channel in (p_channel, 'all')
       and e.is_closed
  ),
  windows as (
    select w.local_date, w.opens_at, w.closes_at
      from public.business_windows_between(p_business_id, p_channel, v_date - 1, v_date + 15) w
  ),
  local_ranges as (
    select w.local_date::timestamp + w.opens_at as local_from,
           case when w.opens_at < w.closes_at then w.local_date::timestamp + w.closes_at
                else (w.local_date + 1)::timestamp end as local_to
      from windows w
     where not exists (select 1 from closed_days c where c.on_date = w.local_date)
    union all
    select (w.local_date + 1)::timestamp,
           (w.local_date + 1)::timestamp + w.closes_at
      from windows w
     where w.opens_at > w.closes_at
       and not exists (select 1 from closed_days c where c.on_date = w.local_date + 1)
  )
  select range_agg(tstzrange(greatest(x.real_from, s.valid_from), least(x.real_to, s.valid_to), '[)'))
    into v_runs
    from local_ranges r
    cross join public.timezone_offset_segments(v_timezone, p_at - interval '72 hours', p_at + interval '19 days') s
    cross join lateral (
      select (r.local_from at time zone 'UTC') - s.utc_offset as real_from,
             (r.local_to at time zone 'UTC') - s.utc_offset as real_to
    ) x
   where greatest(x.real_from, s.valid_from) < least(x.real_to, s.valid_to);

  return coalesce(v_runs, '{}'::tstzmultirange);
end;
$business_schedule_runs$;

comment on function public.business_schedule_runs(uuid, text, timestamptz) is
  'Tramos reales en los que la grilla del canal está abierta, desde el día anterior a p_at hasta quince días después, ya unidos cuando se tocan. NULL si el comercio no tiene un huso válido. Interna: no mira hours_enforced.';

-- ── 4. Los tramos de la ventana de la política de alcohol, en tiempo real ───────────────
-- La política (`alcohol_sales_start/end` en `alcohol_timezone`) se aplica SIEMPRE a un
-- pedido con alcohol, con o sin grilla. El alta la compara con `between`, que incluye los
-- dos extremos, y cuando la ventana cruza la medianoche excluye los dos: por eso los
-- bordes llevan un microsegundo. Es feo y es lo que se cobra.
create or replace function public.business_alcohol_policy_runs(
  p_business_id uuid,
  p_at timestamptz default now()
) returns tstzmultirange
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $business_alcohol_policy_runs$
declare
  v_timezone text;
  v_start time;
  v_end time;
  v_date date;
  v_runs tstzmultirange;
begin
  if p_at is null then
    return null;
  end if;
  select b.alcohol_timezone, b.alcohol_sales_start, b.alcohol_sales_end
    into v_timezone, v_start, v_end
    from public.businesses b
   where b.id = p_business_id;
  if not found or v_timezone is null or btrim(v_timezone) = '' or v_start is null or v_end is null then
    return null;
  end if;
  begin
    v_date := (p_at at time zone v_timezone)::date;
  exception when others then
    return null;
  end;

  with days as (
    select v_date + g.n as local_date from generate_series(-2, 17) as g(n)
  ),
  local_ranges as (
    select d.local_date::timestamp + v_start as local_from,
           d.local_date::timestamp + v_end + interval '1 microsecond' as local_to
      from days d
     where v_start <= v_end
    union all
    select d.local_date::timestamp, d.local_date::timestamp + v_end
      from days d
     where v_start > v_end
    union all
    select d.local_date::timestamp + v_start + interval '1 microsecond', (d.local_date + 1)::timestamp
      from days d
     where v_start > v_end
  )
  select range_agg(tstzrange(greatest(x.real_from, s.valid_from), least(x.real_to, s.valid_to), '[)'))
    into v_runs
    from local_ranges r
    cross join public.timezone_offset_segments(v_timezone, p_at - interval '96 hours', p_at + interval '20 days') s
    cross join lateral (
      select (r.local_from at time zone 'UTC') - s.utc_offset as real_from,
             (r.local_to at time zone 'UTC') - s.utc_offset as real_to
    ) x
   where greatest(x.real_from, s.valid_from) < least(x.real_to, s.valid_to);

  return coalesce(v_runs, '{}'::tstzmultirange);
end;
$business_alcohol_policy_runs$;

comment on function public.business_alcohol_policy_runs(uuid, timestamptz) is
  'Tramos reales en los que la ventana de la política de alcohol (alcohol_sales_start/end en alcohol_timezone) admite la venta, con los mismos bordes que aplica el alta del pedido. NULL si la política no tiene ventana o huso válido. Interna.';

-- ── 5. El contrato público ──────────────────────────────────────────────────────────────
create or replace function public.get_business_service_status(
  p_business_id uuid,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_business_service_status$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_business public.businesses%rowtype;
  v_timezone text;
  v_timezone_ok boolean := false;
  v_local_date date;
  v_horizon timestamptz;
  v_channel_horizon timestamptz;
  v_business_reason text;
  v_channel text;
  v_enforced boolean;
  v_open boolean;
  v_reason text;
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_runs tstzmultirange;
  v_policy_runs tstzmultirange;
  v_policy_open boolean;
  v_policy_time time;
  v_policy_timezone_ok boolean;
  v_channels jsonb := '{}'::jsonb;
begin
  -- La consulta es pública: un instante infinito o fuera de todo calendario no se evalúa a
  -- medias ni termina en un desborde de fechas; se rechaza como entrada inválida.
  if not isfinite(v_at) or v_at < timestamptz '1900-01-01 00:00:00+00' or v_at >= timestamptz '9000-01-01 00:00:00+00' then
    raise exception 'instante invalido' using errcode = '22023';
  end if;

  select * into v_business from public.businesses b where b.id = p_business_id;

  -- Un comercio inexistente y uno inactivo contestan lo mismo: la respuesta no sirve para
  -- averiguar si un identificador existe (anon tampoco ve los comercios inactivos).
  if not found or not coalesce(v_business.is_active, false) then
    return jsonb_build_object(
      'business_id', p_business_id,
      'evaluated_at', v_at,
      'timezone', null,
      'hours_enforced', null,
      'channels', jsonb_build_object(
        'delivery', jsonb_build_object('state', 'CLOSED', 'reason', 'business_inactive', 'opens_at', null, 'closes_at', null),
        'pickup', jsonb_build_object('state', 'CLOSED', 'reason', 'business_inactive', 'opens_at', null, 'closes_at', null),
        'alcohol', jsonb_build_object('state', 'CLOSED', 'reason', 'business_inactive', 'opens_at', null, 'closes_at', null)));
  end if;

  v_timezone := nullif(btrim(coalesce(v_business.operating_timezone, '')), '');
  if v_timezone is not null then
    begin
      v_local_date := (v_at at time zone v_timezone)::date;
      -- Mismo horizonte que `business_next_open_at`: la fecha local de hoy y catorce más.
      v_horizon := (v_local_date + 15)::timestamp at time zone v_timezone;
      v_timezone_ok := true;
    exception when others then
      v_timezone_ok := false;
    end;
  end if;

  -- El interruptor manual y la habilitación mandan sobre cualquier horario. Es la misma
  -- condición que el alta evalúa antes de mirar el reloj.
  v_business_reason := case
    when not (coalesce(v_business.ordering_verified, false) and coalesce(v_business.ordering_enabled, false))
      then 'ordering_disabled'
    when v_business.status = 'closed' then 'business_closed'
    when v_business.status is distinct from 'open' then 'business_paused'
  end;

  foreach v_channel in array array['delivery', 'pickup', 'alcohol'] loop
    v_open := false;
    v_reason := null;
    v_opens_at := null;
    v_closes_at := null;
    v_runs := null;
    v_channel_horizon := v_horizon;

    if v_business_reason is not null then
      v_reason := v_business_reason;
    elsif v_channel = 'delivery' and not coalesce(v_business.delivery_enabled, false) then
      v_reason := 'channel_disabled';
    elsif v_channel = 'pickup' and not coalesce(v_business.pickup_enabled, false) then
      v_reason := 'channel_disabled';
    elsif v_channel = 'alcohol' and (
      not coalesce(v_business.alcohol_sales_enabled, false)
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null
    ) then
      v_reason := 'alcohol_disabled';
    else
      v_enforced := case
        when v_channel = 'alcohol' then coalesce(v_business.alcohol_hours_enforced, false)
        else coalesce(v_business.hours_enforced, false)
      end;

      -- LA AUTORIDAD. No se vuelve a decidir con otra cuenta: es la llamada del alta.
      v_open := public.business_is_open(p_business_id, v_channel, v_at);
      if v_enforced and v_timezone_ok then
        v_runs := public.business_schedule_runs(p_business_id, v_channel, v_at);
      end if;

      if v_channel = 'alcohol' then
        -- La ventana de la política, con la misma expresión que el alta del pedido.
        v_policy_timezone_ok := true;
        begin
          v_policy_time := (v_at at time zone v_business.alcohol_timezone)::time;
          if not v_enforced then
            v_channel_horizon := ((v_at at time zone v_business.alcohol_timezone)::date + 15)::timestamp
                                 at time zone v_business.alcohol_timezone;
          end if;
        exception when others then
          v_policy_timezone_ok := false;
        end;
        if v_policy_timezone_ok then
          v_policy_open := case
            when v_business.alcohol_sales_start <= v_business.alcohol_sales_end
              then v_policy_time between v_business.alcohol_sales_start and v_business.alcohol_sales_end
            else not (v_policy_time between v_business.alcohol_sales_end and v_business.alcohol_sales_start)
          end;
          v_policy_runs := public.business_alcohol_policy_runs(p_business_id, v_at);
        else
          v_policy_open := false;
          v_policy_runs := null;
        end if;
        v_open := v_open and v_policy_open;
        v_runs := case
          when not v_enforced then v_policy_runs
          when v_runs is null or v_policy_runs is null then null
          else v_runs * v_policy_runs
        end;
      end if;

      if v_open then
        if v_runs is not null then
          select upper(r) into v_closes_at from unnest(v_runs) as r where r @> v_at;
          -- Un tramo que llega al borde de lo calculado no tiene un cierre conocido.
          if v_closes_at is not null and v_closes_at > v_channel_horizon then
            v_closes_at := null;
          end if;
        end if;
      else
        if v_runs is not null then
          select min(lower(r)) into v_opens_at
            from unnest(v_runs) as r
           where lower(r) > v_at and lower(r) < v_channel_horizon;
        end if;
        v_reason := case
          when v_channel = 'alcohol' and not v_policy_timezone_ok then 'timezone_missing'
          when v_enforced and not v_timezone_ok then 'timezone_missing'
          when v_enforced and v_opens_at is null and not exists (
                 select 1 from public.business_service_hours h
                  where h.business_id = p_business_id and h.channel = v_channel)
            then 'hours_not_configured'
          when v_enforced and exists (
                 select 1 from public.business_service_exceptions e
                  where e.business_id = p_business_id
                    and e.on_date = v_local_date
                    and e.channel in (v_channel, 'all')
                    and e.is_closed)
            then 'exception_closed'
          else 'outside_hours'
        end;
      end if;
    end if;

    v_channels := v_channels || jsonb_build_object(v_channel, jsonb_build_object(
      'state', case when v_open then 'OPEN' else 'CLOSED' end,
      'reason', v_reason,
      'opens_at', v_opens_at,
      'closes_at', v_closes_at));
  end loop;

  return jsonb_build_object(
    'business_id', p_business_id,
    'evaluated_at', v_at,
    'timezone', v_business.operating_timezone,
    'hours_enforced', coalesce(v_business.hours_enforced, false),
    'channels', v_channels);
end;
$get_business_service_status$;

comment on function public.get_business_service_status(uuid, timestamptz) is
  'Estado del servicio por canal (delivery, pickup, alcohol) en un instante: state OPEN|CLOSED, reason (business_inactive, ordering_disabled, business_closed, business_paused, channel_disabled, alcohol_disabled, timezone_missing, hours_not_configured, exception_closed, outside_hours), opens_at y closes_at. p_at tiene que ser un instante finito entre los años 1900 y 9000 (22023 si no). El estado sale de business_is_open, la misma llamada que hace el alta del pedido: OPEN equivale a que el alta no levante BUSINESS_CLOSED por ese canal (para alcohol, tampoco la ventana de la política ni ALCOHOL_WINDOW_CLOSED). alcohol es una compuerta ADICIONAL y no un canal de entrega: un pedido con alcohol nace sólo si su canal (delivery o pickup) está OPEN y alcohol también. opens_at se informa sólo cuando el canal está cerrado por horario y closes_at sólo cuando está abierto; son null si no se conocen dentro de catorce días o si el horario no se exige. REGLA DEL PEDIDO EMPEZADO ANTES DEL CIERRE: el pedido en efectivo o a coordinar se evalúa una sola vez, en el instante en que la base lo crea (clock_timestamp() dentro de create_order_with_items), no cuando el cliente abrió el carrito; un pedido enviado después del cierre no nace, no reserva stock y responde BUSINESS_CLOSED, y un reintento idempotente de un pedido ya creado devuelve ese pedido sin volver a mirar el horario. Una vez creado, aceptarlo y avanzarlo no depende del horario. Esta consulta es un aviso previo y nunca una garantía: la autoridad es el alta.';

-- ── 6. Privilegios ──────────────────────────────────────────────────────────────────────
-- Las internas no son alcanzables por el navegador (misma regla que sus hermanas de
-- 20260812210000). La pública es de lectura y la ejecuta cualquiera que pueda ver la tienda.
revoke all on function public.business_day_windows(uuid, text, date) from public, anon, authenticated;
revoke all on function public.timezone_offset_segments(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.business_windows_between(uuid, text, date, date) from public, anon, authenticated;
revoke all on function public.business_schedule_runs(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.business_alcohol_policy_runs(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.timezone_offset_segments(text, timestamptz, timestamptz) to service_role;
grant execute on function public.business_windows_between(uuid, text, date, date) to service_role;
grant execute on function public.business_schedule_runs(uuid, text, timestamptz) to service_role;
grant execute on function public.business_alcohol_policy_runs(uuid, timestamptz) to service_role;

revoke all on function public.get_business_service_status(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.get_business_service_status(uuid, timestamptz) to anon, authenticated, service_role;
