-- Rollback de 20261001224000: retira la auditoría de la escritura directa sobre
-- `businesses` y el candado de la moneda, y devuelve
-- `audit_business_commercial_change` a su definición anterior, capturada del arnés
-- con las 159 migraciones previas aplicadas (pg_get_functiondef).
--
-- Qué vuelve a quedar abierto:
--   · habilitar el alcohol, cambiar los topes contra el abuso, el estado, la entrega,
--     el nombre, el teléfono o la dirección con un PATCH directo vuelve a no dejar
--     ninguna fila en `business_config_audit`;
--   · la moneda de un comercio verificado vuelve a poder cambiarse.
--
-- Qué NO hace:
--   · no borra ninguna fila de auditoría. Las que se escribieron con los ámbitos
--     `alcohol`, `abuse_limits` y `currency` quedan, y por eso el CHECK de ámbitos se
--     CONSERVA ampliado: es un superconjunto del anterior, la auditoría es historia y
--     achicarlo obligaría a borrarla (misma regla que el rollback de 20260928150000);
--   · no toca `businesses` ni sus permisos por columna.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001224000', 0)
);

drop trigger if exists businesses_lock_verified_currency on public.businesses;
drop function if exists public.guard_business_currency_code();

drop trigger if exists businesses_audit_direct_write on public.businesses;
drop function if exists public.audit_business_direct_write();

CREATE OR REPLACE FUNCTION public.audit_business_commercial_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_pricing_changed boolean;
  v_enforcement_changed boolean;
begin
  v_pricing_changed :=
    new.delivery_fee is distinct from old.delivery_fee
    or new.minimum_delivery_subtotal is distinct from old.minimum_delivery_subtotal
    or new.delivery_max_radius_meters is distinct from old.delivery_max_radius_meters;
  v_enforcement_changed :=
    new.hours_enforced is distinct from old.hours_enforced
    or new.delivery_zone_enforced is distinct from old.delivery_zone_enforced
    or new.alcohol_hours_enforced is distinct from old.alcohol_hours_enforced
    or new.operating_timezone is distinct from old.operating_timezone;

  if v_pricing_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'delivery_pricing', 'updated',
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'delivery_fee', old.delivery_fee,
        'minimum_delivery_subtotal', old.minimum_delivery_subtotal,
        'delivery_max_radius_meters', old.delivery_max_radius_meters),
      jsonb_build_object(
        'delivery_fee', new.delivery_fee,
        'minimum_delivery_subtotal', new.minimum_delivery_subtotal,
        'delivery_max_radius_meters', new.delivery_max_radius_meters)
    );
  end if;

  if v_enforcement_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'enforcement',
      case
        when (new.hours_enforced and not old.hours_enforced)
          or (new.delivery_zone_enforced and not old.delivery_zone_enforced)
          or (new.alcohol_hours_enforced and not old.alcohol_hours_enforced) then 'enabled'
        when (old.hours_enforced and not new.hours_enforced)
          or (old.delivery_zone_enforced and not new.delivery_zone_enforced)
          or (old.alcohol_hours_enforced and not new.alcohol_hours_enforced) then 'disabled'
        else 'updated'
      end,
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'hours_enforced', old.hours_enforced,
        'delivery_zone_enforced', old.delivery_zone_enforced,
        'alcohol_hours_enforced', old.alcohol_hours_enforced,
        'operating_timezone', old.operating_timezone),
      jsonb_build_object(
        'hours_enforced', new.hours_enforced,
        'delivery_zone_enforced', new.delivery_zone_enforced,
        'alcohol_hours_enforced', new.alcohol_hours_enforced,
        'operating_timezone', new.operating_timezone)
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.audit_business_commercial_change() from public, anon, authenticated;

commit;
