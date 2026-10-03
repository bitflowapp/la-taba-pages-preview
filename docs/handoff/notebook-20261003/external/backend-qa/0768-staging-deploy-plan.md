# Plan de Deploy a Staging — TABA2 E2E Test

**Fecha**: 2026-08-05
**Agente**: TABA2_E2E_TEST_STAGING
**Estado**: ESCRITO — NO EJECUTADO. Requiere `I_AUTHORIZE_TABA2_E2E_TEST_STAGING_DEPLOY`.

---

## Identificación del objetivo

| Campo | Valor |
|---|---|
| Nombre | `la-taba-staging` |
| Project ref | `ukxqbgswjlibmnjemrzd` |
| Host DB | `db.ukxqbgswjlibmnjemrzd.supabase.co` |
| Región | `us-east-1` |
| Postgres | 17.6.1.147 |
| Estado | ACTIVE_HEALTHY |
| Creado | 2026-07-30 |
| Organización | `qdhfqytbvgpvhxbbcomv` |
| Linked localmente | **No** (`supabase/.temp/project-ref` ausente) |

**Otro proyecto en la cuenta (NO TOCAR)**: `la-taba-demo` / `yakhtrkukqlgzvxuvhzs` / creado 2026-05-31.

**Ausencia de producción**: la cuenta CLI autenticada expone exactamente **2** proyectos. Ninguno se llama `prod`, `production` ni `live`. El riesgo de impactar producción desde esta cuenta es estructuralmente nulo: no existe tal proyecto.

**Estado actual de staging (medido en lectura, 2026-08-05)**:
- Edge Functions desplegadas: **0** (`{"functions":[]}`)
- Secrets configurados: **0** (`{"secrets":[]}`)

Consecuencia: **todo despliegue de función es un alta, no una actualización**. No hay versión previa a la cual revertir; el rollback de una función es `delete`, no `restore`.

---

## Regla de bloqueo de compra

**Ninguna compra Mercado Pago (ni de test) puede ejecutarse mientras no se cumplan las cuatro condiciones:**

1. `HOSTED_PG_CRON_GATE=PASS` (Fase 4)
2. Las 8 Edge Functions respondiendo sanas (Fase 5)
3. Webhook firmado validado extremo a extremo (Fase 8)
4. Procedimiento de cleanup preparado y probado en seco (Fase 9)

Si cualquiera queda en `SKIP`, `NOT_RUN`, `PARTIAL` o `FAIL` → **la Fase 10 no se solicita**.

---

## Fase 1 — Baseline (solo lectura, sin mutación)

**Objetivo**: fotografiar staging antes de tocarlo.

| Acción | Comando | Estado |
|---|---|---|
| Funciones desplegadas | `supabase functions list --project-ref ukxqbgswjlibmnjemrzd` | ✅ MEDIDO: 0 |
| Nombres de secretos | `supabase secrets list --project-ref ukxqbgswjlibmnjemrzd` | ✅ MEDIDO: 0 |
| Baseline de migraciones | `supabase migration list --project-ref ukxqbgswjlibmnjemrzd` | ⏳ PENDIENTE — requiere password de DB |
| Conteo de filas de negocio | `select count(*) from orders; select count(*) from payment_intents;` | ⏳ PENDIENTE |
| LT-0030 presente e intacto | `select id, status from orders where public_code='LT-0030';` | ⏳ PENDIENTE |

**Aborto**: si el baseline de migraciones no puede leerse, **no avanzar** — aplicar migraciones sin conocer el punto de partida es inaceptable.

**Rollback**: no aplica (fase de solo lectura).

---

## Fase 2 — Backup / readiness

**Objetivo**: tener un punto de retorno antes de la primera escritura.

1. Confirmar que existe backup automático reciente del proyecto (panel Supabase → Database → Backups).
2. Dump lógico de resguardo del esquema y de las tablas de pago:
   `pg_dump "$STAGING_DATABASE_URL" --schema-only -f baseline-schema-$(fecha).sql`
   (la connection string viaja **solo** por variable de entorno; nunca en `argv`)
3. Registrar el timestamp exacto del backup en la matriz de gates.

**Aborto**: sin backup verificable → no avanzar.

**Rollback**: no aplica.

---

## Fase 3 — Migraciones

**Objetivo**: llevar el esquema de staging al del RC.

**Inventario**: 38 migraciones en el RC, 35 en el baseline `b6d27da`. **3 nuevas, todas `A` (added), 0 modificadas, 0 borradas.** Validador estático: `node scripts/validate-supabase-migrations.mjs` → **exit 0, "Revisión estática aprobada"**, 8 INFO (columnas de política no resolubles estáticamente), 0 errores.

| Migración | Líneas | Naturaleza | Riesgo |
|---|---|---|---|
| `20260801040000_rider_gps_tracking_gate2.sql` | 856 | Aditiva + `SET NOT NULL` + índice único | **ALTO — ver R1** |
| `20260803120000_mercadopago_staging_worker_scheduler.sql` | 166 | Extensiones + cron + trigger | **MEDIO — ver R2** |
| `20260803140000_payment_recovery_p0.sql` | 348 | Funciones + índice parcial | **MEDIO — ver R3** |

### R1 — Riesgo de ORDEN (el más serio del deploy)

`20260801040000` tiene timestamp **anterior** a 20 migraciones ya presentes en el baseline. Pero la migración baseline `20260802104000_rider_location_receipt_revision.sql` **depende de columnas que gate2 agrega** (`order_revision`, `captured_at`) — su propio comentario dice que `rider_locations.order_revision` ya era `NOT NULL` en el esquema desplegado. Es decir: el entorno donde se certificó RC1 **ya tenía el efecto de gate2**; el archivo se había borrado del repo y `a8fabff` lo restauró.

**Verificación obligatoria antes de `db push`**:
```sql
select version from supabase_migrations.schema_migrations
where version in ('20260801040000','20260802104000') order by version;
```
- Si **ambas** figuran → nada que hacer, gate2 ya está aplicada.
- Si figura `20260802104000` pero **no** `20260801040000` → **DETENER**. Aplicar gate2 ahora la correría fuera del orden con que fue diseñada, y su `ALTER COLUMN order_revision SET NOT NULL` (sin default) puede fallar contra filas escritas antes del fix. Resolver con `supabase migration repair --status applied 20260801040000` **sólo** tras confirmar que las columnas ya existen y no hay nulls:
  ```sql
  select count(*) from rider_locations where order_revision is null;  -- debe dar 0
  ```

Nota adicional: gate2 hace `CREATE UNIQUE INDEX` **sin** `CONCURRENTLY` sobre `rider_locations(sequence)` → toma `ACCESS EXCLUSIVE lock`. En staging (bajo volumen) es rápido; no replicar el patrón en producción. También hace `REVOKE ALL` sobre `rider_locations`: es un cambio de contrato (acceso sólo por RPC `SECURITY DEFINER`), no de datos.

### R2 — pg_cron / pg_net requieren habilitación a nivel de proyecto

`CREATE EXTENSION IF NOT EXISTS pg_cron` **puede fallar** en Supabase gestionado si el proyecto no tiene la extensión pre-cargada (`shared_preload_libraries`). No se controla desde SQL.

**Verificación previa** (panel Supabase → Database → Extensions, o):
```sql
select name, installed_version from pg_available_extensions
where name in ('pg_cron','pg_net','supabase_vault');
```
Si `pg_cron` no está disponible → habilitarlo en el panel **antes** del `db push`, o la Fase 3 aborta.

### R3 — Checksum de `payment_recovery_p0.sql`

Este archivo fue **editado en el lugar** por el commit `4caa1f1` (no vía migración nueva). El fix corrige un bug real de SQL: `nullif(left(btrim(...), 200))` — un solo argumento, inválido — a `nullif(left(btrim(...), 200), '')`.

Si algún entorno aplicó la versión rota antes del fix, `supabase migration list` reportará *"migration history does not match"*. **Verificar antes del push**; si hay mismatch, resolver con `supabase migration repair`, nunca forzando.

### Unidad atómica crítica

`20260803120000_mercadopago_staging_worker_scheduler.sql` + `_shared/payment-runtime.ts` + `_shared/payment-worker-signature.ts` **son un único cambio** (commit `a552925`): mueven la autenticación del worker de secreto plano a HMAC-SHA256 con timestamp+nonce.

**Consecuencia obligatoria**: Fases 3 y 5 se completan en la misma ventana. Si se aplica la migración sin desplegar las funciones (o viceversa), el worker no autentica y el `payment_outbox` se acumula sin drenarse. No hay pérdida de datos (los jobs quedan `pending`/`retry_wait` con `next_attempt_at`), pero sí *stall* de reconciliación.

Comando:
```
supabase db push --project-ref ukxqbgswjlibmnjemrzd
```

**Precondiciones**: secretos de Vault `taba_payment_worker_url` y `taba_payment_worker_hmac_secret` cargados. Si faltan, `dispatch_payment_outbox_worker` es un **no-op silencioso** — el cron corre y no despacha nada.

**Aborto**:
- R1, R2 o R3 sin resolver → no ejecutar.
- Cualquier migración que falle → detener; no forzar, no `--include-all` a ciegas.
- Si `db push` propone borrar objetos → **detener y revisar manualmente**.

**Rollback**:
- No hay `down migration` en este repo. El rollback real es restaurar desde el backup de la Fase 2.
- Ninguna de las 3 nuevas tiene `DROP TABLE`/`DROP EXTENSION` destructivo; el riesgo dominante es R1 y la desincronía con la Fase 5, no la pérdida de datos.

---

## Fase 4 — HOSTED_PG_CRON_GATE (gate remoto obligatorio)

**Es el primer gate que sólo puede correrse contra hosted.** Localmente es irreproducible: `pg_cron` es de una sola base por clúster (`cron.database_name`, por defecto `postgres`), y el arnés local (`scripts/run-mercadopago-local-db.mjs`) crea una base efímera `taba2_mp_verify_<pid>` donde `cron.schedule()` cae fuera de la base vigilada.

El gate tiene **dos mitades y ambas deben pasar**:

### 4a — El job de cron existe y está activo
```sql
select jobname, schedule, active, command
from cron.job
where jobname = 'taba-payment-outbox-worker';
```
Esperado: exactamente 1 fila, `schedule = '30 seconds'`, `active = true`,
`command = 'select public.dispatch_payment_outbox_worker(''cron'');'`

### 4b — La suite de ciclo de vida pasa contra staging
```bash
# STAGING_DATABASE_URL exportada desde el gestor de secretos, nunca en argv
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/mercadopago_checkout_pro.local.sql
echo "exit=$?"   # 0 = las 21 aserciones pasaron
```

**Naturaleza de la suite** (verificada): 163 líneas, **21 aserciones** por `raise exception` en un `do $$ ... $$` de PL/pgSQL. **No es pgTAP** — no declara `plan()`, no emite TAP. El veredicto se lee del **exit code de psql**, no de salida TAP. Por eso `supabase test db` es la herramienta equivocada para esta suite.

**Seguridad para correrla en staging**: todo el archivo está envuelto en `begin;` (línea 3) … `rollback;` (línea 163). Escribe en `auth.users`, `businesses`, `catalog_assets`, `products`, `business_payment_settings` y, vía RPC, en `payment_intents`, `inventory_reservations`, `orders` y recibos de webhook — pero **nada persiste** si se ejecuta en una sola sesión.

**Condiciones obligatorias de ejecución**:
- Una sola sesión de extremo a extremo (`psql -f`, nunca múltiples `-c`).
- Conexión **directa puerto 5432**, no el pooler de transacciones (6543).
- Verificación posterior de que no quedó residuo:
  `select count(*) from businesses where slug = 'mp-lifecycle-fixture';` → debe dar **0**.

**Aborto**: `HOSTED_PG_CRON_GATE` distinto de `PASS` → **la Fase 10 queda cancelada**. No hay excepción.

**Rollback**: la suite se auto-revierte. Si el chequeo de residuo da ≠ 0, limpiar manualmente esa fixture antes de continuar.

---

## Fase 5 — Edge Functions

**Objetivo**: desplegar las 8 funciones. Todas son alta (staging tiene 0).

| Función | verify_jwt | Notas |
|---|---|---|
| `mercadopago-webhook` | **false** | Valida HMAC de MP por su cuenta |
| `mercadopago-payment-worker` | **false** | Valida HMAC propio (timestamp+nonce+firma) |
| `mercadopago-create-preference` | true (default) | |
| `mercadopago-create-checkout-session` | true (default) | |
| `mercadopago-checkout-status` | true (default) | |
| `mercadopago-cancel-payment` | true (default) | Exige frase literal de confirmación |
| `mercadopago-refund` | true (default) | Exige frase literal de confirmación |
| `fiscal-artifact-access` | true (default) | Fuera del alcance MP |

```
supabase functions deploy --project-ref ukxqbgswjlibmnjemrzd
```

**Aborto**: si `verify_jwt` de `mercadopago-webhook` o `mercadopago-payment-worker` quedara en `true`, el webhook de MP y el cron fallarían con 401 → verificar `config.toml` antes de desplegar.

**Rollback**: `supabase functions delete <nombre> --project-ref ...`. No hay versión previa (staging estaba en 0). El rollback deja el sistema sin esa función, no en un estado anterior.

---

## Fase 6 — Secrets de test

**Objetivo**: cargar credenciales **exclusivamente de prueba**.

Nombres requeridos (valores nunca en chat, nunca en `argv`, nunca en Git):

| Nombre | Clasificación | Consumidor |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | SECRETO — debe ser **TEST** | create-preference, cancel, refund, worker |
| `MERCADOPAGO_WEBHOOK_SECRET` | SECRETO | mercadopago-webhook |
| `PAYMENT_WORKER_SECRET` | SECRETO — clave HMAC | payment-runtime (worker) |
| `PAYMENT_LOG_HASH_SALT` | SECRETO | rate-limit / hashing |
| `MERCADOPAGO_ENVIRONMENT` | Config — debe ser `test` | todas las MP |
| `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | Config/gate | providerEnvironment |
| `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` | Config/gate | **dejar SIN setear** |
| `TABA_CHECKOUT_BASE_URL` | Config | back_urls |
| `TABA_ALLOWED_ORIGINS` | Config | CORS |

Además, en **Vault** (no en secrets de función): `taba_payment_worker_url`, `taba_payment_worker_hmac_secret` — este último debe coincidir **bit a bit** con `PAYMENT_WORKER_SECRET`, o el worker rechazará todo despacho del cron.

**Aborto — verificación dura antes de continuar**:
- `MERCADOPAGO_ENVIRONMENT` ≠ `test` → **detener**.
- Access Token que no empiece con prefijo de test → **detener**.
- `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` seteado → **detener** (habilita smoke de pago real).

**Rollback**: `supabase secrets unset <NOMBRE> --project-ref ...`.

---

## Fase 7 — RC web

**Objetivo**: publicar el frontend del RC apuntando a staging.

- Build desde `PRODUCT_E2E_HEAD` (ver reporte de trazabilidad).
- Runtime config con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` de staging.
- **Verificado**: `js/` no contiene ninguna referencia a `ACCESS_TOKEN`, `SERVICE_ROLE`, `WEBHOOK_SECRET`, `PAYMENT_WORKER_SECRET` ni `HASH_SALT`. El Access Token no puede llegar al navegador por construcción.

**Aborto**: si el bundle publicado contuviera cualquier secreto → detener y purgar.

**Rollback**: despublicar / revertir al artefacto anterior.

---

## Fase 8 — Webhook de test

**Objetivo**: probar que un webhook **firmado** llega, valida y se persiste.

1. Configurar `notification_url` en la app de test de MP → `https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook`
2. Verificar HTTPS (la función rechaza explícitamente esquemas no `https:`).
3. Enviar una notificación de prueba desde el panel de MP.
4. Confirmar en DB:
   ```sql
   select event_type, processing_status, attempt_count
   from payment_webhook_receipts order by created_at desc limit 5;
   ```
5. Probar el camino negativo: firma inválida → `401 INVALID_WEBHOOK` y **sin** encolar en `payment_outbox`.

**Aborto**: si una firma inválida es aceptada → **detener todo**. Es un fallo de seguridad, no un bug de integración.

**Rollback**: revertir `notification_url`.

---

## Fase 9 — Smoke sin compra

**Objetivo**: recorrer todo lo que no implique mover dinero de test.

- Storefront staging carga, catálogo real, sin catálogo demo.
- Login de comprador de prueba.
- Carrito + checkout hasta **antes** de crear la preferencia.
- Panel de negocio accesible.
- `select count(*) from cron.job_run_details where jobname='taba-payment-outbox-worker'` muestra corridas y sin errores acumulados.
- **Preparar y ensayar en seco el cleanup**: script que borra pedido QA, libera reservas de stock, revierte ajuste de stock del producto QA y cierra sesión de prueba.

**Aborto**: cualquier dato humano o LT-0030 alterado → detener y restaurar.

**Rollback**: ejecutar el cleanup ensayado.

---

## Fase 10 — Autorización de compra Mercado Pago test

**No se solicita hasta que las Fases 1–9 estén en verde.**

Requisitos previos, todos verificados y registrados:
- [ ] `HOSTED_PG_CRON_GATE=PASS`
- [ ] 8/8 funciones sanas
- [ ] Webhook firmado validado (camino positivo y negativo)
- [ ] Cleanup ensayado
- [ ] Fixture QA sembrada — requiere `I_AUTHORIZE_E2E_QA_FIXTURE_SEED`
- [ ] `MERCADOPAGO_ENVIRONMENT=test` confirmado
- [ ] Baseline de exactly-once tomado (conteos previos de preferencia/pago/pedido)

Recién entonces se solicita: `I_AUTHORIZE_MERCADOPAGO_TEST_PURCHASE`

---

## Criterios transversales de aborto

Detener el plan **en cualquier fase** si:
- Se detecta acceso a un proyecto que no sea `ukxqbgswjlibmnjemrzd`.
- Aparece cualquier credencial de producción o dinero real.
- LT-0030 resulta modificado.
- Aparecen datos humanos en cualquier fixture.
- Un secreto se imprime en log, `argv`, artefacto o Git.
- ARCA/AFIP se activa en cualquier forma (WSAA, WSFE, CAE, QR fiscal) — debe permanecer completamente deshabilitado.
