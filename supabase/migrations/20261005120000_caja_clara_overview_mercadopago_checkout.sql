-- ============================================================================
--  Caja Clara: «Vincular Mercado Pago» distingue cuenta vinculada de cobro
--  habilitado.
-- ============================================================================
--
--  pos_get_store_overview decía sólo el estado de la cuenta vendedora
--  (connected / needs_attention / not_connected). Con eso Caja Clara no podía
--  distinguir «la cuenta está vinculada» de «la tienda ya cobra online»: el
--  OAuth conectado NO habilita el cobro; lo habilita la plataforma
--  (business_payment_settings.enabled y, en producción, la revisión aprobada),
--  exactamente como lo dice el Panel con «Bloqueado».
--
--  Cambio ADITIVO del contrato caja-clara-taba/1: mercadopago gana
--  checkout_enabled (boolean). Caja Clara anterior lo ignora; Caja Clara nueva
--  tolera su ausencia. Sigue sin viajar ningún token, id de cuenta ni secreto.
--  checkout_enabled sólo es true con la cuenta conectada.
--
--  No escribe datos ni cambia permisos: create or replace conserva los grants
--  de 20260929120000.
-- ============================================================================

create or replace function public.pos_get_store_overview(p_business_id uuid, p_device_key_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_get_store_overview$
declare
  v_business public.businesses%rowtype;
  v_mp text;
  v_checkout_enabled boolean;
  v_hours jsonb;
  v_zones jsonb;
  v_riders jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform private.pos_require_terminal(p_business_id, p_device_key_hash);
  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  select case
      when exists (select 1 from public.mp_seller_connections m
                    where m.business_id = p_business_id and m.status = 'connected') then 'connected'
      when exists (select 1 from public.mp_seller_connections m
                    where m.business_id = p_business_id and m.status = 'requires_reauthorization') then 'needs_attention'
      else 'not_connected'
    end into v_mp;

  -- La habilitación de la plataforma, con la misma regla que el checkout
  -- (public_mercadopago_checkout_availability): vincular la cuenta NO la prende.
  select coalesce(bool_or(s.enabled
           and s.provider = 'mercadopago'
           and s.checkout_mode = 'checkout_pro'
           and s.currency = 'ARS'
           and (s.environment <> 'production' or s.production_review_status = 'approved')), false)
    into v_checkout_enabled
    from public.business_payment_settings s
   where s.business_id = p_business_id;

  select coalesce(jsonb_agg(jsonb_build_object('channel', h.channel, 'weekday', h.weekday,
           'opens_at', h.opens_at, 'closes_at', h.closes_at) order by h.channel, h.weekday, h.opens_at), '[]'::jsonb)
    into v_hours
    from public.business_service_hours h where h.business_id = p_business_id;

  select coalesce(jsonb_agg(jsonb_build_object('name', z.name, 'active', z.is_active,
           'delivery_fee', z.delivery_fee, 'minimum_subtotal', z.minimum_subtotal) order by z.priority, z.name), '[]'::jsonb)
    into v_zones
    from public.delivery_zones z where z.business_id = p_business_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'rider_user_id', bm.user_id,
           'name', left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                                 nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                                 'Rider ' || upper(right(bm.user_id::text, 8))), 80),
           'available', case when v_business.rider_presence_required
                             then public.rider_availability_effective(p_business_id, bm.user_id) else true end,
           'last_seen_at', ra.last_seen_at,
           'active_orders', public.count_rider_active_orders(p_business_id, bm.user_id, null))
           order by bm.user_id), '[]'::jsonb)
    into v_riders
    from public.business_members bm
    left join auth.users u on u.id = bm.user_id
    left join public.rider_availability ra on ra.business_id = bm.business_id and ra.rider_user_id = bm.user_id
   where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active;

  return jsonb_build_object(
    'contract', 'caja-clara-taba/1',
    'server_time', v_now,
    'business', jsonb_build_object(
      'id', v_business.id,
      'name', v_business.name,
      'status', v_business.status,
      'ordering_enabled', coalesce(v_business.ordering_enabled, false),
      'ordering_verified', coalesce(v_business.ordering_verified, false),
      'hours_enforced', coalesce(v_business.hours_enforced, false),
      'timezone', v_business.operating_timezone,
      'open_now', jsonb_build_object(
        'delivery', public.business_is_open(p_business_id, 'delivery', v_now),
        'pickup', public.business_is_open(p_business_id, 'pickup', v_now)),
      'next_open_at', jsonb_build_object(
        'delivery', public.business_next_open_at(p_business_id, 'delivery', v_now),
        'pickup', public.business_next_open_at(p_business_id, 'pickup', v_now))),
    'fulfillment', jsonb_build_object(
      'pickup_enabled', coalesce(v_business.pickup_enabled, false),
      'delivery_enabled', coalesce(v_business.delivery_enabled, false),
      'delivery_fee', v_business.delivery_fee,
      'minimum_delivery_subtotal', v_business.minimum_delivery_subtotal,
      'zones', v_zones),
    'hours', v_hours,
    'mercadopago', jsonb_build_object('state', v_mp, 'checkout_enabled', v_mp = 'connected' and v_checkout_enabled),
    'riders', jsonb_build_object('presence_required', coalesce(v_business.rider_presence_required, false), 'list', v_riders)
  );
end;
$pos_get_store_overview$;
