# Producción real: infraestructura y Mercado Pago preparados (Fase 3)

26/10/2026. **No se creó ni contrató nada**: el proyecto de producción no existe (`deploy/environments.json`: `production.status = not_provisioned`) y cada herramienta de producción falla cerrada (`PRODUCTION_NOT_PROVISIONED`, salida 2) hasta que un PR complete el registro con `bind-production.mjs` y la CI quede verde en ese SHA. Clasificación: ✔ implementado y verificado · ◐ preparado, pendiente de activación · ✖ bloqueado por una autorización concreta.

## 1. Infraestructura

| Pieza | Estado | Qué hay y dónde | Qué falta |
|---|---|---|---|
| Proyecto Supabase de producción, **separado de QA** | ✖ | Registro de entornos con regla «un ref pertenece a un solo entorno» y listas de bloqueo de los proyectos retirados; QA (`ixew…`, plan Free) y producción nunca comparten ref, organización ni credenciales | **D1**: crear `la-taba-production` (Pro, `sa-east-1`) — servicio pago, ver §2 |
| Dominio HTTPS | ◐ | `https://la-taba.pages.dev` (HTTPS de Cloudflare Pages, cubre el requisito de SSL de Mercado Pago). Hoy sirve una tienda contra una base borrada (A9) | publicar el sitio nuevo tras D1 o una página de mantenimiento; **D2**: dominio propio (opcional) |
| Funciones Edge | ✔ / ◐ | 13 funciones con `verify_jwt` fijado en `config.toml`; el banco Docker corre las 9 de Mercado Pago tal cual están; `deploy.mjs functions all --apply --confirm <ref>` y `deploy.mjs gates` | desplegar en el proyecto nuevo |
| Migraciones y RLS | ✔ / ◐ | 179 migraciones en el mismo orden que usa la CI (OLD → EXPAND → V5 → posteriores); reversas probadas; todas las tablas con RLS y sin privilegios para `anon`/`authenticated` salvo lo explícito (pgTAP); la del candado del piloto incluida | `deploy.mjs bootstrap --apply --confirm <ref>` |
| Secretos aislados por entorno | ✔ / ◐ | Un binding por proyecto; `verificar-configuracion.mjs` lee los secretos sin mostrarlos; una integradora del entorno equivocado se rechaza antes del consentimiento; ningún `MERCADOPAGO_ACCESS_TOKEN` global (las herramientas fallan si aparece) | cargarlos por entrada oculta (Marco) — **sin** la llave final hasta el día del piloto |
| Respaldos y restauración | ✔ (QA) / ◐ | Respaldo cifrado `backup.mjs`, restauración local medida en 15–40 s de la capa de datos, `backup-freshness.mjs`, plan de tres capas ([`RESPALDOS-Y-RECUPERACION.md`](../commercial-readiness-20261023/RESPALDOS-Y-RECUPERACION.md)) | **D4**: custodia separada de la clave de cifrado y copia fuera de la PC; correr `backup.mjs` + `local-restore-drill.mjs --environment production` sobre el proyecto nuevo antes de abrir |
| Monitorización de fallos financieros | ✔ (QA) / ◐ | Barrido de alertas cada minuto (pago sin pedido, compras sin verificar, discrepancias, cola frenada, vendedor que no puede cobrar), `ops-pulse.mjs`, vigía de GitHub; el piloto agrega `piloto-pago-real.mjs verificar` | **Hueco conocido:** las alertas críticas sólo se ven con el Panel abierto (sin correo ni push) hasta tener SMTP |
| Jobs de procesamiento, expiración y conciliación | ✔ (QA) / ◐ | `taba-payment-outbox-worker`, `taba-checkout-expiry-sweep`, `taba-checkout-provider-truth-sweep`, `taba-operational-alerts-sweep` activos en QA; la migración los pausa y `deploy.mjs schedulers --enable` los reactiva en el orden correcto | repetirlo en producción |
| Procedimiento de reversión | ✔ | 7 niveles, del apagado del comercio a la restauración: `asistente-activacion.mjs reversion` ([`LANZAMIENTO.md`](../commercial-readiness-20261023/LANZAMIENTO.md) §8); el candado del piloto agrega una puerta más fina: `abortar` | — |
| **Candado del piloto cerrado** | ✔ (banco y base) | En producción el comercio nace en modo piloto: sin una autorización vigente la base rechaza cualquier pago real, aunque estén la llave final y el interruptor. Migración `20261027010000`, pruebas de base y escenario `pilot_gate` del banco | desplegar con las demás migraciones |

## 2. Costo estimado (no se contrató nada)

Cifras de la página oficial de precios de Supabase consultada el 26/10/2026 ([supabase.com/pricing](https://supabase.com/pricing)):

| Concepto | USD/mes | Nota |
|---|---:|---|
| Plan Pro | 25 | incluye USD 10 de crédito de cómputo, que cubren **una instancia Micro** |
| Cómputo Micro (cubierto por el crédito) | 0 adicional | 2 núcleos ARM, 1 GB |
| Si hiciera falta Small | +5 (USD 15 − 10 de crédito) | no se justifica para el piloto |
| Copias diarias | incluidas | 7 días de retención |
| PITR (opcional) | +100 | «por 7 días de retención»; **no se recomienda** para este volumen |
| Cloudflare Pages | 0 | plan gratuito (sin verificar en esta sesión) |
| SMTP propio | a definir | depende del proveedor elegido (C4); hay opciones con plan gratuito |
| Dominio propio | a definir | opcional (D2) |

**Total mínimo para operar: USD 25 por mes** (más el SMTP si se elige uno pago). **Acción requerida:** autorización de Luna Systems para crear el proyecto en una organización de pago (D1). La organización de QA es Free y no se usa para producción.

## 3. Mercado Pago

| Pieza | Estado | Comprobación |
|---|---|---|
| Aplicación e identidad de la integradora: **La Taba Delivery `7677852968049976`**, dueña = cuenta real | ◐ | `asistente-activacion.mjs integradora` (Client Secret por entrada oculta): dueña **real** en producción; si fuera de prueba, se aborta |
| Credenciales productivas legítimas | ✖ | las activa el dueño de la app en Developers (rubro, sitio, términos) — [`PROVEEDOR-REGLAS.md`](PROVEEDOR-REGLAS.md) §1 |
| Client Secret renovado | ✖ | el del 6/10 se expuso en una salida de diagnóstico: renovarlo **conservando el Client ID** (`actualizar-client-secret-produccion.ps1`) |
| Callback OAuth registrado | ✖ | `https://<ref>.supabase.co/functions/v1/mercadopago-oauth-callback` en la app; `asistente-activacion.mjs red` lo prueba (303 al Panel) |
| Webhook productivo y su firma | ✖ / ✔ | URL `…/mercadopago-webhook` con «Pagos» y «Vinculación de aplicaciones»; la validación de firma está implementada y probada (HMAC oficial, ventana de frescura, firmas falsas y vencidas rechazadas); `webhook-firma --confirm <ref>` prueba que la clave cargada es la de la app |
| Vendedor ≠ integradora | ✔ | la cuenta dueña de la app nunca queda como vendedor (`integrator_account` en el callback, `seller_is_integrator` al verificar, rechazo al cobrar); toda preferencia sale con `marketplace: MP-MKT-<app>` (banco: 17/17 en prueba y en ensayo de producción) |
| Token del vendedor guardado de forma segura | ✔ | AES-GCM ligado a proyecto, entorno, aplicación y comercio; sin `APP_USR-` en claro en ninguna tabla (comprobado por el banco) |
| Renovación de tokens y permisos | ✔ | `offline_access`; el refresh rota y se guarda el par nuevo; sólo `invalid_grant` pide reconectar (banco: `token_refresh`) |
| Creación y consulta de preferencias | ✔ | importes del servidor, envío como renglón, `init_point`, vencimiento = el del checkout |
| Devoluciones y conciliación | ✔ / ✖ | por API (parcial/total/idempotente) y desde la cuenta del vendedor, conciliadas una sola vez; **la API sigue sin certificarse con dinero real** |

### Qué combinación de cuentas es cuál

| Compra | Integradora | Vendedor | Comprador | Entorno | Dinero | Estado |
|---|---|---|---|---|---|---|
| **Cuenta de prueba** (QA) | TestApp-ae01fd1d (dueño = vendedor de prueba) | usuario de prueba | usuario de prueba | QA | ficticio | hecho (LT-0184/0185/0186); **no** demuestra integradora ≠ vendedor (preferencias `marketplace: NONE`) |
| **R-MKT-1 en QA** | TestApp | **segundo** vendedor de prueba | usuario de prueba | QA | ficticio | preparado ([`R-MKT-1-PROCEDIMIENTO.md`](../payments-final-20261025/R-MKT-1-PROCEDIMIENTO.md)); falta una cuenta de prueba (plugin de Mercado Pago sin autorizar) |
| **Cuenta productiva autorizada** (una cuenta real distinta de la dueña de la app, que el responsable designe por escrito) | La Taba Delivery (cuenta real) | esa cuenta | otra cuenta real, distinta | producción | **real** | opción previa a Walter si existe una; mismo procedimiento |
| **Cuenta comercial de Walter** | La Taba Delivery | Walter | otra cuenta real, distinta | producción | **real** | el piloto de este documento; Walter vincula por OAuth en su dispositivo |

Mezclar cuentas de prueba y reales en un mismo pago falla con 2034 (medido el 23/10); por eso el comprador y el vendedor de cada fila son del mismo tipo que el entorno.

## 4. Negocio

| Pieza | Estado |
|---|---|
| Separación de cobros por comercio | ✔ pago leído con el token de cada vendedor; RLS en checkouts; aviso con la pista del vendedor A para un pago de B → 404 (banco `isolation`, 5/5 en PostgreSQL) |
| Estados financieros correctos | ✔ pendiente ≠ rechazado; reserva no se cancela a ciegas; aprobado tardío con reserva vencida: un pedido y un descuento |
| Importe calculado en servidor | ✔ `total`/`unit_price` del navegador rechazados |
| Stock y reservas | ✔ una reserva, una conversión; última unidad con dos compradores: una reserva, un 409 |
| Pedidos con trazabilidad | ✔ intención, intentos, avisos, cola, eventos, discrepancias |
| Confirmaciones al comprador | ✔ la pantalla de retorno pregunta al servidor |
| **Control del acceso público durante las pruebas** | ✔ candado del piloto + (operativo) sitio en mantenimiento hasta que el titular lo decida |
| Costes, límites y riesgos conocidos | §2 y [`PROVEEDOR-REGLAS.md`](PROVEEDOR-REGLAS.md) §8 |
