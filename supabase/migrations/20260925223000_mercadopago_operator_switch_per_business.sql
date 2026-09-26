-- ============================================================================
--  Mercado Pago por negocio: un interruptor de operador, atómico y auditado.
-- ============================================================================
--
--  El Panel sólo configura el entorno de PRUEBA (configure_mercadopago_settings
--  rechaza producción: «el pase a dinero real es una decisión aparte»). Esa
--  decisión no tenía mecanismo: habilitar Mercado Pago real para UN negocio, o
--  apagarlo de urgencia, quedaba en manos de un UPDATE escrito a mano.
--
--  operator_set_mercadopago_for_business(negocio, entorno, encendido, app, revisión)
--
--    APAGAR (rollback): sólo enabled=false. La conexión del vendedor, su
--      credencial sellada y su generación, los pagos, pedidos y reembolsos
--      quedan intactos. El checkout deja de ofrecerlo en el acto
--      (get_mercadopago_checkout_availability) y el cobro manual sigue. Volver a
--      encender no exige reconectar la cuenta.
--    ENCENDER (cutover acotado): exige una conexión CONECTADA del mismo entorno,
--      con credencial, de la aplicación esperada; copia su cuenta como
--      collector/application. En producción exige además la confirmación
--      explícita de la revisión productiva. Toca sólo la fila de ese negocio.
--
--  Cada cambio deja una fila en business_config_audit (scope 'payments',
--  actor_kind 'service') con el antes y el después: encendido, entorno y estado
--  de revisión. Nunca la cuenta del vendedor ni una credencial.
--
--  Sólo service_role: la llama la herramienta del operador
--  (scripts/mercadopago/cobro-negocio.mjs), nunca el navegador.
--  Rollback: docs/migrations/rollback/20260925223000_mercadopago_operator_switch_per_business.rollback.sql
-- ============================================================================

alter table public.business_config_audit drop constraint if exists business_config_audit_scope_check;
alter table public.business_config_audit add constraint business_config_audit_scope_check check (scope in (
  'hours', 'exception', 'zone', 'delivery_pricing', 'enforcement', 'permission', 'payments'
));

create or replace function public.operator_set_mercadopago_for_business(
  p_business_id uuid,
  p_environment text,
  p_enabled boolean,
  p_expected_application_id text,
  p_production_review_approved boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $operator_set_mercadopago_for_business$
declare
  v_before public.business_payment_settings%rowtype;
  v_after public.business_payment_settings%rowtype;
  v_status text;
  v_seller text;
  v_application text;
  v_has_credential boolean;
begin
  if p_environment is null or p_environment not in ('test', 'production') then
    raise exception 'entorno inválido' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'falta indicar encendido o apagado' using errcode = '22023';
  end if;
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;
  select * into v_before from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago' for update;

  if not p_enabled then
    if v_before.id is null or not v_before.enabled then
      return jsonb_build_object('ok', true, 'changed', false, 'enabled', false,
        'environment', v_before.environment, 'offered', false);
    end if;
    update public.business_payment_settings set enabled = false, updated_at = clock_timestamp()
     where id = v_before.id
    returning * into v_after;
  else
    select c.status, c.seller_id, c.application_id, c.protected_tokens is not null
      into v_status, v_seller, v_application, v_has_credential
      from public.mp_seller_connections c
     where c.business_id = p_business_id and c.environment = p_environment
     for update;
    if not found or v_status <> 'connected' or not v_has_credential
      or nullif(btrim(coalesce(v_seller, '')), '') is null then
      raise exception 'la cuenta de Mercado Pago del negocio no está conectada en %', p_environment
        using errcode = 'P0001';
    end if;
    if v_application is distinct from nullif(btrim(coalesce(p_expected_application_id, '')), '') then
      raise exception 'la conexión pertenece a otra aplicación' using errcode = 'P0001';
    end if;
    if p_environment = 'production' and not coalesce(p_production_review_approved, false) then
      raise exception 'cobro real sin revisión productiva confirmada' using errcode = 'P0001';
    end if;
    insert into public.business_payment_settings(
      business_id, provider, environment, checkout_mode, currency, reserve_stock,
      collector_id, application_id, production_review_status, enabled, configured_at, verified_at
    ) values (
      p_business_id, 'mercadopago', p_environment, 'checkout_pro', 'ARS', true,
      v_seller, v_application,
      case when p_environment = 'production' then 'approved' else 'not_requested' end,
      true, clock_timestamp(), clock_timestamp()
    )
    on conflict (business_id, provider) do update set
      environment = excluded.environment,
      reserve_stock = true,
      collector_id = excluded.collector_id,
      application_id = excluded.application_id,
      production_review_status = case
        when excluded.environment = 'production' then 'approved'
        else business_payment_settings.production_review_status
      end,
      enabled = true,
      configured_at = coalesce(business_payment_settings.configured_at, clock_timestamp()),
      verified_at = clock_timestamp(),
      updated_at = clock_timestamp()
    returning * into v_after;
  end if;

  insert into public.business_config_audit(business_id, scope, action, actor_kind, before, after)
  values (
    p_business_id, 'payments', case when p_enabled then 'enabled' else 'disabled' end, 'service',
    case when v_before.id is null then null else jsonb_build_object(
      'provider', 'mercadopago', 'enabled', v_before.enabled, 'environment', v_before.environment,
      'production_review_status', v_before.production_review_status) end,
    jsonb_build_object(
      'provider', 'mercadopago', 'enabled', v_after.enabled, 'environment', v_after.environment,
      'production_review_status', v_after.production_review_status)
  );

  return jsonb_build_object(
    'ok', true, 'changed', true, 'enabled', v_after.enabled, 'environment', v_after.environment,
    'offered', coalesce((public.get_mercadopago_checkout_availability(p_business_id)->>'available')::boolean, false)
  );
end;
$operator_set_mercadopago_for_business$;

revoke all on function public.operator_set_mercadopago_for_business(uuid, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.operator_set_mercadopago_for_business(uuid, text, boolean, text, boolean) to service_role;

comment on function public.operator_set_mercadopago_for_business(uuid, text, boolean, text, boolean) is
  'Interruptor de operador de Mercado Pago para UN negocio. Apagar = rollback que preserva conexión e historia; encender exige vendedor conectado de la aplicación esperada y, en producción, revisión confirmada. Auditado en business_config_audit.';
