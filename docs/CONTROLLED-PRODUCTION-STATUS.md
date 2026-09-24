# CONTROLLED_PRODUCTION · estado y evidencia

Rama: `release/taba-controlled-production` (desde `release/taba-commercial-pilot` @ `b7cf997`).
Operación: `CONTROLLED-PRODUCTION-RUNBOOK.md`. Plan técnico previo: `docs/PILOT-INFRA-PLAN.md`.

## Veredicto actual (2026-09-24)

| | Estado |
|---|---|
| PRODUCTION_TECH_READY | **NO** — falta crear el backend CONTROLLED_PRODUCTION (requiere `supabase login` del dueño) |
| COMMERCIAL_OPEN_READY | **NO** — falta aprobación de catálogo (Walter) y el backend |
| ONLINE_PAYMENTS_READY | NO — Mercado Pago WCS-51579 esperando soporte; pago manual |

## Hallazgos de esta etapa

| Severidad | Hallazgo | Estado |
|---|---|---|
| P1 | Conflictos de revisión (`SQLSTATE 40001`) quedaban reintentándose en PostgREST hasta un 504 a los ~125 s: dos operadores sobre el mismo pedido, o cualquier acción con revisión vieja, colgaban el panel 2 minutos y retenían una conexión. Reproducido aislado en Staging (125 821 ms) | **Corregido** en `20260924200000_revision_conflicts_answer_409.sql` (responde `PT409`/HTTP 409 al instante) + cliente. CI: 134 migraciones + pgTAP PASS. No aplicado a Staging (sin token) |
| P1 | No existía forma de que un rider pidiera acceso: la web sólo pedía acceso `panel`, la app Rider sólo tiene login y el backend no convierte una solicitud de panel en rider | **Corregido**: el formulario “Pedir acceso” ofrece *Repartir pedidos* (el comercio sigue decidiendo al aprobar) |
| P2 | El Panel ofrecía “Conectar Mercado Pago” en producción controlada, donde MP no está habilitado | **Corregido**: “Cobros online · No habilitados en esta etapa” sin botón |
| P2 | La app Rider decía “Iniciá sesión en Staging” / “Sincronizado con Staging” también en la build de producción controlada | **Corregido**: etiquetas según el target |

## Evidencia reproducible

| Frente | Resultado | Evidencia |
|---|---|---|
| Catálogo fail-closed | PASS: el template sin aprobación falla (`EXPLICIT_OWNER_APPROVAL_REQUIRED`); 49 tests de gates | `scripts/import-pilot-catalog.mjs`, `tests/pilot-*.test.mjs` |
| Deploy técnico sin catálogo | Implementado: `catalogMode: none` exige 0 productos públicos; importar sigue exigiendo 5–10 SKU aprobados | `scripts/deploy/pilot-preflight.mjs`, test `tech-ready mode` |
| Capacidad 30 usuarios (Staging, runner CI) | 30/30 realtime, 1 222 requests, error 0,16 % (los 2 errores = bug 40001), p95 587 ms, 7 pedidos de 8 checkouts simultáneos (1 perdedor de carrera esperado), 6/6 entregas por 3 riders, integridad y limpieza PASS | `docs/evidence/controlled-production/capacity-staging-ci-20260924.json` |
| Concurrencia / idempotencia | Doble click → 1 pedido; retry tras pérdida → mismo pedido; carrera última unidad → 1 ganador (23514); dos pestañas → 1 transición; doble cobro manual → 1 evento; doble cancelación → stock devuelto 1 vez; oferta disputada → 1 rider; código incorrecto rechazado; doble confirmación de entrega → 1 entrega | ídem |
| Stock | Más que el stock → 23514; producto no publicado → 55000; carrito mixto todo-o-nada; sin pedido ni cambio de stock | `docs/evidence/controlled-production/stock-edges-staging-20260924.json` |
| Autorización (Staging) | 54/54: anon sin filas privadas ni RPC; cliente no cambia precio/total/estado ni ve pedidos ajenos; staff no se promueve; rider B no acepta/actúa/lee la entrega de A; tracking exige token | `docs/evidence/controlled-production/rls-staging-20260924.json` |
| Alta de rider por dominio | PASS en Staging: cuenta → solicitud → aprobación del dueño → sesión Android | `scripts/controlled-production/accounts.mjs` |
| Backup/restore | Drill implementado (export lógico + restauración en PG17 aislado, conteos y hashes); autotest PASS. Falta correrlo contra el backend nuevo | `scripts/controlled-production/backup-drill.mjs` |
| Service worker | `network-first` para HTML/JS/CSS, `cache-first` sólo para imágenes con hash, limpieza de caches viejas, aviso de actualización sin recargar otras pestañas; `CACHE_NAME` obligatorio por gate | `sw.js`, `js/pwa-update.js`, `scripts/check-release-identity.mjs` |
| CI | Rider Android PASS; migraciones + pgTAP + restore aislado PASS; suite unitaria local 2575/2575 | GitHub Actions de la rama |

## Bloqueos

1. **Backend CONTROLLED_PRODUCTION**: el CLI de Supabase está deslogueado en esta PC
   (logout 2026-09-24 03:19 ART) y no hay token en GitHub. Crear el proyecto
   agrega ~USD 10/mes al plan Pro de la organización.
2. **Catálogo**: sin respuesta verificable de Walter (el último chequeo con
   resultado fue 12:53 ART; los siguientes fallaron por el navegador).
3. **Moto G15**: no conectado por USB (hay un iPhone conectado); Rider v4 y GPS
   físico pendientes de ese equipo.
4. **Firma Rider**: backup del keystore en OneDrive (restaurado y verificado);
   la contraseña sigue sólo en Credential Manager. El script de custodia al
   Almacén personal de OneDrive está listo y requiere desbloquearlo (2FA).
5. **Red de esta PC**: tethering USB con ~75 % de pérdida; las mediciones de
   carga se hacen desde el runner de CI.

## Siguiente secuencia (automatizada, sin intervención)

`create-backend.mjs --apply` → `supabase db push` de las 134 migraciones →
postura de Auth → negocio real (cerrado, 0 productos) + negocios QA de control →
cuentas QA por dominio → Rider v4 firmado → `deploy/controlled-production.json`
→ deploy armado + smoke → carga 30 usuarios, RLS A↔B, stock y backup/restore
sobre el backend nuevo → segundo deploy + rollback drill.
