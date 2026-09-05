# Walter: negocio limpio para autorización — 2026-09-05

El gate posterior, la interfaz con estado explícito y los pasos presenciales están en [PRE-WALTER GATE](MERCADOPAGO_PRE_WALTER_GATE.md).

**READY FOR WALTER AUTHORIZATION.** Staging apunta al negocio `3537d949-d76b-410d-be89-e4f447546e29`, slug `taba-walter-staging`, nombre interno `TABA Walter Staging`. El ID fue generado por PostgreSQL al insertar el negocio; no procede de un fixture. El consentimiento de Walter todavía no ocurrió: READY significa que puede iniciar y completar su autorización. No certifica cobros productivos.

## Estado comprobado en staging

Proyecto `ukxqbgswjlibmnjemrzd`, sitio <https://taba2-staging.pages.dev>, despliegue Pages `23a46265`.

| Dato de Walter | Resultado |
| --- | --- |
| Conexiones OAuth, incluso desconectadas | 0 |
| Payment intents / attempts | 0 / 0 |
| Preferences / payments | 0 / 0 |
| Estados OAuth | 0 |
| Checkout sessions / pedidos | 0 / 0 |
| Historial UNKNOWN | 0, porque no existe historial |
| Configuración financiera heredada | Ninguna |
| Estado remoto del panel | `disconnected`, HTTP 200 |

El negocio histórico `00000000-0000-4000-8000-000000000001` sigue disponible para auditoría, con los **94 intents y 184 eventos originales intactos**. La clasificación existente permanece **73 TEST / 21 UNKNOWN**, sin reclasificar, mover ni corregir registros. El hash SHA-256 del snapshot original de intents sigue siendo `b62bd58c55bb70fdf7cf19b56ff7cdcb97b414851ad7f7c3a6cc05654a456d3d`. También se compararon todos los campos incluidos en el snapshot original de eventos. No se renombró ni se agregó una etiqueta a la fila histórica.

## Configuración comercial

`scripts/mercadopago/provisionar-walter-staging.mjs` verifica el proyecto fijo de staging y ejecuta una transacción con bloqueo de aprovisionamiento. Sin `--apply`, revierte la transacción. Genera IDs nuevos para productos, imágenes y promociones, y remapea sus relaciones.

Se copiaron los campos comerciales del negocio, 8 productos activos y verificados, precios, categorías, imágenes asociadas, 3 combos activos aprobados y sus componentes, configuración de delivery y retiro, y coordenadas del local. Los horarios, excepciones y zonas no tenían filas en origen. Se conservaron sus valores de configuración del negocio. No se copió historial de presencia de repartidores. Dos membresías existentes de propietario/administrador permiten operar el panel nuevo; no se copiaron sesiones ni invitaciones.

El catálogo inactivo o no verificado de pruebas no se publicó en el negocio nuevo. No se copiaron pagos, OAuth, seller IDs, tokens, claves de idempotencia, eventos financieros, liquidaciones ni settings de Mercado Pago.

## OAuth y protección del seller

El consentimiento real se habilitó exclusivamente para este negocio de staging mediante `scripts/mercadopago/preparar-onboarding-walter-staging.mjs`. El script exige negocio sin conexiones, intents ni estados, comprueba los digests de configuración y escribe únicamente dos valores no sensibles:

- `MERCADOPAGO_OAUTH_ENVIRONMENT=production`.
- `MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID=3537d949-d76b-410d-be89-e4f447546e29`.

`MERCADOPAGO_ENVIRONMENT=test` se conserva. El consentimiento real no habilita cobros reales: las llamadas financieras fallan antes de recuperar un token si los entornos de consentimiento y pagos difieren, y `mp_finish_oauth` deja deshabilitados los pagos productivos. No se modificó el proyecto de producción. La transición futura a cobros necesita su proceso de revisión existente.

La migración `20260905195357_mercadopago_clean_seller_binding.sql`, aplicada en staging, permite el primer seller y la reconexión de la misma cuenta. Rechaza otra cuenta con `seller_change_requires_migration` incluso antes del primer pago. Desconectar conserva el vínculo con el seller; no permite eludir la guarda. La protección histórica anterior sigue vigente. Los RPC de tokens permanecen exclusivos de `service_role`.

El cliente toma el negocio de la configuración publicada y la sesión debe estar autorizada para ese negocio. El estado OAuth vincula negocio, usuario, entorno y PKCE. El callback consume el estado una sola vez, verifica identidad y entorno del seller, y guarda tokens cifrados en el negocio correspondiente.

Callback: <https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-oauth-callback>. PKCE S256 y permisos `read write offline_access`. Autorización: `https://auth.mercadopago.com.ar/authorization`.

## Webhook y comercios múltiples

URL compartida: <https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook>. No recibe un UUID fijo en query string.

El servidor verifica HMAC, busca la conexión OAuth del seller para la aplicación y el entorno, consulta el payment con esa conexión y contrasta collector, entorno y external reference con el intento del mismo negocio. El diseño admite comercios con sellers distintos. La restricción de un solo negocio pertenece únicamente al modo temporal de consentimiento aislado de staging, no al routing definitivo de producción.

`MERCADOPAGO_OAUTH_WEBHOOK_SECRET` está configurado y es el nombre exacto que consume el webhook en modo OAuth. Se volvió a firmar dentro de Supabase: válido **200**, inválido **401**. La sonda autenticada y temporal fue eliminada. Nunca se recuperó su valor. El evento sintético sin efecto financiero valida HMAC; no equivale a un pago ni a una entrega oficial del proveedor. El MCP disponible no ofrece `simulate_webhook`.

La base confirmó el recibo inválido como `rejected_signature`, con `signature_valid=false`. Se consultaron los logs de funciones; la consulta de gateway no devolvió filas durante esta comprobación, por lo que los HTTP se acreditan con las respuestas directas de la sonda y el recibo persistido.

## Pruebas y publicación

**2707/2707 pruebas automatizadas aprobadas**, sin sumar suites superpuestas:

- Node: 2410/2410, incluidos los 67 casos de pagos.
- Deno: 25/25 + 20/20, incluidos handlers reales de connect/callback/webhook con transportes de Supabase y Mercado Pago simulados.
- PostgreSQL: 250/250 pgTAP, 121 migraciones desde cero y restauración del dump verificada. Los fixtures usan negocio temporal y transacciones revertidas.
- Playwright OAuth: 2/2, anchos 320 y 1280, proveedor simulado.

La nueva cobertura comprueba los 13 puntos solicitados: estado desconectado, primer seller, negocio del estado, callback correcto, replay, misma cuenta, cuenta diferente, conexión usada en preference, routing del webhook, aislamiento del histórico, ausencia de pagos heredados y UNKNOWN, y ausencia de fallback al UUID histórico en el flujo nuevo. La autorización real de una cuenta del proveedor requiere la intervención de Walter; no se conectó ningún seller de prueba al negocio definitivo.

En navegador limpio sobre el sitio publicado se usó una identidad QA temporal, se inyectó el UUID histórico en localStorage y se comprobó el estado real `disconnected` por HTTP 200. El botón envió el ID nuevo y hubo cero solicitudes al negocio legacy. La creación de estado OAuth se interceptó en esta prueba para mantener el negocio definitivo sin conexiones ni estados; la redirección al proveedor se simuló. La identidad y sesión QA se eliminaron después.

La interfaz muestra «Conectá tu cuenta para recibir pagos online.» y «Conectar Mercado Pago», sin seller histórico ni advertencia de migración. Tras el consentimiento mostrará «✓ Mercado Pago conectado correctamente».

Se actualizó el service worker a `la-taba-runtime-v96-clean-business-onboarding`; el runtime publicado usa URL versionada y `Cache-Control: no-store`. No se conserva el ID histórico como fallback del repositorio de pedidos. Los fixtures históricos y la referencia geográfica descriptiva se conservan, sin intervenir en el routing del negocio.

Se publicaron las funciones necesarias y se preservó la verificación JWT de reembolso y cancelación. Verificación estática, preflight, escaneo de secrets y comparación de los 178 archivos publicados: PASS. La evidencia detallada de base de datos, navegador, firmas y despliegue permanece fuera de Git en el directorio local de validación. El proyecto de producción y los registros financieros históricos no se tocaron.
