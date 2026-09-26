# Mercado Pago — cierre técnico del 2026-09-25

Rama `feat/mercadopago-production-finalization` desde `fa7e468` (HEAD verde de
#98 = `release/taba-controlled-production` `247eec7` + docs y un test E2E).
Todo lo que sigue se midió contra Mercado Pago y contra Supabase **Staging**
(`ucbtjcurawxjwjdvvcvj`) el 2026-09-25 entre las 16:40 y las 17:55 UTC.
CONTROLLED_PRODUCTION (`tkanbadcglszlcyfjvpv`) sólo se leyó.
No se movió dinero real, no se conectó ninguna cuenta real y no se simuló ningún webhook.

## 1. Veredicto

| Gate | Resultado |
|---|---|
| ONLINE_PAYMENTS_TECH_READY | **NO** — ver §9 |
| Checkout Pro con APP_USR directo (lo que pidió soporte) | aprobado, sin bloqueo de identidad (con saldo de la cuenta de prueba, no con tarjeta) |
| Checkout Pro con la arquitectura productiva (token OAuth del vendedor) | **falla en el proveedor**: `challenge → reauth → «Oh, no, algo anduvo mal»` |
| Webhook real | llega y reintenta; **firma no validada** para el pago del APP_USR directo |
| Correlación / idempotencia / reembolso en La Taba | **no ejecutables** con ese pago: el token OAuth no lo ve |
| Seguridad OAuth (PKCE, state, replay, binding, RLS) | **34/34 PASS** en vivo |
| Desconexión y reconexión real del vendedor de prueba | **16/16 PASS** |
| Pago manual aislado de Mercado Pago | PASS (pgTAP + lectura en CP) |
| Integridad de stock en las 4 sesiones reales | PASS |
| Configuración de Mercado Pago en CONTROLLED_PRODUCTION | **NO CONFIGURADA** (nada desplegado; ver §7) |

## 2. Arquitectura, sin mezclar prueba y producción

```
PRODUCCIÓN (marketplace)                      PRUEBA pedida por soporte (WCS-51579)
comercio → «Conectar Mercado Pago»            APP_USR de «Credenciales de prueba»
  → mercadopago-connect (PKCE S256, state)      (app 4861627125869370, vendedor 3594962708)
  → Mercado Pago consentimiento               → preferencia nueva
  → mercadopago-oauth-callback                → response.init_point
  → tokens AES-GCM en mp_seller_connections   → comprador de prueba 3594962710
cliente → mercadopago-create-checkout-session → Checkout Pro
  → mercadopago-create-preference
    (token OAuth de ESE vendedor)
  → init_point → pago → webhook firmado
  → worker → pedido
```

El runtime productivo no tiene ni usa un APP_USR global: los proyectos alojados
exigen `MERCADOPAGO_CREDENTIAL_MODE=oauth` y rechazan `MERCADOPAGO_ACCESS_TOKEN`.
El APP_USR directo sólo vive en el Credential Manager de la PC del operador y sólo
lo usa el arnés de certificación de Staging
(`scripts/mercadopago/certificacion-app-usr-directo/`).

## 3. La prueba exacta de soporte: APP_USR directo

| Dato | Valor |
|---|---|
| Credencial | APP_USR de «Credenciales de prueba» de TABA2 Staging (`2691240967769590`); aplicación de la credencial `4861627125869370`, usuario `3594962708`, `test_user`, MLA; huella `1b878d3f1e0c` = la verificada contra el panel el 2026-09-22 |
| Preferencia | `3594962708-dc86c262-558d-4791-9218-a0b254774ceb`, creada 17:00:42Z (14:00:42 AR), x-request-id `a4870ddc-3184-41d8-94bd-74c63dc3f382` |
| collector / client / site | `3594962708` / **`4861627125869370`** / `MLA` — el `client_id` es la aplicación de la credencial de prueba, no la integradora |
| Pedido La Taba | checkout `fd4883ec-71a6-4c7d-8f5a-8120a65eb676`, intent `e5dbaf33-43e4-42aa-9e12-601c0888ae60` (creados por los Edge Functions normales; la preferencia se armó con `preferenceRequest()` del Edge Function y se registró con `record_mercadopago_preference_created_v2`) |
| Apertura | exactamente `response.init_point` (`www.mercadopago.com.ar/checkout/v1/redirect?pref_id=…`); nunca `sandbox_init_point`; Mercado Pago lo sirvió en `www` (checkout productivo de prueba) |
| Navegador | Chrome 149.0.7827.201, contexto nuevo y efímero, automatizado (Playwright), Windows 11 |
| Comprador | `3594962710` (≠ vendedor), login con usuario + contraseña |
| Flujo | `8ffc0bd8-7245-4a30-bd78-18469a86a2c8`: revisión → Pagar → `/challenge/` → `GET /checkout/v1/payment/api/reauth` 200 (x-request-id `99455c12-7a92-447e-8d2d-2663ed06556f`) → `congrats/approved` a las 17:04:21Z |
| Pago | `179851082485`, **approved / accredited**, ARS 1800, collector `3594962708`, payer `3594962710`, `live_mode=true`, merchant order `44731115583`, preferencia y `metadata.payment_attempt_id` coincidentes |
| Medio | **`account_money`** (saldo ficticio del comprador de prueba). Mercado Pago lo preseleccionó y la automatización no forzó la tarjeta: la tarjeta APRO **no** se probó con el APP_USR directo |

Lo que pasó después, medido:

- **Webhook**: Mercado Pago notificó enseguida y reintentó (17:04:22–17:04:24, 17:20:51, 17:22:19; `payment` y `merchant_order`). **Todas** las firmas fallaron contra `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` (recibos `rejected_signature`; x-request-id `13c6fb69-f657-4b7e-b71f-04df4fe10e8b`, `9181cd2b-c961-4851-8218-522aa417c11d`, `5434edb2-620b-4c91-a268-3eb23f4f7745`, `90c3efb8-ab1d-400c-a0d8-f8d62ad6c798`, `f8b87579-60a7-4047-93ca-3bbca7a3f810`, `77fcaef8-bc43-4053-bd98-4c39bf009538`). Coincide con lo observado en agosto: esas notificaciones las firma la aplicación de la credencial de prueba, cuya clave el panel no expone.
- **La Taba no puede ver ese pago**: el worker, leyendo con el token OAuth del vendedor (aplicación integradora), registró `payment.provider_probe_empty` siete veces para una referencia que el token directo encuentra aprobada. Mercado Pago acota las lecturas del token OAuth a los pagos creados por su propia aplicación. La sesión venció a las 17:15:37 y el stock volvió.
- **Reembolso**: la credencial directa responde **401 `unauthorized`** a `POST /v1/payments/179851082485/refunds` (x-request-id `b854c671-b5f4-46fd-b6b3-70e431c05bc5`, `748234e9-1d3a-4d16-8f5e-7f9f4746634f`). El pago (dinero ficticio) sólo se puede devolver desde la cuenta del vendedor de prueba.

**Conclusión estructural:** el gate pedido (APP_USR directo + webhook firmado +
correlación + idempotencia + reembolso en La Taba) no se puede cumplir con un
mismo pago. El pago del APP_USR directo pertenece a otra aplicación: la
arquitectura productiva no lo lee, no valida su firma y no lo puede reembolsar.
Eso es la separación prueba/producción funcionando, no un defecto a parchear.

## 4. La misma compra por la arquitectura productiva

| Dato | Valor |
|---|---|
| Preferencia | `3594962708-cfa1008b-b101-44c5-8b0d-9387a7cf6062`, creada por `mercadopago-create-preference` con el token OAuth del vendedor, 17:27:49Z (14:27:49 AR) |
| collector / client / site | `3594962708` / **`2691240967769590`** / `MLA` |
| Pedido La Taba | checkout `9c473dee-2498-4363-82ec-8a4c259a0890`, intent `10ab9f66-9244-4d8d-8872-bc31ea4dec8b` |
| Apertura | `response.init_point` en `www`; **Mercado Pago redirigió solo a `sandbox.mercadopago.com.ar`** (comportamiento del proveedor, no se tocó); flujo `liveMode=false` |
| Compra | mismo comprador `3594962710`; Mastercard de prueba …0604, titular APRO, DNI 12345678, 1 cuota |
| Flujo | `4c4a42bf-a3d4-45bc-b28c-c6822bd90144`: Pagar 17:28:51Z → `/challenge/` → `GET /checkout/v1/api/reauth` 200 (x-request-id `ec1f08bf-fc74-419c-bb50-d4fc380d1b51`) → `PUT /checkout/v1/api/flow` (x-request-id `f4effcd9-1b01-46eb-8772-59b3d7c2cb54`) → `/error/` «**Oh, no, algo anduvo mal**» 17:28:54Z |
| Pago | ninguno (la sonda del worker devuelve vacío) |

Es el síntoma de WCS-51579, reproducido con IDs nuevos. Comparación del mismo día,
mismo comprador y vendedor, mismo navegador:

| Preferencia creada con | Host | Medio | Después de Pagar |
|---|---|---|---|
| APP_USR directo | `www` | saldo | challenge → reauth → **aprobado** |
| Token OAuth (producción) | `sandbox` | tarjeta APRO | challenge → reauth → **error** |
| Token OAuth, Chrome normal sin automatización (§4.1) | `sandbox` | tarjeta APRO | challenge → reauth → **error** |

Quedan dos celdas sin medir para aislar la causa: APP_USR directo + tarjeta, y
OAuth + saldo. Por la regla de un solo intento automatizado, se piden como
prueba manual de control (§10).

### 4.1 Prueba de control en Chrome normal (21:00 UTC)

Para descartar que el error lo provoque la automatización (Playwright/CDP), se
repitió **una vez** en un Chrome 149 normal: perfil temporal aislado, incógnito,
sin flags de automatización ni depuración. Se operó con UI Automation de Windows
y teclado/mouse reales (SendInput), como una persona.

| Dato | Valor |
|---|---|
| Preferencia | `3594962708-d0c58b5a-a046-4acf-8b64-351f8dac3add`, creada por `mercadopago-create-preference` con el token OAuth, 20:47:19Z (17:47:19 AR). collector `3594962708`, client **`2691240967769590`**, `MLA` |
| Pedido La Taba | checkout `3853a26e-1c3e-4622-a783-f947e7d2f06a`, intent `b8a1f248-ab6b-494b-bda2-b2ad8e312b16` |
| Apertura | `init_point` en `www` → redirigido por MP a `sandbox` (x-request-id del redirect `85ccc64a-b525-4cd5-afe3-9310db12cb54`) |
| Comprador | `3594962710` (TEST), login con contraseña, sin código; la revisión mostraba sólo la tarjeta, sin dinero disponible |
| Medio | Nueva tarjeta: Mastercard …0604, APRO, 11/30, DNI 12345678, 1 cuota |
| Flujo | `22d28891-43ff-4804-acae-bfba158b4196`. Pagar 21:00:04Z → `PUT /checkout/v1/api/flow` (`7cd7a20f-aeaa-4b5e-9c8b-7f58f2c7102e`) → `GET /checkout/v1/api/reauth` 200 (`276bf99e-49b4-49c9-852d-2c93e47238af`) → `PUT /checkout/v1/api/flow` (`fcd81ecb-9466-4832-a670-68472889883b`) → `/error/` «**Oh, no, algo anduvo mal**» 21:00:10Z |
| Al cargar la tarjeta | `POST /checkout/v1/api/bricks/card-form/association` **404** (`64e1099d-7847-4866-ab59-d17f1d157f84`), seguido de `POST /checkout/v1/api/error` (`293a96b4-4780-4dd4-ad23-04370227aff0`); igual en la corrida automatizada |
| Pago | ninguno: `GET /v1/payments/search` por external_reference total 0 (`718926ae-2fef-4453-88d6-278cecfe7731`); 0 recibos, 0 pedidos |
| Stock | la sesión venció 21:02:14Z; reserva liberada 21:03:00Z; producto de vuelta en 42 |

El resultado es el mismo que con Playwright: la automatización no es la causa.
Un primer flujo (`5e24bebb-8507-4cda-a64e-68d8f4e95025`) se descartó antes de
pagar. Se tipeó el usuario incompleto y el login devolvió
`/login/identification/not-found` (código `LGN83-O2G42TB6STQB`).
Después del error no se presionó «Reintentar» ni se hicieron intentos
equivalentes.

## 5. Defectos encontrados y corregidos

| Commit | Defecto | Efecto |
|---|---|---|
| `1b0e9f1` | `GET /checkout/preferences/search` devuelve `total` arriba (sin `paging`); el código leía `paging.total` | con el código commiteado **ninguna** preferencia se podía crear; Staging andaba sólo porque su create-preference v7 tenía un arreglo sin commitear (verificado descargándolo) |
| `1b0e9f1` | el ruteo del webhook OAuth exigía `live_mode=false` en test | los pagos de prueba informan `live_mode=true` (medido: pago 179851082485); esas notificaciones habrían muerto en 503 para siempre. Producción sigue exigiendo `true` |
| `a6b0d51` | Staging sin secretos de Vault desde la mudanza de proyecto: el worker de pagos **nunca** se despachó (0 despachos, 24 trabajos pendientes); la herramienta HMAC apuntaba al ref muerto | herramienta corregida y Staging provisto: el primer turno firmado procesó 20 trabajos y el cron el resto |
| `93ed91b` | la disponibilidad de Mercado Pago no miraba la conexión del vendedor | con el token rechazado o un refresh ambiguo, el cliente veía la opción, se reservaba stock y recién la preferencia fallaba. Migración `20260925170000` + chequeo previo en `mercadopago-create-checkout-session` |
| `c760ff1` | CONTROLLED_PRODUCTION no tenía binding OAuth ni lugar en la tooling productiva | binding dormido + objetivos `controlled-production` en setup, verificador y worker |
| `f8ffa07` | la frontera pago manual / Mercado Pago no tenía prueba | 5 aserciones pgTAP |
| este cierre | `mercadopago-create-checkout-session` y `mercadopago-checkout-status` no figuraban en `supabase/config.toml` | un `functions deploy` común les habría puesto `verify_jwt=true` y el preflight CORS del storefront moriría en 401; se fijaron en `false` (lo que tienen desplegado) |

Desplegado en Staging (sólo funciones): primero `mercadopago-webhook` y
`mercadopago-create-preference` desde `1b0e9f1` (para medir); después, con el CI
del candidato en verde (`8ad8dec`: E2E 559, pgTAP, restore, Windows, Rider), las
nueve funciones de Mercado Pago a las 18:38 UTC, con `verify_jwt` preservado
(refund y cancel `true`, el resto `false`) y el código desplegado comparado byte
a byte con la rama. Smoke del candidato: seguridad OAuth 34/34, webhook sin
firma 401, preflight CORS 204, checkout + preferencia OAuth por el camino con
el chequeo nuevo (`3594962708-8361b4e4-8d38-41e3-9a22-2ee80cc0d5b9`, collector,
aplicación y sitio coincidentes; vence sin pago) y E2E de cobro manual contra
Staging con el storefront de esta rama. La migración
`20260925170000` **no** se aplicó en Staging: Staging no tiene las tres
migraciones de CP anteriores y `20260925090000` cambia los grants por columna de
`products`, lo que puede romper el storefront de Staging que usa Codex. La regla
nueva se evaluó en lectura contra los negocios de Staging (mismo resultado) y la
prueba el pgTAP de CI.

## 6. Seguridad y ciclo de vida del vendedor (en vivo, Staging)

`scripts/mercadopago/certificar-oauth-staging.mjs` — **34/34 PASS**: sin sesión 401;
cliente, staff y dueño de otro negocio 403; desconectar exige confirmación; el
estado nunca expone material; URL de autorización con `client_id`, callback exacto,
`read write offline_access`, PKCE S256 (challenge de 43, verifier fuera de la URL);
state de 256 bits guardado sólo como digest, ligado a negocio, usuario y entorno,
TTL 10 min, reemplazado por un nuevo inicio; callback rechaza state ausente,
ajeno, reemplazado, código inventado (Mercado Pago `invalid_grant`, state
consumido), repetición y parámetros duplicados (sin consumir el state); el
consentimiento denegado se consume y no se repite; `mp_seller_connections` y
`mp_oauth_states` ilegibles y las RPC de tokens no invocables con anon, cliente o
dueño; la conexión existente queda intacta.

Verifier ausente o equivocado: el verifier nunca sale del servidor; sellado con
AES-GCM y AAD por proyecto/entorno/app/negocio/propósito, un material de otro
negocio, entorno o clave, o alterado, no se abre (tests de Node). La comparación
verifier↔challenge la hace Mercado Pago en `/oauth/token`.

`scripts/mercadopago/certificar-reconexion-staging.mjs` — **16/16 PASS**:
desconectar destruye el material, invalida el binding (nueva generación,
configuración apagada), conserva el seller como guarda, preserva historial
(27 intents / 54 pedidos / 27 sesiones), deja de ofrecer Mercado Pago, impide
iniciar checkout (409) y «Verificar» no afirma conexión. La reconexión emitió un
state nuevo, el vendedor de prueba consintió en Mercado Pago y volvió **el mismo
vendedor** con generación y tokens nuevos, un único binding, configuración
rehabilitada, historial intacto; «Verificar conexión» contra `/users/me`: 200.

## 7. CONTROLLED_PRODUCTION: configuración de Mercado Pago

Leído el 2026-09-25: **0 Edge Functions, 0 secretos, 0 entradas de Vault, 0
conexiones, 0 configuraciones**. El storefront de CP dice «Cobros online · No
habilitados en esta etapa». Falla cerrado por construcción.

La aplicación productiva del código es La Taba Delivery (`7677852968049976`).
Su callback y webhook registrados no se pueden auditar sin la cuenta del dueño:
`auth.mercadopago.com.ar/authorization` pide login antes de validar el
`redirect_uri` (probado con un redirect inválido). Pasos para activarla (§10).

Webhook productivo, auditado en código: HTTPS (proxy `x-forwarded-proto`),
firma con el validador oficial del SDK + ventana de 5 min, recibo durable antes
de responder 201, deduplicación por (entorno, evento, tipo, recurso), cola con
leases y reintentos, lectura del pago con el token del vendedor, correlación
vendedor → conexión → pago → intent del mismo negocio y entorno. Una
notificación firmada que no se puede rutear responde 503 y Mercado Pago la
reintenta: se prefirió reintentar a perder un pago.

## 8. Pago manual, stock y observabilidad

- **Pago manual**: CHECK + trigger + comandos que rechazan todo lo que no sea
  `cash`/`coordinate`; los pedidos manuales no tienen intent, así que no hay
  reembolso ni webhook de Mercado Pago posible. pgTAP `payment_method_isolation`;
  la guarda leída en vivo en CP.
- **Stock**: las cuatro sesiones reales del día (dos abandonadas, una pagada
  pero invisible, una con error del proveedor) liberaron su reserva una sola vez,
  ~1 min después de vencer (`checkout_expired`); el producto volvió a 42.
- **Observabilidad**: `audit()` registra evento, negocio y correlation id;
  recibos con `request_id`, hash del payload y validez de firma; eventos de pago
  con fuente (`webhook`/`reconciliation`/`provider_truth_sweep`). Barrido de
  secretos de esta rama (15 secretos reales comparados en memoria + patrones,
  archivos cambiados, historia de la rama, evidencia local): 0 hallazgos.

## 9. Por qué ONLINE_PAYMENTS_TECH_READY sigue en NO

1. Ningún pago de Checkout Pro aprobado pasó por la arquitectura productiva:
   con el token OAuth el proveedor corta con error (WCS-51579 sigue vigente).
2. En consecuencia no hay evidencia real de webhook firmado por la aplicación
   integradora, correlación, idempotencia ni reembolso sobre un pago aprobado.
3. Mercado Pago no está configurado en CONTROLLED_PRODUCTION.

Todo lo que no depende de ese pago quedó hecho y medido.

## 10. Acciones humanas

> La activación productiva en CONTROLLED_PRODUCTION (aplicación La Taba Delivery, secretos, conexión de Walter, interruptor por negocio, pago y reembolso de control, rollback) sigue en [MERCADOPAGO_PRODUCCION_CP.md](MERCADOPAGO_PRODUCCION_CP.md).

1. **Prueba de control OAuth**: hecha (§4.1), mismo error. No se repiten pagos
   equivalentes hasta que Mercado Pago responda.
2. **WCS-51579**: publicar el texto de §11 desde la cuenta de Mercado Pago
   Developers del dueño (el ticket vive en esa sesión) y pedir el motivo interno
   del `reauth` → error de los flujos `4c4a42bf-a3d4-45bc-b28c-c6822bd90144` y
   `22d28891-43ff-4804-acae-bfba158b4196`.
3. **Firma del webhook de Staging**: en Tus integraciones → TABA2 Staging →
   Webhooks → Simular notificación (pago); el recibo tiene que quedar con
   `signature_valid=true`. Si no, recargar la firma con
   `scripts/mercadopago/configurar-webhook-staging.ps1`.
4. **Producción (CP)**, cuando se decida: en La Taba Delivery registrar
   `https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/mercadopago-oauth-callback`
   y el webhook `…/functions/v1/mercadopago-webhook` (Pagos); correr
   `scripts/mercadopago/configurar-oauth-produccion.ps1 -Target controlled-production`;
   `sincronizar-worker-hmac.mjs --target=controlled-production --apply`; desplegar
   funciones y aplicar `20260925170000` con el proceso de CP.
5. **Pago real**: no autorizado. Conectar la cuenta real de Walter y una compra
   real mínima requieren autorización explícita.

## 11. Texto para WCS-51579

> Se reprodujo exactamente con APP_USR directo, init_point y buyer test según la
> instrucción de soporte, y además con la preferencia creada por nuestro token
> OAuth del vendedor. 2026-09-25, Chrome 149 en Windows 11, sesiones nuevas,
> automatizadas.
> 1) APP_USR directo de Credenciales de prueba (app 4861627125869370, vendedor
> 3594962708): preferencia 3594962708-dc86c262-558d-4791-9218-a0b254774ceb,
> init_point en www, comprador 3594962710. Flujo 8ffc0bd8-7245-4a30-bd78-18469a86a2c8:
> challenge → reauth (x-request-id 99455c12-7a92-447e-8d2d-2663ed06556f) →
> aprobado, pago 179851082485, 17:04:21 UTC (14:04:21 AR), con dinero disponible.
> 2) Token OAuth del vendedor por nuestra app 2691240967769590: preferencia
> 3594962708-cfa1008b-b101-44c5-8b0d-9387a7cf6062, init_point redirigido por MP a
> sandbox.mercadopago.com.ar, mismo comprador, tarjeta de prueba APRO. Flujo
> 4c4a42bf-a3d4-45bc-b28c-c6822bd90144: challenge → reauth (x-request-id
> ec1f08bf-fc74-419c-bb50-d4fc380d1b51) → flow (f4effcd9-1b01-46eb-8772-59b3d7c2cb54)
> → «Oh, no, algo anduvo mal», 17:28:54 UTC (14:28:54 AR).
> 3) Prueba de control, mismo caso 2 en un Chrome 149 normal (Windows 11, perfil
> nuevo, incógnito, sin automatización del navegador), 2026-09-25:
> preferencia 3594962708-d0c58b5a-a046-4acf-8b64-351f8dac3add (collector
> 3594962708, client_id 2691240967769590, MLA), init_point en www redirigido a
> sandbox (x-request-id 85ccc64a-b525-4cd5-afe3-9310db12cb54). Comprador de
> prueba 3594962710 logueado con contraseña; Nueva tarjeta Mastercard de prueba
> …0604 a nombre de APRO, DNI 12345678, 1 cuota; sin dinero disponible.
> Flujo 22d28891-43ff-4804-acae-bfba158b4196:
> - Pagar 21:00:04 UTC (18:00:04 AR) → PUT /checkout/v1/api/flow (x-request-id 7cd7a20f-aeaa-4b5e-9c8b-7f58f2c7102e)
> - → challenge → GET /checkout/v1/api/reauth 200 (x-request-id 276bf99e-49b4-49c9-852d-2c93e47238af)
> - → PUT /checkout/v1/api/flow (x-request-id fcd81ecb-9466-4832-a670-68472889883b)
> - → «Oh, no, algo anduvo mal», 21:00:10 UTC. No se creó ningún pago.
>
> Al cargar la tarjeta, POST /checkout/v1/api/bricks/card-form/association
> respondió 404 (x-request-id 64e1099d-7847-4866-ab59-d17f1d157f84), en los dos
> casos con sandbox.
>
> Diferencia de aplicaciones entre los casos:
> DIRECT TEST APP CLIENT_ID: 4861627125869370 (aplicación de las Credenciales de
> prueba; su preferencia se abrió en www y aprobó).
> OAUTH INTEGRATION APP: 2691240967769590 (nuestra aplicación integradora,
> TABA2 Staging; su preferencia, creada con el token OAuth del vendedor de
> prueba, se abrió en sandbox y termina en error).
>
> Pedimos:
> a) Confirmar explícitamente si esa separación de aplicaciones es la esperada
> para probar Checkout Pro. Y si una preferencia creada con el token OAuth de un
> vendedor de prueba, a través de la aplicación integradora, debe abrirse en
> sandbox.
> b) Correlacionar internamente los request IDs de arriba y decirnos el motivo de
> challenge → reauthentication → error en los flujos
> 4c4a42bf-a3d4-45bc-b28c-c6822bd90144 y 22d28891-43ff-4804-acae-bfba158b4196.
> c) Indicar cómo completar una compra de prueba aprobada con la aplicación
> integradora (tarjeta, cuenta o configuración necesaria).
>
> No vamos a repetir pagos equivalentes hasta su respuesta.

La evidencia completa (JSON y capturas sin secretos) queda fuera del
repositorio, en `%TEMP%\la-taba-mp-directo\` de la PC del operador.
