# Mercado Pago en staging: runbook y diagnóstico

Estado al 2026-08-06. Proyecto Supabase `la-taba-staging` (`ukxqbgswjlibmnjemrzd`),
aplicación Mercado Pago **TABA2 Staging** `2691240967769590`, entorno exclusivamente TEST.

## Verificar secrets sin imprimirlos

El campo `value` que devuelve `supabase secrets list` es el **SHA-256 del valor**, no el valor.
Eso permite confirmar que un secret quedó bien cargado sin exponerlo:

```bash
supabase secrets list --project-ref ukxqbgswjlibmnjemrzd
# comparar contra sha256(valor local)
```

`supabase secrets list -o json` devuelve salida rota en la versión 2.110; usarlo **sin** ese flag.

Secrets que la integración necesita: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`,
`MERCADOPAGO_ENVIRONMENT=test`, `PAYMENT_WORKER_SECRET`, `PAYMENT_LOG_HASH_SALT`,
`TABA_CHECKOUT_BASE_URL`, `TABA_ALLOWED_ORIGINS`.

## Corrección 2026-08-06: el 401 no era de credenciales

El `401 "Unauthorized use of live credentials"` que motivó este runbook **no venía del
producto**: lo devolvía `POST /v1/payments`, que es la Payments API. Las credenciales de
prueba de una aplicación Checkout Pro son un **usuario de prueba** con token `APP_USR-`, y ese
formato no habilita la Payments API. El producto no usa ese endpoint: crea preferencias con
`POST /checkout/preferences`, que responde **201** con el mismo token.

Medido: `/users/me` devuelve `tags: [user_product_seller, test_user, normal]`, dominio
`testuser.com`. El token cargado en `MERCADOPAGO_ACCESS_TOKEN` es el correcto y oficial.

La tabla de más abajo queda **retractada** en su fila del 401.

## Lo que Mercado Pago devuelve de verdad (y rompía la finalización)

Verificado contra pagos sandbox reales de `la-taba-staging`:

| Campo | Realidad medida | Consecuencia |
| --- | --- | --- |
| `live_mode` | **`true`** en pagos hechos con las credenciales de prueba | `live_mode_mismatch` en todo intent `test` |
| `application_id` | **ausente** en `GET /v1/payments/{id}` y en el merchant order | `application_mismatch` siempre |
| `preference_id` | **ausente** en el pago; sólo está en el merchant order | `preference_mismatch` siempre |

Corregido en `20260806140000` (las dos aserciones SQL) y en `_shared/mercadopago.ts`
(`paymentSnapshot` resuelve el `preference_id` por el merchant order). En producción la
exigencia de `live_mode = true` se mantiene intacta.

Además: la preferencia no incluía el **costo de envío**, así que el comprador pagaba el
subtotal y el intent esperaba el total (`amount_mismatch`, y envío nunca cobrado). Y
`finalize_paid_checkout_session` no proyectaba el `address_snapshot` al pedido: el pedido
llegaba al Panel sin número de calle y sin columnas `delivery_*` (`20260806150000`).

## Firma de las notificaciones: el canal importa

- Notificaciones que dispara el `notification_url` **de la preferencia**: las firma la
  aplicación dueña de las credenciales de prueba (el usuario de prueba). Mercado Pago **no
  expone esa clave**: en su panel el campo aparece enmascarado y la configuración de webhooks
  no persiste. Verificado que ninguna valida contra la clave de la aplicación padre, probando
  14 variantes de manifiesto × 3 codificaciones de clave.
- Notificaciones del canal de **aplicación** (panel → Webhooks): las firma la aplicación, con
  la clave que el panel sí muestra. Validan correctamente contra `MERCADOPAGO_WEBHOOK_SECRET`.
- Con credenciales de prueba, el canal de aplicación **no se dispara solo**: quitar
  `notification_url` de la preferencia no produce ninguna entrega, y `notifications_history`
  del MCP oficial no registra ni un intento.

Consecuencia operativa: en staging la notificación firmada se dispara desde
**panel → Webhooks → Simular notificación**, con el `payment_id` real. Es una notificación
genuina de Mercado Pago, firmada con la clave de la aplicación.

## Preflight de credenciales: hacerlo antes que cualquier prueba E2E

Un checkout que falla con la pantalla genérica **"Algo salió mal... No pudimos procesar tu pago"**
no dice nada. La causa real aparece pidiéndole el pago a la API directamente:

```bash
curl -s -X POST https://api.mercadopago.com/v1/payments \
  -H "Authorization: Bearer $MERCADOPAGO_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"transaction_amount":100,"token":"<card_token>","installments":1,
       "payment_method_id":"master","payer":{"email":"test_user_x@testuser.com"}}'
```

Respuestas y qué significan:

| Respuesta | Significado |
| --- | --- |
| `401 "Unauthorized use of live credentials"` (code 7) | Mercado Pago trata el access token como **productivo**. Ninguna tarjeta de prueba va a funcionar, ni como invitado ni con cuenta de prueba. Hay que completar la configuración de la aplicación en el panel de desarrolladores y volver a emitir credenciales de prueba. |
| `201` con `status: approved` | Las credenciales sirven; si el checkout igual falla, el problema está en la preferencia. |

El token se obtiene con `POST /v1/card_tokens` usando el mismo access token.

Señales que acompañan al 401: la orden comercial se crea pero queda en
`order_status: payment_required` con `payments: []`, y `GET /v1/payments/search` del vendedor no
devuelve ningún pago nunca.

## Cosas que parecen la causa y no lo son

Descartadas con evidencia durante el diagnóstico:

- **Comprador**: falla igual como invitado y logueado con cuenta de prueba.
- **Marca de tarjeta**: fallan Mastercard `5031 7557 3453 0604` y Visa `4509 9535 6623 3704`.
- **`back_urls`**: las tres rutas de retorno responden 200.
- **Medios de pago**: `GET /v1/payment_methods` devuelve los 16 activos, con Visa y Mastercard crédito.
- **Permisos del vendedor**: `sell.allow: true`, `site_status: active`.
- **reCAPTCHA**: el formulario avanza solo cuando se completa el documento del titular.

## Cuentas de prueba

El MCP oficial siempre enmascara la contraseña y reutiliza el comprador existente. La API sí la
devuelve en claro:

```bash
curl -s -X POST https://api.mercadopago.com/users/test_user \
  -H "Authorization: Bearer $MERCADOPAGO_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' -d '{"site_id":"MLA"}'
# -> { id, email, nickname, password, site_status }
```

## Notificaciones: quién entrega y con qué firma

`preferenceRequest()` fija `notification_url` en cada preferencia, así que **las notificaciones las
dispara la preferencia, no la configuración de webhooks de la aplicación**. Por eso
`notifications_history` de la app puede salir vacío aunque las notificaciones estén llegando. Si las
credenciales TEST pertenecen a otra aplicación, la firma se calcula con el secret de esa otra
aplicación: verificarlo con la primera notificación `payment` real, mirando `signature_valid` en
`payment_webhook_receipts`.

## Dos defectos ya corregidos

- **Guard HTTPS** (`_shared/request-protocol.ts`). Supabase termina TLS en el proxy, así que
  `request.url` llega con esquema `http:`. Leerlo directamente hacía que el webhook respondiera
  400 `HTTPS_REQUIRED` al **100%** de las notificaciones, antes de validar firma o persistir recibo.
  Ahora se resuelve por `x-forwarded-proto` (primer hop) con `request.url` como fallback.
- **Formas de notificación** (`_shared/webhook-notification.ts`). El webhook moderno llega como
  `?data.id=<n>&type=<topic>`; las órdenes comerciales y el resto de tópicos legacy llegan como
  `?topic=<t>&id=<n>`. Leer sólo `data.id` dejaba esos recibos indexados contra un hash de payload y
  la firma no podía coincidir nunca. El `id` legacy se honra sólo si viene `topic`.

## Suite

```bash
npm run test:webhook   # firma HMAC, worker, protocolo de proxy, formas de notificación
npm test               # suite completa
npm run secrets:scan
```

## Limpieza de residuo sintético

Los recibos de prueba se distinguen por `request_id` (`smoke-*`, `live-*`, `regr-*`), nunca por
`resource_id`: así no hay forma de borrar por error una notificación real. Borrar primero los jobs de
`payment_outbox` que referencian esos recibos y después los recibos. Las reservas de stock de sesiones
abandonadas se liberan con la RPC `expire_checkout_sessions`.
