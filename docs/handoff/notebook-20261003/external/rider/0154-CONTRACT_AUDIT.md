# Auditoria del contrato Rider - TABA2

Fecha: 2026-08-02  
Fuentes auditadas: backend `c6d6a7b56df46fb6989b7e6584a165ff915de6c1` y Rider `db645b51f89c8862da6ad29af16ec4e194c9cbc6`.

No se modifico ningun contrato antes de esta auditoria.

## Vocabulario almacenado

El vocabulario almacenado vigente es `submitted`, `accepted`, `preparing`, `ready`, `assigned`, `picked_up`, `on_the_way`, `arrived`, `delivered`, `cancelled` y `rejected`. `normalize_order_status_vocabulary` ya mapea los alias publicos `ready_for_pickup` a `ready` y `arriving` a `arrived`.

## Matriz de operaciones

| Operacion | Estado | Evidencia actual | Brecha o riesgo |
|---|---|---|---|
| Cola Rider | partial | `list_available_rider_orders(uuid)` minimiza PII y filtra `ready` sin asignar | No devuelve `revision`, `order_id`, nombre de negocio ni estado; Rider requiere revision, por lo que el contrato live no coincide. |
| Claim | partial / unsafe | `claim_available_rider_order` bloquea fila, valida membership activa y deja un ganador | No acepta revision ni idempotency key, mientras Android envia `p_expected_revision`; puede producir evento especifico mas evento de trigger. |
| Asignacion/reasignacion negocio | existing | `assign_order_rider` bloquea y limita a `ready`/`assigned` | Conserva CAS por estado/asignado, no por revision ni clave de idempotencia. |
| Retirada | missing | Solo existe transicion generica `transition_order` | Falta RPC Rider dedicada, con assignment, estado listo, revision e idempotencia. |
| Inicio de ruta | missing | Android invoca `start_rider_delivery` | No hay funcion SQL vigente con ese nombre. |
| Llegada | partial / unsafe | `transition_order` puede llegar a `arrived` | Falta RPC dedicada; la transicion generica permitia atajo `on_the_way -> delivered`. |
| GPS | partial | `publish_rider_location` autentica, valida assignment, precision y frecuencia | Firma no acepta revision/captured_at que Android envia; devuelve fila con coordenadas, no receipt; no clasifica throttled/stale/impossible_jump/terminal. |
| Codigo | partial / unsafe | `confirm_order_delivery` usa hash `crypt`, locks y purga terminal | Sin idempotency key/revision ni tabla de intentos; la funcion de tracking historica puede descifrar codigo; no devuelve `retry_after_seconds` normalizado. |
| Rate limit | partial | `failed_attempts` y `locked_until` existen en `order_delivery_handoffs` | No hay audit persistente por request ni deduplicacion de doble toque. |
| Delivered | partial | Confirmacion actual actualiza `orders` y activa trigger de purge | No es una frontera contractual unica con receipt/idempotency; puede duplicar evento por trigger mas insercion manual. |
| Incidencia Rider | missing | No existe RPC ni tabla de issue | Rider no tiene autoridad de cancelacion directa, que debe preservarse. |
| Cancelacion Rider | existing (denegada) | `change_order_status` no da cancelacion al rider | Correcto no habilitarla; falta alternativa de reporte. |
| Recuperacion activa | partial | Android hace lectura RLS de `orders`; nativo reconcilia metadata segura | Falta `get_active_rider_delivery` con projection contractual unica y fail-closed. |
| Notificacion/outbox | missing | Eventos de pedido existen | No se encontro outbox Rider dedicado. |
| Tracking publico | partial / duplicated | Varias migraciones redefinen `get_public_order_tracking` | Debe consolidarse para cerrar codigo y GPS al terminal sin exponer secretos. |
| Realtime/reconciliacion | existing / partial | `revision`, `order_events.sequence`, replica identity y reconciliacion Android existen | Debe consumir snapshots RPC y evitar que una revision vieja reabra acciones. |

## Invariantes que se preservan

- Auth, memberships, RLS, `SECURITY DEFINER` con `search_path` explicito y grants minimizados.
- `orders.revision` monotona y `order_events.sequence` total.
- Creacion idempotente, snapshot/reconciliacion y tracking publico revocable.
- `RiderOperationGate`, `LocationTrackingActor`, cola offline, recuperacion, `TokenRefreshMutex`, foreground service y UX TABA2.

## Duplicados y deprecaciones

- `get_public_order_tracking` y `confirm_order_delivery` fueron redefinidas por migraciones posteriores. La nueva migracion debe ser incremental y reemplazar solamente las firmas canonicas vigentes.
- La ruta generica `transition_order` sigue siendo necesaria para negocio/cliente, pero no debe ser la autoridad operativa del Rider para retirada, inicio, llegada o entrega.
- Las rutas demo/browser no son parte del contrato Rider Android y no se usaran como fallback.

## Decision de implementacion

Se agregara una migracion incremental que conserva el vocabulario almacenado y crea RPC Rider dedicadas, receipts minimizados, idempotencia persistente, rate limiting auditable y cierre transaccional. Android consumira exclusivamente esas RPC; no hara `UPDATE` directo de `orders` ni presentara estados locales como confirmados.
