# Lanzamiento comercial de La Taba: procedimientos

24/10/2026. Actualiza el [plan del 23/10](../mercadopago-final-20261023/lanzamiento/PLAN-DE-LANZAMIENTO.md) con las herramientas de esta rama: donde el plan decía «adaptar la herramienta de QA a producción», ahora existe la herramienta. Cada paso marcado **[AUTORIZACIÓN]** espera la decisión de su titular. Nada de esto se ejecutó contra producción: el proyecto no existe.

## 1. Infraestructura y configuración de producción

| Pieza | Decisión / valor | Estado |
|---|---|---|
| Proyecto Supabase | plan Pro, `sa-east-1`, organización acordada (no la de QA) — **[AUTORIZACIÓN D1]** | a crear |
| Registro | `deploy/environments.json` (`production.status`: `not_provisioned` → `provisioned` → `active`) | listo; binding con `scripts/production/bind-production.mjs` |
| Sitio | Cloudflare Pages `la-taba`, rama `main`, origen `https://la-taba.pages.dev` hasta tener dominio (**D2**) | proyecto existe; hoy sirve una versión contra una base borrada |
| Mercado Pago | aplicación **La Taba Delivery `7677852968049976`** (dueño: cuenta real), Checkout Pro / Preferencias, PKCE, permisos `read`, `write`, `offline_access`; redirección `https://<ref>.supabase.co/functions/v1/mercadopago-oauth-callback`; webhook `https://<ref>.supabase.co/functions/v1/mercadopago-webhook` con eventos Pagos y Vinculación de aplicaciones | sesión del dueño **[AUTORIZACIÓN]** |
| Correo de Auth | SMTP propio y remitente (sin esto no hay recuperación de contraseña del Panel) | **[AUTORIZACIÓN]** alta del proveedor |

### Secretos (sólo nombres: los valores van por entrada oculta, nunca por chat, repositorio ni logs)

| Dónde | Nombre | Origen | Quién lo repone |
|---|---|---|---|
| Edge | `MERCADOPAGO_CREDENTIAL_MODE=oauth`, `MERCADOPAGO_ENVIRONMENT`/`MERCADOPAGO_OAUTH_ENVIRONMENT`/`TABA_DEPLOYMENT_ENV=production`, `MERCADOPAGO_OAUTH_PROJECT_REF`, `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_OAUTH_PANEL_URL`, `TABA_CHECKOUT_BASE_URL`, `TABA_ALLOWED_ORIGINS` | los escribe `configurar-oauth-produccion.mjs` desde el registro | ingeniería |
| Edge | `MERCADOPAGO_CLIENT_SECRET` | **renovado** en la app (el del 6/10 se expuso en una salida de diagnóstico) | dueño de la app + `configurar-oauth-produccion.ps1` |
| Edge | `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` | clave del webhook de producción | ídem |
| Edge | `MERCADOPAGO_TOKEN_ENCRYPTION_KEY`, `PAYMENT_LOG_HASH_SALT` | se generan una vez; **copia de la clave en custodia D4** (sin ella las conexiones de vendedores no se abren) | ingeniería |
| Edge + Vault | `PAYMENT_WORKER_SECRET`, `taba_payment_worker_hmac_secret`, `taba_payment_worker_url` | `sincronizar-worker-hmac.mjs --target=production --apply` | ingeniería |
| Edge | `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` | interruptor de plataforma | sólo en el paso 5 |
| Edge | `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` | **la última llave** del cobro real | sólo en el paso 5 |
| Nunca | `MERCADOPAGO_ACCESS_TOKEN` global | — | las herramientas fallan si aparece |
| GitHub (repo) | `SUPABASE_PUBLISHABLE_KEY` (publicable), `CLOUDFLARE_API_TOKEN` (sólo Pages: Edit), `CLOUDFLARE_ACCOUNT_ID` | — | Marco |
| PC de operación | `TABA2 E2E:PRODUCTION DB PASSWORD`, `…PRODUCTION BACKUP ENCRYPTION KEY`, `…PRODUCTION SUPABASE SECRET KEY` / `…PUBLISHABLE KEY` (usuario = ref) | Administrador de credenciales | Marco |

## 2. Pipeline de despliegue seguro

Orden fijo: **PR → CI verde del SHA exacto → merge → despliegue manual del mismo SHA**.

1. `ci.yml` («Validate release candidate») corre en PR a `main` y en `release/**`: chequeos estáticos, higiene, secretos, pruebas unitarias y de contrato, webhook, E2E completo en Chromium y WebKit, migraciones y pgTAP con restauración aislada.
2. Base y funciones: `scripts/production/deploy.mjs` (guardia: registro, organización paga, región, salud, marca de la base; escribir exige `--confirm <ref>`).
3. Sitio: `Deploy production` (sólo `workflow_dispatch`, escribiendo `la-taba`): exige proyecto en el registro **antes** de construir, CI verde del SHA, que el SHA sea la punta de `main`; deriva el runtime-config del registro; el escáner rechaza cualquier ref que no sea producción; el smoke espera la propagación y exige el proyecto del registro.
4. Ningún flujo despliega solo: los demás despliegues dependen de una variable con el SHA exacto.

## 3. Migraciones y reversión

| Paso | Comando | Evidencia |
|---|---|---|
| Respaldo previo | `node scripts/production/backup.mjs --tools <bin> --ca <crt> --out <nuevo>` | manifiesto con hashes |
| Ensayo | `node scripts/production/deploy.mjs rehearse --migration <archivo> [--tap <prueba>]` | `passed_and_rolled_back` |
| Cron activos | `node scripts/production/deploy.mjs schedulers` | lista anotada |
| Aplicar | `node scripts/production/deploy.mjs migrations --apply --confirm <ref> --evidence <archivo>` | libro con versión y SHA |
| Funciones que cambiaron | `deploy.mjs functions <lista> --apply --confirm <ref>` | versión desplegada |
| Reactivar | `deploy.mjs schedulers --enable <los anotados> --confirm <ref>` | lista igual a la anotada |
| Verificar | `deploy.mjs gates` y la prueba de la migración | 13 activas, rechazos, worker 401/401 |

Reversa: `docs/migrations/rollback/<migración>.rollback.sql` (las de esta rama traen la suya y está probado que restauran la función byte a byte), y el respaldo para lo que no sea una función. Una migración aplicada **no se edita**: se corrige con una nueva.

## 4. Checklist de seguridad antes de abrir

- [ ] Client Secret de La Taba Delivery **renovado** (conservando el Client ID) y cargado por entrada oculta.
- [ ] `verificar-configuracion.mjs --ref=produccion --esperado=disabled` antes del cobro de control; webhook sin firma → 401; 6 firmas falsas → 6/6 401; preflight CORS 204 sólo con el origen de producción.
- [ ] `deploy.mjs gates`: las 13 funciones rechazan lo no autenticado; worker 401 sin firma y con firma falsa.
- [ ] Aislamiento entre comercios con sesiones reales (`verify-tenant-isolation.mjs` adaptado al proyecto; en QA 28/28 con dueño A, dueño B, comprador y anónimo).
- [ ] Asesor de seguridad de Supabase: **0 errores**. Las advertencias de QA (6 RPC `SECURITY DEFINER` ejecutables por `anon`: seguimiento público, contacto público del comercio, disponibilidad, sonda del vigía, acceso a pedido; ~160 ejecutables por `authenticated` con su chequeo de rol adentro; políticas que alcanzan a usuarios anónimos) son de diseño y están cubiertas por las pruebas de aislamiento; revisarlas otra vez en producción.
- [ ] Auth: contraseñas de 12+ y HIBP, rotación de refresh tokens, `site_url` y redirecciones exactas del dominio; SMTP propio.
- [ ] Cuentas con acceso (Supabase, Cloudflare, GitHub, Mercado Pago Developers): sólo titulares, con 2FA.
- [ ] Respaldo de producción tomado y **restaurado** localmente (`local-restore-drill.mjs --environment production`); clave en custodia separada (D4).
- [ ] El repositorio es **público**: ninguna evidencia con datos personales, rutas locales o claves (`npm run check` incluye higiene y escaneo de secretos).
- [ ] `la-taba.pages.dev` sirviendo el sitio nuevo (o retirado) antes de difundir cualquier enlace.

## 5. Primer cobro real controlado **[AUTORIZACIÓN de Walter: importe y producto (D5)]**

Precondiciones: pasos 1–4 cerrados; Walter conectó **su** cuenta (Panel → Mercado Pago → Conectar) y «Verificar» no muestra más bloqueo que «cobro apagado»; `ops-pulse.mjs --target production` sin avisos.

1. Cargar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` y `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION`.
2. `node scripts/mercadopago/cobro-negocio.mjs encender --target=production --business=<uuid> --confirmar=<slug> --revision-aprobada`.
3. **Un** pago real con retiro en local, un producto sin alcohol, el importe que fije Walter, con una tarjeta propia. Si algo falla antes de crear el pago, se junta la evidencia y **no se reintenta**.
4. Verificar en este orden: pago aprobado con el cobrador correcto → webhook firmado **ruteado al comercio** (cierra R-MKT-1: integrador ≠ vendedor) → un pedido y un movimiento de stock → mismo estado en Panel y cliente → cola vacía (`ops-pulse`).
5. Si el webhook respondiera 503: el pago no se pierde (el barrido del proveedor arma el pedido), pero se apaga el cobro (`cobro-negocio.mjs apagar`) y no se abre hasta corregirlo.

## 6. Primer reembolso real controlado **[AUTORIZACIÓN de Walter (D5)]**

1. Sobre el pago del paso 5: Panel → Pagos → «Devolver el dinero» → importe vacío (= todo), motivo, escribir `DEVOLVER` → «Devolver el dinero».
2. Si responde `REFUND_REJECTED` (la API nunca se pudo certificar en prueba: `REEMBOLSOS-API.md`), devolver desde la cuenta de Walter («Devolver dinero») y verificar que La Taba lo concilia como `origin: external`, una sola vez (probado en QA).
3. En los dos casos: el pedido queda señalado por «Pedido con el pago devuelto que sigue abierto» → Pedidos → «Cancelar con motivo» (el stock vuelve si no salió) → la alerta se cierra sola (probado en QA con `LT-0087`).
4. Registrar: request id del proveedor, importe, estado final del pago, pedido y stock.

## 7. Monitoreo y alertas

| Capa | Qué vigila | Quién se entera | Estado |
|---|---|---|---|
| Barrido de alertas (cron, cada minuto) | pago sin pedido, compras sin verificar, discrepancias, pedidos sin aceptar o demorados, pedido reembolsado abierto, procesamiento de pagos frenado, cuenta de Mercado Pago que no puede cobrar, cron que falla | el Panel (centro de operación, bandeja, timbre); con gravedad que separa «frená» de «para tu información» | en QA, medido |
| Vigía de GitHub (`scheduler-watchdog`) | que el barrido siga corriendo; que el sitio publicado y la variable apunten al proyecto del registro | **correo de GitHub al dueño del repositorio** cuando falla | listo; hoy en espera (sin proyecto) |
| Vigía de Cloudflare (`services/scheduler-watchdog`) | lo mismo, cada 5 min | registros del Worker | preparado, **sin desplegar** (decisión de Marco) |
| `ops-pulse.mjs --target production` | pedidos trabados, cobros, cola, webhooks rechazados, stock, alertas abiertas | el operador | listo para producción |
| `backup-freshness.mjs` | respaldo de más de 26 h | el operador / la tarea programada | listo |

**Hueco**: las alertas críticas sólo se ven con el Panel abierto (no hay correo ni notificación push). Opciones sin costo: el timbre del Panel abierto en el local, o correo a Walter cuando exista el SMTP (D/C4). Durante los primeros 30 cobros, `ops-pulse --hours 2` después de cada pago (`PLAN-DE-LANZAMIENTO.md` F7).

## 8. Plan de rollback (de lo más fino a lo más grueso)

| Nivel | Acción | Efecto | Probado |
|---|---|---|---|
| 1 | `cobro-negocio.mjs apagar --target=production --business=<uuid> --confirmar=<slug>` | el comercio deja de ofrecer Mercado Pago; efectivo sigue; historial intacto; reencender sin reconectar | staging 6/6, pgTAP 16 |
| 2 | borrar `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` | ninguna preferencia real se crea en toda la plataforma | por código |
| 3 | borrar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | todo el runtime productivo de pagos falla cerrado (503) | por diseño |
| 4 | Panel → Mercado Pago → Desconectar | borra la credencial del vendedor | staging 16/16 |
| 5 | funciones del SHA anterior (`deploy.mjs functions … --apply`) y reversa de la última migración | código y esquema anteriores | reversas probadas en local |
| 6 | sitio: «Rollback» del despliegue anterior en Cloudflare Pages o `Deploy production` con el SHA anterior | interfaz anterior | Pages conserva despliegues |
| 7 | restauración desde respaldo (`RESPALDOS-Y-RECUPERACION.md` §5) | recuperación de datos | capa de datos ensayada (15–40 s); plataforma sin ensayar |

Apagado inmediato (nivel 1, y 2 si no alcanza) ante: pago al vendedor equivocado; pago sin pedido que no se puede rearmar; pedido pagado sin pago; cobro o reembolso duplicado; firma inválida aceptada; stock corrupto; credencial expuesta; binding incorrecto.
