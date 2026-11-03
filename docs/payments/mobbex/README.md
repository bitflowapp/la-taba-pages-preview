# Mobbex Checkout para La Taba — guía técnica, runbook y GO/NO-GO

Encargo: issue #163. Rama: `feat/la-taba-mobbex-checkout`. PR **borrador**: no fusionar, no desplegar.

**Veredicto: `TECHNICALLY READY` (código + pruebas locales). `NOT READY FOR LIVE PAYMENT`.**
Ver [GO / NO-GO](#go--no-go) al final: faltan pasos que sólo puede hacer el titular de la cuenta de Mobbex.

## 1. Qué hay

| Capa | Archivos |
|---|---|
| Migración aditiva + rollback | `supabase/migrations/20261103010000_mobbex_checkout_foundation.sql`, `docs/migrations/rollback/20261103010000_mobbex_checkout_foundation.rollback.sql` |
| Funciones Edge | `supabase/functions/mobbex-{availability,create-checkout,checkout-status,webhook,worker,refund}` |
| Lógica pura (inyectable, sin red) | `supabase/functions/_shared/mobbex/` (`handlers`, `customer-handlers`, `client`, `config`, `status`, `snapshot`, `webhook`) |
| Adaptador | `supabase/functions/_shared/payment-provider.ts` (`PaymentProvider`; Mercado Pago no se modifica) |
| Frontend | `js/payments/mobbex-checkout.js`, `js/payments/mobbex-return.js`, `pago/mobbex/`, ganchos aditivos en `js/app.js`, `js/ui.js`, `js/repositories/supabase_order_repository.js` |
| Pruebas | `tests/mobbex-{core,flows,frontend}.test.mjs`, `supabase/tests/mobbex_ledger.local.sql`, `scripts/mobbex/run-mobbex-db-tests.mjs` |

## 2. Reglas que el código hace cumplir

- **Apagado por defecto, en cuatro capas.** Secret de plataforma `MOBBEX_ENABLED=true` **y** ajuste por comercio (`configure_mobbex_business`) **y** comercio abierto/verificado **y**, en producción, autorización abierta *para esa persona* (`authorize_mobbex_live_payment`). Sin todo eso, la opción no existe en el selector.
- **El total lo fija el servidor.** `create_mobbex_checkout_session` precia con el precio vigente, stock reservado, envío, descuentos y cobertura. El navegador no manda importes (probado en `tests/mobbex-frontend.test.mjs`) y la Edge Function lee el total de la sesión guardada.
- **Volver del navegador nunca marca pagado.** `pago/mobbex/` sólo le pregunta al servidor, y el servidor lee la operación en Mobbex con credenciales propias. El carrito se limpia únicamente con `completed` del servidor.
- **Webhook.** La documentación oficial de Mobbex (https://mobbex.dev/checkout, sección «Retorno y WebHooks») **no documenta ninguna firma, HMAC ni secreto**. Por eso no se inventó una: la URL del webhook que registramos al crear el checkout lleva un token de capacidad propio (HMAC-SHA256 con `MOBBEX_WEBHOOK_TOKEN_SECRET` sobre entorno+referencia), el cuerpo se trata como *pista* y **todo cambio de estado se confirma con una lectura autenticada de la operación**. Tráfico falso se corta antes de escribir nada.
- **Idempotencia y orden.** Recibo de webhook deduplicado, una sola cola de trabajos abierta por cobro, snapshots con orden (una lectura vieja que llega tarde no cambia nada), un pedido por checkout aunque haya varios intentos de tarjeta, `provider_payment_id` único.
- **Dinero sin pedido.** Si el pago aterriza cuando venció la reserva y ya no hay stock: no hay pedido, no hay stock negativo, queda `security_review_required` con motivo escrito y es reembolsable.
- **Reembolsos.** Sólo owner/admin con sesión registrada; clave de idempotencia; confirmación explícita (`EXPLICIT_REFUND_CONFIRMATION_REQUIRED`); un envío ambiguo se concilia, nunca se repite a ciegas. Un pedido pagado con Mobbex no se puede cancelar hasta devolver el dinero.
- **Combos** siguen siendo sólo Mercado Pago (su precio lo calcula Checkout Pro).
- **Mercado Pago, efectivo y retiro no cambian.** Huella (fingerprint) de todas las funciones y restricciones preexistentes idéntica antes/después de la migración.

## 3. Configuración (por entorno; nunca en el repo)

Secrets de Edge Functions: `MOBBEX_ENABLED` (debe ser exactamente `true`), `MOBBEX_ENVIRONMENT` (`test`|`production`), `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN` (de la cuenta **de Walter**, no de LUNA), `MOBBEX_WEBHOOK_TOKEN_SECRET` (≥ 32 caracteres aleatorios), y sólo para producción `MOBBEX_PRODUCTION_REVIEW_STATUS=approved` y `MOBBEX_REAL_PAYMENT_CONFIRMATION=I_AUTHORIZE_REAL_MOBBEX_PAYMENT`. El worker reutiliza `PAYMENT_WORKER_SECRET`.

`supabase/config.toml`: `mobbex-webhook` y `mobbex-worker` son `verify_jwt = false` (el primero lo llama Mobbex, el segundo un scheduler y exige firma de worker). El resto exige JWT.

**Scheduler (pendiente, lo hace quien despliega).** `mobbex-worker` debe invocarse cada ~60 s con la firma de worker, igual que el worker de Mercado Pago (`20260803120000_mercadopago_staging_worker_scheduler.sql`). Sin él siguen funcionando el webhook y la lectura al volver, pero no el barrido de vencimientos ni la recuperación de webhooks perdidos: **es requisito para producción**.

## 4. Onboarding seguro del titular (Walter)

1. El titular abre su cuenta Mobbex y completa el KYC **él mismo**; nadie comparte su contraseña.
2. El titular genera credenciales de **prueba** y las carga como secrets (o las entrega por canal seguro a quien despliega); LUNA/Claude no las ven ni las guardan.
3. Se registra el comercio en modo `test` con `configure_mobbex_business(..., 'test', ...)` y se corre la certificación sandbox (ver §7).
4. Recién con aprobación por escrito: credenciales de producción, `production_review_status = approved`, y **una autorización por compra** (`authorize_mobbex_live_payment`, importe máximo, persona y vencimiento definidos). Se consume al usarse.
5. Los costos reales (comisión por medio de pago y plazo de acreditación) **no se pudieron confirmar** desde la documentación pública: deben salir del contrato de la cuenta de Walter antes de abrir ventas.

## 5. Runbook

| Síntoma | Qué mirar | Acción |
|---|---|---|
| Pago hecho, sin pedido | `select public.mobbex_pipeline_health()` → `paid_without_order` | El barrido (`mobbex_sweep`) vuelve a encolar el cobro y el worker lo reconcilia y lo finaliza solo. Si no alcanza, un owner/admin puede forzarlo con `mobbex_recover_paid_checkout(intent_id)`. Si queda en `security_review_required` (sin stock): reembolsar con `mobbex-refund`. |
| Trabajos en `dead_letter` | `needs_attention = true` | Revisar `mobbex_jobs.last_error`; corregir causa (credenciales, caída del proveedor); `select public.mobbex_requeue_dead_letter()`. |
| Caída de Mobbex | `oldest_open_job_seconds` crece | Nada que hacer: backoff con reintentos; el checkout vencido libera el stock. Si dura, apagar con el flag. |
| Webhooks falsos o repetidos | 401 `INVALID_WEBHOOK` / `duplicate: true` | Esperado; no escriben nada ni duplican pedidos. |
| Cambiar de proveedor | — | Apagar `MOBBEX_ENABLED`; los pedidos y cobros abiertos se siguen conciliando mientras el flag lo permita; efectivo/MP no se tocan. |

`mobbex_pipeline_health()` es la señal de alerta: sólo marca `needs_attention` cuando una persona debe intervenir. **No está enchufada todavía** al panel de alertas operativas existente (hacerlo exige modificar funciones preexistentes y su propia revisión); hoy se consulta o se programa su lectura.

## 6. Rollback

- **Inmediato (sin tocar datos):** `MOBBEX_ENABLED` distinto de `true` → la opción desaparece, el webhook responde 200 «disabled», el worker no hace nada. Efectivo y Mercado Pago siguen igual.
- **De esquema:** ejecutar `docs/migrations/rollback/20261103010000_mobbex_checkout_foundation.rollback.sql`. **Se niega a correr si ya se registró dinero** (protege la contabilidad); está probado: sube → baja → sube y la negativa con dinero.
- Frontend: revertir el commit del PR; `CACHE_NAME` vuelve a `la-taba-runtime-v170-payment-review` (re-firmar con `node scripts/check-release-identity.mjs --write`).

## 7. Evidencia real de esta rama

| Prueba | Resultado |
|---|---|
| `tests/mobbex-{core,flows,frontend}.test.mjs` | **40/40** (webhook falso, duplicado, tardío/fuera de orden, simultáneo, importes arbitrarios, red caída, reembolso, URL hostil, registro local) |
| Contrato SQL `mobbex_ledger.local.sql` en PostgreSQL real | **96 aserciones OK** (stock, vencimiento, pago tardío, sin stock, reembolsos, cancelación, autorización de un solo uso, aislamiento entre comercios) |
| Huella de funciones/restricciones preexistentes | Idéntica antes/después de la migración |
| Rollback | up → down → up PASS; se niega con dinero PASS |
| `npm run check` | exit 0 (higiene, identidad de release, precache, codificación UTF-8, escaneo de secretos) |
| `npm test` (suite completa existente) | ver `evidence/` y el cuerpo del PR |

**Límites honestos.**
- La base de integración corrió en **PostgreSQL nativo con stubs de `pg_cron`/`pg_net`/`supabase_vault`**, porque Docker no estaba utilizable (ver `INFRA-RECOVERY.md`). Es un fixture **más débil** que la imagen fija de Supabase: la compuerta canónica es el banco Docker de CI. Hay que repetirla allí.
- No se ejecutó ninguna función Edge bajo Deno ni contra Supabase real; la lógica se probó como funciones puras con puertos falsos y un Mobbex simulado.
- **No hubo sandbox auténtico de Mobbex** (no hay cuenta ni credenciales de prueba). Los contratos de API salen de la documentación oficial; `scripts/mobbex/sandbox-*-probe.mjs` ejecutan la certificación en cuanto existan credenciales de prueba. Eso no se afirma como hecho.
- No se probó dinero real. Nada de lo anterior atribuye pagos reales a mocks.
- No se probó en navegador (E2E): el flujo de UI se cubrió con pruebas de módulo y revisión de código.

## GO / NO-GO

| Alcance | Decisión |
|---|---|
| Mergear el PR borrador a `main` con Mobbex **apagado** (default) | **GO condicionado**: tras revisión humana, repetir contrato SQL en el banco Docker de CI y E2E de navegador. Con la opción apagada el cambio de comportamiento para clientes es nulo. |
| Staging con credenciales de **prueba** | **GO** cuando exista cuenta/credenciales de prueba y se programe el worker. Correr `scripts/mobbex/sandbox-contract-probe.mjs`. |
| **Cobro real** | **NO-GO** hasta: (1) KYC y credenciales del titular, (2) sandbox auténtico aprobado, (3) worker programado, (4) costos y acreditación confirmados por contrato, (5) alerta `mobbex_pipeline_health` conectada, (6) autorización expresa por compra. |

## Matriz de riesgo

| Riesgo | Mitigación | Estado |
|---|---|---|
| Webhook falsificado | Token de capacidad + confirmación autenticada; sin firma documentada (no se inventó) | Probado (local) |
| Doble pedido por un pago | Intención única, snapshots ordenados, pedido único por checkout | Probado (SQL real) |
| Cobro sin stock | Sin pedido, razón escrita, reembolsable | Probado (SQL real) |
| Importe manipulado | Total sólo del servidor; `amount_mismatch` → revisión | Probado |
| Pérdida de webhook | Cola con backoff + barrido + lectura al volver | Probado local; **requiere scheduler** |
| Reembolso duplicado/ambiguo | Idempotencia durable, conciliación por identidad | Probado local |
| Mobbex ofrecido sin autorización | Cuatro compuertas, apagado por defecto | Probado local |
| Divergencia de contrato con Mobbex real | Sandbox auténtico pendiente | **Abierto** |
| Fixture SQL más débil que producción | Repetir en banco Docker de CI | **Abierto** |
