# Cobros de La Taba con Mercado Pago: estado final — 25/10/2026

Rama `feature/taba-commercial-payments-final-20261025`, apilada sobre la v167 (#154 → #152 → #151 → …). La v165/v167
no se tocó: este trabajo no cambia ni una línea del catálogo, del frontend ni de las migraciones. Sin producción, sin
dinero real, sin cuentas de terceros.

## Veredicto

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| **Software de pagos** | **Terminado.** No queda ningún error conocido sin resolver. Esta sesión encontró **tres defectos reales** del camino de cobro y los corrigió (abajo, §2). | Banco de punta a punta 17/17 en prueba y 17/17 en ensayo de producción; Deno 70 + 245; `npm test` 3.235 / 3.235 (+10 del asistente; 1 omitida, sólo Windows); pgTAP 960 y simulacros de base en verde |
| **Pago contra Mercado Pago en pruebas** | **Verificado el 23/10** en el QA alojado, con dinero ficticio del proveedor y el mismo núcleo financiero: APRO aprobado (pago `184722117633` → pedido `LT-0087`), OTHE rechazado, CONT pendiente, devolución desde la cuenta del vendedor conciliada. **Los arreglos de hoy no se pudieron volver a pasar por el Mercado Pago real**: este entorno no tiene ninguna credencial (el plugin oficial no está instalado ni autorizado en la cuenta; las de QA viven en la PC de Marco). Se verificaron contra el emulador de contrato y, del lado HTTP, contra los endpoints reales del QA alojado (§3) | [`../mercadopago-final-20261023/causa-raiz-20261023/`](../mercadopago-final-20261023/causa-raiz-20261023/), [`evidencia/qa-red-20261025.json`](evidencia/qa-red-20261025.json) |
| **Activación comercial** | **Faltan sólo acciones de titulares**: crear el proyecto de producción (servicio pago), la sesión del dueño de La Taba Delivery (Client Secret renovado, Redirect URL y webhook), que Walter vincule **su** cuenta y autorice el cobro y la devolución de control. Ninguna requiere otra etapa de programación | [`ACTIVACION-COMERCIAL.md`](ACTIVACION-COMERCIAL.md), `node scripts/mercadopago/asistente-activacion.mjs` |

## 1. Banco de cobros de punta a punta (nuevo)

`npm run test:payments:e2e` (≈2 min; corre en el job «Migrations, pgTAP and isolated restore» de CI).

| Pieza | Real o emulada |
|---|---|
| Las 9 funciones Edge de Mercado Pago | **reales**: cada `index.ts` del repositorio en su propio isolate de Deno 2.6.1 (como en Supabase Edge Runtime) |
| supabase-js, PostgREST v12, roles `anon`/`authenticated`/`service_role`, RLS y grants | **reales** |
| PostgreSQL | **real**: la imagen de Supabase fijada por digest que usa la CI, con las **174 migraciones** en el mismo orden que el clúster final de `run-release-v5-db.mjs` y los privilegios por defecto medidos en producción |
| Cola, worker, barridos (`sweep_expired_checkout_sessions`, `enqueue_checkout_provider_probes`) | **reales** (el banco los invoca como el cron) |
| Mercado Pago | **emulado** ([`scripts/payments-e2e/mp-emulator.mjs`](../../../scripts/payments-e2e/mp-emulator.mjs)): contrato armado con lo medido contra el Mercado Pago real en QA y con la documentación oficial. **No prueba que Mercado Pago se comporte así** |
| Supabase Auth | verificación local del JWT (el banco no levanta GoTrue) |
| Red | red interna de Docker sin salida; el `fetch` de las funciones sólo llega a PostgREST, al verificador de JWT y al emulador (cualquier otro destino falla) |

Dos entornos por corrida: el **binding de prueba** (integradora de QA, vendedores de prueba) y un **ensayo de
producción** sobre un ref ficticio con la copia de las funciones que va a escribir `bind-production.mjs`
(La Taba Delivery, dueño = cuenta real distinta de todo vendedor, `live_mode`, revisión aprobada y llave final sólo en
ese proceso local). En los dos, **integrador ≠ vendedor**: toda preferencia sale `MP-MKT-<aplicación>`.

| Escenario | Qué prueba | Prueba | Producción |
|---|---|---|---|
| `oauth` | conectar A y B (PKCE S256, `state` de un uso, tokens sellados, ningún `APP_USR-` en claro); C con la cuenta de A → `seller_in_use`; en producción, la cuenta de La Taba como vendedor → `integrator_account`; «Verificar»; habilitación por operador con revisión | ✅ | ✅ |
| `apro` | carrito ficticio (3 productos, delivery) → sesión → preferencia con precios **de la base**, envío como renglón, referencia y URLs del servidor → pago APRO → webhook firmado 201 → worker → **un** pedido, stock descontado **una** vez, pantalla de retorno «completed» (antes del pago no confirma nada) | ✅ | ✅ |
| `duplicates` | el mismo aviso ×3 (`duplicate: true`), 5 a la vez, IPN viejo (200 ignorado), firma con otra clave (401), firma de hace 10 min (401): sigue habiendo un pedido | ✅ | ✅ |
| `rejected_then_approved` | OTHE: sin pedido, reserva conservada; reintento APRO en la misma preferencia: un pedido, sin otro descuento | ✅ | ✅ |
| `pending_then_approved` | CONT `in_process/pending_contingency`: sin pedido; acreditado después: un pedido | ✅ | ✅ |
| `pending_cancelled` | ticket pendiente cancelado desde el Panel: pago `cancelled`, stock devuelto | ✅ | ✅ |
| `abandoned_expired` | checkout vencido: el barrido libera una vez (el segundo barrido no hace nada) y la preferencia ya no se puede pagar | ✅ | ✅ |
| `late_approval_after_expiry` | pago aprobado **después** de vencida la reserva: con stock se vuelve a tomar y hay un pedido; sin stock queda revisión manual visible (`paid_without_order`), el comercio devuelve el dinero desde el Panel y cierra el caso con evidencia | ✅ | ✅ |
| `refunds` | devolución parcial **$8,20**, reintento con la misma clave (202, nada nuevo), devolución del resto: exactamente 2 POST al proveedor, intención `refunded` | ✅ | ✅ |
| `marketplace_owner_user_id` | **R-MKT-1**: el aviso trae el `user_id` del dueño de la integradora y el pago se acredita igual, en el comercio correcto | ✅ | ✅ |
| `isolation` | **R-MKT-3**: aviso del pago de B con la pista del vendedor A → el token de A recibe 404, el pago queda en B; A no recibe nada | ✅ | ✅ |
| `webhook_lost_truth_sweep` | el aviso nunca llega: la sonda del proveedor encuentra el pago y arma el pedido | ✅ | ✅ |
| `last_unit_race` | dos compradores por la última unidad a la vez: una reserva, un 409, stock 0 | ✅ | ✅ |
| `tampering` | `total` o `unit_price` del navegador → rechazados; sin sesión → 401; checkout ajeno → 404/409 | ✅ | ✅ |
| `token_refresh` | access token vencido: se renueva con el refresh (que rota) y el cobro sigue sin reconectar | ✅ | ✅ |
| `activation_assistant` | el asistente de activación contra las funciones reales (§3) | ✅ | ✅ |
| `reconciliation_clean` | al final: cada cobro tiene su pedido y viceversa, ningún pedido doble, cola vacía, cero discrepancias abiertas | ✅ | ✅ |

Evidencia: [`evidencia/banco-prueba.json`](evidencia/banco-prueba.json),
[`evidencia/banco-ensayo-produccion.json`](evidencia/banco-ensayo-produccion.json) y, de la primera corrida sobre el
código sin arreglos, [`evidencia/banco-antes-de-los-arreglos.json`](evidencia/banco-antes-de-los-arreglos.json).

## 2. Defectos encontrados y corregidos

| | Defecto (reproducido en el banco) | Consecuencia | Corrección |
|---|---|---|---|
| **D-1** | `mercadopago-refund` validaba el importe con `Math.round(x*100) !== x*100`. En punto flotante `8.2*100 = 819.9999999999999`: se rechazaban importes legítimos ($8,20, $16,40, $4,35, $1,15, $0,07…) y la función respondía **503 «No pudimos procesar el pago»** | un comercio no podía devolver parcialmente esos importes, y el error no decía por qué | se valida en centavos ([`_shared/refund-amount.ts`](../../../supabase/functions/_shared/refund-amount.ts), la misma regla que ya usaba `refund-correlation.ts`); un importe inválido es **400 `INVALID_REFUND_AMOUNT`** con su motivo |
| **D-2** | **R-MKT-1**: si el aviso de un pago marketplace no traía como `user_id` a un vendedor conectado (el caso que QA nunca pudo descartar: el dueño de la integradora), el webhook respondía **503** y el pedido esperaba al barrido del proveedor | pedidos tarde, reintentos de Mercado Pago y alertas falsas desde el primer cobro real si el proveedor manda esa pista | [`_shared/seller-webhook-routing.ts`](../../../supabase/functions/_shared/seller-webhook-routing.ts): la pista sigue siendo la primera ruta (la documentación dice que `user_id` es el vendedor); si no resuelve, se busca **acotado** (25 vendedores, 10 s, Mercado Pago espera 22 s) el vendedor cuyo token lee el pago **como cobrador**. Nada del cuerpo se usa como prueba; una pista equivocada no acredita nada al comercio de la pista; un proveedor que no contesta es un reintento, nunca una adivinanza |
| **D-3** | En producción, con la revisión aprobada pero **sin la llave final**, `create-checkout-session` reservaba stock y recién `create-preference` se negaba (`requireRealPaymentSmokeAuthorization`) | un comercio encendido antes de cargar la llave ofrecía Mercado Pago, retenía stock hasta el vencimiento y el comprador veía un error genérico | la función se niega **antes** de reservar (409 `PAYMENTS_NOT_ENABLED`, el mismo mensaje que un comercio sin vendedor); en prueba no cambia nada |
| conformidad | La documentación de Webhooks pide el `data.id` alfanumérico en minúsculas en el manifiesto de la firma; el validador del SDK oficial no lo hace | un aviso con id alfanumérico en mayúsculas se habría rechazado | se prueba primero en minúsculas y después el literal: lo que validaba antes sigue validando (los ids de pago son numéricos: para ellos no cambia nada) |

Pruebas nuevas (Deno): 13 de ruteo, 2 de importes, 2 del checkout en producción, 1 de firma. **Mutación**: con el
código anterior fallan 8 de ruteo, la de centavos, la de la llave final y la de minúsculas. En el banco, antes de los
arreglos: `refunds` 503 y `marketplace_owner_user_id` 503; después: 200 y 201.

## 3. Asistente de activación comercial (nuevo)

`node scripts/mercadopago/asistente-activacion.mjs [estado|red|integradora|webhook-firma|ensayo|reversion]`
([`scripts/mercadopago/asistente-activacion.mjs`](../../../scripts/mercadopago/asistente-activacion.mjs)). Encadena los
procedimientos y herramientas que ya existían y agrega las comprobaciones en vivo que faltaban:

| Subcomando | Qué hace | Escribe en producción |
|---|---|---|
| `estado` | checklist P1–P11 con lo que se detecta solo (registro, binding) y quién hace cada paso | no |
| `red` | sitio por HTTPS, `runtime-config.js` apuntando al proyecto, Redirect URL de OAuth (303 al Panel), webhook (405 a GET; IPN viejo reconocido = función publicada con su clave cargada), CORS sólo para la tienda, worker 401 | no (sondas que no dejan filas) |
| `integradora` | `client_credentials` + `/users/me` con el Client Secret por entrada oculta: dueña **real** en producción, usuario de prueba en QA | no |
| `webhook-firma --confirm <ref>` | aviso firmado de vinculación de un vendedor inexistente: sólo un `200 not_connected` prueba que la clave coincide; un 503 nunca se informa como clave correcta | no, salvo que la clave **no** coincida: queda una fila rechazada y lo avisa |
| `ensayo` | producción ficticia completa (banco + alta del vendedor), sin red ni dinero | no |
| `reversion --business <uuid> --slug <slug>` | los 7 niveles de apagado con los comandos del comercio | no |

El banco ejecuta `red`, `integradora` y `webhook-firma` contra las funciones reales en los dos entornos (9/9, dueña
correcta, clave correcta sin filas, clave equivocada con exactamente una fila). Contra el **QA alojado real**, `red`
dio 7 OK y 2 «no verificables» (el preview está protegido con contraseña a propósito):
[`evidencia/qa-red-20261025.json`](evidencia/qa-red-20261025.json).

## 4. Estado de cada componente financiero

| Componente | Estado | Dónde se prueba |
|---|---|---|
| Credenciales de prueba y producción separadas y verificables | ✅ bindings por proyecto; integradora del entorno equivocado se rechaza antes del consentimiento; `verificar-configuracion.mjs` lee secretos sin verlos | Deno, banco `oauth`, asistente `integradora` |
| Vinculación OAuth de cada vendedor | ✅ PKCE S256, `state` de un uso con TTL, sesión del Panel revalidada en el callback | banco `oauth`, QA 24/10 (OAuth real `seller_in_use`) |
| Integrador ≠ vendedor | ✅ la cuenta de La Taba nunca queda como vendedor en producción (callback, verificación y cobro) | banco `oauth` (producción) |
| Tokens: almacenamiento y renovación | ✅ AES-GCM ligado a proyecto/entorno/app/comercio; renovación con lease; sólo `invalid_grant` pide reconectar | banco `token_refresh` |
| Preferencias y Checkout Pro | ✅ importes y renglones del servidor, envío como renglón, vencimiento = el del checkout, `init_point` (nunca `sandbox_init_point`) | banco `apro`; QA 23/10 con Mercado Pago real |
| Comisión del marketplace | **no aplica al modelo comercial vigente** (La Taba no cobra `marketplace_fee`: [`MATRIZ-GO-NO-GO` B2](../mercadopago-final-20261023/lanzamiento/MATRIZ-GO-NO-GO.md)). Si se decidiera cobrarla: es un monto fijo en ARS menor que el total, exige `marketplace` válido y Mercado Pago pide al vendedor KYC nivel 6 y coordinar la liberación con un ejecutivo comercial (§6) | — |
| Retornos aprobado / pendiente / rechazado | ✅ las tres `back_urls`; la pantalla de retorno no lee la URL: pregunta al servidor, que relee Mercado Pago | banco `apro`, `rejected_then_approved` |
| Errores y recuperación | ✅ ambigüedades a conciliación (nunca un segundo POST a ciegas), cola con leases y reintentos, sondas del proveedor, libro por `date_last_updated` | banco `webhook_lost_truth_sweep`, `late_approval_after_expiry` |
| Confirmación sólo desde el servidor | ✅ | banco `apro` (antes del pago la pantalla no confirma) |
| Firma de webhooks | ✅ HMAC oficial + ventana de frescura + minúsculas documentadas | banco `duplicates`, Deno |
| Idempotencia de pagos y pedidos | ✅ recibos únicos, una orden por intención, reservas convertidas una vez | banco `duplicates`, `reconciliation_clean` |
| Stock una sola vez | ✅ reserva al iniciar, conversión al pagar, liberación al vencer/cancelar/rechazar vencido | banco `apro`, `last_unit_race`, `abandoned_expired`, `pending_cancelled` |
| Aislamiento entre comercios | ✅ lectura del pago con el token de cada vendedor; RLS en checkouts | banco `isolation`, `tampering` |
| Importes en el backend | ✅ lista blanca del payload; precios, envío y total en SQL | banco `tampering`, `apro` |
| Secretos | ✅ ninguno en el repositorio, el frontend ni los registros; escáner en CI | `npm run check` |
| Devoluciones | ✅ por API (parcial, total, idempotente) y desde la cuenta del vendedor (conciliada como `external`) | banco `refunds`; QA 23/10 (manual conciliada) |
| Conciliación | ✅ discrepancias con gravedad, cierre con evidencia, barrido del libro del vendedor | banco `reconciliation_clean`, `late_approval_after_expiry` |

## 5. Base de datos: sin migraciones nuevas, a propósito

Se auditó el esquema contra cada necesidad pedida y ya está resuelta, con pruebas: pedidos e importes (`orders`,
`checkout_sessions`), intentos (`payment_intents`, `payment_attempts`), identificadores externos y estados
(`payment_provider_payments`, `provider_*` de la intención), reservas (`inventory_reservations`), duplicados (recibos
únicos por evento, una orden por intención), devoluciones (`payment_refunds`), eventos de webhook
(`payment_webhook_receipts`, `payment_events`), conciliación (`payment_discrepancies`, libro del proveedor) y auditoría
(`payment_events`, `business_config_audit`). Los tres arreglos son de las funciones Edge; ninguno necesitaba SQL. Crear
tablas o columnas sin una necesidad real habría sido duplicar. El banco sí encontró una diferencia **del entorno de
prueba**, no del producto: el clúster de CI no replica los privilegios por defecto de la plataforma alojada (el banco
los replica; medidos en producción en `docs/PRODUCTION-SUPABASE-SECURITY.md`).

## 6. Investigación externa: qué cambió y qué no

Fuentes oficiales de Mercado Pago Developers (Argentina) consultadas el 25/10, el SDK `mercadopago` (npm 3.6.1, MIT;
el repositorio usa 3.2.1, que ya trae `WebhookSignatureValidator`) y el plugin oficial para Claude Code (4.3.2).

| Hallazgo | Decisión |
|---|---|
| `user_id` del webhook = «Seller identifier» | la ruta habitual de La Taba ya era esa; D-2 cubre lo que la documentación no dice para marketplace |
| `data.id` en minúsculas en el manifiesto | adoptado (§2) |
| `source_news=webhooks` **no está documentado** (sólo `source_news=ipn`, con traducciones contradictorias) | **no** se agregó; el receptor ya tolera el IPN `?topic&id` sin guardarlo |
| `marketplace_fee`: monto fijo, exige `marketplace` válido, devoluciones proporcionales, KYC 6 del vendedor | no se implementó: el modelo vigente no cobra comisión |
| `external_reference`: la referencia documenta «≤ 64, letras, dígitos, `-` y `_`» | la de La Taba (`taba2:checkout:<uuid>`, 51) lleva `:` y Mercado Pago la aceptó en QA (preferencias, búsqueda y pago aprobado del 23/10). **Riesgo vigilado**: si el proveedor empezara a exigirlo, la preferencia fallaría con 400 y La Taba lo informa al comprador sin cobrar; cambiar el formato tocaría el núcleo financiero y no se justifica sin evidencia |
| Calidad de integración (puntaje ≥ 73, se mide con un pago **de producción**) | datos del pagador y `statement_descriptor` quedan para evaluar con el primer pago real: enviar un correo real como pagador en QA arriesga el error 2034 (usuarios de prueba y reales mezclados) |
| Scopes OAuth admitidos: `offline_access`, `write`, `read` | La Taba ya pide los tres: el 401 «Unauthorized use of live credentials» de los reembolsos en QA no es un scope faltante |
| Tokens: 180 días, el refresh rota y es de un solo uso | coincide con el código (se guarda el par nuevo en cada renovación) |
| Plugin oficial de Mercado Pago | existe en el catálogo; **no está instalado ni autorizado** en la cuenta de esta sesión. Con él se podrían crear usuarios de prueba y leer credenciales de prueba: queda como vía para G1 y para la re-verificación (§7), con la autorización del titular |

## 7. Re-verificar los arreglos contra el Mercado Pago real (QA, dinero ficticio)

En la PC de operación (credenciales de QA en el Administrador de credenciales), sin tocar producción:

```bash
node scripts/recovery/sync-hosted.mjs --functions mercadopago-webhook,mercadopago-refund,mercadopago-create-checkout-session            # ensayo en seco
node scripts/recovery/sync-hosted.mjs --functions mercadopago-webhook,mercadopago-refund,mercadopago-create-checkout-session --apply --evidence qa.jsonl
node scripts/mercadopago/asistente-activacion.mjs red --target qa                                   # 7 OK + 2 no verificables
node scripts/recovery/qa-mp-e2e.mjs window-open
node scripts/recovery/qa-mp-e2e.mjs checkout --scenario APRO          # una persona paga con la tarjeta de prueba APRO
node scripts/recovery/qa-mp-e2e.mjs worker
node scripts/recovery/qa-mp-e2e.mjs inspect --session <checkout_session_id>     # da el id de la intención
node scripts/recovery/qa-mp-e2e.mjs refund --intent <id> --amount 8.2 --repeat
node scripts/recovery/qa-mp-e2e.mjs window-close
```

Esperado: el reembolso de 8,20 **llega al proveedor** (antes moría en la validación con 503). En el entorno de prueba
Mercado Pago lo rechaza con 401 código 7 (medido el 23/10, [`REEMBOLSO-401.md`](../mercadopago-final-20261023/lanzamiento/REEMBOLSO-401.md)):
La Taba lo registra como `REFUND_REJECTED` y la devolución se hace desde la cuenta del vendedor. R-MKT-1 con dinero
ficticio exige el segundo vendedor de prueba (G1, [`MARKETPLACE-SEGUNDO-VENDEDOR.md`](../commercial-readiness-20261023/MARKETPLACE-SEGUNDO-VENDEDOR.md)).

## 8. Dependencias externas (exactas, de quién)

| # | Acción | Titular | Bloquea |
|---|---|---|---|
| E1 | Crear el proyecto `la-taba-production` (plan pago, `sa-east-1`) — **servicio pago** | Marco / Luna Systems (D1) | todo lo de producción |
| E2 | Renovar el Client Secret de La Taba Delivery `7677852968049976` conservando el Client ID; registrar Redirect URL y webhook (Pagos + Vinculación de aplicaciones) del proyecto nuevo; revelar la clave del webhook | dueño de La Taba Delivery | vincular a Walter |
| E3 | Cargar los secretos por entrada oculta, sin la llave final | Marco | vincular a Walter |
| E4 | Walter vincula **su** cuenta, en su dispositivo | Walter | cobrar |
| E5 | Importe y producto del primer cobro y de la primera devolución de control | Walter (D5) | abrir al público |
| E6 (recomendado) | Una cuenta de prueba tipo *Vendedor* en TestApp (G1, irreversible: límite 15) para R-MKT-1 sin dinero real | titular de la cuenta de prueba | nada (sin G1 lo cierra E5) |
| E7 (opcional) | Instalar y autorizar el plugin oficial de Mercado Pago en Claude, o compartir credenciales de prueba por un canal seguro, para que una sesión repita §7 sin la PC de Marco | Marco | nada |

## 9. Cómo reproducir

```bash
npm ci
npm run test:payments:e2e          # banco de punta a punta (Docker), informe en artifacts/ci/payments-e2e.json
npm run test:webhook               # Deno + Node de pagos
node --import ./tests/test-bootstrap.mjs --test tests/mercadopago-asistente-activacion.test.mjs
node scripts/mercadopago/asistente-activacion.mjs          # checklist de activación
```

## 10. Adenda: pantalla de retorno del pago

Dos defectos del retorno (un rechazo se leía como «pendiente»; un combo pagado seguía en el carrito) corregidos y con prueba de navegador: [`RETORNO-DEL-PAGO.md`](RETORNO-DEL-PAGO.md).
