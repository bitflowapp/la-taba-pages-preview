# La Taba → Taba Fiscal Core · adopción

La Taba pasa a usar **un solo motor fiscal**: el de `bitflowapp/taba-fiscal` (PR #1,
rama `feat/fiscal-core-hardening`, SHA `26d2f4cb9e379789b52e4a85e88f39910b0e852f`).
La fuente de verdad de lo adoptado es [`fiscal-core.json`](../fiscal-core.json); las
pruebas de `tests/fiscal-core-adoption.test.mjs` impiden que se desvíe.

Esta fase es de base de datos, contratos, worker y pruebas. **No cambia la UI, no toca
producción, no habilita ARCA en producción y no define política contable.**

| | |
|---|---|
| CORE_ADOPTION_READY | **YES** (técnico: esquema, contratos, worker canónico y pruebas) |
| PRODUCTION_READY | **NO** (política contable, homologación ARCA con credenciales reales e impresión física pendientes; ver §14) |
| ONLINE_ORDER | **BLOCKED_PENDING_ACCOUNTING_POLICY** |
| ACCOUNTING_POLICY | **HUMAN_ACTION_REQUIRED** |
| ARCA | simulación PASS · homologación NOT_RUN (requiere credenciales) · producción **BLOCKED** |
| PHYSICAL_PRINT | **NOT_VERIFIED** |

## 1. Inventario de partida

| | |
|---|---|
| TABA_MAIN_SHA | `fc97f633f0e26b59ad57cc661ff69931004583c1` |
| CURRENT_MIGRATION_HEAD | `20260926160000_local_print_agent.sql` (140 migraciones; es también la cabeza aplicada en CONTROLLED_PRODUCTION) |
| FISCAL_MIGRATIONS_PRESENT | `20260802160000_business_windows_scanner_fiscal`, `20260802170000_fiscal_document_closure`, `20260802171000_fiscal_document_closure_hardening`, `20260805120000_fiscal_homologation_authorization_split`, `20260816121000_fiscal_profile_events_least_privilege`, `20260926160000_local_print_agent` |
| FISCAL_WORKER_VERSION | copia de La Taba en `services/arca-fiscal-bridge`: el worker del core **anterior** a su PR #1 (el core se extrajo de ahí). No desplegado. Contrato viejo: `claim_fiscal_outbox(text,integer,integer)`, `reserve_fiscal_document_number(uuid,text,bigint)`, `complete_fiscal_attempt(uuid,text,jsonb)` |
| CORE_SHA | `26d2f4cb9e379789b52e4a85e88f39910b0e852f` |
| CORE_MIGRATIONS_REQUIRED_BY_LA_TABA | efectos de `20260926170000` … `20260926220000` del core (seis archivos, ver §2). `20260926221000` y `20260803000000` no hacen falta |
| Baseline (main, antes de tocar nada) | unit 2656/2656 · `npm run check` PASS · pgTAP canónico 524/524 (PG17 + shim local) · worker viejo 22/22 · CI de main: web PASS, job de base falló por `toomanyrequests` de ECR (infraestructura, no código) |

## 2. Qué se adoptó y cómo

No se reaplica **ninguna** migración histórica. Las seis versiones de la base de La Taba
siguen registradas tal cual y ninguna adopción las repite (lo prueba
`tests/fiscal-core-adoption.test.mjs`). Las copias del core **no** se copiaron por tres motivos:

- sus timestamps ya existen en La Taba;
- traen BOM y mojibake;
- `20260926170000` crea un `request_fiscal_document` de 5 parámetros que al lado del final (6) daría `PGRST203`.

Se portaron **efectos**, en migraciones nuevas generadas con `supabase migration new`
(CLI 2.101.0), posteriores a la cabeza. Cada una cita el SHA y el archivo fuente del core:

| Migración nueva | Fuente en el core | Efecto |
|---|---|---|
| `20260927050851_fiscal_core_receiver_vat_condition` | `20260926170000` | RG 5616: `recipient_vat_condition_id` en política y comprobante, snapshot `recipient_vat_conditions`, resolución de política que lo exige |
| `20260927050858_fiscal_core_intent_convergence` | `20260926180000` | identidad de intención (negocio, origen, id, intención) con advisory lock; `fiscal_idempotency_keys` con huella (`23505 IDEMPOTENCY_KEY_REUSED`); un solo camino `private.fiscal_request_invoice` con dos entradas (operador y canal de servidor); `command_source` auditado |
| `20260927050904_fiscal_core_worker_fencing_and_reconciliation` | `20260926190000` + `20260926200000` | lease con `lease_epoch` (TF001), reclamo por entorno + CUIT, reserva write-ahead (`dispatch_count`, `last_dispatch_at`), `begin_fiscal_resend` (período de silencio, tope de 8 envíos), `manual_review`, backfill de estados heredados. Se borran las firmas viejas `(text,integer,integer)`, `(uuid,text,bigint)`, `(uuid,text,jsonb)` y las intermedias |
| `20260927050910_fiscal_core_state_machines` | `20260926210000` | máquinas de estado de comprobante, PDF (lease con epoch) e impresión (TF004); comprobante autorizado inmutable (55000). Conflicto de lease de PDF con `PT409`, no `40001` |
| `20260927050916_fiscal_core_security_hardening` | `20260926220000` | endurecimiento de las 6 funciones y grants; lecturas sin el rol `viewer` (La Taba no lo tiene); "generación en curso" con `PT409`, no `40001` |
| `20260927050921_fiscal_core_la_taba_server_channel_guards` | extensión de La Taba | `service_request_fiscal_document` exige JWT `service_role` **dentro** de la función; `WHATSAPP` exige actor; el actor tiene que ser owner/admin/staff activo del negocio. Pendiente de subir al core |

**No adoptado, a propósito**, con los motivos en `fiscal-core.json`:

- transitorios de `170000`;
- firmas intermedias de `190000`;
- las 8 policies con `viewer`;
- `20260926221000` (notification_outbox es de La Taba y ya está protegida);
- `20260803000000` (retrofechada para los stubs del core).

**Equivalencia comprobada.** El esquema adoptado se comparó objeto por objeto con el
resultado de aplicar ingenuamente las migraciones del core sobre La Taba: 95 funciones,
22 tablas y 13 triggers idénticos. Las únicas diferencias son las intencionales:

- 2 cuerpos sin `viewer`;
- la guarda de La Taba;
- 8 policies;
- 3 conflictos con `PT409` en lugar de `40001`.

La matriz (§3) verifica cada una: el código es el del core con **ese** cambio y ningún otro.

**Por qué `PT409`.** El core eleva `40001` en tres conflictos:

- lease de PDF vencido, al completar;
- lease de PDF vencido, al fallar;
- regeneración con un PDF en curso.

PostgREST toma `40001` como falla de serialización y reintenta la transacción. En Staging,
una negativa de negocio con `40001` giró ~125 s hasta el 504 del gateway, y por eso
`20260924200000_revision_conflicts_answer_409` pasó La Taba a `PT409` (HTTP 409 inmediato).
Una prueba de guarda impide que una migración posterior vuelva a elevar `40001`: la
adopción literal la rompía, y así se detectó.

El worker de PDF del core reconoce el lease perdido **solo** por `40001`. Con `PT409`:

- el resultado viejo igual se rechaza: el fencing está en la base;
- el worker lo registra como falla del ciclo en lugar de "lease perdido".

Queda pendiente en el core (§14).

## 3. Matriz de contrato RPC

Leída de tres bases:

- **antes**: `origin/main`;
- **core**: `taba-fiscal@26d2f4c` sobre su propia cadena;
- **después**: La Taba adoptada.

Contrato = nombres y tipos de argumento, retorno, `SECURITY DEFINER`, `search_path` y
grants. El código se compara sin comentarios. PostgREST resuelve por **nombre** de
argumento: una firma vieja da `PGRST202`; dos candidatas, `PGRST203`.

Quién llama: `worker` = `SupabaseFiscalStore` del core; `panel` = `js/repositories` y la
Edge Function de PDF; `gateway` = agente local de impresión; `server` = canales de
servidor (WhatsApp, automatizaciones).

<!-- RPC_MATRIX:BEGIN (generada de los catalogos: antes = origin/main, core = taba-fiscal@26d2f4c, despues = esta rama) -->
| RPC | LA_TABA_BEFORE (main) | CORE_EXPECTED (taba-fiscal@26d2f4c) | AFTER_ADOPTION | STATUS |
|---|---|---|---|---|
| `agent_claim_print_jobs` · gateway | (p_device_id, p_secret_hash, p_document_types, p_limit) → service_role, definer | (p_device_id, p_secret_hash, p_document_types, p_limit) → service_role, definer | (p_device_id, p_secret_hash, p_document_types, p_limit) → service_role, definer | UNCHANGED (= core) |
| `agent_heartbeat` · gateway | (p_device_id, p_secret_hash, p_report) → service_role, definer | (p_device_id, p_secret_hash, p_report) → service_role, definer | (p_device_id, p_secret_hash, p_report) → service_role, definer | UNCHANGED (= core) |
| `agent_register_device` · gateway | (p_pairing_code, p_secret_hash, p_device_name, p_platform, p_agent_version) → service_role, definer | (p_pairing_code, p_secret_hash, p_device_name, p_platform, p_agent_version) → service_role, definer | (p_pairing_code, p_secret_hash, p_device_name, p_platform, p_agent_version) → service_role, definer | UNCHANGED (= core) |
| `agent_request_reprint` · gateway | (p_device_id, p_secret_hash, p_job_id, p_reason, p_operator_label, p_idempotency_key) → service_role, definer | (p_device_id, p_secret_hash, p_job_id, p_reason, p_operator_label, p_idempotency_key) → service_role, definer | (p_device_id, p_secret_hash, p_job_id, p_reason, p_operator_label, p_idempotency_key) → service_role, definer | UNCHANGED (= core) |
| `agent_rotate_device_secret` · gateway | (p_device_id, p_secret_hash, p_new_secret_hash) → service_role, definer | (p_device_id, p_secret_hash, p_new_secret_hash) → service_role, definer | (p_device_id, p_secret_hash, p_new_secret_hash) → service_role, definer | UNCHANGED (= core) |
| `agent_update_print_job` · gateway | (p_device_id, p_secret_hash, p_job_id, p_claim_token, p_transition, p_error_code, p_duration_ms) → service_role, definer | (p_device_id, p_secret_hash, p_job_id, p_claim_token, p_transition, p_error_code, p_duration_ms) → service_role, definer | (p_device_id, p_secret_hash, p_job_id, p_claim_token, p_transition, p_error_code, p_duration_ms) → service_role, definer | UNCHANGED (= core) |
| `assert_fiscal_execution_authorized` | () → service_role, definer | () → service_role, definer | () → service_role, definer | UNCHANGED (= core) |
| `authorize_arca_homologation` · panel | (p_business_id, p_authorization) → authenticated+service_role, definer | (p_business_id, p_authorization) → authenticated+service_role, definer | (p_business_id, p_authorization) → authenticated+service_role, definer | UNCHANGED (= core) |
| `authorize_fiscal_artifact_access` · panel | (p_artifact_id, p_action) → authenticated+service_role, definer | (p_artifact_id, p_action) → authenticated+service_role, definer | (p_artifact_id, p_action) → authenticated+service_role, definer | ADOPTED, CORE_MINUS_VIEWER (verificado) |
| `begin_fiscal_resend` · worker | — | (p_document_id, p_worker_id, p_lease_epoch, p_expected_number) → service_role, definer | (p_document_id, p_worker_id, p_lease_epoch, p_expected_number) → service_role, definer | ADOPTED (= core) |
| `cancel_print_job` | (p_job_id, p_reason) → authenticated, definer | (p_job_id, p_reason) → authenticated, definer | (p_job_id, p_reason) → authenticated, definer | UNCHANGED (= core) |
| `claim_fiscal_artifact_outbox` · worker | (p_worker_id, p_limit, p_lease_seconds) → service_role, definer | (p_worker_id, p_limit, p_lease_seconds) → service_role, definer | (p_worker_id, p_limit, p_lease_seconds) → service_role, definer | ADOPTED (= core) |
| `claim_fiscal_outbox` · worker | (p_worker_id, p_limit, p_lease_seconds) → service_role, definer | (p_worker_id, p_environment, p_cuit, p_limit, p_lease_seconds) → service_role, definer | (p_worker_id, p_environment, p_cuit, p_limit, p_lease_seconds) → service_role, definer | ADOPTED (= core) |
| `complete_fiscal_artifact` · worker | (p_artifact_outbox_id, p_worker_id, p_artifact) → service_role, definer | (p_artifact_outbox_id, p_worker_id, p_lease_epoch, p_artifact) → service_role, definer | (p_artifact_outbox_id, p_worker_id, p_lease_epoch, p_artifact) → service_role, definer | ADOPTED, CORE_WITH_PT409 (verificado) |
| `complete_fiscal_attempt` · worker | (p_outbox_id, p_worker_id, p_result) → service_role, definer | (p_outbox_id, p_worker_id, p_lease_epoch, p_result) → service_role, definer | (p_outbox_id, p_worker_id, p_lease_epoch, p_result) → service_role, definer | ADOPTED (= core) |
| `configure_business_print_settings` | (p_business_id, p_settings) → authenticated, definer | (p_business_id, p_settings) → authenticated, definer | (p_business_id, p_settings) → authenticated, definer | UNCHANGED (= core) |
| `configure_fiscal_profile` · panel | (p_business_id, p_profile) → authenticated+service_role, definer | (p_business_id, p_profile) → authenticated+service_role, definer | (p_business_id, p_profile) → authenticated+service_role, definer | UNCHANGED (La Taba; same contract, code differs) |
| `create_local_device_pairing` | (p_business_id, p_device_name) → authenticated, definer | (p_business_id, p_device_name) → authenticated, definer | (p_business_id, p_device_name) → authenticated, definer | UNCHANGED (= core) |
| `enqueue_authorized_fiscal_artifact` | () → service_role, definer | () → service_role, definer | () → service_role, definer | ADOPTED (= core) |
| `fail_fiscal_artifact` · worker | (p_artifact_outbox_id, p_worker_id, p_error_code, p_error_message, p_retryable) → service_role, definer | (p_artifact_outbox_id, p_worker_id, p_lease_epoch, p_error_code, p_error_message, p_retryable) → service_role, definer | (p_artifact_outbox_id, p_worker_id, p_lease_epoch, p_error_code, p_error_message, p_retryable) → service_role, definer | ADOPTED, CORE_WITH_PT409 (verificado) |
| `fiscal_artifact_storage_path` | (p_business_id, p_document_id, p_generation_token) → service_role | (p_business_id, p_document_id, p_generation_token) → service_role | (p_business_id, p_document_id, p_generation_token) → service_role | UNCHANGED (= core) |
| `fiscal_has_current_parameter_id` | (p_environment, p_parameter_type, p_id) → service_role, definer | (p_environment, p_parameter_type, p_id) → service_role, definer | (p_environment, p_parameter_type, p_id) → service_role, definer | UNCHANGED (= core) |
| `fiscal_json_contains_parameter_id` | (p_value, p_id) → service_role | (p_value, p_id) → service_role | (p_value, p_id) → service_role | UNCHANGED (= core) |
| `get_arca_activation_status` · panel | (p_business_id) → authenticated+service_role, definer | — | (p_business_id) → authenticated+service_role, definer | UNCHANGED (La Taba only) |
| `has_business_role` | (target_business_id, roles) → authenticated+service_role, definer | (p_business_id, p_roles) → anon+authenticated+service_role | (target_business_id, roles) → authenticated+service_role, definer | UNCHANGED (La Taba identity; core has a stub) |
| `is_business_member` | (target_business_id) → authenticated+service_role, definer | (p_business_id) → anon+authenticated+service_role | (target_business_id) → authenticated+service_role, definer | UNCHANGED (La Taba identity; core has a stub) |
| `list_fiscal_document_artifacts` · panel | (p_business_id) → authenticated+service_role, definer | (p_business_id) → authenticated+service_role, definer | (p_business_id) → authenticated+service_role, definer | ADOPTED, CORE_MINUS_VIEWER (verificado) |
| `operator_create_local_device_pairing` | (p_business_id, p_device_name) → service_role, definer | (p_business_id, p_device_name) → service_role, definer | (p_business_id, p_device_name) → service_role, definer | UNCHANGED (= core) |
| `operator_revoke_local_device` | (p_device_id, p_reason) → service_role, definer | (p_device_id, p_reason) → service_role, definer | (p_device_id, p_reason) → service_role, definer | UNCHANGED (= core) |
| `protect_authorized_fiscal_document` | () → anon+authenticated+service_role | () → service_role | () → service_role | ADOPTED (= core) |
| `protect_authorized_fiscal_document_item` | () → anon+authenticated+service_role | () → service_role, definer | () → service_role, definer | ADOPTED (= core) |
| `record_fiscal_credential_health` | (p_business_id, p_certificate_fingerprint, p_certificate_expires_at, p_certificate_subject_cuit, p_delegation_status, p_connection_ok, p_error_code) → service_role, definer | — | (p_business_id, p_certificate_fingerprint, p_certificate_expires_at, p_certificate_subject_cuit, p_delegation_status, p_connection_ok, p_error_code) → service_role, definer | UNCHANGED (La Taba only) |
| `record_fiscal_verification` · panel | (p_business_id, p_verification) → authenticated+service_role, definer | — | (p_business_id, p_verification) → authenticated+service_role, definer | UNCHANGED (La Taba only) |
| `request_credit_note` · panel | (p_original_document_id, p_reason, p_credit_kind, p_lines, p_idempotency_key) → authenticated+service_role, definer | (p_original_document_id, p_reason, p_credit_kind, p_lines, p_idempotency_key) → authenticated+service_role, definer | (p_original_document_id, p_reason, p_credit_kind, p_lines, p_idempotency_key) → authenticated+service_role, definer | ADOPTED (= core) |
| `request_fiscal_artifact_regeneration` · panel | (p_fiscal_document_id) → authenticated+service_role, definer | (p_fiscal_document_id) → authenticated+service_role, definer | (p_fiscal_document_id) → authenticated+service_role, definer | ADOPTED, CORE_WITH_PT409 (verificado) |
| `request_fiscal_document` · panel | (p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key) → authenticated+service_role, definer | (p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key, p_command_source) → authenticated, definer | (p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key, p_command_source) → authenticated, definer | ADOPTED (= core) |
| `request_fiscal_print_job` · panel | (p_fiscal_document_id, p_artifact_id, p_printer_name_hash, p_format, p_copies, p_idempotency_key) → authenticated+service_role, definer | (p_fiscal_document_id, p_artifact_id, p_printer_name_hash, p_format, p_copies, p_idempotency_key) → authenticated+service_role, definer | (p_fiscal_document_id, p_artifact_id, p_printer_name_hash, p_format, p_copies, p_idempotency_key) → authenticated+service_role, definer | ADOPTED (= core) |
| `request_full_credit_note` · panel | (p_original_document_id, p_reason, p_idempotency_key) → authenticated+service_role, definer | (p_original_document_id, p_reason, p_idempotency_key) → authenticated+service_role, definer | (p_original_document_id, p_reason, p_idempotency_key) → authenticated+service_role, definer | UNCHANGED (= core) |
| `request_order_print_job` | (p_order_id, p_document_type, p_idempotency_key) → authenticated, definer | (p_order_id, p_document_type, p_idempotency_key) → authenticated, definer | (p_order_id, p_document_type, p_idempotency_key) → authenticated, definer | UNCHANGED (= core) |
| `request_print_job_reprint` | (p_job_id, p_reason, p_idempotency_key) → authenticated, definer | (p_job_id, p_reason, p_idempotency_key) → authenticated, definer | (p_job_id, p_reason, p_idempotency_key) → authenticated, definer | UNCHANGED (= core) |
| `reserve_fiscal_document_number` · worker | (p_document_id, p_worker_id, p_expected_number) → service_role, definer | (p_document_id, p_worker_id, p_lease_epoch, p_expected_number, p_issue_date) → service_role, definer | (p_document_id, p_worker_id, p_lease_epoch, p_expected_number, p_issue_date) → service_role, definer | ADOPTED (= core) |
| `resolve_fiscal_accounting_policy` | (p_business_id, p_environment, p_issuer_condition, p_recipient_condition, p_concept, p_invoice_type, p_effective_on) → service_role, definer | (p_business_id, p_environment, p_issuer_condition, p_recipient_condition, p_concept, p_invoice_type, p_effective_on) → service_role, definer | (p_business_id, p_environment, p_issuer_condition, p_recipient_condition, p_concept, p_invoice_type, p_effective_on) → service_role, definer | ADOPTED (= core) |
| `resolve_print_job_review` | (p_job_id, p_resolution, p_note) → authenticated, definer | (p_job_id, p_resolution, p_note) → authenticated, definer | (p_job_id, p_resolution, p_note) → authenticated, definer | UNCHANGED (= core) |
| `revoke_local_device` | (p_device_id, p_reason) → authenticated, definer | (p_device_id, p_reason) → authenticated, definer | (p_device_id, p_reason) → authenticated, definer | UNCHANGED (= core) |
| `save_fiscal_parameter_snapshot` · worker | (p_environment, p_parameter_type, p_version, p_values_json, p_synchronized_at) → service_role, definer | (p_environment, p_parameter_type, p_version, p_values_json, p_synchronized_at) → service_role, definer | (p_environment, p_parameter_type, p_version, p_values_json, p_synchronized_at) → service_role, definer | ADOPTED (= core) |
| `service_request_fiscal_document` · server | — | (p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key, p_command_source, p_actor_id) → service_role, definer | (p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key, p_command_source, p_actor_id) → service_role, definer | ADOPTED + LA_TABA_GUARDS |
| `update_fiscal_print_job` · panel | (p_print_job_id, p_status, p_error_code) → authenticated+service_role, definer | (p_print_job_id, p_status, p_error_code) → authenticated+service_role, definer | (p_print_job_id, p_status, p_error_code) → authenticated+service_role, definer | ADOPTED (= core) |
<!-- RPC_MATRIX:END -->

Resumen: 47 RPC fiscales y de impresión.

| Estado | Cantidad |
|---|---|
| Iguales al core, sin cambios | 21 |
| Adoptadas iguales al core | 14 |
| Adoptadas con diferencia intencional verificada: sin `viewer` | 2 |
| Adoptadas con diferencia intencional verificada: `PT409` en lugar de `40001` | 3 |
| Adoptada con guardas de La Taba | 1 |
| Propias de La Taba sin cambios | 3 |
| Identidad de La Taba (el core usa un stub) | 2 |
| `configure_fiscal_profile` | 1 (ver abajo) |

**Ninguna sobrecarga.** Las firmas del worker anterior ya no existen.

`configure_fiscal_profile` tiene el mismo contrato que el core. La Taba además valida
`default_concept`: es candidata a subir al core.

Dos pruebas lo fijan en CI (`fiscal_core_contract_test.sql`):

- las 8 RPC del worker existen con los nombres que envía `SupabaseFiscalStore`;
- las 12 llamadas fiscales de los clientes de La Taba resuelven por nombre a una sola
  función. Se verificó que falla si vuelve el `request_fiscal_document` de 5 parámetros.

## 4. Un solo worker

- **Canónico**: `bitflowapp/taba-fiscal` · `services/arca-fiscal-bridge` · entrada
  `dist/src/index.js`, en el SHA de `fiscal-core.json`. Se despliega según
  [`docs/fiscal-core/ARCA-HOMOLOGATION-RUNBOOK.md`](fiscal-core/ARCA-HOMOLOGATION-RUNBOOK.md).
- **Copia de La Taba: ELIMINADA.** Se quitaron `services/arca-fiscal-bridge/` (25 archivos),
  los scripts `fiscal:install/build/test` y los pasos de CI. Evidencia:
  - ningún módulo de La Taba la importaba;
  - no estaba desplegada: `docs/PANEL-ARCHITECTURE-DECISION.md` la listaba como
    **No desplegado**. `docs/CONTROLLED-PRODUCTION-STATUS.md` registra ARCA sin activar y el
    bucket `fiscal-documents` con 0 objetos;
  - las pruebas de guarda fallan si vuelve la carpeta o un script que la nombre.
- **Los dos workers no pueden procesar la misma cola.**
  - Las firmas del worker anterior se eliminaron: sus llamadas de reclamo, reserva y cierre
    responden `PGRST202`. Lo prueba el escenario E de la verificación y lo fija pgTAP.
  - El reclamo canónico exige entorno y CUIT, sin valores por defecto: una llamada vieja no
    resuelve a la nueva.
  - La cola de PDF conserva el mismo `claim_fiscal_artifact_outbox(p_worker_id, p_limit, p_lease_seconds)`
    en el core y en el worker viejo. Un worker viejo que alguien encendiera podría *tomar* un
    PDF, pero no completarlo ni fallarlo (`PGRST202`). El lease vence en 120 s y lo retoma
    el canónico.
  - Pendiente para el core: acotar ese reclamo.

## 5. PR #104

**PR_104_DECISION: SUPERSEDED + KEEP_PARTS → CLOSE.**

Qué es #104:

- su worker es el mismo worker anterior del core;
- su migración `170000` es idéntica en contenido a la del core.

Se rescató:

- la prueba RG 5616, ahora `supabase/tests/fiscal_receiver_vat_condition_test.sql`,
  limpia en UTF-8 y con los ajustes del core, 14/14;
- el runbook de homologación, ahora `docs/fiscal-core/ARCA-HOMOLOGATION-RUNBOOK.md`,
  con nota de procedencia.

No se adopta su script de rollback: es destructivo y aquí se hace roll-forward (§13).

Mergearlo después de esta PR sería fuera de orden (`170000` < cabeza). Además crearía la
sobrecarga de 5 parámetros (`PGRST203`) y regresaría `protect_authorized_fiscal_document`.
Hay que cerrarlo.

## 6. Fail closed y política contable

- **`online_order`**: **BLOCKED_PENDING_ACCOUNTING_POLICY**. La base rechaza con
  `P0001 facturacion online requiere politica fiscal validada`. Está prohibido
  convertir un pedido online en una venta POS inventada con un pago confirmado inventado.
- **`pos_sale`**: solo se factura con todo esto a la vez:
  - una venta POS `completed` del mismo negocio;
  - un snapshot impositivo con importes;
  - una política contable `approved`, habilitada y vigente;
  - snapshots de ARCA vigentes (tipos de comprobante, tipos de documento, condición IVA RG 5616);
  - la autorización de homologación del perfil.
- **Hoy ninguna venta real se factura.** `checkout_pos_sale` guarda
  `{"configured_by_server": true}`, sin importes. El pedido falla con
  `fiscal_policy_review_required` (**ACCOUNTING_POLICY_REQUIRED**), y lo fija pgTAP.
  Las pruebas usan un snapshot **SINTÉTICO** marcado `SINTETICO_NO_ES_POLITICA_CONTABLE`.
- **No se define aquí**, y lo tiene que decidir un contador:
  - IVA por producto;
  - IVA del delivery;
  - descuentos;
  - condición del receptor;
  - momento de facturación;
  - tratamiento de "a coordinar";
  - efectivo pendiente;
  - devoluciones.

## 7. Canal (CommandSource) e identidad del actor

`command_source` es **solo auditoría**:

- queda en `fiscal_events` y en `fiscal_idempotency_keys`;
- no cambia el contenido fiscal;
- no forma parte de la huella: el mismo pedido por cuatro canales converge a un comprobante.

| Entrada | Quién | Actor registrado |
|---|---|---|
| `request_fiscal_document` (`authenticated`) | Panel y celular | `auth.uid()` con sesión vigente (`identity_sessions`) y rol owner/admin/staff; `actor_type = operator`; canal `PANEL`/`MOBILE` o nulo |
| `service_request_fiscal_document` (`service_role`, verificado dentro) | WhatsApp | `p_actor_id` obligatorio: el owner/admin/staff activo del negocio que lo pidió |
| ídem | Automatización | identidad de sistema explícita: `actor_id` nulo, `actor_type = system`, canal `AUTOMATION` |

No se admiten:

- un cliente o un rider como operador (42501);
- el UUID cero;
- `system` cuando hay una persona real (WhatsApp sin actor: 22023);
- un actor de otro negocio (42501).

Los clientes actuales de La Taba no envían canal todavía (queda nulo: "cliente anterior",
con el actor real). Declarar `PANEL`/`MOBILE` es un cambio de UI y va con #106.

## 8. Seguridad

| Propiedad | Dónde se prueba |
|---|---|
| Ninguna función `SECURITY DEFINER` de `public` queda sin `search_path` fijado | pgTAP `production_least_privilege_test` (todo el esquema) |
| Worker y canales de servidor: solo `service_role`; entrada de operador: solo `authenticated`; `anon`: nada | pgTAP contrato |
| El GRANT no alcanza: `service_request_fiscal_document` verifica el rol del JWT adentro, y ningún wrapper definer puede saltearlo | pgTAP contrato (claims falsos, JWT ausente, búsqueda de wrappers en `prosrc`) |
| Aislamiento por negocio: pedidos, actores, lecturas (RLS), PDF y agentes | pgTAP contrato, carrera de intención, verificación del worker (D) |
| Reclamo por entorno y CUIT; fencing por `lease_epoch` (TF001); serie bloqueada (TF002); reenvío solo con compuerta | pgTAP contrato y upgrade, carrera, verificación (B, C) |
| Comprobante autorizado inmutable (55000); transiciones inválidas (TF004) | pgTAP contrato y `fiscal_document_closure_test` |
| Reúso de clave con otro contenido: `23505` | pgTAP contrato |
| Un conflicto responde 409 al instante (`PT409`); ninguna función eleva `40001` (PostgREST lo reintentaría hasta el 504) | pgTAP contrato (catálogo + lease de PDF viejo al completar y al fallar + regeneración en curso), guarda `tests/revision-conflict-409`, verificación (F) |

## 9. Pruebas contra el esquema real de La Taba

Todo corre sobre la cadena **real** de La Taba, no sobre los stubs del core.

| Prueba | Qué cubre | Dónde |
|---|---|---|
| `supabase/tests/fiscal_core_contract_test.sql` (55) | superficie, nombres, grants, convergencia de 4 canales, fail closed, aislamiento, guardas, fencing del worker, máquinas de estado | CI |
| `supabase/tests/fiscal_core_upgrade_test.sql` (24) | filas heredadas en todos los estados antes de migrar (ver abajo) | CI |
| `supabase/tests/fiscal_receiver_vat_condition_test.sql` (14) | RG 5616, rescatada de #104 | CI |
| suites fiscales existentes de La Taba | adaptadas con los mismos cambios que hizo el core a sus copias | CI |
| `scripts/fiscal-core/intent-race.mjs` | 10/50/100 pedidos simultáneos por los 4 canales → 1 comprobante; 12 workers → 1 reclamo, 1 número, 1 autorización; aislamiento | CI (después del pgTAP) |
| `npm run fiscal:core:verify` | el worker **canónico** del core contra La Taba (§10) | local (el repo del core es privado: CI no puede clonarlo sin secretos, y `tests/ci-workflow` los prohíbe) |

El total canónico de pgTAP que exige `scripts/run-release-v5-db.mjs` es 617. La fixture
de filas heredadas se carga en la cabeza `20260926160000`, **antes** de las migraciones de
adopción.

**Upgrade** (`supabase/tests/fixtures/fiscal_core_legacy_rows.sql`):

| Fila heredada | Antes | Después |
|---|---|---|
| L1 | `queued` | igual |
| L2 | `retry_wait` | igual |
| L3 | `authorizing`, número 10, lease vencido | `ambiguous` con envío registrado: se concilia antes de reenviar |
| L4 | `ambiguous`, número 11 | `ambiguous` con envío registrado |
| L5 | `authorizing` sin número | `retry_wait` |
| L6 | `ambiguous` sin número (dead letter) | `retry_wait` |
| L7 | `authorized` 9 con CAE, PDF e impresión | intacto |
| L8 | `rejected` con número 12 | número liberado, con evento |
| L9 | `failed` (nota de crédito de L7) | `manual_review`, con la imputación de crédito re-reservada |
| L10 | `failed` | igual |
| L11 | `rejected` | igual |

Resultado: no se pierde nada, no hay duplicados, ningún número se reutiliza y no se pierde
ninguna imputación. Un reclamo canónico devuelve exactamente L1–L6. Reservar 10 o 9 da
TF002, y L3 ambigua da TF006.

## 10. Worker canónico contra La Taba (`npm run fiscal:core:verify`)

`scripts/fiscal-core/verify-canonical-worker.mjs` ejecuta **el código del core**:

- `FiscalWorker`, `SupabaseFiscalStore`, `SupabasePrivateArtifactStorage` y
  `FiscalArtifactWorker`, del checkout en el SHA fijado, limpio y compilado.

Contra qué corre:

- una base local descartable migrada con la cadena de La Taba;
- PostgREST/Storage emulados por `scripts/fiscal-core/postgrest-shim.mjs`: rol y claims por
  pedido, llamadas por nombre, `PGRST202/203`;
- ARCA = `FakeArca` del core. Toda autorización es **SIMULADA** y el `fetch` global queda
  bloqueado.

Qué código de La Taba pasa por ahí:

- los pedidos, por el **repositorio real del Panel**;
- la impresión, por el **gateway real** del agente local.

| Escenario | Resultado |
|---|---|
| A · E2E: pedido → claim → reserve → FakeArca → authorize → persist → PDF → trabajo de impresión → agente (claim, printing, printed) | 1 comprobante, 1 número, 1 FECAESolicitar, 1 PDF (hash y tamaño verificados), 1 trabajo; WhatsApp repetido no reemite ni reimprime |
| B1 · ARCA procesa, se pierden la respuesta y la consulta; el worker reinicia | `ambiguous` → FECompConsultar → autorizado con el mismo número y CAE; 0 reenvíos |
| B2 · el worker cae después de que ARCA autorizó y antes de registrarlo | lease vencido → `ambiguous` auditado (`lease_expired_during_dispatch`) → el worker nuevo recupera el CAE del log; 0 reenvíos |
| C · 10/50/100 pedidos simultáneos por los 4 canales; 3 workers a la vez | 1 comprobante por venta; números 1..3; 3 FECAESolicitar; las esperas de serie son TF002 |
| D · aislamiento | pedido, actor y PDF ajenos denegados; cada worker solo reclama su CUIT; cada agente solo su negocio |
| E · contrato del worker anterior | reclamo, reserva y cierre (y cierre/falla de PDF) responden `PGRST202` |
| F · conflicto de PDF | un resultado con lease viejo recibe `PT409` (HTTP 409, no reintentable) por el store canónico; el shim devuelve 504 ante un `40001`, como PostgREST |

Se comprobó que la verificación **falla** si:

- se desactiva el trigger de impresión fiscal;
- vuelve la firma vieja de reclamo;
- vuelve la firma vieja de cierre.

Las 4 aserciones de `PT409` del pgTAP de contrato fallan sobre el esquema con `40001`.

Pasa tanto con superusuario como con `postgres` sin superusuario (como en CI).

```sh
# checkout del core en el SHA de fiscal-core.json, compilado:
#   git -C $TABA_FISCAL_DIR checkout 26d2f4cb9e379789b52e4a85e88f39910b0e852f
#   npm --prefix "$TABA_FISCAL_DIR/services/arca-fiscal-bridge" ci && npm --prefix "$TABA_FISCAL_DIR/services/arca-fiscal-bridge" run build
TABA_LOCAL_FISCAL_DB=1 TABA_FISCAL_DIR=/ruta/a/taba-fiscal \
  npm run fiscal:core:verify -- postgres://postgres@127.0.0.1:<puerto>/<base-local-descartable>
```

Solo acepta bases locales. **PHYSICAL_PRINT: NOT_VERIFIED**: el agente es simulado.

## 11. PostgreSQL

- **Objetivo: PostgreSQL 17**:
  - `supabase/config.toml` `major_version = 17`;
  - CI con `public.ecr.aws/supabase/postgres:17.6.1.166`;
  - CONTROLLED_PRODUCTION en 17.6;
  - corridas locales en 17.10.
- El CI del core usa PostgreSQL 16.
- Lo más nuevo que usan las migraciones de adopción: `trim_scale` (PG 13), `hashtextextended`
  y `sha256` (PG 11), `gen_random_uuid` en el core de PostgreSQL (PG 13), `make_interval` y
  `skip locked`. No usan nada exclusivo de PG 15, 16 o 17. **Mínimo: PG 13.** Compatible
  con los dos.

## 12. Codificación

`npm run check` ejecuta `scripts/check-sql-encoding.mjs` sobre:

- `supabase/migrations` y `supabase/tests`;
- `scripts/fiscal-core` y `docs/fiscal-core`;
- `fiscal-core.json` y este documento.

Exige UTF-8 válido. Rechaza:

- BOM, y U+FEFF o U+FFFD en el medio;
- caracteres de control;
- el mojibake de UTF-8 releído como CP437/CP850 o Windows-1252.

Sobre las copias históricas del core marca 12 BOM y 164 líneas con mojibake; sobre La Taba,
nada. Lo portado se reparó antes de adoptarlo.

## 13. Despliegue y roll-forward

**Despliegue.** Cada paso con evidencia; si uno falla, se detiene.
Nada de esto está hecho: requiere revisión y merge de esta PR.

1. **PAUSE.** Confirmar que no corre ningún worker fiscal. Hoy no hay ninguno desplegado. Si
   existiera, detenerlo. De todos modos, las migraciones hacen fallar cerrado al worker viejo.
2. **Reconciliar** (solo lectura) en el destino:
   `select environment, state, count(*) from public.fiscal_documents group by 1, 2;` y
   `select state, count(*) from public.fiscal_outbox group by 1;`.
   - En CONTROLLED_PRODUCTION se espera 0: ARCA nunca se habilitó.
   - Si hubiera filas en `authorizing`/`ambiguous`, el upgrade las deja con el envío
     registrado y el worker canónico consulta a ARCA antes de cualquier reenvío (§9, L3/L4).
3. **Backup y ensayo con datos reales.**
   - `scripts/controlled-production/restore-drill.mjs`: `pg_dump` bajo snapshot y restauración
     en un PG 17 aislado.
   - Sobre esa copia, aplicar las 6 migraciones como en CI (rol `postgres` sin superusuario).
   - Correr el pgTAP de contrato y de upgrade, y `npm run fiscal:core:verify`.
4. **Aplicar el delta.**
   - `supabase db push --linked --dry-run` tiene que listar **exactamente** los 6 archivos
     `20260927050851` … `20260927050921`.
   - Después, `supabase db push --linked`. Ledger 146 = 146.
5. **Validar las RPC en el destino.**
   - Las firmas nuevas existen y las viejas no (`to_regprocedure`).
   - Sin sobrecargas.
   - Grants como en §3/§8.
   - `anon` sin nada nuevo.
   - Deriva nula contra las mismas migraciones en PG 17 (misma técnica que en
     `docs/CONTROLLED-PRODUCTION-STATUS.md`).
6. **Web.** Desplegar el commit mergeado. No cambia nada visible, pero el ensayo de rollback
   exige que la web corresponda al grafo de migraciones (`ROLLBACK_DB_GRAPH_INCOMPATIBLE`).
7. **Worker canónico, solo homologación.**
   - Del checkout en el SHA de `fiscal-core.json`, según el runbook: chequeo de credenciales
     y FEDummy (AppServer/DbServer/AuthServer OK).
   - Requiere certificado, CUIT, delegación y punto de venta: **acción humana**.
8. **Smoke con FakeArca**: `npm run fiscal:core:verify` sobre la copia del paso 3, **nunca**
   sobre la base viva.
9. **Smoke local**: el agente de la PC del mostrador toma un `fiscal_receipt` de un tenant QA
   ya autorizado en homologación. La impresión física la verifica una persona.
10. **RESUME**: encender el ciclo del worker (homologación) y seguir `fiscal_events`.

**Roll-forward, sin rollback destructivo.**

- Ninguna migración borra datos fiscales. Los estados solo avanzan por las máquinas de
  estado, y ningún comprobante se elimina.
- Ninguna migración usa sentencias que no puedan ir dentro de una transacción
  (`CONCURRENTLY`, `ALTER TYPE … ADD VALUE`, `BEGIN`/`COMMIT` propios). Cada archivo puede
  aplicarse atómicamente.
- Si una falla: revisar el ledger (`supabase migration list --linked`), no editar una
  migración ya aplicada y corregir con una migración **nueva** posterior. El ensayo del paso
  3 existe para que esto no pase en el destino.
- Interruptores no destructivos:
  - detener el worker: las filas esperan en `fiscal_outbox`;
  - `configure_fiscal_profile` con `is_enabled = false` (owner/admin desde el Panel): los
    pedidos nuevos fallan cerrados con `fiscalizacion deshabilitada`;
  - sin la autorización de homologación del perfil, el trigger
    `fiscal_documents_require_execution_authorization` impide crear comprobantes.
- No se restauran funciones viejas: devolverían las sobrecargas y el worker viejo.
- La web solo puede volver a un despliegue construido con este grafo de migraciones.
- El rollback de #104 no se adopta.

## 14. Bloqueos y acción humana

| Bloqueo | Acción |
|---|---|
| Política contable | **HUMAN_ACTION_REQUIRED**: un contador define IVA por producto, delivery, descuentos, receptor, momento de facturación, "a coordinar", efectivo pendiente y devoluciones. Hasta entonces, `ACCOUNTING_POLICY_REQUIRED` y no se factura |
| Homologación ARCA | certificado, CUIT, delegación WSFE y punto de venta de homologación; FEDummy y comprobante de prueba según el runbook. **ARCA_HOMOLOGATION: NOT_RUN** |
| Producción ARCA | **BLOCKED** hasta homologación completa y política aprobada |
| Impresión física | **NOT_VERIFIED**: verificar con la PC del mostrador y la impresora real |
| PR #106 | **BLOCKED_UNTIL_THIS_PR_MERGED**. Rehacer sobre esta rama: su migración `20260926230000_*` quedaría fuera de orden (anterior a `20260927050921`) y hay que regenerarla con `supabase migration new`. Tiene que usar las entradas adoptadas y no puede convertir `online_order` en una venta POS inventada |
| PR #107 (WhatsApp) | **BLOCKED_UNTIL_106_REBUILT**. Usará `service_request_fiscal_document` con `WHATSAPP` y el actor real |
| PR #104 | cerrar (§5) |
| Pendientes en el core | elevar `PT409` (no `40001`) en los conflictos de PDF y reconocerlo en el worker de PDF (`ARTIFACT_LEASE_LOST_SQLSTATE`); subir la guarda de canal de servidor de La Taba; acotar `claim_fiscal_artifact_outbox` por entorno/CUIT; decidir `viewer`; validación de `default_concept` |
| Verificación del worker en CI | necesita acceso de solo lectura al repo privado del core. Hoy corre local; el resto corre en CI |
