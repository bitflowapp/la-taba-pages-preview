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
- **Webhook.** La documentación oficial de Mobbex (https://mobbex.dev/checkout, sección «Retorno y WebHooks») **no documenta ninguna firma, HMAC ni secreto**. Por eso no se inventó una: la URL del webhook que registramos al crear el checkout lleva un token de capacidad propio (HMAC-SHA256 con `MOBBEX_WEBHOOK_TOKEN_SECRET` sobre entorno+referencia), el cuerpo se trata como *pista* y **todo cambio de estado se confirma con una lectura autenticada de la operación**. El cuerpo puede llegar en JSON o `application/x-www-form-urlencoded` (la documentación oficial se contradice y el formato es configurable por cuenta): ambos se aceptan como pista. Tráfico falso se corta antes de escribir nada.
- **Idempotencia y orden.** Recibo de webhook deduplicado, una sola cola de trabajos abierta por cobro, snapshots con orden (una lectura vieja que llega tarde no cambia nada), un pedido por checkout aunque haya varios intentos de tarjeta, `provider_payment_id` único.
- **Dinero sin pedido.** Si el pago aterriza cuando venció la reserva y ya no hay stock: no hay pedido, no hay stock negativo, queda `security_review_required` con motivo escrito y es reembolsable.
- **Reembolsos.** Sólo owner/admin con sesión registrada; clave de idempotencia; confirmación explícita (`EXPLICIT_REFUND_CONFIRMATION_REQUIRED`); un envío ambiguo se concilia, nunca se repite a ciegas. Un pedido pagado con Mobbex no se puede cancelar hasta devolver el dinero.
- **Combos** siguen siendo sólo Mercado Pago (su precio lo calcula Checkout Pro).
- **Mercado Pago, efectivo y retiro no cambian.** Huella (fingerprint) de todas las funciones y restricciones preexistentes idéntica antes/después de la migración.

## 3. Configuración (por entorno; nunca en el repo)

Secrets de Edge Functions: `MOBBEX_ENABLED` (debe ser exactamente `true`), `MOBBEX_ENVIRONMENT` (`test`|`production`), `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN` (de la cuenta **de Walter**, no de LUNA), `MOBBEX_WEBHOOK_TOKEN_SECRET` (≥ 32 caracteres aleatorios), y sólo para producción `MOBBEX_PRODUCTION_REVIEW_STATUS=approved` y `MOBBEX_REAL_PAYMENT_CONFIRMATION=I_AUTHORIZE_REAL_MOBBEX_PAYMENT`. El worker reutiliza `PAYMENT_WORKER_SECRET`.

`supabase/config.toml`: `mobbex-webhook` y `mobbex-worker` son `verify_jwt = false` (el primero lo llama Mobbex, el segundo un scheduler y exige firma de worker). El resto exige JWT.

**Scheduler (preparado, NO desplegado; lo activa quien despliega).** `mobbex-worker` debe invocarse cada ~60 s con la firma de worker, igual que el worker de Mercado Pago (`20260803120000_mercadopago_staging_worker_scheduler.sql`). La plantilla lista para usar es `deploy/mobbex/mobbex-worker-cron.template.sql` (fuera de `supabase/migrations`, con la programación comentada); ver [CERTIFICATION.md](CERTIFICATION.md#programar-la-conciliación). Sin él siguen funcionando el webhook y la lectura al volver, pero no el barrido de vencimientos ni la recuperación de webhooks perdidos: **es requisito para producción**.

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
| Job en `dead_letter` con `last_error = environment_mismatch` | El intent es de otro entorno (p. ej. checkout de prueba abierto al pasar a producción) | Nunca se lee con las credenciales del entorno actual ni crea pedido. Verificar en el panel de Mobbex del entorno del intent; si hubo cobro de prueba, no es dinero; si fue real, reembolsar desde ese entorno. |
| `refunds_unresolved` > 0 | Reembolso enviado sin respuesta guardada (> 1 h) | Al marcarlo enviado se encola una relectura; un 602/605 lo cierra solo. Si persiste: revisar el panel de Mobbex y `mobbex_refunds`. |
| Cliente reintenta tras perder la vuelta | — | El navegador retoma el mismo checkout (misma referencia) o frena con aviso; no abre una segunda sesión mientras la anterior pueda cobrar. |
| Cambiar de proveedor | — | Apagar `MOBBEX_ENABLED`; los pedidos y cobros abiertos se siguen conciliando mientras el flag lo permita; efectivo/MP no se tocan. |

`mobbex_pipeline_health()` es la señal de alerta: sólo marca `needs_attention` cuando una persona debe intervenir. Está **integrada al panel de alertas operativas existente y APAGADA**: la migración aditiva `20261103020000_mobbex_operational_alert.sql` agrega tres alertas por comercio (`MOBBEX_PAID_WITHOUT_ORDER`, `MOBBEX_PAYMENT_NEEDS_REVIEW`, `MOBBEX_RECONCILIATION_STUCK`) que sólo aparecen cuando alguien habilita `select public.set_mobbex_health_alert('<comercio>', true)` (rol de servicio). Con el flag en `false` —el default— la reconciliación de alertas se comporta igual que antes. Rollback: `docs/migrations/rollback/20261103020000_mobbex_operational_alert.rollback.sql`. Límite: `attention_reason` sólo se limpia con un reembolso completo (igual que en `mobbex_pipeline_health()`), así que una alerta por «atención» persiste hasta que la persona la resuelva en el panel o se reembolse.

Checklist de producción verificable: [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md).

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
| `npm test` (suite completa, 3399 pruebas) | **3399/3399 pasan**, exit 0 (dependencias instaladas con `npm ci --ignore-scripts`; una corrida previa sin ellas no es evidencia válida y se descartó) |
| Contrato SQL desde un clúster nuevo, sobre el commit final | 96/96, huella intacta, drill de rollback y negativa con dinero en PASS |

**Límites honestos.**
- La base de integración corrió en **PostgreSQL nativo con stubs de `pg_cron`/`pg_net`/`supabase_vault`**, porque Docker no estaba utilizable (ver `INFRA-RECOVERY.md`). Es un fixture **más débil** que la imagen fija de Supabase: la compuerta canónica es el banco Docker de CI. Hay que repetirla allí.
- Las funciones Edge **pasan `deno check`** (Deno 2.6.1, el fijado por el repo, `npm run check:edge`, 19 entradas), pero **no se ejecutaron bajo Deno ni contra Supabase real**; la lógica se probó como funciones puras con puertos falsos y un Mobbex simulado. `tests/mobbex-edge-sql-contract.test.mjs` cubre lo que esos puertos falsos no pueden: que cada llamada Edge→base use scopes, funciones y argumentos que existen de verdad.
- **No hubo sandbox auténtico de Mobbex** (no hay cuenta ni credenciales de prueba). Los contratos de API salen de la documentación oficial; `scripts/mobbex/sandbox-*-probe.mjs` ejecutan la certificación en cuanto existan credenciales de prueba. Eso no se afirma como hecho.
- No se probó dinero real. Nada de lo anterior atribuye pagos reales a mocks.
- No se probó en navegador (E2E): el flujo de UI se cubrió con pruebas de módulo y revisión de código.

## GO / NO-GO

| Alcance | Decisión |
|---|---|
| Mergear el PR borrador a `main` con Mobbex **apagado** (default) | **GO condicionado**: tras revisión humana y E2E de navegador. El contrato SQL ya corre en el CI (job `financial_sql`, PostgreSQL 16 con stubs de las extensiones de Supabase; la imagen fija en Docker sigue sin ejecutarse). Con la opción apagada el cambio de comportamiento para clientes es nulo. |
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

## 8. Revisión de seguridad e idempotencia (2026-11-03) y qué cambió

Revisión del código Edge y de las funciones SQL de dinero. Detalle y comandos en [CERTIFICATION.md](CERTIFICATION.md).

| Hallazgo | Gravedad | Estado |
|---|---|---|
| Las cuatro funciones Edge usaban *scopes* de rate limit (`mobbex_checkout`, `mobbex_refund`, `mobbex_status`, `mobbex_webhook`) que `consume_payment_rate_limit` rechaza → 429 permanente: con Mobbex encendido **no se podía crear el checkout** y el webhook se descartaba | Bloqueante | **Corregido** (scopes existentes + sujeto `mobbex:`) y blindado con un test de contrato que falla con el código anterior |
| `mobbexOperations()` tipada como puerto sin `refundOperation`: `deno check` fallaba | Alta (despliegue con tipos) | **Corregido** |
| Una referencia con varios intentos (tarjeta rechazada y luego aprobada) podía leerse como «rechazada» si la operación principal no era la aprobada → liberaba el stock de una compra pagada | Alta (condicional a la forma real de la respuesta, sin verificar) | **Mitigado**: el *snapshot* se niega (`conflicting_operations`) y el trabajo termina en la alerta, nunca en una conjetura |
| Temporizador del camino rápido del webhook sin limpiar | Baja | Corregido |
| `payment.total` con financiación (cuotas con interés) podría diferir del importe esperado → `amount_mismatch` → revisión manual | Abierto (negocio) | Verificar en el sandbox con una compra en cuotas |
| El token del webhook va en la URL (puede quedar en logs de acceso de Mobbex/proxies) | Aceptado | Sin firma documentada por Mobbex; replay inofensivo por la confirmación autenticada |

Lo que se revisó y está bien: permisos (todo revocado salvo cinco RPC del navegador, cada una con verificación de dueño/rol en la base), comparación del token en tiempo constante, host de redirección sólo `*.mobbex.com` por HTTPS, `redirect: 'error'`, total sólo del servidor, un único pedido por checkout, snapshots ordenados con el dinero ganando sobre estados viejos, pagos tardíos sin stock a revisión y reembolsables.
