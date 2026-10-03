# Auditoría forense de las 38 migraciones — staging `la-taba-staging`

**Fecha**: 2026-08-06
**Proyecto**: `la-taba-staging` / `ukxqbgswjlibmnjemrzd`
**Autorización recibida**: `I_AUTHORIZE_STAGING_MIGRATION_HISTORY_REPAIR_20260804090000_ONLY`
**Resultado**: ⛔ **REPAIR NO EJECUTADO — la premisa de la autorización es falsa**

---

## 1. Backup restaurable (precondición cumplida)

`D:\1212\artifacts\taba2-e2e-test-staging\backup-20260805\`

| Archivo | Tamaño | SHA256 |
|---|---|---|
| `schema.sql` | 293.2 KB | `B982E078B45AD3E4DF9635D240A901C09718AEE3A83F1216157601D4C1C87A1F` |
| `data.sql` | 352.3 KB | `6CD5F6D9A2BB8DF47856BBF34DA6600823E2FD42E33F3125288F7B01F699A25B` |
| `roles.sql` | 0.4 KB | `168A95A9C745AF5ED4679751F90419AC9DC434240A213B03E32A06D5664C2308` |

Verificado por rehash (3/3 OK). Sanidad: 20 `CREATE TABLE`, 22 `INSERT INTO`, 3 líneas de rol. **LT-0030 presente en el backup** (5 coincidencias). Escaneado: 0 tokens, 0 JWT, 0 claves privadas. Sumas en `SHA256SUMS.txt`.

## 2. Baseline de datos

| Métrica | Valor |
|---|---|
| `orders` | **31** |
| `businesses` | **1** |
| `products` | **9** |
| LT-0030 | presente · `status = arrived` · `created_at = 2026-08-03 20:55:41+00` |

## 3. Método

Clasificación de las 38 migraciones cruzando tres fuentes:
1. **Historial remoto** (`supabase_migrations.schema_migrations`, 27 filas) leído vía Management API — sin password de base, sin argv.
2. **Inventario remoto de objetos**: tablas, funciones, triggers, columnas, índices, políticas y constraints.
3. **Parseo de cada archivo de migración**, con modelo **última-acción-gana**: si una migración aplicada posterior borra un objeto, su ausencia es *esperada*, no una anomalía.

Correcciones aplicadas al clasificador tras detectar falsos positivos propios:
- **Modelado de `DROP`**: 4 migraciones aparecían `PARTIALLY_APPLIED` porque sus políticas son borradas y reemplazadas por migraciones posteriores. Resuelto.
- **Colisión de nombres**: `20260802160000` aparecía `PARTIALLY_APPLIED` por un único objeto "presente", `func:transition_order`, que en realidad crea `20260801020000` (aplicada). Reclasificada a `NOT_APPLIED_PENDING`.
- **Resolución semántica de `INCONCLUSIVE`**: 8 migraciones no crean objetos nuevos verificables (sólo `CREATE OR REPLACE`, `REVOKE`, `ALTER`). Se verificaron por sus efectos persistentes reales — `COMMENT ON` sobre funciones y constraints, cuerpos de función y constraints concretas. **13 comprobaciones, 13 verdaderas.**

## 4. Resultado final — 38/38 clasificadas

| Clasificación | Cantidad |
|---|---|
| `APPLIED_AND_PRESENT` | **26** |
| `NOT_APPLIED_PENDING` | **11** |
| `VERSION_COLLISION` (ver §5) | **1** |
| `PARTIALLY_APPLIED` | **0** |
| `INCONCLUSIVE` | **0** |
| `PRESENT_BUT_UNRECORDED` | **0** |

26 + 1 = 27 registros remotos ✓ · 38 − 27 = 11 pendientes ✓

### Migraciones pendientes (11), en orden
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

### Riesgo R1 — descartado definitivamente
`20260801040000_rider_gps_tracking_gate2` está **aplicada y presente** (12 objetos verificados), igual que `20260802104000`. La condición de aborto *"existe 20260802104000 pero no existe 20260801040000"* no se cumple.

---

## 5. ⛔ El hallazgo que invalida la autorización

La autorización se concedió sobre la premisa de que `20260804090000` era `APPLIED_BUT_ABSENT`: un registro fantasma de una migración que nunca corrió. **Es falso.**

La fila remota dice:

```
version = 20260804090000
name    = rider_map_location_contracts
```

El archivo local con esa misma versión es:

```
20260804090000_business_operations_panel.sql
```

**Son dos migraciones distintas que colisionan en el mismo número de versión.**

### Evidencia

1. **Los otros 26 nombres coinciden exactamente** con sus archivos locales. La discrepancia es una sola y está aislada.
2. **`rider_map_location_contracts` no existe en ninguna rama de este repositorio.** `git log --all --diff-filter=A -- 'supabase/migrations/20260804*'` sólo devuelve `20260804090000_business_operations_panel.sql` (dos commits: el original y su cherry-pick).
3. **Dejó rastro material en staging**: el trigger `rider_map_capture_order_location` existe en la base y **no tiene origen en ninguna migración local** — `git grep` no lo encuentra en ningún archivo versionado. Es el único objeto huérfano real de la base.
4. Los 32 objetos exclusivos de `business_operations_panel` están **todos ausentes** (0 presentes), confirmando que ese archivo nunca corrió.

### Por qué ejecutar el repair sería corromper el historial

`supabase migration repair 20260804090000 --status reverted` haría:

- **Borrar el único registro** de que `rider_map_location_contracts` se aplicó a esta base.
- Dejar sus objetos —el trigger `rider_map_capture_order_location`— **huérfanos y sin gestión**, sin ninguna migración que los declare.
- Habilitar que `db push` aplique `business_operations_panel` **bajo un número de versión que en esta base significa otra cosa**.
- Volver las dos migraciones **permanentemente indistinguibles** en el historial: nadie podría después determinar cuál corrió.

Eso no es una reparación: es una pérdida irreversible de trazabilidad. Y contradice el espíritu explícito de la autorización, que exigía que `20260804090000` fuera la única `APPLIED_BUT_ABSENT` — condición que sólo se cumple en la forma, no en el fondo.

---

## 6. Estado de las condiciones de la autorización

| Condición | Veredicto |
|---|---|
| `20260804090000` única `APPLIED_BUT_ABSENT` | ⚠️ **formalmente sí, materialmente no** — no es un registro fantasma sino otra migración |
| Sin otras `PARTIALLY_APPLIED` / `APPLIED_BUT_ABSENT` / `INCONCLUSIVE` | ✅ cumplida (0 / 0 / 0) |
| Ningún objeto exclusivo de `20260804090000` existe | ✅ cumplida (32 exclusivos, 0 presentes) |
| Backup generado, hasheado y verificado | ✅ cumplida |
| Row counts y LT-0030 registrados | ✅ cumplida |

**Cuatro de cinco cumplidas. La primera falla en su sustancia, y es la que da sentido a las demás.**

---

## 7. Qué hace falta decidir

Antes de cualquier reparación hay que responder una pregunta de hecho que no puedo responder desde este repositorio:

**¿De dónde salió `20260804090000_rider_map_location_contracts`?** Otro repositorio, una rama borrada, o SQL aplicado a mano.

Según la respuesta, las vías razonables son:

- **(A) Recuperar el archivo** y sumarlo al repo con su versión real, y **renumerar** `business_operations_panel` a una versión libre posterior. Es la única vía que preserva la trazabilidad de ambas.
- **(B) Si `rider_map_location_contracts` es descartable**: revertir explícitamente sus objetos (el trigger huérfano) con una migración nueva y *después* decidir el repair — con constancia escrita de qué se descartó.
- **(C) Recrear staging desde cero** a partir de las 38 migraciones del RC, restaurando los datos desde el backup ya tomado. Es la opción más limpia si los 31 pedidos son de prueba y no hay dependencia de LT-0030 en su forma actual.

**Nada se mutó.** Ni historial, ni esquema, ni datos, ni funciones, ni secretos.
