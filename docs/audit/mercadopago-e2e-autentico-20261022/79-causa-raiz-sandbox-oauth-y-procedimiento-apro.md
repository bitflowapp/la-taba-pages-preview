# 79 — Causa raíz del rechazo de Checkout Pro y procedimiento APRO

Rama `fix/mp-oauth-app-usr-credentials-20261023`, apilada sobre
`fix/astra2-ledger-worker-preview-20261022` (PR #148). Sin merge, sin cambios en
producción y sin secretos.

## 1. Causa raíz (defecto de La Taba)

`tokenGrant()` (`supabase/functions/_shared/seller-oauth.ts`) enviaba
`test_token: true` a `POST /oauth/token` cuando el entorno era `test`, y además
**exigía** `live_mode=false` en la respuesta. Según la documentación oficial,
ese parámetro sirve para *«generar credenciales de sandbox para pruebas»*. Así,
el vendedor de prueba 3594962708 quedó conectado con un token sandbox
(`TEST-`), no con su credencial `APP_USR-`.

Una preferencia creada con un token sandbox:

1. devuelve un `init_point` en `www`, pero Mercado Pago lo **redirige** a
   `sandbox.mercadopago.com.ar` (flujo `liveMode=false`);
2. en ese checkout, `POST /checkout/v1/api/bricks/card-form/association`
   responde 404 y todo pago con tarjeta termina en *«Oh, no, algo anduvo mal»*;
3. no se crea ningún pago, ningún pedido ni ningún recibo, y el stock vuelve
   cuando vence la sesión.

Ese es exactamente el síntoma de APRO, OTHE y CONT: todas llegaron a «Pagar» y
terminaron en error, sin pagos, sin pedidos y con el stock consistente.

**Evidencia previa del repositorio** (`docs/MERCADOPAGO_FINALIZATION_2026-09-25.md` §3, §4 y §4.1).
Mismo comprador, mismo vendedor y mismo navegador:

| Preferencia creada con | Host final | Resultado |
|---|---|---|
| `APP_USR` del vendedor de prueba (credencial directa) | `www` | **aprobado** (pago 179851082485, `live_mode=true`) |
| token OAuth de La Taba (obtenido con `test_token: true`) | redirigido a `sandbox` | error (flujos `4c4a42bf…` y `22d28891…`) |

**Documentación oficial actual:**

- Las credenciales de prueba de Checkout Pro son las del **vendedor de prueba**,
  y *«your test Access Token starts with the prefix `APP_USR`»*.
- Comprador y vendedor tienen que ser cuentas de prueba del mismo país (MLA).
- Las compras de prueba se hacen con el comprador de prueba, en una ventana de
  incógnito.

La comparación de §4 aislaba la variable *aplicación/token*, y la única
diferencia entre los dos tokens es el tipo de credencial. Los 34 controles de
OAuth en vivo (PKCE, state, binding y RLS) siguen siendo válidos: el defecto
no está en la seguridad, está en el tipo de credencial que se pedía.

## 2. Corrección (mínima)

`supabase/functions/_shared/seller-oauth.ts`:

- `tokenGrant()` ya no envía `test_token`, ni al autorizar ni al renovar.
- La respuesta se rechaza si `access_token` no empieza con `APP_USR-`
  (`isSandboxAccessToken`). Producción sigue exigiendo `live_mode === true`. En
  test ya no se exige `live_mode=false`, porque un `APP_USR` de un usuario de
  prueba informa `true`.
- Un grant sandbox **ya guardado** no se usa: `sellerAccessToken()` lanza
  `SELLER_REAUTHORIZATION_REQUIRED` (409) sin llamar al proveedor. Así no se
  vuelve a generar un checkout que no se puede pagar. Al renovar ese grant
  también se falla cerrado: la respuesta no es `APP_USR-` y el grant cifrado se
  conserva.

**La garantía de «no hay dinero real en QA» no cambia.** `sellerIdentity()`
exige la etiqueta `test_user` de `/users/me` en el callback y antes de cada
preferencia (`assertCurrentSellerPaymentAuthority`). La base exige
`live_mode=true` solo en producción.

`scripts/recovery/payment-preflight.mjs`: `non_test_intents` contaba como «no
test» un intent de prueba con `live_mode=true`, y eso es lo que informa un pago
APRO aprobado entre usuarios de prueba. Ahora cuenta por `environment`.

**Sin cambios** en SQL, migraciones, stock, efectivo, reembolsos, conciliación,
webhook ni frontend.

## 3. Verificación local

| Control | Resultado |
|---|---|
| Regresiones nuevas contra el código anterior | 4 fallan (reproducción) |
| `seller-oauth-runtime.deno.ts` con la corrección | 19/19 |
| `npm run test:webhook` (Deno + Node) | 52 + 208 + 12, 0 fallas |
| `npm run test:payments` | 221 pass, 0 fail (1 omitida) |
| `npm test` (suite completa) | 3124 pass, 0 fail (1 omitida) |
| `npm run check:edge` (tipos de las Edge Functions) | OK |
| `npm run secrets:scan` | sin hallazgos |

Los fixtures de tokens pasaron a `APP_USR-…`, porque así son los tokens reales,
y quedaron por debajo del umbral del escáner de secretos.

## 4. Procedimiento exacto para Codex local: UNA compra APRO

**Reglas:**

- Proyecto QA `ixewllzzuzpqrkxzmfzx`, aplicación `2691240967769590`, negocio QA A.
- Un solo intento de pago.
- No reintentar después de un error: capturar la evidencia y detenerse.
- No escribir secretos en archivos ni en la consola.

Guardar toda la evidencia en `%TEMP%\la-taba-apro-20261023\e.jsonl`
(`--evidence`). Abajo se escribe `$E` para esa ruta.

### 4.0 Preparación

```powershell
git fetch origin fix/mp-oauth-app-usr-credentials-20261023
git checkout fix/mp-oauth-app-usr-credentials-20261023
npm ci; npm run test:webhook          # esperado: 0 fallas
node scripts/recovery/qa-mp-e2e.mjs counts               # línea base: anotar ordersQA, intents, validReceipts
node scripts/recovery/qa-mp-e2e.mjs inspect --session <cualquier sesión previa>   # opcional: stock de QA-REC-001
```

### 4.1 Desplegar en QA las 8 funciones afectadas (solo QA)

```powershell
$F="mercadopago-connect,mercadopago-oauth-callback,mercadopago-create-preference,mercadopago-checkout-status,mercadopago-webhook,mercadopago-payment-worker,mercadopago-refund,mercadopago-cancel-payment"
node scripts/recovery/sync-hosted.mjs --target deploy/recovery-free-hosted.json --functions $F --evidence $E           # ensayo
node scripts/recovery/sync-hosted.mjs --target deploy/recovery-free-hosted.json --functions $F --evidence $E --apply
node scripts/recovery/verify-functions.mjs --run-tests --gates-only --target deploy/recovery-free-hosted.json --evidence $E
```

`verify_jwt` sale de `config.toml`: refund y cancel en `true`, el resto en `false`.

### 4.2 Confirmar la causa raíz con el grant actual (sin efectos)

```powershell
node scripts/recovery/qa-mp-e2e.mjs verify --evidence $E
```

**Esperado:** HTTP 200 con `verification.credentials_usable: false` y
`blocking_reason: "reauthorization_required"`, aunque la conexión siga
`connected`. Eso prueba que el grant guardado era sandbox. El panel muestra
«Requiere reconexión».

Si en cambio aparece `credentials_usable: true`, la hipótesis queda refutada.
En ese caso, detenerse y enviar solo esa salida.

### 4.3 Reconectar al vendedor de prueba con credencial APP_USR

```powershell
node scripts/recovery/qa-mp-e2e.mjs disconnect-preview --evidence $E    # sin operaciones pendientes
node scripts/recovery/qa-mp-e2e.mjs disconnect --evidence $E
node scripts/recovery/qa-mp-e2e.mjs connect-url --evidence $E           # URL de un solo uso, vence en 10 min
```

La persona abre la URL en una ventana de **incógnito nueva**, entra con el
**vendedor de prueba 3594962708** y acepta.

```powershell
node scripts/recovery/qa-mp-e2e.mjs verify --evidence $E       # 200, credentials_usable=true, mismo seller 3594962708
node scripts/recovery/qa-mp-e2e.mjs activation                 # disponible
node scripts/recovery/qa-mp-e2e.mjs forged-webhooks --evidence $E   # 6/6 → 401
```

### 4.4 Preferencia APRO

```powershell
node scripts/recovery/qa-mp-e2e.mjs window-open --minutes 30 --evidence $E
node scripts/recovery/qa-mp-e2e.mjs checkout --scenario apro --sku QA-REC-001 --qty 1 --evidence $E
```

**Esperado:** `session_http 200` y `preference_http 200`. El `init_point` tiene
que ser `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=3594962708-…`.
Anotar `checkout_session_id` y `total`.

### 4.5 Pago (persona, una sola vez)

1. Abrir el `init_point` en una ventana de **incógnito nueva**, sin la sesión
   del vendedor ni la del dueño de la aplicación.
2. **Control de host:** tiene que quedar en `www.mercadopago.com.ar`. Si
   redirige a `sandbox.mercadopago.com.ar`, **abortar sin pagar** y enviar la
   URL y la hora.
3. Entrar con el **comprador de prueba 3594962710**. Si se pide un código por
   correo, es el que figura en «Cuentas de prueba».
4. Elegir «Nueva tarjeta»:
   - Mastercard `5031 7557 3453 0604`
   - CVV `123`
   - vencimiento `11/30`
   - titular `APRO`
   - DNI `12345678`
   - 1 cuota

   No usar el saldo de la cuenta: el medio a probar es la tarjeta.
5. Esperado: pantalla de pago aprobado y vuelta a `/pago/resultado`. Anotar el
   número de operación y la hora.

### 4.6 Verificación (todas tienen que cumplirse)

```powershell
node scripts/recovery/qa-mp-e2e.mjs session --session <id> --evidence $E
node scripts/recovery/qa-mp-e2e.mjs worker --evidence $E        # solo si el intent aún no está aprobado
node scripts/recovery/qa-mp-e2e.mjs inspect --session <id> --evidence $E
node scripts/recovery/qa-mp-e2e.mjs worker --evidence $E        # segunda pasada: no debe crear nada
node scripts/recovery/qa-mp-e2e.mjs inspect --session <id> --evidence $E
node scripts/recovery/qa-mp-e2e.mjs counts
node scripts/recovery/qa-mp-e2e.mjs orders --limit 3
node scripts/recovery/qa-mp-e2e.mjs window-close --evidence $E
```

| Comprobación | Criterio sobre `inspect` / `counts` |
|---|---|
| Confirmación del proveedor | `payments[0].status=approved`; `intents[0].provider_status=approved` |
| Identidad del pago | `payments[0].seller_id=3594962708`; un único `provider_payment_id`; `attempts[*].preference_id` = preferencia del paso 4.4 |
| Importe | `payments[0].amount` = `intents[0].expected_amount` = `paid_amount` = `session.total`; moneda ARS; `security_review_reason` nulo |
| Webhook | ≥1 recibo con `signature_valid=true` para ese pago, `processing_status` procesado; `validReceipts` sube |
| Pedido único | `orders.length=1`, `session.completed_order_id` = `intents[0].order_id`; tras la segunda pasada del worker, `ordersQA` subió exactamente 1 |
| Stock | `reservations[0].status` convertida (`converted_at` con fecha, sin `released_at`); stock de QA-REC-001 = base − 1, una sola vez |
| Conciliación | `discrepancies` vacío; `ledger` avanzó; `intentsOutsideTest=0` |
| Panel | el pedido aparece en el panel del negocio QA A con pago Mercado Pago aprobado (captura) |

### 4.7 Lo que hay que mandar a Claude

Enviar solo `e.jsonl` y las capturas del host y del pago aprobado. **No**
enviar tokens, contraseñas ni datos de tarjeta.

## 5. Después de APRO (no antes)

Una corrida por escenario, con la misma mecánica de §4.4 a §4.6:

- **OTHE**: rechazada. Sin pedido. La reserva se conserva para reintentar
  (migración `20261021233000`) y se libera al vencer.
- **CONT**: pendiente. Sin pedido mientras esté pendiente. El worker sigue el
  pago y el estado final del proveedor manda.
- **Reembolso** del pago APRO:
  `qa-mp-e2e.mjs refund --intent <id> --repeat`. Tiene que quedar un único
  `payment_refunds` aprobado (idempotencia en el repetido) y el
  `refunded_amount` debe coincidir con el proveedor.

El flujo **no** se declara listo hasta tener esa evidencia auténtica.
