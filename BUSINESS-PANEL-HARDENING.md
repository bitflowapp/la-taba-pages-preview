# BUSINESS-PANEL-HARDENING — auditoría y endurecimiento del Panel del negocio

Fecha: 2026-08-07 · Worktree: `D:\1212\la-taba2-business-panel-hardening` ·
Rama: `feature/taba2-business-panel-hardening` · Base: `11a0b02`

| | |
| --- | --- |
| Commits | `5220ce9` (cliente + migración), `07ceef4` (alfabeto de claves), `54ba648` (POS fiscal + E2E). Todos locales, sin push. |
| Staging mutado | `la-taba-staging` (`ukxqbgswjlibmnjemrzd`): migración `20260807090000` aplicada por `supabase db push`; Edge Function `mercadopago-refund` re-desplegada. Nada más. |
| Lock | `D:\1212\_claude-locks\taba2-business-panel-hardening.txt`. El lock ajeno `taba2-staging-mutation.lock` (HOLDING, espera compra iPhone) se respetó: no se tocó su deploy de Pages ni sus pedidos, y la migración **arregla** su Panel desplegado (ver H1). |
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
| `npm test` | **1100/1100** (base 1086; +14 de este trabajo) |
| `npm run test:e2e` | **207/207** (Chromium + Firefox; base 206, +1 del POS deshabilitado) |
| `npm run check` | pasa |
| `npm run migrations:validate` | aprobado (incluye la migración nueva) |
| `npm run secrets:scan` | limpio |
| `supabase db push` | `20260807090000` aplicada a `la-taba-staging` |
| `supabase functions deploy mercadopago-refund` | desplegada |
| `git diff --check` | limpio |

Pruebas nuevas: claves válidas ante el regex del servidor (transition/cancel/
claim/confirm/GPS), contrato canónico del rider en el mock (replay idempotente,
`stale_revision`, `not_active`), combos y descuento en bandeja, presenter
fiscal exhaustivo (ningún estado real cae al default), outbox (serialización,
force-recover, `nextDueAt`, drain al reconectar, reintento agendado, chip sin
mentiras), migración sin pérdida de guardas, y E2E del POS con facturación
habilitada y deshabilitada.

## 6. Certificación viva — DIFERIDA (único pendiente bloqueante)

La re-certificación del pipeline contra staging (pedido → Panel → aceptar →
preparar → rider → entregar, con concurrencia y duplicados sobre la base real)
**no se pudo correr en esta sesión**: el clasificador de permisos bloqueó la
extracción de las claves del proyecto (`supabase projects api-keys`) y no
corresponde rodearlo. Reload/offline/duplicados quedaron cubiertos por unit +
E2E; la concurrencia por los contratos del servidor (receipts, CAS, FOR
UPDATE) ya certificados 47/47 sobre esta misma base **antes** de la migración
— pero la corrida post-migración es la prueba que falta.

Para cerrarla (dos comandos, ~5 minutos):

```powershell
cd D:\1212\la-taba2-business-panel-hardening
$env:SUPABASE_URL = 'https://ukxqbgswjlibmnjemrzd.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<service_role de la-taba-staging>'
$env:SUPABASE_ANON_KEY = '<anon/publishable de la-taba-staging>'
$env:TABA_BUSINESS_ID = '00000000-0000-4000-8000-000000000001'
$env:TABA_CERTIFY_CONFIRM = 'I_UNDERSTAND_THIS_MUTATES_STAGING'
npm run certify:orders:staging          # 47 comprobaciones del pipeline
npm run certify:circuit:staging -- LT-0079   # 17 del circuito operativo
```

(O permitir `supabase projects api-keys --project-ref ukxqbgswjlibmnjemrzd`
y lo corro yo.)

## 7. Declaración

**TABA2_BUSINESS_PANEL_CONTRACT_CERTIFIED_FOR_PILOT — DIFERIDA.**

El contrato del Panel quedó auditado área por área, endurecido en cliente y
backend, con la facturación presentada honestamente como no operativa y sin
ningún botón, métrica o estado que prometa lo que el backend no garantiza.
Falta UNA cosa para estampar la declaración: la corrida viva post-migración de
§6. Declarar sin esa corrida sería exactamente el tipo de promesa sin
evidencia que este trabajo vino a eliminar.
