# TABA2 · Mercado Pago TEST E2E — informe 2026-08-06

Repo `D:\1212\la-taba-e2e-test-staging-rc`, rama `release/taba2-e2e-test-staging-rc`,
HEAD `418b732`. Proyecto Supabase `la-taba-staging` (`ukxqbgswjlibmnjemrzd`).
Aplicación Mercado Pago **TABA2 Staging** `2691240967769590`, entorno TEST.
Sin push, sin producción, sin ARCA, sin dinero real.

## 1. El bloqueo declarado no existía

`401 "Unauthorized use of live credentials"` (code 7) lo devolvía **`POST /v1/payments`**,
la Payments API. Las credenciales de prueba de una aplicación Checkout Pro son un **usuario
de prueba** con token `APP_USR-`, y ese formato no habilita la Payments API. El producto no
usa ese endpoint.

Medido: `/users/me` → `id 3594962708`, `tags: [user_product_seller, test_user, normal]`,
dominio `testuser.com`, `site_id MLA`. `POST /checkout/preferences` con el mismo token → **201**.
El `MERCADOPAGO_ACCESS_TOKEN` cargado era, y sigue siendo, el correcto. El
`MERCADOPAGO_WEBHOOK_SECRET` también: su SHA-256 coincide con la clave que muestra el panel.

## 2. Seis defectos reales, medidos y corregidos

Ningún pago real de Mercado Pago podía convertirse en pedido. Los dos primeros ya estaban
corregidos por la sesión anterior; los cuatro siguientes se encontraron y corrigieron acá.

| # | Defecto | Efecto | Corrección |
| --- | --- | --- | --- |
| 1 | Guard HTTPS leía `request.url` | 400 en el 100% de las notificaciones | `3a0ff5b` (previo) |
| 2 | Sólo se leía `data.id` | órdenes comerciales sin firma posible | `14d3403` (previo) |
| 3 | La preferencia omitía el **costo de envío** | se cobraba el subtotal ($400) y el intent esperaba el total ($550): `amount_mismatch` y envío nunca cobrado | `_shared/mercadopago.ts` |
| 4 | `preference_id` no existe en el pago | `preference_mismatch` siempre | `paymentSnapshot` lo resuelve por el merchant order |
| 5 | `application_id` no existe en **ninguna** respuesta de MP | `application_mismatch` siempre | `20260806140000` — se asevera sólo si el proveedor lo envía; `collector_id` sigue siendo obligatorio |
| 6 | Credenciales de prueba informan `live_mode: true` | `live_mode_mismatch` en todo intent `test` | `20260806140000` — la igualdad se exige **sólo en producción** |
| 7 | `finalize_paid_checkout_session` descartaba el `address_snapshot` | el pedido llegaba al Panel sin número de calle y sin columnas `delivery_*` | `20260806150000` |

El guard de producción quedó intacto: en `production` se sigue exigiendo `live_mode = true`.

## 3. Compra ficticia completa

Recorrido real, dos veces (la segunda ya con el fix de dirección):

1. Storefront `https://taba2-staging.pages.dev` — producto QA sintético, delivery, perfil y
   dirección sintéticos (`QA MP E2E`, `299 400 0001`, `Calle QA E2E 100`).
2. `mercadopago-create-checkout-session` → sesión; `mercadopago-create-preference` → preferencia.
3. Checkout Pro sandbox, tarjeta de prueba Mastercard, invitado → **pago aprobado por $550
   exactos**, cargo a nombre de `Mercadopago*fake`. Operaciones `171483217005` y `171484811925`.
4. Webhook con **`signature_valid: true`** → `payment_outbox` `completed` en 1 intento →
   worker leyó el pago en la API de MP → intent `completed`, `paid_amount 550`.
5. **Pedido `LT-0034`**, `received`, $550, `payment_method mercadopago`, `delivery`,
   `delivery_address_formatted: "Calle QA E2E 100, Neuquen, Neuquen"`.

Invariantes: 1 intent por pago, 1 pedido por pago, `payment_outbox` sin pendientes,
reservas `converted`, stock del producto QA 19 → 17 (2 vendidos), `LT-0030` intacto
(`arrived`, $550, mismo `arrived_at`), `fiscal_outbox` y `fiscal_documents` en 0.

## 4. Lo que quedó abierto (no lo pude cerrar)

**La notificación firmada no se entrega sola.** Con credenciales de prueba hay dos canales:

- El `notification_url` **de la preferencia** sí entrega (llegaron 4 `payment` + 1
  `merchant_order` por compra), pero las firma la aplicación del usuario de prueba
  (`4861627125869370`). Mercado Pago **no expone esa clave**: en el panel aparece enmascarada
  y su configuración de webhooks no persiste. Descartado con evidencia: ninguna de las 4
  notificaciones capturadas valida contra la clave de la aplicación padre, probando 14
  variantes de manifiesto × 3 codificaciones de clave.
- El canal de **aplicación** (panel → Webhooks) sí firma con la clave legible y valida
  perfectamente — pero **no se dispara** con credenciales de prueba: quitar `notification_url`
  de la preferencia no produjo ninguna entrega, y `notifications_history` del MCP oficial no
  registra ni un intento.

Por eso la notificación firmada de este E2E se disparó desde **panel → Webhooks → Simular
notificación** con el `payment_id` real. Es una notificación genuina de Mercado Pago, firmada
por Mercado Pago con la clave de la aplicación, sobre un pago real; pero el disparo fue
manual. **La entrega automática con firma validable no está resuelta**, y por eso no emito la
declaración final.

Hay 30 recibos `rejected_signature` (las notificaciones orgánicas). Son terminales, no
reintentan y no encolan trabajo.

## 5. Residuo

- `LT-0033`: pedido QA de la corrida previa al fix #7; quedó sin dirección estructurada.
- Cuenta de prueba comprador `3595946910` y aplicación `TABA2 E2E Staging` `3094090776068001`,
  creadas bajo el usuario de prueba durante el diagnóstico. Inocuas, en sandbox.
- **`save_webhook` del MCP dejó la URL de producción de la app en "Not configured"**. Antes
  tenía `https://ukxqbgswjlibmnjemrzd.supabase.co` (sin path, mal formada). Conviene revisarlo
  antes de cualquier salida a producción.
- Eliminado: función de diagnóstico, bucket `taba-diag`, secret `TABA_DIAG_SECRET`, job
  huérfano del outbox y su recibo, sesiones abandonadas (inventario liberado).
- Higiene: durante el diagnóstico se leyó por CLI la `service_role` legacy de staging. Conviene
  rotarla.

## 6. Verificación

`npm test` **1011/1011**, `npm run test:webhook` **12/12**, `npm run secrets:scan` limpio,
worktree limpio, sin push. Edge Functions desplegadas: las 5 del producto, ninguna de
diagnóstico.
