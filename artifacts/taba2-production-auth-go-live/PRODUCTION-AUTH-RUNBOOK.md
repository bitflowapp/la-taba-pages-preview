# Runbook · Auth productivo de TABA

Todo lo de acá corre contra **`wwcpogltfgzgkrlilbcd`** (`la-taba-production`).
Staging es `ukxqbgswjlibmnjemrzd` y no se toca desde este runbook.

---

## 1. Configuración actual, medida

| | |
|---|---|
| host canónico | `https://la-taba.pages.dev` (Cloudflare Pages, proyecto `la-taba`, rama de producción `main`) |
| `site_url` | `https://la-taba.pages.dev` |
| allow-list de redirects | **vacía**, a propósito (ver §6) |
| alta | **abierta** — la anónima del Customer pasa por el mismo `/signup` |
| anónimos | habilitados |
| confirmación de correo | **exigida** (`mailer_autoconfirm=false`) |
| vencimiento de enlaces | 3600 s |
| contraseña | mínimo **12** · **rechaza filtradas (HIBP)** · reautenticación exigida |
| sesiones | rotación de refresh sí · JWT 3600 s · **sin caducidad por tiempo ni inactividad** |
| captcha | **no** — ver §7 |
| SMTP | **integrado** (2 correos/hora) — ver `SMTP-PRODUCTION-STATUS.md` |
| MFA TOTP | disponible, sin nadie inscripto |

Retrato completo: `AUTH-PRODUCTION-AFTER.json`. El de antes de esta misión:
`AUTH-PRODUCTION-BEFORE.json`.

## 2. Los nombres de las credenciales, y dónde viven

Ninguna credencial vive en el repositorio. Ninguna aparece en un artefacto.

| credencial | dónde está | para qué |
|---|---|---|
| token del CLI de Supabase | **Windows Credential Manager**, `LegacyGeneric:target=Supabase CLI:supabase` | Management API: leer y escribir configuración de Auth, correr las sondas |
| contraseña de la base | `%USERPROFILE%\.taba-secrets\taba2-production-supabase-db-password.dpapi` (DPAPI de usuario, ACL exclusiva) | `db push`, `migration list` |
| clave **publicable** | no es secreta: viaja en `runtime-config.js` del paquete publicado | los tres clientes |
| clave **secreta** / `service_role` | sólo en el panel de Supabase | el bootstrap del primer owner, y nada más |
| credencial de SMTP | **no existe todavía** | ver `SMTP-PRODUCTION-STATUS.md` |

**Regla de oro:** el token del CLI se lee del Credential Manager, se pone en el
entorno del proceso que lo necesita y se borra al terminar. Nunca se pega en un
informe, nunca se escribe a un archivo, nunca se pasa por línea de comandos.

## 3. Rotación

| qué | cómo | cuándo |
|---|---|---|
| token del CLI | `supabase login` (reemplaza el guardado en el Credential Manager) | si se sospecha exposición, o al cambiar de máquina |
| clave publicable | panel de Supabase → API keys → rotar; después **rearmar y republicar el paquete** (§5), porque viaja adentro | si se rota, el sitio viejo deja de hablar con la base |
| clave secreta | panel de Supabase → API keys → rotar | inmediatamente si alguna vez aparece fuera del panel |
| credencial de SMTP | rotar en el proveedor y volver a correr el comando de §4 con la nueva | ante cualquier duda: una credencial de SMTP filtrada se usa para mandar spam con tu dominio |

## 4. Cambiar la configuración de Auth

**No se toca el panel de Supabase a mano.** Todo cambio sale del repositorio,
con ensayo primero y relectura después:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token del CLI>"

# ensayo: dice qué cambiaría y no escribe nada
node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd --site-url https://la-taba.pages.dev --templates

# aplicar
$env:TABA2_PRODUCTION_AUTH_HARDENING = "I_AUTHORIZE_TABA2_PRODUCTION_AUTH_HARDENING"
node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd --site-url https://la-taba.pages.dev --templates --apply
```

El guion relee después de escribir y reporta **cualquier campo vigilado que se
haya movido sin que se lo pidieran**. Si reporta deriva, sale 1: no se ignora.

Los textos de los correos se editan en `supabase/templates/*.html` y se aplican
con `--templates`. El guion **se niega** a aplicar una plantilla que use
`{{ .ConfirmationURL }}`: ver `supabase/templates/README.md` para el porqué.

### Migrar a un dominio propio

1. Agregar el dominio en Cloudflare Pages → proyecto `la-taba` → Custom domains.
2. Esperar el certificado.
3. Correr el comando de arriba con `--site-url https://<dominio nuevo>`.
4. Volver a publicar el paquete (§5) — el `runtime-config` no cambia, pero
   conviene tener una publicación posterior al cambio.
5. Verificar con `npm run production:auth -- --ref ... --key-file <clave>`.

`la-taba.pages.dev` puede quedar como estaba: no es un preview, es un host
estable, y sirve de respaldo.

## 5. Publicar el sitio

```powershell
node scripts/create-release-folder.mjs
node scripts/build-production-runtime-config.mjs --key-file <archivo con la clave publicable> --out dist_release/runtime-config.js
node scripts/scan-production-artifacts.mjs dist_release --expect-host wwcpogltfgzgkrlilbcd.supabase.co --business-id 00000000-0000-4000-8000-000000000001
npx wrangler@4 pages deploy dist_release --project-name la-taba --branch main
```

El escaneo del paquete es obligatorio: mira **adentro del artefacto** y frena si
aparece una credencial de servidor, un host de staging o un negocio que no es el
canónico. El `runtime-config` productivo **no está versionado** a propósito: la
plantilla del repo falla cerrada para que ningún preview hable con producción.

## 6. Por qué la allow-list está vacía

Ningún flujo de TABA manda `redirect_to`:

* el Panel pide la recuperación **sin** `redirectTo`, y
* las plantillas apuntan a `{{ .SiteURL }}/cuenta/?token_hash=…`.

Con la allow-list vacía, GoTrue acepta el `site_url` y **nada remoto más**
(medido: staging, GitHub Pages y un dominio cualquiera caen todos al `site_url`).
Agregarle una entrada hoy sería abrir sin motivo.

La única excepción que GoTrue no deja apagar son las **IP de loopback literales**
(`http://127.0.0.1:*`, `http://[::1]:*`). Está medida y documentada en
`SECURITY-RECHECK.md`. Desde que el `site_url` dejó de ser local, `localhost`
por nombre **ya no entra**.

## 7. Captcha

Apagado. Se puede prender sin comprar nada: la cuenta de Cloudflare de esta
máquina tiene el permiso `challenge-widgets.write`, o sea que **Turnstile está
disponible** — el informe anterior lo daba por gate externo y no lo es.

Lo que sí falta es el trabajo de cliente: si se prende el captcha en GoTrue,
**todos** los `/signup`, `/token` y `/recover` tienen que mandar el token del
widget, incluido el ingreso anónimo del Customer. Prenderlo sin eso apaga la
tienda. Es un cambio de las tres aplicaciones, no un interruptor.

## 8. Emergencias

### «Hay un alta masiva de cuentas»

1. Mirar: `npm run production:auth:health -- --ref wwcpogltfgzgkrlilbcd --key-file <clave>`.
2. Si son **anónimas**: son visitas. Desde el arreglo de esta misión sólo se
   crean cuando alguien guarda algo, así que un pico es tráfico real o abuso.
   Se pueden borrar las que no tienen ni perfil ni dirección.
3. Si son **con correo**: bajar `rate_limit_email_sent` a 2 corta el alta en
   seco (sin correo no se confirma ninguna cuenta) sin tocar a la gente que ya
   entró.
4. El botón grande, si hace falta: `disable_signup = true`. **Ojo: apaga también
   al Customer**, porque el ingreso anónimo pasa por el mismo `/signup`.

### «Alguien entró a una cuenta del Panel»

1. Revocar sus sesiones: el Panel las lista y las cierra; en la base están en
   `identity_sessions`.
2. Bajarle la membresía: `is_active = false` en `business_members` (por el Panel,
   que deja evento de auditoría).
3. Cambiarle la contraseña: la persona usa «Olvidé mi contraseña».
4. Mirar `identity_audit_events` para ese `subject_user_id`.

**Dato que hay que tener en cuenta:** con la configuración actual, cualquier
sesión de menos de 24 horas puede cambiar la contraseña **sin** saber la
anterior (medido). O sea que un token de sesión robado alcanza para quedarse con
la cuenta: revocar la sesión es el primer paso, no el último.

### «Los correos no llegan»

1. `npm run production:auth:health` dice si hay SMTP propio y cuál es el techo.
2. Con el remitente integrado, el techo es 2/hora **para todo el proyecto**.
3. Con proveedor propio: mirar el panel del proveedor (rebotes, reputación) y
   `smtp_max_frequency` (60 s entre correos a la misma dirección).

### Rollback de un cambio de configuración

La configuración de Auth **no está en git**: es hosted. El rollback es volver a
aplicar el valor anterior, que está guardado en `AUTH-PRODUCTION-BEFORE.json` y
`AUTH-PRODUCTION-AFTER.json`. Los campos que esta misión cambió:

| campo | antes | ahora |
|---|---|---|
| `site_url` | `http://localhost:3000` | `https://la-taba.pages.dev` |
| `password_hibp_enabled` | `false` | `true` |
| 6 plantillas + 6 asuntos | defaults en inglés | los de `supabase/templates/` |

Ninguno de esos cambios puede dejar a nadie afuera: con `auth.users = 0` al
aplicarlos, HIBP sólo actúa al crear o cambiar una contraseña.

## 9. Sondas, todas de sólo lectura salvo la que dice lo contrario

| comando | qué contesta |
|---|---|
| `npm run production:health` | ledger, scheduler, datos, persiana |
| `npm run production:auth` | postura de Auth completa, por dos caminos |
| `npm run production:auth:health` | salud de identidad del día: altas, pendientes, picos |
| `npm run production:smoke` | qué ve una identidad anónima (nada) |
| `npm run production:smoke:identity` | el camino de sesión del Panel y del Rider |
| `npm run production:smoke:registration` | alta → pendiente → aprobación → rol |
| `npm run production:smoke:customer` | memoria del Cliente y su aislamiento |
| `npm run production:security` | RLS, definers, privilegios, datos |
| `npm run production:artifacts` | qué hay adentro del paquete publicado |
| `npm run production:auth:harden` | **escribe**: exige autorización explícita |

Todas piden `SUPABASE_ACCESS_TOKEN` en el entorno; las que hablan por el camino
público piden además la clave publicable con `--key-file`.
