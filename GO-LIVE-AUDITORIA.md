# Auditoría go-live TABA2 — estado real

2026-08-11. Todo lo de acá está verificado en esta máquina, o dice explícitamente
que no se pudo verificar y por qué. Sin push, sin deploy, sin mutar backend, sin
imprimir secretos.

---

## 0 · El hecho que ordena todo lo demás

**No existe un entorno de producción.** En todo el repo hay un solo proyecto
Supabase, `ukxqbgswjlibmnjemrzd`, y su propio `runtime-config` LIVE se declara
`deploymentEnvironment: 'staging'`. Mercado Pago está en `environment: test`.

«Aceptar pedidos reales» hoy significa **promover este mismo entorno**: mismo
proyecto, mismas Edge Functions, credenciales de MP productivas y un dominio
propio. Es una decisión que requiere autorización explícita, no una tarea
pendiente.

---

## 1 · HEADs y qué está realmente desplegado

| Qué | Valor |
|---|---|
| Código servido | `1d26c4b` · deployment `8241b56f-532c-41ba-8482-ef96a3299549` |
| Rama que lo contiene | `feature/taba2-commercial-production-hardening` (`a0b230d`) |
| `a0b230d` sobre `1d26c4b` | 2 commits, **sólo documentación y scripts** |
| Artefacto | `la-taba-runtime-v61-cliente-comercial-mapa-permanente` |
| `runtime-config` LIVE | sha256 `57d8a007…` — **idéntico al preservado**, verificado dos veces |
| Rollback | `c184ffb6-325e-44d1-8c2e-3ae245b09d50` (`399d0cc`, v60) |
| Base común | `eda13f8` (`release/taba2-pilot-rc2-operational`) |

### Una trampa que conviene no repetir

Por ancestry, el Panel de recuperación (`0efe1dc`) y el intake/despacho
(`59d8e03`) aparecen **fuera** del commit desplegado. Parecía regresión. No lo
es: su contenido **sí está** en `1d26c4b` —integrado por contenido, no por merge
de la punta—. Verificado símbolo por símbolo (`AUTOMATION_FAILED`,
`PAYMENT_ACTION_OUTCOMES`, `checkout_session_id`…) y con la migración
`20260809220000_resolve_security_review.sql` presente en el árbol desplegado.
**La ancestry sola miente acá.**

### Lo que NO está desplegado, y está bien

| Rama | Fuera | Decisión |
|---|---|---|
| `feature/taba2-automated-rider-dispatch` | 6 commits | Fallback manual vigente → `AUTO-DISPATCH-PLAN-INTEGRACION.md` |
| `feature/taba2-arca-fiscal-automation` | 19 commits | Flujo manual → `FISCAL-PILOTO-MANUAL.md` |

---

## 2 · Gates corridos acá

| Gate | Resultado |
|---|---|
| `npm run check` | **PASS** (sintaxis, assets, precache 88 módulos, higiene, contrato de ubicación) |
| `npm test` | **1324 / 1324**, 0 fallos |
| `npm run test:payments` | **27 / 27** |
| `npm run test:webhook` | **22 Deno + 12 node**, 0 fallos |
| `npm run test:e2e` chromium | **246 passed** |
| `npm run test:e2e` mobile-webkit | **19 passed** |
| `npm run secrets:scan` | **PASS** — sin credenciales de pago ni claves privadas |
| `npm run migrations:validate` | **PASS** (revisión estática) |
| `config:check` sobre el runtime LIVE | **PASS** — `entorno=staging`, host y business correctos |
| `verify-staging-served.mjs` | **118 / 118** entradas del precache idénticas a lo publicado, sin 404 |
| `certify-staging-always-map.mjs` | **SIN FALLAS** contra el sitio público |
| `npm run catalog:readiness:check` | PASS — reporte al día |
| `npm run catalog:prices:check` | PASS — **9 unidades bloqueadas por precio unitario** |
| `catalog:validate` / `catalog:release:validate` | **No ejecutables**: el catálogo real de importación no está en el repo (`data/catalog-template.csv` tiene las 21 columnas y **0 filas**) |
| `test:db:local` | **No ejecutable**: el CLI de Supabase no está instalado |

### Lo que la certificación contra el sitio público demostró

- La app servida corre en modo `production`.
- Mapa presente en los 4 estados (`idle`, `preparing`, `on_the_way`, `delivered`)
  y **el mismo lienzo en los cuatro** (`1 distinto`).
- `negocio=0 rider=0 destino=0 eta=false`: no se inventa nada.
- «ubicación del negocio publicada como verificada: **false**» — el sitio es
  honesto sobre el pin no verificado.
- Cliente recurrente con service worker viejo (`v60`) **migra solo a `v61`**.
- El carrito sobrevive a recargar.

---

## 3 · Seguridad, verificada de forma anónima y sin mutar nada

Con la clave publicable que el propio sitio publica (pública por diseño):

| Recurso | Resultado | Lectura |
|---|---|---|
| Raíz de PostgREST | **401** «Only secret API keys» | introspección cerrada |
| `orders` | 200 pero **`[]`** | RLS no devuelve una sola fila a un anónimo |
| `products` | 200 con datos | correcto: es la góndola pública |
| `businesses` | **401** `42501` | sin grant a anon |
| `payment_attempts` | **401** `42501` | idem |
| `operational_alerts` | **401** `42501` | idem |
| `fiscal_documents` | **401** `42501` | idem |
| `rider_locations` | **401** `42501` | idem |
| `get_public_order_tracking('LT-0030')` | **`null`** | no se puede enumerar pedidos por código |

**No hay filtración anónima de pedidos, pagos, alertas, documentos fiscales ni
posiciones del rider.**

---

## 4 · Observabilidad — verificada viva

La sonda pública `scheduler_heartbeat()` es anónima y de sólo lectura por diseño.
Respondió:

```json
{ "healthy": true, "service": "taba-operational-alerts-sweep",
  "age_seconds": 28, "last_run_at": "2026-08-11T23:19:00Z",
  "stale_after_seconds": 600, "expected_every_seconds": 60 }
```

**El motor de alertas está corriendo.** De las tres capas de detección, dos están
vivas (trigger sobre tráfico real y sonda pública). Las dos externas **no**:

- **Cloudflare Worker** (`services/scheduler-watchdog/`): script subido,
  disparador **no**. Cloudflare lo rechaza con error 10063 — hace falta abrir una
  vez la landing de Workers para que cree el subdominio `workers.dev`. **Un clic
  humano**, después `npx wrangler deploy`. Detección ≤ 15 min.
- **GitHub Actions** (`.github/workflows/scheduler-watchdog.yml`): necesita un
  `push` y un secreto de repositorio. Detección ≤ 20 min, y **avisa por correo**
  cuando falla, que es lo que ninguna otra capa hace.

---

## 5 · Pagos — el código está listo, la cuenta no

Verificado en el repositorio:

- `providerEnvironment()` **tira** si `MERCADOPAGO_ENVIRONMENT=production` sin
  `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`;
- `requireRealPaymentSmokeAuthorization()` exige el literal exacto
  `I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE`;
- `checkoutBaseUrl()` exige HTTPS y rechaza hosts locales;
- credenciales por `getRequiredEnv`, **cero tokens hardcodeados** (`secrets:scan`);
- firma HMAC del webhook implementada en `mercadopago-webhook/index.ts`;
- 8 Edge Functions de pago, incluida `mercadopago-payment-worker` y
  `recover_paid_checkout_order` para pago aprobado sin pedido.

Invariantes de pedido, a nivel esquema: `unique(external_reference)`,
`unique(idempotency_key)` en varias tablas, `check (stock is null or stock >= 0)`,
`products_price_status_check in ('confirmed','pending')`, y `payment_outbox` con
estados hasta `dead_letter`.

**Lo que falta es la cuenta**: vendedora verificada, aplicación sin duplicados,
Access Token y webhook secret productivos como secretos Edge, URLs HTTPS finales
y la review aprobada.

---

## 6 · Clasificación final por componente

| Componente | Estado |
|---|---|
| Storefront | **READY** |
| Panel negocio | **READY** (código; falta smoke con sesión real) |
| Runtime-config / release / rollback | **READY** |
| Contrato de pedidos | **READY** (esquema + 1324 tests + e2e) |
| Seguridad / RLS | **READY** (verificado anónimamente) |
| Observabilidad — barrido | **READY** (vivo) |
| Observabilidad — relojes externos | **NEEDS_CONFIG** (2 clics humanos) |
| Mercado Pago — código | **READY** |
| Mercado Pago — cuenta productiva | **BLOCKER** |
| Tracking público | **READY** |
| Rider — app del piloto | **READY** (`com.lataba.rider.staging` 1.0.0 en el Moto) |
| Rider — build de producción | **BLOCKER** (flavor exige `TABA_PRODUCTION_*` + aprobación) |
| Auto-dispatch | **NO VA AL GO-LIVE** (decidido, con plan) |
| Fiscal / ARCA | **NEEDS_HUMAN_DATA** (flujo manual definido) |
| Catálogo / precios / stock vivos | **NO VERIFICABLE** (viven en la base) |
| Horarios / zona / envío / mínimo | **NO VERIFICABLE** |
| Coordenadas del local | **NEEDS_HUMAN_DATA** (`human_verified=false`) |
| Backend — estado vivo | **NO VERIFICABLE** |

---

## 7 · La raíz de casi todos los bloqueos

`TABA_SECRETS` **no está definida**, el CLI de Supabase **no está instalado**, y
el PAT de management fue borrado. Sin eso no se puede leer la configuración
comercial viva, confirmar migraciones aplicadas, abrir Panel ni Rider, ni correr
`preflight-gate.mjs`.

**No es un problema de código. Es acceso.**

---

## 8 · Lo que no se tocó

Producción, backend, migraciones, ARCA, dinero real, `LT-0030`, pedidos humanos,
`runtime-config` LIVE, Cloudflare. Sin push. Sin deploy. Ningún secreto impreso.

Documentos hermanos: `RUNBOOK-PRIMER-PEDIDO-REAL.md`, `RUNBOOK-INCIDENTE.md`,
`FISCAL-PILOTO-MANUAL.md`, `AUTO-DISPATCH-PLAN-INTEGRACION.md`.
Snapshot con hashes: `<ARTIFACTS_ROOT>/taba2-go-live/snapshot-20260811T2318Z/`.
