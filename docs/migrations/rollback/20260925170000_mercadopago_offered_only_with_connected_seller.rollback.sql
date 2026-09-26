-- Rollback compensatorio de 20260925170000_mercadopago_offered_only_with_connected_seller.
--
-- Vuelve a la regla anterior: la disponibilidad mira sólo la configuración del
-- comercio. No toca datos ni el historial de migraciones (forward-only: esto se
-- aplica como una migración nueva si alguna vez hace falta). La respuesta tiene
-- las mismas claves en las dos versiones, así que web vieja y web nueva
-- funcionan contra cualquiera de las dos.
--
-- Efecto conocido de volver atrás: un vendedor en `requires_reauthorization`
-- vuelve a verse como disponible en el storefront hasta que alguien apague la
-- configuración. El Edge Function de checkout sigue preguntando lo mismo, con
-- la regla que tenga la base.
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
      and (s.environment <> 'production' or s.production_review_status = 'approved'),
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
  where b.id = p_business_id;
$$;

revoke all on function public.get_mercadopago_checkout_availability(uuid) from public, anon;
grant execute on function public.get_mercadopago_checkout_availability(uuid) to authenticated, service_role;
