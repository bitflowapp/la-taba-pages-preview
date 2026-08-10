# Candidata operativa — el Panel puede operar el circuito certificado

Rama `integration/taba2-operational-frontend`, sobre `integration/taba2-customer-experience`
(11cd59d). Agrega al frontend moderno lo mínimo para operar el backend que ya está
certificado en staging, y nada más.

## Lo que se verificó antes de empezar

El encargo traía tres hashes. Los tres coincidían, pero se comprobó el grafo, no la lista:

| rama | HEAD | |
|---|---|---|
| `fix/taba2-order-intake-dispatch` | `59d8e03` | coincide |
| `integration/taba2-customer-experience` | `11cd59d` | coincide, **base elegida** |
| `feature/taba2-live-tracking-production-ux` | `73fdb4c` | coincide, y **ya es ancestro de 11cd59d** |

`merge-base(11cd59d, 59d8e03) = e59ac1c`. Son 15 commits contra 16, divergentes:
`59d8e03` **no** es ancestro de la candidata. El seguimiento final no había que
traerlo: ya estaba adentro entero.

## Por qué no se mergeó 59d8e03

De sus 15 commits, **uno solo toca frontend**: `a186d29`. El resto son las 5
migraciones, el worker de Mercado Pago, drills, pruebas SQL y documentación.
Mergear la rama entera habría traído al árbol migraciones que **ya están aplicadas
en staging** (62 → 67), volviendo a presentar como pendiente algo que ya corrió.

Se hizo una **rebanada por ruta** de `a186d29`, y se comprobó que fuera fiel:

- `git diff a186d29 -- <las 4 rutas>` → vacío: idéntico byte a byte.
- El delta contra `11cd59d` es exactamente `+10 / +32 / +35 / +22`, el mismo
  diffstat que `a186d29` declara para esas rutas.
- La candidata **nunca** tocó esos 4 archivos desde `e59ac1c`, así que no hubo
  conflicto que resolver. No fue un merge afortunado: no había solape.

## Las capacidades pedidas, una por una

| capacidad | dónde estaba | qué se hizo |
|---|---|---|
| `recover_paid_checkout_order` | RPC en staging + acción y repositorio en `a186d29` | traído, y **conectado** (ver abajo) |
| reconciliación sin `provider_payment_id` | migración `20260809200000`, ya aplicada | nada que traer: el frontend ya leía `can_reconcile` desde `e59ac1c` |
| `security_review_required` | **idéntico byte a byte** entre `59d8e03` y `11cd59d` | nada que traer |
| mensajes de stock insuficiente | repositorio en `a186d29` | traído, y **corregido** (ver abajo) |
| refund / recovery | refund ya existía en la base | sólo se sumó recovery |

Sobre la revisión de seguridad: el cierre de «destinos permitidos» **no es
frontend**. Es un trigger de base (`20260809220000`, ya desplegado) que sólo deja
salir de `security_review_required` hacia un conjunto cerrado de cinco estados:
`completed`, `approved_order_pending`, `refunded`, `partially_refunded`,
`charged_back`. El Panel no puede ampliarlo; lo que sí hace, y se verifica, es
ofrecer únicamente acciones que caen dentro de ese conjunto.

## Los dos defectos que traía la capacidad, medidos

`a186d29` shipeó la capacidad **partida en dos mitades que no se tocaban**. Las
suites verdes no lo veían porque cada mitad estaba probada por separado: el
unitario verificaba que la acción se *ofreciera*, el drill 80/80 verificaba la
RPC. Nadie probaba el click.

### 1. El botón iba a la operación equivocada, y avisaba que había salido bien

El Panel renderizaba `data-payment-action="recover-order"`, pero `runPaymentAction`
sólo desviaba `refund`, `diagnostic` y `refresh`; todo lo demás caía en la
reconciliación. Medido con una sonda antes de tocar nada:

```
[PROBE] ofrece "Armar el pedido de este cobro": true
[PROBE] renderiza data-payment-action="recover-order": true
[PROBE] llamadas registradas: [["reconcilePayment","p-9"]]
[PROBE] resultado: ok:true "Le pedimos el resultado a Mercado Pago.
                            En unos segundos se actualiza solo."
```

El operador apretaba «armar el pedido», el sistema consultaba a Mercado Pago y le
contestaba que todo bien. El pedido no se armaba nunca.

La mitad que sí llamaba a `recoverPaidCheckoutOrder` colgaba de
`[data-production-payment-recover]`, un atributo que **no aparece en ninguna
plantilla del árbol**: código inalcanzable.

### 2. Con cuatro faltantes, el mensaje de stock se perdía entero

`humanizeFailure` descarta cualquier mensaje de más de 240 caracteres y lo cambia
por un genérico. La enumeración de faltantes no tenía tope:

```
1 faltante  len=113  sobrevive
3 faltantes len=210  sobrevive
4 faltantes len=261  >>> se pierde, cae al genérico
5 faltantes len=310  >>> se pierde, cae al genérico
```

Con un carrito de bebidas cualquiera el operador recibía «No pudimos armar el
pedido de este cobro» y perdía justo el dato que necesita para decidir si devuelve
el dinero. `describeMissingStock` nombra los que entran en el presupuesto y dice
cuántos quedan afuera.

## Lo que se conserva

Contra `11cd59d`, esta candidata cambia **8 archivos**: 4 de producto (todos del
Panel/pagos), `sw.js` (una línea) y 3 de prueba. Todo lo demás está intacto,
verificado con `git diff --name-only`:

```
index.html · styles.css · styles/ · js/app.js · js/ui.js · js/cart.js
js/map/ · js/tracking/ · runtime-config.js · js/core/delivery-location.js · assets/
```

Y presente en el árbol, no sólo sin diff: `applyCameraMode` (follow/explore),
`rider_motion` importado por `maplibre_tracking_map.js`, `tracking_status`
importado por `map_view.js`, `cartItemIssue`/`setCartItemQuantity` en el carrito,
`DELIVERY_LOCATION_REQUIRED`, y el preload del hero en `index.html`.

`git diff 73fdb4c HEAD -- js/map/ js/tracking/` sale **vacío**: ni un byte del
seguimiento se tocó.

## Service Worker

`CACHE_NAME` v57-vidriera-y-seguimiento → **v58-panel-operativo**. Un solo bump.

Se bumpea porque dos archivos precacheados cambiaron y **su URL no lleva `?v`**:
`js/repositories/supabase_order_repository.js` y `js/production-operations.js`.
Lo único que invalida esa copia es el nombre de la caché. El fetch es
network-first, así que online no se nota; el bump es por el caso sin red, que es
justo donde el operador no puede verificar nada.

No se rotó ningún `?v` porque no cambió ninguna hoja, ni `index.html`, ni
`js/app.js`. La cadena sigue coherente, auditada sobre el árbol final:

```
CACHE_NAME         la-taba-runtime-v58-panel-operativo
shell styles.css   ?v=47   ·  precache ?v=47   OK
shell js/app.js    ?v=40   ·  precache ?v=40   OK
@imports           13 hojas · todas en ?v=47 · todas precacheadas
```

**Anotado, no corregido:** `js/business/*` no está en el precache —ninguno, ni
antes ni ahora—. El Panel vive del cacheo en runtime del propio fetch handler:
después de la primera visita con red queda disponible sin red. Meterlo al precache
le cobraría el panel entero a cada cliente que sólo viene a comprar.

**Sigue abierto, sin tocar:** el bloqueante `GITHUB_PAGES_MODULE_GRAPH_SIN_VERSION`
heredado de la candidata anterior. Es de cabeceras HTTP, no de esta integración.

## Gates, medidos sobre `d3c1426`

| gate | resultado |
|---|---|
| `npm run check` | verde — 4 gates, contrato de ubicación incluido |
| `npm test` | **1268/1268** · 39,6 s (base 1258 + 1 traído + 9 nuevos) |
| Playwright | **238/238** · 8,5 min · Chromium + WebKit móvil |
| Playwright sobre el árbol previo al spec focal | 230/230 · 8,3 min — **idéntico a la base**: la integración no movió el gate |

El Panel focal corre **en los dos motores**, 4 pruebas cada uno, en 320/360/390/432,
con cero desborde horizontal, cero errores de página y cero respuestas ≥400.

Tracking focal (`tracking-arriving`, `tracking-follow-mode`, `tracking-terminal-expiry`)
y catálogo focal (`taba2-unit-catalog`, `taba2-brand-home`, `taba2-commercial-p1-closure`)
siguen verdes sin tocarlos, incluida «la vuelta al rider entra en las cuatro
anchuras sin desbordar».

### Lo que la regresión demuestra

- el Panel **ve los cobros** — los tres, con importe y código de pedido;
- el rearmado **aparece sólo cuando corresponde**: una sola vez, en el cobro que
  el servidor habilitó. El tercer pago está en revisión de seguridad igual, pero
  sin la bandera y no la ofrece — prueba que no aparece por el *estado* sino por
  el permiso del servidor. El equipo no la ve, y si falsifica el evento tampoco
  la ejecuta;
- **no duplica**: la segunda vez contesta que ya estaba armado, y el doble click
  en vuelo manda una sola orden. La idempotencia real es del servidor; `busy`
  sólo cubre el doble click;
- **stock insuficiente da mensaje accionable**: qué falta y cuánto, en pantalla,
  con la devolución disponible como la salida que queda;
- **catálogo y tracking intactos**, por diff y por suite.

Las pruebas **tienen dientes**: desactivando el desvío de `recover-order`,
5 de las 9 unitarias fallan. Se comprobó, no se supone.

## Lo que NO se hizo

Sin staging, sin migraciones, sin redeploy de Edge, sin push, sin producción,
sin LT-0030. El árbol quedó limpio y ninguna base fue tocada: todo lo que se
midió acá corre contra un contexto de prueba en el navegador y contra el árbol.

**Queda pendiente**, y esta declaración no lo cubre: el circuito con base viva.
Lo que se certifica es que el Panel ahora **puede** operar el backend certificado
—que el botón existe, despacha la operación correcta, respeta el permiso y dice
la verdad cuando no puede—, no que se haya vuelto a recorrer punta a punta.
