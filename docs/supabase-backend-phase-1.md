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

El anon key de Supabase no es secreto, pero no se hardcodea en el repo.

## Creacion transaccional de pedidos (hardening)

La migracion `20260531040000_la_taba_phase1_hardening.sql` agrega la funcion
`create_order_with_items(payload jsonb)`:

- inserta `order`, `order_items` y el evento inicial en **una sola transaccion**
  (si algo falla, no queda pedido parcial);
- corre como `security definer` con validaciones minimas server-side
  (`business_id` valido, items no vacios, `total >= 0`, status y `fulfillment_type`
  permitidos);
- devuelve el pedido completo con sus items.

El adapter (`supabase_order_repository.js`) crea pedidos llamando a
`POST /rest/v1/rpc/create_order_with_items`. Si la funcion no existe (migracion
sin aplicar), el adapter devuelve un diagnostico claro y **no simula un exito
falso**. La UI no queda rota.

## Seguridad fase 1 (DEMO / PILOTO, no produccion)

Con el hardening:

- la **creacion** de pedidos/items ya **no** es un INSERT anonimo directo: se
  quitaron las policies `phase1 public create orders` y
  `phase1 public create order items`, y la unica via es la RPC validada;
- las policies de **lectura** y de **update de estado** **siguen abiertas a
  `anon` a proposito**, porque la Fase 1 todavia no tiene auth. Estan comentadas
  en el SQL como `DEMO/PILOTO`.

Esto sirve para **piloto controlado**, NO para operacion comercial abierta. No
usar con datos personales sensibles ni con varios comercios en el mismo proyecto
sin endurecer antes.

### Que falta para produccion real (Fase 2)

- **auth** real por comercio/equipo (Supabase Auth);
- **roles** separados: cliente, negocio, rider;
- **policies por `business_id`** (cada negocio ve solo lo suyo) en lectura y escritura;
- **validacion server-side completa** de transiciones de estado (en RPC/backend,
  no confiando en el cliente);
- backend/RPC cerrado para mutaciones sensibles; no exponer `anon` para esas operaciones.

## Aplicar migracion

Con Supabase CLI configurado:

```bash
supabase db push
```

O pegar el SQL de **ambas** migraciones (en orden) en el SQL editor de Supabase:

1. `20260531030000_la_taba_phase1_orders.sql` (tablas, indices, RLS base, seed).
2. `20260531040000_la_taba_phase1_hardening.sql` (RPC transaccional + endurecimiento RLS).

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
