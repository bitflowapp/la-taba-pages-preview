[HISTÓRICO REDACTADO PARA HANDOFF: líneas de credenciales/configuración excluidas; original intacto en notebook.]

# Push controlado de migraciones a staging — informe

**Fecha**: 2026-08-06
**Autorización**: `I_AUTHORIZE_TABA2_STAGING_CONTROLLED_DB_PUSH`
**Alcance**: sólo migraciones de base y gates hosted de base. **Sin** Edge Functions, secrets, RC web, webhook ni compra.

---

## 1. Estado canónico verificado

| Campo | Valor |
|---|---|
| Worktree | `D:\1212\la-taba-e2e-test-staging-rc` |
| Rama | `release/taba2-e2e-test-staging-rc` |
| HEAD | `d1829ab0ad3206777b5fb2013e2db8378251e920` ✅ coincide con el obligatorio |
| `git status` | limpio (0 líneas) |

### Backups revalidados (SHA256 completos)

| Archivo | Hash | Estado |
|---|---|---|
| `schema.sql` | `B982E078B45AD3E4DF9635D240A901C09718AEE3A83F1216157601D4C1C87A1F` | ✅ |
| `data.sql` | `6CD5F6D9A2BB8DF47856BBF34DA6600823E2FD42E33F3125288F7B01F699A25B` | ✅ |
| `roles.sql` | `168A95A9C745AF5ED4679751F90419AC9DC434240A213B03E32A06D5664C2308` | ✅ |

## 2. Lock

```
OWNER=TABA2_STAGING_CONTROLLED_DB_PUSH
PID=25956
CREATED_UTC=2026-08-06T03:53:15Z
WORKTREE=D:\1212\la-taba-e2e-test-staging-rc
HEAD=d1829ab0ad3206777b5fb2013e2db8378251e920
PURPOSE=STAGING_DATABASE_MIGRATIONS_AND_HOSTED_GATES
```

Adquirido con `mkdir` atómico. No había lock ajeno.

## 3. Preflight remoto read-only — 17/17

| # | Verificación | Resultado |
|---|---|---|
| 1 | Cuenta CLI autenticada | ✅ |
| 2 | Organización | `qdhfqytbvgpvhxbbcomv` |
| 3 | Project ref | `ukxqbgswjlibmnjemrzd` |
| 4 | Nombre | `la-taba-staging` |
| 5 | Estado | `ACTIVE_HEALTHY`, PG 17.6.1.147 |
| 6 | Ausencia de prod/live | ✅ sólo `la-taba-staging` y `la-taba-demo` |
| 7 | Historial remoto | **27 versiones** ✅ |
| 8 | Huella versiones | `85529b7d883048f60179ca1d0f50fa3a` ✅ idéntica a la registrada |
| 8b | Huella nombres | `77279efe68de5db64713ba33e1d3f28b` ✅ idéntica |
| 9 | Row counts | 31 pedidos · 1 comercio · 9 productos · 34 order_items · 14 memberships ✅ |
| 10 | LT-0030 | `arrived` ✅ |
| 11 | Trigger Rider presente | ✅ |
| 12 | Definición del trigger | ✅ idéntica byte a byte |
| 13 | Esquema `private` | 4 objetos + 2 funciones + 1 snapshot ✅ |
| 14 | Edge Functions desplegadas | **0** ✅ |
| 15 | Secrets configurados | **0** ✅ |
| 16 | Git limpio | ✅ |
| 17 | Backups presentes y válidos | ✅ |

Baseline extendido registrado para el diff posterior: `order_items=34`, `business_members=14`, `public_tablas=18`.

## 4. Segundo dry-run — idéntico al aprobado

`supabase db push --dry-run --include-all --linked` → **exit 0**, 12 migraciones, mismo orden:

```
 1  20260802090000_mercadopago_checkout_pro_foundation
 2  20260802093000_mercadopago_checkout_pro_lifecycle
 3  20260802094000_mercadopago_rate_limits
 4  20260802160000_business_windows_scanner_fiscal
 5  20260802170000_fiscal_document_closure
 6  20260802171000_fiscal_document_closure_hardening
 7  20260802180000_production_operations_control_plane
 8  20260802200000_durable_offline_packing
 9  20260803120000_mercadopago_staging_worker_scheduler
10  20260803140000_payment_recovery_p0
11  20260804093000_reconcile_business_operations_panel_version_collision
12  20260805120000_fiscal_homologation_authorization_split
```

Verificado: la reconciliación va **antes** de `20260805120000` · `20260804090000_business_operations_panel` **no** se intenta (versión legítimamente ocupada) · sin repair solicitado · sin colisión nueva · sin migración remota ausente localmente · historial sin cambios desde el baseline.

---

## 5. Push real — exit 0

```
comando : supabase db push --include-all --linked
HEAD    : d1829ab0ad3206777b5fb2013e2db8378251e920
INICIO  : 2026-08-06T03:54:40Z
FIN     : 2026-08-06T03:57:32Z
EXIT    : 0
DURACIÓN: 172 s
```

Las 12 migraciones se aplicaron en el orden del dry-run, sin detenerse, sin editar SQL y sin
marcar versiones a mano.

**Único warning**: `failed to cache migrations catalog: error exporting pg-delta catalog — timeout
exceeded when trying to connect`. Es una caché **local del CLI** (pg-delta, usada para diffs de
esquema) que expiró al conectarse; no forma parte de la aplicación de migraciones. El push reporta
las 12 aplicadas y devuelve exit 0. Sin efecto en la base.

**Objetos esperados vs. medidos**: las 12 migraciones declaran 46 `create table`. Tablas en
`public` antes: **18**; después: **64**. Diferencia exacta: **+46**.

## 6. Historial — verificado

| Verificación | Resultado |
|---|---|
| Total de filas | **39** (27 previas + 12 nuevas) |
| Nuevas registradas | **12** |
| Registros duplicados | **0** |
| `20260804090000` | sigue siendo `rider_map_location_contracts` ✅ |
| `20260804093000` | `reconcile_business_operations_panel_version_collision` ✅ |
| Orden correcto (reconciliación antes de `20260805120000`) | ✅ |
| Las 27 filas originales | **intactas**: 27 presentes, huella versiones `85529b7d883048f60179ca1d0f50fa3a` y huella nombres `77279efe68de5db64713ba33e1d3f28b`, **idénticas al baseline** |

**Huella nueva del historial**
versiones `cfb5f7bd935ccbf7a8e59fb69b0b0203` · nombres `80915b37f981d43c45459aef998041e9`

## 7. Contrato Rider sólo-remoto — `RIDER_MAP_REMOTE_ONLY_CONTRACT_PRESERVED=PASS`

| Elemento | Estado |
|---|---|
| Trigger `rider_map_capture_order_location` | definición **idéntica** byte a byte |
| `private.capture_rider_map_order_location_snapshot()` | md5 `0e6f62cb5f9878af55085819bc96157a` |
| `private.rider_map_location_payload(uuid,boolean)` | md5 `9062d093df62ba015bab90f9983903f0` |
| Relaciones en `private` | 4 (igual que el preflight) |
| Funciones en `private` | 2 |
| RLS | habilitada en ambas tablas |
| ACL del esquema | `postgres=UC/postgres` (sin cambios) |
| Fila histórica de snapshot | **1, preservada** (contenido no expuesto) |

## 8. Panel reconciliado — `BUSINESS_PANEL_RECONCILIATION_HOSTED_PASS`

| Objeto | Esperado | Medido |
|---|---|---|
| Tabla `scanned_product_audit` | 1 | ✅ |
| Columnas del Panel | 14 | **14** |
| Funciones del Panel | 9 | **9** |
| Índice `scanned_product_audit_business_idx` | 1 | **1** |
| Constraints vigentes | 5 | **5** |
| `fiscal_profiles_homologation_gate` | 0 (superseded por `20260805120000`) | **0** ✅ |
| `fiscal_profiles_homologation_authorization_pairing` | 1 | **1** ✅ |
| Policy `business reads scanned product audit` | 1 | **1** |
| RLS en `scanned_product_audit` | habilitada | ✅ |
| Comments del Panel | 3 funciones propias + 2 columnas | ✅ (`get_mercadopago_activation_status`, `configure_mercadopago_settings`, `complete_scanned_product`, `certificate_fingerprint_sha256`, `last_error_code`) |

**Dependencias — todas presentes**: `operational_alerts`, `daily_reconciliations`,
`fiscal_documents`, `order_packing_sessions`, `payment_intents`, `payment_outbox`,
`checkout_sessions`, `dispatch_payment_outbox_worker(text)`, `finalize_paid_checkout_session(uuid)`.

## 9. pg_cron hosted — `HOSTED_PG_CRON_SCHEDULER_PASS`

| Verificación | Resultado |
|---|---|
| `cron.database_name` | `postgres` = base actual ✅ |
| `pg_cron` / `pg_net` / `supabase_vault` | instaladas ✅ |
| Jobs totales | **1** (cero duplicados) |
| `taba-payment-outbox-worker` | presente |
| `active` | **true** |
| `schedule` | **`30 seconds`** |
| `command` | `select public.dispatch_payment_outbox_worker('cron');` |
| `database` | `postgres` |

### Estado transitorio esperado, documentado

El job **ya corrió 6 veces y las 6 terminaron `succeeded`**. No intenta llamar a la Edge Function
inexistente: los secretos de Vault `taba_payment_worker_url` y `taba_payment_worker_hmac_secret`
**no están cargados** (consulta a `vault.secrets` → conjunto vacío), y `dispatch_payment_outbox_worker`
es tolerante por diseño: sin ellos es un no-op silencioso.

Consecuencia verificada: **`payment_outbox` = 0**. No queda outbox real pendiente, no hay tráfico
saliente, no hay acumulación. El flujo completo **no** se considera sano hasta desplegar las
Functions en una autorización posterior.

## 10. Contrato Mercado Pago — `HOSTED_MERCADOPAGO_DB_CONTRACT_PASS`

`supabase/tests/mercadopago_checkout_pro.local.sql` → **exit 0** en 3,2 s. Las 21 comprobaciones
son `raise exception`: cualquier fallo habría dado exit distinto de cero. No es pgTAP; es un
contrato SQL por exit code.

**Canal**: no hay password de base disponible, así que se usó `supabase db query --linked`, que
ejecuta el archivo completo en **una sola sesión** vía Management API. Antes de correr el contrato
se validó que el canal respeta transacciones con una sonda:
`begin; create table public._taba_probe_tx(i int); rollback;` → la tabla **no sobrevivió**.

**Residuos**: `select count(*) from businesses where slug='mp-lifecycle-fixture'` → **0** ✅

## 11. pgTAP — `HOSTED_PGTAP_131_PASS`

| Suite | Plan | Corridos | Fallidos |
|---|---|---|---|
| `business_windows_scanner_fiscal_test.sql` | `1..30` | 30 | 0 |
| `fiscal_document_closure_test.sql` | `1..41` | 41 | 0 |
| `production_operations_control_plane_test.sql` | `1..32` | 32 | 0 |
| `durable_offline_packing_test.sql` | `1..28` | 28 | 0 |
| **TOTAL** | | **131** | **0** |

Sin SKIP, sin NOT_RUN, sin planes incompletos, sin resultados parciales.

**Cómo se contó**: el canal Management API devuelve sólo el último result set, así que no se puede
leer la salida TAP línea por línea. Se le preguntó a **pgTAP su propia contabilidad** dentro de la
misma transacción: `_get('plan')`, `_get('curr_test')` y `_get('failed')`. No es una suma
reconstruida. El método se validó antes con una sonda que introducía un fallo deliberado
(`plan=2, corridos=2, fallidos=1`) y lo detectó correctamente.

Cada suite crea pgTAP dentro de su propia transacción y la revierte: `pg_extension` no la conserva
(verificado: 0 residual).

## 12. Datos y privacidad — intactos

| Métrica | Baseline | Después |
|---|---|---|
| `orders` | 31 | **31** |
| `businesses` | 1 | **1** |
| `products` | 9 | **9** |
| `order_items` | 34 | **34** |
| `business_members` | 14 | **14** |
| LT-0030 | `arrived` | **`arrived`** |
| `private.rider_map_order_location_snapshots` | 1 | **1** |
| `private.rider_map_business_locations` | 0 | **0** |

**Cero QA**: `payment_intents` 0 · `payment_attempts` 0 · `checkout_sessions` 0 · `payment_outbox` 0
· `payment_webhook_receipts` 0 · `fiscal_documents` 0 · `inventory_reservations` 0 ·
`scanned_product_audit` 0 · fixture `mp-lifecycle-fixture` 0.

**Residuos técnicos**: `pgtap` 0 · tablas temporales (`taba_reconcile_state`, `_taba_probe_tx`) 0.

`auth.users` = 99, sin cambios entre las verificaciones posteriores al push. **Salvedad honesta**:
no se capturó el conteo de `auth.users` en el preflight, así que para esa tabla no hay comparación
contra el baseline previo al push. Las suites que insertan usuarios corren dentro de transacciones
revertidas y el resto de los indicadores está intacto.

Ningún dato personal fue impreso en logs, artefactos ni salidas.

## 13. Secret scan — verde

Superficies barridas: repositorio, artefactos, logs y salidas de tareas, temporales, backups.
Patrones: Access Token de Mercado Pago, JWT, `sb_secret_` (service_role), claves privadas,
passwords asignadas, webhook secrets.

| Superficie | Resultado |
|---|---|
| **Artefactos** | **0** en todos los patrones |
| **Backups** | **0** |
| **Temporales / scratchpad** | **0** |
| **Repositorio** | 2 coincidencias de `sb_secret_`, **clasificadas como no-secretos** |
| **Logs de tareas** | 2 coincidencias de JWT y `sb_secret_`, **clasificadas como no-secretos** |

**Clasificación de las 4 coincidencias:**

1. `tests/runtime-config.test.mjs` y `tests/supabase-client.test.mjs` contienen la cadena literal
[EXCLUIDO: credencial/configuración; recrear localmente.]
   lista de claves que el test usa para verificar que la aplicación **rechaza** claves server-only
   en el navegador. Preexistentes (commits `eb2f799` y `5731812`), ajenos a este trabajo.
2. `bf1b4xqj6.output` y `bj4wltu8z.output` son salidas de `supabase start`, que imprime las claves
   **demo de Supabase local** (`iss: supabase-demo`), idénticas en cualquier instalación local y
   públicamente documentadas. Son logs efímeros de sesión, fuera del repositorio y sin commitear.

**Cero credenciales reales** de staging o producción en ninguna superficie. `npm run secrets:scan`
del repositorio: exit 0.

## 14. Fallos

Ninguna migración falló. No se ejecutó `migration repair`, no se editó el historial, no se
reintentó nada automáticamente y no hubo que evaluar restauración desde backup.

## 15. Estado final

- Las 12 migraciones quedan **aplicadas** en staging.
- **No** se desplegaron Edge Functions (siguen en 0).
- **No** se configuraron secrets (siguen en 0).
- **No** se creó webhook, preferencia, pago, pedido QA ni compra.
- Backups intactos y revalidados.
- Git limpio en `d1829ab0ad3206777b5fb2013e2db8378251e920`; sin push (NO_UPSTREAM).
- Lock liberado tras verificar el PID propio.
- Único cambio de estado local fuera del repo: `supabase/.temp/project-ref` (link, ignorado por
  `supabase/.gitignore`, reversible con `supabase unlink`).

## 16. Declaración

**TABA2_STAGING_DATABASE_MIGRATIONS_APPLIED_AND_HOSTED_GATES_PASSED**

Gates cumplidos: preflight 17/17 · segundo dry-run idéntico · 12 migraciones exit 0 · historial
verificado con las 27 filas originales intactas · `RIDER_MAP_REMOTE_ONLY_CONTRACT_PRESERVED=PASS` ·
`BUSINESS_PANEL_RECONCILIATION_HOSTED_PASS` · `HOSTED_PG_CRON_SCHEDULER_PASS` ·
`HOSTED_MERCADOPAGO_DB_CONTRACT_PASS` · `HOSTED_PGTAP_131_PASS` (131/131) · datos intactos ·
secret scan verde · Git limpio · lock liberado.

**Pendiente para una autorización posterior y separada**: Edge Functions, secrets de test, RC web y
webhook sin compra. El flujo de pagos **no** está operativo todavía: el scheduler corre pero es
no-op hasta que existan las Functions y los secretos de Vault.
