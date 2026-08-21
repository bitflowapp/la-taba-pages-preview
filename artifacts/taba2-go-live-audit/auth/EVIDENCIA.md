# Auditoría READ-ONLY · Auth de producción (TABA2)

**Fecha:** 2026-08-21 · **Worktree:** `<worktree>` @ `95ac129`
**Proyecto:** `wwcpogltfgzgkrlilbcd` · **Host:** `https://la-taba.pages.dev`
**Mutaciones:** **CERO.** Todo lo ejecutado fue leído antes y es de sólo lectura.

---

## 1. Qué se corrió y qué NO

| corrida | guion | veredicto de lectura | resultado |
|---|---|---|---|
| SÍ | `artifacts/taba2-go-live-audit/auth/get-auth-config.mjs` (escrito para esta auditoría) | **un único GET** a `/v1/projects/{ref}/config/auth`; secretos redactados a presencia | `auth-config-sanitized.json` |
| SÍ | `scripts/production-auth-posture.mjs` (`npm run production:auth`) | GET Management API + GET `/auth/v1/settings` + GET `/auth/v1/verify` con token inválido (no consume ni crea nada; sólo resuelve el `Location`) | **exit 0 · LA POSTURA ES LA ESPERADA** → `posture-report.json` |
| SÍ | `scripts/production-auth-health.mjs` (`npm run production:auth:health`) | GET config + SELECTs vía Management API con `read_only: true` y guarda `^(select|with)` | **exit 1 · 1 aviso: sin SMTP propio** → `health-report.json` |
| **NO** | `scripts/harden-production-auth.mjs` (`production:auth:harden`) | **MUTA** (PATCH config/auth). Prohibido por consigna. Sólo se leyó para documentar qué aplicó el go-live | — |
| **NO** | `scripts/production-registration-smoke.mjs` (`production:smoke:registration`) | leído: **crea identidades QA reales en `auth.users` de producción** (por SQL) y las limpia después. Es mutación → no se corrió | — |
| **NO** | ningún POST real de signup/recover contra producción | crearía cuentas o consumiría la cuota de 2 correos/hora | — |

El token del CLI se prestó por entorno con `scripts/lib/supabase-cli-token.mjs`
(`conToken`): nunca impreso, nunca en argv, nunca a disco. La clave publicable
se tomó del `runtime-config.js` **público** del sitio (viaja en cada page-load),
se usó desde archivo temporal y se borró; las sondas la reportan por huella.

## 2. SMTP — sigue SIN configurar (medido hoy)

| campo | valor medido 2026-08-21 |
|---|---|
| `smtp_host` / `smtp_user` / `smtp_pass` / `smtp_admin_email` / `smtp_sender_name` | **todos AUSENTES** |
| remitente efectivo | el **integrado de Supabase** (sin garantía de entrega) |
| `rate_limit_email_sent` | **2 correos/hora** para todo el proyecto |
| `smtp_max_frequency` | 60 s entre correos a la misma casilla |

Idéntico al estado medido el 2026-08-17 (`artifacts/taba2-production-auth-go-live/SMTP-PRODUCTION-STATUS.md`).
**Nadie configuró SMTP desde entonces: la compuerta sigue abierta.**

Sin SMTP mueren (medido en el go-live, no supuesto):
- **confirmación de registro** del equipo (Panel/Rider): GoTrue intenta mandar el
  correo, el envío falla y la transacción se revierte — el token de confirmación
  nunca existe; tras 2 intentos/hora, `429 over_email_send_rate_limit`;
- **«Olvidé mi contraseña»**: mismo mecanismo. La UI muestra copy neutro
  («si ese correo tiene una cuenta…») y el correo no llega.

**NO muere la venta:** el Customer compra con identidad **anónima**
(`signInAnonymously`), sin correo. Pedidos hoy: **ABIERTOS** (health).

## 3. Self-registration

- `disable_signup = false` (**abierto**) — a propósito: el ingreso anónimo del
  Customer pasa por el mismo `/signup`; cerrarlo apaga la tienda.
- `external_email_enabled = true` · `external_anonymous_users_enabled = true`.
- `mailer_autoconfirm = false` → **confirmación de email EXIGIDA** (enlaces
  vencen en 3600 s).
- Lo que vuelve inerte el signup abierto: crear identidad **no reparte rol**
  (sin fila en `business_members` las policies devuelven vacío). Verificado por
  el smoke del go-live (`AUTH-SMOKE-REPORT.md`).
- **Hoy, un cliente nuevo:** compra sin registrarse (anónimo, funciona). Si
  alguien intenta un alta CON correo (equipo), queda **sin confirmar y sin forma
  de confirmarse** salvo que uno de los 2 correos/hora best-effort llegue.
  Estado actual limpio: 0 cuentas sin confirmar, 0 solicitudes pendientes.

## 4. CAPTCHA

- `security_captcha_enabled = false`, secreto ausente (el «hcaptcha» del campo
  provider es el default, no una configuración).
- El recheck del go-live lo reclasificó: **no es compuerta externa** (la cuenta
  Cloudflare ya puede crear un widget Turnstile gratis); falta trabajo de
  cliente: los TRES clientes deben mandar el token en `/signup`, `/token` y
  `/recover`, incluido el ingreso anónimo — prenderlo sin eso **apaga la tienda**.
- Su propio criterio era «P1 antes de abrir pedidos» y los pedidos **ya están
  abiertos** → P1 vigente.

## 5. Contención de abuso (rate limits, por IP)

`rate_limit_anonymous_users=30/h` · `rate_limit_verify=30/5min` ·
`rate_limit_otp=30/5min` · `rate_limit_token_refresh=150/5min` ·
`rate_limit_email_sent=2/h` · (`sms=30`, `web3=30`: flujos no usados).
Todos > 0; la sonda de postura los exige y pasó. Además la identidad anónima se
crea recién cuando la persona guarda algo (fix del go-live), no por visita.

## 6. Sesiones y contraseñas

| | valor | ¿sano? |
|---|---|---|
| `jwt_exp` | 3600 s | sí (default recomendado) |
| `refresh_token_rotation_enabled` | **true** · reuse interval 10 s | sí |
| `sessions_timebox` / `sessions_inactivity_timeout` | 0 / 0 (**no caducan**) | decisión de producto documentada · P2 |
| `password_min_length` | **12** | sí |
| `password_hibp_enabled` | **true** (aplicado por el hardening `harden-production-auth.mjs`) | sí |
| `security_update_password_require_reauthentication` | **true** | sí |
| `mfa_totp_enroll_enabled` | true (disponible, no exigido) | ok |

## 7. Recuperación de contraseña — el flujo EXISTE en el frontend

- Botón **«Olvidé mi contraseña»**: `js/business/business-access-registration.js:143`.
- Handler: `js/production-operations.js:305–313` → `requestPasswordRecovery`.
- `js/services/supabase-auth.js:142–164`: `resetPasswordForEmail(email)` **sin
  `redirectTo`** (coherente con la allow-list vacía) y copy neutro anti-enumeración.
- Cierre del enlace: `cuenta/index.html` + `js/account-action.js` — lee
  `token_hash` de la query, canjea por **POST `verifyOtp`** (nunca lee tokens del
  fragmento), sesión de recuperación en memoria (`persistSession:false`), y tras
  cambiar la contraseña **cierra la sesión**. Tipos: recovery, signup, email,
  email_change, invite, magiclink.
- **Pero sin SMTP el tramo del correo no entrega** → el flujo está completo en
  código y muerto en la práctica (best-effort 2/h). Certificación end-to-end
  pendiente de SMTP (§7 de `SMTP-PRODUCTION-STATUS.md`).

## 8. Postura de redirects (medida por el camino real)

`site_url = https://la-taba.pages.dev` · `uri_allow_list` **vacía** = mínimo
privilegio. Sonda con 9 candidatos: **permite sólo** el site_url + las IP de
loopback literales (`127.0.0.1`, `[::1]`) que GoTrue exime SIEMPRE (comportamiento
del servidor, no configurable; P2 documentado). Staging, github.io, `localhost`
con nombre y hosts remotos ajenos: **rechazados** → falla cerrada.

## 9. Salud viva (health, hoy)

7 identidades (5 anónimas · 2 con correo) · 0 altas última hora · 0 sin
confirmar · 0 solicitudes pendientes (1 aprobada) · equipo activo 2 (**1 owner**)
· 4 sesiones vivas · pedidos **ABIERTOS** · 81 eventos de identidad.

---

## Clasificación

| nivel | hallazgo | por qué ahí |
|---|---|---|
| **P0 — impide vender hoy** | **NINGUNO.** | La venta es anónima + MP; no toca correo. Postura de Auth = la esperada (exit 0). |
| **P1 — antes de publicidad masiva** | **1. SMTP ausente** (la compuerta conocida, sigue abierta). | Alta de equipo y recuperación de contraseña no entregan correo. Riesgo operativo concreto: hay **UN solo owner**; si pierde la contraseña, la administración queda afuera sin camino confiable de vuelta. Aplicarlo es 1 comando con proveedor + remitente decididos (§5 del status doc). |
| **P1** | **2. CAPTCHA/Turnstile apagado con pedidos ABIERTOS.** | El criterio del propio go-live («P1 antes de abrir pedidos») ya venció. Requiere widget (la cuenta CF ya puede crearlo) + que los 3 clientes manden el token; prenderlo sin eso apaga el ingreso anónimo. Contención actual: 30/h/IP + signup inerte. |
| **P2** | Oráculo de enumeración en `/auth/v1/recover` (existente→429, inexistente→200; efecto colateral del no-SMTP — re-medir al configurarlo) · sesiones sin caducidad (timebox/inactividad=0) · exención loopback por IP de GoTrue · remitente/marca «La Taba» vs «TABA2» en la PWA. | Documentados en `SECURITY-RECHECK.md`; sin cambio. |

**Conclusión:** el hardening aplicado el 2026-08-16/17 sigue intacto y medido
igual hoy; **no hubo deriva**. La única compuerta externa sigue siendo SMTP, y
ahora se le suma que el criterio temporal del captcha ya se cumplió (pedidos
abiertos). Ninguna de las dos impide vender hoy.

## Archivos de esta auditoría

- `EVIDENCIA.md` (este archivo)
- `get-auth-config.mjs` — sonda GET-only escrita para esta auditoría
- `auth-config-sanitized.json` — config/auth con secretos redactados a presencia
- `run-sondas-lectura.mjs` — wrapper (token por entorno, clave publicable del sitio)
- `posture-report.json` — salida de `production:auth` (exit 0)
- `health-report.json` — salida de `production:auth:health` (exit 1, aviso SMTP)
