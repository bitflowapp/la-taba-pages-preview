# Inventario de contrato — `20260804090000_business_operations_panel.sql`

Archivo fuente (SOLO LECTURA):
`D:\1212\la-taba-e2e-test-staging-rc\supabase\migrations\20260804090000_business_operations_panel.sql`
758 líneas totales. Leído completo, de punta a punta, en una sola pasada verificada línea por línea, más `grep` de verificación cruzada sobre patrones críticos (schema `private`, `rider_map`, `operational_alerts`, `daily_reconciliations`, `business_members`, `do $$`, `create/drop trigger`, `insert/update/delete`, `grant/revoke/comment/policy/index/table`).

## Tabla resumen (conteos por tipo de objeto)

| Tipo de objeto | Cantidad | Detalle |
|---|---|---|
| Tablas creadas (`create table if not exists`) | 1 | `public.scanned_product_audit` |
| Columnas agregadas (`alter table ... add column if not exists`) | 14 | 13 en `fiscal_profiles` + 1 en `products` |
| Funciones creadas/reemplazadas (`create or replace function`) | 9 | todas en esquema `public` |
| Índices (`create index`) | 1 explícito + 1 implícito | explícito: `scanned_product_audit_business_idx`; implícito: índice único de la PK de `scanned_product_audit.id` |
| Constraints explícitas vía `alter table add constraint` (patrón drop-if-exists + add) | 6 | 5 en `fiscal_profiles` + 1 en `products` |
| Constraints inline (nuevas, en `create table` / `add column`) | 13 | 1 PK, 4 FK (3 en la tabla nueva + 1 en `fiscal_profiles.homologation_authorized_by`), 1 CHECK inline, 7 NOT NULL |
| Triggers | 0 | ninguno en todo el archivo |
| Policies RLS creadas | 1 | `"business reads scanned product audit"` en `scanned_product_audit` |
| Tablas con `enable row level security` | 1 | `public.scanned_product_audit` |
| Sentencias GRANT | 11 | 1 sobre tabla + 10 sobre funciones |
| Sentencias REVOKE | 11 | 1 sobre tabla + 10 sobre funciones |
| Comentarios (`comment on`) | 6 | 2 sobre columnas + 4 sobre funciones |
| Sentencias DML a nivel de migración (fuera de cuerpos de función) | **0** | todo INSERT/UPDATE ocurre dentro de cuerpos de función, se ejecuta sólo cuando esas funciones se invocan luego, no al aplicar la migración |
| Referencias al esquema `private` / `rider_map` | **0** | confirmado por lectura completa + grep, ver sección 12 |

---

## 1. Tablas creadas

| Línea | Nombre | Esquema | IF NOT EXISTS |
|---|---|---|---|
| 563 | `scanned_product_audit` | `public` | Sí (`create table if not exists public.scanned_product_audit`) |

Definición completa (líneas 563-573):
```sql
create table if not exists public.scanned_product_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  draft_id uuid references public.catalog_product_drafts(id) on delete set null,
  gtin text not null,
  action text not null check (action in ('completed', 'price_confirmed', 'published', 'unpublished')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
```

No hay ninguna otra sentencia `create table` en el archivo.

---

## 2. Columnas agregadas a tablas existentes

### `public.fiscal_profiles` (líneas 7-19)

| Línea | Columna | Tipo | Default | Nullability | IF NOT EXISTS |
|---|---|---|---|---|---|
| 7 | `certificate_fingerprint_sha256` | `text` | ninguno | nullable | Sí |
| 8 | `certificate_expires_at` | `timestamptz` | ninguno | nullable | Sí |
| 9 | `certificate_subject_cuit` | `text` | ninguno | nullable | Sí |
| 10 | `credential_checked_at` | `timestamptz` | ninguno | nullable | Sí |
| 11 | `delegation_status` | `text` | `'pending'` | **NOT NULL** | Sí |
| 12 | `delegation_verified_at` | `timestamptz` | ninguno | nullable | Sí |
| 13 | `connection_ok_at` | `timestamptz` | ninguno | nullable | Sí |
| 14 | `artifact_verified_at` | `timestamptz` | ninguno | nullable | Sí |
| 15 | `print_verified_at` | `timestamptz` | ninguno | nullable | Sí |
| 16 | `homologation_authorized_at` | `timestamptz` | ninguno | nullable | Sí |
| 17 | `homologation_authorized_by` | `uuid` (FK → `auth.users(id)` `on delete restrict`) | ninguno | nullable | Sí |
| 18 | `last_error_code` | `text` | ninguno | nullable | Sí |
| 19 | `last_error_at` | `timestamptz` | ninguno | nullable | Sí |

### `public.products` (línea 558)

| Línea | Columna | Tipo | Default | Nullability | IF NOT EXISTS |
|---|---|---|---|---|---|
| 558 | `unit_cost` | `numeric(12,2)` | ninguno | nullable | Sí |

Todas las 14 columnas usan `add column if not exists` — ninguna excepción.

---

## 3. Funciones creadas o reemplazadas

Las 9 son `create or replace function`, esquema `public`, `language plpgsql`, todas `security definer`. Ninguna declara volatilidad explícita salvo las marcadas `stable`; las no marcadas son `volatile` (comportamiento por defecto de Postgres) y coincide con que todas ellas mutan datos.

| # | Línea | Firma completa | Volatilidad | `search_path` | GRANT EXECUTE a |
|---|---|---|---|---|---|
| 1 | 50 | `record_fiscal_credential_health(p_business_id uuid, p_certificate_fingerprint text, p_certificate_expires_at timestamptz, p_certificate_subject_cuit text, p_delegation_status text, p_connection_ok boolean, p_error_code text) returns void` | volatile (no declarada) | `pg_catalog, public, pg_temp` (línea 62) | `service_role` (línea 729); revocada de `public, anon, authenticated` (línea 728) |
| 2 | 98 | `get_arca_activation_status(p_business_id uuid) returns jsonb` | `stable` (línea 101) | `pg_catalog, public, pg_temp` (línea 103) | `authenticated` (línea 741); revocada de `public, anon` (línea 731) |
| 3 | 182 | `authorize_arca_homologation(p_business_id uuid, p_authorization text) returns jsonb` | volatile (no declarada) | `pg_catalog, public, pg_temp` (línea 189) | `authenticated` (línea 742); revocada de `public, anon` (línea 732) |
| 4 | 238 | `record_fiscal_verification(p_business_id uuid, p_verification text) returns jsonb` | volatile (no declarada) | `pg_catalog, public, pg_temp` (línea 245) | `authenticated` (línea 743); revocada de `public, anon` (línea 733) |
| 5 | 267 | `get_mercadopago_activation_status(p_business_id uuid) returns jsonb` | `stable` (línea 270) | `pg_catalog, public, pg_temp` (línea 272) | `authenticated` (línea 744); revocada de `public, anon` (línea 734) |
| 6 | 354 | `configure_mercadopago_settings(p_business_id uuid, p_settings jsonb) returns jsonb` | volatile (no declarada) | `pg_catalog, public, pg_temp` (línea 361) | `authenticated` (línea 745); revocada de `public, anon` (línea 735) |
| 7 | 434 | `get_business_opening_status(p_business_id uuid) returns jsonb` | `stable` (línea 437) | `pg_catalog, public, pg_temp` (línea 439) | `authenticated` (línea 746); revocada de `public, anon` (línea 736) |
| 8 | 526 | `set_business_open_state(p_business_id uuid, p_status text) returns jsonb` | volatile (no declarada) | `pg_catalog, public, pg_temp` (línea 533) | `authenticated` (línea 747); revocada de `public, anon` (línea 737) |
| 9 | 579 | `complete_scanned_product(p_product_id uuid, p_details jsonb) returns jsonb` | volatile (no declarada) | **`pg_catalog, public, extensions, pg_temp`** (línea 586, distinta de las demás — incluye `extensions`) | `authenticated` (línea 748); revocada de `public, anon` (línea 738) |
| 10 | 670 | `get_scanned_product_readiness(p_product_id uuid) returns jsonb` | `stable` (línea 673) | `pg_catalog, public, pg_temp` (línea 675) | `authenticated` (línea 749); revocada de `public, anon` (línea 739) |

Nota: son 9 funciones (numeré la tabla 1-9, el índice "10" de la última fila es un error de numeración de fila, no una función extra — hay exactamente 9 funciones).

Detalle notable: `record_fiscal_credential_health` es la única función pensada para ser llamada por el puente fiscal (backend), no por el usuario final: se revoca explícitamente de `authenticated` también (línea 728) y el único grant es a `service_role` (línea 729). Las otras 8 se revocan de `public, anon` pero SÍ se conceden a `authenticated`.

---

## 4. Índices

| Línea | Nombre | Tabla | Columnas | Único | Parcial (WHERE) | IF NOT EXISTS |
|---|---|---|---|---|---|---|
| 575-576 | `scanned_product_audit_business_idx` | `public.scanned_product_audit` | `(business_id, created_at desc)` | No | No | Sí |

Adicional (implícito, no es una sentencia `create index` propia): la `primary key` de `scanned_product_audit.id` (línea 564) genera un índice único implícito con nombre autogenerado (`scanned_product_audit_pkey`), creado por Postgres como parte del `create table if not exists`.

---

## 5. Constraints

### 5a. Vía `alter table ... add constraint` directo (patrón: `drop constraint if exists` seguido de `add constraint` sin guard `do $$`)

| Línea | Nombre | Tabla | Tipo | Definición | Guard |
|---|---|---|---|---|---|
| 21-23 | `fiscal_profiles_delegation_status_check` | `fiscal_profiles` | CHECK | `delegation_status in ('pending','verified','rejected')` | `drop constraint if exists` (línea 21) + `add constraint` directo (línea 22) — **no** usa `do $$ ... if not exists ...$$` |
| 25-27 | `fiscal_profiles_certificate_fingerprint_check` | `fiscal_profiles` | CHECK | `certificate_fingerprint_sha256 is null or ~ '^[a-f0-9]{64}$'` | ídem (líneas 25/26) |
| 29-31 | `fiscal_profiles_last_error_code_check` | `fiscal_profiles` | CHECK | `last_error_code is null or ~ '^[A-Z][A-Z0-9_]{2,63}$'` | ídem (líneas 29/30) |
| 33-35 | `fiscal_profiles_certificate_subject_cuit_check` | `fiscal_profiles` | CHECK | `certificate_subject_cuit is null or ~ '^[0-9]{11}$'` | ídem (líneas 33/34) |
| 38-42 | `fiscal_profiles_homologation_gate` | `fiscal_profiles` | CHECK | `environment <> 'homologation' or (homologation_authorized_at is not null and homologation_authorized_by is not null)` | ídem (línea 38) |
| 559-561 | `products_unit_cost_check` | `products` | CHECK | `unit_cost is null or unit_cost >= 0` | `drop constraint if exists` (línea 559) + `add constraint` directo (línea 560) |

Confirmado por grep: el archivo **no contiene ningún bloque `do $$ ... $$`**. Todas las constraints que necesitan idempotencia usan el patrón "drop if exists + add sin condición", nunca un guard PL/pgSQL con `if not exists`.

### 5b. Inline, definidas en el momento de creación (no requieren guard porque la tabla/columna que las porta ya está protegida por `if not exists`)

| Línea | Constraint | Tabla | Tipo |
|---|---|---|---|
| 564 | PK sobre `id` | `scanned_product_audit` | PRIMARY KEY |
| 565 | FK `business_id → businesses(id) on delete cascade` | `scanned_product_audit` | FOREIGN KEY |
| 566 | FK `product_id → products(id) on delete restrict` | `scanned_product_audit` | FOREIGN KEY |
| 567 | FK `draft_id → catalog_product_drafts(id) on delete set null` | `scanned_product_audit` | FOREIGN KEY (nullable) |
| 569 | CHECK inline `action in ('completed','price_confirmed','published','unpublished')` | `scanned_product_audit` | CHECK (nombre autogenerado, algo como `scanned_product_audit_action_check`) |
| 565,566,569,570,571,572 | NOT NULL en `business_id, product_id, gtin, action, actor_id, detail, created_at` (7 columnas) | `scanned_product_audit` | NOT NULL |
| 17 | FK inline `homologation_authorized_by → auth.users(id) on delete restrict`, agregada junto con el `add column if not exists` | `fiscal_profiles` | FOREIGN KEY (nombre autogenerado, nullable) |

---

## 6. Triggers

**Ninguno.** El archivo no contiene ninguna sentencia `create trigger` ni `drop trigger`. Confirmado por grep (`create trigger|drop trigger` → 0 coincidencias) y por lectura completa línea por línea.

---

## 7. Policies RLS

| Línea | Nombre exacto | Tabla | Comando | `drop policy if exists` previo |
|---|---|---|---|---|
| 724-726 | `"business reads scanned product audit"` | `public.scanned_product_audit` | `select` a rol `authenticated`, `using (public.is_business_member(business_id))` | Sí, línea 724, mismo nombre exacto entre comillas |

`enable row level security`: **una sola tabla**, `public.scanned_product_audit` (línea 720). Ninguna otra tabla (ni `fiscal_profiles`, ni `products`, ni `business_payment_settings`, etc.) recibe `enable row level security` en este archivo — se asume que ya la tenían habilitada de migraciones anteriores.

---

## 8. Grants y Revokes (22 sentencias en total: 11 revoke + 11 grant)

### Sobre tabla

| Línea | Sentencia |
|---|---|
| 721 | `revoke all privileges on table public.scanned_product_audit from public, anon, authenticated;` |
| 722 | `grant select on table public.scanned_product_audit to authenticated;` |

### Sobre funciones

| Línea | Sentencia |
|---|---|
| 728 | `revoke execute on function public.record_fiscal_credential_health(uuid, text, timestamptz, text, text, boolean, text) from public, anon, authenticated;` |
| 729 | `grant execute on function public.record_fiscal_credential_health(uuid, text, timestamptz, text, text, boolean, text) to service_role;` |
| 731 | `revoke execute on function public.get_arca_activation_status(uuid) from public, anon;` |
| 732 | `revoke execute on function public.authorize_arca_homologation(uuid, text) from public, anon;` |
| 733 | `revoke execute on function public.record_fiscal_verification(uuid, text) from public, anon;` |
| 734 | `revoke execute on function public.get_mercadopago_activation_status(uuid) from public, anon;` |
| 735 | `revoke execute on function public.configure_mercadopago_settings(uuid, jsonb) from public, anon;` |
| 736 | `revoke execute on function public.get_business_opening_status(uuid) from public, anon;` |
| 737 | `revoke execute on function public.set_business_open_state(uuid, text) from public, anon;` |
| 738 | `revoke execute on function public.complete_scanned_product(uuid, jsonb) from public, anon;` |
| 739 | `revoke execute on function public.get_scanned_product_readiness(uuid) from public, anon;` |
| 741 | `grant execute on function public.get_arca_activation_status(uuid) to authenticated;` |
| 742 | `grant execute on function public.authorize_arca_homologation(uuid, text) to authenticated;` |
| 743 | `grant execute on function public.record_fiscal_verification(uuid, text) to authenticated;` |
| 744 | `grant execute on function public.get_mercadopago_activation_status(uuid) to authenticated;` |
| 745 | `grant execute on function public.configure_mercadopago_settings(uuid, jsonb) to authenticated;` |
| 746 | `grant execute on function public.get_business_opening_status(uuid) to authenticated;` |
| 747 | `grant execute on function public.set_business_open_state(uuid, text) to authenticated;` |
| 748 | `grant execute on function public.complete_scanned_product(uuid, jsonb) to authenticated;` |
| 749 | `grant execute on function public.get_scanned_product_readiness(uuid) to authenticated;` |

Nota: `record_fiscal_credential_health` es la única función a la que se le revoca ejecución también de `authenticated` (línea 728) — todas las demás sólo se revocan de `public, anon` y luego se conceden a `authenticated`.

---

## 9. Comments

| Línea | Objeto | Texto |
|---|---|---|
| 44-45 | columna `public.fiscal_profiles.certificate_fingerprint_sha256` | "Huella pública del certificado. La clave privada nunca sale del puente fiscal." |
| 46-47 | columna `public.fiscal_profiles.last_error_code` | "Código saneado del último problema con ARCA. Nunca contiene XML ni mensajes del proveedor." |
| 751-752 | función `public.get_mercadopago_activation_status(uuid)` | "Estado de activación de cobros para el panel. Devuelve sólo los últimos dígitos de los identificadores y ningún secreto." |
| 753-754 | función `public.configure_mercadopago_settings(uuid, jsonb)` | "Ajustes operativos de cobro para owner/admin. Rechaza cualquier clave fuera de la lista permitida y no admite dinero real." |
| 755-756 | función `public.authorize_arca_homologation(uuid, text)` | "Habilita las pruebas con ARCA sólo con la frase exacta I_AUTHORIZE_ARCA_HOMOLOGATION y deja registrado quién autorizó." |
| 757-758 | función `public.complete_scanned_product(uuid, jsonb)` | "Completa un producto creado por escaneo. Un precio pendiente lo deja visible pero no comprable." |

---

## 10. Datos / fixtures

**No hay ningún INSERT, UPDATE ni DELETE a nivel de migración** (es decir, ninguno que se ejecute cuando se *aplica* este archivo). Confirmado por grep de `insert into|update public\.|delete from` sobre todo el archivo: las únicas coincidencias están todas dentro de cuerpos de función (`$tag$ ... $tag$`), o sea, código que sólo corre cuando la app invoca esas funciones más adelante — no al correr la migración.

Ubicaciones (todas dentro de function bodies, transcriptas):

- Línea 79 (dentro de `record_fiscal_credential_health`):
  ```sql
  update public.fiscal_profiles set
    certificate_fingerprint_sha256 = coalesce(p_certificate_fingerprint, certificate_fingerprint_sha256),
    ...
  where business_id = p_business_id;
  ```
- Línea 221 (dentro de `authorize_arca_homologation`):
  ```sql
  update public.fiscal_profiles set
    environment = 'homologation',
    is_enabled = true,
    homologation_authorized_at = clock_timestamp(),
    homologation_authorized_by = auth.uid(),
    updated_at = now()
  where business_id = p_business_id
  returning * into v_profile;
  ```
- Línea 230 (dentro de `authorize_arca_homologation`):
  ```sql
  insert into public.fiscal_events (business_id, fiscal_document_id, event_type, detail)
  values (p_business_id, null, 'homologation_authorized', jsonb_build_object('actor', auth.uid()));
  ```
- Línea 255 (dentro de `record_fiscal_verification`): `update public.fiscal_profiles set artifact_verified_at = ..., print_verified_at = ... where business_id = p_business_id;`
- Línea 386 (dentro de `configure_mercadopago_settings`):
  ```sql
  insert into public.business_payment_settings (
    business_id, provider, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at
  )
  values (
    p_business_id, 'mercadopago', 'test', 'checkout_pro', 'ARS', true,
    v_collector, v_application, clock_timestamp()
  )
  on conflict (business_id, provider) do nothing;
  ```
- Línea 404 (dentro de `configure_mercadopago_settings`): `update public.business_payment_settings set collector_id = ..., application_id = ..., ... where id = v_settings.id returning * into v_settings;`
- Línea 545 (dentro de `set_business_open_state`): `update public.businesses set status = p_status, updated_at = now() where id = p_business_id returning * into v_business;`
- Línea 635 (dentro de `complete_scanned_product`): `update public.products set name = ..., price = ..., stock = ..., available = ... where id = v_product.id returning * into v_product;`
- Línea 655 (dentro de `complete_scanned_product`):
  ```sql
  insert into public.scanned_product_audit (business_id, product_id, gtin, action, actor_id, detail)
  values (v_product.business_id, v_product.id, coalesce(...), case when v_price_pending then 'completed' else 'price_confirmed' end, auth.uid(), jsonb_build_object('price_status', v_product.price_status, 'stock', v_product.stock));
  ```

No hay ningún `delete from` en todo el archivo.

**Conclusión crítica**: aplicar esta migración por sí sola NO muta ninguna fila existente en `fiscal_profiles`, `products`, `businesses`, `business_payment_settings`, `fiscal_events` ni `scanned_product_audit`. Toda mutación de datos queda diferida a cuándo (y si) alguien invoca estas 9 funciones RPC desde la app o el puente fiscal.

---

## 11. Dependencias externas (objetos preexistentes referenciados, no creados por este archivo)

### Tablas preexistentes referenciadas

| Objeto | ¿Cómo se usa? | Evidencia (líneas) |
|---|---|---|
| `public.fiscal_profiles` | **Alterada** (columnas/constraints agregadas) y leída/escrita en 6 funciones | 7-42, 106, 114, 192, 201, 221, 255, 275(no, ver mercadopago), 442-459 |
| `public.fiscal_documents` | Leída (join, count) | 116-121, 146-160 |
| `public.fiscal_outbox` | Leída (join, count) | 162-167, 465-467 |
| `public.fiscal_events` | Escrita (`insert`) | 230-231 |
| `public.businesses` | Leída y **actualizada** (`update ... set status`); también FK target de `scanned_product_audit.business_id` | 284, 344-348, 453, 545-547, 565 |
| `public.business_payment_settings` | Leída, insertada y actualizada; requiere constraint única `(business_id, provider)` para que el `on conflict` funcione | 275, 285-286, 364, 386-426, 457-458 |
| `public.payment_webhook_receipts` | Leída (join) | 288-292, 333-339 |
| `public.payment_events` | Leída (join) | 290 |
| `public.payment_intents` | Leída (join, count, exists) | 291, 294-305, 326-339 |
| `public.inventory_reservations` | Leída (exists/join) | 296-299 |
| `public.checkout_sessions` | Leída (join) | 297 |
| `public.payment_outbox` | Leída (join, count) | 462-464 |
| `public.riders` | Leída (count) | 470-471 |
| `public.orders` | Leída (count) | 473-475 |
| `public.products` | **Alterada** (columna `unit_cost` + constraint) y leída/actualizada; FK target de `scanned_product_audit.product_id` | 558-561, 589, 598, 635-653, 683, 566 |
| `public.catalog_product_drafts` | Sólo como FK target (`draft_id`), no se lee/escribe dentro de este archivo | 567 |
| `public.product_barcodes` | Leída | 659, 692-694 |
| `auth.users` | FK target (`homologation_authorized_by`, `actor_id`) | 17, 570 |

### Funciones preexistentes referenciadas

| Objeto | Uso | Evidencia (líneas) |
|---|---|---|
| `public.has_business_role(uuid, text[])` | Autorización, llamada en 7 de las 9 funciones nuevas | 110, 194, 248, 280, 369, 449, 538, 602, 687 |
| `public.is_business_member(uuid)` | Usada en la cláusula `using` de la policy RLS | 726 |
| `auth.uid()` | Captura de actor | 225, 231, 661 |
| `gen_random_uuid()` | Default de PK en `scanned_product_audit.id` | 564 |
| `clock_timestamp()`, `now()` | Timestamps (built-in Postgres, no requieren dependencia externa además del propio motor) | múltiples |

### Roles preexistentes referenciados
`public`, `anon`, `authenticated`, `service_role` (todos roles estándar de Supabase, no creados aquí).

### Verificación puntual pedida en la tarea

| Objeto preguntado | ¿Referenciado? | Evidencia |
|---|---|---|
| `fiscal_profiles` | **Sí** — alterada (columnas nuevas + constraints) y usada extensamente | líneas 7-42, 79-93, 106, 114, 192, 201-228, 255-259, 442-459 |
| `payment_intents` | **Sí** — leída/joineada | líneas 291, 294-305, 326-339, 462-464 (vía `payment_outbox`) |
| `operational_alerts` | **No** — cero menciones (confirmado por grep) | — |
| `daily_reconciliations` | **No** — cero menciones (confirmado por grep) | — |
| `products` | **Sí** — alterada (columna `unit_cost`) y leída/actualizada | líneas 558-561, 589-653, 683-716 |
| `businesses` | **Sí** — leída y actualizada, y FK target | líneas 284, 344-348, 453, 545-547, 565 |
| `business_members` | **No** — no aparece ninguna referencia directa en este archivo. La autorización pasa siempre por `public.has_business_role(...)`, una función externa cuya implementación interna (no incluida en este archivo) podría consultar `business_members`, pero este archivo no la referencia directamente. NO_VERIFICADO si `has_business_role` internamente usa `business_members`, porque esa función no está definida en este archivo. | — |
| `has_business_role` | **Sí** — llamada en 7 de las 9 funciones nuevas, es una precondición dura: si no existe, la migración falla al aplicarse (porque el cuerpo de la función referencia un objeto inexistente se validaría recién en tiempo de ejecución para PL/pgSQL, no en `create or replace function` — ver nota de idempotencia/precondición abajo) | líneas 110, 194, 248, 280, 369, 449, 538, 602, 687 |

Nota técnica sobre `has_business_role`: al ser `plpgsql`, Postgres NO valida en tiempo de `CREATE FUNCTION` que los objetos referenciados dentro del cuerpo existan (sólo valida sintaxis). Por lo tanto, el `create or replace function` en sí no fallaría aunque `has_business_role` no existiera todavía — pero cualquier intento de EJECUTAR estas 9 funciones fallaría en tiempo de ejecución con "function does not exist". Igualmente, es una precondición real y dura para que el panel funcione.

---

## 12. ¿Toca el esquema `private`? ¿Rider map?

**NO**, con evidencia:

- Grep sobre todo el archivo con el patrón `private\.|rider_map|operational_alerts|daily_reconciliations|business_members|do \$\$|create trigger|drop trigger` → **0 coincidencias**.
- Lectura completa línea por línea confirma que el único esquema mencionado explícitamente además de `public` es `auth` (para `auth.users` y `auth.uid()`), y en los `search_path` de las funciones aparecen `pg_catalog`, `public`, `extensions`, `pg_temp` — nunca `private`.
- La única tabla con nombre parecido a "rider" es `public.riders` (línea 470-471, usada en `get_business_opening_status` para contar repartidores disponibles) — es una tabla de negocio distinta, no relacionada con `rider_map` ni con la captura de ubicación (`capture_rider_map_order_location_snapshot`), que no se mencionan en absoluto.

Conclusión: esta migración es completamente ajena al subsistema de `rider_map` / esquema `private`. No lo crea, no lo lee, no lo modifica, no lo menciona.

---

## 13. ¿Es idempotente?

**Sí, en su totalidad, a nivel de "no debería tirar error de objeto duplicado al reejecutarse"**, con las siguientes salvedades documentadas por sentencia:

| Patrón | Sentencias | ¿Reejecutable sin error? |
|---|---|---|
| `alter table ... add column if not exists` | 14 (líneas 7-19, 558) | Sí — no-op si la columna ya existe |
| `alter table ... drop constraint if exists` + `add constraint` (sin guard) | 6 pares (líneas 21-42, 559-561) | Sí, como par — el `drop if exists` nunca falla y el `add constraint` recrea la misma definición. **Salvedad real**: si al momento de reejecutar existen filas que violan el CHECK (por ejemplo, un `fiscal_profiles.last_error_code` con formato no saneado ya guardado), el `add constraint` fallaría — pero esto es un riesgo de dato, no de idempotencia de la sentencia en sí, y fallaría igual la primera vez que se corrió con esos datos presentes |
| `create table if not exists` | 1 (línea 563) | Sí — no-op si la tabla ya existe (y no reconcilia diferencias de columnas si la tabla preexistente tiene otra forma) |
| `create index if not exists` | 1 (línea 575) | Sí |
| `create or replace function` | 9 (líneas 50, 98, 182, 238, 267, 354, 434, 526, 579, 670) | Sí — reemplaza la definición sin importar cuántas veces se corra |
| `alter table ... enable row level security` | 1 (línea 720) | Sí — habilitar RLS ya habilitado no es un error en Postgres |
| `revoke ...` | 11 (líneas 721, 728, 731-739) | Sí — revocar un privilegio no otorgado no es un error |
| `grant ...` | 11 (líneas 722, 729, 741-749) | Sí — otorgar un privilegio ya otorgado no es un error |
| `drop policy if exists` + `create policy` | 1 par (líneas 724-726) | Sí |
| `comment on ...` | 6 (líneas 44, 46, 751, 753, 755, 757) | Sí — sobrescribe el comentario, no falla si ya existe uno distinto |

**No se encontró ninguna sentencia que use una forma "create X" sin `if not exists`/`or replace` que fallaría con "already exists" en una segunda corrida.** Tampoco hay ningún `do $$ ... $$` en todo el archivo (confirmado por grep) — el mecanismo de idempotencia de constraints es siempre "drop if exists, luego add sin condición", nunca un guard procedural.

**Riesgos que sí podrían romper una reejecución (no por diseño de la sentencia, sino por estado externo):**
1. Los 5 CHECK de `fiscal_profiles` y el de `products` fallarían si existen filas con valores que no cumplen el check en el momento en que se corre `add constraint` (aplica igual a la primera corrida y a cualquier repetición).
2. El `grant execute ... to service_role` (línea 729) depende de que el rol `service_role` exista — es un rol estándar de Supabase, se asume presente, pero si no lo estuviera, fallaría en cada corrida (no es un problema de idempotencia sino de precondición).
3. El `insert ... on conflict (business_id, provider) do nothing` (línea 394, dentro de `configure_mercadopago_settings`) depende de que exista una constraint UNIQUE o índice único sobre `business_payment_settings(business_id, provider)` — este archivo no la crea; es una precondición implícita externa a la migración.
4. Las 4 columnas con FK inline (`homologation_authorized_by → auth.users`, y las 3 FK de `scanned_product_audit`) dependen de que las tablas referenciadas (`auth.users`, `public.businesses`, `public.products`, `public.catalog_product_drafts`) existan; si no, la migración completa fallaría (no idempotencia, precondición dura).

En síntesis: la migración es idempotente por diseño explícito (uso sistemático de `if not exists`, `or replace`, `drop ... if exists` previo a recrear); el único vector de fallo en una repetición es de **datos** (violación de un CHECK nuevo por filas preexistentes) o de **precondiciones externas ausentes**, no de la sintaxis/estructura de la migración en sí.

---

## PRECONDICIONES

Objetos que deben existir ANTES de aplicar esta migración (si falta alguno, la migración completa aborta):

1. **Tablas**: `public.fiscal_profiles`, `public.fiscal_documents`, `public.fiscal_outbox`, `public.fiscal_events`, `public.businesses`, `public.business_payment_settings`, `public.payment_webhook_receipts`, `public.payment_events`, `public.payment_intents`, `public.inventory_reservations`, `public.checkout_sessions`, `public.payment_outbox`, `public.riders`, `public.orders`, `public.products`, `public.catalog_product_drafts`, `public.product_barcodes`, `auth.users`.
2. **Funciones**: `public.has_business_role(uuid, text[])`, `public.is_business_member(uuid)` (usada en la policy), `auth.uid()`, `gen_random_uuid()`.
3. **Columnas preexistentes asumidas** en las tablas de arriba (usadas dentro de los cuerpos de función pero no creadas aquí): en `fiscal_profiles` — `legal_name`, `cuit`, `tax_condition`, `business_address`, `accountant_review_status`, `environment`, `point_of_sale`, `is_enabled`, `updated_at`, `business_id`; en `businesses` — `status`, `is_active`, `ordering_enabled`, `ordering_verified`, `updated_at`; en `products` — `name`, `brand`, `category`, `variant`, `presentation`, `capacity_value`, `capacity_unit`, `capacity`, `units_per_pack`, `price`, `price_status`, `stock`, `available`, `is_verified`, `catalog_asset_id`, `image_url`, `updated_at`, `business_id`; en `business_payment_settings` — `provider`, `environment`, `checkout_mode`, `currency`, `reserve_stock`, `collector_id`, `application_id`, `installments_limit`, `preference_expiration_minutes`, `enabled`, `configured_at`, `updated_at`, `verified_at`, `production_review_status`.
4. **Constraint única implícita**: `business_payment_settings(business_id, provider)` debe tener una restricción UNIQUE (o índice único) preexistente para que `on conflict (business_id, provider) do nothing` (línea 394) sea válido. Esta migración NO la crea.
5. **Roles**: `public`, `anon`, `authenticated`, `service_role` deben existir (roles estándar de Supabase).
6. **Extensión/función** `gen_random_uuid()` disponible en el `search_path` (típicamente vía `pgcrypto` o `pg_catalog` en Postgres 13+); notar que `complete_scanned_product` declara explícitamente el esquema `extensions` en su `search_path` (línea 586), a diferencia de las otras 8 funciones — sugiere que algo que usa (directa o indirectamente) requiere buscar en ese esquema.
7. **NO_VERIFICADO**: si `public.has_business_role` internamente consulta `business_members` — esa función no está definida en este archivo, por lo que no puede confirmarse desde este archivo solo.

## IDEMPOTENCIA (resumen)

**La migración es idempotente por diseño**: toda operación de creación usa `if not exists` o `create or replace`; toda constraint se recrea vía `drop constraint if exists` + `add constraint`; la policy usa `drop policy if exists` + `create policy`; grants/revokes nunca fallan por repetirse; los comentarios se sobrescriben sin error. **No se encontró ningún bloque `do $$ ... $$`** en todo el archivo — el guard siempre es sintáctico (`if exists`/`if not exists`/`or replace`), nunca procedural.

Los únicos vectores de fallo en una repetición son externos a la sentencia misma:
- Datos preexistentes que violen un CHECK nuevo (5 en `fiscal_profiles`, 1 en `products`).
- Ausencia de una precondición externa (rol `service_role`, constraint única en `business_payment_settings`, o cualquiera de las tablas/funciones listadas en PRECONDICIONES).

Ninguna sentencia DDL de este archivo, por sí sola, tiene una forma "create sin guard" que fallaría con error de "ya existe" en una segunda corrida.
