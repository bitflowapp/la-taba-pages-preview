# CONTROLLED_PRODUCTION · estado y evidencia

Rama de despliegue `release/taba-controlled-production`; PR **#98** (reemplaza a
#97, que queda abierto sólo por trazabilidad). Operación:
`CONTROLLED-PRODUCTION-RUNBOOK.md`. Evidencia en `docs/evidence/controlled-production/`
(archivos `*-20260925.json` para el cierre de #98, `*-20260926.json` para el del 26 y `*-20260928*.json` para el 28: la noche y la base de apertura).

## 2026-09-28 (noche) · Línea fiscal aplicada y apagada, cierre de la base

PR **#122** (`feat/taba-fiscal-line`). Es la única línea fiscal y sustituye a #104, #106, #107, #112, #113 y #114, que están cerradas; #115 (WhatsApp) sigue aparte.

| Frente | Resultado | Evidencia |
|---|---|---|
| Backup previo a la línea fiscal | PASS: 147 migraciones, 108 tablas, 9694 filas, restauración con 0 errores, esquema y RLS idénticos | `restore-drill-cp-20260928-pre-fiscal.json` |
| Migraciones fiscales `20260928180000` … `180800` | Aplicadas: el dry-run mostró exactamente las 9. CP = repo, 156/156.<br>Huella de CP = PG 17 construido del repo en las 13 categorías: **sin deriva**.<br>0 comprobantes, 0 perfiles fiscales y 0 perfiles de producción | `migrations-cp-20260928-fiscal.json` |
| Reversión de la línea fiscal | Generada comparando dos bases reales y probada en CI en el entorno de Supabase: revertir deja la huella igual a la anterior, y volver a aplicar da la de después.<br>Se niega con un solo registro fiscal. Los permisos se restauran como el entorno los crea | CI (`FISCAL_LINE_ROLLBACK_DRILL`, `…_REFUSES_WITH_FISCAL_ROWS`) |
| Código fiscal listo para homologar | Core `taba-fiscal@9fd32fd`: 55/55 pruebas. Worker canónico contra el esquema final: 15/15 escenarios (FakeArca):<br>• recuperación sin reenvíos;<br>• concurrencia 10/50/100 → 1 comprobante;<br>• aislamiento.<br>Bandeja del Panel contra la base real: 3/3. Frontera de secretos: PASS.<br>CLI de homologación: 8 comandos, sin credenciales `ARCA_DISABLED`, producción rechazada siempre | `fiscal-code-cert-20260928.json` |
| Mercado Pago para un cliente nuevo | Sin sesión, la disponibilidad es sólo de `authenticated`, por contrato. Al guardar «Tus datos» nace la sesión y el carrito vuelve a preguntar: Mercado Pago aparece sin salir. E2E que falla sin el arreglo | commit `c0ac522` |
| Deploy A′ = ``e2978e5`` | Workflow oficial después del CI exacto en verde: web + E2E, base y Windows, Rider y agente .NET.<br>Deployment `ac985354`; smoke en modo `live` con 3 motores.<br>Sin simulacro: es el primer deploy con la línea fiscal, así que el grafo de base cambia por diseño | runs 36497439976 (deploy), 36497439822 (CI), 36497439821 (Rider), 36497439929 (.NET) |
| Service worker v129 → v130 | Perfil sembrado en B (v129, con sesión):<br>• aparece «Actualizar ahora»;<br>• **una** sola recarga;<br>• el worker nuevo queda al mando en `e2978e5`;<br>• la caché v129 se borra y queda la v130;<br>• no se pierde nada guardado.<br>Recarga, chequeo y recarga forzada: PASS. Visitante nuevo: PASS | `sw-live-cp-20260928-fiscal.json` |
| Certificaciones después del deploy | • opening-cert **48/48**: revocar invitación, invitar a otro comercio y el empleado que no invita.<br>• Pedidos **21/21**, incluido el delivery pagado en efectivo.<br>• Panel en vivo **16/16** (v130).<br>• Tienda anónima **30/30**, con los instaladores privados.<br>• Pulso: HEALTHY.<br>• `opening:check`: TECHNICAL_READY YES, COMMERCIAL_READY NO.<br>• Backup final y restauración: PASS (156 migraciones, 0 errores) | `opening-cert-cp-20260928-final.json`, `opening-orders-cp-20260928-final.json`, `panel-live-cp-20260928-final.json`, `anon-store-cp-20260928-final.json`, `ops-pulse-cp-20260928-final.json`, `opening-check-cp-20260928-final.json`, `restore-drill-cp-20260928-final.json` |
| Agente de impresión (.NET) | 114/114 pruebas; MSI construido y verificado; instalación limpia en CI: servicio, salud, sólo loopback, origen ajeno rechazado (403), desinstalación limpia. Impresora física: `PENDING_HARDWARE` | run 36497439929 |

Estado:

- **P0 = 0, P1 = 0.**
- `REAL_STORE_LIVE: NO`, `PRODUCTS_PUBLIC: 0`.
- `ARCA_CODE_READY_FOR_HOMOLOGATION: YES`, `ARCA_HOMOLOGATION: PENDING_CREDENTIALS`, `ARCA_PRODUCTION: NO`.

## 2026-09-28 (tarde) · Base de apertura: todo lo técnico, la tienda cerrada

PR **#121** (`feat/taba-opening-base`). El único trabajo pendiente para abrir son datos y decisiones del comercio: [`catalog/opening/OWNER-INPUT.md`](../catalog/opening/OWNER-INPUT.md). Operación: [`docs/STORE-OPENING-RUNBOOK.md`](STORE-OPENING-RUNBOOK.md).

| Frente | Resultado | Evidencia |
|---|---|---|
| Qué falta para abrir | Hay una sola fuente: `get_store_opening_readiness`. La leen el Panel («Preparar apertura») y `npm run opening:check`.<br>`TECHNICAL_READY: YES` · `COMMERCIAL_READY: NO` · `CAN_OPEN: NO`.<br>Faltan 6 pasos y todos son del comercio: entrega, horarios, precios, stock, fotos y publicación. Después va la verificación de plataforma | `opening-check-cp-20260928.json` |
| Tres defectos reales, encontrados en vivo y corregidos | (1) La primera publicación de los 46 borradores fallaba con 23514: `merchant_available` quedaba en falso; lo corrige `20260928160000`.<br>(2) Una cuenta que había aceptado una invitación no se podía borrar por Auth (500).<br>(3) La venta de alcohol se podía encender con la edad mínima vacía, porque un CHECK con NULL pasa.<br>(2) y (3) los corrige `20260928170000`. Cada uno tiene su pgTAP, que falla con el cuerpo viejo, y su rollback ensayado en CI | commit `fdcbc69` |
| Migraciones | `20260928150000`, `160000` y `170000` aplicadas en CP.<br>Antes de cada una: backup y restauración real PASS.<br>CP = repo, 147/147.<br>La huella del esquema de CP es igual, en las 13 categorías, a la de un PG 17 construido sólo con las migraciones del repo: sin deriva | `migrations-cp-20260928-opening.json`, `restore-drill-cp-20260928-pre-opening.json`, `…-pre-merchant-intent.json`, `…-pre-null-safe.json` |
| Certificación en vivo de la base | **45/45** con el tenant QA restaurado exacto y el comercio real sin tocar. Cubre:<br>• la preparación y la verificación de plataforma (falla cerrada sobre el real);<br>• retiro y delivery, los horarios de los dos canales, la dirección y abrir/pausar/cerrar auditados;<br>• la invitación de punta a punta con una cuenta QA nueva, que al final se borra;<br>• el catálogo después de publicar;<br>• la planilla: rechaza productos QA y ensaya la real de 46 filas sin escribir;<br>• la política de alcohol;<br>• los instaladores por link firmado | `opening-cert-cp-20260928.json` |
| Pedidos de la apertura | **17/17** sin dinero real, todo revertido y clasificado QA:<br>• sólo retiro con el delivery apagado;<br>• efectivo en el mostrador y entrega sin código;<br>• delivery rechazado mientras está apagado;<br>• «a coordinar» confirmado como transferencia | `opening-orders-cp-20260928.json` |
| Instaladores del equipo | En el bucket privado `team-apps`:<br>• el APK del repartidor (`2fcc64f9…`, firma `2dcc9b0a…`);<br>• el agente de impresión 0.1.0, MSI interno **sin firma de código** (`f6ae27ac…`), sin actualización automática.<br>El dueño o el encargado crean un link de 7 días desde el Panel | `docs/TEAM-APPS-DISTRIBUTION.md` |
| Invitaciones sin SMTP | Función `team-invitation` desplegada: consultar, activar la cuenta y aceptar con la sesión propia. Certificada en vivo | `opening-cert-cp-20260928.json` |
| Deploy A = `b548e91` | Workflow oficial después del CI exacto en verde: web + E2E, base y Windows, y Rider.<br>Deployment `0753f346`; el alias sirve `b548e91` con caché v129; smoke con 3 motores.<br>Sin simulacro: A es el primer deploy con las tres migraciones nuevas, así que el grafo de base cambia por diseño | runs 36467519503 (deploy), 36467519560 (CI), 36467519545 (Rider) |
| Panel en vivo (v129, sesión real del dueño técnico) | **16/16** en escritorio y teléfono:<br>• ingreso por el formulario;<br>• «Preparar apertura» muestra exactamente las 7 compuertas pendientes que devuelve el servidor («Faltan 6 pasos para abrir»);<br>• Equipo e Impresora cargan, sin desborde ni errores JS;<br>• «Cerrar sesión» funciona | `panel-live-cp-20260928.json` |
| Deploys después de abrir | Con `catalogMode: "none"`, cualquier deploy posterior a la primera publicación habría fallado: el smoke exigía un catálogo público vacío, y el modo `approved` exigía una lista de 5 a 10 SKU con fotos del repo.<br>Ahora CP se despliega en modo `live`: el deploy no publica nada, y el smoke exige que cada producto visible tenga precio, stock y foto. Las fotos del pipeline se cargan desde Storage; la expresión regular de rutas no aceptaba `_`.<br>Probado contra CP con la foto aprobada de Campari | commit B |
| Herramientas del dueño | `opening:publish` y `alcohol:policy` usan la credencial del dueño y cerraban la sesión con alcance **global**: al terminar, lo sacaban del Panel y del teléfono. Ahora cierran sólo su propia sesión | commit B |
| Deploy B = `03eaa8d` | Workflow oficial después del CI exacto en verde: web + E2E, base y Windows, y Rider. Deployment `9042dc83`; smoke en modo `live` con 3 motores.<br>**Rollback real B→A→B con A = `b548e91`** (`0753f346`): smoke en cada paso, backend sin cambios y configuración verificada | `rollback-cp-20260928-opening.json`; runs 36474372863, 36474372787 y 36474372755 |
| Service worker | A→B comparten el worker v129. El perfil sembrado en A:<br>• pasa a correr B;<br>• conserva la sesión;<br>• resiste recarga, chequeo de actualización y recarga forzada.<br>Un visitante nuevo en B también pasa. Quedó un perfil sembrado en B para certificar la actualización con worker nuevo (v129 → v130) | `sw-live-cp-20260928-opening.json` |
| Pulso y tienda anónima | `ops-pulse`: HEALTHY. Scheduler y Realtime al día, ningún tenant QA abierto, negocio cerrado, 46 productos, 0 publicados, colas vacías.<br>Tienda anónima: **30/30** rutas limpias en 3 combinaciones de motor y tamaño. La única respuesta de error es el 401 esperado: la disponibilidad de Mercado Pago es sólo para sesiones, por contrato | `ops-pulse-cp-20260928.json`, `anon-store-cp-20260928.json` |

Estado:

- **P0 = 0, P1 = 0.**
- `REAL_STORE_LIVE: NO`.
- ARCA: producción apagada. La línea fiscal consolidada es la PR #122, todavía sin aplicar en CP.

## 2026-09-28 · Noche de cierre: QA-401, ciclo de vida y camino de apertura

| Frente | Resultado | Evidencia |
|---|---|---|
| QA-401 (P1: el checkout perdía el nombre del cliente nuevo al guardarlo en línea) | Portado de #117 en #120, merge `98866ab`. Reproducido antes del fix: 6 E2E y 2 unitarios fallando. Después: 6/6 unitarios, 8/8 E2E en Chromium y 8/8 en WebKit, compra completa en CP 2/2. Caché v128 | PR #120 |
| Deploy | Workflow oficial (run 36399354557) después del CI exacto en verde (web + E2E 36399354417, Rider 36399354472). Deployment `5f5b0b61`; el alias sirve `98866ab`; smoke de 3 motores. **Rollback real B→A→B con A = `aefa942`** y smoke en cada paso. Pulso HEALTHY; tienda anónima 35/35 rutas limpias | `rollback-cp-20260928.json` |
| Service worker v127 → v128 (origen real) | Seed sobre `aefa942` y actualización a `98866ab`: sesión conservada, recarga, chequeo de actualización y recarga forzada PASS; el worker v128 espera «Actualizar ahora». Visitante nuevo en v128: PASS | `sw-live-cp-20260928.json` |
| Capacidad (CI, negocio QA) | 30 usuarios y 3 riders: 7 de 8 checkouts simultáneos (1 perdedor de carrera, esperado), 0 errores, p95 ≈ 543 ms, integridad PASS, oferta disputada → 1 ganador, 6/6 entregas, 0 filas anónimas (run 36399354529) | `capacity-cp-ci-20260928.json` |
| Ciclo de vida, idempotencia y retiro con efectivo | 31/31 (LT-0060 entrega, LT-0061 retiro) | `order-lifecycle-cp-20260928.json` |
| Controles, RLS, stock, impresión, storage y auditoría de base | 36 controles, RLS 58/58, carrera por la última unidad y bordes de stock PASS, impresión 65/65, storage PASS, auditoría limpia | `verify-cp-controls-`, `rls-cp-`, `last-unit-race-cp-`, `stock-edges-cp-`, `verify-cp-printing-`, `storage-inventory-cp-`, `db-audit-cp-20260928.json` |
| Backup y restore | PASS: 144 migraciones, 108 tablas y 8051 filas en PG 17 aislado | `restore-drill-cp-20260928.json` |
| Registro de migraciones | La fila del pipeline de imágenes pasó de `20260927195533` a `20260927175058` (SQL idéntico, sin DDL). CP = release, 144/144 | `migrations-cp-20260928.json` |
| Rider físico | PARCIAL: GPS, pantalla apagada y recuperación de red PASS. El bloqueo con PIN del Moto frenó la UI; el PASS completo del 09-24 con la misma APK sigue vigente. APK sin secretos | `rider-physical-cp-20260928.json`, `apk-scan-rider-cp-20260928.json` |
| Apertura del comercio real | `opening-readiness.mjs`: 7 pendientes (entrega, horarios, fotos, precios, stock, publicación y verificación de plataforma). Planilla `catalog/opening/planilla-apertura-cp.csv` prellenada | `opening-readiness-cp-20260928.json` |

Estado: **P0 = 0, P1 = 0**. `REAL_STORE_LIVE: NO`: faltan datos del comercio. Detalle y cola humana en `docs/LA-TABA-MORNING-HANDOFF-2026-09-28.md`.

## 2026-09-26 · Frontend congelado (#105) e impresión activada (#103)

| Frente | Resultado | Evidencia |
|---|---|---|
| #105 (P1: el motor del mapa fuera del arranque) | merge `de7456e`; CI exacto (web + E2E, Rider) verde; deploy `42dfccca`; smoke público 3 motores; **rollback real B→A→B con A = `1cf1cb1`** y smoke en cada paso (run 36268405957); edge convergido (6/6 `de7456e` + caché v120) | `rollback-cp-20260926.json` |
| Arranque sin depender de unpkg (origen real) | A normal, B unpkg caído, C unpkg colgado 15 s (tienda lista en 1,4–2,5 s), D Seguimiento antes que el motor (el mapa se re-monta): 117/117 en Chromium, Chrome Android y WebKit, 0 errores JS | `maplibre-live-cp-20260926.json` |
| Service worker v119 → v120 (origen real) | clientes v119 sembrados antes del deploy: aviso, «Actualizar ahora», una sola recarga, caché v119 borrada, estado persistido, sin bucle; app cerrada y reabierta: 57/57. `sw-live-check` oficial: sesión del Panel conservada, recarga, update y recarga sin caché, visitante nuevo: PASS | `sw-live-cp-20260926.json` |
| E2E técnico y Panel (código v120) | pedido QA de punta a punta 2/2 (Chrome Android, WebKit iPhone); Panel: login + 9 vistas × 2 motores × 2 tamaños | `cp-e2e-ui-20260926.json` |
| Backup previo a la migración | `pg_dump` bajo snapshot → PG 17 aislado: 0 errores, esquema, filas y RLS idénticos; 139 migraciones, cabeza `20260925223000` | `restore-drill-cp-20260926.json` |
| #103 → migración | merge `09a22a6`; `db push --linked`: sólo `20260926160000` (dry-run previo); 140 = 140; chequeo de catálogo PASS (RLS en las 5 tablas, `anon` sin nada, `SECURITY DEFINER` con `search_path`, RPC del agente sólo `service_role`, `anon` sigue con exactamente 8); **deriva: ninguna** (36 funciones, columnas, constraints, índices y políticas idénticos a las mismas migraciones en PG 17) | `migrations-cp-20260926.json` |
| Gateway | `print-agent-gateway` v1 `ACTIVE`, `verify_jwt = false`, sólo secretos por defecto; las 9 funciones de Mercado Pago sin tocar (v5) | idem |
| Impresión en vivo | `verify-cp-printing.mjs` 65/65: guardas de la gateway, alta/rotación/revocación, estados, recuperación, reintentos, reimpresión auditada, 12 reclamos × 2 agentes → 20 únicos y 0 impresiones dobles, automática al entrar el pedido, RLS | `verify-cp-printing-20260926.json` |
| Agente real (0.1.0) | CLI contra CP 14/14; build .NET 10 sin advertencias, 114/114, MSI verificado; instalación local `PENDING_ADMIN`; papel `PENDING_DEVICE` | `print-agent-cp-20260926.json` |
| Nueva base de rollback | con 140 migraciones, volver a `de7456e` se rechaza por diseño. A = `09a22a6` (deploy `2af67e0c`, smoke PASS); B = `9dbd095` (deploy `a82989b1`): **rollback real B→A→B PASS** con smoke en cada paso (run 36275789477). Se sirve `9dbd095` | `rollback-cp-20260926.json` |

Estado: **P0 = 0, P1 = 0; frontend congelado** (sólo P0/P1). ARCA sigue sin
activar (`ARCA_PRODUCTION: NO`).

## Veredicto (2026-09-25, cierre local de #98 sobre CP)

| | Estado |
|---|---|
| PRODUCTION_TECH_READY | **YES** — las dos migraciones de #98 están aplicadas y certificadas en CP, CI exacto verde, carga 30, integridad, RLS, backup + restauración real, E2E técnico y rollback (ver tablero). Única compuerta física pendiente: Rider en el Moto (no conectado hoy) |
| COMMERCIAL_OPEN_READY | **NO** — `CATALOG_APPROVAL` (Walter), alta/configuración del dueño, y el gate físico del Rider (`PENDING_DEVICE`) |
| ONLINE_PAYMENTS_READY | **NO** — Mercado Pago `WAITING_SUPPORT` (ticket WCS-51579). Cobro inicial: **MANUAL**. Cierre técnico del 2026-09-25 (APP_USR directo aprobado; arquitectura OAuth bloqueada en el proveedor; CP sin Mercado Pago configurado): [MERCADOPAGO_FINALIZATION_2026-09-25](MERCADOPAGO_FINALIZATION_2026-09-25.md). Activación productiva en CP, acciones humanas y rollback: [MERCADOPAGO_PRODUCCION_CP](MERCADOPAGO_PRODUCCION_CP.md) |

Historia: el 24 se declaró YES; el 25 la verificación desde la nube lo bajó a
CODE_READY por dos P1 latentes; el 25 se aplicaron y certificaron en CP.

## Tablero del cierre (2026-09-25)

| Frente | Resultado | Evidencia |
|---|---|---|
| CI del HEAD de #98 (`921a6e2`; luego `033946b` en `release`) | web + E2E 559/559 (Chromium 438, WebKit 122), migraciones/pgTAP/restore, Windows, Rider Android, secret scan: PASS | runs 36097016562, 36102296257 |
| Preflight CP | ref `tkanbadcglszlcyfjvpv` (no Staging `ucbt…`, no Producción `wwcp…`, no DEMO `yakh…`); 134 remoto / 136 local; pendientes exactamente `085000` y `090000`; pre-estado de cada objeto tocado = el esperado | `migrations-cp-20260925.json` |
| Backup previo | export lógico 92 tablas / 1591 filas con restauración idéntica 92/92; huella de esquema; backup físico de la plataforma listado | idem |
| Migraciones | `supabase db push --linked` (2.101.0): `085000` PASS, `090000` PASS; ledger 136 = 136; delta de esquema = sólo los objetos de esas dos migraciones; `anon` sin escritura (tabla ni columna) | idem |
| Pausar/Cerrar con pedidos habilitados | pausa (staff) y cierre (owner) sin 23514; pedidos rechazados pausado/cerrado (55000); staff no puede cerrar (42501); **PAUSE ALL SYSTEM** (pausa + riders No disponible + pedido nuevo rechazado + pedido activo cancelado, stock devuelto una vez) | `verify-cp-migrations-20260925.json` |
| Privacidad de productos | columnas del storefront legibles; `unit_cost` y `verified_by` 42501 para anon, sesión de cliente y embed; `select *` 42501; producto despublicado invisible | idem |
| Ventana QA | cerrado por defecto; abrir/cerrar; runner matado con ventana de 1 min → oculto a los 62 s y cerrado por el cron; abierto desde el Panel sin ventana → no público, cerrado por el cron en 60 s; guardas (API, negocio real, > 60 min, anon, staff) | idem |
| ops-pulse | antes: `FOREIGN_TENANT_PUBLIC:1`, `OTHER_TENANT_OPEN:1`; después: **HEALTHY** (scheduler sano, Realtime SUBSCRIBED, 0 tenants ajenos públicos, 0 abiertos); servicios de la plataforma ACTIVE_HEALTHY | `ops-pulse-cp-20260925.json` |
| RLS | 58/58 con sesiones reales, incluido aislamiento A↔B | `rls-cp-20260925.json` |
| Aislamiento de entornos Rider | 8/8 real (gate del builder + gate de Gradle + builds firmados): Staging v3 y CP v4 permitidos con APK que embebe sólo su backend; Staging > v3, ref ajeno, Producción, Staging como PILOT, DEMO y sin target bloqueados | `rider-env-matrix-20260925.json` |
| Carga 30 usuarios (runner CI, post-migración) | 861 requests, 0 errores, p95 417 ms, 30/30 Realtime, 7 pedidos de 8 simultáneos (1 perdedor de carrera esperado), integridad y limpieza PASS | `capacity-cp-ci-20260925.json` |
| Concurrencia / idempotencia | doble click y retry → mismo pedido; dos pestañas → PT409; cobro manual ×2 con la misma clave + otra clave → 1 evento; cancelación doble → stock 1 vez; oferta disputada → 1 rider; confirmación de entrega ×2 → 1 transición (auditado por evento) | idem |
| Última unidad literal | stock 1, dos clientes a la vez → 1 gana, stock 0, tercero rechazado, doble cancelación → stock 1 una vez | `last-unit-race-cp-20260925.json` |
| Stock | sobre-stock 23514, despublicado 55000, carrito todo-o-nada | `stock-edges-cp-20260925.json` |
| Backup + restauración real | `pg_dump` bajo un snapshot → PostgreSQL 17.6 aislado: 0 errores, 102/102 tablas idénticas (2152 filas), esquema idéntico (99 tablas, 1335 columnas, 797 constraints, 275 índices, 356 funciones, 67 políticas, 94 triggers, grants), 136 migraciones, RLS funcional como anon | `restore-drill-cp-20260925.json` |
| Storage | bucket `fiscal-documents` con 0 objetos; 16 archivos de catálogo en git con el sha256 de la base y servidos idénticos | `storage-inventory-cp-20260925.json` |
| Deploy + smoke | `033946b` (run 36102296295) y luego `247eec7` (run 36106090499) publicados en el Pages de CP con CI exacto verde; smoke Chromium/Chrome Android/WebKit PASS. **Se sirve `247eec7`** | `rollback-cp-20260925.json` |
| Service worker / caché | el mismo perfil con caché y sesión de `4378ed2` pasó a `033946b` y a `247eec7`: sirve la versión nueva, SW en control, sesión conservada, recarga/update/recarga sin caché OK; visitante nuevo OK; 0 errores JS | `sw-live-cp-20260925.json` |
| E2E técnico (UI) | Chrome Android y WebKit iPhone, tenant QA con ventana: catálogo → carrito → pago manual → Panel → rider → GPS → código → entregado; limpieza | `cp-e2e-ui-20260925.json` |
| Rollback real | **PASS** (run 36106090499): A `033946b` vivo → B `247eec7` + smoke → rollback B→A (backend y config verificados) + smoke → restore A→B + smoke; los tres smokes en 3 motores | `rollback-cp-20260925.json` |
| Rider físico | `PENDING_DEVICE`: el Moto G15 (`ZY32LHS6PS`) no aparece por USB (`adb kill-server`/`start-server`: sin dispositivos) | — |
| Residuo QA | 0 (tenant cerrado, 8/8 publicados con stock 60, 0 pedidos abiertos o sin clasificar, 0 riders disponibles) | — |

### Hallazgos de este cierre (todos corregidos)

| Sev. | Hallazgo | Corrección |
|---|---|---|
| P2 (ops) | `qa-window.mjs close`, el comando de emergencia del runbook para cerrar un tenant QA expuesto, respondía 42501 en CP: `has_business_role` exige una sesión registrada y el CLI no la registraba | `bfcf534`: el CLI registra la sesión como el Panel; tests del comando |
| P2 (build Rider) | Un APK firmado "Staging v3" con paquete, versionCode y certificado correctos llevaba en el dex la URL de **CP**: builds Gradle concurrentes del mismo proyecto (el test del gate lanzaba builds firmados reales en la PC con la firma y su timeout los dejaba corriendo). El builder sólo miraba el manifiesto | `7d3bf84`: Kotlin no incremental, verificación del backend dentro del dex (`PILOT_APK_BACKEND_MISMATCH`) y el test del gate nunca llega a Gradle |
| Ops | El ensayo de rollback se niega a volver a una web construida con otro grafo de migraciones (`ROLLBACK_DB_GRAPH_INCOMPATIBLE`). Es la salvaguarda correcta: después de migrar, el destino válido es el primer deployment con las migraciones nuevas | Runbook §9; el ensayo B→A→B se hace con A = `033946b` |
| Higiene QA | Vender la última unidad despublica el producto y reponer stock no lo vuelve a publicar; la limpieza de riders no apagaba una disponibilidad ya vencida | `last-unit-race` re-publica como el Panel; las limpiezas apagan la disponibilidad siempre |
| Backup | El export lógico (`backup-drill`) no incluía el esquema `private` (9 tablas) | `restore-drill` (`pg_dump` de `public`, `private`, `supabase_migrations`, `auth.users/identities`) |

### Limitaciones conocidas
- Un pedido que falla **al crearse** no deja rastro en el servidor (no hay
  telemetría de errores del cliente); lo ve el cliente en pantalla. Con ~30
  clientes conocidos se cubre con contacto directo. No se agrega monitoreo nuevo.
- El dump de esquema no trae los objetos de plataforma (5 jobs de `cron`, 10
  tablas de `supabase_realtime`, bucket `fiscal-documents` y su política); en un
  proyecto nuevo se recrean con las migraciones (runbook §10).
- RPO de la plataforma ≤ 24 h (PITR apagado); por eso `restore-drill` antes de
  cada cambio.

## Entorno

| | |
|---|---|
| Backend | Supabase `tkanbadcglszlcyfjvpv` (`la-taba-controlled-production`, sa-east-1, org Luna Systems, Pro) |
| Web | `https://la-taba-commercial-pilot.pages.dev/` (Pages dedicado, `catalogMode: none`); Panel `https://la-taba-commercial-pilot.pages.dev/#business`; versión servida en `version.json` (ver Rollback) |
| Base | 140 migraciones, última `20260926160000` (impresión); PostgreSQL 17.6; backups diarios de la plataforma (PITR apagado) + `restore-drill` antes de cada cambio |
| Impresión | `print-agent-gateway` v1; agentes Windows 0.1.0 por negocio (máx. 5); runbook `LOCAL-AGENT-RUNBOOK.md` |
| Negocio real | `e7850ad2-a447-402c-8375-3fd74e9466ba` — cerrado, 0 productos, sin miembros, sin MP |
| QA (nunca públicos) | control `e1d2c342-…` (8 productos QA), aislamiento `dd515bdd-…`; marcados `qa_fixture`, cerrados fuera de ventana (cron `taba-qa-window-expiry`) |
| Rider | `com.lataba.rider.pilot` 0.1.3-canonical-pilot (vc 4), APK `2fcc64f9…`, certificado `2dcc9b0a…` |

## Hallazgos corregidos el 24

| Sev. | Hallazgo | Corrección |
|---|---|---|
| P1 | Conflictos de revisión (`40001`) reintentados por PostgREST hasta 504 a ~125 s | `20260924200000_revision_conflicts_answer_409.sql` → `PT409` (HTTP 409). En CP: 167 ms |
| P1 (latente) | El importador del catálogo mandaba `subcategory: ''` y la base lo rechaza: el `--apply` tras la aprobación de Walter habría fallado | Subcategoría desde la taxonomía de góndola del repo; verificado de punta a punta con el catálogo QA en CP |
| P1 | Ningún camino de UI para que un rider pida acceso | Formulario “Pedir acceso” con *Repartir pedidos* |
| P2 | “Conectar Mercado Pago” visible en producción controlada | “Cobros online · No habilitados en esta etapa”, sin botón |
| P2 | Rider decía “Staging” en build de producción | Etiquetas según el target (“Iniciá sesión en La Taba”) |
| Ops | Sin forma de dar de baja miembros desde el Panel | `accounts.mjs disable/enable --operator` (probado) |

## Evidencia en CONTROLLED_PRODUCTION (2026-09-24, antes de #98)

| Frente | Resultado |
|---|---|
| Migraciones | 134/134 local = remoto; base nueva: 0 tablas sin RLS, 249 `SECURITY DEFINER` todas con `search_path`, `anon` sin escritura, bucket fiscal privado |
| Auth | Host propio, anónimos para clientes, 12+ caracteres con HIBP, plantillas `token_hash`. Alta por solicitud/aprobación, baja/reactivación (login `user_banned`) y enlace de recuperación de un solo uso: PASS |
| Autorización | 57/57 con sesiones reales, incluido aislamiento A↔B |
| Carga 30 usuarios (runner CI) | 817 requests, 0 errores, p95 449 ms (crear pedido p95 679 ms), 30/30 realtime, integridad y limpieza PASS |
| Concurrencia | doble click, retry, carrera última unidad, dos pestañas (PT409 inmediato), doble cobro, doble cancelación (stock 1 vez), oferta disputada, código incorrecto, doble confirmación: PASS |
| Stock | sobre-stock 23514, no publicado 55000, carrito todo-o-nada: PASS |
| E2E UI | Chrome Android y WebKit iPhone: catálogo → carrito → pago manual → Panel (cobro, aceptar, preparar, listo, ofrecer) → rider → mapa → código → entregado: PASS |
| Rider físico v4 | Moto G15, APK firmada: login, disponible, aceptar, retirar, GPS real (mediana 5,7 m), pantalla apagada 30 s, corte WiFi 12 s (recupera en 9 s), código incorrecto/correcto, entregado; rastro GPS purgado al terminar: PASS |
| Backup/restore | backup físico diario de la plataforma (WAL-G) + export lógico restaurado en PG17 aislado: 92/92 tablas idénticas |
| Deploy | CI exacto verde → Pages dedicado → alias con el commit → smoke Chromium/Chrome Android/WebKit con 0 productos |
| Health | `ops-pulse` HEALTHY en negocio real y QA |
| Secretos | repo, historia de la rama, evidencias y APK: PASS |

## Verificación independiente desde la nube (2026-09-25)

Sin credenciales de Supabase ni de QA: sólo la clave publicable, la web
pública y el repositorio. Rama `claude/taba-controlled-production-84ldg9` (PR #98).

| Frente | Resultado |
|---|---|
| Tests locales en `73070e2` | `npm run check` PASS; `npm test` 2580 pass, 0 fail, 1 skip |
| Anon sobre 91 tablas | 84 denegadas (401/42501), 5 con 0 filas (`orders`, `order_items`, combos), `products` **con filas** → hallazgo 1 |
| Negocio real (`commerce_availability`) | cerrado, sin envíos, `ordering_ready=false` |
| Scheduler (`scheduler_heartbeat`) | `healthy`, última corrida a 13 s |
| Auth | registro anónimo para clientes, confirmación de email obligatoria, sin teléfono |
| Web pública (Chromium desktop y Pixel 7) | SW activo y controlando, cache `v117-controlled-production`, 0 productos con aviso honesto, sin Mercado Pago, login del Panel, 0 errores JS |
| Headers | `runtime-config.js` `no-store`; HTML/JS/SW `max-age=0, must-revalidate`; `X-Frame-Options: DENY` |
| Actualización de SW (`pwa-update-lifecycle`, Chromium) | 20/20 |
| Secret scan (árbol, historia de la rama, frontend) | PASS |

### Hallazgos y correcciones

| Sev. | Hallazgo | Corrección |
|---|---|---|
| P1 (latente) | Con pedidos online habilitados, **Pausar/Cerrar** desde el Panel chocaba con el CHECK `businesses_ordering_enabled_requires_verification` (23514): PAUSE ALL SYSTEM fallaba en el paso 1. Hoy no se ve porque el negocio real tiene los pedidos deshabilitados | `20260925085000`. pgTAP: pausa, cierre y reapertura con pedidos habilitados; pausado no está `ordering_ready` |
| P1 (latente) | Todo build Rider firmado comparte paquete y certificado con el Rider de CP. Staging era el target por defecto y un build firmado de Staging con versionCode ≥ 5 se instalaba como actualización y pasaba al rider a Staging | Gradle y `build-rider-pilot`: PILOT firmado sólo contra el ref de CP del manifiesto, Staging firmado en versionCode ≤ 3, target y ref obligatorios. Matriz completa en `tests/rider-pilot-target-gate.test.mjs` |
| P2 | El negocio **QA Control** quedó abierto de forma permanente en la base de CP: la RLS pública exponía sus 8 productos QA y los RPC aceptaban pedidos anónimos para él (la web no lo mostraba) | `20260925090000`: `open_qa_window` (máx. 60 min, sólo tenants QA, sólo owner/admin); fuera de la ventana el catálogo no es público aunque siga `open`; cron `taba-qa-window-expiry` cierra cada minuto; la migración cierra el tenant al aplicarse; la marca y la ventana no se editan por la API. Los harness abren y cierran la ventana en `finally`. Lo detectan el smoke (`PUBLIC_CATALOG_OF_ANOTHER_TENANT_VISIBLE`) y `ops-pulse` (`FOREIGN_TENANT_PUBLIC`, `OTHER_TENANT_OPEN`) |
| P2 | `anon` y cualquier cliente leían `unit_cost` (el costo del comercio) y `verified_by` de los productos publicados. Hoy `unit_cost` es NULL, pero el Panel permite cargarlo | `20260925090000`: SELECT por columna, todo menos esas dos. pgTAP positivo (precio, stock, imagen) y negativo (42501) |
| Falso PASS posible | `stock-edges` en CP podía contar como “rechazado por stock” un rechazo por negocio cerrado | Corre con la ventana QA abierta |
| Observabilidad | Sin chequeo sin secretos de scheduler, Realtime ni exposición | `ops-pulse --public`, probado en vivo: scheduler sano, Realtime `SUBSCRIBED` en 610 ms, y detecta hoy `FOREIGN_TENANT_PUBLIC:1` y `OTHER_TENANT_OPEN:1` |

Limitación conocida: un pedido que falla **al crearse** no deja rastro en el
servidor (no hay telemetría de errores del cliente). Lo ve el cliente en
pantalla. Con 30 clientes conocidos se cubre con contacto directo; agregar
telemetría sería una feature nueva, con una escritura anónima que abrir.

## Rollback

- **2026-09-26 (#105): PASS** (run 36268405957). A = `1cf1cb1` (vivo), B = `de7456e`: deploy B + smoke, rollback B→A + smoke, restore A→B + smoke (Chromium, Chrome Android, WebKit en cada paso). Evidencia: `rollback-cp-20260926.json`.
- **2026-09-26 (impresión): PASS** (run 36275789477, intento 2). La base tiene 140 migraciones
  desde `20260926160000`, así que `de7456e` (139) deja de ser destino válido. A = `09a22a6`
  (primer deploy con 140, sin ensayo), B = `9dbd095`: deploy B + smoke, rollback B→A + smoke,
  restore A→B + smoke (3 motores en cada paso). El intento 1 no llegó a publicar: el CI web
  cayó sólo en el job de base porque `public.ecr.aws` limitó la descarga de una imagen
  (`toomanyrequests`); se re-ejecutó ese job sin cambios. Se sirve `9dbd095`.
- **2026-09-25 (#98): PASS** (run 36106090499). A = `033946b` (primer deployment con las 136 migraciones), B = `247eec7`: deploy B + smoke, rollback B→A + smoke, restore A→B + smoke (Chromium, Chrome Android, WebKit en cada paso). Hoy se sirve `247eec7`. Evidencia: `rollback-cp-20260925.json`.
- 2026-09-25, primer intento (run 36102296295): se publicó B `033946b` con smoke
  PASS, pero el ensayo se negó a volver a `4378ed2`
  (`ROLLBACK_DB_GRAPH_INCOMPATIBLE`): esa web se construyó con 134 migraciones y
  la base ya tenía 136. Salvaguarda correcta; no se tocó nada.
- 2026-09-24 (run 36068822992): A `70dde12` → B `4378ed2` → A → B, smoke de 3
  motores en cada paso. Evidencia: `rollback-cp-20260924.json`.
- Rider: v3 archivada (apunta a Staging, sólo rollback de app) y v4 archivada
  como base para futuras versiones.

## Bloqueos restantes

1. **Catálogo (Walter)** — `CATALOG_APPROVAL`: sin respuesta; no se publica
   nada sin su aprobación explícita (precios y stock no se inventan).
2. **Alta y configuración del dueño**: cuenta, horarios, zonas, costo de envío,
   punto de retiro verificado (`set-pickup-point.mjs --origen=business_verified`).
3. **Rider físico** — `PENDING_DEVICE`: conectar el Moto G15 (`ZY32LHS6PS`) por
   USB con depuración activada; ya tiene la v4 instalada, no hace falta
   reinstalar. Repetir `physical-rider-e2e.mjs` (login, disponible, cola,
   aceptar, GPS, código, entregado, reconexión).
4. **Firma Rider — recuperación total**: la contraseña sigue sólo en Credential
   Manager; falta desbloquear el Almacén personal de OneDrive (2FA) y correr
   `node scripts/e2e-staging/escrow-rider-signing-password.mjs`.
5. **Mercado Pago** — `WAITING_SUPPORT` (WCS-51579): no se toca; cobro manual.
