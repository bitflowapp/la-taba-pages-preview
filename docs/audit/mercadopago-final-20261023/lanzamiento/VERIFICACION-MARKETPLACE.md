# Verificación de marketplace con un segundo vendedor de prueba

**Estado: preparada, NO ejecutada.** No se creó ninguna cuenta, no se conectó ningún vendedor y no se hizo ningún pago. Cada paso que lo requiere está marcado **[AUTORIZACIÓN]** y queda detenido hasta que el titular lo apruebe.

## 1. Por qué hace falta (qué no puede mostrar la evidencia actual)

En producción la topología es: una aplicación integradora (La Taba Delivery) de una cuenta, **otro** vendedor (Walter) que se conecta por OAuth, y un comprador. En QA, hoy, el vendedor `3594962708` es también el **dueño** de la integradora TestApp. Eso oculta tres cosas:

| Riesgo | Por qué hoy no se ve | Si fallara en producción |
|---|---|---|
| **R-MKT-1: `user_id` del webhook.** El ruteo (`seller-webhook-routing.ts`) exige que `body.user_id` sea el id del **vendedor** conectado; si Mercado Pago mandara el id del dueño de la aplicación, ninguna notificación se rutearía | vendedor y dueño son la misma cuenta | cada webhook respondería 503 y se reintentaría; el dinero no se pierde: el barrido de verdad del proveedor y el del libro leen el pago con el token del vendedor, sin depender del webhook (en la prueba APRO del 23/10 el pedido quedó completo 9 s después del pago, 57 s antes de que el worker procesara el webhook). Los pedidos llegarían tarde y habría alertas falsas |
| **R-MKT-2: pago marketplace real.** Hoy Mercado Pago marca las preferencias `marketplace: NONE` (autoautorizada). Con otro vendedor lleva `MP-MKT-<aplicación>` | ídem | comportamiento de comisiones/liquidación no probado |
| **R-MKT-3: aislamiento entre vendedores.** Un vendedor no debe poder leer el pago de otro, ni un webhook caer en el comercio equivocado | sólo hay un vendedor conectado | cruce de pedidos entre comercios |

Es el único aspecto de la arquitectura de cobro que QA todavía no puede demostrar. Es **bloqueante para producción** salvo que se lo demuestre aquí o con el canary real de Walter (§7).

## 2. Topología de la prueba

| Rol | Cuenta | Estado |
|---|---|---|
| Dueño de la integradora TestApp-ae01fd1d `4861627125869370` | vendedor de prueba `3594962708` | existe |
| **Vendedor B** (collector) | cuenta de prueba tipo *Vendedor*, a crear | **no existe** |
| Comprador | `3594962710` | existe, con saldo y tarjeta de prueba |
| Comercio | tenant QA B (`7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a02`), cerrado, aislado | existe, **no habilitado para vender y sin productos** |

El tenant QA A y su vínculo con `3594962708` no se tocan: sirven de control de aislamiento.

## 3. Estado verificado hoy (solo lectura)

`node scripts/recovery/qa-mp-marketplace.mjs preflight`:

- dueño de la integradora: `test_user`, correcto;
- tenant B existe, `closed`, `ordering_enabled=false`, `ordering_verified=false`, **0 productos**, sin vendedor;
- credenciales locales: comprador sí, dueño B sí, **vendedor B no**.

Bloqueante técnico detectado y resuelto en código: el arnés sólo operaba sobre el tenant A. `qa-mp-e2e.mjs` acepta ahora `--tenant b` (la credencial del dueño sigue al tenant).

## 4. Pasos

| # | Paso | Quién / autorización |
|---|---|---|
| 1 | **[AUTORIZACIÓN G1]** Crear **una** cuenta de prueba tipo *Vendedor* (TestApp → Cuentas de prueba, sesión del vendedor `3594962708`). Límite 15 cuentas, no se pueden borrar. Saldo ficticio mínimo | titular de la cuenta de Mercado Pago |
| 2 | Guardar su usuario y clave en Credential Manager como `RECOVERY MP TEST SELLER B` (JSON `id`, `nickname`, `password`, `siteId`, `profile`). Nunca por el chat | operador, ya preparado el formato |
| 3 | `node scripts/recovery/qa-mp-marketplace.mjs preflight --seller <id B>`: debe quedar sin bloqueos salvo el del paso 4 | automático |
| 4 | **[AUTORIZACIÓN G2]** `node scripts/recovery/qa-mp-marketplace.mjs prepare --apply`: habilita el tenant B a vender **un** producto sintético `QA-MKT-001` (ARS 100, stock 5). Es una escritura sólo en el tenant QA B; el comercio sigue `closed` fuera de las ventanas QA. El ensayo en seco ya se corrió y no escribió nada | operador |
| 5 | `node scripts/recovery/qa-mp-e2e.mjs connect-url --tenant b`: URL de un solo uso (10 min) para el consentimiento del vendedor B | automático |
| 6 | **[AUTORIZACIÓN G3]** El vendedor B inicia sesión y consiente en una ventana aislada | titular / operador con las credenciales de prueba |
| 7 | `node scripts/recovery/qa-mp-e2e.mjs verify --tenant b`: `integrator_environment_matches: true`, `seller_id` = B, aplicación TestApp | automático |
| 8 | `qa-mp-e2e.mjs window-open --tenant b` y `checkout --tenant b --sku QA-MKT-001 --scenario APRO` | automático |
| 9 | **[AUTORIZACIÓN G4]** Una compra APRO de ARS 100 con el comprador de prueba (tarjeta oficial APRO) | operador |
| 10 | `qa-mp-e2e.mjs worker` (dos pasadas) y `node scripts/recovery/qa-mp-marketplace.mjs verify --session <id> --seller <id B>` | automático |
| 11 | `window-close --tenant b` | automático |

Opcional, sólo con **G5**: reembolso manual desde la cuenta del vendedor B para repetir la conciliación `origin: external` con un vendedor distinto del dueño.

## 5. Criterios de aprobación (los calcula `verify`)

| Control | Esperado |
|---|---|
| Preferencia | `collector_id` = B; `client_id` = TestApp; `marketplace` = `MP-MKT-4861627125869370` |
| Pago | aprobado; `collector_id` = B; pagador = comprador |
| **R-MKT-1** | el webhook firmado se **ruteó**: recibo con `signature_valid` y `seller_business_id` = tenant B, respuesta 201 (no 503) |
| R-MKT-3 | el vendedor A **no puede** leer ni buscar el pago de B (403/404; búsqueda vacía); el pedido está **sólo** en el tenant B; el tenant A no cambia |
| Pedido y stock | un pedido, un descuento de stock, en B |
| Conciliación | cero discrepancias; segunda pasada del worker sin trabajo |

## 6. Si R-MKT-1 falla (webhook 503 con pago aprobado)

Es el hallazgo que se buscaba. No se arregla en producción: se corrige antes. Opciones, en este orden de preferencia: (a) ruteo por la referencia externa leyendo el pago con cada token de vendedor conectado de la aplicación (mantiene «user_id es sólo una pista»); (b) apoyarse en el barrido de verdad del proveedor (corre cada minuto) y silenciar la alarma del webhook. En ambos casos se reejecuta esta verificación.

## 7. Plan B si no se autoriza ninguna cuenta

El primer cobro real de Walter (canary, monto mínimo) es el mismo experimento con dinero real: integrador ≠ vendedor. Se acepta sólo si el canary está autorizado y se mira, en este orden: respuesta del webhook (201), recibo ruteado, pedido único. Un 503 en el canary no pierde dinero (ver arriba), pero el comercio entra «tarde» y no debe seguir hasta resolverlo.

## 8. Qué NO hace esta verificación

No crea cuentas, ni vincula vendedores, ni paga, ni reembolsa por sí sola. No usa producción. No cambia la configuración de TestApp ni de TABA2 Staging. Deja una cuenta de prueba más (no borrable) y el tenant QA B habilitado pero cerrado.
