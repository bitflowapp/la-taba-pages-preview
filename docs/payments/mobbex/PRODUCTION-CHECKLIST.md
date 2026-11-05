# La Taba · checklist verificable para habilitar Mobbex Checkout

Estado al 2026-11-04: **NO-GO producción.** Nada de esta lista se ejecutó contra un proyecto real. Cada ítem dice cómo
se verifica. Lo que Mobbex todavía no confirmó figura como **pendiente de Mobbex**.

Titular: el titular de La Taba (Walter), distinto del de MiFav. Mobbex (Integraciones) pidió los CUIT de los titulares:
**el de La Taba todavía no se envió** (corresponde a otro titular). Nada de esto avanza sin esa alta.

## A. Comercial y KYC (personas, no código)
- [ ] CUIT del titular de La Taba enviado a Mobbex por el titular o con su autorización.
- [ ] KYC completado por el titular en su propia cuenta (nadie comparte contraseñas).
- [ ] Comisión por medio de pago y plazo de acreditación por escrito (**no confirmados** por la documentación pública).

## B. Credenciales
- [ ] Credenciales de **prueba** de la cuenta del titular como secrets: `MOBBEX_ENABLED=true`, `MOBBEX_ENVIRONMENT=test`, `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN`, `MOBBEX_WEBHOOK_TOKEN_SECRET` (≥ 32 caracteres aleatorios).
- [ ] Producción sólo con `MOBBEX_PRODUCTION_REVIEW_STATUS=approved` y `MOBBEX_REAL_PAYMENT_CONFIRMATION=I_AUTHORIZE_REAL_MOBBEX_PAYMENT` (sin ambos, la config falla cerrada; `tests/mobbex-core.test.mjs`).
- [ ] Verificación: `scripts/mobbex/sandbox-contract-probe.mjs` contra la cuenta del titular (hoy verificado sólo con credenciales DEMO).

## C. Webhooks, firma y autenticación
- [ ] **Firma de webhook: pendiente de Mobbex** (no documentada). Vigente: token de capacidad HMAC atado a entorno+referencia, comparación en tiempo constante, cuerpo como pista y relectura autenticada de la operación.
- [ ] Formato del webhook de la cuenta (`settings.webhookFormat`): ambos formatos se aceptan (JSON y form-urlencoded).

## D. Pruebas con tarjetas oficiales (requiere una persona: Turnstile/CAPTCHA)
- [ ] `node scripts/mobbex/sandbox-pay-probe.mjs` con las tarjetas de mobbex.dev (aprobada, rechazada, pendiente). Guardar el log.
- [ ] Verificar: pago aprobado ⇒ un pedido; rechazo ⇒ sin pedido y stock liberado al vencer; reembolso parcial y total desde `mobbex-refund`.
- [ ] Fijar la forma real de la operación en `tests/mobbex-core.test.mjs`.

## E. Migraciones
- [ ] `20261103010000_mobbex_checkout_foundation.sql`, `20261103020000_mobbex_operational_alert.sql`, `20261105010000_mobbex_merchant_console.sql` y `20261105020000_mobbex_attention_readers.sql` (en ese orden) primero en **staging**. Rollback en orden inverso (los lectores antes que la consola, que borra la tabla de reconocimientos).
- [ ] Verificación local ya disponible: `TABA_LOCAL_PAYMENT_DB=1 node scripts/mobbex/run-mobbex-db-tests.mjs --native` (136 + 25 + 48 + 29 aserciones, rollback drills de las 4 migraciones, huella de Mercado Pago idéntica) y `node scripts/mobbex/run-mobbex-concurrency.mjs --native` (8 escenarios con sesiones simultáneas reales). El banco canónico es el de Docker en CI (`payment-certification.yml`).
- [ ] Rollback de esquema probado: `docs/migrations/rollback/…foundation.rollback.sql` (se niega si ya hay dinero).

## F. Activación por capas
- [ ] Secret de plataforma + `configure_mobbex_business(…, 'test', …)` + comercio abierto/verificado.
- [ ] En producción: `authorize_mobbex_live_payment` por compra (importe máximo, persona, vencimiento).
- [ ] Cambio test ⇒ producción: desde el 2026-11-04 los checkouts, lecturas y el worker se niegan a mezclar entornos (`tests/mobbex-flows.test.mjs` «environment: …»). Igual: vaciar checkouts abiertos antes de cambiar.

## G. Cron
- [ ] Vault: `taba_payment_worker_hmac_secret` (el de Mercado Pago) y `taba_mobbex_worker_url`.
- [ ] Aplicar `deploy/mobbex/mobbex-worker-cron.template.sql`; ejecutar su `cron.schedule` sólo al habilitar. Trampa: la firma usa la ruta canónica de `mercadopago-payment-worker` (`tests/mobbex-worker-cron-template.test.mjs`).
- [ ] **Requisito**: sin el worker no hay barrido de vencimientos ni recuperación de avisos perdidos.

## H. Monitoreo
- [ ] `select public.set_mobbex_health_alert('<comercio>', true)` (panel de alertas: pago sin pedido, revisión, conciliación trabada).
- [ ] `select public.mobbex_pipeline_health()`: desde el 2026-11-04 incluye `refunds_unresolved` (reembolsos sin resolver > 1 h) en `needs_attention`.

## I. Rollback
- [ ] Inmediato: `MOBBEX_ENABLED` ≠ `true` (la opción desaparece; MP/efectivo intactos).
- [ ] Frontend: revertir el commit del PR y re-firmar `CACHE_NAME`.

## I2. Consola del comercio (Panel › Cobros Mobbex) — verificar en staging antes de producción
- [ ] Con un dueño: la lista muestra los cobros de **su** comercio y ninguno de otro (probar con dos comercios).
- [ ] Con un empleado (`staff`): ve la lista, **no** ve «Devolver», «Consultar» ni «Armar el pedido».
- [ ] «Consultar a Mobbex» sobre un cobro `pending` encola UNA relectura (repetir el clic no crea otra) y el estado se actualiza solo.
- [ ] Una devolución parcial de prueba (sandbox propio): queda «Pedida/Enviada, verificando» y después «Devuelta»; el saldo baja; el botón no reaparece mientras haya una en curso.
- [ ] Cortar la red a mitad de una devolución: reintentar usa la MISMA clave y no crea una segunda devolución (`select count(*) from mobbex_refunds where payment_intent_id = '<id>'` = 1).

## J. Primera operación controlada
- [ ] Una compra real de importe mínimo autorizada por el titular con `authorize_mobbex_live_payment`.
- [ ] Verificar: operación en el panel de Mobbex = intent (`paid_amount`, `provider_payment_id`) = pedido; stock descontado una vez.
- [ ] Reembolso total de esa compra y verificación en el panel.
