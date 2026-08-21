# Auditoría READ-ONLY · Estado de PAGOS de La Taba en producción

- Fecha de medición: 2026-08-21 (UTC)
- Producción: `https://la-taba.pages.dev` · Supabase `wwcpogltfgzgkrlilbcd` · business `00000000-0000-4000-8000-000000000001`
- Método: código del worktree (`main` productivo `95ac129`) + `node scripts/consulta-solo-lectura.mjs` (runner que sólo acepta UNA sentencia SELECT/WITH) + fetch GET simple al sitio público y a los endpoints de Edge Functions (sin auth, sin cuerpo, sin mutación).
- CERO mutaciones. Nota: se intentó listar los NOMBRES de secretos de `vault.secrets` y el clasificador de permisos lo bloqueó; se respetó el bloqueo (no era imprescindible).

## 1 · Medios de pago que el cliente ve HOY

Selector publicado (HTML vivo descargado de `https://la-taba.pages.dev/`, archivo `produccion-index-live.html`; idéntico a `index.html:616-634` del worktree):

| valor | etiqueta | disponibilidad |
|---|---|---|
| `coordinate` | «A coordinar con el local» | **siempre** (opción por defecto) |
| `cash` | «Efectivo al recibir» | **siempre** (con campo opcional de vuelto `cashChange`) |
| `mercadopago` | «Mercado Pago — Tarjeta, débito o dinero en cuenta» | **sólo si** la RPC `get_mercadopago_checkout_availability` devuelve `available=true`; hoy NO aparece |

Determinantes de disponibilidad (medidos, no supuestos):

- `runtime-config.js` del sitio vivo (archivo `produccion-runtime-config.js`): `mode: 'production'`, apunta a `wwcpogltfgzgkrlilbcd`, mismo businessId. En modo production el cliente consulta la RPC al entrar al carrito (`js/app.js:594,2114,2139` → `refreshMercadoPagoCheckoutAvailability` en `js/app.js:634-656`); fuera de production MP se fuerza a apagado (`js/app.js:760`).
- La opción MP se agrega/quita dinámicamente en `js/ui.js:3141-3157` (`setMercadoPagoCheckoutAvailability`).
- RPC (definida en `supabase/migrations/20260802090000_mercadopago_checkout_pro_foundation.sql:795-825`): exige `businesses.is_active ∧ status='open' ∧ ordering_enabled ∧ ordering_verified` **y** una fila en `business_payment_settings` con `enabled ∧ provider='mercadopago' ∧ checkout_mode='checkout_pro' ∧ currency='ARS' ∧ (environment≠'production' ∨ production_review_status='approved')`.
- CHECK de la base `orders_payment_method_valid` (`20260806170000_order_payment_modality_integrity.sql:26-28`): `mercadopago | cash | coordinate | qa_no_charge`. `qa_no_charge` exige `origin='qa'` (líneas 31-34). El test `tests/payment-methods-contract.test.mjs` ata lo OFRECIDO a lo ACEPTADO.
- Combos: en production sólo se ofrecen si MP está disponible (`js/app.js:623-656`); hoy hay **0 combos activos** (`produccion-catalogo-conteo.json`), así que no hay callejones sin salida.

## 2 · Mercado Pago: NO configurado en producción (ni TEST ni PROD)

| medición | resultado | archivo |
|---|---|---|
| `business_payment_settings` (producción) | **0 filas** para el business (y 0 en total) | `produccion-business-payment-settings.json`, `produccion-conteos-pago.json` |
| RPC `get_mercadopago_checkout_availability` en producción (SELECT de función `stable`) | `{"available":false,"environment":null,"checkout_mode":null,...}` | `produccion-rpc-mp-availability.json` |
| Edge Functions MP en producción (GET sin auth) | `mercadopago-create-checkout-session`, `-checkout-status`, `-webhook`, `-payment-worker`, `-create-preference` → **todas HTTP 404 `NOT_FOUND` del gateway = NO desplegadas** | `probe-*.txt` |
| Mismo sondeo en staging (control del método) | HTTP 405 `METHOD_NOT_ALLOWED` = desplegadas y vivas | `probe-staging-*.txt` |
| `checkout_sessions` / `payment_intents` / `payment_outbox` / `payment_webhook_receipts` en producción | **0 · 0 · 0 · 0** | `produccion-conteos-pago.json`, `produccion-outbox-conteo.json` |
| Staging (comparación) | 1 fila: `enabled=true, environment='test', production_review_status='not_requested'`, con collector_id | `staging-business-payment-settings.json` |

Además, el código del backend exige para producción real: `MERCADOPAGO_ENVIRONMENT=production` **y** `MERCADOPAGO_PRODUCTION_REVIEW_STATUS='approved'` (`supabase/functions/_shared/payment-runtime.ts:192-201`), `MERCADOPAGO_ACCESS_TOKEN` (`_shared/mercadopago.ts:126`), `MERCADOPAGO_WEBHOOK_SECRET` (`mercadopago-webhook/index.ts:50`), más `PAYMENT_LOG_HASH_SALT`, `PAYMENT_WORKER_SECRET`, `TABA_CHECKOUT_BASE_URL`, `TABA_ALLOWED_ORIGINS` (nombres leídos del código; los valores no se tocaron). El cron `taba-payment-outbox-worker` ya corre cada 30 s en producción (`produccion-cron-jobs.json`) pero su despacho es no-op seguro sin la config de Vault y sin la función desplegada (`20260803120000_mercadopago_staging_worker_scheduler.sql:49-52`).

**Conclusión:** MP en producción está **ausente por completo** (sin fila de settings, sin funciones, sin secretos que las funciones puedan usar). No es «TEST»: es NADA. La memoria previa queda confirmada y precisada.

## 3 · Efectivo / coordinar: HABILITADO y probado hasta `on_the_way`

Gates del business en producción (`produccion-business-gates.json`):
`is_active=true · status='open' · ordering_enabled=true · ordering_verified=true (2026-08-18) · delivery_enabled=true · pickup_enabled=false · hours_enforced=false · delivery_zone_enforced=false · delivery_fee=0 · minimum_delivery_subtotal=0 · whatsapp_phone=null · alcohol_sales_enabled=false`

RPC `commerce_availability(...,'delivery')` en producción (`produccion-commerce-availability.json`): `ordering_ready=true, is_open=true, delivery.eligible=true, fee 0, mínimo 0` — la ruta directa `create_order_with_items` está abierta las 24 h y sin restricción de zona. Los mismos gates los revalida la RPC al insertar (`20260725030000_taba_production_orders.sql:602` y sucesoras).

Circuito del cobro físico:
- El vuelto viaja como nota del pedido (`js/orders.js:157,229,663`).
- El rider recibe `payment_method` y `collection_amount = total` cuando es `cash` (`20260815020000_rider_order_offers.sql:159-161`).
- Prueba real: **LT-0001** (abajo) recorrió recibido → confirmado → preparación → listo → oferta a rider → aceptada → `on_the_way`.

Salvedad honesta: la traza de LT-0001 (`produccion-LT-0001-eventos.json`) termina en `order.rider_issue_reported` (2026-08-18 04:51 UTC) y el pedido sigue `on_the_way` tres días después: la **entrega confirmada + cobro efectivo cerrado** todavía no se demostraron en producción de punta a punta.

## 4 · Riesgo de comprobantes falsos: NO existe ese vector en el checkout

- No hay opción «transferencia» ni carga de comprobante en el flujo del cliente: el `<select>` publicado sólo tiene `coordinate|cash` (+MP dinámico). «Transferencia al confirmar» se RETIRÓ a propósito porque el CHECK la rechazaba (comentario en `index.html:619-629`); el test `tests/payment-methods-contract.test.mjs:86-90` impide reintroducirla sin flujo real.
- Un pedido no puede declararse «pagado con MP» sin un `payment_intent` `completed` verificado contra el proveedor: constraint trigger diferido `orders_assert_payment_modality` (`20260806170000:40-69`).
- Los «comprobantes» que aparecen en `js/business/*` son comprobantes FISCALES (ARCA) que emite el negocio, y el medio `transfer` de `register_scan_sale` es del POS presencial del local (staff autenticado, `20260802160000:674,701`) — ninguno es un canal para que un cliente presente un comprobante de pago.
- Residual: `cash`/`coordinate` son promesas, no pagos — el riesgo es no-pago en la puerta (inherente al contraentrega), no falsificación dentro del sistema.

## 5 · Qué falta EXACTAMENTE para cobrar

### (a) En efectivo — nada técnico: se puede vender HOY
- P0: **ninguno.** Selector publicado, gates abiertos, pedido real creado y despachado (LT-0001, `cash`).
- P1 (antes de publicidad masiva):
  1. Cerrar UNA venta física completa (entrega con código + cobro) — LT-0001 quedó `on_the_way` con incidente de rider reportado y nadie la resolvió en 3 días (`produccion-LT-0001-eventos.json`).
  2. Definir el canal de coordinación para `coordinate`: `whatsapp_phone` es NULL en producción — hoy «coordinar» = el local llama al teléfono que dejó el cliente; con volumen, eso es un cuello operativo.
  3. Runbook de pedidos colgados (`on_the_way` viejos) — el caso ya existe.
- P2: política de vuelto/caja para riders; decidir si `pickup_enabled=false` es intencional (hoy sólo delivery).

### (b) Con Mercado Pago production — hoy es imposible; lista completa
- P0 (para que MP exista en producción):
  1. Desplegar las Edge Functions MP al proyecto `wwcpogltfgzgkrlilbcd` (hoy 404).
  2. Configurar los secretos que el código exige: `MERCADOPAGO_ACCESS_TOKEN` (credencial PROD real), `MERCADOPAGO_ENVIRONMENT=production`, `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`, `MERCADOPAGO_WEBHOOK_SECRET`, `PAYMENT_LOG_HASH_SALT`, `PAYMENT_WORKER_SECRET`, `TABA_CHECKOUT_BASE_URL=https://la-taba.pages.dev`, `TABA_ALLOWED_ORIGINS` con ese origin.
  3. Crear la fila `business_payment_settings` (enabled, environment='production', production_review_status='approved', collector_id) — sin ella la RPC devuelve `available=false` y la opción ni aparece.
  4. Alta del webhook en el panel de MP apuntando a `/functions/v1/mercadopago-webhook` + secreto de firma.
  5. Config de Vault para el despacho del worker (`taba_payment_worker_url`, `taba_payment_worker_hmac_secret`) — el cron ya corre y hoy no-opea.
  6. Cuenta MP real del comercio con credenciales de producción aprobadas (gate humano/comercial, no de código).
- P1: smoke de pago real controlado (el código lo exige explícito vía `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION`, `payment-runtime.ts:203-211`); verificación punta a punta del webhook con firma; revisar el P1 conocido de navegación-atrás (`MP-BACK-NAVIGATION-P1.md` en la raíz del worktree).
- P2: combos (hoy 0 activos) recién tienen sentido con MP vivo; política de reembolsos (`refund_policy`) y `installments_limit`.

## 6 · LT-0001 (único pedido de producción)

`produccion-LT-0001.json`:

```json
{"public_code":"LT-0001","status":"on_the_way","payment_method":"cash","origin":"production","total":"17100.00","fulfillment_type":"delivery","created_at":"2026-08-18 03:25:15.125791+00"}
```

**Se hizo con `cash` («Efectivo al recibir»)**, total $17.100, delivery, y es el ÚNICO pedido de la base (`produccion-orders-por-metodo.json`: 1 fila). Sin sesión de checkout ni intent de pago asociados (0 en toda la base). Traza completa en `produccion-LT-0001-eventos.json`; sin evento de entrega: el efectivo de ese pedido no consta como cobrado.

## Archivos de esta carpeta

| archivo | qué es |
|---|---|
| `produccion-business-gates.json` | fila de `businesses` (gates de pedidos) |
| `produccion-business-payment-settings.json` | settings MP en producción (vacío) |
| `produccion-rpc-mp-availability.json` | salida real de la RPC de disponibilidad |
| `produccion-conteos-pago.json` · `produccion-outbox-conteo.json` | conteos de sesiones/intents/outbox/receipts |
| `produccion-orders-por-metodo.json` | distribución de pedidos por método |
| `produccion-LT-0001.json` · `produccion-LT-0001-eventos.json` | el pedido real y su traza |
| `produccion-commerce-availability.json` | disponibilidad comercial delivery |
| `produccion-catalogo-conteo.json` | 0 combos activos · 33/60 productos comprables |
| `produccion-cron-jobs.json` | jobs pg_cron activos en producción |
| `produccion-runtime-config.js` · `produccion-index-live.html` | lo que el sitio vivo sirve |
| `probe-*.txt` · `probe-staging-*.txt` | sondeos GET a Edge Functions (404 prod / 405 staging) |
| `staging-business-payment-settings.json` | comparación staging (TEST) |
