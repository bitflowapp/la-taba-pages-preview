# Verificación posterior al ingreso del Webhook Secret — 2026-09-05

Evidencia de la fase anterior. El onboarding actual usa un negocio nuevo y conserva íntegro el histórico: [estado del negocio limpio de Walter](MERCADOPAGO_WALTER_CLEAN_BUSINESS.md).

El secret **MERCADOPAGO_OAUTH_WEBHOOK_SECRET existe** en Supabase staging `ukxqbgswjlibmnjemrzd`. Es exactamente la variable que consume `mercadopago-webhook` en modo OAuth. Se comprobó su nombre mediante Management API; no se recuperó ni mostró su valor. No hace falta volver a ingresarlo.

## Evidencia actual

- Client ID, Client Secret y secret del webhook configurados. Callback registrado, PKCE habilitado y permisos `read write offline_access` comprobados en la aplicación existente.
- `MERCADOPAGO_CREDENTIAL_MODE=oauth` activado exclusivamente en staging; entorno de pagos `test` conservado. Verificador remoto: `TEST`.
- Firma HMAC calculada dentro de Supabase con el secret existente: HTTP **200**. Firma inválida: HTTP **401**. El evento sintético `taba_hmac_selftest` se ignora tras validar la firma; no representa un pago verificado ni acredita dinero.
- Logs de gateway: ambas respuestas 200/401. Recibo de firma inválida registrado como `rejected_signature`, `signature_valid=false`. Consulta de errores de funciones en la ventana de una hora: sin resultados.
- La función temporal de diagnóstico y su material de autenticación se eliminaron. El webhook desplegado v21 ya consumía correctamente el secret y no necesitó redeploy.
- MCP oficial: `tools/list` no ofrece `simulate_webhook`; `notifications_history` no devuelve notificaciones. No se afirma una entrega oficial desde Mercado Pago.
- Sesión temporal real de TABA: login 200, registro de sesión correcto, connect 200 con PKCE/callback/permisos correctos. Cancelación 303 y callback repetido 303 con resultado `error`. No se obtuvo consentimiento seller ni se intercambió un código OAuth exitoso. Identidad temporal eliminada; consulta posterior: cero usuarios QA restantes.
- Se corrigió el endpoint OAuth a `https://auth.mercadopago.com.ar/authorization`, documentado oficialmente para Argentina y verificado públicamente con redirección 302 al login del proveedor. La interfaz admite ese origen. Función connect redeployada y frontend publicado en el proyecto Cloudflare `taba2-staging`, rama `staging`, despliegue `b2a60956`.
- Tests de pagos **67/67**, webhook **Deno 25/25 + 16/16 y Node 12/12**, interfaz OAuth **2/2** (320 y 1280 px, proveedor simulado). `npm run check` y preflight PASS. Archivos públicos **178/178** idénticos al paquete.
- El script PowerShell ahora captura la confirmación del proceso Node, exige éxito y muestra únicamente `CONFIGURED` al finalizar. Rechazo HTTP y confirmación incorrecta producen error explícito sin imprimir el valor. Pruebas incluyen ejecución real del wrapper PowerShell con transporte simulado.
- Se eliminó una intermitencia del test de cifrado: su alteración ahora siempre cambia el carácter original, en lugar de poder reemplazar `x` por el mismo `x`.

La evidencia local `la-taba-mp-secret-*.log`, `la-taba-mp-hmac-live-evidence.json`, `la-taba-mp-oauth-server-evidence.json` y `la-taba-mp-final-state.json` está fuera de Git en el directorio local de validación. No contiene valores de secrets. Producción no se modificó.

## Condición para Walter

**El webhook está listo; READY FOR WALTER AUTHORIZATION todavía NO está demostrado para su cuenta real.** La consulta actual confirma que el negocio `00000000-0000-4000-8000-000000000001`, nombre `La Taba`, está en `test`, habilitado, con collector `3594962708`, 94 intents históricos y cero sellers OAuth conectados. Ese collector pertenece al vendedor de prueba verificado anteriormente, no a una cuenta de Walter identificada.

`mp_finish_oauth` rechaza un collector diferente cuando existe historial (`seller_change_requires_migration`). Se requiere definir el negocio aislado y la identidad de vendedor correspondientes a la autorización real de Walter, o una migración explícita que preserve la conciliación. No se borró historial ni se desactivó esa guarda para obtener un resultado aparente. Siguen pendientes el consentimiento seller y el ciclo de pago de prueba con entrega oficial.

La URL definitiva permanece compartida, sin parámetro de negocio:

`https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook`

El servidor resuelve el negocio mediante la conexión OAuth del seller, consulta el payment con esas credenciales y verifica collector, entorno y referencia del intento del mismo negocio. Soporta comercios con sellers distintos.
