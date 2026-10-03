# Inventario de Worktrees — TABA2 E2E Test Staging
**Fecha**: 2026-08-05T21:xx UTC  
**RUN_ID**: GATE0-20260805  
**Agente**: TABA2_E2E_TEST_STAGING

---

## Worktrees Esperados — Estado Verificado

| Label | Path | Rama | HEAD (completo) | Git | Verificación |
|---|---|---|---|---|---|
| RC_PANEL | `D:\1212\la-taba-production-rc1-business-integration` | `integration/taba2-rc1-business-panel` | `b6d27daf89f04132bf348981869524c21802fe93` | CLEAN | OK |
| HARNESS | `D:\1212\la-taba-production-rc1-business-certification` | `test/taba2-rc1-business-panel-certification` | `06b330169f6b2e1f43206b1b1cc85d767e50e01f` | CLEAN | OK |
| STOREFRONT_P1 | `D:\1212\la-taba2-commercial-p1-closure` | `feature/taba2-commercial-p1-closure` | `b66add06231ff9df5be25144a854a9c1858f01c4` | CLEAN | OK |
| CATALOG_NORM | `D:\1212\la-taba2-unit-catalog-normalization` | `feature/taba2-unit-catalog-normalization` | `b8ac9a3a5aaca5ba883c2d68dfc2efa62d7f3c6f` | CLEAN | OK |
| RETAIL_UNIT_PUB | `D:\1212\la-taba2-retail-unit-publication` | `feature/taba2-retail-unit-publication` | `1c7455029f5390b127844d4afd708705e8083566` | CLEAN | OK |
| MP_CHECKOUT | `C:\1212\la-taba2-mercadopago-checkout` | `feature/taba2-mercadopago-checkout` | `051413a24839c9c916a457bce77cf65898041f27` | CLEAN | OK |
| MP_STAGING_RC1 | `D:\1212\la-taba2-mercadopago-staging-rc1` | `release/taba2-mercadopago-staging-rc1` | `0587712be87bc32ebae6be75220eeb863780387c` | CLEAN | OK |
| PAYMENT_RECOVERY | `D:\1212\la-taba2-payment-recovery-p0` | `fix/taba2-p0-payment-recovery-ux` | `3e48bb0bcd777276d23c542c60fec94ed8b0ed84` | CLEAN | OK |
| RIDER_MAP | `D:\1212\worktrees\taba2-rider-map` | `codex/rider-map-staging` | `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` | CLEAN | OK |
| RIDER_AUTOMATION | `D:\1212\la-taba-rider-smoke-automation` | `test/taba2-rider-staging-smoke-automation` | `8e2b671c4123b8916fe628739b5c1d4490c6ae0b` | CLEAN | OK (HEAD > mínimo 8e2b671) |
| MAIN_WORKTREE | `C:\Users\marco\dev\la-taba-pages-preview` | `main` | `9cd8f8940...` | **DIRTY (35 files)** | ⚠️ ver nota |

### Nota sobre MAIN_WORKTREE
35 archivos modificados/sin versionar. Incluye feature `delivery-pin` en curso:
- `js/core/delivery-pin.js` (nuevo, sin versionar)
- `supabase/migrations/20260606090000_delivery_pin_v1.sql` (nuevo, sin versionar)
- `assets/fonts/`, `assets/products/bebidas/` (nuevos directorios)
- Múltiples tests actualizados

**Esta rama no forma parte del E2E RC.** El RC E2E parte de RC_PANEL (`b6d27da`). No bloquea Gate 0.

---

## Worktrees Adicionales Registrados en el Repo (no parte del E2E RC)

Detectados vía `git worktree list` — solo relevantes para el inventario. No se modifican.

### En C:\1212 (33 worktrees)
Incluye: la-taba-arca-homologation-readiness, la-taba-business-fiscal-closure, la-taba-production-rc1, la-taba2-catalog-finalization, la-taba2-commercial-catalog-authority, la-taba2-mobile-brand-refresh, etc.

### En D:\1212 (no esperados, excluidos del E2E)
- `D:\1212\la-taba-migration-fetch-audit` — **detached HEAD** (7df4643) — es el merge-base entre RC_PANEL y MP_STAGING_RC1
- `D:\1212\la-taba-business-fiscal-homologation-gate-fix` (d1aa4a6)
- `D:\1212\la-taba-business-packing-fixture-fix` (0a062fb)
- `D:\1212\la-taba-business-synthetic-certification` (5e0c390)
- `D:\1212\la-taba-business-synthetic-recertification` (73a37b0)
- `D:\1212\la-taba-business-synthetic-recertification-final` (e59e28d)
- `D:\1212\la-taba2-commercial-shelf-stage1` (9cc051a)

---

## APK Rider

**Target**: `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299`  
**Estado**: APK no encontrado directamente en `D:\1212\worktrees\taba2-rider-map`. Se requiere verificación manual del APK instalado en el Moto G15 antes de Gate 4.  
**Acción**: Verificar APK instalado en el dispositivo antes de Gate 4. No instalar rediseño `9b498db`.

---

## Estado de Locks

Ruta: `D:\1212\_claude-locks`

| Lock | Tipo | Estado | Acción |
|---|---|---|---|
| `rc1-business-certification-pending.txt` | Archivo | RESOLVED — ALL_GATES_PASSED | Puede quedar como registro histórico |
| `storefront-pending.txt` | Archivo | RESOLVED — ALL_GATES_PASSED | Puede quedar como registro histórico |
| `rider-staging-smoke-pending.txt` | Archivo | **STALE/BLOCKED** — HEAD observado en el momento: 7b189ae, ahora el worktree está en 8e2b671 (superado) | Necesita limpieza manual antes de Gate 4 rider |

**Nota**: Los locks son archivos `.txt`, no directorios atómicos. Documentar en riesgos.

---

## Recursos del Sistema

| Recurso | Valor | Estado |
|---|---|---|
| Disco C: | 14 GB libre / 231 GB total | ⚠️ AJUSTADO |
| Disco D: | 68.4 GB libre / 930 GB total | ✅ OK |
| Disco E: | **2.2 GB libre / 298 GB total** | ❌ CRÍTICO |
| RAM | 4.2 GB libre / 15.9 GB total | ⚠️ AJUSTADO |

**E: CRÍTICO**: E: es el disco de scratchpad de Claude. Solo 2.2 GB libres. Riesgo de fallo durante builds o tests pesados. Usar D: para artifacts E2E.

---

## Procesos Activos Relevantes

| Proceso | PID | RAM | Identificación |
|---|---|---|---|
| java | 11696 | 1433 MB | Eclipse Adoptium JDK 17 — Android Studio / Gradle |
| java | 14444 | 811 MB | Gradle Kotlin build tools (E:\DevCache) |
| node | 2500 | 22 MB | **HUÉRFANO**: `taba-panel-preview.mjs` de sesión previa (`22e69b5e`) |
| node | 23144 | 21 MB | `taba2-panel-no-store-server.mjs` en `D:\1212\...:4180` — posible huérfano |

**No hay Docker, Supabase, Playwright ni Chromium corriendo.**

---

## Operaciones Git en Curso

Ninguna. Todos los worktrees están en estado limpio (sin MERGE_HEAD, REBASE, CHERRY_PICK, BISECT).
