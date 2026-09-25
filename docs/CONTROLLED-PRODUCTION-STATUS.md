# CONTROLLED_PRODUCTION · estado y evidencia

Rama de despliegue `release/taba-controlled-production`; PR **#98** (reemplaza a
#97, que queda abierto sólo por trazabilidad). Operación:
`CONTROLLED-PRODUCTION-RUNBOOK.md`. Evidencia en `docs/evidence/controlled-production/`
(archivos `*-20260925.json` para este cierre).

## Veredicto (2026-09-25, cierre local de #98 sobre CP)

| | Estado |
|---|---|
| PRODUCTION_TECH_READY | **YES** — las dos migraciones de #98 están aplicadas y certificadas en CP, CI exacto verde, carga 30, integridad, RLS, backup + restauración real, E2E técnico y rollback (ver tablero). Única compuerta física pendiente: Rider en el Moto (no conectado hoy) |
| COMMERCIAL_OPEN_READY | **NO** — `CATALOG_APPROVAL` (Walter), alta/configuración del dueño, y el gate físico del Rider (`PENDING_DEVICE`) |
| ONLINE_PAYMENTS_READY | **NO** — Mercado Pago `WAITING_SUPPORT` (ticket WCS-51579). Cobro inicial: **MANUAL**. Cierre técnico del 2026-09-25 (APP_USR directo aprobado; arquitectura OAuth bloqueada en el proveedor; CP sin Mercado Pago configurado): [MERCADOPAGO_FINALIZATION_2026-09-25](MERCADOPAGO_FINALIZATION_2026-09-25.md) |

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
| Base | 136 migraciones, última `20260925090000`; PostgreSQL 17.6; backups diarios de la plataforma (PITR apagado) + `restore-drill` antes de cada cambio |
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
