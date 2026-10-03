# Plan de Migraciones — TABA2 E2E Test Staging
**Fecha**: 2026-08-05  
**Base**: RC_PANEL `b6d27daf89f04132bf348981869524c21802fe93` (35 migraciones)  
**Agente**: TABA2_E2E_TEST_STAGING

---

## Estado Base: RC_PANEL (35 migraciones)

El E2E RC parte de RC_PANEL. Contiene 35 migraciones hasta `20260805120000_fiscal_homologation_authorization_split.sql`.

---

## Migraciones a Integrar desde Frentes Divergentes

Las migraciones marcadas como NECESARIAS deben cherry-pickearse (o integrarse) en el E2E RC.

### Desde MP_STAGING_RC1 / PAYMENT_RECOVERY (divergen en 7df4643)

| Migración | Líneas | Tipo | Acción |
|---|---|---|---|
| `20260801040000_rider_gps_tracking_gate2.sql` | 779 | PRODUCT + MIGRATION | **INTEGRAR** — Gate 2 Rider GPS server-authoritative. Additive. No modifica orders.revision ni order_events.sequence. Necesario para flujo Rider E2E. |
| `20260803120000_mercadopago_staging_worker_scheduler.sql` | 153 | EDGE_FUNCTION + MIGRATION | **INTEGRAR** — outbox pg_cron para Supabase hosted. Necesario para webhook durable en staging. |
| `20260803140000_payment_recovery_p0.sql` | 340 | PAYMENT_RECOVERY + MIGRATION | **INTEGRAR** — P0 recovery: estado legible, requeue seguro, diagnóstico sanitizado. Necesario para Gate 5 exactly-once y recovery. |

### Desde STOREFRONT_P1, CATALOG_NORM, RETAIL_UNIT_PUB (divergen en 4ca22af)

Estos frentes tienen las **mismas 33 migraciones** que ya están en RC_PANEL (RC_PANEL tiene 35, o sea tiene 2 más). Sus commits son de código JS/HTML, no de migraciones nuevas. **No hay migraciones nuevas a integrar desde estos frentes.**

### Desde MAIN_WORKTREE

- `20260606090000_delivery_pin_v1.sql` — **EXCLUIR**. Es una migración sin versionar de una feature en progreso (`delivery-pin`). No forma parte del flujo E2E MP.

---

## Orden de Aplicación en el E2E RC

El E2E RC tendrá las siguientes migraciones adicionales a las 35 de RC_PANEL:

```
35 existentes (RC_PANEL)
+ 20260801040000_rider_gps_tracking_gate2.sql        (nueva, #36)
+ 20260803120000_mercadopago_staging_worker_scheduler.sql  (nueva, #37)
+ 20260803140000_payment_recovery_p0.sql              (nueva, #38)
= 38 migraciones total
```

**Orden cronológico** por timestamp: correcto en todos los casos (20260801 < 20260803).

---

## Análisis de Conflictos Potenciales

### Migración 36: rider_gps_tracking_gate2
- Declaradamente "additive after Gate 1"
- No modifica: `orders.revision`, `order_events.sequence`, `transition_order`, `arriving → arrived`
- Compone con contratos existentes ✅
- Riesgo de conflicto: BAJO

### Migración 37: mercadopago_staging_worker_scheduler
- Usa pg_cron + HMAC secret desde Supabase Vault
- No afecta las Edge Functions directamente (solo el scheduler)
- Requiere que la Edge Function `mercadopago-payment-worker` esté desplegada para funcionar
- Riesgo de conflicto: BAJO

### Migración 38: payment_recovery_p0
- Agrega `sanitize_payment_diagnostic()` y funciones de recovery
- Aditiva sobre las tablas de pago existentes
- Requiere que las migraciones MP (`20260802090000_mercadopago_checkout_pro_foundation.sql`) ya existan ✅ (están en RC_PANEL)
- Riesgo de conflicto: BAJO

---

## Verificaciones Antes de Ejecutar

1. Verificar que las 3 migraciones nuevas no tienen timestamps que colisionen con los 35 existentes.
2. Verificar que las funciones SQL referenciadas en las migraciones nuevas existen en el RC_PANEL.
3. Hacer dry-run de cada migración en PostgreSQL local antes de staging.
4. Verificar que `20260801040000` no contradice `20260802100000_rider_delivery_server_contracts.sql` (que SÍ está en RC_PANEL).

---

## Migraciones EXCLUIDAS

| Migración | Motivo |
|---|---|
| `20260606090000_delivery_pin_v1.sql` (main) | Feature en progreso, sin versionar, no relacionada al E2E MP |
| Todas las de STOREFRONT_P1, CATALOG_NORM, RETAIL_UNIT_PUB | Ya están en RC_PANEL (mismo árbol) |
| Migraciones fiscales adicionales (si las hay en otros frentes) | ARCA desactivada en la prueba E2E |
