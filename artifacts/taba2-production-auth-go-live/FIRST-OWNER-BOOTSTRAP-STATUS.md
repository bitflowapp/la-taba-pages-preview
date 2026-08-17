# Primer owner · estado

**Estado: LISTO. NO EJECUTADO.**
Falta un dato que sólo puede dar una persona: **quién es el dueño**.

---

## 1. Por qué no se ejecutó

`FIRST OWNER IDENTITY = HUMAN GATE`.

Se buscó una identidad autorizada en la configuración y en la documentación del
repositorio. **No existe.** Lo único que hay es el runbook anterior diciendo lo
mismo: «falta el correo del dueño real».

No se infirió de ninguna de estas, y no se va a inferir:

* el autor de los commits,
* el dueño de la cuenta de Supabase o de Cloudflare,
* el usuario de Windows de esta máquina,
* el correo de una prueba anterior.

Dar `owner` es dar la llave del comercio: quien la tiene aprueba a todos los
demás, ve todos los pedidos y opera la caja. No se le inventa un dueño a un
negocio.

## 2. Estado de producción, medido hoy

| | |
|---|---|
| `auth.users` | **0** |
| `business_members` | **0** |
| owners activos | **0** |
| comercio canónico | `00000000-0000-4000-8000-000000000001` · «La Taba» · activo |

Es exactamente el estado que el bootstrap necesita: un comercio sin equipo.

## 3. La herramienta

`scripts/bootstrap-first-business-owner.mjs`. Auditada en esta misión:

| control | estado |
|---|---|
| guardia de destino | **sí** — reutiliza `assert-production-supabase-target.mjs`, el mismo que usa el push de migraciones |
| ref explícito | **sí** — sin default; si falta, aborta |
| comercio | valida formato uuid, que exista y que esté activo |
| identidad | busca por correo antes de crear |
| idempotencia | si esa persona **ya** es owner activo: no hace nada y sale 0 |
| no repetible | si el comercio ya tiene **cualquier** integrante y no es esa persona: aborta y explica que las altas siguientes van por invitación o por solicitud |
| rol | `owner`, una sola fila |
| ensayo por defecto | **sí** — sin `--confirm` no escribe nada |
| contraseña | **no se pasa nunca**: se rechaza `TABA_OWNER_PASSWORD` por entorno, y la persona elige la suya desde un enlace |
| rollback | si falla la membresía, el estado de seguridad o el perfil, **borra la cuenta recién creada** para no dejar una identidad huérfana |
| auditoría | **agregado en esta misión** — ver §4 |
| enlace útil | **corregido en esta misión** — ver §4 |

## 4. Dos cosas que esta misión le arregló

**1. El enlace que emitía no servía.**
Usaba el `action_link` que devuelve Supabase, que apunta a `/auth/v1/verify` y
termina redirigiendo al sitio con la sesión escrita en el fragmento de la URL.
Esta aplicación **no lee sesiones de la URL** (`detectSessionInUrl: false`, a
propósito), así que ese enlace aterrizaba en la home sin hacer nada, y el primer
dueño se quedaba sin poder elegir su contraseña.

Ahora arma el mismo enlace que arma la plantilla del correo:
`https://la-taba.pages.dev/cuenta/?token_hash=…&type=recovery`, que la pantalla
canjea por POST.

**2. No dejaba rastro.**
Es la única alta de identidad de toda la vida del comercio que no pasa por una
RPC —usa la credencial de servicio—, así que era también la única que no
quedaba registrada. Ahora escribe un evento `business_owner_bootstrapped` con el
comercio, la persona y la herramienta. Verificado que la credencial de servicio
puede ejecutar `identity_record_audit_event` en producción.

## 5. Qué hace falta para ejecutarlo

Tres datos y una credencial:

| dato | quién lo da |
|---|---|
| `TABA_OWNER_EMAIL` | **Marco**: el correo real del dueño |
| `TABA_OWNER_NAME` | **Marco**: nombre y apellido |
| `SUPABASE_SERVICE_ROLE_KEY` | del panel de Supabase, proyecto `la-taba-production` |
| host canónico | ya está: `https://la-taba.pages.dev` |

```powershell
$env:SUPABASE_URL             = "https://wwcpogltfgzgkrlilbcd.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<clave de servicio>"
$env:TABA_OWNER_EMAIL         = "<correo del dueño>"
$env:TABA_OWNER_NAME          = "<Nombre Apellido>"

# 1. Ensayo. No escribe nada. Sale 2 y dice qué haría.
node scripts/bootstrap-first-business-owner.mjs `
  --ref wwcpogltfgzgkrlilbcd `
  --business 00000000-0000-4000-8000-000000000001 `
  --site-url https://la-taba.pages.dev

# 2. De verdad.
node scripts/bootstrap-first-business-owner.mjs `
  --ref wwcpogltfgzgkrlilbcd `
  --business 00000000-0000-4000-8000-000000000001 `
  --site-url https://la-taba.pages.dev `
  --confirm
```

Al terminar imprime el `user_id`, el rol y **un enlace para que esa persona
elija su contraseña**. El enlace vence en una hora y se entrega por un canal
seguro (en persona, o por un mensaje directo). Después: borrar las variables de
la sesión.

**Sin SMTP, ese enlace es la única forma de que el primer dueño entre.** Con
SMTP, la alternativa es que use «Olvidé mi contraseña» en el Panel.

## 6. Verificación posterior

```powershell
node scripts/production-auth-health.mjs --ref wwcpogltfgzgkrlilbcd --key-file <clave publicable>
```

Tiene que decir `equipo activo: 1 (owners 1)`. Y el aviso «el comercio no tiene
owner» tiene que desaparecer.

## 7. Lo que ese owner puede y no puede

**Puede:** entrar al Panel, ver la bandeja de solicitudes, aprobar y rechazar
accesos de Panel y de reparto, elegir el rol de cada uno, y operar el comercio
dentro de su ámbito.

**No puede:** salirse de su comercio (las policies filtran por `business_id`),
modificar RLS, usar la credencial de servicio —no la tiene: vive fuera de todo
cliente—, ni aprobarse una solicitud propia.
