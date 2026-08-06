-- ============================================================================
--  DOCUMENTO — NO EJECUTAR. NO ES UNA MIGRACIÓN.
-- ============================================================================
--
--  Este archivo vive deliberadamente en docs/migrations/remote-only/ y NUNCA
--  debe moverse ni copiarse a supabase/migrations/. Si se ejecutara, volvería
--  a crear objetos que YA EXISTEN en staging y que ninguna migración de este
--  repositorio gestiona.
--
--  QUÉ ES
--  ------
--  El proyecto de staging `la-taba-staging` (ref ukxqbgswjlibmnjemrzd) tiene
--  registrada en supabase_migrations.schema_migrations la versión:
--
--      version = 20260804090000
--      name    = rider_map_location_contracts
--
--  Esa migración NO EXISTE en ninguna rama de este repositorio. Se aplicó desde
--  otra fuente. Este archivo preserva la evidencia de qué dejó instalado, para
--  que nadie la borre por creerla un registro espurio.
--
--  LA COLISIÓN
--  -----------
--  Este repositorio tiene, con la MISMA versión, una migración DISTINTA:
--
--      supabase/migrations/20260804090000_business_operations_panel.sql
--
--  Esa migración local nunca se aplicó a staging y nunca podrá aplicarse bajo
--  esa versión, porque el número ya está ocupado. Su contrato se entrega por
--  medio de la migración de reconciliación con versión libre posterior.
--
--  REGLA
--  -----
--  Ninguna migración de este repositorio debe borrar, reemplazar, renombrar,
--  recrear ni tomar propiedad de los objetos descriptos abajo.
--
--  Relevado en solo lectura el 2026-08-06. Ningún dato fue modificado.
--  Las tablas contienen datos reales de staging: no se transcribe su contenido.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ESQUEMA
-- ---------------------------------------------------------------------------
-- private    ACL: postgres=UC/postgres
--            Sin USAGE para anon / authenticated / service_role.


-- ---------------------------------------------------------------------------
-- TABLAS (2) — RLS habilitada en ambas, owner postgres
-- ---------------------------------------------------------------------------
-- private.rider_map_business_locations
--     business_id, latitude, longitude, source, accuracy_m, updated_at
--     PK: rider_map_business_locations_pkey
--     filas al momento del relevamiento: 0
--
-- private.rider_map_order_location_snapshots
--     order_id, business_latitude, business_longitude, business_source,
--     business_accuracy_m, customer_latitude, customer_longitude,
--     customer_source, customer_accuracy_m, created_at
--     PK: rider_map_order_location_snapshots_pkey
--     filas al momento del relevamiento: 1   <-- DATO REAL, no transcrito


-- ---------------------------------------------------------------------------
-- FUNCIONES (2)
-- ---------------------------------------------------------------------------
-- private.rider_map_location_payload(uuid, boolean)
--     Lectura del snapshot. Cuerpo no transcrito a propósito.
--
-- private.capture_rider_map_order_location_snapshot()
--     Función de trigger. Definición literal, tal como está desplegada:

/*
CREATE OR REPLACE FUNCTION private.capture_rider_map_order_location_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_business private.rider_map_business_locations%rowtype;
begin
  select *
    into v_business
    from private.rider_map_business_locations
   where business_id = new.business_id;

  insert into private.rider_map_order_location_snapshots (
    order_id,
    business_latitude, business_longitude, business_source, business_accuracy_m,
    customer_latitude, customer_longitude, customer_source, customer_accuracy_m
  ) values (
    new.id,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.latitude end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.longitude end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.source end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.accuracy_m end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_latitude end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_longitude end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then nullif(new.delivery_address_source, '') end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_geolocation_accuracy end
  )
  on conflict (order_id) do nothing;

  return new;
end;
$function$
*/


-- ---------------------------------------------------------------------------
-- TRIGGER (1)
-- ---------------------------------------------------------------------------
/*
CREATE TRIGGER rider_map_capture_order_location
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.capture_rider_map_order_location_snapshot()
*/


-- ---------------------------------------------------------------------------
-- DEPENDENCIAS QUE CONSUME DE public.orders
-- ---------------------------------------------------------------------------
-- delivery_latitude, delivery_longitude, delivery_address_source,
-- delivery_geolocation_accuracy
--
-- Estas columnas provienen del historial de migraciones de ESTE repositorio y
-- están presentes en staging. La migración remota sólo las lee.
-- ============================================================================
