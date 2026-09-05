# Mercado Pago OAuth en TABA

TABA/LUNA es el integrador. Cada comercio autoriza su cuenta. El panel nunca solicita claves, contraseña, número de aplicación ni configuración de webhooks al comerciante.

## Base y auditoría

Base: `869a684`, último `origin/main` consultado el 5 de septiembre de 2026, después de integrar el panel de las PR 90/91. La ruta histórica indicada ya no contiene Git. El repositorio principal registrado está en el directorio de desarrollo del usuario; se creó un worktree aislado y se conservaron sus cambios locales.

La implementación previa usaba `MERCADOPAGO_ACCESS_TOKEN` global, settings por comercio, precios calculados en PostgreSQL, validación de collector/referencia/monto/moneda/preference y una cola durable. Se conserva esa máquina de estados y la reconciliación del navegador consulta el backend. Las back URLs nunca aprueban un pedido.

## Arquitectura y permisos

`mercadopago-connect` recibe POST autenticado con business_id y acción. Verifica el usuario con Auth y el permiso owner/admin mediante la autoridad de sesiones vigente. CORS restringido y límite de frecuencia. Genera state aleatorio de 256 bits y PKCE S256. La base guarda sólo el digest del state; expira a los diez minutos. Un segundo inicio invalida el anterior.

El callback HTTPS consume state con DELETE RETURNING atómico. Revalida la sesión original cifrada y el rol actual, intercambia code sólo en servidor, consulta `/users/me` y guarda tokens cifrados junto con el vendedor, scopes y vencimiento. El regreso lleva sólo un resultado no sensible. La pantalla consulta nuevamente el estado del servidor.

`mp_seller_connections` y `mp_oauth_states` tienen RLS sin políticas de cliente y grants exclusivamente a service_role. AES-256-GCM usa nonce aleatorio y AAD ligada a proyecto, entorno, aplicación, comercio y propósito. La clave vive en Supabase Secrets. No existe SELECT de tokens desde el navegador. Las RPC internas son SECURITY INVOKER y no están concedidas a PUBLIC/anon/authenticated.

## Refresh y recuperación

El worker y las llamadas del proveedor renuevan cuando queda menos de un día. Una actualización atómica concede un único dueño de refresh. La escritura final compara dueño y generación. No se reintenta ciegamente un refresh rotativo de resultado ambiguo: se solicita reautorización. Un crash con lock vencido también requiere reautorización; no se reutiliza un refresh posiblemente consumido. Errores de configuración definitivos permiten corregir y reintentar. No se almacenan cuerpos de errores del proveedor.

Desconectar pide confirmación y elimina el material cifrado, invalida callbacks pendientes y pausa cobros. Conserva historial e identificadores. No se implementa un endpoint de revocación inventado: la documentación consultada describe revocación pero no un endpoint público de Mercado Pago para ejecutarla. El vendedor puede retirar además el permiso desde su cuenta de Mercado Pago.

Cambiar a otro vendedor con historial existente se rechaza para no atribuir pagos viejos a una cuenta nueva. Requiere una migración explícita de identidad histórica; una reconexión al mismo vendedor no tiene esa restricción.

## Checkout y webhook

Con `MERCADOPAGO_CREDENTIAL_MODE=oauth`, todas las llamadas del proveedor requieren business_id resuelto por servidor. No hay fallback a la credencial del integrador. La preference usa importes de la preparación SQL y agrega el business_id como dato de ruteo en notification_url. Ese dato no acredita pagos: el worker consulta con el token del vendedor y PostgreSQL valida todos los campos financieros.

El webhook conserva la validación HMAC oficial y persiste recibo más comercio en una transacción antes de responder. El worker mantiene idempotencia, leases, reintentos y finalización única. Reembolsos y cancelaciones usan el mismo contexto de vendedor. El modo histórico permanece disponible hasta activar explícitamente OAuth; no se rotó ni eliminó la credencial anterior.

## Setup de Marco

Usar una aplicación controlada por Marco/LUNA, sin borrar ni rotar la aplicación anterior. Habilitar Authorization Code con PKCE S256; permisos read, write, offline_access. Registrar exactamente:

- Callback staging: `https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-oauth-callback`
- Webhook staging: `https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook` (cada preference agrega el comercio).
- Panel staging: `https://taba2-staging.pages.dev/`

Ejecutar `scripts/mercadopago/configurar-oauth-staging.ps1` en PowerShell. Los secretos se ingresan ocultos y van a Supabase por HTTPS; no se escriben a archivos ni se imprimen. El script mantiene una clave de cifrado existente y genera una nueva sólo si falta. Cambia explícitamente staging al modo OAuth; no toca producción. Después debe verificarse una conexión con vendedor de prueba de la aplicación antes de declarar READY.

Si Client ID y Client Secret ya están configurados, ejecutar únicamente `scripts/mercadopago/configurar-webhook-staging.ps1`. Pide sólo la firma con entrada oculta, la envía por stdin a un proceso local y guarda exclusivamente MERCADOPAGO_OAUTH_WEBHOOK_SECRET. Comprueba las huellas de entorno y proyecto antes de escribir y verifica la huella del secreto guardado. No reemplaza las credenciales existentes ni activa OAuth; esa activación sigue a la verificación del callback y PKCE del proveedor.

Para la configuración manual de Webhooks de este comercio de staging, registrar `https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook?business_id=00000000-0000-4000-8000-000000000001`, modo productivo en el panel de Mercado Pago, evento Pagos (`payment`). El modo del panel del proveedor no cambia MERCADOPAGO_ENVIRONMENT=test. El parámetro permite resolver el comercio que requiere el receptor OAuth; cada preference continúa usando el business_id validado del pedido. Se verificaron públicamente callback (303 sin estado) y receptor (401 sin firma) antes de entregar estas URLs.

Variables nuevas: MERCADOPAGO_CLIENT_ID, MERCADOPAGO_CLIENT_SECRET, MERCADOPAGO_TOKEN_ENCRYPTION_KEY, MERCADOPAGO_CREDENTIAL_MODE, MERCADOPAGO_OAUTH_PROJECT_REF, MERCADOPAGO_OAUTH_PANEL_URL, MERCADOPAGO_OAUTH_WEBHOOK_SECRET y TABA_DEPLOYMENT_ENV. Se conservan MERCADOPAGO_ENVIRONMENT, MERCADOPAGO_WEBHOOK_SECRET, PAYMENT_LOG_HASH_SALT, PAYMENT_WORKER_SECRET, TABA_CHECKOUT_BASE_URL y TABA_ALLOWED_ORIGINS. En modo OAuth se usa exclusivamente la firma nueva; la firma histórica se conserva para rollback.

DEV usa fixtures y base descartable. STAGING usa test_token=true y proyecto de staging. Producción necesita otra configuración, callback/host/proyecto propios, revisión y activación de cobros explícitas. El guard rechaza cruce de proyecto o entorno y tokens cuyo live_mode no coincide. No se habilitaron pagos reales.

## Troubleshooting

- Callback inválido/expirado/repetido: iniciar otra conexión; no reutilizar code.
- Error de aplicación: verificar que client_id/client_secret y callback exacto pertenezcan a Marco y al mismo entorno; nunca imprimirlos.
- requires_reauthorization: reconectar. No modificar ciphertext ni reemplazar la clave para intentar recuperar tokens.
- Proveedor caído: el comprador sigue viendo el último estado confirmado; el worker reintenta. No aprobar por parámetros del navegador.
- Rollback: restaurar funciones y frontend anteriores, conservar las tablas nuevas y secretos protegidos. No eliminar historial ni ejecutar DROP sobre producción. Activar modo histórico sólo con la identidad previa verificada.

Logs propios contienen evento, hora, business_id y correlation_id; nunca tokens, códigos o contraseñas. Los registros del proxy deben tratarse como sensibles si contienen URLs OAuth.

## Documentación oficial consultada

- [Authorization Code y PKCE](https://www.mercadopago.com.ar/developers/en/docs/security/oauth/creation)
- [Scopes y token endpoint](https://www.mercadopago.com.ar/developers/es/reference/authentication/oauth/_oauth_token/post)
- [Refresh](https://www.mercadopago.com.br/developers/en/docs/security/oauth/renewal)
- [Revocación y ciclo de vida](https://www.mercadopago.com.ar/developers/en/docs/security/oauth/management)
- [Webhooks oficiales](https://github.com/mercadopago/openapi/blob/main/schemas/webhooks.yaml)

Los resultados ejecutados y limitaciones se registran en `MERCADOPAGO_OAUTH_VALIDATION.md`. Tener código o respuestas de mocks no constituye una autorización real de Mercado Pago.
