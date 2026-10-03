# Inventario de despliegue — Edge Functions y secrets

**Fecha**: 2026-08-06
**Autorización**: `I_AUTHORIZE_TABA2_E2E_TEST_STAGING_SERVICES_DEPLOY_NO_PURCHASE`
**Estado**: ⛔ **NADA DESPLEGADO** — fase detenida por dos bloqueadores (ver §5)
**PRODUCT_E2E_HEAD**: `d1829ab0ad3206777b5fb2013e2db8378251e920`

---

## 1. Funciones desplegables

Enumeradas del árbol real, no asumidas. `_shared/` **no** es desplegable: no tiene `index.ts`, se
empaqueta dentro de cada función.

| # | Nombre exacto | Entrypoint | Líneas | `verify_jwt` | ¿Necesaria para el E2E de test? |
|---|---|---|---|---|---|
| 1 | `mercadopago-create-checkout-session` | `index.ts` | 42 | `true` (default) | **Sí** — prepara la sesión; el servidor calcula todo el monto |
| 2 | **`mercadopago-create-preference`** | `index.ts` | 156 | `true` (default) | **Sí** — crea la preferencia de Checkout Pro |
| 3 | `mercadopago-checkout-status` | `index.ts` | 39 | `true` (default) | **Sí** — consulta de estado; usa cliente de usuario (RLS), no service_role |
| 4 | `mercadopago-webhook` | `index.ts` | 122 | **`false`** (explícito) | **Sí** — receptor de notificaciones; valida firma propia |
| 5 | `mercadopago-payment-worker` | `index.ts` | 243 | **`false`** (explícito) | **Sí** — drena el outbox; lo invoca `pg_cron`, no un browser |
| 6 | `mercadopago-cancel-payment` | `index.ts` | 120 | `true` (default) | No para el smoke sin compra |
| 7 | `mercadopago-refund` | `index.ts` | 140 | `true` (default) | No para el smoke sin compra |
| 8 | `fiscal-artifact-access` | `index.ts` | 69 | `true` (default) | **No** — ARCA/fiscal está fuera de alcance y prohibido |

**Nombre real confirmado**: `mercadopago-create-preference`. **No** existe `mercadopago-preference-create`.

**Subconjunto mínimo propuesto para el E2E de test**: las 5 primeras (1-5).
`cancel-payment` y `refund` sólo tienen sentido con un pago existente; `fiscal-artifact-access`
queda excluida por la prohibición expresa de ARCA.

### Detalle operativo

| Función | Invocador | Autenticación | Idempotencia | Escrituras |
|---|---|---|---|---|
| `create-checkout-session` | frontend autenticado | JWT + `requireAuthenticatedUser` | RPC `create_checkout_session` (servidor calcula monto; nunca acepta total/precio del cliente) | `checkout_sessions` vía RPC |
| `create-preference` | frontend autenticado | JWT + `requireAuthenticatedUser` | `payment_attempts.idempotency_key` UNIQUE + `X-Idempotency-Key` hacia MP + reutiliza `init_point` existente + busca por `external_reference` antes de reintentar | `payment_attempts` vía RPC |
| `checkout-status` | frontend autenticado | JWT + cliente **de usuario** (RLS) | sólo lectura | ninguna |
| `webhook` | Mercado Pago | **firma HMAC propia** (SDK oficial + ventana de frescura); exige `https:` | UNIQUE `(provider, environment, webhook_event_id, event_type, resource_id)` + `on conflict do nothing`; duplicado → `processing_status='duplicate'` | `payment_webhook_receipts`, `payment_outbox` |
| `payment-worker` | `pg_cron` / trigger de outbox | **HMAC-SHA256** con timestamp + nonce + ruta canónica | claim/lease sobre `payment_outbox` (lease 90 s) | `payment_outbox` y RPCs de pago |

**Dependencia entre funciones**: ninguna llama a otra por HTTP. El acoplamiento real es
`payment-worker` ↔ migración `20260803120000` (scheduler), que comparten el secreto HMAC.

**Rollback**: staging tiene **0 funciones**, así que todo despliegue es alta. El rollback de
cualquiera es `supabase functions delete <nombre> --project-ref ukxqbgswjlibmnjemrzd`, que devuelve
al baseline exacto. No hay versión previa que restaurar.

---

## 2. Inventario de secrets — derivado del código

Nombres extraídos de todas las referencias `getRequiredEnv(...)` / `Deno.env.get(...)` del árbol.

### A. SUPABASE_BUILT_IN — los provee la plataforma

| Nombre | Usado por |
|---|---|
| `SUPABASE_URL` | todas |
| `SUPABASE_ANON_KEY` | cliente de usuario (RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | cliente de servicio |

No hay que cargarlos: Supabase los inyecta en el runtime de Functions.

### B. MERCADOPAGO_TEST — **deben provenir de Mercado Pago**

| Nombre | Usado por | Estado |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | `_shared/mercadopago.ts` → create-preference, worker, cancel, refund | ⛔ **AUSENTE** |
| `MERCADOPAGO_WEBHOOK_SECRET` | `mercadopago-webhook/index.ts` | ⛔ **AUSENTE** |
| `MERCADOPAGO_ENVIRONMENT` | `providerEnvironment()` | config, debe ser `test` |

La Public Key **no** aparece en ninguna Function: el backend no la necesita. Es config del frontend.

### C. PAYMENT_WORKER — internos, generables criptográficamente

| Nombre | Usado por | Puede generarse |
|---|---|---|
| `PAYMENT_WORKER_SECRET` | `_shared/payment-runtime.ts` (clave HMAC) | **Sí** |
| `PAYMENT_LOG_HASH_SALT` | `hashSensitive` (rate-limit, hash de email) | **Sí** |

Y en **Vault** (no en secrets de función), para que el scheduler pueda despachar:
`taba_payment_worker_url` y `taba_payment_worker_hmac_secret` — este último debe coincidir bit a
bit con `PAYMENT_WORKER_SECRET`.

**Contrato de firma verificado en el código**: manifiesto `${timestamp}.${nonce}.POST./functions/v1/mercadopago-payment-worker`,
timestamp de 10 dígitos, nonce UUID, firma hex de 64 chars, comparación en tiempo constante.
**Ventana anti-replay**: `MAX_AGE_SECONDS = 120`, `MAX_FUTURE_SECONDS = 30`.

### D. FRONTEND_PUBLIC_TEST_CONFIG — sólo valores publicables

`SUPABASE_URL` de staging · `SUPABASE_PUBLISHABLE_KEY` · URLs de Functions · flag de entorno test ·
back URLs de staging.

### E. PROHIBIDOS — verificado que no ocurren

`js/` no contiene ninguna referencia a `ACCESS_TOKEN`, `SERVICE_ROLE`, `WEBHOOK_SECRET`,
`PAYMENT_WORKER_SECRET` ni `HASH_SALT`. El Access Token no puede llegar al navegador por
construcción.

### Otras variables de configuración

`TABA_CHECKOUT_BASE_URL` (back_urls) · `TABA_ALLOWED_ORIGINS` (CORS) ·
`FISCAL_PANEL_ORIGINS` (sólo `fiscal-artifact-access`, fuera de alcance) ·
`MERCADOPAGO_PRODUCTION_REVIEW_STATUS` y `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` (gates de
seguridad; este último debe quedar **sin setear**).

---

## 3. Baseline remoto medido antes de cualquier mutación

| Métrica | Valor |
|---|---|
| Migraciones | **39** (huella `cfb5f7bd935ccbf7a8e59fb69b0b0203`) |
| Edge Functions desplegadas | **0** |
| Secrets configurados | **0** |
| Pedidos / comercios / productos | 31 / 1 / 9 |
| `order_items` / `business_members` | 34 / 14 |
| **`auth.users`** | **99** ← baseline ahora capturado |
| LT-0030 | `arrived` |
| Trigger Rider | intacto |
| `private` | 4 relaciones, 1 snapshot |
| Panel reconciliado | tabla + 9 funciones ✅ |
| `payment_outbox` / `payment_intents` / `payment_attempts` | 0 / 0 / 0 |
| `payment_webhook_receipts` / `checkout_sessions` / `fiscal_documents` | 0 / 0 / 0 |
| Job `taba-payment-outbox-worker` | activo |

---

## 4. Locks

`heavy-compute.lock` **libre**. Presentes sólo tres marcadores ajenos que no se tocan:
`rc1-business-certification-pending.txt`, `rider-staging-smoke-pending.txt`,
`storefront-pending.txt`. No se adquirió lock: no hubo builds pesados (no se desplegó nada).

---

## 5. ⛔ Bloqueadores

### BLOQUEADOR A — credenciales de Mercado Pago TEST ausentes

Nombres faltantes (sólo nombres, sin valores):

```
MERCADOPAGO_ACCESS_TOKEN     (test)
MERCADOPAGO_WEBHOOK_SECRET   (test)
```

Verificado como ausentes en: variables de entorno de proceso, usuario y máquina; `.env`,
`.env.local`, `.env.staging` del worktree; `D:\1212\_secrets`; `C:\Users\marco\.taba-secrets`;
y los secrets del proyecto Supabase (0 configurados).

**Deben provenir de Mercado Pago.** No se inventan, no se generan, no se piden por chat.
`PAYMENT_WORKER_SECRET` y `PAYMENT_LOG_HASH_SALT` sí son internos y se generarían en memoria — no
son bloqueantes por sí solos.

**Consecuencia sobre el guard §5 de la instrucción**: para desplegar hay que *demostrar* que toda
credencial de Mercado Pago pertenece a TEST. Sin credenciales, esa demostración es imposible, así
que el guard no puede darse por cumplido.

### BLOQUEADOR B — `STAGING_WEB_HOST_NOT_CONFIGURED`

El único mecanismo de publicación web del repositorio es
`.github/workflows/preview-pages.yml`:

- se dispara **sólo** por `workflow_dispatch`;
- construye `dist_release` y publica en **GitHub Pages del repositorio**, que tiene **una sola URL**
  — la del preview existente, no un host de staging separado;
- hace `actions/checkout` del ref desde el que se dispara, así que exige que la rama exista **en el
  remoto**.

Y la rama del RC **no existe en el remoto**: `git ls-remote --heads origin release/taba2-e2e-test-staging-rc`
devuelve vacío. Publicar `PRODUCT_E2E_HEAD` exigiría **pushear la rama**, que esta autorización no
concede y las anteriores prohibían expresamente.

No se improvisa un túnel temporal como URL de webhook, según la instrucción.

---

## 6. Qué haría falta para desbloquear

1. **Credenciales MP de test** por un canal seguro (variable de entorno protegida o carga directa a
   `supabase secrets set`), nunca por chat. Requiere una aplicación de **prueba** en Mercado Pago.
2. **Una decisión sobre el hosting**: o se autoriza pushear la rama del RC y usar el workflow de
   Pages —asumiendo que sobrescribe la URL del preview actual—, o se define un host HTTPS de
   staging separado (dominio/proveedor propio), que hoy no existe en el repositorio.

Sin (1) no hay webhook firmado ni Functions operativas. Sin (2) no hay URL HTTPS estable a la cual
Mercado Pago pueda notificar.
