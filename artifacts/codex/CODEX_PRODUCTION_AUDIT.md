# TABA — Codex Independent Production Audit

Fecha: 2026-09-08 (America/Buenos_Aires)  
Auditor: Codex, revisión independiente  
Alcance: repositorio, Git, Cloudflare Pages servido, Supabase staging/production por consultas de solo lectura, Edge Functions desplegadas, Mercado Pago, PWA, Rider, tests y supply chain.  
Restricciones respetadas: no deploy, no pago, no autorización de Walter, no login de Mercado Pago, no mutación de datos/secrets/configuración productiva y no migraciones.

## Veredicto ejecutivo

`AUDIT_VERDICT = FAIL` y `PRODUCTION_READY = NO`.

La afirmación `PRODUCTION_READY: PENDING_WALTER_OAUTH` queda refutada por tres HIGH desplegados/operativos:

1. producción carece del URL y secreto HMAC del payment worker en Vault, por lo que cron e immediate kick no pueden despachar outbox;
2. el código desplegado no ata cada Supabase ref al App ID Mercado Pago conocido;
3. el modo de credenciales desplegado conserva un fallback fail-open al Access Token global y puede omitir por completo la conexión seller.

La situación actual sí es segura contra movimiento de dinero: no hay fila productiva de settings, la conexión está `disconnected`, no hay seller/tokens/intents y la disponibilidad efectiva devuelve `false`. Walter puede reunirse y completar OAuth sin abrir cobros automáticamente; no es seguro habilitar pagos reales después hasta remediar y recertificar los HIGH.

## 1. Autoridad Git y release real

| Evidencia | Resultado |
|---|---|
| branch inicial | `feature/taba-mercadopago-oauth` |
| HEAD inicial / RC | `899caaf849c1db8672e83b5cd9e31b0d4e141199` |
| remote | `origin = https://github.com/bitflowapp/la-taba-pages-preview.git` |
| remote esperado | coincide |
| upstream | `origin/feature/taba-mercadopago-oauth` en `11aa86e` |
| ahead/behind | `+2/-0`; commits locales `34f055f`, `899caaf` |
| remote contiene `899caaf` | no |
| worktree RC | `C:/1212/la-taba-mercadopago-oauth` |
| dirty inicial | `artifacts/preserva/`, `artifacts/walter/`, dos scripts OAuth producción; todos untracked y no ignorados |

Comandos: `git status --porcelain=v2 --branch`, `git branch --show-current`, `git rev-parse HEAD`, `git remote -v`, `git worktree list --porcelain`, `git log --oneline --decorate -20`, `git branch -a --contains 899caaf`.

Luego de documentar el bug se creó sólo localmente `audit/codex-production-hardening`. No se hizo merge, push ni deploy.

## 2. Release desplegado, runtime y assets

| Componente | SHA/runtime observado | Resultado |
|---|---|---|
| local RC | `899caaf` | autoridad de código servido |
| staging `/version.json` | `899caaf`, `la-taba-runtime-v97-explicit-seller-status`, built `2026-09-08T02:53:53.263Z` | coincide |
| production `/version.json` | `899caaf`, mismo runtime, built `2026-09-08T02:53:12.925Z` | coincide |
| web assets críticos | `index.html`, `sw.js`, checkout JS y consola de pagos: byte-identical entre local y producción | coincide |
| Edge Functions | nueve funciones de pago activas; todos sus archivos desplegados son textualmente iguales en staging, producción y RC local pre-patch | coincide |

El runtime público está correctamente aislado:

- staging: `ukxqbgswjlibmnjemrzd`, business `3537d949-d76b-410d-be89-e4f447546e29`, deployment `staging`;
- production: `wwcpogltfgzgkrlilbcd`, business `00000000-0000-4000-8000-000000000001`, deployment `production`.

`runtime-config.js` responde `Cache-Control: no-store`; el service worker es same-origin, ignora requests cross-origin (por tanto no cachea Supabase/Mercado Pago), no guarda URLs de retorno `/pago/*` ni `/cuenta/` y usa cache versionada. Hallazgo INFO: el shell compartido todavía nombra `?tenant=walter-staging` también en producción y lo precachea; el origen evita crossover real, pero la etiqueta/proveniencia de cache es incorrecta.

`RELEASE_ALIGNMENT = FAIL`: los bytes actuales coinciden, pero el RC desplegado no existe en el remote esperado y el ledger de migraciones no está alineado.

## 3. Arquitectura ejecutable de pagos

El flujo seguido en código, no inferido por nombres, es:

1. `js/app.js:1969` llama `createMercadoPagoCheckout`.
2. `js/repositories/supabase_order_repository.js:1008-1174` obtiene disponibilidad, crea session y recién después preference; guarda localmente sólo el UUID de checkout.
3. `mercadopago-create-checkout-session/index.ts:13-42` exige POST/origen/Auth, rate limit y llama como service role a `create_checkout_session` con `user.id` derivado del JWT.
4. La definición vigente `20260813020000_checkout_pro_carries_customer_notes.sql:51-808` lista blanca el payload, liga productos al business, bloquea filas, recalcula precio/descuento/envío, reserva stock y crea `checkout_sessions` + `payment_intents`.
5. `mercadopago-create-preference/index.ts:22-162` exige Auth/ownership, llama `prepare_mercadopago_preference`, recupera por `external_reference` antes de POST y crea `/checkout/preferences` con idempotency key.
6. `_shared/mercadopago.ts:60-192` construye items/importes/URLs server-side y realiza el único POST de preference.
7. Mercado Pago redirige a páginas `/pago/*`; `mercadopago-checkout-status` vuelve a consultar al proveedor server-side y nunca confía en los query params del retorno.
8. `mercadopago-webhook/index.ts:21-159` valida HTTPS, tamaño, HMAC y tenant seller; persiste receipt y encola outbox.
9. `mercadopago-payment-worker/index.ts:31-301` toma jobs con lease, relee el recurso en Mercado Pago, crea snapshot minimizado y llama a `record_mercadopago_payment_snapshot`.
10. `20260806140000_mercadopago_provider_snapshot_contract.sql:13-148` valida external reference, preference, collector, application si existe, currency, amount, live mode y estado; sólo `approved` válido puede pedir finalización.
11. `20260813020000_checkout_pro_carries_customer_notes.sql:812-941` bloquea session/intent/reservas, crea exactamente un order, convierte reservas y liga intent/order.

Tablas principales: `business_payment_settings`, `checkout_sessions`, `checkout_session_items`, `checkout_session_combos`, `inventory_reservations`, `payment_intents`, `payment_attempts`, `payment_events`, `payment_webhook_receipts`, `payment_outbox`, `payment_refunds`, `payment_cancellations`, `payment_disputes`, `mp_seller_connections`, `mp_oauth_states`.

## 4. Compuerta efectiva

La aprobación de review por sí sola no puede cobrar hoy.

La condición efectiva desplegada es:

```text
authenticated customer and allowed origin
AND business active/open/order-enabled/order-verified/currency+channel valid
AND business_payment_settings exists
AND settings.enabled
AND reserve_stock + checkout_pro + ARS
AND collector_id + application_id present
AND (test OR DB production_review_status=approved)
AND server-calculated cart/stock/address/age/session/reservation valid
AND Edge MERCADOPAGO_ENVIRONMENT matches intent
AND Edge production review string = approved
AND production real-payment confirmation phrase present
AND valid provider credential path
```

En el diseño esperado, la última línea debería significar adicionalmente:

```text
MERCADOPAGO_CREDENTIAL_MODE=oauth
AND mp_seller_connections.status=connected
AND encrypted token decrypts/refreshes
AND token/business/environment/seller/app binding is valid
```

El código desplegado no hace obligatorio OAuth: cualquier modo distinto de `oauth` cae al token global. Por eso `PAYMENT_GATE = FAIL` como arquitectura de go-live, aunque el estado presente está fail-closed.

Estado productivo medido:

- `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` inferido por callback config guard exitoso;
- `business_payment_settings`: 0 filas;
- availability del business productivo: `available=false`;
- seller connection: `disconnected`, sin seller, app, token ni expiración;
- checkout sessions/intents/outbox/webhook receipts: 0/0/0/0;
- money movement Mercado Pago posible ahora: no.

## 5. Seller binding y OAuth/PKCE

Controles que pasan:

- state y verifier: 32 bytes CSPRNG, base64url de 43 caracteres;
- state persistido sólo como SHA-256, 10 minutos, consumo por `DELETE ... RETURNING` one-time;
- PKCE `S256`, challenge SHA-256, `Authorization Code`, redirect HTTPS derivado del propio project origin;
- callback rechaza parámetros duplicados, state débil, code ausente/ambiguo y open redirect;
- sesión TABA original cifrada y revalidada; `user.id`, membership, sesión registrada/revocación se vuelven a comprobar;
- token response exige access/refresh, expiración, `offline_access` y live mode correcto;
- `/users/me` valida seller ID, `MLA` y test/normal tag según ambiente;
- `(environment,seller_id)` es unique; un seller no cruza business;
- generation invalida callbacks viejos; disconnect destruye tokens, rota generation, borra states y apaga settings;
- el seller ya fijado no puede cambiar ni antes ni después de pagos sin migración explícita.

Producción tiene un state expirado; no es consumible pero retiene material cifrado hasta otro begin OAuth. Seller binding pasa; aislamiento de aplicación/modo falla por CDEX-002/CDEX-004.

## 6. Almacenamiento cifrado de tokens

`seller-oauth-crypto.ts:48-88` usa Web Crypto AES-GCM con clave raw exactamente de 32 bytes, IV aleatorio de 12 bytes por sello, tag integrado al ciphertext y AAD que liga project ref, ambiente, App ID, business y propósito. Los tests prueban round-trip, nonce distinto, tenant/environment/key equivocados y tampering.

La clave se obtiene sólo de `Deno.env`; no está en frontend, Git, runtime config ni logs. Los logs de OAuth contienen evento/business/correlation, nunca tokens. No hay key ID ni grace rotation: cambiar la clave invalida todas las conexiones y puede dejar el panel diciendo connected mientras decrypt falla; una rotación debe planificar reconnect.

## 7. Webhook y aprobación falsa

`WEBHOOK_CAN_FAKE_APPROVAL = NO` bajo los secretos intactos.

- valida `x-signature` con SDK oficial `mercadopago@3.2.1` (versión upstream actual observada), `x-request-id`, literal query `data.id`, igualdad opcional body/query y ventana temporal;
- usa secret OAuth server-side y HTTPS;
- en OAuth, `body.user_id` es sólo hint: busca una connection connected/app/env exacta, relee el payment con el token seller, exige collector/live mode/external reference y liga el intent/business;
- el worker vuelve a leer Mercado Pago; el JSON del atacante nunca se convierte directamente en snapshot aprobado;
- el RPC que registra snapshot/finaliza es sólo service role;
- DB valida amount/currency/reference/preference/collector/live mode y monotonicidad.

Un atacante no puede enviar `{status:"approved"}` y pagar un order. Los riesgos abiertos son disponibilidad: ack síncrono con fetch proveedor (CDEX-007) y, en producción, el worker no puede ser despachado por falta de Vault (CDEX-001).

## 8. Idempotencia y state machines

- checkout: advisory lock + `(business,customer,client_request_id)`/intent hash;
- preference: payment attempt e idempotency key persistidos; timeout queda ambiguous y se busca por external reference antes de cualquier repetición;
- receipts: unique `(provider,environment,event_id,type,resource)`;
- outbox: unique por receipt; claim `FOR UPDATE SKIP LOCKED`, lease, 8 intentos, exponential backoff, dead-letter;
- intent: rank monotónico y trigger anti-regresión; `approved` no vuelve a pending/rejected;
- finalización: row locks, `completed_order_id` idempotente, order/payment relation y reservas convertidas una vez;
- refund/cancel: owner/admin, key persistida, ambiguous reconciliation y estados monotónicos.

Resultado: `IDEMPOTENCY = PASS`; su ejecución automática productiva está bloqueada por CDEX-001.

## 9. Precio, payload e IDOR/BOLA

El browser manda business ID, IDs de producto/combo, cantidades, contacto/dirección y modalidad; no manda precio, subtotal, descuento, envío, moneda ni provider status. La DB rechaza claves inesperadas, verifica cada producto pertenece al business, bloquea stock, deriva precios/descuentos/envío y sella snapshots.

Checkout session y status se ligan a `user.id`; direcciones se ligan al mismo customer. Seller/business del webhook se resuelve desde conexión + payment provider + intent, no desde URL/body. El order directo que declare `mercadopago` sin intent completed falla en el constraint trigger `orders_assert_payment_modality`.

Resultado: `SERVER_SIDE_PRICING = PASS`; no se halló BOLA de pagos entre negocios.

## 10. Supabase, RLS y grants

Consulta live de ambos proyectos:

- las 14 tablas de pagos/OAuth inspeccionadas tienen RLS activo;
- `anon` no tiene SELECT/INSERT/UPDATE/DELETE en tablas de pago/OAuth;
- `authenticated` no tiene escritura directa; sólo `checkout_session_combos` conserva SELECT y su policy exige ownership o owner/admin;
- settings/sessions/intents/refunds/disputes se leen sólo por policies de customer o owner/admin;
- todos los RPC internos de preference/webhook/outbox/snapshot/finalize/OAuth son sólo `service_role`;
- RPC expuestos para estado/refund/cancel/list exigen Auth + membership; `has_business_role` consulta `identity_member_role`, que exige sesión registrada, no revocada y usuario no anónimo;
- SECURITY DEFINER relevantes tienen `search_path` fijo.

Ocho SECURITY DEFINER son anon-executable; siete son lecturas acotadas. `check_scheduler_watchdog` escribe alertas sin autenticación (CDEX-010). No abre pagos/datos, pero merece hardening. Resultado de pagos: `RLS = PASS` con finding LOW fuera de la frontera financiera.

## 11. Secretos y configuración

No se muestran valores ni digests completos.

| Nombre | Producción | Evidencia/nota |
|---|---|---|
| `MERCADOPAGO_CLIENT_ID` | PRESENT, exact value NOT VERIFIED LIVE | callback config acepta ID numérico; App ID esperado existe; CDEX-002 |
| `MERCADOPAGO_CLIENT_SECRET` | NOT VERIFIED | sólo se usa al canjear/refresh; no se inició OAuth |
| `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` | NOT VERIFIED | no se envió webhook falso porque habría escrito receipt/rate-limit |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | NOT VERIFIED | no se tocó token Walter |
| `PAYMENT_LOG_HASH_SALT` | NOT VERIFIED | camino autenticado/rate-limit no ejecutado |
| `PAYMENT_WORKER_SECRET` (Edge) | PRESENT | request con firma inválida devuelve 401, no 503 y no toca DB |
| worker URL/HMAC mirror (Vault) | MISSING | `vault.secrets` tiene 0 filas en producción |
| `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | approved | callback POST llega a 405 después de pasar `oauthConfig()` |
| `MERCADOPAGO_CREDENTIAL_MODE` | NOT VERIFIED y diseño fail-open | CDEX-004 |
| real-payment smoke confirmation | NOT VERIFIED | no importa hoy: settings/seller bloquean antes |

`npm run check`/secret scan pasó. Historia Git se buscó por nombres, tokens, JWT y private keys sin imprimir coincidencias: sólo fixtures/tests/documentación; no se encontró un secreto real versionado. Los cuatro paths untracked iniciales no matchearon patrones de credencial, pero tampoco están ignorados. `SECRET_POSTURE = FAIL` por el mirror de worker faltante y por no poder probar el inventario live completo sin sesión CLI de Supabase.

## 12. Staging/production isolation

Los runtimes web, business IDs, project URLs y callbacks observados son correctos; los assets/Edge source coinciden. La app oficial lista:

- `2691240967769590` — `TABA2 Staging`;
- `7677852968049976` — `La Taba Delivery`.

El código genera exactamente el redirect productivo esperado y el endpoint webhook esperado. La URL configurada en Mercado Pago Developers no pudo leerse con las herramientas disponibles. `notifications_history` no encontró entregas (compatible tanto con una app todavía sin pagos como con una URL no configurada), así que esa configuración externa queda `NOT VERIFIED` y debe comprobarse antes de habilitar.

La disponibilidad del business web actual es false en ambos entornos. Staging conserva 28 outbox jobs históricos, todos completed, y sus dos secretos Vault de worker existen. Producción tiene cero jobs y cero secretos Vault.

ZERO CROSSOVER no queda demostrado por el código desplegado porque App ID y OAuth mode no están vinculados al project ref (CDEX-002/CDEX-004). `STAGING_PRODUCTION_ISOLATION = FAIL`.

## 13. Kill switch

`enabled=false` se aplica server-side en `create_checkout_session` y nuevamente en `prepare_mercadopago_preference`; no hay cache DB. Requests directos no lo saltan. Disconnect también lo fuerza a false.

El worker deliberadamente no lo respeta para jobs existentes: hacerlo dejaría dinero ya cobrado sin reconciliar. El switch tampoco revoca un `init_point` ya emitido ni puede volver atómico el lapso entre preparación DB y POST externo. Resultado: bloquea nuevos intentos TABA de inmediato, pero no preferencias ya emitidas/in-flight (CDEX-003). `KILL_SWITCH = FAIL` respecto de la promesa absoluta; sirve como primera compuerta operativa.

## 14. Qué ocurrirá post-Walter

OAuth exitoso consume state, canjea con PKCE, verifica seller, cifra tokens y ejecuta `mp_finish_oauth`. En producción crea/upserta settings con:

- environment `production`;
- collector = seller verificado;
- application = App ID del runtime;
- `enabled=false`;
- `production_review_status` queda en default `not_requested` si no había fila.

Por lo tanto OAuth no abre cobros. Aun conectado Walter, siguen bloqueando `enabled=false`, el review DB no aprobado y normalmente la confirmación explícita de real payment. `POST_WALTER_SAFETY = PASS`. Después no se debe habilitar hasta reparar worker, desplegar/revisar el patch, comprobar secreto/mode/App ID y realizar checks post-OAuth.

## 15. Producción web no destructiva

Playwright headless, 390×844 y 1440×900, sobre `https://la-taba.pages.dev/#business`:

- HTTP 200, título correcto, sin overflow horizontal;
- muestra login seguro y no expone panel sin sesión;
- runtime apunta sólo a production project/business;
- cero console errors, page errors o request failures;
- headers defensivos presentes salvo CSP; su ausencia es CDEX-013;
- APIs públicas esperadas responden 200;
- staging equivalente apunta sólo a staging y su business limpio;
- no se inició login de Mercado Pago.

El callback sin parámetros redirige 303 a `https://la-taba.pages.dev/?mp_connection=error#business`, sin state/code en el destino. Probes directos: checkout/connect/preference exigen Auth, origen malicioso obtiene 403, webhook GET obtiene 405 y worker con firma inválida obtiene 401.

## 16. Tests ejecutados y calidad de cobertura

| Comando | Resultado |
|---|---|
| `npm run check` | PASS |
| `npm run test:payments` | 67/67 PASS (pre-patch y post primer hardening) |
| `npm run test:webhook` base | 57/57 PASS |
| `npm run test:webhook` con regresiones Codex | 59/59 PASS (25 + 22 + 12) |
| `npm test` inicial | 2407/2410; 3 fallaron por `ENOSPC` en TEMP `E:` |
| `npm test` final con TEMP externo sano | 2410/2410 PASS |
| `npm run test:payments:local-db` | PASS after starting an ephemeral local stack; all migrations/pgTAP suites + dump/restore verified, 1,473,347-byte archive, restore 6,346 ms |
| `npm run test:e2e` | 543/544; un único salto de scroll del panel bajo carga |
| rerun aislado del único E2E fallido | 1/1 PASS (1.2 min); clasificado inestable/no financiero |

Huecos previos importantes: no había test para App ID staging en production ni para fallback global en hosted projects; ambos fueron agregados al patch y pasan. El DB suite cubrió OAuth replay, seller swap, disconnect/reconnect, production OAuth no auto-enable, duplicate webhook, exactly-once, grants y restore. El stack local efímero se detuvo y eliminó después de la prueba.

## 17. Migraciones

- local: 121, latest `20260905195357`;
- staging: 121, latest igual;
- production: 120, latest igual;
- production falta `20260826120000_alcohol_policy_readable`;
- la colisión histórica `20260804090000` tiene nombres distintos entre staging/production y fue reconciliada por `20260804093000`;
- funciones financieras core tienen iguales definiciones/hash lógico; tres hashes secundarios difieren sólo por encoding del body, con misma longitud/ramas observadas.

`MIGRATION_DRIFT = 1 missing production migration; non-payment and currently mitigated`.

## 18. Rider

- worktree histórico `D:\1212\worktrees\taba2-rider-map` está limpio, branch `codex/rider-map-staging`, SHA exacto `95294d9d36a6429a21a562ea6a48b8c9ecbf8523`;
- repositorio Rider actual está en otro branch más nuevo `fix/rider-android-runtime-hardening` SHA `434c4d5`, sin cambios;
- flavor staging fija `ukxqbgswjlibmnjemrzd`; production mantiene project ref `null`, por lo que no puede caer accidentalmente a staging;
- DTO/RPC aceptan estados `assigned`, `picked_up`, `on_the_way`, `arrived`, `delivered` coherentes con producción y transportan `payment_method` sólo como dato operativo.

`RIDER_COMPATIBILITY = PASS`; Rider production aún no está habilitado por configuración, de manera fail-closed.

## 19. Shadow paths y supply chain

Sólo `_shared/mercadopago.ts`, seller OAuth y refund/cancel llaman `api.mercadopago.com`. No se halló Edge legacy, IPN abierto, provider alternativo, debug auth ni ruta frontend que marque pago. El único shadow financiero real fue el fallback global CDEX-004.

Supply chain:

- `package-lock.json` v3; versiones directas exactas y todas las entradas tienen integrity/resolved;
- `npm audit --json`: 0 vulnerabilidades (0 critical/high/moderate/low);
- `npm run deps:pinned:check`: 23 paquetes verificados contra lock, PASS;
- lifecycle scripts detectados: `esbuild` y `fsevents`, esperables; ninguno maneja secretos TABA;
- Deno lock fija `mercadopago@3.2.1`; upstream oficial lo muestra como release actual;
- `npm ls --all` no es limpio porque Deno materializó enlaces/paquetes extraneous y dev-deps faltantes dentro de `node_modules`; el gate propio de pinning pasa y el artefacto web no publica `node_modules`.

## 20. Findings y decisión

| ID | Severity | Estado desplegado |
|---|---|---|
| CDEX-001 worker Vault faltante | HIGH | OPEN, config production |
| CDEX-002 App ID no vinculado | HIGH | OPEN en production; patch local |
| CDEX-004 global credential fallback | HIGH | OPEN en production; patch local |
| CDEX-003 kill switch no revoca outstanding | MEDIUM | OPEN |
| CDEX-005 RC no está en remote | MEDIUM | OPEN |
| CDEX-006 migration drift | LOW | OPEN, mitigado |
| CDEX-007 webhook ack síncrono | LOW | OPEN |
| CDEX-008 OAuth state retention | LOW | OPEN |
| CDEX-009 metadata de calidad | LOW | OPEN |
| CDEX-010 watchdog anon mutador | LOW | OPEN |
| CDEX-011 cache label | INFO | OPEN |
| CDEX-012 test environment | INFO | VERIFIED; one E2E flake |
| CDEX-013 CSP ausente | MEDIUM | OPEN |

Detalle completo: `artifacts/codex/CODEX_FINDINGS.md`.

## Mercado Pago Integration Review

**Scope**: full  
**API detected**: Payments API for reconciliation/refunds; Checkout Pro preferences for checkout  
**Products detected**: Checkout Pro + seller OAuth  
**Files analyzed**: payment Edge Functions, shared runtime/OAuth/crypto/webhook modules, payment migrations, browser repositories, tests and live deployed copies.

### CRITICAL

- None.

### WARNINGS

- HIGH: production payment outbox dispatcher lacks its two Vault entries.
- HIGH: deployed hosted runtime does not bind project to expected App ID.
- HIGH: deployed hosted runtime can fall back to a global access token.
- Quality-only: payer/descriptor metadata is incomplete.

### PASS

- HMAC validation, provider read-back, seller/tenant binding, server price, idempotency, RLS and post-OAuth disabled default are implemented.

### Quality Standards

#### Required fields

| # | Field | Status | Evidence |
|---|---|---|---|
| 1 | item quantity (N/A official text) | Implemented | `mercadopago.ts:73-80` |
| 2 | unit price (N/A) | Implemented | `mercadopago.ts:73-80` |
| 3 | statement descriptor | Missing | absent from `preferenceRequest` |
| 4 | back URLs | Implemented | `mercadopago.ts:103-107` |
| 5 | webhooks | Implemented | `mercadopago.ts:102` |
| 6 | external reference | Implemented | `mercadopago.ts:101` |
| 7 | payer email | Missing | no payer object |
| 8 | payer first name (N/A) | Missing/N/A | no payer object |
| 9 | payer last name | Missing | no payer object |
| 10 | item category (N/A) | Missing/N/A | not sent |
| 11 | item description | Partial | sent when catalog presentation exists |
| 12 | item id (N/A) | Implemented | `mercadopago.ts:74` |
| 13 | item title (N/A) | Implemented | `mercadopago.ts:75` |
| 14 | backend SDK | Implemented | official SDK validator pinned at webhook boundary |

#### Best practices

| # | Practice | Status | Evidence |
|---|---|---|---|
| 1 | binary mode | Missing | absent by design |
| 2 | offline expiration | Partial | offline default false; preference has general expiry |
| 3 | ads integration | Missing | out of payment security scope |
| 4 | preference term | Implemented | expires/from/to |
| 5 | max installments | Implemented | settings-derived |
| 6 | modal | Missing | controlled redirect used |
| 7 | official logo | Missing | no asset/markup found |
| 8 | response messages | Implemented | return/status UI states |
| 9 | excluded payment methods | Missing | no method IDs |
| 10 | excluded payment types | Implemented | ticket excluded by default |
| 11 | shipment amount | Partial | server delivery fee emitted as dedicated item |
| 12 | get/search notified payment | Implemented | worker/status provider read-back |
| 13 | chargebacks | Partial | fetch/persist exists; documentation upload absent |
| 14 | cancellations | Implemented | authenticated/idempotent API |
| 15 | refunds | Implemented | authenticated/idempotent API |
| 16 | settlement report | Missing | no provider settlement report |
| 17 | all-transactions report | Partial | internal list exists, not provider release report |
| 18 | payer address | Missing | not sent to provider |
| 19 | payer identification | Missing/N/A | not sent |
| 20 | payer phone | Missing/N/A | not sent |
| 21 | MLM identification | N/A | MLA integration |
| 22 | frontend SDK | Missing | redirect flow, no MercadoPago.js V2 |

### Security checklist (cross-cutting)

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | tokens only server-side | PASS | env + encrypted seller table |
| 2 | `.env` ignored | PASS | root/supabase gitignore |
| 3 | HMAC webhook | PASS | official SDK + freshness |
| 4 | HTTPS URLs | PASS | URL guards and derived Supabase endpoint |
| 5 | status verified server-side | PASS | provider GET + snapshot RPC |
| 6 | idempotency key | PASS | persisted key/header |
| 7 | external reference | PASS | unique intent reference |
| 8 | no test credentials in deploy | PASS | secret scan/runtime inspection |
| 9 | no sandbox init URL usage | PARTIAL | never selected, but deprecated field is still persisted |

### Recommendations

1. Provision and verify production worker Vault URL/HMAC without enabling payments.
2. Review and deploy the local App-ID/OAuth-mode fail-closed patch after approval.
3. Perform post-OAuth identity/binding/settings checks; keep `enabled=false`.
4. Resolve release remote/migration drift, then recertify worker/webhook/outbox.
5. Only then authorize a tightly controlled real-payment smoke.

**Summary**: actionable required fields 4 implemented, 1 partial, 3 missing (six marked N/A by provider); best practices 7 implemented, 4 partial, 11 missing. 8/9 cross-cutting security checks pass, but three independent HIGH findings block production.

---

## Implementation Report

### Verified

- [x] Webhook validates `x-signature` with official HMAC SDK and provider read-back.
- [x] Server calculates price/discount/delivery and binds product/business/customer.
- [x] OAuth state is strong, one-time, expiring and PKCE S256.
- [x] Seller tokens are AES-256-GCM protected with tenant/environment AAD.
- [x] OAuth production completion leaves payments disabled.
- [x] Current production has no settings, seller, token, intent or money path.

### Needs attention

- [ ] Provision production worker Vault URL/HMAC and verify dispatch.
- [ ] Review/deploy `audit/codex-production-hardening` after approval.
- [ ] Push RC provenance normally and reconcile the one missing migration.
- [ ] Document kill-switch outstanding-preference semantics.
- [ ] Add optional payer/descriptor quality metadata after security blockers.

### Blockers (must fix before production)

- [ ] CDEX-001: payment worker cannot be dispatched automatically in production.
- [ ] CDEX-002: production does not enforce its expected Mercado Pago App ID.
- [ ] CDEX-004: production can bypass seller OAuth through global credentials.

### Next steps

1. Keep production payments disabled; Walter may complete OAuth only.
2. Approve/remediate the three HIGH items and run post-OAuth read-only checks.
3. Re-run full payment, webhook, local PostgreSQL and E2E suites before real smoke.

### Resources used

- Local code/history/lock/test inspection and cross-cutting security floor.
- Supabase connector: live read-only project/schema/function/grant/data-state/advisor queries on both refs.
- Mercado Pago MCP: application list, production `quality_checklist`, notification history (no notifications found).
- Official Mercado Pago webhook documentation and official SDK release page, accessed 2026-09-08.
- Skill: `mp-review` v4.3.2 and `mp-webhooks` v4.3.2.

**Scores**: official actionable required 4 implemented / 1 partial / 3 missing; best practices 7 implemented / 4 partial / 11 missing; security 8/9. **Verdict**: Blocked.
