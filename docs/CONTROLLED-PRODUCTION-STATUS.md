# CONTROLLED_PRODUCTION · estado y evidencia

Rama `release/taba-controlled-production` (desde `release/taba-commercial-pilot` @ `b7cf997`).
Operación: `CONTROLLED-PRODUCTION-RUNBOOK.md`. Evidencia en `docs/evidence/controlled-production/`.

## Veredicto (2026-09-24)

| | Estado |
|---|---|
| PRODUCTION_TECH_READY | **YES** |
| COMMERCIAL_OPEN_READY | **NO** — sin aprobación de catálogo (Walter no respondió; verificado en Gmail, incluido spam) y sin alta/configuración del dueño |
| ONLINE_PAYMENTS_READY | NO — Mercado Pago WCS-51579 esperando soporte; cobro manual |

## Entorno

| | |
|---|---|
| Backend | Supabase `tkanbadcglszlcyfjvpv` (`la-taba-controlled-production`, sa-east-1, org Luna Systems, Pro) |
| Web | `https://la-taba-commercial-pilot.pages.dev/` (Pages dedicado, `catalogMode: none`) |
| Negocio real | `e7850ad2-a447-402c-8375-3fd74e9466ba` — cerrado, 0 productos, sin miembros, sin MP |
| QA (nunca públicos) | control `e1d2c342-…` (8 productos QA), aislamiento `dd515bdd-…` |
| Rider | `com.lataba.rider.pilot` 0.1.3-canonical-pilot (vc 4), APK `2fcc64f9…`, certificado `2dcc9b0a…` |

## Hallazgos corregidos en esta etapa

| Sev. | Hallazgo | Corrección |
|---|---|---|
| P1 | Conflictos de revisión (`40001`) reintentados por PostgREST hasta 504 a ~125 s | `20260924200000_revision_conflicts_answer_409.sql` → `PT409` (HTTP 409). En CP: 167 ms |
| P1 (latente) | El importador del catálogo mandaba `subcategory: ''` y la base lo rechaza: el `--apply` tras la aprobación de Walter habría fallado | Subcategoría desde la taxonomía de góndola del repo; verificado de punta a punta con el catálogo QA en CP |
| P1 | Ningún camino de UI para que un rider pida acceso | Formulario “Pedir acceso” con *Repartir pedidos* |
| P2 | “Conectar Mercado Pago” visible en producción controlada | “Cobros online · No habilitados en esta etapa”, sin botón |
| P2 | Rider decía “Staging” en build de producción | Etiquetas según el target (“Iniciá sesión en La Taba”) |
| Ops | Sin forma de dar de baja miembros desde el Panel | `accounts.mjs disable/enable --operator` (probado) |

## Evidencia en CONTROLLED_PRODUCTION

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
| P2 | El negocio **QA Control** quedó abierto de forma permanente en la base de CP: la RLS pública exponía sus 8 productos QA a cualquiera con la clave publicable y los RPC aceptaban pedidos anónimos para él. La web no lo mostraba | `qa-window.mjs`: los harness abren el negocio QA sólo durante la corrida y lo cierran en `finally`. El smoke público (`PUBLIC_CATALOG_OF_ANOTHER_TENANT_VISIBLE`) y `ops-pulse` (`FOREIGN_TENANT_PUBLIC`) lo detectan. Verificado: el smoke nuevo falla hoy contra CP, como corresponde |
| P1 (latente) | Todo build Rider firmado comparte paquete y certificado con el Rider de CP. Staging era el target por defecto y un build firmado de Staging con versionCode ≥ 5 se instalaba como actualización y pasaba al rider a Staging | Gradle y `build-rider-pilot`: PILOT firmado sólo contra el ref de CP del manifiesto; un Staging firmado queda en versionCode ≤ 3 (Android rechaza el downgrade) |
| Falso PASS posible | `stock-edges` en CP podía contar como “rechazado por stock” un rechazo por negocio cerrado | Corre con la ventana QA abierta |

**Acción del operador (una vez, PC con credenciales QA):**
`node scripts/controlled-production/qa-window.mjs close --target controlled-production`
y después `... status` tiene que dar `PASS`. Hasta entonces el próximo deploy
de CP falla en el smoke, a propósito.

## Rollback

PASS (run 36068822992): con A `70dde12` vivo se publicó B `4378ed2`; smoke
Chromium/Chrome Android/WebKit; rollback B→A (backend y hash de migraciones sin
cambios, config verificada); smoke; restore A→B; smoke. Hoy se sirve `4378ed2`.
Evidencia: `docs/evidence/controlled-production/rollback-cp-20260924.json`.
Rider: v3 archivada (apunta a Staging, sólo rollback de app) y v4 archivada
como base para futuras versiones.

## Bloqueos restantes

1. **Catálogo (Walter)**: sin respuesta; no se publica nada sin su aprobación explícita.
2. **Alta y configuración del dueño**: cuenta, horarios, zonas, costo de envío,
   punto de retiro verificado (`set-pickup-point.mjs --origen=business_verified`).
3. **Firma Rider — recuperación total**: la contraseña sigue sólo en Credential
   Manager; falta desbloquear el Almacén personal de OneDrive (2FA) y correr
   `node scripts/e2e-staging/escrow-rider-signing-password.mjs`.
