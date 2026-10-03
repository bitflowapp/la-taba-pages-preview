# Superficie de Secretos — TABA2 E2E Test Staging
**Fecha**: 2026-08-05  
**Agente**: TABA2_E2E_TEST_STAGING

ESTE DOCUMENTO NO CONTIENE SECRETOS. Solo describe qué tipos de secretos existen, dónde viven y qué reglas aplican.

---

## Secretos Encontrados en el Repositorio

### Archivos .env en todos los worktrees inspeccionados:

| Worktree | Archivo | ¿Versionado? | Contenido |
|---|---|---|---|
| RC_PANEL | `.env.example` | SÍ (ok) | Template sin valores reales |
| RC_PANEL | `services/arca-fiscal-bridge/.env.example` | SÍ (ok) | Template ARCA sin valores |
| MP_CHECKOUT | `.env.example` | SÍ (ok) | Template sin valores reales |
| MP_STAGING_RC1 | `.env.example` | SÍ (ok) | Template sin valores reales |
| PAYMENT_RECOVERY | `.env.example` | SÍ (ok) | Template sin valores reales |
| RIDER_MAP | (ninguno) | — | No aplica |
| RIDER_AUTOMATION | (ninguno) | — | No aplica |

**Resultado**: Ningún secreto real en Git. Solo archivos `.env.example`. ✅

---

## Categorías de Secretos para el E2E Test

### 1. Credenciales Mercado Pago TEST

| Tipo | Permiso | Dónde vive | Regla |
|---|---|---|---|
| Public Key TEST | Solo frontend (public) | Variable de entorno de build | No en Git. No en logs. |
| Access Token TEST | Solo backend Edge Functions | Supabase secrets (staging) | NUNCA en frontend. NUNCA en APK. |
| Webhook Secret TEST | Solo backend Edge Functions | Supabase secrets (staging) | NUNCA en logs. NUNCA en artefactos. |

**PROHIBIDO**: Access Token productivo, Public Key productiva, dinero real.

### 2. Credenciales Supabase Staging

| Tipo | Permiso | Dónde vive | Regla |
|---|---|---|---|
| `SUPABASE_URL` staging | Frontend y backend | Variable de entorno (non-secret) | No confundir con prod URL |
| `SUPABASE_ANON_KEY` staging | Frontend (public) | Variable de entorno | No en Git. Solo staging. |
| `SUPABASE_SERVICE_ROLE_KEY` staging | Solo backend | Supabase secrets / Edge Fn env | NUNCA en frontend. NUNCA en APK. |

### 3. Cuenta Mercado Pago de Prueba

| Tipo | Permiso |
|---|---|
| Usuario comprador de prueba | Solo en la prueba E2E. No usar cuenta personal real. |
| Tarjeta de prueba MP | Solo las tarjetas oficiales de test de MP. No tarjetas reales. |
| Contraseña QA | Rotar al finalizar el cleanup. |

### 4. APK Rider

| Regla |
|---|
| No incluir access tokens ni service_role en el APK. |
| El APK usa solo el anon_key del staging. |
| El APK no debe tener credenciales MP embebidas. |

---

## Política de Logging y Artefactos

Los artefactos del E2E test NO deben contener:

- Access Token (ningún fragmento)
- Public Key completa
- Webhook Secret (ningún fragmento)
- Tarjetas de prueba completas (solo tipo/sufijo enmascarado)
- Emails de cuentas humanas (solo sufijo enmascarado)
- Teléfonos humanos
- Direcciones humanas reales

En reportes, informar únicamente:
- Tipo de credencial: `mp_access_token_test`
- Presente: `true/false`
- Formato válido: `true/false`
- Entorno: `test`
- Longitud: `número de caracteres`
- NO fingerprint salvo política aprobada

---

## Directorios a Escanear antes de Gate 2

Antes del deploy de staging, ejecutar secret scan sobre el E2E RC:

```bash
# Buscar tokens MP (patrón APP_USR)
git -C D:\1212\la-taba-e2e-test-staging-rc grep -i "APP_USR" -- "*.js" "*.ts" "*.json" "*.sql"

# Buscar claves de servicio Supabase
git -C D:\1212\la-taba-e2e-test-staging-rc grep -i "service_role" -- "*.js" "*.ts" "*.json"

# Buscar URLs de producción (si existen)
git -C D:\1212\la-taba-e2e-test-staging-rc grep -i "supabase.co" -- "*.js" "*.ts"
```

---

## Directorios de Secretos Externos (SOLO REFERENCIA, NO EXAMINAR)

- `C:\1212\secrets\` — directorio de secretos externos de la sesión. NO leer. NO copiar a Git.
- `C:\1212\supabase\` — configuración de Supabase local. NO incluir en artefactos.

---

## Checklist de Secretos Pre-Staging

- [ ] No hay `.env` con valores reales en el E2E RC
- [ ] `git log --all --full-history -- "**/.env"` no muestra secretos
- [ ] Secret scan limpio (ver comandos arriba)
- [ ] Access Token MP configurado SOLO como Supabase secret (no en código)
- [ ] Public Key MP configurada como variable de build (no hardcodeada)
- [ ] No hay referencias a `jariel1970@gmail.com` ni domicilio personal en código
- [ ] El comprador de prueba NO es la cuenta personal del vendedor
