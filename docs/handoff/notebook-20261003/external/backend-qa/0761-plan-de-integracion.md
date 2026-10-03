# Plan de Integración — TABA2 E2E Test Staging
**Fecha**: 2026-08-05  
**Base exacta**: `b6d27daf89f04132bf348981869524c21802fe93` (RC_PANEL — integration/taba2-rc1-business-panel)  
**Destino**: `D:\1212\la-taba-e2e-test-staging-rc` / rama `release/taba2-e2e-test-staging-rc`  
**Agente**: TABA2_E2E_TEST_STAGING

---

## Principio

No integrar rangos completos a ciegas. Cada commit se clasifica. Solo se integra lo que el flujo E2E necesita. El E2E RC es un RC de prueba aislado, no un mega-merge de todo el desarrollo.

---

## Resumen Ejecutivo de la Integración

El RC_PANEL (`b6d27da`) **ya contiene**:
- Todo MP_CHECKOUT (`051413a` es ancestro) → checkout flow, preference creation, back_urls, webhook básico
- Toda la base de migraciones MP: foundation, lifecycle, rate limits
- Edge Functions: create-preference, webhook, checkout-status, payment-worker, cancel, refund
- Panel de operaciones del negocio (`20260804090000`)
- Rider server contracts básicos

**Lo que FALTA en RC_PANEL y NECESITA el E2E**:
1. Rider GPS Gate 2 (migración + posiblemente lógica Rider)
2. MP Staging Worker Scheduler (migración + configuración staging)
3. Payment Recovery P0 (migración + edge función potencialmente)
4. Storefront comercial P1 (cierre comercial, upsell fixes, routing)
5. Catálogo minorista normalizado (units vs packs)
6. Publicación minorista por unidad (shelf pública)

---

## Paso 1: Crear el E2E RC Worktree

```
Worktree: D:\1212\la-taba-e2e-test-staging-rc
Rama: release/taba2-e2e-test-staging-rc
Base: b6d27daf89f04132bf348981869524c21802fe93
```

Comando (NO ejecutar aún — Gate 1 preparación):
```powershell
git -C "C:\Users\marco\dev\la-taba-pages-preview" worktree add `
  "D:\1212\la-taba-e2e-test-staging-rc" `
  -b "release/taba2-e2e-test-staging-rc" `
  "b6d27daf89f04132bf348981869524c21802fe93"
```

---

## Paso 2: Crear el Worktree de Certificación

```
Worktree: D:\1212\la-taba-e2e-test-staging-certification
Rama: test/taba2-e2e-test-staging-certification
```

Crear DESPUÉS del E2E RC. No integrar el arnés al producto.

---

## Clasificación de Commits por Frente

### STOREFRONT_P1 → E2E RC (commits sobre la base 4ca22af)

| Commit | Descripción | Tipo | Incluir |
|---|---|---|---|
| `b66add0` | test(hygiene): remove local drive path | TEST | ✅ PRODUCT |
| `1b944e9` | fix(checkout): validate before optional upsell | STOREFRONT | ✅ PRODUCT |
| `ae48bea` | fix(promotions): disable non-purchasable editorial | STOREFRONT | ✅ PRODUCT |
| `6c8bb7b` | fix(storefront): route featured catalog CTA | STOREFRONT | ✅ PRODUCT |
| `08bb17a` | copy(hero): "Bien fria..." | STOREFRONT | ✅ PRODUCT |

**Estrategia**: cherry-pick individual o merge de feature branch desde 4ca22af hasta b66add0. Verificar que no hay conflictos con los commits de business_ops_panel y fiscal (que están en RC_PANEL pero no en STOREFRONT_P1).

### CATALOG_NORM → E2E RC (commits sobre STOREFRONT_P1)

| Commit | Descripción | Tipo | Incluir |
|---|---|---|---|
| `b8ac9a3` | test(catalog): cover unit conversion | TEST | ✅ PRODUCT |
| `ba4fd39` | fix(storefront): present unit products consistently | PRODUCT | ✅ PRODUCT |
| `c65d85e` | fix(catalog): normalize confirmed wholesale | PRODUCT | ✅ PRODUCT |
| `b36337b` | feat(catalog): model procurement packs | PRODUCT | ✅ PRODUCT |

**Nota**: CATALOG_NORM incluye b66add0 como base. El merge/cherry-pick debe hacerse en orden.

### RETAIL_UNIT_PUB → E2E RC (commits sobre CATALOG_NORM)

| Commit | Descripción | Tipo | Incluir |
|---|---|---|---|
| `1c74550` | test(storefront): adapt E2E flows to unit-only shelves | TEST | ✅ PRODUCT |
| `c7e07e5` | test(storefront): cover retail unit publication | TEST | ✅ PRODUCT |
| `70a681d` | fix(catalog): publish confirmed wholesale packs as retail units | PRODUCT | ✅ PRODUCT |
| `5d30ae0` | docs(catalog): reconcile duplicate and wholesale classifications | PRODUCT | ✅ PRODUCT |

**Nota**: RETAIL_UNIT_PUB incluye toda la cadena anterior. Es la punta de la cadena Storefront.

### MP_STAGING_RC1 → E2E RC (diverge en 7df4643)

Verificar diff de Edge Functions antes de integrar código. Las migraciones sí se integran (ver plan-de-migraciones.md).

| Commit | Descripción | Tipo | Incluir |
|---|---|---|---|
| `0587712` | feat(payments): configure durable staging reconciliation | PAYMENT_FLOW + MIGRATION | ⚠️ ANALIZAR — contiene migración MP_WORKER_SCHEDULER |
| `83dc8e2` | fix(browser): close WebKit and Firefox regressions | TEST | ✅ PRODUCT (si hay fixes de Edge Fn) |
| `c5e2a85` | merge(staging): integrate MP Checkout Pro | MERGE | ⚠️ NO cherry-pick de merge — integrar individualmente |
| `cb855e5` | fix(migrations): restore certified Rider staging history | MIGRATION | ⚠️ ANALIZAR — puede ser fix de migración 20260801040000 |
| `a1fcbfd` | merge(staging): integrate certified Rider contracts | MERGE | ⚠️ NO cherry-pick de merge — integrar individualmente |

**Estrategia**: NO hacer cherry-pick de commits de merge. Identificar los commits hoja de MP_STAGING_RC1 que no están en RC_PANEL y cherry-pickear solo esos. Requiere análisis de `git log 7df4643..0587712 --no-merges`.

### PAYMENT_RECOVERY → E2E RC (es superset de MP_STAGING_RC1)

| Commit | Descripción | Tipo | Incluir |
|---|---|---|---|
| `3e48bb0` | fix(runtime): repair payment refund SQL and Firefox E2E | PAYMENT_RECOVERY | ✅ PAYMENT_RECOVERY |
| `12d2d86` | docs(payments): add daily recovery runbook | ARTIFACT | ✅ (si contiene Edge Fn) |
| `74f8fa6` | test(payments): certify exactly-once operator recovery | TEST | ✅ PRODUCT |
| `f03b1a0` | feat(business): add safe payment reconciliation actions | PAYMENT_RECOVERY | ✅ PAYMENT_RECOVERY |
| `e54cb6a` | feat(payments): add human-readable recovery states | PAYMENT_RECOVERY | ✅ PAYMENT_RECOVERY |

---

## Qué EXCLUIR

- Arnés de certificación (`HARNESS` / `06b3301`) — NO integrar al producto
- Artifacts, capturas, golden diffs (ver commit `80dfdoc` en RIDER: "drop committed golden diff artifacts")
- Secrets, .env locales
- Configuraciones de staging generadas localmente
- Código del Rider Android (APK independiente, no parte del RC web)
- Rediseño Rider `9b498db` — explícitamente excluido
- `delivery_pin_v1.sql` de main

---

## Flujo de Integración Propuesto

```
PASO 1: Crear E2E RC desde RC_PANEL (b6d27da)
PASO 2: Integrar cadena Storefront (P1 → CATALOG → RETAIL_PUB)
  - Análisis: git log 4ca22af..1c74550 --no-merges
  - Cherry-pick en orden cronológico
  - Verificar conflictos con business_ops_panel, packing, fiscal
PASO 3: Integrar commits hoja de MP_STAGING_RC1 (no merges)
  - git log 7df4643..0587712 --no-merges
  - Clasificar cada commit
  - Solo integrar PAYMENT_FLOW, EDGE_FUNCTION, MIGRATION, TEST
PASO 4: Integrar commits adicionales de PAYMENT_RECOVERY
  - git log 0587712..3e48bb0 --no-merges
  - Solo integrar PAYMENT_RECOVERY, TEST, EDGE_FUNCTION
PASO 5: Verificar migraciones (plan-de-migraciones.md)
PASO 6: Verificar Edge Functions (diff vs RC_PANEL)
PASO 7: npm run check + npm test local
```

---

## Verificaciones Post-Integración

Antes de declarar Gate 1 listo:
- [ ] `npm run check` sin errores
- [ ] `npm test` sin errores
- [ ] 38 migraciones en orden sin timestamps duplicados dentro del mismo árbol
- [ ] Edge Functions MP: diff intencionalmente revisado
- [ ] No hay `.env` reales en git
- [ ] No hay secrets en código
- [ ] `git diff --check` limpio
- [ ] No hay commits de arnés, artefactos o configuración local incluidos
