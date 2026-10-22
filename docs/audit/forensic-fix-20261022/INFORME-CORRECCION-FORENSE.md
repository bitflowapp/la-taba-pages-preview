# La Taba — corrección de los 14 hallazgos forenses

**Veredicto: NO-GO para habilitar cobros reales.** Los defectos de dinero, stock, identidad de pago y devoluciones (F01–F05, F12) están corregidos en PostgreSQL y probados con fallos reproducibles; la recuperación (F06–F11, F14) está corregida, desplegada en QA y ejercitada por el planificador real. Quedan **tres condiciones que no se pueden cerrar sin una persona**: pruebas auténticas contra Mercado Pago (requieren el secreto de firma del webhook, el consentimiento del vendedor de prueba y pagos con tarjeta de prueba), custodia externa del respaldo (F13) y una segunda validación independiente. «Las suites pasan» **no** es el criterio de salida.

- Repositorio: `bitflowapp/la-taba-pages-preview` · Rama revisable: `fix/forensic-f01-f14-20261022` (parte de `897aeefd`, 11 commits, sin reescribir historia)
- Commit auditado: `897aeefd522969727b8208668b3c60332153d541` · el remoto `recovery/la-taba-free-hosted-20261020` seguía en ese commit al empezar (no había correcciones posteriores que comparar).
- QA: `ixewllzzuzpqrkxzmfzx` (único proyecto tocado). Producción comercial: no existe y no se publicó nada. Walter: ningún producto, precio ni stock real se tocó. Gasto: USD 0 (sólo plan Free; ningún complemento pago).

## 1. Qué se demostró y cómo

Cada defecto se reprodujo **primero** contra la implementación auditada y recién después se corrigió. Los mismos tests corrieron contra los dos esquemas (rojo → verde):

| Suite (PostgreSQL real, proveedor simulado) | Esquema auditado `897aeefd` | Esquema corregido |
|---|---|---|
| `p0-money-safety` (F01–F05, F12) | 3 pasan (controles) / **16 fallan** | **19 / 19** |
| `p1-reconciliation` (F07–F10, F14, bandeja, libro mayor) | 3 / **22 fallan** | **25 / 25** |
| `forensic-26-scenarios` (los 26 escenarios de Astra, repetidos) | 10 / **16 fallan** | **26 / 26** |
| `worker-recovery` (worker y adaptador **reales**, Mercado Pago simulado) | 2 / **7 fallan** | **9 / 9** |
| `p2-worker-dispatch-and-health` (F11) | — (capacidad nueva) | **10 / 10** |
| `concurrency` (varias sesiones PostgreSQL simultáneas) | interbloqueo en 5 de 7 corridas | **6 / 6**, 0 interbloqueos en 4 corridas |
| `backup-restore` (volcado → base nueva → conciliar) | — (capacidad nueva) | **4 / 4** |
| **Total `tests/db`** | **24 pasan / 75 fallan** | **99 / 99** |

Además, sin regresiones: suite JS completa del repositorio (ver §6), 53 casos E2E (8 especificaciones de pagos, panel y service worker) en Chromium, `npm run check` (sintaxis, config Supabase, precache, higiene, identidad de release, contrato de ubicación, codificación, escaneo de secretos) y las pruebas SQL existentes (35 pasan / 20 fallan **idénticas antes y después**: deriva de fixtures del entorno local, no relacionada; se enumeran en §6).

Todo corre con `node --test tests/db/*.test.mjs` sobre un PostgreSQL 17 local descartable (`scripts/local-db/`): las 164 migraciones del repositorio + 3 nuevas, con *stand-ins* de `pg_cron`, `pg_net` y Vault. Los logs rojo/verde están en `evidence/`.

**Separación estricta de lo simulado y lo auténtico.** Todo lo anterior usa un proveedor **simulado** (`tests/support/provider-sim.mjs`): ninguna llamada a Mercado Pago, ningún dinero. Lo único auténtico ejecutado fue infraestructura propia: el planificador `pg_cron` de QA, el despacho HMAC por Vault/`pg_net`, el Edge Function real desplegado y el respaldo/restauración real. **No se ejecutó ni un solo pago, reembolso o contracargo auténtico de Mercado Pago** (ver §5).

## 2. Matriz de los 14 hallazgos

Estado: ✅ corregido y probado · 🟡 corregido con límite explícito · ⛔ bloqueado por una decisión o acción humana.

| # | Sev. | Estado | Causa raíz | Corrección (código / migración) | Prueba que reproduce el fallo original | Prueba que demuestra la corrección | Riesgo residual |
|---|---|---|---|---|---|---|---|
| **F01** | P0 | ✅ | Recuperar y entregar miraban la *etiqueta* de estado (`security_review_required` oculta un reembolso) y no los importes. | `private.payment_financial_hold`, `private.order_payment_blocks_fulfilment`, `order_payment_is_financially_reversed` por importes, `recover_paid_checkout_order`, `can_recover_paid_checkout`, `finalize_paid_checkout_session` (envoltorio con guarda), `prevent_paid_order_generic_cancellation` — mig. `20261022100000` | `p0` «F01 …» (3), forensic-26 #07 #24 | los mismos, verdes; #15 control | Un reembolso *parcial* no frena el pedido (compensación legítima): decisión de negocio explícita. |
| **F02** | P0 | ✅ | Recuperación sin exclusión mutua con devolución abierta/incierta. | Mismo `payment_financial_hold` (`refund_in_flight`, `cancellation_in_flight`, `dispute_open`, `financial_discrepancy_open`) tomado bajo el bloqueo del intent. | `p0` «F02 …» (2), #19 | verdes | Concurrencia refund↔recover probada (`concurrency` 4). |
| **F03** | P0 | ✅ | La recuperación reservaba una generación nueva sin liberar la vieja (activa pero vencida) y el barrido no la veía. | `private.reserve_for_paid_session` (reutiliza o libera **una vez** y reserva), índice único `inventory_reservations_one_live_per_product`, `release_checkout_session_inventory`/`expire_checkout_sessions` en orden canónico | `p0` «F03 …» (3), #11 #18 | verdes (stock siempre 8, una asignación neta de 2) | No existe libro de movimientos para reservas online: la reserva *es* el libro; invariante verificado por consulta. |
| **F04** | P0 | ✅ | `provider_payment_id` se sobrescribía por *orden de llegada*; un rechazo posterior pisaba al aprobado. | Tabla `payment_provider_payments` (clave `(provider, environment, seller, payment_id)`), identidad financiadora por *lo que es* (dinero movido), versiones monótonas por recurso, `record_mercadopago_payment_snapshot` reescrita; dos aprobados → `multiple_approved_payments` crítica | `p0` «F04 …» (4), #05 #06 #20, worker «two approved» | verdes | El pago excedente se devuelve a mano (la discrepancia lo muestra); no hay `prepare_refund` dirigido a un pago secundario. |
| **F05** | P0 | ✅ | `refunded_amount` se recalculaba sólo de `payment_refunds` y borraba el acumulado externo. | Inventario de devoluciones por identidad (`origin` local/external/unattributed), `private.refresh_refund_totals`, `private.reconcile_payment_refunds`, adopción de la devolución externa al confirmar la local; el total nunca retrocede | `p0` «F05 …» (4), #16 | verdes (500 + 250 = 750 en cualquier orden, repetido) | Si el proveedor sólo informa un total sin ids se usa un único residuo; se resuelve solo en la lectura siguiente. |
| **F06** | P1 | ✅ | El worker consultaba sólo el id rechazado ya guardado. | `paymentsForJob`: busca **todos** los pagos de la referencia (paginado) + ids conocidos; `findPaymentsByExternalReference` | `worker-recovery` F06 | verde | Validado con proveedor simulado; falta contra Mercado Pago real. |
| **F07** | P1 | ✅ | `fetchMerchantOrder` devolvía `null` ante 503 → preferencia vacía → revisión permanente. | 5xx/timeout/429 lanzan error (reintento); 404 es el único «no existe»; SQL: preferencia vacía = `retryable`, sólo una preferencia *distinta* va a revisión | `p1` «F07 …» (2), worker F07, #04 | verdes | — |
| **F08** | P1 | 🟡 | La conciliación dependía de intents locales, ocho sondas vacías y 48 h. | Sondas con *backoff* sin tope de intentos (cierre sólo con evidencia: vencimiento + 24 h + 3 vacías posteriores); barrido de libro mayor del proveedor (`provider_ledger_cursors`, ventana con solape, páginas, reanudable, con *lease*); `record_orphan_provider_payment`; `run_financial_integrity_checks`; alerta `CHECKOUT_PROVIDER_UNVERIFIED` abierta hasta cierre con evidencia | `p1` «F08 …» (5), #08 #09, worker F08 (2) | verdes; cron real en QA | El webhook sigue exigiendo un intent para guardar el recibo: lo cubre el barrido (≤ 10 min), no el webhook. Validar la paginación y `range=date_created` contra la API real. |
| **F09** | P1 | 🟡 | Reembolso sin id: el worker fallaba 8 veces y moría. | `park_refund_identity_unknown` (discrepancia crítica, bloquea recuperación, evidencia de sólo lectura) + `resolve_ambiguous_refund` (ejecutado/no ejecutado, con nota, auditada); **no se adivina por importe ni se reenvía** | `p1` «F09 …» (2), worker F09 | verdes | La documentación de Mercado Pago no garantiza ventana de reenvío idempotente de reembolsos: la salida es manual y auditada, por diseño. |
| **F10** | P1 | ✅ | El preflight sólo miraba el último estado del intent. | `mp_disconnect_preflight` cuenta pagos reintentables, ventana de preferencia +24 h, discrepancias abiertas y lectura del libro posterior a la última actividad; `mp_disconnect_checked` pausa cobros y deja constancia (`disconnect_requested_at`) | `p1` «F10 …» (3), #10 #26 | verdes + concurrencia «disconnect vs checkouts» | La desvinculación no se completa sola al drenar: la repite el propietario. |
| **F11** | P1 | ✅ (QA) | 6 cron inactivos y Vault sin secretos; además el despacho no corría sin trabajos en cola. | Secretos HMAC en Vault+Edge (`scripts/recovery/provision-worker-secrets.mjs`, sin imprimir valores), despacho también por reloj del libro, guarda anti-tormenta (1 despacho/4 s), `payments_pipeline_health`, alerta `PAYMENT_PIPELINE_STALLED` — mig. `20261022120000` | `p2`, QA antes: 0 ejecuciones | `p2` (10) + simulacro QA real (§4) | 5 de 6 trabajos activos; `taba-security-retention-sweep` queda apagado a propósito (borra filas; no hace falta aún). El vigía externo (GitHub Actions) existe en el repo pero **no se verificó** que corra contra este QA. |
| **F12** | P1 | ✅ | Aprobación tardía → revisión manual sin pedido ni salida visible. | Reserva transaccional dentro de la propia aprobación (reutiliza stock retenido o lo retoma si hay), barrido `retry_stuck_paid_checkouts`, y sin stock → `paid_without_order` durable (alerta, `blocks_recovery=false`, opción de devolver) | `p0` «F12 …» (2), #03 | verdes + QA real (pedido recuperado por cron en ~110 s) | Sin stock sigue requiriendo decisión humana (devolver o reponer). |
| **F13** | P0 op. | ⛔ parcial | Respaldo sólo manual, sin custodia externa, restauración no probada con dinero en vuelo. | Ensayo con operaciones en vuelo (local y real en QA), `scripts/recovery/backup-freshness.mjs` (alarma de respaldo viejo) | — | `backup-restore` (4) + restauración aislada real de QA (§4) | **Sin destino externo cifrado, sin copia de la clave fuera de esta PC, sin automatización diaria**: decisión de Marco/Walter. Auth/Storage/Realtime/cron/Vault no se certifican en plataforma nueva. |
| **F14** | P2 | ✅ | `list_business_payments` truncaba a 200 sin cursor. | Incidencias primero (`private.payment_intent_needs_attention`), `offset/limit/búsqueda`, campos `financial_hold`, `needs_attention`, `open_discrepancies`; la consola muestra «Dinero sin resolver» | `p1` «F14» | verde (205 pagos nuevos y una incidencia de 30 días: primera) | La bandeja *UI* de discrepancias es mínima (alertas + RPC); falta una pantalla dedicada. |

Controles que **ya** estaban bien y siguen pasando: precio decidido por el servidor, stock insuficiente, pedido no nace con pago pendiente, finalización repetida, reembolso abierto deduplicado, escritura atómica, lease del worker, recibo de webhook único (#01 #02 #12 #13 #14 #17 #21 #22 #23 #25).

## 3. Cambios, migraciones y despliegue en QA

| Migración | SHA-256 | Contenido |
|---|---|---|
| `20261022100000_financial_integrity_core` | `9f3f5a3c…8ad` | F01–F05, F12, orden de bloqueo canónico |
| `20261022110000_reconciliation_and_safe_disconnect` | `2451e2cd…df27` | F07–F10, F14, bandeja, libro mayor, alertas |
| `20261022120000_worker_dispatch_ledger_and_pipeline_health` | `5ef4b78b…00db` | despacho + salud + alerta (F11) |

Controles previos y trazabilidad: ensayo con *rollback* garantizado sobre QA (`scripts/recovery/rehearse-migrations.mjs`, «passed_and_rolled_back»), **respaldo cifrado previo** (3,4 MB, ida y vuelta verificada), registro en el libro de recuperación (`sync-hosted.mjs --migrations --apply`, evidencia JSONL). Las migraciones son aditivas: ninguna borra filas; la reversión (documentada en el encabezado de cada una) restaura los cuerpos anteriores y deja las tablas nuevas inertes; el respaldo previo cubre el resto. Se desplegaron 7 Edge Functions (`payment-worker`, `checkout-status`, `connect`, `webhook`, `refund`, `cancel-payment`, `create-preference`, todas `ACTIVE`).

Cambio de **semántica** que conviene conocer: una aprobación tardía con stock disponible ahora crea el pedido sola (antes iba a revisión manual); un pago repetido o inconsistente **no** frena el pedido del pago legítimo pero queda como caso crítico visible.

## 4. Evidencia en QA (auténtica en infraestructura, sintética en datos)

- **Planificador:** 5 trabajos activados (`outbox-worker` 30 s, `checkout-expiry-sweep`, `provider-truth-sweep`, `operational-alerts-sweep`, `qa-window-expiry`). Todas las corridas `succeeded`, 0 `failed` (`evidence/qa-cron-enable.json`, `qa-drill-recovery.jsonl`).
- **HMAC:** secreto generado en memoria y escrito una vez en Edge y Vault (nunca impreso, ni en archivos ni commits). Llamada firmada al worker → **200**, firma alterada → **401**, sin firma → **401**; alineación Vault/Edge comprobada por SHA-256.
- **Recuperación sin intervención** (inquilino sintético, hecho de proveedor simulado): un pago aprobado nunca finalizado, con la ventana vencida, se convirtió en **un pedido** por el barrido del planificador a los ~110 s; stock 10 → 8 una sola vez; reserva `converted`.
- **Fallo y reintento reales:** el barrido de verdad del proveedor encoló una conciliación; el despachador firmó y llamó al Edge Function; sin conexión de vendedor en QA el trabajo falló y se reprogramó con *backoff* creciente (intentos 2 → 3, +2 min), sin tormenta de solicitudes (`dispatches` = 2 en 3 min).
- **Respaldo y restauración reales de QA** (esquemas `public/private/catalog_admin/supabase_migrations/auth/storage`, base nueva aislada, original sin modificar): pre-data, data y post-data pasan; las tablas financieras restauradas coinciden bit a bit (`payment_intents`, `payment_provider_payments`, `payment_refunds`, `orders`, `inventory_reservations`, `payment_outbox` …). Dos tablas operativas difieren (`operational_alerts`, `operational_sweep_runs`) porque el planificador vivo las escribió entre el respaldo y la comparación; por eso `allApplicationChecksPassed` figura `false` (fiel a la herramienta). Quedan en QA, **pendientes de tu autorización para borrarlos**: la base `taba_restore_20261022_ad3d29a2` y el inquilino sintético `drill-fb-qa` (pausado, con un usuario Auth sintético).

## 5. Lo que NO está probado (y por qué no hay GO)

1. **Mercado Pago auténtico.** El webhook de QA responde 503 (falta cargar la firma en `MERCADOPAGO_OAUTH_WEBHOOK_SECRET`) y no hay vendedor de prueba vinculado. Requiere: (a) que cargues la firma del webhook, (b) que el vendedor de prueba `3594962708` consienta, (c) pagos de prueba con tarjeta —aprobado, rechazado→aprobado, dos intentos, devolución parcial/total, respuesta de devolución perdida— hechos por vos (mi regla: no escribo contraseñas ni tarjetas). Con eso se corre `scripts/recovery/qa-mp-e2e.mjs` y se compara con el proveedor.
2. **Respaldo externo (F13).** Falta elegir destino cifrado y custodia de la clave fuera de esta PC y programar la automatización (la alarma `backup-freshness.mjs` ya existe para vigilarla). RPO/RTO sin acordar con Walter.
3. **Restauración de plataforma Supabase completa** (Auth/Storage/Realtime/cron/Vault en un proyecto nuevo): no certificada; los secretos Edge no están en los respaldos.
4. **Promoción a producción.** `scripts/release-v5/compatibility.json` (huellas del proceso de release A1–A4) **no se regeneró**; cualquier salida a producción exige ese re-baseline, Deno (no instalado aquí: sin *type-check* de las Edge Functions, sólo ejecución real en QA y en un sandbox Node) y la prueba `test:release:db` con Docker.
5. **Validación independiente.** Repetir la auditoría de Astra sobre el commit/despliegue exactos antes de cobrar.
6. **Cobertura E2E de navegador:** 53 casos de pagos/panel/service worker en Chromium; no se corrió la matriz completa (≈460 casos, WebKit incluido).

## 6. Cobertura y cifras

- `tests/db`: 99 pruebas (PostgreSQL real; los 26 escenarios, 6 de concurrencia, worker real, despacho, respaldo).
- Suite JS del repositorio: ver `evidence/npm-test-final.log` (resultado final al pie del archivo).
- Pruebas SQL previas del repositorio, antes/después: **35 / 20** idénticas. Las 20 que fallan en ambos esquemas son deriva de fixtures de este entorno local (p. ej. «product image association does not match its approved catalog asset») y suites que necesitan Supabase real; no se tocaron.
- `safe_disconnect` se actualizó a propósito: su expectativa (desconectar apenas se cancela el checkout) era justamente el defecto F10.

## 7. Operación: cómo resolver lo que el sistema bloquea

Todo hecho irresoluble automáticamente queda como fila en `payment_discrepancies`, aparece como alerta **`PAYMENT_DISCREPANCY_OPEN`** en el centro de alertas y bloquea de forma segura lo que corresponda (`payment_financial_hold`).

| Caso | Qué significa | Qué hacer (propietario/administrador) |
|---|---|---|
| `paid_without_order` | Cobro aprobado sin pedido (sin stock, o a la espera de un hecho financiero) | Reponer stock (se rearma solo en ≤ 1 min) **o** devolver desde Pagos; cerrar con `resolve_payment_discrepancy` + nota |
| `multiple_approved_payments` | Dos pagos aprobados para un checkout | Devolver el excedente desde Mercado Pago; cerrar con evidencia |
| `refund_identity_unknown` | Devolución cuyo id nunca llegó | Ver el listado de devoluciones del proveedor que trae el caso; `resolve_ambiguous_refund(id, 'executed', <id real>, nota)` o `'not_executed'` |
| `orphan_provider_payment` | Pago con nuestra referencia sin checkout local | Identificar el pago en Mercado Pago, devolver o reconstruir; cerrar |
| `provider_payment_inconsistent` | Importe, moneda, cuenta o referencia que no coinciden | No entregar; comparar con el proveedor; cerrar |
| `order_paid_unverified` | Pedido cobrado sin verificación del proveedor en 24 h | Se cierra solo al volver a verificarse |

## 8. Cómo reproducir

```powershell
$env:TABA_PG_BIN = "<carpeta con psql/pg_ctl de PostgreSQL 15+>"
# arrancar un clúster local descartable en 127.0.0.1:55440 (pg_ctl), luego:
node scripts/local-db/bootstrap.mjs taba_local_base --up-to 20261021235000_security_hardening.sql   # esquema auditado
node scripts/local-db/clone.mjs taba_local_work                                                      # + 3 migraciones nuevas
$env:TABA_LOCAL_DB = "taba_local_work"; node --test --test-concurrency=1 tests/db/*.test.mjs        # verde
$env:TABA_LOCAL_DB = "taba_local_base"; node --test --test-concurrency=1 tests/db/*.test.mjs        # rojo (esquema auditado)
```
Para el worker contra el código auditado: `TABA_FUNCTIONS_DIR=<supabase/functions de 897aeefd>`. Las pruebas SQL del repositorio se corren con `scripts/local-db/run-sql-tests.mjs` sobre un *clon* (nunca sobre las plantillas).

## 9. Pendientes que necesitan tu decisión

1. Cargar la firma del webhook de QA y autorizar la ronda de pagos auténticos de prueba (§5.1).
2. Elegir destino cifrado y custodia de la clave del respaldo; acordar RPO/RTO con Walter (§5.2).
3. Autorizar el borrado de la base de restauración aislada y del inquilino sintético de QA (§4).
4. Decidir si el reembolso parcial debe o no frenar un pedido (hoy no lo frena).
5. Auditoría independiente sobre este commit antes de cualquier habilitación de cobros.
