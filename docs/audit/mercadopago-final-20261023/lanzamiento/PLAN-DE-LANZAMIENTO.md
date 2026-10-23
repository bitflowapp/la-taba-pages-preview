# Plan de lanzamiento comercial de La Taba — cobros reales con Mercado Pago

23/10/2026. Complementa a [`MATRIZ-GO-NO-GO.md`](MATRIZ-GO-NO-GO.md). Ninguna acción de este plan se ejecutó: no se creó infraestructura, no se tocó ninguna base de producción, no se cobró nada real. Cada paso con **[AUTORIZACIÓN]** requiere decisión expresa de su titular.

## 0. Hechos que condicionan todo el plan

Verificados hoy en modo lectura:

1. **No existe un proyecto de producción de La Taba.** La cuenta de Supabase sólo muestra `la-taba-recovery-test` (`ixewllzzuzpqrkxzmfzx`, plan **Free**, de pruebas) para La Taba. Los proyectos productivos anteriores (`wwcpogltfgzgkrlilbcd`, `tkanbadcglszlcyfjvpv`) ya no aparecen.
2. **Los datos de negocio recuperados son sólo el catálogo**: 72 productos privados, sin `business_id`, sin activos comerciales. Cero usuarios Auth, pedidos, pagos ni objetos de Storage. Producción arranca con base nueva más catálogo.
3. **El código está atado a los proyectos que ya no existen**: `DEPLOYMENT_BINDINGS` (`seller-oauth.ts`) sólo conoce los refs viejos; `release-edge-production.yml` exige confirmar `wwcpogltfgzgkrlilbcd`; los scripts `release:edge:production` y `release:edge:dry-run` de `package.json` llevan ese ref; la lista de aislamiento de pilotos de `js/core/runtime-config.js` nombra los refs viejos (el nuevo debe agregarse para que ningún piloto apunte a producción); `compatibility.json` del release sigue sin re-baseline. Un proyecto nuevo **no puede cobrar** hasta que su ref se agregue al binding de producción (por diseño: es una defensa, no un descuido).
4. **El sitio público `la-taba.pages.dev` sigue sirviendo la versión v144 y su `runtime-config.js` apunta a `https://wwcpogltfgzgkrlilbcd.supabase.co`**, el proyecto que ya no existe (lectura pública verificada hoy). Hay que reemplazarlo o retirarlo antes de cualquier difusión.
5. Mercado Pago de producción es una aplicación **real** (`La Taba Delivery`, `7677852968049976`). Los cambios de esta rama exigen que su dueño sea una cuenta real; la guarda lo comprueba.

## 1. Decisiones y autorizaciones previas

| # | Decisión | Titular |
|---|---|---|
| D1 | Crear el proyecto de producción en un plan de pago (cobros reales no pueden vivir en Free: pausa por inactividad, sin copias gestionadas) y quién lo factura. El recibo de costo del repo (`scripts/launch/target.mjs`) prevé organización Luna Systems, plan Pro, USD 10/mes de cómputo; falta la autorización vigente | Luna Systems |
| D2 | Dominio público y proyecto de Cloudflare Pages de producción (`la-taba` hoy) | Marco / Walter |
| D3 | RPO y RTO aceptados (propuesta: RPO ≤ 24 h, RTO ≤ 4 h; el RTO real se mide en el ensayo F5, hoy no hay medición) | Walter |
| D4 | Destino de la copia externa y custodio **separado** de la clave de cifrado | Marco |
| D5 | Importe y producto del cobro real de control; si se prueba el reembolso real | Walter |
| D6 | Facturación electrónica: hoy `ARCA_PRODUCTION: NO`. Si se vende sin comprobante fiscal es una decisión legal/contable, no técnica | Walter y su contador |
| D7 | Rollout: 5 → 15 → 30 clientes (la capacidad de 30 está certificada para este diseño) | Walter |

## 2. Fases

### F1 — Cerrar lo que QA todavía debe demostrar (sin infraestructura nueva)

| Paso | Detalle | Evidencia de salida |
|---|---|---|
| F1.1 | Hallazgos de la revisión independiente: corregidos o aceptados por escrito | [`REVISION-INDEPENDIENTE.md`](REVISION-INDEPENDIENTE.md) |
| F1.2 | **Verificación de marketplace con un segundo vendedor** (R-MKT-1/2/3), o decidir cubrirla con el canary F6 | [`VERIFICACION-MARKETPLACE.md`](VERIFICACION-MARKETPLACE.md) |
| F1.3 | Preguntar a Mercado Pago por los reembolsos por API de prueba (no bloquea) | [`REEMBOLSO-401.md`](REEMBOLSO-401.md) §6 |
| F1.4 | PR #148 y #149 revisados y listos; decidir si se mergean antes o junto con producción | GitHub |

### F2 — Proyecto de producción **[AUTORIZACIÓN D1]**

1. Crear el proyecto (región `sa-east-1`, plan de pago) en la organización acordada. Anotar su `ref`.
2. **PR de binding** (único cambio de código que depende del ref): agregar el ref a `DEPLOYMENT_BINDINGS` con `paymentEnvironment: production`, `clientId: 7677852968049976`, URLs de panel y checkout del dominio D2; agregar el ref a `RECOVERY_FORBIDDEN_REFS`/`BLOCKED_REFS` para que nunca sirva de QA; reapuntar `release-edge-production.yml` (confirmación del ref), los dos scripts `release:edge:*` de `package.json` y los secretos `TABA_A1_A4_DATABASE_URL` y `TABA_DATABASE_CA_PEM`; agregar el ref a la lista de aislamiento de pilotos de `js/core/runtime-config.js` (este archivo está precacheado: exige subir `CACHE_NAME` y volver a firmar la identidad de release); **re-baseline** de `scripts/release-v5/compatibility.json`. CI verde del SHA exacto.
3. Aplicar las 170 migraciones al proyecto vacío (herramienta `bootstrap-hosted.mjs` adaptada a producción o `db push`), con el ensayo previo `rehearse-migration.mjs` sobre una base local. Cron, `net` y Vault: crear y verificar los trabajos (`taba-payment-outbox-worker` cada 30 s, barridos de vencimiento, verdad del proveedor, alertas).
4. Cargar el catálogo: reimportar los 72 productos con su `business_id`, imágenes, derechos y precios validados por Walter (el importador `import-commercial-catalog.mjs --catalogo produccion`). Subir las imágenes a Storage (los bytes **no** están en ningún respaldo).
5. Auth: SMTP propio, URLs de redirección, política de contraseñas; crear el dueño de La Taba (Walter) y los roles. **Ninguna cuenta heredada: hay cero usuarios históricos.**
6. Desplegar las 13 Edge Functions con `verify_jwt` según `config.toml` y comparar byte a byte con el release.

### F3 — Configuración de producción de Mercado Pago **[AUTORIZACIÓN D5 y sesión del dueño de La Taba Delivery]**

Secretos de Edge Functions (sólo nombres; los valores nunca pasan por chat, repositorio ni logs):

| Variable | Valor / origen |
|---|---|
| `MERCADOPAGO_CREDENTIAL_MODE` | `oauth` |
| `MERCADOPAGO_ENVIRONMENT`, `MERCADOPAGO_OAUTH_ENVIRONMENT`, `TABA_DEPLOYMENT_ENV` | `production` |
| `MERCADOPAGO_OAUTH_PROJECT_REF` | ref del proyecto nuevo |
| `MERCADOPAGO_CLIENT_ID` | `7677852968049976` |
| `MERCADOPAGO_CLIENT_SECRET` | credenciales de producción de la app (entrada oculta). **Renovarlo antes de cargarlo**: el del 6/10 se expuso en una salida de diagnóstico y `docs/operacion/mercadopago-production-readiness-20261006.md` deja la renovación pendiente (manteniendo el Client ID; si Mercado Pago propusiera cambiarlo, detenerse) |
| `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` | clave secreta del webhook **de producción** de esa app |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY`, `PAYMENT_LOG_HASH_SALT` | generados una vez; **respaldar la clave de cifrado: sin ella los tokens de los vendedores del dump no sirven** |
| `PAYMENT_WORKER_SECRET` + Vault `taba_payment_worker_hmac_secret` y `taba_payment_worker_url` | `sincronizar-worker-hmac.mjs --target=<producción> --apply` |
| `MERCADOPAGO_OAUTH_PANEL_URL`, `TABA_CHECKOUT_BASE_URL`, `TABA_ALLOWED_ORIGINS` | del dominio D2 |
| `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | `approved` (interruptor de plataforma) |
| `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` | **la última llave**: sin ella ninguna preferencia de producción se crea. Se carga sólo al arrancar F6 |
| Nunca | `MERCADOPAGO_ACCESS_TOKEN` global; la herramienta falla si aparece |

En la app **La Taba Delivery** (sesión del dueño, MFA propia): URL de redirección OAuth del proyecto nuevo (conservar o retirar las viejas), PKCE sí, permisos `read`, `write`, `offline_access`; webhook productivo con la URL `…/functions/v1/mercadopago-webhook` y eventos **Pagos** y **Vinculación de aplicaciones**. Revisar en la misma pantalla que el producto sea Checkout Pro / API de Preferencias.

Antes de conectar a Walter, con el Client Secret ya renovado, correr una vez la lectura del dueño de la aplicación (`client_credentials` + `/users/me`, la misma que hace la guarda; `qa-mp-integrator-identity.mjs` adaptado al secreto de producción): el dueño **no** debe llevar la etiqueta `test_user`.

Verificaciones de salida de F3: webhook sin firma → 401; con 6 firmas falsas → 6/6 401; preflight CORS 204 con el origen de producción; `verify` del primer vendedor devuelve `integrator_environment_matches: true` (si dijera `false`, la app no pertenece a una cuenta real: **detenerse**).

### F4 — Pruebas mínimas **sin dinero** en producción

| Prueba | Criterio |
|---|---|
| Humo cerrado: 12 casos sin sesión ni firma | 0 aceptados |
| Webhook falsificado ×6 | 6/6 → 401 |
| `opening:check` | `TECHNICAL_READY: YES` |
| Worker firmado: sonda sin trabajo | HTTP 200, `claimed 0` |
| Pago manual (efectivo) completo: pedido → preparación → entrega | pedido único, stock una vez |
| Pulso operativo (`ops-pulse.mjs`) | sin avisos P0/P1 |
| Auth y roles: dueño, encargado, empleado, rider; aislamiento entre comercios | pgTAP/E2E de aislamiento |
| Rollback del paso F8 ensayado | `apagar` y reencender sin reconectar |

### F5 — Respaldos y recuperación **[AUTORIZACIÓN D3 y D4]**

1. Copias gestionadas del plan de pago (retención del plan) **más** un `pg_dump` cifrado propio (AES-256-GCM, `postgres-backup.mjs`) cada 6 h durante la apertura y diario después; copia **fuera de la PC** (destino D4) con recibo (`prepare-offsite-backup.mjs`); `backup-freshness.mjs` alarma si pasan 26 h.
2. Clave de cifrado de respaldos y `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` en custodia **separada** del respaldo. Inventario de secretos con quién los repone.
3. **Ensayo de restauración** sobre un proyecto/base aparte: `verify-postgres-restore.mjs` (tablas, RLS, funciones, permisos, publicación) y **medir el tiempo** → ése es el RTO real. Repetir mensualmente.
4. Lo que el respaldo **no** cubre y se repone aparte: bytes de Storage (imágenes), Vault/cron/Auth administrados, secretos de Edge, configuración de Cloudflare y de la app de Mercado Pago.

### F6 — Cobro real de control y apertura **[AUTORIZACIÓN D5 y de Walter]**

1. Walter conecta **su** cuenta (Panel › Mercado Pago › Conectar). Debe quedar exactamente una conexión `connected` y «Verificar» sin bloqueos distintos de «cobro apagado».
2. Cargar `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` y encender sólo ese negocio: `cobro-negocio.mjs encender … --confirmar=<slug> --revision-aprobada`.
3. **Un pago real de control** (retiro, un producto sin alcohol, importe fijado por Walter): una sola vez; si falla antes de crear el pago, se junta la evidencia y no se reintenta. Orden de verificación: pago aprobado con el cobrador correcto → recibo del webhook firmado **y ruteado al comercio** (cierra R-MKT-1) → un solo pedido y un solo movimiento de stock → mismo estado en Panel y cliente → cola vacía.
4. **Reembolso de control** (si D5 lo incluye): primero desde el Panel (API); si responde `REFUND_REJECTED`, se devuelve desde la cuenta de Walter («Devolver dinero») y se comprueba que La Taba lo concilia como `origin: external`, una sola vez (ya demostrado en QA).
5. Apertura escalonada 5 → 15 → 30 clientes; para pasar de etapa: ningún P0/P1 financiero, pulso sin avisos, cada pago con webhook firmado, un pedido y un movimiento de stock, reembolsos conciliados.

### F7 — Controles posteriores

| Cuándo | Qué |
|---|---|
| Cada pago, primeros 30 | `ops-pulse.mjs --hours 2`: `webhookRejected 0`, `outboxDue 0`, `outboxDead 0`, `paidWithoutOrder 0` |
| Cada día, 7 días | pagos del día en Mercado Pago frente a pedidos en La Taba (el barrido del libro ya los compara; revisar `payment_discrepancies` abiertas); frescura del respaldo; alertas del Centro de operación |
| Semanal | restauración de prueba; vencimiento del token del vendedor (`MP_SELLER_TOKEN_EXPIRING`); rotación pendiente de secretos |
| Siempre | `MP_PAID_WITHOUT_ORDER`, `MP_REFUND_RECONCILIATION`, `MP_OUTBOX_STALLED`, `MP_SELLER_CANNOT_CHARGE` atendidas el mismo día |

## 3. Procedimiento operativo para el comercio (hay que enseñarlo)

- **Devolver el dinero no cancela el pedido ni repone stock.** En QA el pedido `LT-0087` siguió `received` tras el reembolso. El encargado cancela el pedido en el Panel y repone el stock si corresponde.
- **Pago pendiente** (`in_process`, p. ej. contingencia): sin pedido hasta que se apruebe; la reserva dura la sesión (15 min) y el worker sigue el pago. No cobrar de nuevo.
- **Pago aprobado sin pedido**: Panel › Pagos › «Consultar a Mercado Pago» › «Armar el pedido». Nunca cobrar de nuevo.

## 4. Rollback (de lo más fino a lo más grueso)

| Nivel | Acción | Efecto | Probado |
|---|---|---|---|
| 1 | `cobro-negocio.mjs apagar --confirmar=<slug>` | el comercio deja de ofrecer Mercado Pago; efectivo sigue; historial intacto; reencender sin reconectar | Staging 6/6 y pgTAP 16 |
| 2 | Borrar `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` | ninguna preferencia de producción puede crearse en toda la plataforma | por código (`requireRealPaymentSmokeAuthorization`) |
| 3 | Borrar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | todo el runtime productivo falla cerrado (503), incluido el consentimiento | por diseño documentado |
| 4 | Panel › Desconectar | borra la credencial del vendedor, apaga el cobro | Staging 16/16 |
| 5 | Re-desplegar la versión anterior de las funciones | restaura el código previo; las migraciones tienen reversión en `docs/migrations/rollback/` | CI |
| 6 | Restaurar desde respaldo (F5) | recuperación de datos | **a ensayar** |

Criterios de apagado inmediato (P0): pago al vendedor equivocado; pago sin pedido que no se puede rearmar; pedido pagado sin pago; cobro o reembolso duplicado; firma inválida aceptada; stock corrupto; credencial expuesta; binding incorrecto.

## 5. Orden de ejecución propuesto

`F1` ahora (no cuesta nada) → decisiones D1–D7 → `F2` → `F3` → `F4` → `F5` en paralelo con `F4` → `F6` → `F7`. El camino crítico es **D1 (crear el proyecto) y la sesión del dueño de La Taba Delivery**; todo lo demás se puede preparar antes.
