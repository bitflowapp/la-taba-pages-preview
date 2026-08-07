# BUSINESS-PANEL-HARDENING — auditoría y endurecimiento del Panel del negocio

Fecha: 2026-08-07 · Worktree: `la-taba2-business-panel-hardening` ·
Rama: `feature/taba2-business-panel-hardening` · Base: `11a0b02`

| | |
| --- | --- |
| Commits | `5220ce9` (cliente + migración), `07ceef4` (alfabeto de claves), `54ba648` (POS fiscal + E2E), `433f638` (informe), + el commit de la recertificación (carrera de acceso + eventos de negocio + spec staging). Todos locales, sin push. |
| Staging mutado | `la-taba-staging` (`ukxqbgswjlibmnjemrzd`): migraciones `20260807090000` y `20260807100000` aplicadas por `supabase db push`; Edge Function `mercadopago-refund` re-desplegada. Pedidos de certificación: LT-0084 (delivered, retirado a QA), LT-0085/LT-0088 y los del smoke (cancelados). Nada más. |
| Lock | `taba2-business-panel-hardening.txt` en el directorio compartido de locks. El lock ajeno `taba2-staging-mutation.lock` (HOLDING, espera compra iPhone) se respetó: no se tocó su deploy de Pages ni sus pedidos, y la migración **arregla** su Panel desplegado (ver H1). |
| Producción / ARCA real / LT-0030 | Intactos. `fiscal_documents` y `fiscal_outbox` sin actividad nueva. |

## 0. El hallazgo que ordena todo lo demás

**La UI web del Panel estaba rota en producción mientras todas las
certificaciones daban verde.** La certificación viva (47/47) llama a los RPC
directamente; la UI real pasa por capas (claves de idempotencia, outbox,
repositorios) que nadie había certificado. Dos consecuencias medidas:

- **H1 — Ninguna transición ni cancelación de la UI podía confirmarse.**
  El Panel generaba claves `transition_order:<uuid>:<rev>:<estado>`
  (`js/production-operations.js:1525`) y el servidor exige
  `^[A-Za-z0-9_-]{8,128}$` — sin `:` —
  (`supabase/migrations/20260802160000...sql:113,149,190` y `:69`). El RPC
  respondía `22023`, el outbox lo clasificaba **`failed` permanente**
  (no-retryable) y el pedido no se movía nunca. `normalizeIdempotencyKey`
  aceptaba el `:` (`supabase_order_repository.js:2674`), así que ninguna capa
  lo detenía antes del servidor. Packing y fiscal aceptan `:` desde siempre:
  era un desalineamiento de esas cuatro funciones, no un diseño.
- **H2 — Todo el workspace rider web llamaba contratos muertos.**
  `claim_available_rider_order` 4-arg (dropeada en `20260801040000:137`),
  `confirm_order_delivery` (revocada en `20260802100000:793`),
  `publish_rider_location` 6-arg (dropeada en `20260801040000:451`), y los
  avances de estado iban por `transition_order`, que exige rol de negocio que
  un rider no tiene. Claim, retiro, salida, llegada, GPS y entrega: **todo**
  fallaba desde la UI.

Ambos quedaron corregidos en cliente y servidor (ver §2 y §3).

## 1. Matriz de las 18 áreas

Clasificación ANTES de esta intervención → DESPUÉS. "OPERATIVO" exige:
persistencia, autorización server-side, idempotencia, loading/error/retry,
auditabilidad y prueba automatizada.

| # | Área | Antes | Después | Evidencia clave |
| --- | --- | --- | --- | --- |
| 1 | Pedidos entrantes (bandeja) | OPERATIVO | OPERATIVO | Snapshot PostgREST con `origin='production'` + validación de filas completas (`supabase_order_repository.js:221-269`); realtime `postgres_changes` + poll incondicional 5 s (`business-order-intake.js`); RLS `can_access_order`. Ahora además trae `order_combos(*)`. |
| 2 | Aceptar / rechazar | **ROTO** (H1) | OPERATIVO | `transition_order`/`cancel_order` con receipt + request_hash + CAS de revisión (M160:95-204). Claves saneadas y deterministicas; botón con estado en vuelo; conflicto detectado por `errorCode 40001`. Rechazar = cancelar con motivo obligatorio (auditado en `order_events`). |
| 3 | Preparación (packing) | OPERATIVO | OPERATIVO endurecido | Sesión única por pedido, scans con `unique(session_id,scan_key)`, confirm con receipts (M160/M200). La migración revoca `confirm_packing_session`/`undo_last_packing_scan` superseded que bypasseaban los receipts. |
| 4 | Rider (workspace web) | **ROTO** (H2) | OPERATIVO | Recableado al contrato canónico con revisión + clave idempotente en cada paso; cadena `assigned→picked_up→on_the_way→arrived→código`; refusals `{ok:false,code}` traducidos; cola con `revision` hasta el botón. Tests de mock espejo del servidor. |
| 5 | Tracking | OPERATIVO (cliente) / PARCIAL (panel) | igual + GPS arreglado | Cliente: RPC por token con DTO minimizado (`get_public_order_tracking`). El Panel declara honesto "Seguimiento por estados, sin GPS". El GPS del rider publicaba por una firma dropeada (H2): ahora `publish_rider_location_receipt` con anti-mock, throttle y salto imposible. |
| 6 | Stock (recepción/ajuste/conteo) | OPERATIVO | OPERATIVO | `apply_inventory_movement` con `unique(business_id,idempotency_key)` + ledger inmutable por trigger (M160:435,388). Conteo muestra diferencia y exige confirmación. |
| 7 | Productos (alta por escaneo) | OPERATIVO con reservas | OPERATIVO con reservas | Borrador nunca publica; publicar exige owner/admin; `package_type` ahora validado con error saneado. Reserva vigente: `complete_scanned_product` sin clave de idempotencia server-side (guard `busy` en cliente; riesgo bajo, documentado). |
| 8 | Precios | OPERATIVO (limitado y honesto) | igual | El precio lo carga owner/admin en el alta; "precio pendiente" se ve y no se puede comprar (validado server-side por readiness). El grueso de precios va por el pipeline de catálogo CSV, fuera del Panel — no es placeholder: el Panel lo dice. |
| 9 | Combos | **PARCIAL** (invisible en Panel) | OPERATIVO (visible) | El backend cobra el combo (certificado LT-0079); pero la bandeja no mapeaba `discount_total` ni `order_combos`: subtotal y total "no cerraban" y los reportes inflaban. Ahora: línea "Combo del local −$X", combos con su precio, y test de la invariante `total = subtotal − descuento + envío`. |
| 10 | Mercado Pago (consola) | OPERATIVO con reserva | OPERATIVO | Listado/reconciliación/estados con evidencia real (`list_business_payments`, `enqueue_payment_reconciliation` idempotente). Asistente de 7 pasos basado en evidencia del servidor. La reserva (refund total-vs-parcial, ver #12) cerrada. |
| 11 | Conciliación | OPERATIVO | OPERATIVO | Pagos: `enqueue_payment_reconciliation` (owner/admin) + worker. Diaria: `prepare/close_daily_reconciliation` con advisory lock, claves únicas, CAS de revisión, snapshot SHA-256 e inmutabilidad por trigger (M180:692-810). |
| 12 | Cancelaciones / reembolsos | OPERATIVO con hueco | OPERATIVO | El hueco: la Edge Function decidía reembolso total con el `amount` del navegador; con un parcial previo, lo pedido a MP y lo asentado podían divergir. Ahora decide `prepared.full_refund` de la base (desplegado a staging). Frase escrita + owner/admin + guard de refund en vuelo + tope `v_remaining` server-side. Botón de cancelación con guard de doble click. |
| 13 | Alertas | OPERATIVO con reserva | OPERATIVO | `operational_alerts` persistidas server-side, detectadas por `refresh_operational_alerts`, formato qué-pasó/qué-se-conserva/riesgo/acción. La reserva (ack repetido reatribuía el reconocimiento) cerrada por migración. Aviso sonoro: **NO IMPLEMENTADO** — `business-sound-service.js`/`business-notification-service.js` no los importa nadie; el aviso real es un toast. Etiquetado acá, no se promete en UI. |
| 14 | Reportes | **NO IMPLEMENTADO** (productivo) | igual, etiquetado | `business-reports.js`/`business-metrics.js`/`renderOrderTimeline` sólo los usa el panel demo (`js/business.js`), inalcanzable en producción (4 cierres verificados). El único número real del Panel productivo es el cierre del día (#11). No hay superficie que prometa reportes: no hay placeholder que borrar. |
| 15 | Usuarios / roles | PARCIAL | PARCIAL, etiquetado | Autorización real en TODAS las escrituras (`has_business_role` en cada RPC; verificado función por función). Vistas filtradas por capacidad y re-validadas. **Administrar el equipo no tiene superficie**: `team.manage` existe como capacidad pero ningún view la usa; altas/bajas de miembros son operación de soporte (SQL). La UI no ofrece ningún botón al respecto: sin mentira, sin superficie. |
| 16 | Historial / auditoría | OPERATIVO (backend) / PARCIAL (UI) | igual | Todo deja rastro: `order_events` con secuencia, `business_command_receipts`, `scanned_product_audit`, `operational_alert_events`, `fiscal_events`, packing y pagos. La UI productiva muestra los estados pero no una línea de tiempo por pedido (el timeline es demo-only). Sin promesa incumplida en UI. |
| 17 | Facturación ARCA | **ROTO/PLACEHOLDER** (ver §4) | PARCIAL honesto, **NO OPERATIVO** | Contrato cortado en 3 lugares independientes; sin sandbox. La UI ya no puede mentir: presenter cubre todos los estados reales, el POS no ofrece comprobante sin `is_enabled`, guardar el perfil no apaga la facturación en silencio, y los pasos sin superficie lo dicen. El asistente nunca muestra "operativa" (headline: "Falta configurar la facturación"). |
| 18 | Apertura / cierre del día / dispositivos | OPERATIVO | OPERATIVO endurecido | Apertura con veredicto en 3 niveles y "sin verificar ≠ bueno"; cierre firmado inmutable con `CERRAR IGUAL`; dispositivos honestos ("trabajo enviado ≠ papel impreso", confirmación humana). Migración: `closed` sólo owner/admin. |

## 2. Endurecimiento aplicado — cliente (commits `5220ce9`, `54ba648`)

1. **Claves de idempotencia** deterministicas con guion + saneo en
   `normalizeIdempotencyKey` (rechaza lo que el servidor rechaza).
2. **Rider** recableado al contrato canónico completo (claim, retiro, salida,
   llegada, entrega por código, GPS), con `revision` y clave por paso, y
   `nextRiderStatus` siguiendo la cadena real.
3. **Outbox**: drena solo al reconectar; el backoff agenda un reintento real
   (`nextDueAt` + timer); `recoverAbandoned({force})` al arrancar; encolado
   serializado (doble click = replay, no excepción); `destroy()` limpia todo.
4. **Honestidad del chip**: un drain vacío no sella reconciliación ni dice
   "Conectado"; sin pendientes dice "Sin comandos pendientes"; sin IndexedDB el
   Panel sigue en modo directo y lo dice.
5. **Botones con estado en vuelo** (aceptar/avanzar/cancelar/claim/confirmar y
   cancelación de pago) y el listener global degrada excepciones a toast.
6. **Combos en bandeja**: `order_combos(*)` en el select, `discountTotal`
   mapeado, línea de descuento en la tarjeta, reportes ya no inflan.
7. **Conflictos** detectados por `errorCode '40001'`/`conflict`, no por regex
   de texto en español (que queda de red de seguridad).
8. **ARCA honesto**: presenter fiscal completo; `is_enabled`/`default_concept`
   preservados al guardar; checkbox fiscal del POS condicionado a activación
   real; `recordVerification` cableado a evidencia real (preview → `artifact`;
   sólo impresión verificada → `print`); copy de pasos contador/conexión/
   delegación sin promesas de botones inexistentes.
9. **`business_order_snapshot`** (RPC que nunca existió) reemplazado por la
   consulta PostgREST real.

## 3. Endurecimiento aplicado — backend (migración `20260807090000`, APLICADA a staging)

1. Revocación de `confirm_packing_session(uuid,text)` y
   `undo_last_packing_scan(uuid)` (superseded, sin receipts).
2. `list_fiscal_document_artifacts` y `authorize_fiscal_artifact_access`
   exigen rol owner/admin/staff (antes cualquier miembro, **incluido rider**,
   podía listar comprobantes y obtener la URL firmada del PDF).
3. `configure_fiscal_profile` valida `default_concept ∈ (1,2,3)`.
4. `publish_catalog_product_draft` valida `package_type` con `22023` saneado.
5. `transition_operational_alert`: el "Ya la vi" repetido es replay, no
   reatribución del reconocimiento.
6. `set_business_open_state`: `closed` exige owner/admin (abrir/pausar sigue
   siendo del equipo, como documenta el manual).
7. Las cuatro funciones de comando aceptan el mismo alfabeto de claves que
   packing y fiscal (`:` permitido). **Esto arregla el Panel 0d7bfee ya
   desplegado en staging sin redeploy.** Transcripción fiel verificada por
   test: auth, rol, receipts, request_hash y CAS intactos
   (`tests/business-panel-hardening.test.mjs`).

Además: Edge Function `mercadopago-refund` desplegada con la decisión
total-vs-parcial por `prepared.full_refund`.

## 4. ARCA — auditoría contractual completa (sin emitir, sin credenciales)

**Veredicto: el circuito no es certificable hoy, ni siquiera simulado. La UI
no lo presenta como operativo (y tras este endurecimiento, no puede).**

Lo sólido (implementado y probado en aislamiento): WSAA completo (TRA, CMS,
anti-XXE, caché, single-flight), WSFEv1 (FEDummy, último autorizado,
FECAESolicitar, consulta), validación pre-envío, reconciliación de ambiguos
comparando 5 campos, outbox con lease/SKIP LOCKED/backoff/dead-letter,
numeración con advisory lock + unique, inmutabilidad post-CAE, notas de
crédito con allocations y saldo, PDF determinista + QR + storage privado con
URL firmada de 60 s, producción bloqueada por triple defensa.

Los tres cortes, cada uno suficiente para que nunca se emita nada:

1. `checkout_pos_sale` escribe `tax_snapshot = {configured_by_server:true}`
   (M160:717) y `request_fiscal_document` exige las cinco claves de importes
   (M170:751): **toda venta POS rompe en el primer ítem**.
2. No existe RPC, UI ni seed que cree/apruebe `fiscal_accounting_policies`:
   sin política, `request_fiscal_document` lanza siempre (M170:740-746).
3. Nadie llama `record_fiscal_credential_health` (el puente sólo imprime a
   stdout): `certificate_fingerprint_sha256` queda NULL y
   `authorize_arca_homologation` falla siempre (M5120:143). **El botón
   "Habilitar pruebas con ARCA" no puede habilitarse nunca.**

Sin sandbox: no hay transporte mock ni dry-run fuera de los unit tests del
puente; `FEDummy` no tiene botón ni backend; el pgTAP inserta el documento a
mano en vez de pasar por `request_fiscal_document`. Riesgos adicionales
documentados: claim de outbox multi-tenant destructivo, bucle de lease en
`worker.ts:45`, dos frases de homologación no correlacionadas (base vs worker),
`invoice_policy` con 4 de 5 valores sin implementación, `pos_sales` atrapada en
`completed_fiscal_pending` sin camino de vuelta.

Para un contrato certificable en sandbox faltan, en orden: (1) `tax_snapshot`
real en `checkout_pos_sale`; (2) vía de aprobación de políticas contables;
(3) que el puente publique la salud de credenciales; (4) transporte simulado;
(5) test de integración que recorra el contrato entero; (6) `fiscal:test` en CI.

## 5. Gates

| Gate | Resultado |
| --- | --- |
| `npm test` | **1102/1102** (base 1086; +16 de este trabajo) |
| `npm run test:e2e` | **207/207** (Chromium + Firefox; base 206, +1 del POS deshabilitado; re-corrida verde tras el fix de la carrera de acceso) |
| `npm run check` | pasa |
| `npm run migrations:validate` | aprobado (incluye las dos migraciones nuevas) |
| `npm run secrets:scan` | limpio |
| `supabase db push` | `20260807090000` y `20260807100000` aplicadas a `la-taba-staging` |
| `supabase functions deploy mercadopago-refund` | desplegada |
| Certificación viva | 47/47 pipeline · circuito LT-0084 verde · smoke UI 1/1 · 19/19 sondas (§6) |
| `git diff --check` | limpio |

Pruebas nuevas: claves válidas ante el regex del servidor (transition/cancel/
claim/confirm/GPS), contrato canónico del rider en el mock (replay idempotente,
`stale_revision`, `not_active`), combos y descuento en bandeja, presenter
fiscal exhaustivo (ningún estado real cae al default), outbox (serialización,
force-recover, `nextDueAt`, drain al reconectar, reintento agendado, chip sin
mentiras), migración sin pérdida de guardas, y E2E del POS con facturación
habilitada y deshabilitada.

## 6. Recertificación viva — CERRADA (con dos regresiones encontradas y corregidas)

Corrida completa contra `la-taba-staging` con las credenciales obtenidas en
runtime por la CLI (autorizado; nunca impresas ni persistidas), con
`20260807090000` y `20260807100000` aplicadas:

| Prueba viva | Resultado |
| --- | --- |
| `certify:orders:staging` (pipeline completo: pedido único → Panel → rider canónico → código de entrega → QA aislado → pago no falsificable → stock recuperado → LT-0030/33/34/35 intactos) | **47/47** |
| Circuito operativo sobre pedido fresco (LT-0084, delivery): Panel acepta/prepara/listo, revisión atrasada rechazada, claim + doble claim no-op, retiro/salida/llegada, código incorrecto no cierra, entrega con código, dinero inmóvil | **todo verde** (retirado como QA auditado) |
| Smoke de UI del Panel REAL contra staging: login, bandeja antes/después del pedido, 3 pestañas convergentes, snapshots deduplicados, **offline retiene + reconexión recupera**, una sola alerta multi-tab, orden determinístico, **transiciones desde la UI (accepted → preparing)**, no-regresión multi-tab, **reload completo recupera**, una reserva de stock por pedido, limpieza PostgreSQL | **1/1** |
| Bug A muerto sobre datos reales: claves de idempotencia que la UI dejó en `business_command_receipts` (`transition_order-<uuid>-3-accepted`, `-4-preparing`) | todas `^[A-Za-z0-9_-]{8,128}$`, sin `:` |
| Bug B muerto en vivo: `claim_available_rider_order`/`confirm_order_delivery`/packing superseded → `42501 permission denied`; `claim_delivery_order` accesible con refusals saneados | 19/19 sondas |
| Endurecimiento vivo: rider sin acceso a PDFs fiscales, `closed` sólo owner/admin, ack de alertas saneado, `mercadopago-refund` desplegada responde 409 sin frase (sin mover dinero), RLS anónimo = 0 filas | incluido en las 19 sondas |
| Combos reales: LT-0079 y la compra iPhone LT-0086 de la RC de piloto verifican `total = subtotal − descuento + envío` y `order_combos` visible para el Panel | verificado |
| `cancel_order` vivo (ver R2): LT-0088 cancelado por el contrato real con motivo auditado | verificado |

**Las dos regresiones que SOLO la corrida viva destapó** (ambas corregidas,
con test de regresión, y verificadas de nuevo en vivo):

- **R1 — Carrera de activación del acceso.** El submit del login y el evento
  `SIGNED_IN` corrían `activateAuthorizedAccess` en paralelo; el perdedor
  ejecutaba `stopBusinessIntake()` matando el intake del ganador: panel
  autenticado con la bandeja congelada en "Error recuperable". Con la latencia
  real de staging perdía SIEMPRE. Ahora toda activación pasa por una cola de
  una sola corrida (`js/production-operations.js`).
- **R2 — "Cancelar con motivo" nunca funcionó.** `order_events.type` es NOT
  NULL desde la fase 1 y `cancel_order`/`acknowledge_order`/
  `set_preparation_estimate` (20260802160000) insertaban sólo `event_type`:
  la transacción entera se revertía con 23502. Invisible para los scripts de
  certificación porque transicionan por el núcleo de `transition_order`.
  Corregido en `20260807100000` (aplicada a staging) y verificado en vivo.

Nota de coexistencia: durante esta recertificación, la sesión del RC de piloto
completó su compra iPhone real (LT-0086, combo Heineken x6, $21.150) sobre el
backend ya endurecido: recibida → aceptada → preparada → lista → entregada.
Ninguna de las dos corridas pisó a la otra; cada pedido se verificó por su
propio código.

El spec de staging (`tests/staging/business-intake-staging.spec.mjs`) era
anterior al panel multivista y al aislamiento QA: se actualizó para entrar a
la vista Pedidos y para cargar el login desde el main world (93/93 teclas
medidas caían en BODY: el focus de automatización no llega a esos campos; el
contrato del Panel lee FormData del DOM — mismo criterio que el E2E de
Mercado Pago con el form de tarjeta).

## 7. Declaración

El contrato del Panel quedó auditado área por área, endurecido en cliente y
backend, certificado VIVO contra staging por script y por UI real —incluida la
compra iPhone real de la RC de piloto operada de punta a punta sobre este
backend—, con la facturación presentada honestamente como no operativa y sin
ningún botón, métrica o estado que prometa lo que el backend no garantiza.

**TABA2_BUSINESS_PANEL_CONTRACT_CERTIFIED_FOR_PILOT**

Exclusión explícita de la certificación: Facturación ARCA (área 17) queda
PARCIAL/NO OPERATIVA por los tres cortes de contrato de §4 — y la UI lo dice.
Certificarla exige los seis puntos listados al final de §4.
