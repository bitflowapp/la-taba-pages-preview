# SMTP productivo · estado

**Estado: NO CONFIGURADO. Es la única compuerta externa que queda.**
Medido el 2026-08-17 contra `wwcpogltfgzgkrlilbcd`.

---

## 1. Lo que hay hoy, medido

| | |
|---|---|
| `smtp_host` | `null` — no hay proveedor propio |
| `smtp_user` / `smtp_pass` | `null` |
| `smtp_admin_email` (remitente) | `null` |
| `smtp_sender_name` | `null` |
| remitente efectivo | el **integrado de Supabase** |
| `rate_limit_email_sent` | **2 correos por hora**, para todo el proyecto |
| `smtp_max_frequency` | 60 s entre correos a la misma dirección |
| `mailer_autoconfirm` | `false` — la confirmación se exige, como corresponde |
| `mailer_otp_exp` | 3600 s — los enlaces vencen en una hora |
| `site_url` | `https://la-taba.pages.dev` |

El remitente integrado de Supabase **no es un remitente de producción**: está
pensado para desarrollo, no tiene garantía de entrega y su cuota es de dos
correos por hora. Se agotó sola durante esta misión, con dos intentos de alta.

## 2. Qué es exactamente lo que no funciona sin esto

No es «los correos tardan». Es que **el alta pública no puede completarse**:

1. Alguien crea su cuenta en el Panel.
2. GoTrue genera el token de confirmación, intenta mandar el correo, el envío
   falla, y **la transacción se revierte**: el token nunca llega a existir.
3. La persona queda con una cuenta sin confirmar y sin forma de confirmarla.

Lo mismo vale para «Olvidé mi contraseña».

Medido en esta misión: `/auth/v1/signup` contestó `429 over_email_send_rate_limit`
después de dos intentos, y `/auth/v1/recover` sobre una cuenta existente contestó
distinto que sobre una inexistente **porque el envío falla** (ver
`SECURITY-RECHECK.md`, oráculo de enumeración).

## 3. La decisión humana, reducida a tres datos

Todo lo demás está hecho. Falta **elegir proveedor, obtener la credencial y
decidir la dirección remitente**. Con eso, aplicar es un comando.

### Opción A — con dominio propio (recomendada)

Es la única que da entregabilidad seria y una dirección que se parece al
producto (`no-responder@<dominio>`). Requiere comprar un dominio (~USD 12/año)
y verificarlo en el proveedor.

| Proveedor | Gratis por mes | Verificación | SMTP |
|---|---|---|---|
| Resend | 3.000 | dominio | `smtp.resend.com:587`, usuario `resend` |
| Brevo | 9.000 | dominio o remitente único | `smtp-relay.brevo.com:587` |
| Amazon SES | pago desde el primer correo | dominio | `email-smtp.<region>.amazonaws.com:587` |

> En el entorno de esta máquina hay una variable `MAIL_FROM=onboarding@resend.dev`.
> **No es una cuenta de TABA**: `onboarding@resend.dev` es el remitente de prueba
> compartido de Resend, y sólo entrega a la casilla del dueño de la cuenta. No
> sirve para producción y no se usó.

### Opción B — sin dominio, con remitente único verificado

Brevo y SendGrid permiten verificar **una dirección** (por ejemplo una casilla
propia) sin dominio. Sirve para arrancar y es reversible, con dos costos:

* la dirección remitente no se parece al sitio, y
* la entregabilidad es peor: el DKIM lo firma el proveedor y el dominio del
  remitente (gmail.com, por caso) publica su propio DMARC, que no autoriza a ese
  proveedor. Muchos destinatarios lo marcan como spam.

Es una decisión de producto, no técnica.

## 4. El contrato que hay que llenar

| dato | quién lo decide | ejemplo |
|---|---|---|
| `TABA_SMTP_HOST` | el proveedor | `smtp.resend.com` |
| `TABA_SMTP_PORT` | el proveedor | `587` (STARTTLS) o `465` (TLS directo) |
| `TABA_SMTP_USER` | el proveedor | `resend` |
| `TABA_SMTP_PASS` | el proveedor | la API key — **nunca en un archivo del repo** |
| `TABA_SMTP_SENDER_EMAIL` | Marco | `no-responder@<dominio verificado>` |
| `TABA_SMTP_SENDER_NAME` | ya decidido | `La Taba` |

**Sobre el nombre del remitente.** El comercio canónico en la base se llama
`La Taba`, y así lo dicen los seis correos. La PWA todavía se presenta como
`TABA2 · Tienda de bebidas` en el `manifest` y en el `<title>`: es una
inconsistencia de marca real, anotada como P2. Los correos usan el nombre del
comercio, que es el que la persona conoce.

## 5. Cómo se aplica, cuando exista

```powershell
$env:TABA_SMTP_HOST         = "smtp.proveedor.com"
$env:TABA_SMTP_PORT         = "587"
$env:TABA_SMTP_USER         = "<usuario>"
$env:TABA_SMTP_PASS         = "<credencial>"
$env:TABA_SMTP_SENDER_EMAIL = "no-responder@<dominio>"
$env:TABA_SMTP_SENDER_NAME  = "La Taba"
$env:TABA2_PRODUCTION_AUTH_HARDENING = "I_AUTHORIZE_TABA2_PRODUCTION_AUTH_HARDENING"
$env:SUPABASE_ACCESS_TOKEN  = "<token del CLI>"

node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd --smtp            # ensayo
node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd --smtp --apply    # aplica
```

El guion:

* **se niega** si falta cualquiera de los seis datos: un remitente a medias no
  manda nada y deja el proyecto peor que antes;
* valida el puerto contra los de SMTP conocidos y el formato del remitente;
* **nunca imprime** el usuario ni la credencial, ni en el ensayo;
* sube `rate_limit_email_sent` de 2 a 30 por hora (ajustable con
  `--emails-hora`), porque 2 es el techo del remitente integrado;
* relee la configuración después de escribir y reporta cualquier campo que se
  haya movido sin que se lo pidieran.

Después: borrar las variables de la sesión (`Remove-Item Env:\TABA_SMTP_*`).

## 6. DNS: SPF, DKIM, DMARC

No hay ningún dominio en la cuenta de Cloudflare (medido: **0 zonas**), así que
hoy no hay DNS que auditar. Cuando exista el dominio:

| registro | quién lo da | por qué |
|---|---|---|
| **SPF** (`TXT @`) | el proveedor | autoriza a sus servidores a mandar por el dominio. Un solo registro SPF por dominio: si ya hay uno, se le agrega el `include:`, no se agrega otro |
| **DKIM** (`TXT` o `CNAME`) | el proveedor | firma criptográfica. Resend y Brevo dan registros listos para pegar |
| **DMARC** (`TXT _dmarc`) | decisión propia | **empezar en `p=none` con `rua=`**, mirar los informes una o dos semanas, y recién después subir a `quarantine`. Poner `p=reject` de entrada sobre un dominio que quizá manda correo desde otro lado —una casilla del comercio, un formulario— rompe ese correo sin aviso |

Con dominio propio y estos tres registros verificados, recién ahí se puede
declarar el correo productivo entregable.

## 7. Pruebas que quedan pendientes de esta compuerta

Ninguna de estas se puede correr sin SMTP, y ninguna se dio por buena:

| prueba | qué certifica |
|---|---|
| entrega real de confirmación | que el correo llega, con el asunto y el cuerpo en castellano |
| el enlace de confirmación abre `/cuenta/` | que `{{ .SiteURL }}` y `{{ .TokenHash }}` renderizan bien |
| entrega real de recuperación | «Olvidé mi contraseña» de punta a punta con casilla real |
| enlace vencido / ya usado | que la pantalla ofrece pedir uno nuevo (probado con mocks, no con correo real) |
| destinatario inválido | qué contesta el proveedor y qué ve la persona |
| rate limit del proveedor | que 30/hora alcanza para una tarde de altas |
| enumeración en `/recover` | con una dirección real que rebote, medir si la respuesta sigue difiriendo según exista la cuenta |

Lo que **sí** está certificado sin correo está en `AUTH-SMOKE-REPORT.md`: alta,
pendiente, aprobación, roles, aislamiento, política de contraseñas y HIBP.
