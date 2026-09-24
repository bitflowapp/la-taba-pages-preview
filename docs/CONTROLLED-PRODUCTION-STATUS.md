# CONTROLLED_PRODUCTION · estado y evidencia

Rama `release/taba-controlled-production` (desde `release/taba-commercial-pilot` @ `b7cf997`).
Operación: `CONTROLLED-PRODUCTION-RUNBOOK.md`. Evidencia en `docs/evidence/controlled-production/`.

## Veredicto (2026-09-24)

| | Estado |
|---|---|
| PRODUCTION_TECH_READY | **YES** si el ensayo de rollback del deploy B pasa (ver §Rollback) |
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

## Rollback

Deploy A `70dde12` publicado y verificado. Deploy B `4378ed2` con ensayo armado:
rollback B→A, smoke, restaurar A→B, smoke. Resultado: ver el último run de
*Deploy CONTROLLED_PRODUCTION* en la rama. APK anterior para rollback del teléfono:
v3 archivada (apunta a Staging; sólo sirve como rollback de la app, no del backend).

## Bloqueos restantes

1. **Catálogo (Walter)**: sin respuesta; no se publica nada sin su aprobación explícita.
2. **Alta y configuración del dueño**: cuenta, horarios, zonas, costo de envío,
   punto de retiro verificado (`set-pickup-point.mjs --origen=business_verified`).
3. **Firma Rider — recuperación total**: la contraseña sigue sólo en Credential
   Manager; falta desbloquear el Almacén personal de OneDrive (2FA) y correr
   `node scripts/e2e-staging/escrow-rider-signing-password.mjs`.
