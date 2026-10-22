# Pruebas alojadas de pagos: plan ejecutable por etapas

Destino: `ixewllzzuzpqrkxzmfzx`, organización La Taba Free. App: **TABA2 Staging 2691240967769590**. Estado del circuito remoto de Mercado Pago: **pendiente, no ejecutado**. Este plan no declara pruebas remotas aprobadas por el resultado de una simulación.

## 1. Preflight sin operaciones financieras

Desde el worktree local de recuperación:

```powershell
$env:TEMP=$env:TABA_RECOVERY_TEMP
$env:TMP=$env:TEMP
$env:NODE_DISABLE_COMPILE_CACHE='1'
node scripts/recovery/payment-preflight.mjs --check --target deploy/recovery-free-hosted.json --evidence "$env:TABA_RECOVERY_EVIDENCE_DIR/payment-preflight.json"
```

Comprueba inventario real de secretos, hashes de configuración, entorno test, ausencia de activadores productivos y ausencia de pagos/conexiones/configuración comercial fuera de test. Es de lectura. No convierte presencia de secretos en certificación de OAuth ni de pagos.

Falta la firma completa del webhook y confirmar la inscripción del redirect/PKCE. Cloudflare recuperó acceso, pero el frontend sigue sin publicarse. El siguiente recorrido de navegador necesita un entorno de verificación aprobado.

## 2. Aislamiento de QA

- Usar el vendedor test `3594962708` y comprador test `3594962710`, cuyas credenciales ya están en Credential Manager.
- Crear identidades Auth y un comercio/producto **sintéticos, identificados QA**, con valores de prueba y stock controlado. No usar ni activar los 72 productos históricos.
- Mantener el comercio real pausado. Habilitar el recorrido sólo para el comercio QA y exclusivamente test.
- Verificar con el proveedor que las identidades son test y que cada pago tenga `live_mode=false`. El prefijo de una credencial no basta para determinar su entorno.
- No enviar notificaciones a contactos reales, ejecutar operaciones comerciales ni incluir tokens, contraseñas, códigos OAuth o datos de tarjeta en logs/capturas.

## 3. Matriz de casos remotos pendientes

| Caso | Acción | Evidencia necesaria |
|---|---|---|
| OAuth | Sesión QA owner/admin → mercadopago-connect → consentimiento oficial del vendedor QA → callback | state de un uso, PKCE, vendedor/app/entorno correctos, tokens cifrados y vencimiento |
| OAuth inválido | State alterado, vencido, repetido; sesión o rol revocado | Ninguna conexión nueva ni intercambio aceptado; historial preservado |
| Renovación | Solicitudes concurrentes de renovación de la conexión QA | Un único propietario de refresh; token nuevo cifrado; stale callbacks rechazados |
| Checkout | Carrito QA → create-checkout-session → create-preference → init_point oficial | Totales calculados en servidor; una reserva; moneda ARS; vínculo al vendedor correcto |
| Doble clic | Repetir client_request_id y solicitar la misma preferencia simultáneamente | Mismo checkout/operación; sin segunda reserva ni preferencia duplicada |
| Aprobado | Compra con usuario y medio oficiales de prueba | Pago confirmado por servidor; live_mode=false; pedido único; stock aplicado una vez |
| Pendiente y rechazado | Usar escenarios de prueba admitidos por MP | Ningún pedido entregable creado por un retorno del navegador; estado y reserva coherentes |
| Webhook auténtico | Recibir notificación emitida por MP para el pago QA | Firma real válida, receipt durable, outbox y consulta al proveedor; correlación comercio/pago/importe |
| Firma inválida/replay | Firma alterada, query/body discordantes y repetición de notificación auténtica | Rechazo de falsificaciones; receipt duplicado sin segundo pedido ni movimiento de stock |
| Cancelación | Pago QA cuyo estado admita cancelación, con confirmación explícita | ID de pago exacto; una operación persistida; repetir idempotency_key sin segundo PUT |
| Reembolso | Pago QA aprobado, reembolso total y parcial admitido, con confirmación explícita | provider_refund_id ligado a la operación correcta; importe autoritativo; sin reembolso duplicado |
| Interrupción | Cerrar navegador o cortar respuesta después del envío | Reconciliación por referencia externa/identidad guardada; no reenviar operación incierta a ciegas |
| Abandono | Checkout nunca completado; ejecutar reconciliación | No liberar sólo por reloj si el proveedor aún es incierto; liberar una vez cuando corresponda |
| Preparación/entrega | Pedido QA confirmado → panel → preparación y entrega | Eventos y notificación QA únicos; permisos por rol; integridad de stock y pedido |

Si MP no permite generar un estado cancelable con el método test elegido, registrar el bloqueo y el error exacto. No fabricar una aprobación ni usar un pago real para completar la matriz.

## 4. Contratos HTTP que usa el código

- Crear sesión: `mercadopago-create-checkout-session`, con `business_id`, `client_request_id`, ítems y datos de entrega; no aceptar precio/total del navegador.
- Preferencia: `mercadopago-create-preference`, con `checkout_session_id`; `new_attempt` sólo cuando el circuito lo autorice.
- Estado: `mercadopago-checkout-status`, con `checkout_session_id` y sesión propietaria.
- Cancelar: `mercadopago-cancel-payment`, con `payment_intent_id`, UUID `idempotency_key` y `confirmation=I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION`.
- Reembolsar: `mercadopago-refund`, con `payment_intent_id`, UUID `idempotency_key`, importe/motivo cuando correspondan y `confirmation=I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND`.

El worker necesita HMAC interno. Sus invocaciones de QA deben quedar correlacionadas con la outbox; no usar tokens administrativos en el navegador. Las pruebas iniciales de cero trabajo sólo admiten la base sin vendedores ni jobs.

## 5. Evidencia y limpieza

Registrar IDs de checkout/pedido/pago/operación, estados, hashes, conteos antes/después y fechas; secretos y datos de tarjeta quedan excluidos. Contrastar `checkout_sessions`, `inventory_reservations`, `payment_intents`, `payment_webhook_receipts`, `payment_outbox`, `payment_cancellations`, `payment_refunds`, `orders` e `inventory_movements`.

Las cinco suites SQL existentes y las pruebas unitarias se pueden repetir como evidencia separada; sus respuestas del proveedor son simuladas. El GO comercial exige aprobar el recorrido remoto, validar los datos de Walter y resolver los pendientes de operación/recuperación. No activar producción al terminar QA automáticamente.
