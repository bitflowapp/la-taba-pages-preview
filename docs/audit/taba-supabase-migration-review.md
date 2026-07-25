# Revisión de migraciones Supabase

Revisión estática preparada el 25 de julio de 2026. No equivale a una
aplicación real de migraciones.

## Orden

Las migraciones usan timestamp de 14 dígitos y se aplican en este orden:

1. `20260531030000_la_taba_phase1_orders.sql`
2. `20260531040000_la_taba_phase1_hardening.sql`
3. `20260601205707_operational_orders_v1.sql`
4. `20260725030000_taba_production_orders.sql`
5. `20260725050000_tracking_rider_privacy.sql`
6. `20260725060000_alcohol_reservations_abuse.sql`

Las fases tempranas contienen políticas piloto amplias; la migración productiva
las elimina y revoca grants directos antes de reconstruir el acceso. No se deben
aplicar sólo las primeras migraciones a una instancia expuesta.

## Controles reproducibles

`npm run migrations:validate` revisa nombres/orden duplicado, RLS de tablas
productivas, grants públicos excesivos, `SECURITY DEFINER` sin `search_path`,
dependencias SQL no portables, INSERT sin columnas y referencias de políticas
que el analizador no puede resolver. Los hallazgos heurísticos se informan como
warning/info y requieren revisión humana.

Riesgos cerrados en la cola final:

- tracking público ya no selecciona `orders`, ítems, eventos ni ubicaciones;
- DTO público explícito, token SHA-256, expiración y revocación;
- rider sin asignación usa una RPC minimizada;
- rider asignado pierde SELECT sensible fuera de estados activos;
- tablas productivas y de abuso tienen RLS;
- RPC privilegiadas fijan `search_path`;
- grants anon quedan limitados a catálogo verificado y RPC pública.

## Validación pendiente

No se ejecutó `supabase db reset` ni `db push`: falta Supabase CLI/Docker o un
proyecto staging autorizado. La validación real debe comprobar desde base vacía:

```sh
npx supabase start
npx supabase db reset
npx supabase test db
npx supabase db lint
```

Después, ejecutar el smoke productivo contra staging con guard explícito y
usuarios QA. No afirmar compatibilidad real hasta completar esa secuencia.
