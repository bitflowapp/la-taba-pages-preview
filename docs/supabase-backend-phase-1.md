# La Taba - Supabase backend phase 1

Esta fase deja un backend real opcional para pedidos persistentes sin cambiar el modo demo publicado en GitHub Pages.

## Que incluye

- Migracion SQL en `supabase/migrations/20260531030000_la_taba_phase1_orders.sql`.
- Tablas: `businesses`, `orders`, `order_items`, `riders`, `rider_locations`, `order_events`.
- RLS activado con policies publicas controladas para demo.
- Adapter `supabase_order_repository.js` usando PostgREST via `fetch`, sin `supabase-js`.
- Factory opt-in con `?data=supabase`.
- Espejo al estado local para que cliente, negocio, rider, tracking y mapa sigan usando la UI actual.

## Activacion

La pagina publica sigue en demo si se abre sin parametros:

```text
https://bitflowapp.github.io/la-taba-pages-preview/
```

Para probar Supabase:

```text
https://bitflowapp.github.io/la-taba-pages-preview/?data=supabase&supabaseUrl=https://PROJECT.supabase.co&supabaseAnonKey=ANON_KEY&businessId=00000000-0000-4000-8000-000000000001
```

`businessId` es opcional si se usa el negocio seed de la migracion.

## Flujo soportado

- Cliente crea un pedido persistente.
- El pedido y sus items se guardan en Supabase.
- La consola del negocio lee pedidos persistentes por polling.
- Negocio/rider pueden avanzar estado y eso se persiste.
- GPS real/simulacion pueden escribir `rider_locations`.
- Tracking usa el estado local espejado para conservar mapa, fallback y metadata actuales.

## Seguridad fase 1

El anon key de Supabase no es secreto, pero no se hardcodea en el repo. Las policies permiten lectura/escritura controlada para demo publica. Esto sirve para piloto controlado, no para operacion comercial abierta.

Antes de produccion real:

- agregar auth por comercio/equipo;
- restringir policies por `business_id`;
- validar transiciones en RPC o backend propio;
- mover creacion de pedidos a una funcion transaccional;
- separar roles cliente, negocio y rider.

## Aplicar migracion

Con Supabase CLI configurado:

```bash
supabase db push
```

O pegar el SQL de la migracion en el SQL editor del proyecto Supabase.

## QA rapido

1. Abrir la pagina con `?data=supabase&supabaseUrl=...&supabaseAnonKey=...`.
2. Crear pedido desde cliente.
3. Verificar en Supabase `orders` y `order_items`.
4. Abrir negocio con los mismos parametros.
5. Avanzar estado.
6. Abrir rider con los mismos parametros y `#rider`.
7. Activar simulacion o GPS real.
8. Verificar `rider_locations`.
9. Confirmar que la misma pagina sin parametros sigue en modo demo.
