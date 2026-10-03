# Matriz de Gates E2E — TABA2 E2E Test Staging
**Fecha**: 2026-08-05  
**Agente**: TABA2_E2E_TEST_STAGING

---

## Gate 0 — Inventario Técnico

| Ítem | Estado | Detalle |
|---|---|---|
| Worktrees (10 esperados) | ✅ PASS | Todos presentes, HEADs y ramas correctos |
| Git limpio | ✅ PASS | Todos excepto main (35 dirty, no forma parte del RC) |
| Git operations en curso | ✅ PASS | Ninguna (no MERGE, REBASE, CHERRY_PICK) |
| Secrets en Git | ✅ PASS | Solo .env.example — ningún secreto real |
| RC1 certificado | ✅ PASS | TABA2_RC1_BUSINESS_PANEL_INTEGRATION_CERTIFIED_B6D27DA |
| Locks | ⚠️ WARNING | 2 locks resueltos, 1 stale (rider-staging-smoke) |
| Disco E: | ❌ RISK | 2.2 GB libre — gestionar antes de Gate 1 heavy |
| Disco D: | ✅ PASS | 68.4 GB libre |
| RAM | ⚠️ WARNING | 4.2 GB libre, Java activo (~2.2 GB) |
| Procesos bloqueantes | ⚠️ WARNING | Java Gradle activo, 2 nodos huérfanos |
| APK Rider | ⚠️ PENDING | No verificado en esta fase |
| Directorio artifacts | ✅ PASS | Creado en D:\1212\artifacts\taba2-e2e-test-staging\ |
| Grafo de commits | ✅ PASS | Documentado |
| Plan de integración | ✅ PASS | Documentado |
| Plan de migraciones | ✅ PASS | 3 migraciones pendientes identificadas |
| Superficie de secretos | ✅ PASS | Documentada |

**GATE 0**: ✅ COMPLETADO (con warnings gestionados)

---

## Gate 1 — Integración Local y Certificación

| Área | Estado | Notas |
|---|---|---|
| Crear E2E RC worktree | ✅ PASS | `D:\1212\la-taba-e2e-test-staging-rc` — **PRODUCT_E2E_HEAD=a0189bf** |
| Crear worktree certificación | ✅ PASS | `D:\1212\la-taba-e2e-test-staging-certification` — **CERTIFICATION_HARNESS_HEAD=4caa1f1**, limpio, **sin divergencia** (copia exacta del RC previo a los 2 fixes) |
| Integrar Storefront P1 + Catalog + Retail | ✅ PASS | Merge RETAIL_PUB (55+ commits, 0 conflictos) |
| Integrar commits MP_STAGING_RC1 | ⚠️ PASS CON DEFECTO | 4 cherry-picks. El de 83dc8e2 → 16f2761 **introdujo 2 regresiones** (ver Fixes) |
| Integrar commits PAYMENT_RECOVERY | ✅ PASS | 4 cherry-picks (incluye f03b1a0 conflicto resuelto) |
| Integrar 3 migraciones nuevas | ✅ PASS | 35 → **38**. Solo 3 `A` (added), 0 modificadas, 0 borradas. Validador estático exit 0 |
| Diff Edge Functions MP | ✅ PASS (CORREGIDO) | **Ningún `index.ts` cambió vs baseline.** Solo `_shared/payment-runtime.ts` (M) + `payment-worker-signature.ts` y `.deno.ts` (A). La entrada previa que decía "mercadopago-webhook + mercadopago-preference-create integradas" **era incorrecta**; además el nombre real es `mercadopago-create-preference` |
| npm run check | ✅ PASS | Sin errores de sintaxis |
| npm test | ✅ PASS | 1001 unit tests PASS |
| Secret scan | ✅ PASS | 0 secretos reales detectados |
| git diff --check | ✅ PASS | Sin whitespace errors |
| **PostgreSQL local (heavy-compute.lock)** | ⚠️ BLOQUEADO Y CLASIFICADO | **BRECHA-01 CERRADA por reejecución real**: `LOCAL_SCHEDULER_MIGRATION_BLOCKED`. Exit **1**, 7 s, 34/38 migraciones, **0 de 5 suites**. El "131 PASS (4/5)" queda **retractado**. Detalle: `brecha-01-local-db.md` |
| **Chromium (workers=1)** | ✅ PASS | Run 3: **196/196 passed** (6.4m) con los 3 fixes ya en disco desde el inicio |
| Rider contrato | ✅ PASS | `rider-delivery-server-contracts.test.mjs`, `rider-assignment-tracking-gate.test.mjs`, `production-rider-gps.test.mjs` — son `tests/*.test.mjs`, cubiertos por los 1001 de `npm test` |
| Secret scan | ✅ PASS | Repo scanner exit 0; scan ampliado sobre artefactos/commits/frontend sin hallazgos (ver §Secret scan) |
| Staging identificado | ✅ PASS | `la-taba-staging` / `ukxqbgswjlibmnjemrzd` — sin proyecto de producción en la cuenta |
| Plan de deploy + rollback | ✅ PASS | `staging-deploy-plan.md` |
| Declaración | ✅ PASS | BRECHA-01 cerrada como resultado B (clasificada, no fingida) |
| **Solicitar autorización deploy** | ⏳ PENDIENTE | I_AUTHORIZE_TABA2_E2E_TEST_STAGING_DEPLOY |

### Fixes de Gate 1 — clasificación honesta

| # | Archivo | Clasificación | Commit |
|---|---|---|---|
| 1 | `js/app.js:473-475` | **PRODUCT_FIX** | `fb948ca` |
| 2 | `tests/e2e/la-taba.spec.mjs:752` | TEST_ASSERTION_UPDATE (estancada) | `a0189bf` |
| 3 | `tests/e2e/approved-beverage-demo.spec.mjs:85` | TEST_ASSERTION_FIX (nacida mal) | `a0189bf` |

**Fix #1 es código de producto, no de test.** `setAppBootstrapState()` escribía sólo `data-app-bootstrap`; `bootstrap()` seguía poniendo `data-taba-startup="starting"` pero nada lo resolvía nunca. Estado inexistente en ambos padres: el baseline `b6d27da` escribía `starting → ready/failed` directo, y el upstream `83dc8e2` había eliminado el atributo por completo (0 referencias en `83dc8e2^` y en `83dc8e2`). Lo introdujo la **resolución de conflicto** del cherry-pick `16f2761`. Consumidores: `tests/e2e/helpers.mjs:65`, `tests/e2e/customer-profile.spec.mjs:194`, `scripts/measure-local-rc-performance.mjs:140`. Ningún CSS, HTML ni módulo de producto → **impacto de usuario: ninguno**; el radio es instrumentación.

**Fix #3 no oculta regresión**: `js/approved-beverage-demo-data.js` es byte-idéntico entre `83dc8e2`, `16f2761` y HEAD; Red Bull y Heineken tienen `unitsPerPack: 1` en las tres; `addToCart(productId, quantity = 1)`; `cart.js` no lee `unitsPerPack`. La aserción `'3'` **nunca fue satisfacible** en esta línea: nació roja en `16f2761`.

---

## Colisión de versión 20260804090000 — RESUELTA por migración de reconciliación

Detalle en `version-collision-resolution.md`, `remote-only-migration-20260804090000.md` y
`business-panel-contract-inventory.md`.

**Diagnóstico**: staging registra `20260804090000` con el nombre `rider_map_location_contracts`
—una migración que no existe en este repositorio y que instaló el esquema `private` y el trigger
`rider_map_capture_order_location`—. El repositorio tiene, con esa misma versión, otra migración:
`business_operations_panel`, que nunca se aplicó allí.

**Hallazgo que cambió el diseño**: la colisión no saltea el Panel en silencio, **rompe el push**.
`20260805120000` usa `fiscal_profiles.homologation_authorized_at/_by`, columnas que crea el Panel;
sin ellas aborta con `column "homologation_authorized_at" does not exist`. Por eso la reconciliación
**no puede ir al final**: se numeró `20260804093000`, libre en el repo y en el historial remoto,
después de la versión ocupada y antes de la dependiente.

**Solución**: `20260804093000_reconcile_business_operations_panel_version_collision.sql`
(preflight + copia literal del Panel + postflight, 1093 líneas). Tres estados: A no-op verificado,
B aplica el contrato, C aborta con `BUSINESS_PANEL_PARTIAL_SCHEMA_DETECTED` antes de mutar.
No toca el trigger remoto ni el esquema `private`, y lo asevera antes y después.

**Escenarios**: 35/35 aserciones, exit 0. La simulación de staging **converge byte a byte** al
esquema de la base canónica (huella `256e8229ca177a71205daa9eb805f77a`).

Sin `migration repair`, sin borrar filas del historial, sin recrear staging, sin `db push` real.

---

## BRECHA-01 — CERRADA por reejecución del runner canónico

> **ACTUALIZACIÓN 2026-08-06 — BRECHA-01 RESUELTA, no sólo clasificada.**
> El fixture de clúster (apuntar `cron.database_name` del contenedor local a la base efímera y
> restaurarlo al terminar, editando `/etc/postgresql-custom/conf.d/pg_cron.conf` como root porque
> el rol `postgres` de Supabase no es superusuario) permite que `20260803120000` se aplique
> **exactamente como está escrita**. Resultado medido: la suite de contrato de Mercado Pago corre,
> y las cuatro suites pgTAP emiten sus planes completos — `1..30`, `1..41`, `1..32`, `1..28` —
> con **131 `ok` y 0 `not ok`**. La migración histórica no se modificó.
> Detalle en `version-collision-resolution.md` §5.

**Diagnóstico original (2026-08-05): B — `LOCAL_SCHEDULER_MIGRATION_BLOCKED`.** Registro completo en `brecha-01-local-db.md`.

Se reejecutó `npm run test:payments:local-db` (entrypoint canónico, con su precondición declarada `TABA_LOCAL_PAYMENT_DB=1`) sobre `HEAD=a0189bf`, con Supabase local levantado desde el propio worktree del RC para que el contenedor coincidiera con el default del runner (`supabase_db_la-taba-real-orders-staging`), sin ningún override.

**Salida real**: exit **1** en **7 s**. La migración 35 de 38 (`20260803120000`) falla en su línea 6:
```
ERROR:  can only create extension in database postgres
DETAIL:  Jobs must be scheduled from the database configured in cron.database_name…
HINT:    Add cron.database_name = 'taba2_mp_verify_11128' in postgresql.conf…
```
Confirmado contra el clúster: `show cron.database_name` → `postgres`; la base efímera es `taba2_mp_verify_11128`.

**Consecuencia medida**: 34 migraciones aplicadas, 3 nunca aplicadas, y **0 de 5 suites ejecutadas** — ni la de Mercado Pago (L106) ni las 4 pgTAP (L107-110). El runner **no tiene mecanismo de SKIP**: aborta.

**Retractación formal**: el registro previo "131 aserciones PASS (4/5 suites, la 5ª SKIP)" **no pudo ser producido por este runner**. El 131 es la suma de los `plan(N)` leídos del fuente, no un resultado observado. Queda retirado.

**Residuos**: ninguno (`taba2_mp_verify%` → conjunto vacío). El `finally` limpió pese al fallo. Sin datos humanos involucrados, sin relación con LT-0030.

**Corrección de diagnóstico**: `mercadopago_checkout_pro.local.sql` **no menciona pg_cron**. No es "hosted-only" por sí misma. La dependencia vive en la migración, que mezcla el contrato portable de Mercado Pago con el registro del scheduler atado a `cron.database_name`.

**Propuesta (no aplicada)**: condicionar únicamente `create extension pg_cron` + `cron.schedule` a `current_database() = current_setting('cron.database_name', true)`, dejando funciones, trigger y grants siempre creados. En hosted el comportamiento queda byte-idéntico; en una base incapaz de alojar el job se omite sólo lo imposible. Detalle y justificación en `brecha-01-local-db.md`.

---

## Gate 2 — Deploy de Staging

| Área | Estado | Notas |
|---|---|---|
| Verificar proyecto staging inequívoco | ✅ PASS | `la-taba-staging` / `ukxqbgswjlibmnjemrzd`; sin proyecto prod/live en la cuenta |
| **Migraciones staging** | ✅ **PASS** | **12 aplicadas, exit 0, 172 s.** Historial 39 filas, 0 duplicados, las 27 originales intactas. Detalle: `staging-db-push-report.md` |
| Gates hosted de base | ✅ PASS | `RIDER_MAP_REMOTE_ONLY_CONTRACT_PRESERVED` · `BUSINESS_PANEL_RECONCILIATION_HOSTED_PASS` · `HOSTED_PG_CRON_SCHEDULER_PASS` · `HOSTED_MERCADOPAGO_DB_CONTRACT_PASS` · `HOSTED_PGTAP_131_PASS` (131/131) |
| Datos protegidos | ✅ PASS | 31 pedidos · 1 comercio · 9 productos · LT-0030 `arrived` · 1 snapshot Rider — todos idénticos al baseline; cero QA |
| Edge Functions staging | ⏳ PENDIENTE | Solo después de autorización |
| Secrets MP test en Supabase vault | ⏳ PENDIENTE | Canal seguro, no en chat |
| Verificar HTTPS | ⏳ PENDIENTE | — |
| Configurar webhook URL staging | ⏳ PENDIENTE | notification_url con HTTPS |
| Baseline staging | ⏳ PENDIENTE | Medir antes de crear fixture QA |
| Autorización: I_AUTHORIZE_TABA2_E2E_TEST_STAGING_DEPLOY | ⏳ PENDIENTE | No proceder sin esto |

---

## Gate 3 — Mercado Pago Test → Panel

| Área | Estado | Notas |
|---|---|---|
| Configurar MP test app | ⏳ PENDIENTE | pk_test, at_test, notification_url, back_urls |
| Sembrar fixture QA (I_AUTHORIZE_E2E_QA_FIXTURE_SEED) | ⏳ PENDIENTE | Producto QA-MP-E2E-STAGING-ONLY |
| Autorización compra: I_AUTHORIZE_MERCADOPAGO_TEST_PURCHASE | ⏳ PENDIENTE | Requerida antes de crear preferencia |
| Storefront staging → producto QA | ⏳ PENDIENTE | — |
| Checkout Pro test | ⏳ PENDIENTE | Comprador de prueba, tarjeta test |
| Recibir webhook firmado | ⏳ PENDIENTE | — |
| Validar firma webhook | ⏳ PENDIENTE | — |
| Pedido en Panel | ⏳ PENDIENTE | — |
| Exactly-once (preferencia, pago, pedido) | ⏳ PENDIENTE | Verificar 1 de cada |
| Declaración | ⏳ PENDIENTE | TABA2_MERCADOPAGO_TEST_ORDER_REACHED_BUSINESS_PANEL |

---

## Gate 4 — Panel → Rider → Entrega

| Área | Estado | Notas |
|---|---|---|
| Verificar stale lock rider (limpiar) | ⏳ PENDIENTE | Antes de cualquier operación Rider |
| Aceptación del pedido en Panel (manual) | ⏳ PENDIENTE | Usuario presente |
| Rider staging (app congelada 95294d9) | ⏳ PENDIENTE | NO rediseño 9b498db |
| Claim, pickup, start, arrival, delivery | ⏳ PENDIENTE | — |
| GPS_LIVE_STATIONARY_PASS | ⏳ PENDIENTE | — |
| Código QA via ACTION_SET_TEXT | ⏳ PENDIENTE | — |
| Exactamente-once entrega | ⏳ PENDIENTE | — |
| Declaración parcial | ⏳ PENDIENTE | — |

---

## Gate 5 — Exactly-Once, Conciliación y Cleanup

| Área | Estado | Notas |
|---|---|---|
| Una preferencia | ⏳ PENDIENTE | — |
| Un pago | ⏳ PENDIENTE | — |
| Un pedido | ⏳ PENDIENTE | — |
| Un webhook efectivo | ⏳ PENDIENTE | — |
| Una aceptación | ⏳ PENDIENTE | — |
| Un claim, un pickup, un start, una arrival | ⏳ PENDIENTE | — |
| Un ajuste de stock QA | ⏳ PENDIENTE | — |
| Cero duplicados | ⏳ PENDIENTE | — |
| Cleanup: pedidos QA, locks, stock, sesión | ⏳ PENDIENTE | — |
| LT-0030 intacto | ⏳ PENDIENTE | Verificar |
| Datos humanos intactos | ⏳ PENDIENTE | Verificar |
| Declaración final | ⏳ PENDIENTE | TABA2_STAGING_END_TO_END_ORDER_FLOW_CERTIFIED |

---

## Leyenda de Estados

| Símbolo | Significado |
|---|---|
| ✅ PASS | Verificado y aprobado |
| ❌ FAIL | Fallo — no avanzar al siguiente gate |
| ⚠️ WARNING | Riesgo documentado — gestionar antes de continuar |
| ⏳ PENDIENTE | No ejecutado aún |
| 🔴 BLOQUEADO | Explícitamente bloqueado por riesgo no resuelto |

---

## Regla de No-Avance

> No avanzar de gate si el anterior está rojo o incompleto.

Gate 0: ✅ COMPLETADO  
Gate 1: ✅ COMPLETADO — TABA2_E2E_TEST_RC_READY_FOR_STAGING_DEPLOY  
&nbsp;&nbsp;↳ BRECHA-01 **cerrada por reejecución del runner canónico**: resultado B (`LOCAL_SCHEDULER_MIGRATION_BLOCKED`), demostrado con el error literal de pg_cron. **Ninguna suite de DB corre localmente** — ni las 4 pgTAP ni la de Mercado Pago. Por lo tanto `HOSTED_PG_CRON_GATE` no sólo sigue obligatorio: es hoy **la única evidencia posible** del contrato de base, y bloquea toda compra hasta dar PASS.  
Gate 2: Requiere I_AUTHORIZE_TABA2_E2E_TEST_STAGING_DEPLOY  
Gate 3: Requiere Gate 2 verde + I_AUTHORIZE_MERCADOPAGO_TEST_PURCHASE  
Gate 4: Requiere Gate 3 verde + usuario presente  
Gate 5: Requiere Gate 4 verde
