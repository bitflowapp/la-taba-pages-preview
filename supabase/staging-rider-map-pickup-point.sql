-- ============================================================================
--  Punto de retiro autorizado del Rider — configuración SOLO de staging
-- ============================================================================
--
--  POR QUÉ EXISTE
--  --------------
--  `20260804090000_rider_map_location_contracts` entrega el contrato del mapa:
--  las coordenadas viven fuera de las tablas públicas, el punto del negocio se
--  publica a la cola y el punto del cliente se revela únicamente al Rider
--  asignado. El contrato está aplicado en staging y funciona.
--
--  Lo que faltaba era el dato. Medido sobre `la-taba-staging`:
--
--    private.rider_map_business_locations ......... 0 filas
--    public.businesses.address .................... NULL
--
--  Con eso, `private.rider_map_location_payload` devuelve `business_location`
--  nulo y `get_rider_queue.pickup_summary` nulo, y la app Rider muestra —
--  correctamente— «Mapa no disponible para este pedido / No hay coordenadas
--  autorizadas» y «Dirección de retiro no informada». La app no miente: no hay
--  punto que mostrar. Este archivo carga el punto que faltaba.
--
--  POR QUÉ NO VA EN seed.sql NI EN UNA MIGRACIÓN
--  ---------------------------------------------
--  `supabase/seed.sql` es deliberadamente vacío: `db reset` no puede inventar un
--  negocio ni una dirección. Esa política se respeta. Esto tampoco es esquema,
--  así que no es una migración: es configuración de un entorno concreto, y se
--  aplica a mano contra el entorno que la necesita.
--
--  DE DÓNDE SALEN LAS COORDENADAS
--  ------------------------------
--  Del contrato central `data/business-location.json`. NO se escriben acá a
--  mano: `npm run location:check` compara este archivo contra el contrato, el
--  módulo del storefront y la app del Rider, y falla si alguno se desvía.
--
--  CORRECCIÓN DEL 2026-08-08 — el punto anterior estaba mal
--  --------------------------------------------------------
--  Hasta hoy este archivo sembraba `-38.951600, -68.059100` como `qa_fixture`,
--  copiado de `js/config.js`. Ese punto cae sobre Avenida Argentina, junto a
--  Parque Central, a 793 m de la puerta de La Taba 2 — el reverse geocoding lo
--  ubica en el radar de Av. Argentina y Roca. No era el local: era un valor que
--  se venía arrastrando sin que nada obligara a contrastarlo.
--
--  El punto que entra ahora es Mendoza 827 verificado contra la ficha comercial
--  de Google Maps («La Taba 2», Almacén, Plus Code 3W3W+HM), contrastada contra
--  la numeración catastral que OSM tiene sobre calle Mendoza (18 m), contra la
--  geocodificación de Google de la dirección sola (7 m) y contra la vista
--  satélite, que lo pone sobre Mendoza, cuadra 800, vereda impar.
--
--  POR QUÉ `public_directory_cross_checked` Y NO `business_verified`
--  ----------------------------------------------------------------
--  Porque nadie del comercio confirmó todavía el pin contra la puerta. El
--  origen es una ficha pública contrastada, que es más fuerte que `qa_fixture`
--  y más débil que una verificación humana. La base impone que `human_verified`
--  sólo pueda ser verdadero con `business_verified`
--  (20260807170000_pickup_point_provenance.sql), y acá queda en false.
--
--  IDEMPOTENTE Y NO DESTRUCTIVO
--  ----------------------------
--  La dirección sólo se escribe si está vacía: si alguien ya cargó la real,
--  este archivo no la pisa. El punto NO se toca si ya es `business_verified`,
--  así que no puede degradar una verificación humana.
-- ============================================================================

do $taba_pickup_point$
declare
  v_business_id constant uuid := '00000000-0000-4000-8000-000000000001';
  -- data/business-location.json → latitude / longitude
  v_lat  constant numeric(9,6) := -38.946062;
  v_lng  constant numeric(9,6) := -68.053321;
  v_source constant text := 'public_directory_cross_checked';
  v_confidence constant text := 'high';
  v_accuracy_m constant numeric(10,2) := 20;
  v_note constant text :=
    'Ficha comercial de Google Maps «La Taba 2» (Mendoza 827, Q8300 Neuquen, '
    || 'Plus Code 3W3W+HM, CID 0x960a33d98e978059:0x16953b61ac68be7), contrastada '
    || 'contra la numeracion catastral de OSM sobre calle Mendoza (18 m), la '
    || 'geocodificacion de la direccion sola en Google (7 m), el Plus Code '
    || 'recomputado desde el pin y la vista satelite. Reemplaza a -38.9516,-68.0591, '
    || 'que caia a 793 m, sobre Av. Argentina junto a Parque Central.';
  -- La dirección NO es libre: la app Rider trae la suya compilada
  -- (`kTabaBusinessIdentity`, lib/core/config/business_config.dart) y
  -- `matchesProjection` compara la proyectada con la configurada. Si no
  -- concuerdan, el detalle del pedido muestra «Retiro no reconocido: este
  -- pedido no corresponde a La Taba 2» y bloquea la operación. Falla cerrada a
  -- propósito, y está bien que lo haga.
  --
  -- Medido en el Moto: con una etiqueta descriptiva («Local TABA2 · Neuquén
  -- Capital…») el Rider quedó bloqueado sobre un pedido válido. Mientras la app
  -- declare Mendoza 827, el backend tiene que decir Mendoza 827.
  v_address constant text := 'Mendoza 827';
  v_existing_source text;
  v_existing_address text;
begin
  -- Guarda: este archivo configura un negocio concreto de un entorno concreto.
  if not exists (select 1 from public.businesses where id = v_business_id) then
    raise exception 'ABORTAR: el negocio de staging % no existe en este proyecto', v_business_id;
  end if;

  -- Guarda: una coordenada fuera de Neuquén Capital manda al Rider a otra
  -- ciudad. Es lo que habría frenado el «Mendoza 827» de Zapala, a 175 km.
  if v_lat not between -38.982 and -38.904 or v_lng not between -68.105 and -67.955 then
    raise exception 'ABORTAR: %, % cae fuera de Neuquén Capital', v_lat, v_lng;
  end if;

  select address into v_existing_address
    from public.businesses where id = v_business_id;

  if coalesce(btrim(v_existing_address), '') = '' then
    update public.businesses
       set address = v_address,
           updated_at = now()
     where id = v_business_id;
    raise notice 'businesses.address cargada';
  else
    raise notice 'businesses.address ya tenía valor; no se toca';
  end if;

  select source into v_existing_source
    from private.rider_map_business_locations
   where business_id = v_business_id;

  if v_existing_source = 'business_verified' then
    raise notice 'el punto ya está verificado por el negocio; no se toca';
  else
    insert into private.rider_map_business_locations
      (business_id, latitude, longitude, source, accuracy_m,
       confidence, human_verified, source_note, updated_at)
    values (v_business_id, v_lat, v_lng, v_source, v_accuracy_m,
            v_confidence, false, v_note, statement_timestamp())
    on conflict (business_id) do update
      set latitude = excluded.latitude,
          longitude = excluded.longitude,
          source = excluded.source,
          accuracy_m = excluded.accuracy_m,
          confidence = excluded.confidence,
          human_verified = excluded.human_verified,
          source_note = excluded.source_note,
          updated_at = excluded.updated_at,
          -- Un punto nuevo invalida cualquier chequeo de presencia anterior:
          -- lo que se comprobó fue la cercanía a OTRA coordenada.
          verified_by_rider_presence = false,
          presence_checked_at = null,
          presence_distance_m = null,
          presence_accuracy_m = null,
          presence_status = null;
    raise notice 'punto de retiro cargado: %, % (%)', v_lat, v_lng, v_source;
  end if;
end
$taba_pickup_point$;

-- ============================================================================
--  ANTES DEL PRIMER PEDIDO HUMANO FÍSICO
--  -------------------------------------
--  Falta un solo escalón: que alguien del comercio confirme el pin contra la
--  puerta. Con el negocio delante, no antes, y por el CLI, que deja la
--  afirmación humana escrita en la invocación:
--
--    node scripts/set-pickup-point.mjs <lat> <lng> \
--      --origen=business_verified --confirmado-por-humano \
--      --confianza=high --precision=<metros> --reemplazar
--
--  El punto entra al pedido por `trigger rider_map_capture_order_location`, que
--  fotografía la ubicación **en el alta del pedido**. Un pedido creado antes de
--  este cambio conserva su foto vieja para siempre, y eso es a propósito: la
--  instantánea es inmutable. Cambiar el punto afecta a los pedidos siguientes,
--  nunca a los ya emitidos. Los pedidos anteriores al 2026-08-08 llevan
--  fotografiado el punto equivocado de Parque Central.
-- ============================================================================
