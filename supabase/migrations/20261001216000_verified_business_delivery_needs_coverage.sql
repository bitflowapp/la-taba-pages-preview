-- TABA · UN COMERCIO VERIFICADO NO ENCIENDE EL DELIVERY SIN COBERTURA
--
-- 20261001215000 hizo que la plataforma no verifique un comercio con delivery y sin
-- cobertura exigida, y 20261001214000 que un comercio verificado no pueda apagar esa
-- exigencia. Quedaba una puerta, encontrada por la revisión de ese paquete:
--
--   un comercio verificado SÓLO CON RETIRO (las zonas no se le exigieron) encendía
--   después el delivery, por `set_business_fulfillment` o con un PATCH directo de
--   `delivery_enabled` —el dueño y el encargado tienen ese permiso por columna—, y
--   desde ese momento entregaba a cualquier dirección con la tarifa plana.
--
-- La preparación de apertura lo mostraba (`verification_blockers`: DELIVERY_COVERAGE)
-- pero nada lo impedía.
--
-- QUÉ CAMBIA
--
--   Un trigger sobre `businesses`: pasar `delivery_enabled` de apagado a encendido con
--   `ordering_verified` verdadero exige lo mismo que exige la verificación para un
--   comercio con delivery:
--     · la cobertura exigida (`delivery_zone_enforced`);
--     · al menos una zona activa con un envío efectivo (el de la zona o el del comercio);
--     · si hay un tope de distancia, el punto del local verificado por una persona.
--   Es un trigger y no un cambio en la RPC para cubrir las dos puertas con una regla.
--
--   El rechazo usa el mismo código que los otros rechazos de `set_business_fulfillment`
--   (22023, que la API contesta como 400 con el mensaje) y lleva DELIVERY_COVERAGE en
--   el detalle, que es el código con el que la verificación nombra lo mismo.
--
-- QUÉ NO CAMBIA
--
--   · Un comercio sin verificar enciende y apaga el delivery como siempre: lo frena la
--     verificación.
--   · Un comercio verificado que YA tiene el delivery encendido no se toca: esta
--     migración no escribe ninguna fila ni revoca nada. La regla lo alcanza recién si
--     apaga el delivery y lo quiere volver a encender.
--   · Apagar el delivery siempre se puede.
--   · La plataforma tampoco lo saltea con su clave: para operar sin reglas se revoca la
--     verificación (`platform_revoke_business_ordering`), como con las exigencias.
--
-- ROLLBACK: docs/migrations/rollback/20261001216000_verified_business_delivery_needs_coverage.rollback.sql

create or replace function public.guard_verified_business_delivery_coverage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_missing text;
begin
  if not coalesce(new.delivery_zone_enforced, false) then
    v_missing := 'la cobertura no esta exigida';
  elsif not exists (
    select 1
      from public.delivery_zones z
     where z.business_id = new.id
       and z.is_active
       and coalesce(z.delivery_fee, new.delivery_fee) is not null
  ) then
    v_missing := 'no hay una zona de entrega activa con su costo de envio';
  elsif new.delivery_max_radius_meters is not null and not exists (
    select 1
      from private.rider_map_business_locations l
     where l.business_id = new.id
       and l.human_verified
       and l.latitude is not null
       and l.longitude is not null
  ) then
    v_missing := 'hay un tope de distancia y el punto del local no esta verificado';
  end if;

  if v_missing is not null then
    raise exception 'Para encender el delivery en un comercio con los pedidos online habilitados primero cargá una zona de entrega activa y exigí la cobertura.'
      using errcode = '22023',
            detail = 'DELIVERY_COVERAGE: ' || v_missing,
            hint = 'cargar la zona y encender la exigencia de cobertura en Horarios y cobertura; despues encender el delivery';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_verified_business_delivery_coverage() from public, anon, authenticated, service_role;

comment on function public.guard_verified_business_delivery_coverage() is
  'Con ordering_verified verdadero, delivery_enabled no pasa de apagado a encendido sin cobertura exigida, una zona activa con envio y, si hay tope de distancia, el punto del local verificado.';

-- Compara columnas, no `UPDATE OF`: también frena un valor que otro trigger BEFORE
-- haya cambiado en el camino.
drop trigger if exists businesses_verified_delivery_needs_coverage on public.businesses;
create trigger businesses_verified_delivery_needs_coverage
  before update on public.businesses
  for each row
  when (new.ordering_verified and new.delivery_enabled and old.delivery_enabled is not true)
  execute function public.guard_verified_business_delivery_coverage();
