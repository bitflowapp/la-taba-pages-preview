# Runbook · el primer pedido real de TABA

Para cuando la persiana esté abierta. **Claude no crea el pedido**: sale de
`https://la-taba.pages.dev` por interacción humana.

## 1 · Marco compra

Entrá al host, elegí un producto, agregalo al carrito y completá el checkout con
**«A coordinar con el local»**. No se cobra nada.

Cuando termines, decí **«pedido hecho»**.

## 2 · Claude identifica el pedido

Sin tocarlo. Verifica: que sea **uno solo**, el negocio canónico, el cliente
real, los ítems, el total, la dirección, el `payment_method`, el estado inicial y
los timestamps. Y que no haya duplicados.

## 3 · Aceptación del negocio

El contrato de aceptación pasa por la superficie del Panel con sesión de owner.
**Si Claude no puede ejecutarlo, para y te lo pide** — no suplanta tu sesión.
Si autorizás una acción administrativa, la auditoría dice `system`, nunca un
owner falso.

## 4 · Oferta al Rider

Por el contrato normal de ofertas. Nada de inserts a mano. La app del Rider en el
ZY32LHS6PS tiene que **recibir la oferta de verdad**.

## 5 · Marco acepta desde la app

**STOP humano.** El accept lo tocás vos en el teléfono, no se hace por SQL.

## 6 · GPS y mapa

Después del accept se certifica: binding pedido↔rider, sesión operativa, lat/lng
**frescas** con timestamps nuevos, sin coordenadas de fixture, sin staging. Y el
Rider tiene que **verse en el mapa** del tracking del Customer.

## 7 · Movimiento físico

Cuando esté todo, Claude te dice **«MOVETE UNOS METROS CON EL TELÉFONO»**.
Después se verifica la segunda posición real, el timestamp posterior, la
distancia razonable y que el marker se haya actualizado.

## 8 · La persiana queda abierta

Esto es un go-live, no una ventana de QA. `ordering_enabled` **queda en `true`**
salvo que aparezca un P0, un error de checkout, duplicación, error de pago, de
stock, de ciclo de vida, un leak, un problema serio de tracking — o que Marco
diga que se cierra.

## Si algo sale mal

* **cerrar la persiana**: `ordering_enabled = false`. El pedido que ya existe
  sigue su ciclo de vida igual;
* el estado de todo se lee con `npm run production:health` y
  `npm run production:auth:health`;
* nada de esto necesita una migración.
