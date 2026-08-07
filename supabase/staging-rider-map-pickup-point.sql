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
--  DE DÓNDE SALEN LAS COORDENADAS Y POR QUÉ `qa_fixture`
--  ----------------------------------------------------
--  De `js/config.js`, que ya declara el local de este entorno:
--      businessLocation: { lat: -38.9516, lng: -68.0591 }  // Neuquén Capital
--  No son un punto inventado acá: son el punto que el propio repositorio viene
--  declarando para este negocio de staging.
--
--  El contrato acepta `business_verified` o `qa_fixture`. Se usa **qa_fixture**
--  a propósito: nadie del negocio verificó todavía este punto contra la puerta
--  real del local. Declararlo `business_verified` sería afirmar una verificación
--  que no ocurrió. Antes del primer pedido humano físico hay que reemplazarlo
--  por el punto real y recién ahí marcarlo verificado; el bloque del final deja
--  escrita esa sentencia.
--
--  IDEMPOTENTE Y NO DESTRUCTIVO
--  ----------------------------
--  La dirección sólo se escribe si está vacía: si alguien ya cargó la real,
--  este archivo no la pisa. El punto se actualiza sólo mientras siga siendo
--  `qa_fixture`, así que tampoco puede degradar un punto ya verificado.
-- ============================================================================

do $taba_pickup_point$
declare
  v_business_id constant uuid := '00000000-0000-4000-8000-000000000001';
  v_lat  constant numeric(9,6) := -38.951600;   -- js/config.js businessLocation
  v_lng  constant numeric(9,6) := -68.059100;
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
      (business_id, latitude, longitude, source, accuracy_m, updated_at)
    values (v_business_id, v_lat, v_lng, 'qa_fixture', null, statement_timestamp())
    on conflict (business_id) do update
      set latitude = excluded.latitude,
          longitude = excluded.longitude,
          source = excluded.source,
          accuracy_m = excluded.accuracy_m,
          updated_at = excluded.updated_at;
    raise notice 'punto de retiro cargado como qa_fixture';
  end if;
end
$taba_pickup_point$;

-- ============================================================================
--  ANTES DEL PRIMER PEDIDO HUMANO FÍSICO
--  -------------------------------------
--  Reemplazar el punto de staging por el punto real de la puerta del local y
--  recién entonces declararlo verificado. Con el negocio delante, no antes:
--
--    update public.businesses
--       set address = '<dirección real del local>'
--     where id = '00000000-0000-4000-8000-000000000001';
--
--    insert into private.rider_map_business_locations
--      (business_id, latitude, longitude, source, accuracy_m)
--    values ('00000000-0000-4000-8000-000000000001',
--            <lat real>, <lng real>, 'business_verified', <precisión en metros>)
--    on conflict (business_id) do update
--      set latitude = excluded.latitude, longitude = excluded.longitude,
--          source = excluded.source, accuracy_m = excluded.accuracy_m,
--          updated_at = statement_timestamp();
--
--  El punto entra al pedido por `trigger rider_map_capture_order_location`, que
--  fotografía la ubicación **en el alta del pedido**. Un pedido creado antes de
--  este cambio conserva su foto vacía para siempre, y eso es a propósito: la
--  instantánea es inmutable. Cambiar el punto afecta a los pedidos siguientes,
--  nunca a los ya emitidos.
-- ============================================================================
