# La Taba - production data foundation

Esta fase separa la demo actual de una base lista para persistencia real sin cambiar el flujo comercial visible.

## Diagnostico

- `state.js` es hoy el store unico: sanitiza, persiste en `localStorage` y notifica renders.
- `orders.js` crea pedidos, descuenta stock, mueve estados y arma mensajes/tickets.
- `realtime.js` replica `orders` y `simulation` por BroadcastChannel/SSE relay en una room.
- `simulation.js` publica la ubicacion del rider como estado local sincronizable; GPS real usa `source: "gps"`.
- `business.js`, `delivery.js` y `app.js` consumen el estado demo directamente para renderizar.

Eso funciona para vender/probar, pero no escala a multiusuario real porque no hay fuente persistente autoritativa, control de concurrencia ni backend de pedidos.

## Modelo productivo

Se agregaron modelos puros en `js/core/domain.js`:

- `Order`
- `OrderItem`
- `Rider`
- `Business`
- `TrackingLocation`

Tambien se agrego `js/core/order-workflow.js` con estados canonicos:

`draft -> submitted -> accepted -> preparing -> ready -> assigned -> picked_up -> on_the_way -> arrived -> delivered`

La demo actual mantiene sus estados (`received`, `preparing`, `ready`, `on_the_way`, `arriving`, `delivered`, `cancelled`) y el dominio los proyecta a estados productivos.

## Repositorios

La UI puede pedir operaciones de pedidos por contrato:

- `createOrder(orderDraft)`
- `getActiveOrder()`
- `listOrders()`
- `updateOrderStatus(orderId, status)`
- `assignRider(orderId, riderId)`
- `updateRiderLocation(orderId, location)`
- `subscribeToOrder(orderId, callback)`
- `subscribeToBusinessOrders(callback)`

Adaptadores agregados:

- `demo_order_repository.js`: usa el estado/localStorage/relay actual y mantiene la demo.
- `realtime_order_repository.js`: expone el transporte demo cuando hay `?relay=`.
- `http_order_repository.js`: contrato REST liviano para conectar backend propio, Supabase Edge Functions, Firebase Functions o similar.
- `supabase_order_repository.js`: adapter fase 1 contra Supabase PostgREST, opt-in y sin secrets hardcodeados.
- `repository_factory.js`: selecciona demo por defecto, demo realtime con `?relay=`, o HTTP si se abre con `?data=production&api=https://...`.
- `storage_repository.js`: wrapper seguro para storage namespaced.

## Modo demo vs produccion

Por defecto todo sigue en demo:

```text
https://bitflowapp.github.io/la-taba-pages-preview/
```

Demo realtime:

```text
?relay=https://URL_TUNEL&room=demo-comercial
```

Backend futuro:

```text
?data=production&api=https://api.tu-dominio.com
```

Supabase fase 1:

```text
?data=supabase&supabaseUrl=https://PROJECT.supabase.co&supabaseAnonKey=ANON_KEY
```

Si faltan credenciales de backend, la app cae a demo para no romper GitHub Pages.

## Contrato HTTP esperado

Un backend puede implementar:

- `POST /orders`
- `GET /orders`
- `GET /orders/active`
- `PATCH /orders/:id/status`
- `PATCH /orders/:id/rider`
- `POST /orders/:id/location`

Las respuestas pueden devolver `{ order }`, `{ data }` o una lista en `{ orders }`.

## Regla de release

La demo publica en GitHub Pages no depende de backend. La fundacion productiva queda lista para conectar persistencia real sin reescribir checkout, tracking, rider o consola.
