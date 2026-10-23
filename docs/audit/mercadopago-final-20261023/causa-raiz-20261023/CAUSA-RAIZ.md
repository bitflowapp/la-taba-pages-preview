# Causa raíz de «Oh, no, algo anduvo mal» en Checkout Pro — 23/10/2026

**Resultado: causa encontrada, demostrada y corregida.** Con la corrección, el mismo comprador, vendedor, tarjeta, payload y automatización que fallaban aprobaron un pago APRO por la arquitectura OAuth de La Taba: pago `184722117633`, pedido `LT-0087`, webhook firmado válido, stock descontado una sola vez. OTHE terminó rechazado y CONT pendiente, con el comportamiento esperado. **No hace falta un ticket a Mercado Pago por el checkout.** Queda una sola pregunta acotada sobre reembolsos en el entorno de prueba (§7).

Todo ocurrió en el proyecto QA `ixewllzzuzpqrkxzmfzx`, con usuarios de prueba y dinero ficticio. No se tocó producción ni se hizo merge.

## 1. La causa

Toda preferencia creada con el token OAuth de un vendedor es un **pago marketplace**: Mercado Pago la marca `marketplace: MP-MKT-<client_id>`, y el **dueño de la aplicación integradora** pasa a ser uno de los usuarios del pago, junto con el vendedor y el comprador.

| Participante | Cuenta | ¿Usuario de prueba? |
|---|---|---|
| Comprador | 3594962710 | sí |
| Vendedor (collector) | 3594962708 | sí |
| Integrador: dueño de TABA2 Staging `2691240967769590` | 721168650 | **no, es una cuenta real** |

Mercado Pago no mezcla usuarios reales y de prueba en un pago. La API de pagos lo dice con todas las letras: **`400 Invalid users involved`, cause `2034`**. Checkout Pro sólo muestra «Oh, no, algo anduvo mal» después de «Pagar», con tarjeta o con saldo, y no crea ningún pago. La API de preferencias responde 200 porque la validación ocurre recién al pagar.

Por qué no se había visto antes: hasta ayer, `test_token: true` hacía que el vendedor quedara con credenciales sandbox. Mercado Pago redirigía el checkout a `sandbox.mercadopago.com.ar`, que fallaba por su cuenta (`card-form/association` 404). Al corregir eso (doc 79), quedó a la vista este segundo bloqueo, que estaba detrás.

## 2. Cómo se descartó todo lo demás

| Hipótesis | Prueba | Resultado |
|---|---|---|
| La tarjeta o el formulario de tarjeta | Pago con **saldo** (sin tarjeta) por la misma arquitectura OAuth, flujo `c262a58d-47da-4bdd-aad9-42a9393a789e` | Mismo `PUT flow → reauth → PUT flow → /error/`. Descartada. [04](04-checkout-saldo-oauth.json) |
| El payload de la preferencia | `preferenceRequest()` igual desde septiembre (sólo cambian hosts). Comparación del lado del proveedor entre la preferencia aprobada del 25/9 y las que fallan | Única diferencia: `client_id` y **`marketplace`** (`NONE` frente a `MP-MKT-2691240967769590`). [01](01-preferencias-comparadas.json) |
| El e-mail del pagador | Sonda de la API de pagos con el OAuth del vendedor y el **comprador QA real** como pagador | Mismo `2034`. Descartada. [03](03-sondas-api-pagos.json) |
| Identidad, permisos o binding del vendedor | «Verificar conexión» y `/users/me` | Vendedor `test_user`, MLA, scopes y binding correctos |
| Host sandbox | Corregido en doc 79; el checkout se queda en `www` | Descartada |
| Automatización del navegador | El mismo controlador aprobó APRO, OTHE y CONT después de la corrección | Descartada |
| **Dueño de la aplicación integradora** | `client_credentials` + `/users/me` de cada app | TABA2 Staging → **721168650, real**. TestApp-ae01fd1d → 3594962708, `test_user`. [02](02-duenos-de-las-aplicaciones.json) |

**Confirmación positiva:** se cambió sólo la integradora de QA, de TABA2 Staging (dueño real) a **TestApp-ae01fd1d `4861627125869370`**, la aplicación de prueba automática de TABA2 Staging, cuyo dueño es el vendedor de prueba. Con todo lo demás igual, APRO aprobó. [07](07-apro-aprobado-testapp.json)

## 3. Correcciones

### 3.1 Defecto de La Taba: nunca validaba el entorno del integrador (commit `8f13bbff`)

La Taba validaba que el **vendedor** fuera de prueba en test y real en producción, pero nunca miraba al **integrador**. Así QA figuraba «conectado», reservaba stock y creaba preferencias que nunca se iban a poder pagar.

`assertIntegratorEnvironment()` (`supabase/functions/_shared/seller-oauth.ts`) lee al dueño de la aplicación con sus propias credenciales (`client_credentials` + `/users/me`). Exige un usuario de prueba en test y una cuenta real en producción, y recuerda sólo un resultado verificado.

- Callback OAuth: no vincula a un vendedor bajo un integrador del otro entorno.
- «Verificar conexión»: `blocking_reason: integrator_environment_mismatch`, con texto para el panel.
- Creación de checkout (antes de reservar stock) y de preferencia: 409 `PAYMENTS_NOT_ENABLED`. Un dueño ilegible cierra con 503.

Verificado en QA alojado con la integradora real todavía configurada: `verify` informó `integrator_environment_mismatch` y un checkout con la ventana QA abierta respondió 409 sin sesión, reserva ni intent. [05](05-guardia-en-qa.json)

### 3.2 Configuración de QA: integradora de dueño de prueba

- `RECOVERY_TEST_APPLICATION_ID = 4861627125869370`, en el binding Edge (`recovery-deployment.ts`) y en `plan.mjs`, con un test que exige que sean iguales. TABA2 Staging queda rechazada para QA. El target de lanzamiento (entorno test) usa la misma app.
- TestApp ya tenía registrado el callback OAuth de QA y PKCE, porque Mercado Pago le sincroniza la configuración de TABA2 Staging. Se configuraron sus webhooks (URL de QA en los dos modos; eventos «Pagos» y «Vinculación de aplicaciones»). Su Client Secret y su firma de webhook se guardaron en el Credential Manager sin mostrarse.
- `qa-mp-use-test-integrator.mjs` cargó `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET` y `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` en QA y los confirmó por digest SHA-256. Antes verificó que el dueño fuera `test_user`. [06](06-cambio-de-integradora-qa.json)
- Reconexión del mismo vendedor por el flujo «Reconectar», sin desconectar: así se respeta la ventana de 24 h de `mp_disconnect_checked`. Los crons que usan el token del vendedor se pausaron durante el minuto del cambio.

### 3.3 Defecto oculto 2: el IPN legacy generaba alarmas falsas en cada venta

Con el primer pago aprobado aparecieron, junto al webhook firmado, seis avisos IPN (`?topic=payment|merchant_order&id=…`) del `notification_url`. Mercado Pago documenta que **su `x-Signature` no se puede validar con la clave secreta** y que se reintentan cada 15 minutos hasta recibir 200/201. La Taba los guardaba como `rejected_signature` y los respondía con 401. Eso producía:

- la alerta operativa `webhook_signature_rejected` («verificar MERCADOPAGO_WEBHOOK_SECRET»);
- el aviso al dueño «Llegaron avisos que no se pudieron verificar»;
- reintentos sin fin del proveedor.

Pasaba **en cada venta**, aunque la venta estaba bien. Ahora `isLegacyIpnNotification()` reconoce esa forma de manera estricta: cualquier marca de webhook moderno deja la decisión a la firma. El handler responde 200 sin recibo, sin buscar vendedor y sin leer al proveedor. El webhook firmado y la lectura del pago siguen haciendo el trabajo.

Verificado en vivo: después del despliegue hubo **8 IPN respondidos con 200 y cero recibos rechazados**; los webhooks firmados de OTHE y CONT se validaron y procesaron. [10](10-ipn-legacy.json)

## 4. Verificación del flujo financiero en QA

| Control (doc 79 §4.6) | Resultado |
|---|---|
| Proveedor | `184722117633` `approved/accredited`, ARS 100, Mastercard APRO, collector 3594962708, pagador 3594962710 |
| Importe | pagado = esperado = 100; `security_review_reason` nulo |
| Webhook | un recibo `signature_valid=true`, procesado; es el **primero válido en la historia de QA** |
| Pedido único | `LT-0087`; pedidos QA de 6 a 7 (exactamente +1); segunda pasada del worker `claimed 0` |
| Stock | QA-REC-001 de 20 a 19, reserva `converted` |
| Conciliación | cero discrepancias; ledger avanzado; `intentsOutsideTest = 0` |
| OTHE | `184725699779` `rejected/cc_rejected_other_reason`; sin pedido; la reserva se conserva para reintentar y se liberó al vencer la sesión (`checkout_expired`, 20:15:00) |
| CONT | `185766963074` `in_process/pending_contingency`; sin pedido; al vencer la sesión la reserva se liberó (20:20:00) y el worker sigue el pago |
| Stock final | QA-REC-001 = 19: sólo la venta APRO lo descontó |

Detalle: [07](07-apro-aprobado-testapp.json), [08](08-othe-cont-testapp.json).

## 5. Lo que no se pudo certificar en QA, y por qué

1. **Reembolso por API.** La Taba pidió el reembolso total del pago APRO y lo repitió; la idempotencia funcionó (la repetición devolvió el estado registrado). Mercado Pago lo rechazó con **`401 Unauthorized use of live credentials`, cause `7`** (request `1f619ac9-66fb-446e-9739-3cad2740969a`, replay con la misma clave de idempotencia). Tiene explicación: el grant de TestApp trae `payments:refunds/read-only`, `payments:cancel/read-only` y `payments/read-only`; la app real TABA2 Staging tiene `payments` completo. El 25/9, la credencial directa de esa misma TestApp ya había recibido el mismo 401. Es una restricción de la aplicación de prueba automática del proveedor, no del pedido de La Taba. [09](09-reembolso-api.json)
2. **Marketplace con integrador distinto del vendedor.** Con TestApp autoautorizada por su propio dueño, Mercado Pago marca las preferencias `marketplace: NONE`. Producción usará un integrador real (La Taba Delivery) y un vendedor real distinto (Walter). Para ejercitar esa relación en QA hace falta un segundo vendedor de prueba, o una cuenta «Integrador», conectado a TestApp. Crear cuentas de prueba requiere la sesión de la cuenta dueña (panel o MCP).
3. **Reembolso hecho desde la cuenta del vendedor.** Sirve para probar la conciliación de reembolsos de origen proveedor. No se pudo automatizar la pantalla de Actividad; queda como paso manual.

## 6. Qué implica para producción

- La guarda nueva bloquea cobros si **La Taba Delivery `7677852968049976` no pertenece a una cuenta real** o si el vendedor conectado no lo es. El primer «Verificar conexión» en producción tiene que decir `integrator_environment_matches: true`.
- En La Taba Delivery: callback de producción, webhook de producción con eventos «Pagos» y «Vinculación de aplicaciones», y su clave secreta en `MERCADOPAGO_OAUTH_WEBHOOK_SECRET`.
- El primer reembolso real es el primer reembolso por API que se va a ver aprobado, porque en QA no se pudo (§5.1). Conviene hacerlo en la prueba de control con monto mínimo y observarlo.

## 7. Única consulta que corresponde hacer a Mercado Pago

> Con Checkout Pro y usuarios de prueba, usando la aplicación de prueba automática `4861627125869370` (TestApp-ae01fd1d, de TABA2 Staging `2691240967769590`) y el token OAuth del vendedor de prueba `3594962708`, el pago `184722117633` quedó aprobado. `POST /v1/payments/184722117633/refunds` responde `401 Unauthorized use of live credentials` (cause 7, request `1f619ac9-66fb-446e-9739-3cad2740969a`, 23/10/2026 19:58:57 UTC). El grant de esa aplicación trae `urn:mp:online:payments:refunds/read-only`. ¿Cómo se prueban reembolsos y cancelaciones por API en el entorno de prueba de Checkout Pro con OAuth?

La consulta anterior sobre el checkout ([CONSULTA-PROVEEDOR.md](../CONSULTA-PROVEEDOR.md)) **ya no corresponde enviarla**: la causa era nuestra configuración.

## 8. Para volver a TABA2 Staging (no recomendado)

Habría que volver a nombrarla en `RECOVERY_TEST_APPLICATION_ID` (Edge y `plan.mjs`) y cargar su Client Secret (`RECOVERY MP TEST CLIENT SECRET`) y su firma de webhook (panel de TABA2 Staging → Webhooks). Después, reconectar. Con ella ningún pago de prueba puede aprobarse, y la guarda lo informa.

## Evidencia

Archivos sanitizados (sin tokens, contraseñas, e-mails ni datos de tarjeta), numerados 01 a 10 en esta carpeta. Herramientas de sólo lectura y de diagnóstico en `scripts/recovery/qa-mp-*.mjs`.
