# Máquina de Estados: Pedido / Pago / Entrega — TABA2 E2E Test Staging
**Fecha**: 2026-08-05  
**Agente**: TABA2_E2E_TEST_STAGING  
**Nota**: Este documento refleja el contrato esperado basado en las migraciones y código inspeccionados. Debe verificarse contra el código real durante Gate 1.

---

## Estados del Pedido (contrato a verificar)

```
CREATED
  → actor: STOREFRONT (usuario)
  → acción: agregar items, checkout
  → persistencia: tabla orders
  → idempotency key: external_reference generado en este paso
  → reversibilidad: sí (cancelar antes de pago)
  → error posible: stock insuficiente, dirección inválida

PAYMENT_PENDING
  → actor: MERCADO PAGO (checkout Pro abierto)
  → acción: usuario redirigido a MP, pago en curso
  → persistencia: preference_id guardado, status=pending
  → idempotency key: preference_id de MP
  → reversibilidad: sí (timeout de preferencia)
  → error posible: usuario abandona, expiración de preferencia

PAYMENT_APPROVED
  → actor: WEBHOOK (Edge Function mercadopago-webhook)
  → acción: webhook recibido + firma válida + consulta a MP API
  → persistencia: payment_id, status=approved en tabla payments
  → idempotency key: payment_id de MP (deduplicación en webhook handler)
  → reversibilidad: sólo via refund (proceso separado)
  → error posible: firma inválida, webhook duplicado, external_reference inexistente

BUSINESS_PENDING_ACCEPTANCE
  → actor: SISTEMA (tras PAYMENT_APPROVED)
  → acción: transición automática, pedido aparece en Panel del negocio
  → persistencia: order_status=business_pending_acceptance
  → idempotency key: (hereda del payment_id)
  → reversibilidad: sí (rechazar pedido)
  → error posible: Panel no recibe realtime update

BUSINESS_ACCEPTED
  → actor: OPERADOR DEL NEGOCIO (Panel)
  → acción: operador acepta el pedido manualmente
  → persistencia: order_status=business_accepted, timestamp
  → idempotency key: acción del operador es idempotente (doble click = no-op)
  → reversibilidad: no (una vez aceptado, flujo continúa)
  → error posible: doble click, refresh en el momento de aceptación

RIDER_QUEUE_READY
  → actor: SISTEMA (tras BUSINESS_ACCEPTED)
  → acción: pedido entra a la cola de asignación de riders
  → persistencia: rider_queue entry
  → idempotency key: order_id
  → reversibilidad: sí (si no hay claim aún)
  → error posible: business_id incorrecto, delivery_mode incompatible

RIDER_CLAIMED
  → actor: RIDER (app Android)
  → acción: rider toma el pedido de la cola
  → persistencia: rider_assignments, status=claimed
  → idempotency key: claim con lock de read-mode (20260802103000)
  → reversibilidad: sí (unclaim dentro de ventana)
  → error posible: claim concurrente (el lock previene duplicados)

PICKED_UP
  → actor: RIDER (app Android, en el local del negocio)
  → acción: rider confirma retiro
  → persistencia: order_events, status=picked_up
  → idempotency key: rider_id + order_id + timestamp
  → reversibilidad: no
  → error posible: sin GPS, sin conectividad

IN_DELIVERY
  → actor: RIDER (inicia recorrido)
  → acción: rider marca inicio de entrega
  → persistencia: delivery_start_time, GPS activo
  → idempotency key: (hereda del claim)
  → reversibilidad: no
  → error posible: GPS estacionario (GPS_LIVE_STATIONARY_PASS debe pasar)

ARRIVED
  → actor: RIDER (llegó al domicilio)
  → acción: rider marca llegada, código QA generado/enviado
  → persistencia: arrival_time, delivery_code
  → idempotency key: arrival es terminal en este stage
  → reversibilidad: no
  → error posible: código de entrega no generado

DELIVERED
  → actor: RIDER + CLIENTE (código confirmado)
  → acción: código QA ingresado via ACTION_SET_TEXT, pedido terminalizado
  → persistencia: order_status=delivered, delivered_at
  → idempotency key: código de entrega (exactly-once: segunda validación = no-op)
  → reversibilidad: no (terminal)
  → error posible: código incorrecto, timeout
```

---

## Estado de ARCA

Para la prueba E2E:

```
BILLING_NOT_APPLICABLE_IN_TEST
  → actor: SISTEMA (guard E2E)
  → acción: ninguna — ARCA deshabilitada
  → persistencia: campo billing_status=qa_test_only o equivalente
  → nota: nunca emitir CAE, WSFE, comprobante, nota de crédito, QR fiscal
```

---

## Tablas de Idempotencia Principales

(A verificar contra código durante Gate 1)

| Entidad | Clave de Idempotencia |
|---|---|
| Preferencia MP | `external_reference` (generado en creación, único por pedido) |
| Pago MP | `payment_id` de Mercado Pago |
| Webhook procesado | `payment_id` + tabla de eventos procesados |
| Claim de Rider | `order_id` con lock (read-lock mode migración 20260802103000) |
| Aceptación del negocio | `order_id` (segunda aceptación = no-op) |
| Entrega | `delivery_code` (segunda confirmación = no-op) |

---

## Casos de Webhook a Probar (Gate 1 mock, Gate 3 real)

| Caso | Comportamiento Esperado |
|---|---|
| Webhook válido con firma correcta | Procesar, actualizar estado |
| Firma inválida | Rechazar 401, no mutar estado |
| Webhook duplicado (mismo payment_id) | Ignorar (idempotente), return 200 |
| Webhook fuera de orden | Ignorar si estado ya es terminal, loggear |
| Pago PENDING → APPROVED | Transicionar estado |
| Pago RECHAZADO | Transicionar a payment_failed, notificar |
| Pago APROBADO repetido | Idempotente, no duplicar |
| Evento desconocido | Ignorar, return 200 |
| external_reference inexistente | Loggear, return 200 (no exponer estado) |
| Pedido ya procesado | No-op idempotente |
| Recovery después de caída | Reprocess desde outbox |
| Replay de webhook | Idempotente por payment_id |

---

## Flujo de Exactly-Once Demostrable

Para Gate 5, demostrar que existen exactamente:

```
1 × preference_id en tabla de preferencias
1 × payment_id en tabla de pagos (status=approved)
1 × order_id en tabla de pedidos
1 × external_reference (misma en preferencia, pago, pedido)
1 × idempotency_key lógica aplicada
1 × webhook efectivo en log de eventos
1 × transición PAYMENT_PENDING → PAYMENT_APPROVED
1 × transición BUSINESS_PENDING_ACCEPTANCE → BUSINESS_ACCEPTED
1 × claim (RIDER_CLAIMED)
1 × pickup (PICKED_UP)
1 × delivery start (IN_DELIVERY)
1 × arrival (ARRIVED)
1 × terminalización (DELIVERED)
1 × ajuste de stock QA (si hay semántica definida)

0 × duplicados en cualquier tabla
0 × comprobantes ARCA
0 × pedidos humanos tocados
0 × datos personales reales
```
