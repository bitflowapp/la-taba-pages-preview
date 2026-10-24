# Entornos de La Taba: desarrollo, QA y producción

24/10/2026. Rama `release/commercial-readiness-20261023` (apilada sobre #149). Nada de esto creó proyectos, tocó la producción existente ni movió dinero.

## 1. Lo que hay hoy (verificado en vivo, sólo lectura)

| Pieza | Estado | Cómo se verificó |
|---|---|---|
| Proyecto Supabase de **producción** de La Taba | **No existe** | Listado de proyectos de la sesión del CLI (23/10 23:46 UTC): la organización «La Taba» sólo tiene `la-taba-recovery-test`; Luna Systems tiene `bitflow-production` (otro producto) |
| Proyecto de **QA** `ixewllzzuzpqrkxzmfzx` | `ACTIVE_HEALTHY`, plan Free, sa-east-1, 172 migraciones | Management API |
| Cinco proyectos anteriores de La Taba | **Borrados**: `wwcpogltfgzgkrlilbcd` (producción), `ucbtjcurawxjwjdvvcvj` (staging del piloto), `tkanbadcglszlcyfjvpv` (producción controlada), `ukxqbgswjlibmnjemrzd` (staging original), `yakhtrkukqlgzvxuvhzs` (demo) | Ausentes del listado y `<ref>.supabase.co` sin DNS (NXDOMAIN) |
| `https://la-taba.pages.dev` (Cloudflare Pages `la-taba`, rama `main`) | Sirve **v144** (`cd26834b`, 07/10) con un `runtime-config.js` que apunta a `wwcpogltfgzgkrlilbcd` (**borrado**): la tienda pública no puede cargar nada | `version.json` y `runtime-config.js` públicos |
| `https://taba2-staging.pages.dev` (rama de producción del proyecto `taba2-staging`) | Sirve **v114** (23/09) apuntando a `ucbtjcurawxjwjdvvcvj` (**borrado**) | ídem |
| Preview de QA `https://recovery-20261020.taba2-staging.pages.dev` | Detrás de la puerta Basic Auth (401 sin credencial) | `version.json` → 401 |
| Vigía «Scheduler watchdog» (GitHub Actions, `main`) | **Falla en cada corrida** desde el 21/10: lee el runtime-config de `la-taba.pages.dev` y llama a un proyecto que no existe; GitHub manda un correo por corrida | `gh run list` + log |

Proyectos ajenos a La Taba que ninguna herramienta debe tocar: `enznqfzhikpasjzpvjfd` (Bit Flow), `zvmfdlynnutxquktrgyl` (APEX), `udftddjacdsinscehlke` (Estela).

## 2. La separación de entornos

| | Desarrollo | QA | Producción |
|---|---|---|---|
| Base | PostgreSQL local descartable (127.0.0.1:55440, bases `taba_local_*`, sustitutos de cron/net/Vault) | `ixewllzzuzpqrkxzmfzx`, organización «La Taba» (Free) | **a crear** (decisión D1): plan de pago, organización acordada, sa-east-1 |
| Web | servidor local `http://127.0.0.1:8080` | preview `recovery-20261020` del proyecto Pages `taba2-staging`, con puerta | proyecto Pages `la-taba`, rama `main` (dominio: decisión D2) |
| Mercado Pago | simulado | **TestApp-ae01fd1d `4861627125869370`** (dueño = vendedor de prueba), dinero ficticio | **La Taba Delivery `7677852968049976`** (dueño = cuenta real), dinero real |
| Herramientas | `scripts/local-db/*`, `tests/db/*` | `scripts/recovery/*` atadas al recibo `deploy/recovery-free-hosted.json` | `scripts/production/*` y los guiones `production-*`, atados a `deploy/environments.json` |
| Puede tocar | sólo `taba_local_*` en loopback | sólo el proyecto del recibo, organización Free, presupuesto 0 | sólo el proyecto de producción del registro, organización paga, con `--confirm <ref>` para escribir |

Cada herramienta rechaza los otros entornos: las de QA tienen `BLOCKED_REFS`/`RECOVERY_FORBIDDEN_REFS`; las de producción, `forbiddenRefsFor('production')` (QA + retirados + ajenos); el binding de las funciones exige que **todas** las variables de entorno coincidan con el binding de su ref; el navegador no acepta un piloto que apunte a QA, a producción ni a un proyecto retirado.

## 3. El registro único: `deploy/environments.json`

Una sola fuente para los tres entornos, los refs retirados y los ajenos. La lee `scripts/lib/environments.mjs`, que **valida en cada lectura** (no sólo en las pruebas):

- ningún ref aparece en dos entornos ni es a la vez activo y retirado o ajeno;
- QA sólo mueve dinero ficticio; producción y QA no comparten aplicación de Mercado Pago ni organización;
- producción no puede estar en el plan gratuito;
- mientras `production.status` sea `not_provisioned`, **toda herramienta de producción sale con código 2 y un mensaje claro, sin leer credenciales ni tocar la red** (`PRODUCTION_NOT_PROVISIONED`).

Las pruebas usan un registro con una producción **ficticia** activa (`tests/fixtures/environments.production-active.json`, ref `tabaprodfixturerefaa`, que no existe). La variable `TABA_ENVIRONMENTS_FILE` sólo acepta archivos dentro de `tests/fixtures/`: un registro alternativo en otro lugar sería una forma de apuntar las herramientas a otra base sin PR.

## 4. Qué se corrigió de las referencias a proyectos borrados

| Grupo | Antes | Ahora |
|---|---|---|
| Armado y publicación del sitio (`build-production-runtime-config`, `deploy/preparar-artefacto`, `scan-production-artifacts`, `deploy/verificar-publicado`, `build-release-manifest`, `assert-production-supabase-target`) | Ref fijo en el proyecto borrado: el paquete se armaba contra una base inexistente y **sólo el smoke, después de publicar**, lo notaba. La clave publicable se tomaba del sitio publicado (la del proyecto borrado) | Destino desde el registro; sin proyecto, salen 2 antes de armar nada. La clave del sitio publicado sólo se acepta si ese sitio ya apunta al proyecto del registro. El escáner del paquete marca **cualquier** ref que no sea producción (antes sólo el staging original: el QA actual podía viajar sin aviso) |
| Flujo `deploy-production.yml` | Construía y publicaba igual | Nuevo primer paso: `node scripts/production/target.mjs`; sin proyecto, corta antes de construir |
| Vigía de GitHub (`scheduler-watchdog`) | Fallaba cada corrida y mandaba un correo por corrida | `vigiaDeProduccion`: sin proyecto queda **en espera** (sale 0 con aviso, y avisa que el sitio publicado apunta a un retirado); con proyecto, es incidente que el sitio o la variable `SUPABASE_URL` apunten a otro lado |
| Vigía de Cloudflare (`services/scheduler-watchdog/wrangler.toml`) | Default → staging borrado; producción → producción borrada | Default → QA; producción → centinela `produccion-sin-proyecto.invalid` hasta el binding |
| Guiones de verificación, auditoría y Auth de producción (`production-*`, `verify-production*`, `audit-production-security`, `harden-production-auth`) y de catálogo/comercial/venta real (20 archivos) | Ref fijo; rechazaban cualquier ref nuevo | Destino desde el registro; QA/retirados/ajenos rechazados por nombre; salen 2 sin proyecto |
| Operación de Mercado Pago (`sincronizar-worker-hmac`, `configurar-oauth-produccion` + `.ps1`, `actualizar-client-secret-produccion` + `.ps1`, `cobro-negocio`, `verificar-configuracion`) | Tablas con los tres proyectos borrados | Producción desde el registro (los `.ps1` leen el ref con `scripts/production/target.mjs` antes de pedir un secreto); staging y producción controlada se rechazan como **retirados**; `verificar-configuracion` ganó `--ref=qa`; `cobro-negocio` acepta las claves nuevas `sb_secret_` de un proyecto creado ahora |
| Navegador (`js/core/runtime-config.js`) | Lista de aislamiento del piloto sin el QA actual | `PILOT_FORBIDDEN_SUPABASE_REFS` incluye QA (y el binding agrega producción) |

**Lo que queda a propósito con refs retirados**, y por qué no es un riesgo:

- `DEPLOYMENT_BINDINGS` en `supabase/functions/_shared/seller-oauth.ts` conserva las entradas de los cuatro proyectos retirados: son **fijos de las pruebas Deno** (`npm run test:webhook`) y están inertes (un ref de Supabase no se reutiliza y ninguno resuelve). `tests/environments-registry.test.mjs` exige que todo binding sea de un ref retirado o del de producción del registro.
- Listas de bloqueo (`RECOVERY_FORBIDDEN_REFS`, `BLOCKED_REFS`, pilotos): mantener un ref retirado bloqueado es la defensa correcta.
- Herramientas **históricas** de operaciones pasadas (`scripts/aplicar-*.mjs`, `scripts/controlled-production/*`, `scripts/e2e-staging/*`, `scripts/primer-pedido-humano/*`, certificaciones de staging): no participan del lanzamiento y fallan por DNS si alguien las corre. El flujo `deploy-staging-pilot.yml` sólo corre si la variable `STAGING_DEPLOY_SHA` tiene ese SHA (hoy, nunca).
- `scripts/release-v5/*` y `release-edge-production.yml`: protocolo de **una sola vez** para actualizar en vivo el proyecto viejo (interlock `private.a1_a4_release_control_v5` con `check (project_ref='wwcp…')`). Un proyecto nuevo se construye completo desde las migraciones, como QA; ese protocolo **no se usa** para el lanzamiento. El interlock queda inerte en cualquier base nueva.
- Documentación histórica (`*.md` de la raíz, `docs/audit/*` de fechas anteriores): registro de lo que pasó.

## 5. Activación de producción (cuando exista el proyecto)

Orden obligatorio; cada paso tiene su evidencia antes del siguiente.

1. **[AUTORIZACIÓN D1]** Crear el proyecto (Luna Systems, plan Pro, `sa-east-1`). Anotar ref y organización.
2. **Binding** (un PR):
   ```
   node scripts/production/bind-production.mjs --ref <ref> --organization <org> --plan pro --verify-remote      # plan, sólo lectura
   node scripts/production/bind-production.mjs --ref <ref> --organization <org> --plan pro --verify-remote --write
   npm test && npm run test:webhook
   ```
   Escribe el registro (`provisioned`), el binding de La Taba Delivery en `seller-oauth.ts`, el bloqueo del ref en QA y en el piloto, la nueva identidad de caché, el reloj de Cloudflare y la app Rider. PR con CI verde del SHA exacto, revisión humana, merge.
3. **Base**: `node scripts/production/deploy.mjs bootstrap --apply --confirm <ref> --evidence <archivo>` (exige proyecto vacío; crea la marca de producción y el libro; aplica las migraciones con SHA; deja el negocio cerrado, los cobros apagados y los cron en pausa).
4. **Funciones**: `node scripts/production/deploy.mjs functions all --apply --confirm <ref>` y `node scripts/production/deploy.mjs gates` (13 activas, todas rechazan lo no autenticado, worker 401/401).
5. **Secretos** (valores sólo por entrada oculta; ver `LANZAMIENTO.md` §1): renovar el Client Secret de La Taba Delivery, `scripts/mercadopago/configurar-oauth-produccion.ps1`, `node scripts/mercadopago/sincronizar-worker-hmac.mjs --target=production --apply`; `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` y `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` sólo en el cobro de control.
6. **Cron**: `node scripts/production/deploy.mjs schedulers --enable taba-checkout-expiry-sweep,taba-checkout-provider-truth-sweep,taba-operational-alerts-sweep,taba-payment-outbox-worker --confirm <ref>` (los de QA no van: `taba-qa-window-expiry` es propio de QA; `taba-security-retention-sweep` purga límites de tasa de más de 1 día, recibos de webhook con firma inválida de más de 14 días y usuarios anónimos inactivos de más de 30 días; se crea inactivo y en QA sigue apagado: encenderlo en producción es una decisión de retención de datos).
7. **Auth**: SMTP propio y URL del sitio (`scripts/harden-production-auth.mjs`, ensayo por defecto).
8. **Catálogo**: precios y productos validados por Walter (`catalog/opening/OWNER-INPUT.md`); nada de demo.
9. **Sitio**: secreto `SUPABASE_PUBLISHABLE_KEY` del proyecto nuevo y `Deploy production` (manual, con confirmación) → el smoke exige el proyecto del registro.
10. **Abrir**: PR que pasa `production.status` a `active` cuando Walter autoriza abrir. Recién ahí el vigía de producción vigila.

## 6. Actualizaciones y rollback de producción

| Cambio | Cómo | Reversa |
|---|---|---|
| Migración nueva | respaldo cifrado → `deploy.mjs rehearse --migration <archivo> [--tap <prueba>]` → `deploy.mjs migrations --apply --confirm <ref>` → funciones que cambiaron → `schedulers --enable` de los que estaban activos | `docs/migrations/rollback/<migración>.rollback.sql` (cada migración de esta rama trae la suya, probada) y, si hiciera falta, el respaldo |
| Funciones | `deploy.mjs functions <lista> --apply --confirm <ref>` desde el SHA mergeado | volver a desplegar desde el SHA anterior |
| Sitio | `Deploy production` (manual) | Cloudflare Pages conserva los despliegues: «Rollback» al anterior, o volver a correr el flujo con el SHA anterior |

Cada `migrations --apply` pausa **todos** los `taba-*` a propósito (un esquema nuevo no corre antes que sus funciones): anotar cuáles estaban activos con `deploy.mjs schedulers` antes, y reactivar exactamente esos.

## 7. Cloudflare Pages

| Proyecto | Qué sirve | Qué hacer | Quién |
|---|---|---|---|
| `la-taba` (producción) | v144 contra una base borrada | **Antes de cualquier difusión**: publicar el sitio nuevo cuando exista el proyecto (paso 9), o mientras tanto la página de mantenimiento **ya preparada** en `deploy/maintenance/` (neutra, `noindex`, y con un worker que retira la v144 de los teléfonos que la tienen instalada; comando y vuelta atrás en su README). No se publicó: es producción existente | Marco (autorización) |
| `taba2-staging` rama de producción `staging` | v114 contra una base borrada (`taba2-staging.pages.dev`) | Retirarla o reemplazarla por un aviso: es una tienda con marca La Taba que no funciona | Marco (autorización) |
| `taba2-staging` rama `recovery-20261020` | QA con puerta | Mantener la puerta; publicar ahí cada candidato antes de producción | ingeniería |

El dominio propio (D2) no existe: la cuenta de Cloudflare no tiene zonas. Mientras tanto el origen productivo es `https://la-taba.pages.dev`; cambiarlo es pasar `--origin` al binding.
