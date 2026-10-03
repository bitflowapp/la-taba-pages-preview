# Resolución de la colisión de versión 20260804090000

**Fecha**: 2026-08-06
**RC**: `release/taba2-e2e-test-staging-rc` · HEAD inicial `a0189bf85ae3cae68503408473c6c5fffe86f8e5`
**Staging**: `la-taba-staging` / `ukxqbgswjlibmnjemrzd` — **no se mutó nada**

---

## 1. Versión elegida: `20260804093000`

`20260804093000_reconcile_business_operations_panel_version_collision.sql` (1093 líneas).

### Por qué no una versión posterior a todas

La instrucción pedía una versión libre **posterior a todas las actuales**. Se probó primero `20260806090000` y **quedó demostrado que no funciona**:

`20260805120000_fiscal_homologation_authorization_split` **usa** las columnas
`fiscal_profiles.homologation_authorized_at` y `_by`, que **las crea el Panel**.
Con el Panel salteado por la colisión, esa migración no falla en silencio: aborta con

```
ERROR: column "homologation_authorized_at" does not exist
```

y con ella el `db push` completo. Observado en el escenario de simulación de staging, no deducido.

Por lo tanto la reconciliación debe correr **antes** de `20260805120000`.
`20260804093000` es libre en el repositorio y en el historial remoto (cuyo máximo es `20260804090000`), va inmediatamente después de la versión ocupada y antes de la dependiente.

**Beneficio del orden**: `20260805120000` sigue haciendo por sí sola la supersesión de
`fiscal_profiles_homologation_gate` —que elimina a propósito, porque creaba una dependencia
circular entre configurar y autorizar homologación—. No hay que duplicar esa decisión.

## 2. Estructura de la migración

```
PREFLIGHT      (206 líneas)  dependencias + estado A/B/C + captura del trigger remoto
BEGIN PANEL CONTRACT
  ... 759 líneas ...          copia LITERAL de 20260804090000_business_operations_panel.sql
END PANEL CONTRACT
POSTFLIGHT     (129 líneas)  postcondiciones + RLS + preservación de la migración remota
```

El cuerpo del Panel ya era **idempotente por diseño** (`if not exists` / `or replace` /
`drop if exists`+`add`, sin ningún `do $$`), así que sirve sin cambios para los tres estados.
Un test compara byte a byte el cuerpo embebido contra el original: **no pueden divergir**.

### Los tres estados

| Estado | Condición | Comportamiento |
|---|---|---|
| **A** | 32 objetos exclusivos presentes | no-op verificado |
| **B** | 0 presentes | aplica el contrato completo |
| **C** | entre 1 y 31 | **aborta antes de mutar** con `BUSINESS_PANEL_PARTIAL_SCHEMA_DETECTED` |

La detección ocurre en el preflight, antes de la primera sentencia DDL.
Dependencia faltante → `BUSINESS_PANEL_MISSING_DEPENDENCIES` con el nombre técnico.
Postcondición incompleta → `BUSINESS_PANEL_RECONCILE_INCOMPLETE`.

## 3. Preservación de la migración sólo-remota

El preflight guarda `pg_get_triggerdef` del trigger `rider_map_capture_order_location` y la
cantidad de objetos del esquema `private`. El postflight compara ambos y aborta con
`RIDER_MAP_TRIGGER_DEFINITION_CHANGED` o `RIDER_MAP_PRIVATE_SCHEMA_CHANGED` ante cualquier
diferencia. Un test estático prohíbe además que el archivo contenga `drop`/`create`/`alter`
sobre `private.*` o sobre ese trigger.

## 4. Escenarios — 35/35 aserciones, exit 0

Runner: `scripts/run-migration-collision-scenarios.mjs`

### Escenario 1 — base nueva canónica (12/12)
Las 39 migraciones en orden real. Se mide justo antes y después de la reconciliación.
- contrato completo antes (32 objetos) → **no-op**: mismos objetos después
- sin columnas, policies ni índices duplicados · sin tabla temporal colgada · 0 filas creadas
- `20260805120000` retira el gate y deja el par autorizado, como en cualquier base canónica
- **huella canónica del esquema: `256e8229ca177a71205daa9eb805f77a`**

### Escenario 2 — simulación exacta de staging (15/15)
26 migraciones coherentes → fixture que representa `rider_map_location_contracts` ocupando
`20260804090000` → las 12 pendientes en orden (`business_operations_panel` **no** está; la
reconciliación **sí**, y antes de `20260805120000`).
- trigger rider_map y esquema `private` **intactos**
- historial sin versiones duplicadas · 39 registradas · `20260804090000` sigue siendo del rider map
- **el esquema converge exactamente al canónico**: misma huella `256e8229…`

### Escenario 3 — estado parcial (8/8)
Se crean deliberadamente 2 de los 32 objetos y se ejecuta la reconciliación.
- **aborta**, clasifica `BUSINESS_PANEL_PARTIAL_SCHEMA_DETECTED`
- el esquema queda **byte a byte igual** que antes · trigger rider_map intacto · no creó la tabla

## 5. Fixture de clúster (BRECHA-01) — sin tocar la migración

`20260803120000` instala `pg_cron` y programa el job. pg_cron sólo lo admite desde la base
indicada por `cron.database_name`, que es postmaster-level; el harness corre en una base
efímera distinta, así que la migración abortaba y **ninguna** suite llegaba a ejecutarse.

En vez de modificar esa migración —que además no está desplegada en staging— los runners
apuntan el GUC del clúster **local** a la base efímera y lo restauran al terminar. El rol
`postgres` de Supabase no es superusuario, así que `ALTER SYSTEM` no alcanza: se edita
`/etc/postgresql-custom/conf.d/pg_cron.conf` como root y se reinicia el contenedor. La
migración se aplica **exactamente como está escrita**, sin saltos ni excepciones.

También se agregó al bootstrap `create schema if not exists vault;`, que la plataforma
provee de fábrica y una base recién creada no trae.

Aplicado a `scripts/run-migration-collision-scenarios.mjs` y a `scripts/run-mercadopago-local-db.mjs`.

### Resultado del gate canónico

`npm run test:payments:local-db` ahora aplica `20260803120000` sin excepciones y llega a todas las
suites. Medido:

```
=== PLANES pgTAP ===
1..30    business_windows_scanner_fiscal
1..41    fiscal_document_closure
1..32    production_operations_control_plane
1..28    durable_offline_packing

ok    : 131
not ok: 0
```

La suite de contrato de Mercado Pago (`mercadopago_checkout_pro.local.sql`, 21 comprobaciones por
exit code) corre **antes** que las cuatro pgTAP en la misma cadena con `ON_ERROR_STOP=1`: que las
pgTAP emitan sus planes prueba que la de MP pasó.

**Retractación de la retractación**: el registro "131 aserciones, 4 suites" era correcto como
*intención*; lo que no era reproducible era el camino. Ahora lo es, y el número está medido.

### Ajuste adicional del restore drill

El drill excluye `pg_cron` (extensión y esquema) del `pg_dump`. Motivo: la extensión sólo puede
instalarse en la base de `cron.database_name` —el drill restaura en otra—, pg_cron marca
`cron.job` como tabla de configuración, y el rol `postgres` de Supabase no tiene permiso sobre
ella. El registro del scheduler es estado del clúster, no contrato de la aplicación; el drill
sigue probando que el esquema de negocio sobrevive íntegro un dump/restore.
