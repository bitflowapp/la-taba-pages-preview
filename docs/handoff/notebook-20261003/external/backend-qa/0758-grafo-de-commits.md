# Grafo de Commits y Ancestría — TABA2 E2E Test Staging
**Fecha**: 2026-08-05  
**Agente**: TABA2_E2E_TEST_STAGING

---

## Relaciones de Ancestría Verificadas

| Par | Relación | Merge-base |
|---|---|---|
| RC_PANEL vs MP_CHECKOUT | MP_CHECKOUT **es ancestro de** RC_PANEL | — |
| RC_PANEL vs MP_STAGING_RC1 | **DIVERGEN** | `7df4643` |
| RC_PANEL vs PAYMENT_RECOVERY | **DIVERGEN** | `7df4643` |
| RC_PANEL vs RETAIL_PUB | **DIVERGEN** | `4ca22af` |
| RC_PANEL vs STOREFRONT_P1 | **DIVERGEN** | `4ca22af` |
| MP_CHECKOUT vs MP_STAGING_RC1 | MP_CHECKOUT **es ancestro de** MP_STAGING_RC1 | — |
| MP_STAGING_RC1 vs PAYMENT_RECOVERY | MP_STAGING_RC1 **es ancestro de** PAYMENT_RECOVERY | — |

---

## Árbol de Derivación (simplificado)

```
(raíz del repo)
│
├─ ... ─ 4ca22af ─── [divergencia STOREFRONT/CATALOG/RETAIL]
│         │               ├── STOREFRONT_P1: b66add0 (33 migs)
│         │               ├── CATALOG_NORM: b8ac9a3 (33 migs)
│         │               └── RETAIL_PUB: 1c74550 (33 migs)
│         │
│         └── ... ─ 7df4643 ─── [divergencia MP_STAGING / PAYMENT_RECOVERY]
│                   │               ├── MP_STAGING_RC1: 0587712 (30 migs)
│                   │               │        (incluye: rider_gps_gate2, mp_worker_scheduler)
│                   │               └── PAYMENT_RECOVERY: 3e48bb0 (31 migs)
│                   │                        (incluye: rider_gps_gate2, mp_worker_scheduler, payment_recovery_p0)
│                   │
│                   └── ... ─ MP_CHECKOUT: 051413a ─── RC_PANEL: b6d27da (35 migs)
│                                                        (incluye: fiscal, business_ops_panel, packing)
│
│ [worktree main - DIRTY]
│   MAIN: 9cd8f89 (4 migs + delivery_pin uncommitted)
```

**Punto clave**: MP_CHECKOUT (`051413a`) está completamente incorporado en RC_PANEL. No hay que cherry-pickear MP_CHECKOUT al E2E RC.

---

## Commits de Cada Frente (últimos 5)

### RC_PANEL — b6d27da (base del E2E RC)
```
b6d27da test(packing): completar el fixture contra el esquema y pgTAP reales
860f4f3 test(packing): align fixture category with verified catalog schema
b7c72c7 test(packing): align capacity unit fixture with schema
01ff94b fix(fiscal): permitir que la autorización de homologación pueda registrarse
f55b093 fix(fiscal): separar configurar la homologación de autorizarla y de emitir
```

### STOREFRONT_P1 — b66add0
```
b66add0 test(hygiene): remove local drive path from closure spec comment
1b944e9 fix(checkout): validate before optional upsell
ae48bea fix(promotions): disable non-purchasable editorial destinations
6c8bb7b fix(storefront): route featured catalog CTA to populated view
08bb17a copy(hero): "Bien fria, como tiene que ser"
```

### CATALOG_NORM — b8ac9a3
```
b8ac9a3 test(catalog): cover unit conversion and ambiguous packaging
ba4fd39 fix(storefront): present unit products consistently across purchase flows
c65d85e fix(catalog): normalize confirmed wholesale products to unit listings
b36337b feat(catalog): model procurement packs separately from sale units
b66add0 test(hygiene): remove local drive path from closure spec comment
```

### RETAIL_UNIT_PUB — 1c74550
```
1c74550 test(storefront): adapt end-to-end flows to unit-only shelves
c7e07e5 test(storefront): cover retail unit publication
70a681d fix(catalog): publish confirmed wholesale packs as retail units
5d30ae0 docs(catalog): reconcile duplicate and wholesale classifications
b8ac9a3 test(catalog): cover unit conversion and ambiguous packaging
```

### MP_CHECKOUT — 051413a
```
051413a docs(payments): add Mercado Pago production runbooks
1c9b09d test(payments): certify Mercado Pago lifecycle
21950b2 fix(tracking): coalesce terminal revalidation
eac7add feat(business): add payment monitoring and refunds
794f9a8 feat(storefront): add accessible Mercado Pago checkout flow
```

### MP_STAGING_RC1 — 0587712
```
0587712 feat(payments): configure durable staging reconciliation
83dc8e2 fix(browser): close WebKit and Firefox regressions
c5e2a85 merge(staging): integrate Mercado Pago Checkout Pro
cb855e5 fix(migrations): restore certified Rider staging history
a1fcbfd merge(staging): integrate certified Rider contracts
```

### PAYMENT_RECOVERY — 3e48bb0
```
3e48bb0 fix(runtime): repair payment refund SQL and Firefox E2E portability
12d2d86 docs(payments): add daily recovery runbook
74f8fa6 test(payments): certify exactly-once operator recovery
f03b1a0 feat(business): add safe payment reconciliation actions
e54cb6a feat(payments): add human-readable recovery states
```

### RIDER_MAP — 95294d9
```
95294d9 fix(android): keep instrumentation off the real session and delivery state
80dfd0c chore(test): drop committed golden diff artifacts
ef85bf5 fix(map): make the map settle before fitting and reach the code field
ef6da08 chore(android): declare the instrumentation runner
8dc361e test(map): cover pins, privacy, fallbacks, sheet and accessibility
```

### RIDER_AUTOMATION — 8e2b671
```
8e2b671 test(rider-smoke): cover delayed rendering and stale lifecycle states
5bedc95 fix(rider-smoke): await every phase transition before state reads
627acd0 test(rider-smoke): add observable screen readiness barriers
366a0b5 fix(rider-smoke): seed queue-eligible QA orders
2347585 fix(qa): pick the QA address by completeness instead of by name heuristic
```

---

## Migraciones Únicas por Frente (vs RC_PANEL base)

### En MP_STAGING_RC1 pero NO en RC_PANEL
| Migración | Líneas | Descripción |
|---|---|---|
| `20260801040000_rider_gps_tracking_gate2.sql` | 779 | Gate 2 Rider: GPS server-authoritative, handoff atómico. **ADDITIVE** |
| `20260803120000_mercadopago_staging_worker_scheduler.sql` | 153 | MP outbox dispatch durable para Supabase hosted, pg_cron |

### En PAYMENT_RECOVERY pero NO en RC_PANEL
| Migración | Líneas | Descripción |
|---|---|---|
| `20260801040000_rider_gps_tracking_gate2.sql` | 779 | Igual al de MP_STAGING_RC1 |
| `20260803120000_mercadopago_staging_worker_scheduler.sql` | 153 | Igual al de MP_STAGING_RC1 |
| `20260803140000_payment_recovery_p0.sql` | 340 | P0 recovery: estado legible, requeue seguro, diagnóstico sanitizado |

### En RC_PANEL pero NO en MP_STAGING_RC1 ni PAYMENT_RECOVERY
| Migración | Descripción |
|---|---|
| `20260802160000_business_windows_scanner_fiscal.sql` | Scanner fiscal Windows |
| `20260802170000_fiscal_document_closure.sql` | Cierre de documentos fiscales |
| `20260802171000_fiscal_document_closure_hardening.sql` | Hardening fiscal |
| `20260802180000_production_operations_control_plane.sql` | Control plane operaciones |
| `20260802200000_durable_offline_packing.sql` | Packing offline durable |
| `20260804090000_business_operations_panel.sql` | Panel de operaciones del negocio |
| `20260805120000_fiscal_homologation_authorization_split.sql` | Separación autorización homologación |

---

## Edge Functions por Frente

| Función | RC_PANEL | MP_STAGING_RC1 | PAYMENT_RECOVERY |
|---|---|---|---|
| `fiscal-artifact-access` | ✅ | ❌ | ❌ |
| `mercadopago-cancel-payment` | ✅ | ✅ | ✅ |
| `mercadopago-checkout-status` | ✅ | ✅ | ✅ |
| `mercadopago-create-checkout-session` | ✅ | ✅ | ✅ |
| `mercadopago-create-preference` | ✅ | ✅ | ✅ |
| `mercadopago-payment-worker` | ✅ | ✅ | ✅ |
| `mercadopago-refund` | ✅ | ✅ | ✅ |
| `mercadopago-webhook` | ✅ | ✅ | ✅ |
| `_shared` | ✅ | ✅ | ✅ |

**Atención**: Las versiones de las Edge Functions MP en RC_PANEL pueden diferir de MP_STAGING_RC1/PAYMENT_RECOVERY (divergen en 7df4643). Verificar diff antes de integrar.
