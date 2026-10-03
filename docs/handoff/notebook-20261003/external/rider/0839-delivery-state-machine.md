# TABA2 Rider — máquina de estados de entrega

Extraída del código real de la app congelada en `95294d9`, no del texto visible.
Las fuentes `lib/` y `android/app/src/main/kotlin/` del repo de automatización
son **byte a byte idénticas** a las del worktree target, y `95294d9` es ancestro
de `9c80f98`, así que la instrumentación enlaza contra las mismas clases que
corren en el APK instalado.

Fuentes inspeccionadas:

- `lib/domain/orders/order_status.dart` — vocabulario de estados
- `lib/features/orders/presentation/order_detail_page.dart` — CTA por estado
- `lib/data/datasources/delivery_datasource.dart` — firma de cada llamada
- `lib/platform/rider_method_channel.dart` — nombres del canal
- `android/.../data/BackendContract.kt` — nombres RPC exactos
- `android/.../delivery/OfflineLocationQueue.kt` — cola offline
- `android/.../delivery/QueueDrainWorker.kt` — política de reintento
- `android/.../delivery/LocationPublisher.kt` — publicación y recibo
- `lib/domain/map/delivery_privacy.dart` — enmascarado y zona
- `lib/domain/map/order_map_data.dart` — punto dibujable por fase

---

## 1. Vocabulario de estados

`OrderStatus` declara 15 valores. Sólo estos participan del flujo del Rider:

| enum | wire | label |
|---|---|---|
| `ready` | `ready` | Disponible |
| `assigned` | `assigned` | Asignado |
| `pickedUp` | `picked_up` | Retirado |
| `onTheWay` | `on_the_way` | En camino |
| `arrived` | `arrived` | Llegó |
| `delivered` | `delivered` | Entregado |

`BackendContract.ASSIGNED_STATUSES = {assigned, picked_up, on_the_way, arrived}`
es el conjunto "en vuelo". `AVAILABLE_STATUS = ready`, `DELIVERY_MODE = delivery`.

`DeliveryServiceState` (Kotlin) es **otra cosa**: el estado del servicio de
seguimiento, no del pedido. Valores: `stopped, starting, running, fresh,
delayed, stale, noSignal, error`. `DeliveryStateMachine` no valida transiciones
— sólo asigna. La validación real vive en el backend vía `revision`.

## 2. Transiciones

| # | Estado previo | Acción | Estado posterior | CTA exacto | Llamada | Persistencia local | Persistencia remota | ¿Offline? | Checkpoint |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `ready` (sin asignar) | Aceptar | `assigned` | `Aceptar pedido` | `claim_delivery_order` | — | `orders.status`, `assigned_rider_user_id`, `revision++` | **No** | `CLAIM_AND_POSTCLAIM_PRIVACY` |
| 2 | `assigned` | Confirmar retiro | `picked_up` | `Confirmar retiro` | `mark_delivery_picked_up` | — | `orders.status`, `picked_up_at`, `revision++` | **No** | `PICKUP_AND_START` |
| 3 | `picked_up` | Iniciar recorrido | `on_the_way` | `Iniciar recorrido` | `start_rider_delivery` + `startDeliveryService` | `active_delivery.json` | `orders.status`, `revision++`, `rider_delivery_operations` | **No** | `PICKUP_AND_START` |
| 4 | `on_the_way` | (ciclo GPS) | `on_the_way` | — | `publish_rider_location_receipt` | cola en memoria | `rider_locations` (+`sequence`) | **Sí** | `OFFLINE_ACTION` |
| 5 | `on_the_way` | Llegué | `arrived` | `Llegué` | `mark_rider_arrived` | — | `orders.status`, `arrived_at`, `revision++` | **No** | `ARRIVAL_AND_CODE` |
| 6 | `arrived` | Revelar campo | `arrived` | `Ingresar código` | — (sólo foco+scroll) | — | — | n/a | `ARRIVAL_AND_CODE` |
| 7 | `arrived` + código de 4 dígitos | Confirmar entrega | `delivered` | `Confirmar entrega` | `confirm_delivery_code` | — | `orders.status`, `delivered_at`, `revision++`, `rider_delivery_operations`, stock | **No** | `TERMINAL_DELIVERY_ASSERT` |
| 8 | `delivered` + servicio activo | Detener | `delivered` | `Detener seguimiento técnico` | `stopDeliveryService` | limpia `active_delivery.json` | — | n/a | `TERMINAL_DELIVERY_ASSERT` |

El CTA es **único por estado**: `_primaryAction()` es un `switch` exhaustivo que
devuelve una sola acción. `arrived` es el único estado con dos CTA posibles, y
la bifurcación es local y determinista: `_codeIsComplete` = `^\d{4}$` sobre el
campo. Un estado sin CTA (`delivered` sin servicio activo) devuelve `null`.

Claves de widget estables: `detail-claim-action` para el claim,
`detail-delivery-action` para todo el resto. Sirven como ancla de assert, no de
localización: Accessibility no expone `ValueKey`.

## 3. Privacidad pre/post claim

Lo que el código hace de verdad, que no coincide del todo con la intuición:

**Pre-claim** (`available != null`, `_mapData` línea 274):

- `customerLocationIsApproximate: true` fuerza
  `deliveryDisplayPoint = coarsenToDeliveryZone(customerPoint)`: la coordenada
  se ajusta a una grilla de `0.005°` (≈550 m) y se dibuja con radio de 450 m.
  Dos pedidos de la misma manzana colapsan al mismo centro.
- Texto de entrega, en este orden: `'Zona <generalZone>'` si hay zona; si no,
  `maskAddressNumbers(exact)`; si no, `null`, y la parada muestra
  `'Zona de entrega disponible al aceptar'`.
- `maskAddressNumbers` reemplaza dígitos por `*` **conservando el primero de
  cada racha**: `Belgrano 1423` → `Belgrano 1***`. No agrega nada.
- Nota visible: `'Zona aproximada. La dirección exacta se muestra al aceptar.'`

**Post-claim** (`assigned != null`, línea 296):

- `customerLocationIsApproximate` queda en `false` → `deliveryDisplayPoint` es
  el punto exacto.
- Texto = `order.customerAddress`, o compuesto de
  `addressLabel, streetAddress, neighborhood`. **Exacto.**

**Matiz que hay que respetar en los asserts:** la dirección exacta aparece en el
mapa desde `assigned`, pero `_navigationAddress` (lo que se manda a una app
externa) sigue devolviendo la dirección de **retiro** mientras el estado es
`assigned`, y recién pasa a la del cliente desde `picked_up`. Son dos reglas
distintas y el smoke debe verificar las dos por separado.

## 4. Offline: qué está permitido de verdad

Inspeccionado, no elegido por conveniencia.

**Ninguna acción de entrega funciona sin red.** `confirm_delivery_code` con red
caída devuelve `messageKey = network_unavailable` y la UI dice
`'Sin conexión: todavía no se confirmó la entrega.'` (línea 670). Lo mismo para
retiro, inicio y llegada: son RPC directos sin cola.

**La única acción con tolerancia offline es la publicación de ubicación**
durante una entrega activa:

| aspecto | valor real |
|---|---|
| Implementación | `OfflineLocationQueue` |
| Naturaleza | **`ArrayDeque` en memoria de proceso**, no persistente |
| Capacidad | 32 items (`MAX_ITEMS`) |
| TTL | 3 minutos (`MAX_AGE_MILLIS`) |
| Deduplicación | descarta si el timestamp no avanza o si Δlat y Δlon < `1e-6` |
| Piso de publicación | 6 s (`PUBLISH_FLOOR_MILLIS`) |
| Backoff | 5 s ×2^n, tope 60 s |
| Clave de idempotencia | ninguna del lado cliente; el servidor devuelve `sequence` |

**Consecuencia dura para el diseño del smoke:** `EncryptedLocationQueueStore.kt`
es un stub de una línea (`// Encrypted GPS queue begins in the offline-queue
task.`). **No existe cola offline persistente.** Por lo tanto:

- "la cola sobrevive a un force-stop" **es falso** y el smoke no debe afirmarlo:
  matar el proceso descarta los samples encolados;
- "el relanzamiento no repite la acción" **es cierto**, pero por ausencia de
  persistencia, no por idempotencia;
- el TTL de 3 minutos acota la ventana offline: un corte de red más largo que
  eso vacía la cola por vencimiento, no por sincronización.

El smoke mide entonces lo que el producto **sí** garantiza: durante un corte
breve la acción se acepta localmente, encola, y al restaurar la red se aplica
remotamente **una sola vez**, sin duplicar filas en `rider_locations`.

## 5. Exactly-once: dónde se ancla

Tres mecanismos distintos, ninguno inventado:

1. **`operationId`** — lo llevan `start_rider_delivery`, `confirm_delivery_code`
   y `startDeliveryService`/`stopDeliveryService`. La tabla
   `rider_delivery_operations` es el libro de idempotencia.
2. **`revision`** — concurrencia optimista sobre `orders`. Un reintento con
   revisión vieja devuelve `ERROR_REVISION_CONFLICT = 40001`, que es
   exactamente cómo un segundo submit se vuelve no-op seguro.
3. **`sequence`** — `LocationPublicationReceipt` trae un número asignado por el
   servidor. Duplicar una publicación se ve como filas extra en
   `rider_locations`.

El verificador backend compara baseline y final sobre esas tres superficies, no
sobre lo que muestra la pantalla.

## 6. Código de entrega

- Formato: **exactamente 4 dígitos**, `RegExp(r'^\d{4}$')`.
- Campo: `TextField` con `obscureText: true`, `obscuringCharacter: '•'`,
  `maxLength: 4`, `FilteringTextInputFormatter.digitsOnly`,
  `keyboardType: number`, `textInputAction: done`.
- Contenedor: `Semantics(label: 'Confirmación de entrega')`, bloque titulado
  `'Código de entrega'`, texto de ayuda `'Ingresá el código de 4 dígitos.'`.
- Al ser `obscureText`, el nodo se publica con `isPassword=true`: mismo caso que
  el campo de contraseña del login, donde `ACTION_SET_TEXT` ya está probado.
- Respuestas de error con clave estable: `incorrect_code`,
  `temporarily_locked` (con `retryAfterSeconds`), y `network_unavailable`.
  `temporarily_locked` además **deshabilita el campo**, lo que da una señal
  observable de que el segundo intento no volvió a mutar.

## 7. GPS y frescura

`DeliveryServiceState` distingue `fresh`, `delayed`, `stale`, `noSignal`. El
badge de frescura sale de `lib/domain/map/location_freshness.dart` y del
`riderFix`, que sólo se dibuja cuando el servicio está activo
(`service.isActive`).

Para una corrida física con el teléfono quieto sobre el escritorio, la
afirmación honesta es que hay fix vivo y no que hubo desplazamiento. El smoke
declara `GPS_LIVE_STATIONARY_PASS` y nada más: no dibuja rutas, no calcula ETA y
no compara posiciones sucesivas como si fueran movimiento.

## 8. Mapa de fases del smoke

| Fase | Estado inicial exigido | Muta | Estado final exigido |
|---|---|---|---|
| `PREFLIGHT_AND_QUEUE` | sesión vigente | no | cola visible |
| `PRECLAIM_PRIVACY` | `ready` sin asignar | no | `ready` |
| `CLAIM_AND_POSTCLAIM_PRIVACY` | `ready` | **sí** | `assigned` |
| `PICKUP_AND_START` | `assigned` | **sí** | `on_the_way` |
| `MAP_CONTROLS_AND_EXTERNAL_NAV` | `on_the_way` | no | `on_the_way` |
| `RESUME_AFTER_SCREEN_AND_BACKGROUND` | `on_the_way` | no | `on_the_way` |
| `OFFLINE_ACTION` | `on_the_way` | local | `on_the_way` |
| `POST_RECONNECT_EXACTLY_ONCE` | `on_the_way` | remota (drenaje) | `on_the_way` |
| `ARRIVAL_AND_CODE` | `on_the_way` | **sí** | `arrived` |
| `TERMINAL_DELIVERY_ASSERT` | `arrived` | **sí** | `delivered` |

Cada fase valida su estado inicial contra el manifiesto y **falla cerrada** si
no coincide, de modo que reanudar nunca repite una mutación ya aplicada.
