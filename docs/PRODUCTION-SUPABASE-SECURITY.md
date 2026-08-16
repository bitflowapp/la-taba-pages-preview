# TABA2 · Producción Supabase · Informe de seguridad del schema inicial

**Proyecto** `la-taba-production` · ref `wwcpogltfgzgkrlilbcd` · región `sa-east-1`
**Autoridad de schema** `feature/taba2-rider-multi-order-backend` @ `f4d5bc8` · 100 migraciones
**Digest** `e45f69cdb9c939e29620278450984cd2f4e42ad52cf79295470437c35f5cf2a9`
**Medido** 2026-08-16, sobre la base productiva real y sobre un shadow local
construido desde cero. Sin claves en este documento.

> Todo lo que sigue está **medido contra la base**, no leído de las migraciones.
> El estado final de un privilegio no se puede deducir del árbol: hay grants
> tempranos y revokes posteriores sobre las mismas tablas, y gana el orden de
> aplicación.

---

## 1. Resumen

| | |
|---|---|
| Tablas en `public` | 85 |
| Tablas **sin RLS** | **0** |
| Policies | 66 |
| Funciones en `public` | 276 |
| Funciones `SECURITY DEFINER` | 222 |
| …sin `search_path` fijado | **0** |
| Índices / triggers / constraints | 249 / 65 / 689 |
| Buckets de Storage | 1 (privado) |
| Edge Functions desplegadas | **0** |
| Secretos de Edge Functions | **0** |
| Secretos en Vault | **0** |
| Datos humanos o comerciales | **0** |
| Drift shadow ↔ producción | **ninguno sin explicar** |

---

## 2. RLS

Las 85 tablas de `public` tienen RLS habilitada. No hay excepciones.

29 de ellas tienen RLS **y ninguna policy**, que es el estado más cerrado
posible: `anon` y `authenticated` no pueden leer ni escribir una sola fila, y
sólo `service_role` (que salta RLS) llega. Son las tablas de mecanismo interno:
outboxes de pago y fiscales, sesiones y auditoría de identidad, ubicaciones del
Rider, ofertas de pedido, reservas de inventario, tokens públicos de pedido y
telemetría operativa. La lista completa está en
`artifacts/production-supabase/SECURITY-PORTRAIT-production.json`.

### Verificado por el camino real

No alcanza con leer `pg_policies`. Se probó de dos formas independientes:

1. **PostgREST con la clave publicable**, contra la producción real. Lecturas:
   `orders`, `products` y `fiscal_profile_events` responden `200` con **0 filas**;
   `businesses`, `customers`, `rider_profiles`, `rider_locations`,
   `payment_intents`, `fiscal_documents`, `identity_sessions`, `business_members`,
   `rider_order_offers`, `staff_profiles`, `commercial_contract_remediation` y
   `order_public_tokens` responden `401`. **Las cuatro escrituras anónimas
   probadas devolvieron `401`.**

2. **Conexión TCP como `authenticator`** —el rol con el que PostgREST entra de
   verdad— sobre el shadow, cuyo schema quedó demostrado idéntico al productivo.
   Esto cierra un agujero conocido de pgTAP: ahí las suites corren por
   `psql -U postgres`, donde `set local role authenticated` cambia `current_user`
   pero **no `session_user`**, y las guardas de identidad de TABA miran
   `session_user`. Resultado: **18/18 contratos sostienen el aislamiento**
   (`artifacts/production-supabase/TENANT-ISOLATION-PROBE.json`).

---

## 3. Privilegios

`CREATE` sobre el schema `public` está denegado para `anon`, `authenticated`,
`service_role` y `PUBLIC`. No hay un solo grant a `PUBLIC` sobre tablas.
`vault` no es accesible para `anon` ni `authenticated`.

### Grants por columna: donde casi se cuela un falso negativo

`businesses` **no tiene grant de tabla** para `anon`, y sin embargo `anon` lee
12 columnas de vitrina (`id`, `name`, `address`, `status`, `is_active`,
`delivery_enabled`, `delivery_fee`, `pickup_enabled`, `ordering_enabled`,
`ordering_verified`, `currency_code`, `minimum_delivery_subtotal`). No están
`phone`, ni la configuración de alcohol, ni los límites de rate-limit.

Es un contrato deliberado y bien acotado, pero **una auditoría que sólo mire
`role_table_grants` lo reporta como "sin acceso"**, y un `select count(*)` lo
reporta como "acceso total" —basta una columna concedida para que `count(*)`
pase—. Las dos lecturas son falsas. Por eso el retrato incluye ahora
`role_column_grants` y el comparador de drift también los compara.

---

## 4. Hallazgos

### P1 · Las funciones "STAGING ONLY" de fixtures QA existen en producción

`20260731230000_staging_qa_fixture_catalog.sql` crea
`import_qa_fixture_catalog(uuid, text, jsonb, jsonb)` y
`publish_qa_fixture_product(uuid, text, boolean)`, ambas `SECURITY DEFINER` y
con `grant execute ... to authenticated`.

La migración **no inserta ni una fila** —los `insert` están dentro de los
cuerpos—, así que producción no recibió datos. El problema es la capacidad que
queda instalada: un `owner`/`admin` de un comercio puede publicar productos con
`rights_status = 'UNAPPROVED_QA'`, sin `approved_at` ni `approved_by`, y
dejarlos **ordenables** (`publish_qa_fixture_product` pone `is_verified = true`
y `available = true`). La misma migración además aflojó el contrato comercial
para permitirlo: `catalog_assets.approved_at` y `approved_by` dejaron de ser
`NOT NULL`, y `products_verified_publication_authority` admite ahora una rama
para orígenes QA que saltea las validaciones de SKU, variante, capacidad y ruta
de imagen.

Los comentarios dicen "STAGING ONLY" pero **no hay ninguna compuerta de entorno**
que lo haga cierto. El control que se saltea es de derechos de imagen, es decir
tiene filo legal, no sólo técnico.

Requiere credenciales de `owner`/`admin` y sólo alcanza al comercio propio: por
eso es P1 y no P0.

**No se arregló en esta misión, a propósito**: la misión prohíbe tocar las
migraciones autoritativas mientras producción se está aprovisionando. Corresponde
una migración nueva que revoque ambas funciones en producción (o las condicione),
con su inversa.

### P2 · `fiscal_profile_events`: privilegios por defecto que RLS tapa

`anon` **y** `authenticated` tienen `SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER` sobre `public.fiscal_profile_events`. No viene de un `grant`
escrito: viene de los privilegios por defecto del schema. Es la única tabla de
las 85 en esa situación.

Hoy está contenido: RLS está habilitada y la única policy es un `SELECT` para
`authenticated` acotado por `has_business_role(...)`. Medido: la lectura anónima
devuelve `200` con 0 filas y el `INSERT` anónimo muere con *new row violates
row-level security policy*.

Es exactamente la clase del hallazgo B3 (`commercial_contract_remediation`), que
sí se cerró con `revoke` además de RLS. Acá la tabla depende de **un solo
control**. Corresponde el mismo `revoke` explícito.

Detalle fino: `TRUNCATE` **no** está sujeto a RLS. No hay camino para que `anon`
lo ejecute (PostgREST no expone `TRUNCATE`), pero es otra razón para revocar.

### P2 · 18 funciones `SECURITY DEFINER` invocables por `anon`

Las 222 funciones `SECURITY DEFINER` tienen `search_path` fijado —cero
excepciones—. 18 son ejecutables por `anon`. Varias son superficie pública
legítima (`get_public_order_tracking`, `commerce_availability`,
`list_business_combos`, `resolve_business_combo`, `get_public_business_contact`)
y varias son funciones de trigger que no se pueden invocar de forma útil por
REST (`prevent_unverified_delivery`, `assert_order_payment_modality`,
`enqueue_new_order_notification`).

Quedan para revisión dirigida antes del lanzamiento la superficie fiscal y de
scheduler: `request_fiscal_print_job`, `update_fiscal_print_job`,
`enqueue_authorized_fiscal_artifact`, `request_fiscal_artifact_regeneration`,
`list_fiscal_document_artifacts`, `authorize_fiscal_artifact_access`,
`assert_fiscal_execution_authorized`, `scheduler_heartbeat`,
`check_scheduler_watchdog`, `can_access_order`.

Sesiones anteriores barrieron 81 funciones invocables y encontraron chequeo
explícito en 71; **no se re-verificó cuerpo por cuerpo en esta misión** y no se
afirma que estén bien. Un barrido por regex de "¿chequea autorización?" da
falsos positivos —`set_delivery_pricing` y `set_service_enforcement` parecían sin
guardia y llaman a `can_manage_commercial_settings`—: hay que leer el cuerpo.

### P2 · Cuatro jobs de `pg_cron` ya corriendo en producción

| job | frecuencia | comando |
|---|---|---|
| `taba-payment-outbox-worker` | cada 30 s | `dispatch_payment_outbox_worker('cron')` |
| `taba-checkout-expiry-sweep` | cada minuto | `sweep_expired_checkout_sessions()` |
| `taba-checkout-provider-truth-sweep` | cada minuto | `enqueue_checkout_provider_probes()` |
| `taba-operational-alerts-sweep` | cada minuto | `evaluate_operational_alerts_sweep()` |

Producción **no está inerte**: quedó con trabajo agendado desde el minuto uno.

Hoy es inofensivo y se verificó por qué:
`dispatch_payment_outbox_worker` sale temprano si no hay nada vencido en
`payment_outbox` (está vacía), y después busca `taba_payment_worker_url` y
`taba_payment_worker_hmac_secret` en Vault; **Vault tiene 0 secretos**, y con
configuración ausente la función retorna `null` explícitamente. Además valida que
la URL matchee
`^https://[a-z0-9-]+\.supabase\.co/functions/v1/mercadopago-payment-worker$`.
No hay ninguna llamada saliente posible hoy.

Lo que sí ocurre: `evaluate_operational_alerts_sweep` escribe una fila por minuto
en `operational_sweep_runs` (12 filas al cierre de la medición). Es telemetría
técnica, no dato humano ni comercial, pero **crece sola** mientras producción
espera el lanzamiento.

### P3 · El comercio "La Taba" nace con `status = 'open'`

La primera migración (`20260531030000`) inserta el comercio canónico
`00000000-0000-4000-8000-000000000001` / "La Taba" con `status = 'open'`.
Es dato de sistema, no un fixture (ver §5). Nada es ordenable —no hay productos—
pero conviene decidir si producción debe nacer `open` o cerrada.

---

## 5. Datos: qué hay y por qué

| tabla | filas | clasificación |
|---|---|---|
| `identity_permissions` | 20 | **dato de sistema**: catálogo de permisos del modelo de identidad |
| `identity_role_permissions` | 44 | **dato de sistema**: mapa rol → permiso |
| `businesses` | 1 | **dato de sistema**: el comercio canónico de TABA, UUID fijo |
| `operational_sweep_runs` | 12 (crece) | **telemetría** generada por el cron, no cargada |

**0 clientes, 0 pedidos, 0 riders, 0 asignaciones, 0 pagos, 0 tracking, 0
productos, 0 miembros de comercio, 0 usuarios en `auth`.**

`supabase/seed.sql` está deliberadamente vacío y el push corrió con
`seeds: []` y `roles: []`. Las migraciones con nombre de QA
(`staging_qa_fixture_catalog`, `staging_qa_product_verification`,
`order_qa_origin_classification`, `qa_orders_do_not_ring_the_panel`,
`manual_qa_reclassification`, `rider_canonical_claim_excludes_qa`) **no insertan
filas**: definen columnas, constraints, triggers y funciones. La capacidad que
dejan instalada es el hallazgo P1.

---

## 6. Storage

Un bucket, creado por migración (`20260802170000_fiscal_document_closure.sql`):

- `fiscal-documents` — **privado**, límite 16 MiB, `application/pdf` únicamente.
- Una policy sobre `storage.objects`: *fiscal documents service-only*, `ALL`,
  sólo `service_role`.

No se creó ningún bucket desde el panel. No se subió ningún archivo.

---

## 7. Auth · `AUTH CONFIG PENDING`

Verificado sin tomar decisiones comerciales. Providers externos: sólo email.
Sin OAuth, sin teléfono, sin usuarios anónimos. `mailer_autoconfirm = false`.
**0 usuarios**; no se importó ni un registro de staging.

Queda pendiente, y **no se inventó**:

| ítem | estado hoy | por qué bloquea |
|---|---|---|
| `site_url` | `http://localhost:3000` | es el default de Supabase; los mails de confirmación y recuperación apuntarían a localhost |
| `uri_allow_list` | vacío | ningún redirect de producción está permitido todavía |
| `disable_signup` | `false` | alta abierta; hay que decidir si producción abre registro antes del lanzamiento |
| `security_captcha_enabled` | `false` | decisión de producto |

---

## 8. Edge Functions y secretos

8 funciones en el árbol (`fiscal-artifact-access`, `mercadopago-cancel-payment`,
`mercadopago-checkout-status`, `mercadopago-create-checkout-session`,
`mercadopago-create-preference`, `mercadopago-payment-worker`,
`mercadopago-refund`, `mercadopago-webhook`) y **0 desplegadas**. No se desplegó
ninguna: no hacía falta para certificar el schema.

Secretos requeridos antes del lanzamiento (**nombres, nunca valores**):

| nombre | propósito | ¿antes del lanzamiento? |
|---|---|---|
| `taba_payment_worker_url` | Vault · destino del worker de outbox de pagos | sí, si se activa el worker |
| `taba_payment_worker_hmac_secret` | Vault · firma HMAC del worker (mín. 32 chars) | sí, si se activa el worker |
| credenciales Mercado Pago producción | Edge Functions de checkout/webhook | sí, y **fuera del alcance de esta misión** |

No se copió un solo secreto de staging.

---

## 9. Claves del proyecto

Cuatro credenciales, clasificadas sin exponer valores:

| nombre | tipo | uso |
|---|---|---|
| `anon` | JWT legacy | **publicable** · cliente |
| `default` | `sb_publishable_…` | **publicable** · cliente |
| `service_role` | JWT legacy | **secreta** · sólo servidor |
| `default` | `sb_secret_…` | **secreta** · sólo servidor |

`SERVICE ROLE IN CLIENT = 0`. Ningún cliente conoce todavía este ref.

---

## 10. Nota de facturación

Producción quedó en **Luna Systems**, la única organización de la cuenta, donde
ya viven `la-taba-staging` y `la-taba-demo`. `PRODUCTION-INFRA-COSTS` planteaba
producción **sola** en una organización Pro para cerrar en USD 25/mes, y
Supabase factura por organización sumando compute por proyecto. Crear una
organización nueva es una decisión de facturación y propiedad, no técnica: se
deja señalado, no resuelto.

PITR está apagado (`pitr_enabled: false`) y `walg_enabled: true`, con dos
backups físicos completados el mismo día de la creación. Es exactamente la
postura que eligió el plan de presupuesto: backups diarios incluidos en Pro en
vez de PITR (USD 100/mes). RPO real: hasta 24 h.

---

## 11. Cómo reproducir estas mediciones

```bash
node scripts/assert-production-supabase-target.mjs --ref <ref> --category "<qué>"
node scripts/provision-production-shadow.mjs        # 100 migraciones + 332 pgTAP
node scripts/audit-production-migrations.mjs --remote-ledger <archivo>
node scripts/audit-production-security.mjs --target shadow
node scripts/audit-production-security.mjs --target production   # requiere SUPABASE_ACCESS_TOKEN
node scripts/compare-production-drift.mjs
node scripts/probe-tenant-isolation.mjs
```
