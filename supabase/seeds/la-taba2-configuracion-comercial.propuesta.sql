-- ============================================================================
--  LA TABA2 AUTOSERVICIO — configuración comercial PROPUESTA
-- ============================================================================
--
--  ESTE ARCHIVO NO ES UNA MIGRACIÓN Y NO SE APLICA SOLO.
--  ------------------------------------------------------
--  Vive en `supabase/seeds/`, no en `supabase/migrations/`, a propósito:
--  `supabase db push` no lo mira. Se corre a mano, contra un `business_id`
--  concreto, y sólo después de que una persona confirme lo que dice acá abajo.
--
--  QUÉ ES DATO CONFIRMADO Y QUÉ NO
--  -------------------------------
--  CONFIRMADO por el comercio, y por eso está escrito:
--    · nombre: LA TABA2 AUTOSERVICIO
--    · dirección: Mendoza 827, Neuquén Capital
--    · horario general informado: 08:00–14:00 y 17:30–22:30
--    · formas de pago: efectivo y Mercado Pago
--    · cobertura NÚCLEO deseada: Santa Genoveva, Área Centro Este,
--      Área Centro Oeste, Área Centro Sur, Villa Farrell
--    · cobertura a EVALUAR: Mariano Moreno, Provincias Unidas, Alta Barda,
--      14 de Octubre / COPOL, Rincón de Emilio
--    · NO entregar: Cipolletti, oeste lejano, y cualquier zona no habilitada
--      explícitamente
--
--  NO CONFIRMADO, y por eso NO está escrito en ninguna parte de este archivo:
--    1. el costo de envío definitivo. Lo informado es un rango —entre $2.500 y
--       $3.000—, y un rango no es un precio. La tarifa queda en NULL y el
--       comercio no puede exigir cobertura hasta cargarla: `resolve_delivery_zone`
--       niega una zona sin tarifa en vez de entregar gratis por omisión.
--    2. el pedido mínimo. NULL significa «sin mínimo», que es una decisión
--       legítima; poner un número inventado sería otra cosa.
--    3. el WhatsApp comercial.
--    4. la política de pedidos grandes.
--    5. los días y horarios especiales (feriados). El horario semanal se carga
--       parejo de lunes a domingo porque es lo único informado; el día que haya
--       una excepción se carga por el Panel.
--    6. el pin exacto del local. Por eso este archivo NO enciende
--       `delivery_max_radius_meters`: el tope se ancla en un punto que todavía
--       nadie confirmó parado en la puerta, y `set_delivery_pricing` se niega a
--       aceptarlo mientras siga sin verificar.
--
--  LOS DIEZ BARRIOS ENTRAN COMO `declared_area`, NO COMO POLÍGONO
--  --------------------------------------------------------------
--  Un polígono es una afirmación geográfica precisa —dónde termina exactamente
--  Santa Genoveva— y nadie la hizo. Dibujarla acá sería inventar un dato con
--  aspecto de medición. Los diez entran como barrio declarado: la persona lo
--  elige de la lista que publica el propio comercio. El día que haya fronteras
--  cargadas de verdad, la misma tabla las acepta y pasan a pesar más que la
--  declaración, sin tocar el esquema.
--
--  Y LOS CINCO A EVALUAR ENTRAN APAGADOS
--  -------------------------------------
--  `is_active = false`. Existen para que se los pueda encender con un clic
--  cuando se decida, y mientras tanto NO dan cobertura: la resolución sólo mira
--  zonas activas.
--
--  CÓMO SE CORRE
--  -------------
--    psql "$DATABASE_URL" \
--      -v business_id=<uuid del comercio> \
--      -f supabase/seeds/la-taba2-configuracion-comercial.propuesta.sql
--
--  Todo corre dentro de una transacción: o queda la configuración entera, o no
--  queda nada.
--
--  Deja la exigencia APAGADA. Encenderla es un acto humano aparte, desde el
--  Panel, y recién cuando la tarifa esté cargada.
-- ============================================================================

\set ON_ERROR_STOP on

-- La interpolación de psql no entra en un bloque `$$ ... $$`, así que el
-- identificador del comercio se pasa a un ajuste de sesión ACÁ AFUERA y el
-- bloque lo lee de ahí. Sin el parámetro, el archivo se corta antes de tocar
-- nada.
\if :{?business_id}
\else
\echo 'ERROR: falta -v business_id. Ver el encabezado de este archivo.'
\quit 2
\endif

begin;

select set_config('taba.seed_business_id', :'business_id', true);

do $$
declare
  v_business uuid := nullif(current_setting('taba.seed_business_id', true), '')::uuid;
  v_zone text;
  -- Los cinco del núcleo: se cargan ACTIVOS.
  v_core text[] := array[
    'Santa Genoveva',
    'Área Centro Este',
    'Área Centro Oeste',
    'Área Centro Sur',
    'Villa Farrell'
  ];
  -- Los cinco a evaluar: se cargan APAGADOS. No dan cobertura hasta que alguien
  -- los encienda a propósito.
  v_evaluate text[] := array[
    'Mariano Moreno',
    'Provincias Unidas',
    'Alta Barda',
    '14 de Octubre / COPOL',
    'Rincón de Emilio'
  ];
begin
  if v_business is null then
    raise exception 'Falta el comercio: correr con -v business_id o set taba.seed_business_id';
  end if;
  if not exists (select 1 from public.businesses where id = v_business) then
    raise exception 'El comercio % no existe en esta base', v_business;
  end if;

  -- ── Huso horario ───────────────────────────────────────────────────────────
  -- Es contexto, no una regla: sin él no se puede leer un horario, y la base lo
  -- exige antes de dejar exigirlo. No enciende nada por sí solo.
  update public.businesses
     set operating_timezone = coalesce(operating_timezone, 'America/Argentina/Buenos_Aires')
   where id = v_business;

  -- ── Horario informado: 08:00–14:00 y 17:30–22:30, los siete días ──────────
  -- Es lo único que el comercio informó. Si algún día es distinto, se corrige
  -- por el Panel; el modelo ya lo admite día por día.
  delete from public.business_service_hours
   where business_id = v_business and channel in ('delivery', 'pickup');

  insert into public.business_service_hours (business_id, channel, weekday, opens_at, closes_at)
  select v_business, c.channel, d.weekday, s.opens_at, s.closes_at
    from unnest(array['delivery', 'pickup']) as c(channel)
   cross join generate_series(0, 6) as d(weekday)
   cross join (values ('08:00'::time, '14:00'::time), ('17:30'::time, '22:30'::time)) as s(opens_at, closes_at);

  -- ── Cobertura: lista blanca explícita ─────────────────────────────────────
  -- SIN TARIFA. `delivery_fee` queda en NULL a propósito: lo informado es un
  -- rango entre $2.500 y $3.000, y hasta que alguien elija el número, la zona no
  -- habilita nada. Es la falla del lado seguro: no se entrega gratis por
  -- omisión ni se cobra un precio que nadie decidió.
  foreach v_zone in array v_core loop
    insert into public.delivery_zones (
      business_id, name, is_active, match_kind, area_normalized,
      delivery_fee, minimum_subtotal, priority, notes
    ) values (
      v_business, v_zone, true, 'declared_area', public.normalize_zone_name(v_zone),
      null, null, 10, 'Núcleo informado por el comercio. Falta la tarifa definitiva.'
    ) on conflict (business_id, name) do nothing;
  end loop;

  foreach v_zone in array v_evaluate loop
    insert into public.delivery_zones (
      business_id, name, is_active, match_kind, area_normalized,
      delivery_fee, minimum_subtotal, priority, notes
    ) values (
      v_business, v_zone, false, 'declared_area', public.normalize_zone_name(v_zone),
      null, null, 50, 'Expansión a evaluar. Apagada: no da cobertura hasta que se decida.'
    ) on conflict (business_id, name) do nothing;
  end loop;

  -- ── Lo que NO se carga ─────────────────────────────────────────────────────
  -- Cipolletti y el oeste lejano NO aparecen como zonas apagadas: una zona
  -- apagada es «todavía no», y acá la decisión fue «no». Lo que no está en la
  -- lista no se entrega, y esa es toda la regla. Agregar filas para nombrar lo
  -- que se excluye sólo daría lugar a que alguien las encienda por error.

  raise notice 'Configuración propuesta cargada para %.', v_business;
  raise notice 'Zonas activas: %  ·  zonas apagadas: %',
    (select count(*) from public.delivery_zones where business_id = v_business and is_active),
    (select count(*) from public.delivery_zones where business_id = v_business and not is_active);
  raise notice 'FALTA, y sin esto la cobertura NO se puede exigir:';
  raise notice '  · la tarifa de envío (rango informado: 2500 a 3000, sin decidir)';
  raise notice '  · el pedido mínimo, si va a haber uno';
  raise notice 'La exigencia queda APAGADA. Encenderla es un acto humano en el Panel.';
end;
$$;

commit;
