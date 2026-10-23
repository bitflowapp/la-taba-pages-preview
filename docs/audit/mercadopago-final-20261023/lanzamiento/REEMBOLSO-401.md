# Reembolso por API bloqueado con 401: qué es nuestro y qué es de Mercado Pago

23/10/2026, entorno QA (usuarios de prueba, dinero ficticio). No se hicieron más reembolsos por API: la única sonda posterior no puede mover dinero (ver §2).

## 1. Qué pasó

| Intento | Credencial | Resultado |
|---|---|---|
| 25/09: reembolso del pago `179851082485` | token directo de la TestApp | `401` |
| 23/10 19:56: reembolso total del pago `184722117633` desde La Taba, y su repetición | grant OAuth del vendedor de prueba por TestApp | `409 REFUND_REJECTED` (La Taba), el proveedor había dicho `401 Unauthorized use of live credentials`, cause `7` |
| 23/10 19:58: misma llamada con la misma clave de idempotencia, fuera de La Taba, sólo para leer el motivo | ídem | `401`, cause `7`, request `1f619ac9-66fb-446e-9739-3cad2740969a` |
| 23/10 20:44: sonda sobre el pago **rechazado** `184725699779` | ídem | `401`, cause `7`, request `ec676b58-03a2-475e-8dc5-32aca11fde65` |
| 23/10 20:44: `GET /v1/payments/184722117633/refunds` | ídem | `200`, lista vacía (la lectura funciona) |

## 2. Por qué la sonda del 20:44 es concluyente y segura

Un reembolso sobre un pago que Mercado Pago ya informa como `rejected` no puede mover dinero: no hay cargo que devolver. Si el endpoint dejara pasar la autorización respondería `400 2063` («acción no válida para el estado del pago»). Respondió **el mismo 401 código 7**. O sea, el rechazo ocurre en la capa de autorización, **antes de mirar el pago**. No depende del pago, del importe, de la tarjeta ni de nuestra clave de idempotencia. La herramienta (`scripts/recovery/qa-mp-refund-auth-probe.mjs`) se niega a ejecutarse si el pago no está `rejected` o `cancelled`.

## 3. Lo que descartamos de nuestro lado

Contra la [referencia oficial de «Create refund»](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-pro-preferences/create-refund/post):

| Requisito oficial | La Taba |
|---|---|
| `POST /v1/payments/{id}/refunds` | igual (`mercadopago-refund/index.ts`) |
| `Authorization: Bearer <access token>` | token OAuth del vendedor, válido: las lecturas con el mismo token responden 200 |
| `X-Idempotency-Key` obligatorio | se envía una UUID por reembolso, estable en los reintentos |
| Reembolso total = cuerpo vacío | cuerpo vacío para el total |
| Ventana de 180 días y saldo suficiente | pago de minutos de antigüedad; el reembolso manual con el mismo saldo funcionó (§5) |

El 401 con «live credentials» no figura entre los errores documentados del reembolso (sí figuran 400 2063, 401 «Invalid-token», 404 2000, 404 2024…).

## 4. Lo que se puede configurar en la cuenta, y ya está

En TestApp-ae01fd1d → Configuración (sólo lectura, sin guardar): producto **Checkout Pro**, API de **Preferencias**, PKCE **sí**, permisos de la aplicación **read, write y offline access**, los tres tildados. No existe una casilla de permiso de reembolso: los scopes de reembolso (`urn:mp:online:payments:refunds/read-only` en la TestApp, ninguno específico en TABA2 Staging) los define Mercado Pago por producto, no el integrador. El token directo de la TestApp y el grant OAuth fallan igual.

## 5. Lo que sí funciona: el reembolso del vendedor y su conciliación

El vendedor de prueba ve «Devolver dinero» en su Actividad. Se ejecutó **una vez** (total, ARS 100) y La Taba lo concilió sin intervención:

| Control | Resultado |
|---|---|
| Proveedor | pago `184722117633` `refunded`, reembolso `3468882144` aprobado por 100 |
| Webhooks | 3 notificaciones firmadas válidas, procesadas |
| La Taba | intent `refunded`, `refunded_amount` 100; registro del reembolso `origin: external`, aprobado, con el id del proveedor; el intento local rechazado queda como historial |
| Integridad | cero discrepancias; stock sin otro movimiento; ningún duplicado |
| Pedido `LT-0087` | sigue `received`: devolver el dinero no cancela el pedido (ver «Procedimiento operativo» en el plan de lanzamiento) |

Es decir: aunque la API de reembolso fallara también en producción, el negocio puede devolver desde su cuenta y La Taba lo refleja una sola vez.

## 6. Conclusión

| Pregunta | Respuesta |
|---|---|
| ¿Es un defecto del pedido que arma La Taba? | **No** (§2 y §3). |
| ¿Se arregla cambiando algo nuestro, en la app o en el código? | **No** (§4). |
| ¿Bloquea abrir ventas reales? | **No**: el reembolso por la cuenta del vendedor está probado y conciliado. La API de reembolso queda **sin certificar** hasta el primer reembolso real controlado. |
| ¿Qué requiere a Mercado Pago? | Sólo esto: cómo se prueban reembolsos y cancelaciones **por API** en el entorno de prueba de Checkout Pro con OAuth, y si el 401 código 7 también aplica a cuentas reales. |

Texto para el soporte (no enviado):

> Con Checkout Pro y usuarios de prueba (vendedor `3594962708`, aplicación `4861627125869370`), `POST /v1/payments/{id}/refunds` responde `401 Unauthorized use of live credentials`, cause 7, para cualquier pago, incluso uno `rejected` (requests `ec676b58-03a2-475e-8dc5-32aca11fde65` y `1f619ac9-66fb-446e-9739-3cad2740969a`). Las lecturas con el mismo token responden 200, y «Devolver dinero» desde la cuenta del vendedor funciona. ¿Cómo se prueban reembolsos y cancelaciones por API en el entorno de prueba? ¿Aplica la misma restricción a cuentas reales (aplicación `7677852968049976`)?

## 7. Mitigación en el código (este PR)

Hoy un rechazo del proveedor sólo guarda un hash, y un fallo en producción volvería a ser ciego. Se registra, sin el cuerpo de la respuesta, el estado HTTP, el `x-request-id` y los códigos numéricos de `cause` del proveedor, para reembolsos y cancelaciones.
