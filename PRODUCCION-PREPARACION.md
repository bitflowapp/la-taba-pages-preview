# Producción · todo lo previo, listo para ejecutar

**Decisión tomada:** `la-taba-staging` (`ukxqbgswjlibmnjemrzd`) **queda como
staging**. Producción será un proyecto Supabase **nuevo**.

**Este documento no crea nada.** Es el inventario completo, el procedimiento
exacto y el checklist. La creación del proyecto requiere autorización explícita.

---

## 1 · Qué hay hoy en staging (medido, no supuesto)

### Proyecto

| | |
|---|---|
| ref | `ukxqbgswjlibmnjemrzd` · `la-taba-staging` |
| organización | `qdhfqytbvgpvhxbbcomv` |
| región | `us-east-1` |
| Postgres | 17.6.1.147 (engine 17, canal ga) |
| estado | `ACTIVE_HEALTHY` |
| backups | **WAL-G activo · PITR DESACTIVADO · 0 backups físicos listados** |

Existe además `yakhtrkukqlgzvxuvhzs` (`la-taba-demo`), **INACTIVE**. No se toca.

### Extensiones que el esquema exige

`pg_cron` · `pg_net` · `pgcrypto` · `supabase_vault`

### Forma del esquema (sobre las 73 migraciones del repo)

| | |
|---|---|
| funciones `SECURITY DEFINER` | 255 |
| `set search_path` | 289 — cubre todas las definer |
| `enable row level security` | 87 |
| `create policy` | 93 |
| `revoke …` | 256 |

Los `revoke` importan tanto como los `grant`: hay migraciones tempranas que
otorgan `select on businesses to anon` y migraciones posteriores que lo revocan.
**El estado final de las 73 es el correcto** — verificado contra la base viva:
`orders` devuelve `[]` por RLS y `businesses`, `payment_attempts`,
`operational_alerts`, `fiscal_documents` y `rider_locations` dan 401.

### Edge Functions

| Función | En staging | En el repo |
|---|---|---|
| `mercadopago-payment-worker` | v14, `verify_jwt=false` | ✅ |
| `mercadopago-webhook` | v13, `verify_jwt=false` | ✅ |
| `mercadopago-create-checkout-session` | v11, `verify_jwt=false` | ✅ |
| `mercadopago-create-preference` | v13, `verify_jwt=false` | ✅ |
| `mercadopago-checkout-status` | v12, `verify_jwt=false` | ✅ |
| `mercadopago-refund` | v2, `verify_jwt=true` | ✅ |
| `mercadopago-cancel-payment` | **NO DESPLEGADA** | ✅ |
| `fiscal-artifact-access` | **NO DESPLEGADA** | ✅ |

Las dos que faltan hay que decidirlas explícitamente para PROD, no arrastrar el
olvido.

### Secretos — sólo los NOMBRES (ningún valor fue leído)

Los 14 que hay que volver a crear en PROD, **con valores nuevos y propios**:

```
MERCADOPAGO_ACCESS_TOKEN        ← productivo, distinto del de staging
MERCADOPAGO_ENVIRONMENT         ← 'production'
MERCADOPAGO_WEBHOOK_SECRET      ← productivo
PAYMENT_LOG_HASH_SALT           ← nuevo, no reutilizar el de staging
PAYMENT_WORKER_SECRET           ← nuevo
TABA_ALLOWED_ORIGINS            ← el dominio de PROD
TABA_CHECKOUT_BASE_URL          ← el dominio de PROD
SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEYS SUPABASE_SECRET_KEYS SUPABASE_JWKS SUPABASE_DB_URL
                                ← los inyecta la plataforma
```

Falta a propósito, y **debe seguir faltando hasta el día del cobro real**:

```
MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved
```

Sin él, `providerEnvironment()` **tira** si el entorno es `production`. Esa es la
red de seguridad, y funciona.

---

## 2 · Clasificación de los datos: qué se lleva y qué no

| Dato | A PROD | Motivo |
|---|---|---|
| Esquema completo (73 migraciones) | **SÍ** | es la definición del sistema |
| Catálogo de productos | **SÍ, re-importado** | precios y stock los confirma Walter, no se copian de staging |
| Negocio (`businesses`) | **SÍ, reconfigurado** | dirección, horarios, zona, envío y mínimo son datos de Walter |
| Pedidos | **NO** | ninguno |
| `checkout_sessions`, `payment_attempts`, `payment_outbox` | **NO** | historia de pruebas |
| `operational_alerts`, `operational_sweep_runs` | **NO** | arrancan vacías |
| `fiscal_documents`, `pos_sales` | **NO** | están en cero y así se quedan |
| Usuarios de Auth | **NO** | staff y riders se crean nuevos en PROD |

### Un hallazgo que obliga a lo anterior

En staging hay **42 pedidos con `origin='production'`** (25 cancelados, 16
entregados, 1 asignado) que **no son de clientes reales**: repiten los mismos
totales sintéticos ($3.726 y $3.075) y recorren su ciclo en segundos. Hoy hay 9
creados sólo el 11-ago.

O sea: **en staging el campo `origin` ya no distingue un pedido real de un
ensayo.** Es exactamente por esto que PROD arranca con la tabla de pedidos
vacía; si se copiara, el primer pedido real nacería contaminado.

---

## 3 · Procedimiento de creación (para ejecutar CON autorización)

```bash
# 0 · autorización explícita del dueño. Sin esto no se empieza.

# 1 · crear el proyecto (misma organización, misma región que staging)
supabase projects create la-taba-produccion \
  --org-id qdhfqytbvgpvhxbbcomv --region us-east-1 --db-password '<nueva, fuerte>'
#    guardar esa password en $TABA_SECRETS, nunca en el repo

# 2 · enlazar el worktree al proyecto nuevo
supabase link --project-ref <REF_NUEVO>

# 3 · las 73 migraciones sobre una base VACÍA, en orden
supabase db push
#    verificar que ninguna quede pendiente:
supabase migration list --linked

# 4 · secretos (los 7 propios; los SUPABASE_* los pone la plataforma)
supabase secrets set --project-ref <REF_NUEVO> --env-file <archivo fuera del repo>
#    MERCADOPAGO_ENVIRONMENT=test al principio. Producción recién en el paso 9.

# 5 · las 8 Edge Functions, incluidas las dos que en staging faltan
for f in mercadopago-payment-worker mercadopago-webhook \
         mercadopago-create-checkout-session mercadopago-create-preference \
         mercadopago-checkout-status mercadopago-refund \
         mercadopago-cancel-payment fiscal-artifact-access; do
  supabase functions deploy $f --project-ref <REF_NUEVO>
done

# 6 · PITR y backups (staging los tiene a medias: activarlos ANTES del primer pedido)
#     PITR se habilita en el panel; requiere plan que lo soporte.

# 7 · catálogo y negocio, con los datos que confirme Walter
#     nunca copiando de staging

# 8 · runtime-config de PROD (ver sección 4) y despliegue del frontend

# 9 · recién acá, Mercado Pago productivo:
#     MERCADOPAGO_ENVIRONMENT=production
#     MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved
#     y el checkpoint humano del dueño
```

---

## 4 · `runtime-config` de producción

El del repo es una plantilla vacía que **falla cerrado**. El de PROD se genera en
el despliegue y **nunca se commitea**. Forma exacta:

```js
globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    supabaseUrl: 'https://<REF_NUEVO>.supabase.co',
    publishableKey: '<la publicable de PROD>',
    businessId: '<el uuid del negocio en PROD>',
    deploymentEnvironment: 'production',   // ← acá sí
    pollMs: 5000,
  },
};
```

Validarlo antes de publicar, sin subirlo al repo:

```bash
TABA_RUNTIME_CONFIG_PATH=<ruta fuera del repo> npm run config:check
```

**Control obligatorio después de cada deploy** (es el error que deja el sitio sin
arrancar):

```bash
curl -s https://<dominio-prod>/runtime-config.js | sha256sum
```

Tiene que dar el hash del archivo de PROD, no el del template.

---

## 5 · Frontend y Rider: dos entornos, sin cruce

| | staging | producción |
|---|---|---|
| Frontend | Cloudflare Pages `taba2-staging`, rama `staging` | proyecto/rama nuevos + dominio propio |
| `deploymentEnvironment` | `staging` | `production` |
| Rider Android | `com.lataba.rider.staging` | `com.lataba.rider` |
| Backend del Rider | ref de staging en el flavor | `TABA_PRODUCTION_*` + `controlledPilotApproved` |

El flavor `production` del Rider **hoy compila con backend vacío**: exige
`TABA_PRODUCTION_BACKEND_PROJECT_REF`, `TABA_PRODUCTION_SUPABASE_URL`,
`TABA_PRODUCTION_PUBLISHABLE_KEY` y `TABA_PRODUCTION_BUSINESS_ID`, y valida que
la URL sea exactamente `https://$ref.supabase.co`. Se completan cuando exista el
ref de PROD.

---

## 6 · Observabilidad en PROD desde el día cero

Lo que en staging quedó a medias no debe repetirse:

1. El barrido de alertas se activa con las migraciones (`pg_cron`). Verificar con
   la sonda anónima `scheduler_heartbeat()` que responda `healthy:true`.
2. **Los dos relojes externos**, que en staging siguen sin correr:
   - Cloudflare Worker `services/scheduler-watchdog/` (cron 5 min);
   - GitHub Actions `.github/workflows/scheduler-watchdog.yml` (cron 10 min, y
     **avisa por correo**).
3. **PITR encendido antes del primer pedido real.**

---

## 7 · Rollback

| Capa | Cómo se vuelve atrás |
|---|---|
| Frontend | re-promover el deployment anterior en Cloudflare Pages |
| `runtime-config` | restaurar el archivo preservado y verificar por sha256 |
| Edge Functions | `supabase functions deploy` de la versión anterior |
| Base | PITR (hay que encenderlo) o backup físico |
| Mercado Pago | quitar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` → vuelve a fallar cerrado |

El último es el más importante: **se puede apagar el cobro real con una sola
variable**, sin desplegar nada.

---

## 8 · Checklist de promoción

- [ ] Autorización explícita del dueño para crear PROD
- [ ] Proyecto creado, password guardada fuera del repo
- [ ] 73 migraciones aplicadas sobre base vacía, ninguna pendiente
- [ ] Extensiones presentes: `pg_cron`, `pg_net`, `pgcrypto`, `supabase_vault`
- [ ] 8 Edge Functions desplegadas (las 6 de staging **más las 2 que faltan**)
- [ ] 7 secretos propios cargados; `MERCADOPAGO_ENVIRONMENT=test` todavía
- [ ] PITR activado
- [ ] Catálogo importado con precios confirmados por Walter
- [ ] Las 9 unidades sin precio unitario: resueltas o excluidas
- [ ] Negocio configurado: dirección, **pin verificado a mano**, horarios, zona, envío, mínimo
- [ ] Usuarios de staff y rider creados en PROD
- [ ] `runtime-config` de PROD validado y publicado; hash verificado tras el deploy
- [ ] Sonda `scheduler_heartbeat` en `healthy:true`
- [ ] Los dos relojes externos corriendo
- [ ] Rider `production` compilado con `TABA_PRODUCTION_*`
- [ ] Rollback probado al menos una vez
- [ ] **Recién entonces:** Mercado Pago productivo + checkpoint humano

---

## 9 · Lo que este documento NO hizo

No se creó ningún proyecto. No se activó billing. No se tocó Mercado Pago. No se
movió dinero. No se registró dominio. No se tocó ARCA. No se leyó ni imprimió el
valor de un solo secreto. No se modificó staging.
