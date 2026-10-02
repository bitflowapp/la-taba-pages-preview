-- Rollback de 20261001216000: retira la regla que impide a un comercio verificado
-- encender el delivery sin cobertura.
--
-- Qué vuelve a quedar abierto:
--   · un comercio verificado sólo con retiro vuelve a poder encender el delivery sin
--     zonas ni cobertura exigida, por `set_business_fulfillment` o con un PATCH directo
--     de `delivery_enabled`, y entregar a cualquier dirección con la tarifa plana.
--
-- Qué NO hace:
--   · no toca ninguna fila de `businesses` ni de `delivery_zones`;
--   · no apaga el delivery de nadie.
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001216000', 0)
);

drop trigger if exists businesses_verified_delivery_needs_coverage on public.businesses;
drop function if exists public.guard_verified_business_delivery_coverage();

commit;
