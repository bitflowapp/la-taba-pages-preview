# TABA Rider Android — Máquina de estados del pedido

Fuente de verdad **única** para cliente, negocio, rider y seguimiento. Debe formalizarse en el backend antes de escribir la primera línea de Flutter: hoy vive repartida entre `js/core/order-status.js`, `js/core/order-workflow.js` y la UI.

## Estados

| Estado | Dueño del avance | Significado | Ubicación activa |
|---|---|---|---|
| `pending` | Cliente | Pedido creado, sin confirmar por el local | No |
| `confirmed` | Local | Aceptado, en cola | No |
| `preparing` | Local | En preparación | No |
| `ready` | Local | Listo para retirar | No |
| `assigned` | Local o rider | Rider asignado, aún no retiró | No |
| `picked_up` | Rider | Retirado del local | **Sí** |
| `on_the_way` | Rider | En ruta al cliente | **Sí** |
| `arriving` | Rider | A menos de ~300 m o declarado | **Sí** |
| `delivered` | Rider | Entregado y verificado | No (se detiene) |
| `cancelled` | Local o cliente | Cancelado antes de entregar | No |
| `failed` | Rider | No se pudo entregar (incidencia terminal) | No |
| `expired` | Sistema | Sin aceptación dentro de la ventana | No |

`picked_up` y `on_the_way` se distinguen porque el negocio necesita saber que salió del local aunque el rider no haya iniciado el trayecto (p. ej. carga dos pedidos).

## Transiciones

| # | Origen → Destino | Actor | Precondición | RPC | Idempotencia | Reintento | Evento | Efecto visual | Rollback | Auditoría |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | `ready` → `assigned` | Local / rider | Pedido sin rider; rider en turno | `rpc_assign_rider(order_id, rider_id, cmd_id)` | Por `cmd_id`; segunda llamada devuelve el mismo resultado | 3 intentos, backoff exponencial | `order.assigned` | El pedido aparece en la lista del rider | **Sí** — el local puede reasignar | actor, ts, dispositivo |
| T2 | `assigned` → `picked_up` | Rider | Rider asignado; local abierto | `rpc_confirm_pickup(order_id, cmd_id, at)` | Por `cmd_id` | Cola durable, sin límite | `order.picked_up` | Se activa el servicio de ubicación; el cliente ve “En camino” | **No** | actor, ts, geo, dispositivo |
| T3 | `picked_up` → `on_the_way` | Rider | — | `rpc_start_delivery(order_id, cmd_id, at)` | Por `cmd_id` | Cola durable | `order.on_the_way` | Mapa activo | No | actor, ts, geo |
| T4 | `on_the_way` → `arriving` | Rider o geocerca | Distancia < 300 m **o** declaración manual | `rpc_mark_arriving(order_id, cmd_id, at)` | Por `cmd_id` | Cola durable | `order.arriving` | Aviso al cliente | **Sí** — puede volver a `on_the_way` si se alejó | actor, ts, geo, origen (auto/manual) |
| T5 | `arriving` → `delivered` | Rider | **Código de entrega válido** o incidencia autorizada | `rpc_confirm_delivery(order_id, code, cmd_id, at)` | Por `cmd_id`; el código se valida en el servidor | Cola durable; **el código se conserva cifrado hasta confirmar** | `order.delivered` | Se detiene la ubicación; resumen | **No** | actor, ts, geo, método (código / incidencia), intentos |
| T6 | cualquiera → `cancelled` | Local o cliente | Antes de `delivered` | `rpc_cancel_order(order_id, reason, cmd_id)` | Por `cmd_id` | 3 intentos | `order.cancelled` | Aviso irruptivo al rider; se libera el trabajo | No | actor, motivo, ts |
| T7 | `arriving`/`on_the_way` → `failed` | Rider | Motivo de incidencia registrado | `rpc_report_incident(order_id, type, note?, cmd_id, at)` | Por `cmd_id` | Cola durable | `order.failed` | El local lo ve al instante y decide | **Sí** — el local puede reabrir a `on_the_way` | actor, tipo, ts, geo |
| T8 | `ready` → `expired` | Sistema | Sin asignación en N minutos | job del servidor | — | — | `order.expired` | Desaparece de la lista | Sí, reactivable por el local | sistema, ts |
| T9 | `assigned` → `ready` | Local | El rider libera o no responde | `rpc_unassign_rider(order_id, cmd_id)` | Por `cmd_id` | 3 intentos | `order.unassigned` | Vuelve a la bolsa común | — | actor, motivo, ts |

## Reglas duras

1. **El cliente nunca avanza el estado del rider**, y el rider nunca retrocede un estado que el local ya confirmó.
2. **Ningún estado avanza sin `cmd_id`.** Es un UUID generado en el dispositivo, no en el servidor: sobrevive a la pérdida de red y hace idempotente el reintento.
3. **La validación del código de entrega es del servidor.** El dispositivo nunca decide si un código es correcto. Sin red, `rpc_confirm_delivery` se encola y el rider ve “Entrega registrada, pendiente de confirmar”; el estado local es optimista y **reversible** si el servidor la rechaza.
4. **La ubicación sólo se emite entre T2 y T5.** Fuera de esa ventana el servicio se detiene: es un requisito de privacidad, no una optimización.
5. **Toda transición se escribe primero en la cola local** y después se intenta enviar. Nunca al revés.
6. **Las transiciones que llegan del servidor ganan** sobre las locales optimistas, salvo que el `cmd_id` local aún esté pendiente de envío.

## Conflictos y reconciliación

| Conflicto | Resolución |
|---|---|
| El local cancela mientras el rider confirma la entrega | Gana la entrega si su `cmd_id` llegó primero al servidor. El servidor decide por orden de llegada, no por hora del dispositivo (los relojes mienten) |
| Dos dispositivos con la misma sesión | La sesión previa se invalida en el login; el pedido activo se recupera del servidor |
| El rider confirma retiro offline y el local reasigna a otro | Al drenar la cola, el servidor rechaza T2 por precondición; la app muestra “Este pedido fue reasignado” y libera el trabajo |
| `arriving` automático y luego se aleja | T4 permite rollback a `on_the_way`; no se vuelve a avisar al cliente en el segundo `arriving` |
| Cola con acciones de un pedido ya cancelado | Se descartan al drenar, con registro en la auditoría y aviso no irruptivo |

## Vocabulario visible

Cada estado tiene un nombre distinto por audiencia; la tabla completa está en `design-system/CROSS_PRODUCT_CONSISTENCY.md`. La divergencia deliberada más relevante: `assigned` se muestra al cliente como **“Preparando”**, no como “Asignado”, para no crear expectativa antes de que el pedido salga del local.

## Contrato de pruebas

Cada transición necesita:
- test de camino feliz;
- test de precondición no cumplida (debe rechazar y no cambiar estado);
- test de idempotencia (misma `cmd_id` dos veces → un solo cambio, misma respuesta);
- test offline → drenaje (el estado converge al mismo resultado);
- test de conflicto contra la transición que compite.
