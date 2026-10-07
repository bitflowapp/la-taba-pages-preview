# Mercado Pago de La Taba — verificación y habilitación productiva

## Causa confirmada

El Panel calcula `Bloqueado` en `mercadoPagoSellerState`: cuenta `connected`, pero
`activation.enabled !== true` o revisión productiva del comercio distinta de
`approved`. La RPC `get_mercadopago_activation_status` lee
`business_payment_settings`. El 6 de octubre de 2026 (Argentina), producción
`wwcpogltfgzgkrlilbcd` devolvió `enabled=false`, `environment=production`,
`production_review_status=not_requested` para el único negocio, La Taba.

`mp_finish_oauth` conecta la cuenta productiva y conserva el cobro apagado; la
autorización OAuth y el cutover de cobros son decisiones distintas. Los secretos
del proyecto ya declaraban `production`, `oauth` y revisión `approved`.
Existe otra compuerta: `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION`, ausente al
diagnosticar, impide liberar preferencias productivas. Habilitar sólo la fila
del comercio no basta para conseguir un checkout funcional.

La cuenta tiene credencial cifrada, permisos `read`, `write`, `offline_access`,
aplicación `7677852968049976` y vencimiento el 5 de abril de 2027. La acción real
`verify` desplegada devolvió HTTP 200 tras consultar `/users/me` con la credencial
del seller. No se reconectó ni se refrescó innecesariamente la cuenta.

## Cambios

- `Verificar conexión` consulta Mercado Pago, comprueba identidad y permisos,
  contrasta seller/aplicación/entorno con la configuración del comercio, consulta
  la disponibilidad del backend y comprueba la compuerta de ejecución. Devuelve
  sólo evidencia sin credenciales. Nunca habilita cobros ni crea preferencias.
- El Panel recarga la activación luego de verificar. No muestra cobros
  habilitados si la verificación autoritativa los considera bloqueados.
- `cobro-negocio.mjs` admite el proyecto productivo original con una credencial
  server-side ligada al ref; rechaza claves de otro proyecto y de rol anon.
- El runtime PWA se versiona para que la actualización llegue a clientes con caché.
- Hay un cargador por stdin para reemplazar únicamente el client secret
  integrador. No cambia la clave de cifrado, la firma del webhook, el client ID,
  los tokens del seller ni la habilitación del comercio.

## Evidencia y límites

Se ejecutaron 203 pruebas de pagos existentes. Las suites Deno originales y las
nuevas verificaciones cubren identidad, permisos faltantes, backend caído,
binding incorrecto y ejecución productiva bloqueada. Los tests del Panel cubren
el cambio de configuración mientras la pantalla está abierta. El arnés de DB
usa un contenedor desechable sin red y transporte Mercado Pago sintético; sus
resultados no son pagos productivos reales.

El chequeo real del worker confirmó coincidencia de HMAC Edge/Vault, URL correcta,
cron activo y cola sin trabajos pendientes. El webhook de la aplicación quedó
registrado con URL productiva y tópico `payment` mediante `mercadopago:mp-webhooks`.
Que haya secretos y una URL registrada no demuestra entrega de una notificación
de pago real. La prueba final debe demostrar el efecto desde Mercado Pago hasta
el pedido y Caja Clara.

Las lecturas directas de credenciales fueron rechazadas para anon y para el
administrador del comercio. Anon no pudo ejecutar el interruptor de operador.
Una identidad QA sintética se creó sólo para verificar el endpoint autenticado;
no se usó la contraseña ni la sesión de Walter.

## Pendiente de seguridad

Una salida de diagnóstico del agente expuso por error el client secret
integrador. Nunca debe reproducirse en informes, logs o commits. Requiere
renovación antes de certificar `SECURITY: PASS`. No se debe desconectar a Walter
ni sustituir la aplicación para intentar corregirlo.

La [documentación oficial de credenciales](https://www.mercadopago.com/developers/es/docs/checkout-pro/resources/credentials)
describe la renovación del par Client ID / Client Secret. Si Mercado Pago propone
cambiar el client ID, detenerse: el vínculo existente requiere un plan de
migración; no sustituir silenciosamente la cuenta OAuth.

Después de renovar el secreto manteniendo el client ID, ejecutar localmente
`scripts/mercadopago/actualizar-client-secret-produccion.ps1`. La entrada queda
oculta y viaja por stdin, nunca por argumentos ni por el chat. Verificar nuevamente
el seller y la configuración antes del cutover.

## Cutover y prueba final

Sólo después de solucionar seguridad, confirmar proyecto/ref, revisión y
verificación real. Habilitar con la RPC auditada
`operator_set_mercadopago_for_business`, a través de:

```powershell
node scripts/mercadopago/cobro-negocio.mjs encender --target=production --business=00000000-0000-4000-8000-000000000001 --confirmar=business-00000000000040008000000000000001 --revision-aprobada
```

La compuerta de ejecución debe habilitarse como decisión explícita del operador;
no constituye autorización para que un agente pague. Preparar un checkout del
catálogo real, sin crear un pago. Al diagnóstico, el menor precio con stock fue
Powerade Mountain Blast, ARS 1.450. Revalidar precio/publicación/stock y retiro sin
envío antes de elegirlo. No inventar un total ni bajar el precio de un producto.

El usuario realiza el pago. Continuar con webhook firmado, consulta autoritativa,
una única finalización de pedido, Caja Clara con `payment.state=approved`, ausencia
de cobro manual, conciliación y conteos de duplicados. Repetir la notificación
debe mantener un único efecto. No presentar fixtures como una compra real.

No afirmar `MERCADO_PAGO_PRODUCTION_READY: YES` mientras queden seguridad,
habilitación o prueba real pendientes. Commit, merge y despliegue son evidencias
distintas; comprobar `version.json` y el SHA servido por `la-taba.pages.dev`.
