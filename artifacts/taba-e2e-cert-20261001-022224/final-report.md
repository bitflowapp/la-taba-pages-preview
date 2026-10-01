# Certificación backend E2E — La Taba · Staging

Corrida `TABA_E2E_CERT_20261001022224` · 2026-10-01 02:22–02:31 UTC (2026-09-30 23:22 ART).

## Matriz

```text
TABA_BACKEND_E2E_CERTIFICATION

DATE: 2026-10-01 (UTC) · 2026-09-30 noche (ART)
ENVIRONMENT: STAGING
PROJECT_REF: ucbtjcurawxjwjdvvcvj (la-taba-staging, sa-east-1)
STAGING_URL: https://taba2-staging.pages.dev · API https://ucbtjcurawxjwjdvvcvj.supabase.co
REPO: bitflowapp/la-taba-pages-preview
WORKTREE: la-taba-backend-e2e-cert (worktree dedicado; ruta local omitida)
BRANCH: qa/taba-backend-e2e-cert-20260930
HEAD_INITIAL: 135818892414f5cc17d7adacd6069eec86602381 (origin/main)
HEAD_FINAL: el commit de evidencia que contiene este archivo, sobre 7d37322
COMMITS_CREATED: 62f8566 (fix) · 7d37322 (certificador) · evidencia
PR: #130 → release/taba-controlled-production (abierto, sin mergear)

STAGING_IDENTITY_VERIFIED: YES
TEST_RUN_ID: TABA_E2E_CERT_20261001022224
ORDER_ID: 10131d32-78e3-45ab-a76a-6c3569e7ab56 (LT-0074)
CLIENT_REQUEST_ID: cert-main-20261001022224-84791dc4

ORDER_CREATED_REAL_BACKEND: PASS
DATABASE_PERSISTENCE: PASS
ORDER_ITEMS: PASS
STOCK_DECREMENT: PASS (40 → 37, 3 unidades)
BUSINESS_PANEL_BACKEND_CONTRACT: PASS (+ Panel real en navegador: PASS)
STATE_MACHINE_E2E: PASS
RIDER_BACKEND_CONTRACT: PASS
CUSTOMER_TRACKING: PASS
DELIVERY_CODE: PASS
ORDER_EVENT_CONSISTENCY: PASS

IDEMPOTENCY: PASS
CONCURRENCY: PASS
LOST_RESPONSE_RECOVERY: PASS
RLS_AUTHORIZATION: PASS
NEGATIVE_TESTS: PASS
STOCK_INTEGRITY: PASS (40 al final; huella de catálogo idéntica)
CLEANUP: PASS

UNIT_TESTS: PASS — 2782/2782 local; CI verde en 62f8566
E2E_AUTOMATED_TESTS: PASS — E2E de navegador completo en CI (run 36802335606)
CI: PASS en 62f8566 (run 36802335606) · main 1358188 verde (run 36558245386)
REAL_STAGING_E2E: PASS — 164/164 checks, 16/16 fases

SELLER_CONNECTED: Staging: sí, en modo TEST · Producción (La Taba): NO
PAYMENTS_ENABLED: Staging: TEST · Producción: NO
MONEY_MOVEMENT_POSSIBLE: NO
COMMERCIAL_CATALOG_APPROVED: NO

P0: ninguno
P1: 2 (uno corregido en esta rama, uno remediado en Staging) + 1 observación sin corregir
P2: 4

BACKEND_E2E_CERTIFIED: YES — para el commit de esta rama (main + 62f8566), camino de pedido con pago manual
PRODUCTION_READY: NO

BLOCKERS_REMAINING:
1. PR #130 sin mergear y migración 20261001010000 sin aplicar en CONTROLLED_PRODUCTION.
2. Mercado Pago real de Walter (vendedor sin conectar; WCS-51579).
3. Catálogo y precios comerciales de Walter sin aprobar ni publicar.

HUMAN_ACTIONS_REMAINING:
1. Revisar y mergear #130; aplicar la migración en CP con el procedimiento habitual (backup + restore drill + db push).
2. Decisiones y datos de Walter: catálogo/precios, cuenta de Mercado Pago, y el resto de catalog/opening/OWNER-INPUT.md.

EVIDENCE_PATH: artifacts/taba-e2e-cert-20261001-022224/

FINAL_VERDICT: el backend de pedidos funciona de punta a punta en Staging con un mismo ORDER_ID.
```

`REMAINING_EXTERNAL_GATES: WALTER_COMMERCIAL_CATALOG + WALTER_MERCADO_PAGO` **no** son los únicos
pendientes: antes está el merge de #130 con su migración en CP, y siguen abiertos los demás
datos del dueño (equipo, horarios y zonas, fiscal, impresora, teléfonos de reparto).

## Qué tipo de prueba respalda cada cosa

| Categoría | Qué se hizo | ¿Certifica? |
|---|---|---|
| `STAGING_REAL_EXECUTION` | las 16 fases de esta corrida, contra PostgREST y Auth de Staging con la sesión de cada actor | **sí** |
| `DB_OBSERVER` | lecturas SQL de sólo lectura (`supabase_read_only_user`) para contrastar lo que dijo cada contrato | sí, como contraste |
| `LOCAL_TEST` | base limpia PG17 + shim con las migraciones de `main`: reproducción del defecto y de su arreglo; suite unitaria | no (apoya el arreglo) |
| `CI_TEST` | run 36802335606 sobre `62f8566` | no (apoya el arreglo) |
| `STATIC_INSPECTION` | `schema-contracts.md`; observación sobre límites de abuso | no |
| `PRODUCTION` | **nada**. Ni lectura. El estado de CP que se cita es el último registrado en el repositorio | — |

## 1 · Identidad del entorno

Seis verificaciones, todas antes de escribir (`environment.json`):

1. Management API: el ref `ucbtjcurawxjwjdvvcvj` se llama `la-taba-staging`.
2. Las claves de la corrida las acepta ese proyecto (Auth settings y Auth admin).
3. `taba2-staging.pages.dev/runtime-config.js` apunta a ese Supabase, declara
   `deploymentEnvironment: staging` y negocio `a57b1c20-…`, y su clave publicable es una clave de ese
   proyecto. (No es la misma que la guardada en la máquina: el proyecto tiene más de una. Las dos le
   pertenecen.)
4. El observador SQL es `supabase_read_only_user`.
5. Ledger de migraciones de Staging = repositorio: 158/158, mismos nombres.
6. Negocio QA: slug `la-taba-staging`, «La Taba (STAGING)», abierto y verificado.

Refs prohibidos en duro: `tkanbadcglszlcyfjvpv` (CP), `wwcpogltfgzgkrlilbcd` (producción anterior),
demo, CAUCE y Bit Flow.

### Lo que hubo que hacer para que «Staging» fuera el backend actual

Staging **no** corría el backend actual. Estaba en la migración `20260923071557`: 133 de 157.
Faltaban, entre otras, la que convierte los conflictos de revisión en HTTP 409, la impresión, la línea
fiscal y la integración con Caja Clara. Certificar eso habría sido certificar otro backend.

- Backup lógico antes de tocar: `~/.taba-backups/staging/pgdump-2026-10-01T00-23-01-041Z`
  (además del backup físico diario de la plataforma, 2026-09-30 04:59Z).
- Validación previa en sólo lectura: 0 filas afectadas por las 24 migraciones (0 documentos fiscales,
  0 assets, todos los CHECK nuevos se cumplen), y el storefront desplegado lee columnas explícitas.
- `db push` desde un workdir aislado, en dos etapas. Resultado: ledger 157 = `main`; conteos y huella
  de productos **idénticos** al backup (`7159b330…`).
- Después del arreglo de esta rama: ledger 158.
- El storefront y el Panel desplegados (v114) siguen funcionando: comprobado en navegador.

Las Edge Functions **no** se igualaron (faltan tres y una es vieja). No participan del camino de un
pedido con pago manual; quedan como hallazgo P2.

## 2 · Aislamiento

- Producto: `STG-009` «Villavicencio», fixture sintético del tenant de staging.
- Identidades creadas y borradas por la corrida: 3 clientes anónimos, 1 usuario registrado sin
  membresía, 1 dueño de un negocio B QA inactivo.
- Operadores: cuentas QA ya existentes del tenant (owner, staff, admin, 2 riders), con sesión propia
  de la corrida.
- `service_role`: 10 usos, todos de preparación o limpieza (`created-resources.json` →
  `serviceRoleUses`). Ninguna aserción.

### Por qué un producto del catálogo de staging y no uno nuevo

No se pudo crear un producto QA aislado por el contrato normal, y se descartó forzarlo:

- `apply_commercial_catalog_batch` no crea productos y rechaza SKU con aspecto QA.
- `import_catalog_batch` exige un asset con derechos de imagen aprobados: habría que fabricarlos.
- Un fixture `test_only` hace nacer el pedido con `origin='qa'`, y la bandeja del Panel filtra
  `origin='production'`: el pedido no se vería en el Panel, que es justo lo que había que certificar.

Las cinco condiciones para usar un producto del catálogo:

| Condición | Evidencia |
|---|---|
| No afecta disponibilidad comercial | Staging no vende; `STG-009` es sintético; nunca bajó de 33/40 y siguió `available` |
| No genera notificaciones | sólo una fila `notification_outbox` que **nadie consume** (ninguna función, Edge Function ni servicio la lee); queda `processed`/`suppressed` al clasificar QA — 0 pendientes |
| El estado se restaura exacto | stock 40 → 40; huella de catálogo idéntica antes y después (`stock-before.json`, `stock-after.json`) |
| El cambio queda registrado | `inventory_movements` (1 movimiento `pilot_qa_return`), `order_events` |
| Rollback verificable | devolución por `apply_inventory_movement` con clave idempotente; re-ejecutada en una reconciliación sin duplicar |

## 3–4 · El pedido y la base

Cliente anónimo → `create_order_with_items` (delivery, efectivo, 3 × $2.400).

| | |
|---|---|
| ORDER_ID | `10131d32-78e3-45ab-a76a-6c3569e7ab56` · `LT-0074` |
| BUSINESS_ID | `a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0` |
| PRODUCT_ID | `27f606da-afb6-4369-8a85-72a171083c1f` (`STG-009`) |
| INITIAL_STOCK | 40 |
| ORDER_TOTAL | $8.400 (subtotal 7.200 + envío 1.200, zona Centro) |
| CREATED_AT | 2026-10-01T02:24:00.817927Z |

Leído por el observador: `orders` (estado `received`, origen `production`, cobro manual `pending`,
instantánea del punto de entrega), `order_items` con precio congelado, evento `order.received`,
un token de seguimiento (sólo su hash), stock 40 → 37. Sin reservas temporales: el camino manual
descuenta al crear; las reservas son del camino Mercado Pago.

## 5 · Panel

`createSupabaseOrderRepository(...).fetchBusinessOrderSnapshot()` y `fetchOrderEvents()` —el código
del Panel, no una consulta reescrita— con sesión de staff. El mismo pedido aparece en la bandeja con
ítems, cantidades, total, estado y modalidad en `received`, `accepted`, `assigned` y `on_the_way`, y
sale de la bandeja al entregarse.

Además, **en un navegador real**: ingreso por el formulario del Panel y la tarjeta `LT-0074`
(«3× Villavicencio · $ 8.400 · Efectivo al recibir»), en el build actual (v131, servido en
127.0.0.1 contra Staging) y en el Panel desplegado de Staging (v114). Capturas:
`panel-ui-current-build-local.png`, `panel-ui-deployed-staging.png` (sólo la tarjeta).

## 6 · Estados

`received → accepted → preparing → ready → assigned → picked_up → on_the_way → arrived → delivered`

| Transición | Operación | Actor | Revisión |
|---|---|---|---|
| received → accepted | `transition_order` (dos operadores a la vez) | staff gana, owner 409 | 4 → 5 |
| accepted → preparing | `transition_order` (respuesta perdida + reintento) | staff | 5 → 6 |
| preparing → ready | `transition_order` | staff | 6 → 7 |
| ready → assigned | `offer_order_to_rider` + `accept_rider_order_offer` | staff / rider | 7 → 8 |
| assigned → picked_up | `mark_delivery_picked_up` | rider | 8 → 9 |
| picked_up → on_the_way | `start_rider_delivery` | rider | 9 → 10 |
| on_the_way → arrived | `mark_rider_arrived` | rider | 10 → 11 |
| arrived → delivered | `confirm_delivery_code` | rider | 11 → 12 |
| cobro en efectivo | `confirm_manual_order_payment` | staff | 12 → 13 |

Detalle con respuesta y marca de tiempo: `state-transitions.json`.

## 7 · Rider

Con las mismas llamadas y la misma derivación de claves que la app Android: disponibilidad y latido,
la oferta aparece sólo en el tablero del rider elegido, el accept asigna, el tablero muestra el mismo
pedido con ítems, total y punto de entrega, GPS aceptado, y el pedido sale del tablero al entregarse.
El otro rider no puede aceptar la oferta, ni leer el pedido, ni retirarlo, ni iniciarlo, ni marcar
llegada, ni confirmar el código.

## 8 · Tracking

`get_public_order_tracking` con `x-order-token`: el mismo pedido en cada estado, con la misma
revisión. DTO sin nombre, teléfono, dirección ni identificadores. GPS redondeado y con precisión
publicada mínima de 100 m. Con el token de otro pedido, token incorrecto, sin token, enumerando
códigos vecinos o con el UUID de otro pedido: `null`. El cliente no puede escribir el pedido.

## 9 · Código de entrega

Lo obtiene el cliente con su sesión y su token; otro cliente o un token incorrecto: 42501. Código
incorrecto: `incorrect_code`, el pedido sigue en `arrived`. Código correcto: `delivered`.

Repetirlo **no vuelve a entregar**: con la misma clave devuelve el recibo guardado; con una clave
nueva responde `already_delivered`. Un solo evento de entrega y la revisión no cambia. No es un error
4xx: es un no-op idempotente, a propósito, para que un reintento de red no parezca un fallo.

## 10 · Idempotencia y concurrencia

| Prueba | Resultado |
|---|---|
| Repetir el pedido original | mismo `order_id`; 1 pedido, 1 ítem, mismos eventos, mismo stock |
| 20 repeticiones simultáneas del original | 20 × HTTP 200, todas el mismo pedido |
| 2 creaciones simultáneas, clave nueva | 2 × 200, 1 pedido, 1 descuento, 1 evento |
| 5 creaciones simultáneas | 5 × 200, 1 pedido, 1 descuento, 1 evento |
| 20 creaciones simultáneas | 20 × 200, 1 pedido, 1 descuento, 1 evento |
| Misma clave con otro payload | 23505 |
| Misma clave desde otro cliente | 23505 |
| Transiciones y pasos del rider repetidos | `idempotent_replay` / `idempotent_no_op`, sin evento ni revisión |

## 11 · Respuesta perdida y revisión vieja

- **A** — creación con la conexión cortada antes de recibir respuesta: el servidor creó el pedido, el
  cliente no supo nada, el reintento exacto devolvió el mismo pedido. 1 pedido, 1 descuento.
- **B** — lo mismo durante `accepted → preparing`: el reintento con la misma clave devolvió
  `idempotent_replay`, un solo evento, revisión +1.
- **C** — revisión vieja: `PT409` / HTTP 409 en 731 ms, estado intacto. Dos operadores con la misma
  revisión: uno 200, el otro 409. Aceptar contra cancelar a la vez: gana uno, el otro 409, stock
  consistente.

En las dos primeras el corte fue de red real, antes de la respuesta. El certificador tiene además
una variante determinista por si la latencia no deja esa ventana; en esta corrida no hizo falta.

## 12 · RLS

Sin sesión, autenticado sin membresía, otro cliente, dueño de otro negocio y rider equivocado: no
leen ni listan el pedido, sus ítems ni sus eventos, y no pueden transicionar, cancelar, ofrecer a un
rider, abrir el centro de operaciones, ver riders, devolver el cobro, reclasificar, escribir la tabla
ni cerrar el comercio. Un miembro sin sesión de identidad registrada no tiene rol efectivo. El dueño
de otro negocio y un anónimo no pueden registrar sesión en este. El cliente dueño ve sólo su pedido.

31 checks, cada uno con la sesión del propio actor. Ninguno con `service_role`.

## 13 · Eventos

Cadena exacta de 8 cambios de estado, sin huecos ni duplicados; secuencia y tiempo monótonos; nada
después del estado terminal; actores correctos (negocio hasta `ready`, rider desde `assigned`); un
solo `received`, una sola oferta, un solo accept, un solo cobro. La auditoría que lee el Panel
coincide con la base. Base, Panel, tablero del rider y tracking coinciden en el estado final. El
rastro GPS se purga al entregar.

## 15 · Negativos

25 checks: cantidad 0, negativa y mayor al stock; producto no disponible e inexistente; negocio
inexistente y no habilitado; campo inyectado (precio/total); delivery sin punto y bajo el mínimo; sin
sesión; estado desconocido; arista del rider tomada por el negocio; retroceso; cliente y rider usando
el RPC del operador; pedido inexistente; el negocio cerrando una entrega de rider; estado terminal
bloqueado. Ninguno creó pedidos ni movió stock.

## 14 y 16 · Stock y limpieza

- Devolución del cobro, devolución auditada de las 3 unidades y `classify_order_as_qa`, todo por
  contrato del dueño. Los 5 pedidos auxiliares, cancelados (stock devuelto solo).
- Stock 40; huella de catálogo idéntica a la inicial.
- 0 ofertas, 0 notificaciones y 0 reservas pendientes; 0 sesiones abiertas; riders en no disponible;
  usuarios de prueba y negocio B borrados; sin impresión, sin documentos fiscales, sin intentos de pago.

Lo que queda, a propósito, porque es bitácora: los 6 pedidos (terminales, `origin='qa'`, con el
identificador de la corrida en las observaciones), sus eventos y recibos de idempotencia, 1 movimiento
de inventario y las sesiones revocadas. Lista en `cleanup-result.json` → `retainedByDesign`.

## Mercado Pago y catálogo

No se probó ni se activó nada. En Staging hay un vendedor conectado en modo **TEST** (sandbox, desde
el 09-25); 32 intentos de pago, todos vencidos, ninguno de hoy. Para la tienda real, el último estado
registrado en el repositorio (`docs/CONTROLLED-PRODUCTION-STATUS.md`, 2026-09-29) es: sin vendedor,
cobros online no habilitados, comercio cerrado, 46 productos y 0 publicados. No se releyó.

## Hallazgos

| | Hallazgo | Estado |
|---|---|---|
| **P1** | Auth no puede dar de baja a un cliente con un pedido delivery (500). Trigger diferido con función `SECURITY INVOKER`; además el resguardo se salteaba si RLS escondía la fila | **Corregido** en `62f8566`, aplicado en Staging. Falta mergear y aplicar en CP |
| **P1** | Staging 24 migraciones atrás, con 3 requests zombis reintentando `40001` desde el 09-24 (881 rollbacks/s, 480 M acumulados) | **Remediado** en Staging. Sigue sin haber un control que mantenga Staging igual a `main` |
| **P1** (obs.) | Los pedidos con pago manual no pasan por `order_rate_limit_per_10_minutes` ni `max_pending_orders_per_customer`: sólo los aplica `create_checkout_session`. Una sesión anónima puede crear pedidos en efectivo sin tope, y cada uno descuenta stock | **Sin corregir**: es una decisión de producto. Por inspección de lo desplegado, no por ejecución |
| P2 | Edge Functions de Staging atrasadas respecto del repositorio | Sin tocar |
| P2 | La web de Staging sirve v114; la versión actual es v131 | Sin tocar |
| P2 | 7 pedidos abiertos del 2026-09-18 (`LT-0002`…`LT-0008`) en la bandeja de Staging | Ajenos a esta corrida; sin tocar |
| P2 | `caja-clara-e2e.mjs` cuenta eventos de entrega con `metadata.to`; la clave real es `next_status` (sólo afecta un dato informativo) | Sin tocar |

## Las otras corridas

| Corrida | Resultado |
|---|---|
| `…010056` | 159/161. Falló sólo la limpieza: no se pudo borrar al cliente de `LT-0057`. Así apareció el defecto. Reconciliada después del arreglo |
| `…014914` | Interrumpida por el cierre de la sesión con el pedido en `accepted`. Reconciliada desde su ledger |
| `…020808` | 161/164. El backend pasó; fallaron dos cosas del certificador: el corte por tiempo de la respuesta perdida no encontró ventana con la red lenta, y la tarjeta del Panel se buscaba por UUID en vez de por código |
| `…022224` | **164/164**. Ésta |

Cada una dejó Staging limpio; sus directorios están junto a éste.

## Archivos

`environment.json` · `git-state.txt` · `schema-contracts.md` · `execution-plan.md` ·
`created-resources.json` · `order.json` · `order-items.json` · `stock-before.json` ·
`stock-after.json` · `events.json` · `business-panel-query.json` · `panel-ui.json` (+ 2 capturas) ·
`rider-query.json` · `tracking-query.json` · `state-transitions.json` · `idempotency-results.json` ·
`concurrency-results.json` · `rls-negative-tests.json` · `negative-tests.json` ·
`cleanup-result.json` · `checks.json` · `summary.json`

`git-state.txt` dice `62f8566` con el certificador sin commitear: es el mismo archivo que entró,
en `7d37322`; después sólo cambió cómo escribe la línea `worktree` (el nombre, no la ruta de disco:
la higiene de release no admite rutas locales, y por eso esa línea se redactó en los cuatro directorios).
