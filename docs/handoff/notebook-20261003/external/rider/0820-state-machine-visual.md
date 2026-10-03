# Máquina de estados visual — TABA2 Rider

Derivada del código real en HEAD `95294d9`. **No se agrega, quita ni reordena ninguna
transición.** Este documento sólo define cómo se *presenta* cada estado que ya existe.

---

## 1. Fuentes de estado reales

| Fuente | Tipo | Valores | Archivo |
|---|---|---|---|
| Sesión | `RiderSessionState` | `signedOut, signingIn, signedIn, refreshing, authError` | `domain/auth/rider_session.dart` |
| Carga de cola | `OrdersLoadState` | `initial, loading, ready, error` | `features/orders/application/orders_controller.dart:15` |
| Claim | `ClaimUiStatus` | `idle, taking, assigned, takenByOther, stale, error` | ídem `:18` |
| Pedido (backend) | `OrderStatus` | 15 valores; relevantes: `ready, assigned, pickedUp, onTheWay, arrived, delivered, cancelled/canceled` | `domain/orders/order_status.dart` |
| Servicio nativo | `DeliveryServiceStatus` | `stopped, starting, running, fresh, delayed, stale, noSignal, error` | `domain/delivery/delivery_service_state.dart:6` |
| GPS | `RiderFixState` | `none, stale, live` | `domain/map/order_map_data.dart:17` |
| Mapa | `OrderMapAvailability` | `operational, missingStops` | ídem `:8` |

### Nota operativa que condiciona el diseño

El seguimiento GPS **sólo arranca en `startDelivery()`**, es decir al pulsar
*Iniciar recorrido* desde `pickedUp`. Por lo tanto, en `ready` y `assigned` el servicio
está detenido y `riderFix` es `null`: **no hay puck del rider ni distancias mientras el
rider va hacia La Taba 2**. El diseño no puede prometer distancia ni ETA en esos estados.

### Lo que NO existe (y por lo tanto no se diseña)

- No hay conectarse/desconectarse, turnos, horarios, agenda ni zonas de alta demanda.
- No hay ganancias, bonos, objetivos, logros, balance, pagos ni mensajería.
- No hay ETA ni ruta calculada: sólo distancia en línea recta (`formatMapDistance`).
- No hay soporte remoto, teléfono ni WhatsApp: sólo el reporte de incidencia
  (`reportDeliveryIssue`) con 7 tipos fijos.

---

## 2. Matriz de estados

Leyenda de tono: `live` verde · `waiting` ámbar · `idle` gris · `problem` rojo.

### A. Sin pedidos — equivalente honesto de "No repartiendo"

Condición real: `assigned == null && available.isEmpty && status == ready`

| Campo | Valor |
|---|---|
| Cápsula superior | `Estado` / **Sin pedidos** · tono `idle` |
| Título del sheet | Sin pedidos disponibles |
| Subtítulo | Cuando el negocio publique una entrega, aparece acá. |
| CTA principal | **Actualizar** (`controller.refresh`) — única acción real existente |
| Acción secundaria | — |
| Mapa | Centrado en La Taba 2 si el backend dio coordenadas; si no, superficie de fallback |
| Datos permitidos | Nombre y dirección del comercio, hora de última sincronización |
| Datos prohibidos | Turnos, horarios, zonas calientes, objetivos, ganancias |
| Icono | `Icons.inbox_outlined` |
| Modal posible | — |

> No se implementa ningún botón "Comenzar"/"Conectarse": no existe esa transición.

### B. Buscando pedidos

Condición real: `status == initial \|\| (status == loading && available.isEmpty && assigned == null)`

| Campo | Valor |
|---|---|
| Cápsula | `Estado` / **Buscando pedidos…** · `waiting` |
| Título | Buscando pedidos… |
| Subtítulo | Te avisamos cuando haya una entrega disponible. |
| CTA principal | — (deshabilitado mientras carga) |
| Mapa | Igual que A |
| Datos permitidos | Conectividad, última sincronización |
| Datos prohibidos | Tiempos estimados de espera, cantidad prevista de pedidos |
| Icono | `Icons.sync` |

### C. Pedido disponible (pre-claim)

Condición real: `available.isNotEmpty && assigned == null`

| Campo | Valor |
|---|---|
| Cápsula | `Estado` / **Pedido disponible** · `idle` |
| Título | Nuevo pedido + `publicCode` |
| Retiro | **La Taba 2** / **Mendoza 827** |
| Entrega | `Zona <generalZone>` o dirección enmascarada — **nunca la exacta** |
| CTA principal | **Aceptar pedido** → `claimAvailableOrder` |
| Datos permitidos | `publicCode`, `approximatePackages`, `paymentMethod`, `collectionAmountArs`, `estimatedMinutes`, `operationalRestrictions` |
| Datos prohibidos | Dirección exacta del cliente, nombre del cliente, pago del rider, distancia (no hay fix GPS) |
| Icono | `Icons.assignment_outlined` |
| Modal posible | Pedido tomado por otro rider (`takenByOther`), pedido cambiado (`stale`) |

### D. Yendo al retiro

Condición real: `assigned.status == OrderStatus.assigned`

| Campo | Valor |
|---|---|
| Cápsula | `Estado` / **Yendo a La Taba 2** · `idle` |
| Título | Retiro |
| Cuerpo | **La Taba 2** / **Mendoza 827** |
| CTA principal | **Confirmar retiro** → `markPickedUp` |
| Acción secundaria | Abrir en Google Maps (control circular del mapa, dirección del comercio) |
| Mapa | Pin del comercio; **sin puck** (servicio detenido) |
| Datos permitidos | Dirección exacta del cliente ya desbloqueada (post-claim) |
| Datos prohibidos | ETA, ruta dibujada, distancia (sin fix) |
| Icono | `Icons.storefront` |

### E. Retiro confirmado

Condición real: `assigned.status == OrderStatus.pickedUp`

| Campo | Valor |
|---|---|
| Cápsula | `Estado` / **Pedido retirado** · `idle` |
| Título | Pedido retirado |
| Subtítulo | Ya podés iniciar el recorrido hacia el cliente. |
| CTA principal | **Iniciar recorrido** → `startDelivery` (arranca el seguimiento GPS) |
| Modal previo | **Permisos para el seguimiento** — una sola vez por pantalla (`_permissionsExplained`) |
| Datos permitidos | Resumen compacto de productos, total, dirección de entrega |
| Icono | `Icons.check_circle_outline` |

### F. Yendo al cliente

Condición real: `assigned.status == OrderStatus.onTheWay`

| Campo | Valor |
|---|---|
| Cápsula | depende del GPS: `live` → **Repartiendo**; `stale` → **Ubicación desactualizada**; `none` → **Buscando tu ubicación…** |
| Título | En camino |
| Cuerpo | Dirección exacta del cliente (post-claim) |
| CTA principal | **Llegué** → `markArrived` |
| Acción secundaria | Google Maps con la dirección del cliente; recentrar |
| Mapa | Pin cliente exacto + puck del rider + círculo de precisión si `live` |
| Fallback | Sin coordenadas → superficie de fallback + "usá la dirección escrita" |
| Icono | `Icons.navigation_outlined` |
| Modal posible | Reporte de incidencia (7 tipos) |

### G. Llegada / código

Condición real: `assigned.status == OrderStatus.arrived`

| Campo | Valor |
|---|---|
| Cápsula | igual que F (según GPS) |
| Título | Llegaste |
| CTA principal | **Ingresar código** (foco al campo) → al completar 4 dígitos muta a **Confirmar entrega** |
| Campo | 4 dígitos, `keyboardType: number`, `digitsOnly`, `obscureText`, `maxLength 4` |
| Anti doble-submit | `operationId` UUID estable + `controller.isBusy` |
| Errores | `incorrect_code` (limpia campo), `temporarily_locked` (+ `retryAfterSeconds`), `network_unavailable` |
| Sheet | se expande automáticamente (`expandSheet: status == arrived`) |
| Icono | `Icons.password_outlined` |

### H. Entrega completada

Condición real: `assigned.status == OrderStatus.delivered`

| Campo | Valor |
|---|---|
| Cápsula | `Estado` / **Entrega completada** · `live` |
| Título | Entrega finalizada |
| Subtítulo | El servidor confirmó la entrega. |
| CTA principal | **Volver a la cola** (navegación segura, no mutante) |
| Acción secundaria | *Detener seguimiento técnico* — sólo si `service.isActive`, emphasis `secondary` |
| Datos prohibidos | Cualquier acción que pueda reenviar la entrega |
| Icono | `Icons.check_circle` |
| Modal posible | Confirmación de detener seguimiento |

### I. Sin conexión

Condición real: `service.queueSize > 0` · `service.errorKey == 'network_unavailable'` ·
`DeliveryServiceStatus.delayed` · `noSignal` · `OrdersFailure.messageKey ∈ {network_unavailable, orders_server_unavailable}`

| Campo | Valor |
|---|---|
| Cápsula | **Sin conexión** · `problem` |
| Aviso sobre el mapa | Sin conexión · *La ubicación se envía cuando vuelva la conexión.* + `N ubicaciones pendientes` |
| CTA principal | El del estado vigente, **deshabilitado** para acciones mutantes |
| Texto obligatorio | Las acciones de entrega se confirman sólo con el servidor. |
| Prohibido afirmar | Que la cola sobrevive a un `force-stop` — la implementación **no** ofrece esa garantía |
| Icono | `Icons.cloud_off` |

### Estados de error transversales

| Estado | Condición | Presentación | CTA |
|---|---|---|---|
| Sesión vencida | `messageKey == 'session_expired'` | Modal, tono `problem` | Ingresar |
| Seguimiento con error | `DeliveryServiceStatus.error` | Cápsula `problem` + banner | Reintentar / Abrir Ajustes |
| Permiso denegado | `location_permission_denied`, `precise_location_permission_required`, `notification_permission_*` | Modal | Abrir Ajustes |
| Ubicación desactivada | `location_services_disabled` | Modal | Abrir Ajustes |
| Pedido tomado por otro | `ClaimOutcomeKind.takenByOther` | Modal | Ver pedidos |
| Pedido cambiado | `ClaimOutcomeKind.stale` / `orders_revision_conflict` | Modal | Actualizar |
| Sin coordenadas | `OrderMapAvailability.missingStops` | Superficie de fallback | — |

---

## 3. CTA único por estado — tabla de verificación

| Estado real | CTA principal (exacto) | Handler | Clave |
|---|---|---|---|
| `available` | Aceptar pedido | `claimAvailableOrder` | `detail-claim-action` |
| `assigned` | Confirmar retiro | `markPickedUp` | `detail-delivery-action` |
| `pickedUp` | Iniciar recorrido | `startDelivery` | `detail-delivery-action` |
| `onTheWay` | Llegué | `markArrived` | `detail-delivery-action` |
| `arrived` (código incompleto) | Ingresar código | foco al campo | `detail-delivery-action` |
| `arrived` (4 dígitos) | Confirmar entrega | `confirmCode` | `detail-delivery-action` |
| `delivered` + servicio activo | Detener seguimiento técnico (`secondary`) | `stopDelivery` | `detail-delivery-action` |
| `delivered` + servicio detenido | Volver a la cola | `Navigator.pop` | `detail-done-action` |

Regla: en ningún estado hay dos botones con `emphasis: primary`. La acción secundaria
vive siempre fuera del footer (control circular del mapa o botón de texto).
