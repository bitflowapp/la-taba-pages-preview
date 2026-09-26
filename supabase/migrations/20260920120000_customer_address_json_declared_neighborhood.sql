-- Devuelve el barrio declarado que `upsert_current_customer_address` ya
-- persiste desde 20260812240000. Sin esta clave, guardar desde Perfil funciona
-- en la tabla pero la respuesta inmediata (y toda carga posterior del perfil)
-- pierde el barrio; el checkout termina enviando una dirección fuera de zona.
--
-- Es un cambio aditivo del contrato JSON. Las direcciones históricas devuelven
-- `null` y conservan exactamente el comportamiento anterior.

create or replace function public.customer_address_json(p_address public.customer_addresses)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', p_address.id,
    'label', p_address.label,
    'formattedAddress', p_address.formatted_address,
    'street', p_address.street,
    'streetNumber', p_address.street_number,
    'floor', p_address.floor,
    'apartment', p_address.apartment,
    'reference', p_address.reference,
    'city', p_address.city,
    'neighborhood', p_address.neighborhood,
    'province', p_address.province,
    'postalCode', p_address.postal_code,
    'latitude', p_address.latitude,
    'longitude', p_address.longitude,
    'geolocationAccuracy', p_address.geolocation_accuracy,
    'source', p_address.source,
    'locationSource', p_address.location_source,
    'locationConfirmedAt', p_address.location_confirmed_at,
    'locationConfirmedAddress', p_address.location_confirmed_address,
    'isDefault', p_address.is_default,
    'lastUsedAt', p_address.last_used_at,
    'createdAt', p_address.created_at,
    'updatedAt', p_address.updated_at
  )
$$;

comment on function public.customer_address_json(public.customer_addresses) is
  'Proyección segura de una dirección del cliente, incluido el barrio declarado que usa la resolución autoritativa de cobertura.';
