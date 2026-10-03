# Baseline remoto de staging — Fase 1 (read-only)

**Fecha**: 2026-08-05
**Autorización**: `I_AUTHORIZE_TABA2_E2E_TEST_STAGING_DEPLOY` (Gate 2, sólo `la-taba-staging`)
**Resultado**: ⛔ **ABORTADO ANTES DE MUTAR**

---

## Fase 1 — checklist

| # | Verificación | Resultado |
|---|---|---|
| 1 | Cuenta CLI autenticada | ✅ operativa (org `qdhfqytbvgpvhxbbcomv`) |
| 2 | Project ref exacto | ✅ `ukxqbgswjlibmnjemrzd` |
| 3 | Nombre exacto | ✅ `la-taba-staging` |
| 4 | ACTIVE_HEALTHY | ✅ `ACTIVE_HEALTHY`, PG 17.6.1.147, us-east-1 |
| 5 | Ausencia de prod/live | ✅ sólo 2 proyectos: `la-taba-staging` y `la-taba-demo`. Ningún prod/live |
| 6 | Historial remoto | ✅ legible — **27 versiones** |
| 7 | Funciones desplegadas | ✅ **0** |
| 8 | Secrets (nombres/presencia) | ✅ **0** |
| 9 | Baseline sanitizado | ✅ este documento |
| 10 | Backup / readiness | ✅ **demostrado** — `supabase db dump --linked` → 293.2 KB |

**Nota sobre lectura del historial**: `supabase migration list` no acepta `--project-ref`; exige `--db-url` o `--password`, ambos por **argv**, lo que la autorización prohíbe. Se resolvió con `supabase link --project-ref` (sin password, sólo config local ignorada por `supabase/.gitignore:3`) y `supabase db query --linked`, que opera **vía Management API** con el access token, sin credencial de base. Cero mutación remota.

---

## Estado del esquema remoto

**18 tablas en `public`**, todas de la era previa a Mercado Pago:
```
business_members, businesses, catalog_assets, customer_addresses, customers,
delivery_confirmation_attempts, delivery_outbox, order_abuse_events,
order_delivery_handoffs, order_events, order_items, order_public_tokens,
orders, products, rider_delivery_issues, rider_delivery_operations,
rider_locations, riders
```

**Objetos críticos: TODOS AUSENTES**

| Objeto | Existe |
|---|---|
| `public.payment_intents` | ❌ |
| `public.payment_outbox` | ❌ |
| `public.checkout_sessions` | ❌ |
| `public.operational_alerts` | ❌ |
| `public.daily_reconciliations` | ❌ |
| `public.fiscal_documents` | ❌ |
| `public.order_packing_sessions` | ❌ |
| `public.dispatch_payment_outbox_worker(text)` | ❌ |
| `public.finalize_paid_checkout_session(uuid)` | ❌ |

**Datos reales presentes** (a proteger): **31 pedidos**, **1 comercio**, **9 productos**.
**LT-0030**: ✅ presente, `status = arrived`, `created_at = 2026-08-03 20:55:41+00`. **Intacto.**

---

## ⛔ Causa del aborto

### Historial remoto incoherente con el esquema real

El RC tiene **38** migraciones; staging registra **27**. Faltan **11**:

```
20260802090000_mercadopago_checkout_pro_foundation
20260802093000_mercadopago_checkout_pro_lifecycle
20260802094000_mercadopago_rate_limits
20260802160000_business_windows_scanner_fiscal
20260802170000_fiscal_document_closure
20260802171000_fiscal_document_closure_hardening
20260802180000_production_operations_control_plane
20260802200000_durable_offline_packing
20260803120000_mercadopago_staging_worker_scheduler
20260803140000_payment_recovery_p0
20260805120000_fiscal_homologation_authorization_split
```

**Pero `20260804090000_business_operations_panel` SÍ figura como aplicada** — pese a que **11 migraciones anteriores faltan**, incluidas `20260802090000` (que crea toda la base de pagos) y `20260802180000` (que crea `operational_alerts` y `daily_reconciliations`).

Y el esquema confirma que sus efectos **no existen**: ninguna de esas tablas está presente.

**Se disparan dos condiciones de aborto declaradas:**
1. *"una migración posterior depende de una anterior ausente"* — `20260804090000` registrada con 11 predecesoras faltantes.
2. *"existe checksum o versión incompatible"* — la versión figura aplicada pero el esquema no contiene nada de lo que debería haber creado. El historial **no describe** la base real.

### Por qué `supabase db push` sería activamente dañino

`db push` aplica únicamente las versiones **ausentes** del historial, en orden. Por lo tanto:
- Aplicaría las 11 faltantes, **pero saltearía `20260804090000` de forma permanente**, por estar ya registrada.
- Resultado: `business_operations_panel` **nunca se aplicaría**, dejando el esquema incompleto de forma silenciosa y definitiva — justo el panel del que depende el Gate 4.
- Además, aplicar `20260802180000` *después* de que `20260804090000` figure como aplicada invierte el orden con el que fueron diseñadas y probadas.

### Riesgo NO disparado (queda descartado)

**R1 — gate2 fuera de orden: NO se dispara.** Tanto `20260801040000` como `20260802104000` **están** en el historial remoto. La condición *"existe 20260802104000 pero no existe 20260801040000"* **no se cumple**. Ese riesgo, el que más preocupaba del plan, queda cerrado.

---

## Resolución requerida (decisión humana)

`migration repair` **no se ejecuta automáticamente** — está expresamente fuera de la autorización. Hay que decidir antes:

1. **Investigar el origen del registro de `20260804090000`**: ¿se aplicó y luego se revirtió el esquema? ¿se sembró el registro a mano? ¿se restauró la base desde un backup anterior conservando la tabla de historial?
2. Según el hallazgo, la vía probable es marcar esa versión como revertida para que `db push` la reaplique en orden:
   ```
   supabase migration repair --status reverted 20260804090000
   ```
   Esto **requiere autorización explícita** y debe hacerse con el backup de la Fase 1 ya tomado.
3. Recién entonces reintentar Fase 2 con las 12 migraciones (11 + la reaplicación) en orden.

**Nada se mutó en staging.** Único cambio de estado: `supabase/.temp/project-ref` local (link), ignorado por git y reversible con `supabase unlink`.
