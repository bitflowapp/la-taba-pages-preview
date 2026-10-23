# La Taba: configuración comercial para cobrar con la cuenta de Walter

Fecha: 21/10/2026. Rama `recovery/la-taba-free-hosted-20261020`. Este documento describe **qué falta para pasar de pruebas a cobros reales**. Nada de esto se ejecutó: requiere decisiones y autorizaciones de Marco y de Walter.

## 0. Dónde estamos

| Pieza | Pruebas (hoy) | Comercial (pendiente) |
|---|---|---|
| Backend Supabase | `ixewllzzuzpqrkxzmfzx` (org La Taba, plan Free) | **No existe.** El proyecto productivo anterior `wwcpogltfgzgkrlilbcd` ya no figura en la cuenta |
| Tienda | `https://recovery-20261020.taba2-staging.pages.dev` (preview, protegida con usuario y contraseña) | `https://la-taba.pages.dev` hoy sirve una versión vieja que apunta al backend que ya no existe |
| App de Mercado Pago | TABA2 Staging `2691240967769590` (sólo prueba) | La Taba Delivery `7677852968049976` (no se tocó) |
| Cuenta que cobra | Vendedor de prueba `3594962708` | La de Walter, vinculada por él mismo desde el panel |

Las credenciales de prueba **nunca** se reutilizan en el entorno comercial. El código lo impide: cada proyecto tiene un vínculo de despliegue fijo (`DEPLOYMENT_BINDINGS` en `supabase/functions/_shared/seller-oauth.ts`) que ata proyecto, entorno, aplicación de Mercado Pago y dominio; cualquier combinación distinta falla cerrada.

## 1. Decisión previa: dónde corre el backend comercial

| Opción | Costo | Respaldo | Riesgo |
|---|---|---|---|
| **A. Proyecto nuevo en Supabase Pro (recomendada)** | USD 25/mes por organización | Respaldos diarios (7 días), sin pausa por inactividad | El más bajo |
| B. Proyecto nuevo en Free | USD 0 | **Ninguno automático**; hay que sacar copias propias y guardarlas fuera de la PC | Pausa tras 7 días sin actividad; límites de 500 MB, 5 GB de tráfico y 500.000 invocaciones por mes; el cupo de 2 proyectos Free ya está ocupado |
| C. Promover el proyecto de pruebas | USD 0 | Igual que B | Mezcla datos de prueba con reales; no recomendado |

Necesita la decisión de Marco (y su medio de pago si es Pro).

## 2. Pasos técnicos, en orden

1. **Crear el proyecto** (sa-east-1) y aplicar todas las migraciones de `supabase/migrations` con `scripts/recovery/bootstrap-hosted.mjs` sobre un manifiesto regenerado (`recoveryPlan()`), igual que se hizo con el de pruebas. Configurar Auth: URL del sitio, plantillas en castellano, y **SMTP propio** (sin SMTP no funcionan la recuperación de contraseña ni las invitaciones al equipo).
2. **Agregar el vínculo de despliegue** del proyecto nuevo en `DEPLOYMENT_BINDINGS` (un commit revisado): `deployment: "production"`, entornos `production`, `clientId: "7677852968049976"`, URL del proyecto, y el dominio de la tienda en `panelUrl`, `checkoutBaseUrl` y `allowedOrigins`.
3. **Secretos de las funciones** (Supabase → Edge Functions → Secrets), todos nuevos, ninguno copiado de pruebas:

   | Nombre | Valor |
   |---|---|
   | `MERCADOPAGO_CLIENT_ID` | `7677852968049976` |
   | `MERCADOPAGO_CLIENT_SECRET` | Client Secret de la app comercial |
   | `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` | Firma de Webhooks de la app comercial |
   | `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | 32 bytes aleatorios nuevos (base64url) |
   | `PAYMENT_LOG_HASH_SALT`, `PAYMENT_WORKER_SECRET` | Nuevos, aleatorios |
   | `MERCADOPAGO_CREDENTIAL_MODE` | `oauth` |
   | `MERCADOPAGO_ENVIRONMENT`, `MERCADOPAGO_OAUTH_ENVIRONMENT` | `production` |
   | `TABA_DEPLOYMENT_ENV` | `production` |
   | `MERCADOPAGO_OAUTH_PROJECT_REF` | ref del proyecto nuevo |
   | `MERCADOPAGO_OAUTH_PANEL_URL` | `https://<dominio>/` |
   | `TABA_CHECKOUT_BASE_URL`, `TABA_ALLOWED_ORIGINS` | `https://<dominio>` |
   | `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | **Ausente** hasta la revisión final |
   | `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` | **Ausente**; sólo para el cobro real de prueba autorizado |

4. **App comercial de Mercado Pago `7677852968049976`** (lo hace el titular de la app, con su verificación):
   - URL de redireccionamiento: `https://<ref>.supabase.co/functions/v1/mercadopago-oauth-callback` (exacta). Habilitar **PKCE**. Permisos: lectura, escritura y acceso offline.
   - Webhooks, URL de **producción**: `https://<ref>.supabase.co/functions/v1/mercadopago-webhook`. Eventos: **Pagos** y **Vinculación de aplicaciones**. Copiar la firma al secreto `MERCADOPAGO_OAUTH_WEBHOOK_SECRET`.
5. **Desplegar** las 13 funciones (`deploy-functions.mjs` / `sync-hosted.mjs`) y la tienda candidata en Cloudflare Pages (proyecto `la-taba`) con su `runtime-config` productivo (`scripts/build-production-runtime-config.mjs`). La tienda puede publicarse con el cobro online apagado: se vende en efectivo o transferencia.
6. **Walter vincula su cuenta** desde el panel: Más → Configuración → **Mercado Pago** → «Conectar Mercado Pago». Inicia sesión en Mercado Pago con **su** usuario (conviene la cuenta del comercio) y acepta. El panel muestra «Vinculada con *apodo* · *correo enmascarado*»: si no es la cuenta correcta, «Desvincular» y volver a conectar **antes** del primer cobro (después, cambiar de cuenta requiere soporte para no mezclar cobros).
7. **Vincular no habilita cobros.** En producción la vinculación deja el cobro apagado. Para encenderlo hacen falta, en este orden:
   1. catálogo validado por Walter (precios, stock, fotos con derechos);
   2. un cobro real de prueba **autorizado por escrito** (monto chico, con devolución), con `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` cargado sólo para esa prueba;
   3. `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`;
   4. el interruptor de operador `scripts/mercadopago/cobro-negocio.mjs encender --revision-aprobada` (actualizar el ref antes de usarlo).

## 3. Lo que Walter puede hacer solo, sin desarrollador

- Ver si hay una cuenta vinculada, cuál, desde cuándo y en qué entorno.
- Vincular, reconectar (si Mercado Pago revocó o venció el permiso) y desvincular. Desvincular nunca deja cobros a ciegas: si hay pagos o devoluciones sin cerrar, el panel lo explica, pausa los cobros nuevos y espera.
- **Pausar** los cobros online en cualquier momento. Volver a encenderlos es decisión de la plataforma.
- Devolver dinero (total o parcial) y cancelar pagos pendientes, con confirmación escrita.

## 4. Rollback

- Cobros: «Pausar cobros online» desde el panel, o `cobro-negocio.mjs apagar`.
- Funciones: redesplegar la versión anterior desde el commit previo.
- Tienda: promover el despliegue anterior en Cloudflare Pages.
