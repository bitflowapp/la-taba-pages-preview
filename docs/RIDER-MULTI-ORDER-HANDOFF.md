# TABA2 · Rider multi-pedido — informe de cierre

Evolución aislada. **No** forma parte de la Production Candidate.
Sin push, sin merge, sin staging, sin producción, sin MP PROD.

---

## TOPOLOGY

Dos repos distintos, dos ramas, dos worktrees.

| | rama | base | worktree |
|---|---|---|---|
| Backend + Panel | `feature/taba2-rider-multi-order-backend` | `release/taba2-production-candidate @ 317bbe9` | `D:\1212\la-taba2-rider-multi-order-backend` |
| Rider Android | `feature/taba2-rider-multi-order` | `feature/taba2-rider-pilot-integration @ 894267a` | `D:\1212\worktrees\taba2-rider-multi-order` |

Repo web: `C:\Users\marco\dev\la-taba-pages-preview\.git`.
Repo Rider: `D:\1212\la-taba-rider-android\.git` (sin remoto).

## CURRENT SINGLE-ORDER ROOT CAUSE

No estaba en un solo lugar; estaba en cinco, y **sólo uno era una regla de
servidor**:

1. **SQL, el único límite duro** — `claim_delivery_order` devolvía
   `active_delivery_exists`. Vive en el camino de toma libre de cola, que la RC
   del piloto apagó con `manualAssignmentOnly`.
2. **SQL, el camino que el piloto sí usa** — `assign_order_rider` **no contaba
   nada**. El Panel ya podía asignarle cuatro pedidos al mismo Rider.
3. **SQL, la causa raíz real** — `get_active_rider_delivery()` termina en
   `limit 1`. El Rider veía un pedido porque la RPC devolvía un pedido. Los
   otros existían, contaban para la caja y para el tracking del cliente, y la
   app no tenía forma de nombrarlos. El `limit 1` no protegía capacidad: la
   dejaba sin auditar.
4. **Dart** — `OrdersViewState.assigned` era un `Order?`;
   `claimAvailableOrder` cortaba con `orders_rider_already_assigned`;
   `RiderHomePage` era `assigned == null ? mapa : detalle`.
5. **Kotlin** — `DeliveryServiceCoordinator` guarda UN `ActiveDeliveryMetadata`
   y `beginDeliveryStart` tira `delivery_already_active`.

## ARCHITECTURE

**OPTION A elegida**: la oferta es una fila propia y el pedido no nombra al
Rider hasta que acepta. El razonamiento completo, con la OPTION B descartada,
está en `docs/RIDER-MULTI-ORDER-DECISION.md`.

El decisor fue la privacidad. En este esquema `assigned_rider_user_id` es lo que
abre `can_access_order` (RLS de orders/order_items/order_events),
`is_assigned_rider` (RLS de rider_locations), `rider_active_delivery_payload` y
las once RPC del Rider. La OPTION B ponía el rider en el pedido antes de que
aceptara, y eso lo hacía pasar todas esas compuertas de golpe: habría que
agregarle `and status <> 'offered'` a cada una, y **una sola omisión es una fuga
de datos del cliente**.

## BACKEND

Dos migraciones, ambas locales.

**`20260815010000_rider_active_order_capacity.sql`**
- `rider_max_active_orders()` → 3, una sola fuente de verdad.
- `rider_active_order_statuses()` → assigned/picked_up/on_the_way/arrived.
- `count_rider_active_orders(business, rider, excluding)` → **derivada** de
  `public.orders`. No hay columna contador, así que no hay drift.
- `lock_rider_capacity(rider)` → advisory lock **por Rider**.
- `enforce_rider_active_order_capacity()` + trigger en `public.orders`.
- `claim_delivery_order` y `assign_order_rider` reescritas con la cuenta nueva.

**`20260815020000_rider_order_offers.sql`**
- tabla `public.rider_order_offers` (RLS activa, **cero policies**, cero grants).
- `rider_offer_payload(offer)` → proyección minimizada.
- `offer_order_to_rider(...)` / `withdraw_rider_order_offer(offer)` — Panel.
- `accept_rider_order_offer(...)` / `reject_rider_order_offer(...)` — Rider.
- `get_rider_delivery_board()` — UNA lectura para toda la pantalla.
- `publish_rider_location_fanout(...)` — una muestra, N pedidos.
- `list_rider_order_offers(business)`; `list_active_business_riders` gana
  capacidad sin mover sus dos primeras columnas.

## CAPACITY

Dos capas, y la segunda es la que vale:

1. **Lock por Rider**, tomado antes de contar y antes de bloquear filas.
   La lección de auditar `226bca2`: allí el lock es por **job**, así que con
   máximo 3 y dos ofertas simultáneas al mismo Rider los dos jobs cuentan 2 y
   los dos escriben. Sería 4/3.
2. **Trigger en `public.orders`.** Recuenta cuando una fila entra al conjunto
   activo con rider. Cubre accept, `assign_order_rider`, `claim_delivery_order`,
   `release_or_reassign_delivery` **y un UPDATE crudo**. La capacidad no la
   garantiza una función: la garantiza la tabla.

## ACCEPT / REJECT

`accept_rider_order_offer(offer_id, expected_version, idempotency_key)`
comprueba, en este orden y todo server-side: sesión por la compuerta de
identidad · la oferta es suya · sigue `pending` · versión vigente (CAS) ·
capacidad recontada bajo lock · el pedido sigue `ready` y sin rider · revisión
del pedido igual a la que se ofreció. El `UPDATE ... where revision = … and
assigned_rider_user_id is null and status = 'ready'` es el CAS final.

Una oferta ajena responde `P0002`, igual que una inexistente: a quien no es su
destinatario no se le confirma que existe.

`reject_rider_order_offer(...)` es terminal para ese Rider. El pedido **nunca se
movió**, así que no hay nada que revertir: sigue `ready` y el Panel puede
ofrecerlo a otro. No se auto-asigna a nadie. El motivo es opcional y, si viene,
es uno de cinco códigos cerrados: la auditoría no puede contener datos
personales escritos por el Rider.

## PANEL

- El botón «Asignar» pasa a «Ofrecer» cuando el repositorio soporta ofertas
  (demo y sandbox siguen asignando directo).
- Bloque de estado por pedido: **Esperando respuesta · Aceptado · Rechazado ·
  Oferta retirada**, con «Retirar oferta» mientras está pendiente.
- Selector: «Marco · 2/3», y la opción se deshabilita en 3/3.
- Con una oferta viva el pedido no se vuelve a ofrecer hasta retirarla.
- `CACHE_NAME` → `la-taba-runtime-v67-rider-multi-order`, identidad re-firmada.

## RIDER

- Dominio explícito: `RiderDeliveryBoard { orders, offers, maxActiveOrders }`.
  `activeOrders` es una lista; `assigned` queda sólo como atajo del primero.
- Pantalla «Tus entregas 2/3» con las activas arriba y «Nuevas solicitudes»
  debajo. **Con un solo pedido y sin ofertas la pantalla no cambia**: el camino
  certificado queda igual.
- Cada tarjeta abre su propio `OrderDetailPage`, con su propia llave.
- `RiderOfferSyncState`: sin confirmación del servidor la oferta queda
  `pendingSync` y la app **no** se adjudica el pedido.
- Clave de operación derivada de (oferta, versión): dos taps son un replay.

## GPS

**Un Rider, una ubicación.** Un servicio de primer plano, un sampler, un actor,
una cola — igual que antes. Lo que cambia es el destino:
`publishToAllActive` llama a `publish_rider_location_fanout`, que reparte la
muestra a los pedidos publicables. Cada pedido conserva **su propia fila** en
`rider_locations`, que es lo que sostiene el aislamiento del cliente.

El reparto no relaja una sola validación: delega en
`publish_rider_location_receipt`, que sigue verificando asignación, estado,
revisión, precisión, salto imposible y throttle **por pedido**. Medido: con dos
pedidos publicables y una muestra a menos de 5 s de la anterior, uno entra y el
otro devuelve `throttled`, y el recibo lo dice pedido por pedido.

`reconcileWithBackend(List<AssignedOrderDto>)` elige un **ancla** —el más
avanzado, con preferencia por el que ya estaba— que sostiene el servicio. El
ancla no decide quién recibe la muestra; decide quién manda a seguir corriendo.

## CUSTOMER PRIVACY

Evidencia en `rider_multi_order_isolation_test.sql` (38 aserciones) y
`rider_multi_order_security_test.sql` (27):

- cliente A con su token ve A y **null** para B y C;
- el DTO de A no contiene el código, el id ni la dirección de B ni de C;
- cliente B ve la posición del mismo rider, porque su pedido la habilita;
- cliente C, todavía `assigned`, no ve posición;
- antes de aceptar, el Rider **no puede leer el pedido**: RLS devuelve 0 filas,
  y la tabla de ofertas ni siquiera se planifica (42501, sin grants);
- la proyección de la oferta no contiene teléfono, calle, notas, nombre ni
  referencia — verificado sobre el texto completo del payload, no campo por
  campo, para que un campo nuevo con PII rompa la prueba.

## PAYMENTS

Arquitectura de pagos **sin tocar**. Probado con A efectivo / B digital /
C efectivo y totales distintos: los tres totales siguen siendo tres números
distintos, B conserva su total y su método, y entregar A no toca el pago de
B ni el de C.

## MIGRATIONS

```
supabase/migrations/20260815010000_rider_active_order_capacity.sql
supabase/migrations/20260815020000_rider_order_offers.sql
```
**Local only.** No aplicadas a staging ni a producción. Reversión documentada en
`docs/migrations/rollback/2026081501*.rollback.sql` y `…02*.rollback.sql`
(aplicar el 02 primero). Reconstrucción desde cero verificada: **100 migraciones
en ~15 s** sobre una base efímera dentro del contenedor local.

## PGTAP

| suite | aserciones |
|---|---|
| `rider_multi_order_capacity_test.sql` | 27 |
| `rider_multi_order_offer_test.sql` | 32 |
| `rider_multi_order_security_test.sql` | 27 |
| `rider_multi_order_isolation_test.sql` | 38 |
| **total** | **124**, 0 fallando |

Arnés: `scripts/run-rider-multi-order-db.mjs` (exige `TABA_LOCAL_RIDER_DB=1`).

## CONCURRENCY

`scripts/run-rider-multi-order-concurrency.mjs`, conexiones reales:

- **8 aceptaciones simultáneas sobre un Rider en 0/3 → exactamente 3 aceptadas,
  5 `at_capacity`, 0 errores.** Nunca 4/3.
- **Dos operadores** asignando pedidos distintos al mismo Rider en 2/3 → uno
  entra, al otro lo frena la capacidad. 3/3.
- 11 comprobaciones, 0 fallas.

## BOLA

Rider ajeno → `P0002` · offer_id inventado → `P0002` · staff de otro comercio →
`42501` · rider_user_id adulterado → `42501` · sesión revocada → `42501` ·
token sin sesión registrada → `42501` · sin token → `42501` · `anon` sin execute
sobre accept y offer · tabla de ofertas con RLS y **cero policies**.

## TESTS

| suite | resultado |
|---|---|
| pgTAP local (4 suites) | **124 / 124** |
| concurrencia (conexiones reales) | **11 / 11** |
| web (`npm test`) | **1578 / 1578** |
| Rider Dart (`flutter test`) | **406 / 406** (+15 nuevas) |

## VISUAL

`D:\1212\artifacts\taba2-rider-multi-order\screenshots`, viewport 432×960 del
Moto G15: sin entregas · 1 · 2 · 3 · solicitud pendiente · 2 + solicitud ·
capacidad llena · estados distintos · aceptación sin confirmar · después del
rechazo.

## P0

Ninguno abierto en el código de esta rama.

## P1

1. **El gate físico no se corrió.** El Moto G15 estaba tomado por otra sesión.
   Plan completo en `MULTI-ORDER-GATE-FISICO.md` del repo Rider.
2. **No hay backend con estas migraciones.** Correr el gate exige antes una
   decisión humana sobre dónde aplicarlas: no están en staging y no van a ir sin
   que alguien lo decida.
3. **`get_active_rider_delivery()` sigue devolviendo uno.** Es deliberado —una
   app instalada la sigue llamando— pero queda como contrato duplicado que
   alguien va a tener que retirar cuando el board sea el único cliente.

## P2

1. La expiración automática de ofertas no existe: una oferta pendiente vive
   hasta que alguien responde o el operador la retira. Es coherente con «no hay
   auto-despacho», pero el Panel depende de que el operador mire.
2. El orden de las tarjetas es por etapa y después por antigüedad. No afirma
   cuál entregar primero, y eso es a propósito: no hay autoridad operacional que
   lo diga.

## PRODUCTION CANDIDATE

`release/taba2-production-candidate` = `317bbe9dc1c987c31ea4e0915784f881f61f24b6`
— **intacta**, verificado con `git rev-parse` al cierre.

## RIDER BASE

`feature/taba2-rider-pilot-integration` = `894267af0a274fab95d3a7237c3895ab0ac20a4c`
— **intacta**, verificado con `git rev-parse` al cierre.
`feature/taba2-automated-rider-dispatch` = `226bca2…` — leída, no tocada.

## RECOMMENDATION

**NEEDS MORE WORK**

El código está completo y medido: la capacidad es un invariante de tabla que
ocho aceptaciones simultáneas no pueden romper, la privacidad previa a la
aceptación se sostiene por autorización y no por una vista, y las cuatro suites
más las 1578 del Panel y las 406 del Rider están en verde.

Lo que falta no es código: **nada de esto se probó en el aparato**. Un contrato
multi-pedido que nunca vio tres entregas reales en un teléfono real no está
listo para un piloto, y el Moto estaba tomado. Sumado a que no existe todavía un
backend con estas migraciones aplicadas, declarar «ready for physical pilot»
sería firmar un gate que no se corrió.
