# Mercado Pago: configuración exacta y autorizaciones pendientes

Base preservada: commit `3123704d`, rama `recovery/la-taba-free-hosted-20261020`. Destino actual **exclusivamente de pruebas**, Supabase Free `ixewllzzuzpqrkxzmfzx`.

La copia de trabajo operativa está ahora en **D:/work/la-taba-free-review-20261020** porque C: se quedó sin espacio. La rama ya existe también en GitHub. Ver [resultados de respaldo y restauración](2026-10-21-backup-restore-results.md) y [plan de pruebas alojadas](2026-10-21-hosted-payment-test-plan.md).

## 1. URLs exactas

| Uso | Valor |
|---|---|
| Callback OAuth | `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback` |
| Webhook | `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-webhook` |
| Panel de retorno OAuth | `https://recovery-20261020.taba2-staging.pages.dev/` |
| Compra aprobada | `https://recovery-20261020.taba2-staging.pages.dev/pago/resultado` |
| Pendiente | `https://recovery-20261020.taba2-staging.pages.dev/pago/pendiente` |
| Error | `https://recovery-20261020.taba2-staging.pages.dev/pago/error` |

Las dos primeras se derivan de `oauthConfig()` en `supabase/functions/_shared/seller-oauth.ts`; los retornos de compra salen de `checkoutReturnUrl()` en `payment-runtime.ts`. Las páginas de frontend siguen **sin publicar**. No confundir retorno del comprador, callback OAuth y webhook. El retorno del comprador no confirma un pago.

## 2. Mercado Pago: intervención imprescindible

Aplicación actual: **TABA2 Staging**, ID **2691240967769590**. [Abrir aplicación](https://www.mercadopago.com.ar/developers/panel/app/2691240967769590).

### OAuth

1. Entrar a **Tus integraciones**, seleccionar TABA2 Staging y **Editar aplicación** mediante el lápiz junto al nombre.
2. En **Configuraciones avanzadas → URLs de redireccionamiento**, agregar el callback exacto de la tabla. Mantener los valores anteriores salvo que se decida retirarlos expresamente.
3. Habilitar **Usar el flujo de código de autorización con PKCE**. La implementación envía S256.
4. Verificar permisos de **lectura, escritura y acceso offline**: el código solicita `read write offline_access`.
5. Guardar. No modificar la aplicación comercial `7677852968049976` durante estas pruebas.

El callback debe coincidir exactamente: HTTPS, ruta indicada, sin comodines, parámetros ni slash adicional. [Documentación OAuth](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation), [configuración avanzada](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/resources/your-integrations/application-details?scope=prod).

### Webhook y firma

1. En la misma aplicación: **Webhooks → Configurar notificaciones → URL modo pruebas**. Usar la URL de webhook de la tabla; ya fue guardada mediante la herramienta.
2. Verificar **Pagos / payment**. Es el evento que procesa el modo OAuth actual. Los temas históricos presentes pueden ser ignorados por este receptor; no ampliar la suscripción para dar por cubiertos otros circuitos.
3. Guardar y revelar/copiar la **clave secreta/firma completa** de esa aplicación. La herramienta sólo entrega un prefijo y no alcanza para configurar HMAC.
4. Abrir [Supabase → Edge Functions → Secrets](https://supabase.com/dashboard/project/ixewllzzuzpqrkxzmfzx/functions/secrets).
5. Crear el secreto **`MERCADOPAGO_OAUTH_WEBHOOK_SECRET`** y pegar allí la firma completa. Guardar. No enviarla por chat, capturas, correo ni repositorio.

No rotar la firma innecesariamente ni reemplazar la URL de producción de la aplicación. [Instrucciones oficiales de Webhooks](https://www.mercadopago.com.ar/developers/es/docs/prestashop/additional-content/your-integrations/notifications/webhooks).

## 3. Variables realmente usadas por las funciones

Verificadas contra `seller-oauth.ts`, `payment-runtime.ts`, `recovery-deployment.ts`, `mercadopago-webhook/index.ts` y el inventario de Supabase. No se creó una variable ficticia para habilitar/deshabilitar pagos.

### Secretos de servidor

| Nombre exacto | Estado comprobado | Origen y acción |
|---|---|---|
| `MERCADOPAGO_CLIENT_SECRET` | Presente | Client Secret de TABA2 Staging; ya guardado. No es la contraseña de Walter |
| `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` | **Falta** | Firma completa de Webhooks de esa misma app; copiar directamente a Supabase |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | Presente | Clave interna AES-GCM de 32 bytes codificada base64url; no rotar sin migrar tokens |
| `PAYMENT_LOG_HASH_SALT` | Presente | Sal interna de hash para datos de logs; no solicitar a Mercado Pago |
| `PAYMENT_WORKER_SECRET` | Presente | Secreto HMAC interno del worker; no es la firma de Mercado Pago |
| `SUPABASE_URL` | Presente, automático | Inyectado por Supabase |
| `SUPABASE_ANON_KEY` | Presente, automático | Inyectado por Supabase; no copiar service_role al frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Presente, automático | Exclusivamente servidor |

Los valores se almacenan en **Edge Functions → Secrets**, no en frontend, `.env` público ni campos de la aplicación de Mercado Pago. No hace falta volver a proporcionar los ya guardados.

### Configuración no secreta del entorno alojado

| Nombre exacto | Valor vigente |
|---|---|
| `MERCADOPAGO_CLIENT_ID` | `2691240967769590` |
| `MERCADOPAGO_CREDENTIAL_MODE` | `oauth` |
| `MERCADOPAGO_ENVIRONMENT` | `test` |
| `MERCADOPAGO_OAUTH_ENVIRONMENT` | `test` |
| `TABA_DEPLOYMENT_ENV` | `staging` |
| `MERCADOPAGO_OAUTH_PROJECT_REF` | `ixewllzzuzpqrkxzmfzx` |
| `TABA_RECOVERY_PROJECT_REF` | `ixewllzzuzpqrkxzmfzx` |
| `TABA_RECOVERY_CHECKOUT_ORIGIN` | `https://recovery-20261020.taba2-staging.pages.dev` |
| `MERCADOPAGO_OAUTH_PANEL_URL` | `https://recovery-20261020.taba2-staging.pages.dev/` |
| `TABA_CHECKOUT_BASE_URL` | `https://recovery-20261020.taba2-staging.pages.dev` |
| `TABA_ALLOWED_ORIGINS` | `https://recovery-20261020.taba2-staging.pages.dev` |

Estas variables ya están en Supabase Secrets por ser configuración de Edge. `FISCAL_PANEL_ORIGINS` existe en fiscal-artifact-access y será necesario para permitir al navegador del preview acceder al módulo fiscal; no es un secreto de Mercado Pago ni acredita el circuito fiscal.

`MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET` pertenecen a ramas heredadas; **no configurarlos como sustituto de OAuth**. `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` y `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` deben seguir ausentes. Los pagos comerciales se controlan además mediante la base y los vínculos de despliegue verificados.

## 4. Autorización segura de Walter: preparada, no ejecutada

No se debe enviar a Walter un enlace estático construido con un state inventado. La autorización se inicia en el panel con una sesión administrativa vigente y rol owner/admin del comercio:

1. El panel llama `mercadopago-connect` con `action=connect` y su `business_id` autorizado.
2. El servidor valida sesión y permisos; crea state aleatorio de un solo uso y PKCE S256, persiste el verificador cifrado ligado a comercio/proyecto/entorno y devuelve `authorization_url`.
3. Walter abre esa URL oficial de Mercado Pago, inicia sesión personalmente y revisa los permisos. No comparte contraseña, MFA, Access Token ni código de retorno.
4. Mercado Pago vuelve al callback; el servidor consume el state, revalida la sesión y rol originales, intercambia el código y verifica el vendedor. Guarda access/refresh tokens cifrados y su vencimiento.
5. La conexión no equivale a aprobación para cobrar: el interruptor comercial debe seguir apagado hasta la validación final.

El proyecto actual **rechaza cambiar sus variables a producción** y solicita `test_token=true`. Por eso primero se usa el vendedor QA. La vinculación real de Walter requiere después confirmar aplicación/titularidad comercial y aprobar un vínculo de despliegue comercial distinto, sin reutilizar credenciales de prueba ni habilitar pagos como efecto colateral. No se accedió a credenciales comerciales ni se generó una autorización comercial.

## 5. Cloudflare

La sesión antigua respondió 403; su refresh existente se renovó mediante el flujo oficial y ahora devuelve 200. `taba2-staging` es Direct Upload, con rama principal `staging`. No hace falta autenticación manual en esta etapa. **No se publicó ningún despliegue.**

## 6. Qué avisar después de la intervención

Confirmar solamente: callback registrado, PKCE habilitado, permisos revisados y firma guardada en Supabase. No adjuntar ningún secreto. Con esos pasos se puede comprobar OAuth de prueba y el webhook antes de pedir la autorización comercial de Walter.
