-- Mercado Pago se ofrece sólo si el vendedor está conectado de verdad.
--
-- `get_mercadopago_checkout_availability` miraba la configuración del comercio
-- y no la conexión OAuth. Cuando Mercado Pago rechaza el token del vendedor
-- (`invalidateRejectedToken`) o un refresh ambiguo termina en
-- `requires_reauthorization`, la conexión deja de servir pero
-- `business_payment_settings.enabled` sigue en true: el cliente veía la opción,
-- el checkout reservaba stock y recién la preferencia contestaba
-- SELLER_REAUTHORIZATION_REQUIRED. Lo mismo con una fila de configuración
-- habilitada sin ninguna conexión (el negocio histórico de Staging).
--
-- Ahora la disponibilidad exige la misma conexión que después exige la
-- autoridad del pago (`validatePaymentAuthority`): conectada, con material
-- cifrado y del mismo vendedor y aplicación que la configuración. La respuesta
-- conserva exactamente las mismas claves; forward-only, sin datos que migrar.
create or replace function public.get_mercadopago_checkout_availability(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'available', coalesce(
      b.is_active
      and b.status = 'open'
      and b.ordering_enabled
      and b.ordering_verified
      and s.enabled
      and s.provider = 'mercadopago'
      and s.checkout_mode = 'checkout_pro'
      and s.currency = 'ARS'
      and (s.environment <> 'production' or s.production_review_status = 'approved')
      and c.business_id is not null,
      false
    ),
    'environment', s.environment,
    'checkout_mode', s.checkout_mode,
    'allow_offline_payment_methods', coalesce(s.allow_offline_payment_methods, false),
    'installments_limit', s.installments_limit
  )
  from public.businesses b
  left join public.business_payment_settings s
    on s.business_id = b.id
   and s.provider = 'mercadopago'
  left join public.mp_seller_connections c
    on c.business_id = b.id
   and c.environment = s.environment
   and c.status = 'connected'
   and c.protected_tokens is not null
   and c.seller_id = s.collector_id
   and c.application_id = s.application_id
  where b.id = p_business_id;
$$;

revoke all on function public.get_mercadopago_checkout_availability(uuid) from public, anon;
grant execute on function public.get_mercadopago_checkout_availability(uuid) to authenticated, service_role;
