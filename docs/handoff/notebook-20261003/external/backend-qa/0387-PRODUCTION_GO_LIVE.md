# TABA — PRODUCTION GO-LIVE & ARCHITECTURE GUIDE

**Fecha de emisión:** 2026-09-08  
**Release Candidate Validado:** `899caaf` (`feature/taba-mercadopago-oauth`)  
**Service Worker Runtime:** `la-taba-runtime-v97-explicit-seller-status`  
**Estado General:** `PRODUCTION_READY: PENDING_MP_APP_CREDENTIALS_AND_WALTER_OAUTH`  
**Compuerta de Cobro:** Estricta `fail-closed` (0 cobros reales posibles)

---

## 1. Modelo de Autoridad OAuth de Mercado Pago

La arquitectura de pagos de TABA sigue el modelo oficial de **Mercado Pago Marketplace / Integrador (OAuth 2.0 Authorization Code con PKCE S256)**:

| Concepto | Titular / Responsable | Rol en el Sistema |
|---|---|---|
| **OAUTH_APP_OWNER** | **MARCO / LUNA** | Desarrollador y operador de la plataforma integradora TABA. |
| **SELLER** | **WALTER** | Comerciante titular de "La Taba", receptor directo de los fondos de las ventas. |
| **CLIENT_ID_OWNER** | **MARCO / LUNA** | Identificador público de la aplicación de Marco en Mercado Pago Developers. |
| **CLIENT_SECRET_OWNER** | **MARCO / LUNA** | Secreto de servidor de la aplicación de Marco para intercambiar el `code` por tokens. |
| **SELLER_ACCESS_TOKEN_OWNER** | **WALTER** | Token de vendedor generado cuando Walter aprueba el consentimiento en `auth.mercadopago.com.ar`. Permite a TABA crear checkout preferences en nombre de Walter. |
| **WEBHOOK_CONFIGURATION_OWNER** | **MARCO / LUNA** | Configurado en la aplicación de Marco en Developers para notificar a `mercadopago-webhook`. La firma HMAC pertenece a esa app. |

> [!IMPORTANT]
> **Walter NUNCA debe crear una aplicación en Mercado Pago Developers.**
> Walter no es desarrollador; es el comerciante (*seller*). Walter sólo inicia sesión con su cuenta comercial habitual de Mercado Pago / Mercado Libre y pulsa **Aceptar** para autorizar a la plataforma TABA.

---

## 2. Arquitectura Final Desplegada

| Componente | Staging | Producción | Estado |
|---|---|---|---|
| **URL Pública (Cloudflare Pages)** | `https://taba2-staging.pages.dev` | `https://la-taba.pages.dev` | Sincronizados en `899caaf` |
| **Deployment ID Cloudflare** | `29d63569` (rama `staging`) | `b77fffe3` (rama `main`) | Verificados vía `/version.json` |
| **Supabase Project Ref** | `ukxqbgswjlibmnjemrzd` | `wwcpogltfgzgkrlilbcd` | Activos y saludables en `us-east-1` |
| **Ledger de Migraciones** | 120 migraciones (`20260905195357`) | 120 migraciones (`20260905195357`) | Drift: 0 migraciones |
| **Business UUID** | `3537d949-d76b-410d-be89-e4f447546e29` (Walter Staging) | `00000000-0000-4000-8000-000000000001` (Canónico) | Identidad canónica verificada |
| **Edge Functions Activas** | 9 desplegadas (7 core + 2 reversa) | 9 desplegadas (7 core + 2 reversa) | Mismo árbol de código |
| **Rider Android Nativo** | `la-taba-rider-android` (`95294d9`) | Compatible con ambos entornos | Contratos alineados |

---

## 3. Matriz de Secretos en Producción (`wwcpogltfgzgkrlilbcd`)

| Secreto | Estado | Origen / Responsable | Propósito |
|---|---|---|---|
| `TABA_DEPLOYMENT_ENV` | ✅ `production` | Infraestructura TABA | Entorno operativo de Edge Functions |
| `MERCADOPAGO_CREDENTIAL_MODE` | ✅ `oauth` | Infraestructura TABA | Obliga enrutamiento OAuth multi-seller |
| `MERCADOPAGO_ENVIRONMENT` | ✅ `production` | Infraestructura TABA | Define entorno productivo de proveedor |
| `MERCADOPAGO_OAUTH_PROJECT_REF` | ✅ `wwcpogltfgzgkrlilbcd` | Infraestructura TABA | Aislamiento estricto contra crossover |
| `MERCADOPAGO_OAUTH_PANEL_URL` | ✅ `https://la-taba.pages.dev/` | Infraestructura TABA | Retorno seguro del navegador al panel |
| `TABA_CHECKOUT_BASE_URL` | ✅ `https://la-taba.pages.dev` | Infraestructura TABA | Base URLs de retorno de compradores |
| `TABA_ALLOWED_ORIGINS` | ✅ `https://la-taba.pages.dev` | Infraestructura TABA | CORS estricto en el edge |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | ✅ AES-GCM 256 (Base64url) | Infraestructura TABA | Cifrado en reposo de refresh/access tokens |
| `PAYMENT_LOG_HASH_SALT` | ✅ SHA-256 (Hex 32 B) | Infraestructura TABA | Anonimización criptográfica en logs |
| `PAYMENT_WORKER_SECRET` | ✅ HMAC (Hex 32 B) | Infraestructura TABA | Autenticación interna de reintentos |
| `MERCADOPAGO_CLIENT_ID` | ❌ **MISSING** | App de Marco en MP Developers | Client ID numérico de la App productiva |
| `MERCADOPAGO_CLIENT_SECRET` | ❌ **MISSING** | App de Marco en MP Developers | Clave secreta para intercambio OAuth |
| `MERCADOPAGO_OAUTH_WEBHOOK_SECRET`| ❌ **MISSING** | App de Marco en MP Developers | Clave HMAC de firma de webhooks |
| `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | 🔒 **FAIL-CLOSED** | Marco (post-autorización) | Compuerta final de cobro real |

---

## 4. Acción Requerida de Marco (`HUMAN_ACTION_REQUIRED`)

Para que el botón **Conectar Mercado Pago** en producción pueda redirigir a `auth.mercadopago.com.ar`, Marco debe obtener las 3 credenciales de su aplicación productiva en Mercado Pago Developers:

```text
HUMAN_ACTION_REQUIRED

ACCOUNT_OWNER:
Marco / LUNA (marcoantoniolunavillegas@gmail.com)

APPLICATION:
Aplicación de la plataforma TABA en Mercado Pago Developers (crear "La Taba Producción" o activar credenciales de producción en la integración existente).

MERCADO_PAGO_MENU:
1. Ingresar a https://www.mercadopago.com.ar/developers/panel/app
2. En "Tus integraciones", seleccionar la aplicación de TABA (o crear una nueva).
3. En el menú lateral:
   - "Credenciales de producción": Copiar Client ID y Client Secret.
   - "OAuth": Configurar la Redirect URI:
     https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-oauth-callback
   - "Webhooks": Configurar URL de producción:
     https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-webhook
     Modo: Productivo. Eventos: Pagos (payment).
     Copiar la "Firma secreta" (Webhook Secret).

NEEDED:
- MERCADOPAGO_CLIENT_ID (número)
- MERCADOPAGO_CLIENT_SECRET (clave secreta)
- MERCADOPAGO_OAUTH_WEBHOOK_SECRET (clave secreta de webhooks)

TIME_ESTIMATE:
3 a 5 minutos.
```

### Cómo cargar las credenciales en producción:
Marco ejecuta desde la terminal del repositorio:
```powershell
powershell -File scripts/mercadopago/configurar-oauth-produccion.ps1
```
El script solicita los datos con entrada oculta y los inyecta directamente a Supabase Producción (`wwcpogltfgzgkrlilbcd`) vía HTTPS autenticado. Ningún secreto se imprime ni se guarda en disco.

---

## 5. Pasos para la Sesión Presencial con Walter (Miércoles)

Una vez que Marco haya cargado las credenciales de su aplicación:

1. **Marco** abre en la notebook: `https://la-taba.pages.dev/#business` (ventana limpia / incógnito).
2. **Marco** inicia sesión como Dueño del negocio canónico (`jariel1970@gmail.com` o `jariel1970+e2e@gmail.com`).
3. **Marco** navega a **Pagos** y constata la tarjeta Mercado Pago en estado **No conectado**.
4. **Marco** hace click en **Conectar Mercado Pago** y cede el control a Walter.
5. **Walter:**
   - Ve la pantalla oficial de Mercado Pago en `auth.mercadopago.com.ar`.
   - Ingresa con su cuenta cobradora de Mercado Pago.
   - Resuelve el segundo factor (2FA) en su celular.
   - Confirma los permisos solicitados (`read`, `write`, `offline_access`).
6. El navegador redirige automáticamente a `https://la-taba.pages.dev/?mp_connection=connected#business`.
7. La tarjeta confirma: **✓ Mercado Pago conectado correctamente** con el `collector_id` de Walter.
8. La base de datos asienta la vinculación con `enabled = false` (cobros apagados por seguridad hasta prueba controlada).

---

## 6. Contingencia y Rollback

- **Si se conecta una cuenta equivocada:** Pulsar inmediatamente **Desconectar**. Esto ejecuta `mp_disconnect`, borra los tokens de inmediato y preserva la historia.
- **Kill switch de pagos:** Para apagar Mercado Pago en el acto:
  ```sql
  UPDATE public.business_payment_settings SET enabled = false WHERE business_id = '00000000-0000-4000-8000-000000000001';
  ```
- **Rollback de frontend en Pages:**
  ```powershell
  npx wrangler pages deployment rollback 0f59cc1a-efb6-45c9-b579-e406be3d06c7 --project-name la-taba
  ```
