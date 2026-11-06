# La Taba · matriz de certificación Mobbex (20 casos)

Fecha: 2026-11-05. Rama `feat/la-taba-mobbex-checkout` (PR #164). **Sin dinero real, sin credenciales de producción, sin reembolsos reales.**

Cómo leer la columna «Nivel»:

| Nivel | Qué significa | Qué NO significa |
|---|---|---|
| **SQL** | Aserción contra el esquema REAL (PostgreSQL nativo con el resto de las migraciones del repo, extensiones de Supabase simuladas). | No es la imagen fija de Supabase de CI. |
| **CONC** | Sesiones de PostgreSQL independientes que arrancan en el mismo instante (`scripts/mobbex/run-mobbex-concurrency.mjs`). | No prueba el comportamiento de Mobbex. |
| **EDGE** | La lógica de la función Edge con puertos falsos inyectados (`tests/mobbex-core|flows`, Node y Deno). | No habla con Mobbex ni con la base. |
| **FRONT** | Panel / navegador con un repositorio falso (`tests/mobbex-panel`, `tests/mobbex-frontend`). | No es un navegador real. |
| **DEMO** | Lectura de sólo lectura contra la API pública DEMO de Mobbex (operaciones que ya existían en esa cuenta compartida). | No es una cuenta propia ni un cobro hecho por nosotros. |
| **PERSONA** | Requiere una persona (CAPTCHA / Turnstile / cuenta propia). **No ejecutado.** | — |

| # | Caso | Nivel y evidencia | Estado |
|---|---|---|---|
| 1 | Pago aprobado | SQL: «an approved, matching payment becomes an order in the same transaction», «exactly one order», «stock was reserved once and converted». EDGE: `webhook: the body is a hint; the state comes from the provider read`. DEMO: lectura de una operación aprobada REAL (`REF:`, `currency TEST`). | ✅ lógica · ⛔ **cobro aprobado propio: PERSONA** (Turnstile; el checkout DEMO responde 501) |
| 2 | Pago rechazado | SQL «rejected…», EDGE `snapshot uses the listed attempts: newest declined over an older approved never releases the stock`. DEMO: forma real de un intento rechazado. | ✅ |
| 3 | Pago pendiente | EDGE `reconcile: pending/rejected payments are looked at again`; SQL pending/in_process → `checking` en el panel (FRONT `a completed payment reads as approved; every doubtful money state blocks delivery`). | ✅ |
| 4 | Pago duplicado | SQL «a second approved payment is recorded for a refund and never creates a second order»; EDGE `snapshot counts approved operations of the reference`; **CONC C5** (dos operaciones aprobadas a la vez: un solo pedido, el segundo marcado). | ✅ |
| 5 | Timeout | EDGE `createCheckout errors: only a provable refusal is final; everything else is uncertain`, `checkout: a lost response is UNCERTAIN (202)`, `refund: … uncertain results are reconciled`; FRONT `retry after a lost return: resume the same checkout or block`. | ✅ |
| 6 | Webhook duplicado | EDGE `webhook: unknown reference and duplicate are acknowledged without work`; SQL idempotencia de snapshots; **CONC C4** (6 sesiones: 1 pedido, stock 1 vez). | ✅ |
| 7 | Webhook fuera de orden | SQL «a refund seen before the approval creates no order», «the approval that arrives after the refund still creates no order», estados viejos no pisan nuevos. | ✅ |
| 8 | Webhook fraudulento | EDGE `webhook: a request without the capability token writes NOTHING and answers 401`, `the body is a hint … even when the body lies`; token ligado a entorno+referencia en tiempo constante. **Firma de Mobbex: no documentada** (defensa = token propio + relectura autenticada). | ✅ con la salvedad de la firma |
| 9 | Caída de base de datos | EDGE `refund: a ledger failure never sends blind and never answers 500 after Mobbex already refunded`; `worker: … failures never escape`. | ✅ (simulada con puertos que fallan; no se tumbó un Postgres real) |
| 10 | Caída del proveedor | EDGE `webhook: … provider down never loses the notice`; `operation lookup: credentials failure, WAF 403 page, server errors`; backoff + `dead_letter` + `mobbex_requeue_dead_letter`. | ✅ |
| 11 | Reintentos concurrentes | **CONC C1–C8** (reembolsos con distinta/misma clave, «marcar enviado», webhook+worker+retorno, dos operaciones, orden de bloqueo, relectura del comercio, reembolso vs aprobación) con **control negativo** (un ledger sin la guarda «ya enviado» deja pasar 6/6: el arnés lo detecta). Sin deadlocks. | ✅ |
| 12 | Cambio de sandbox a producción | EDGE `environment: a session prepared in test never gets a checkout from the production configuration`, `the worker and the return page never read a payment of another environment`; SQL «production cannot be enabled without an approved review», `test_operation_in_production`; consola: `can_refund` falso si el entorno del cobro ≠ el actual (SQL + FRONT). | ✅ |
| 13 | Pago confirmado tardíamente | SQL «paid without stock: no order, no negative stock, a written reason and a refund instruction»; `approved_after_reservation_expired` → el panel ofrece **Armar el pedido** o **Devolver** (FRONT/SQL `paid without an order: recover the order or refund`). | ✅ |
| 14 | Cancelación | SQL/EDGE: 600/601/610 sobre cobro pagado del mismo día (sesión 5), vencimiento libera el stock, intento propio ilegible NO libera stock (sesión 7). | ✅ |
| 15 | Reembolso | SQL: parcial, saldo explícito, idempotencia, `requested` vencido, `ambiguous`; EDGE `refund: explicit confirmation, recorded BEFORE sending, never sent twice`; FRONT: **pantalla «Cobros Mobbex»** (motivo, importe, `DEVOLVER`, misma clave tras respuesta perdida); **CONC C1–C3, C6**. | ✅ lógica · ⛔ **devolución real: PERSONA** (no existe un endpoint de pruebas; no se hizo ninguna) |
| 16 | Conciliación | EDGE worker/sweep/claims; SQL `mobbex_sweep`, `mobbex_pipeline_health`; plantilla de cron (`tests/mobbex-worker-cron-template`); consola: «Consultar a Mobbex» (SQL + CONC C7). | ✅ · ⛔ cron **no instalado** (autorización) |
| 17 | Recuperación ante reinicio | EDGE `worker: stops at its time budget and reports lost leases`; SQL leases vencidos, `refund.expired_unsent`; FRONT clave de devolución conservada ante red caída. **No se reinició un proceso real de Supabase.** | ✅ simulado |
| 18 | Aislamiento entre comercios (y entre titulares) | SQL (consola): «the owner never sees another business's payment», «an owner cannot ask a re-read of another business's payment»; el ledger filtra por `business_id`; credenciales por entorno/secret, jamás compartidas con MiFav (repos, secrets y titulares distintos). | ✅ |
| 19 | Seguridad RLS | SQL: tablas con `revoke all` a `anon/authenticated`; EDGE↔SQL `browser-callable Mobbex RPCs are exactly the ones the migration grants to authenticated`; consola: sin `anon/PUBLIC`; `staff` no recibe banderas ni puede llamar a la RPC; FRONT `the repository calls the console RPCs with the migration's own parameter names`. | ✅ |
| 20 | Rollback | SQL: «sube → baja → sube» de las 3 migraciones, **el rollback se niega si hay dinero registrado**, huella de Mercado Pago idéntica antes/después. | ✅ |

**Fuera de la matriz y todavía sin evidencia real:** un cobro con tarjeta de prueba hecho por una cuenta propia, el significado de `501`, la forma de `/p/entity/operations` en producción, la firma del webhook, un reembolso real. Ver `PRODUCTION-CHECKLIST.md` (secciones A–D y J).
