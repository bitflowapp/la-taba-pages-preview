# Primer owner · estado

**Estado: EJECUTADO el 2026-08-17.**
Con identidad **explícitamente autorizada por Marco en la sesión**, no inferida.

---

## 1. Lo que quedó en producción

| | |
|---|---|
| comercio | `00000000-0000-4000-8000-000000000001` · «La Taba» |
| `user_id` | `308410cc-a0cb-401d-86f4-70ef6f33be30` |
| correo | `jariel1970@gmail.com` · **confirmado** |
| nombre | `Marco Luna` (en `staff_profiles.full_name`) |
| rol | **`owner`**, activo · 1 fila en `business_members` |
| estado de seguridad | 1 fila en `identity_user_security` |
| contraseña | **la elige la persona** desde el enlace de recuperación |
| sesiones | 0 — todavía no entró |
| auditoría | `member_activated` con `actor_role='system'` y `metadata.bootstrap=true` |
| `ordering_enabled` | **false**, sin cambios |

Verificado después: `equipo activo: 1 (owners 1)` y el aviso «el comercio no
tiene owner» desapareció del reporte de salud.

## 2. Cómo se autorizó

La misión llegó con `FIRST OWNER IDENTITY = HUMAN GATE` y así se cerró la
primera vuelta: no había ninguna identidad autorizada en la configuración ni en
la documentación, y **no se infirió** del autor de los commits, del dueño de la
cuenta de Supabase o Cloudflare, del usuario de Windows ni de un correo de QA.

Marco dio el correo de forma explícita. El **nombre** no venía con él y también
es un dato de identidad, así que se preguntó en vez de derivarlo de la cuenta de
Microsoft de la máquina.

## 3. Cómo se ejecutó

1. **Ensayo** (`sin --confirm`): guardia de destino `PASS (A, B, C, D, E)`,
   comercio correcto, `0 integrantes`. Salida 2, sin escribir nada.
2. **Confirmado** (`--confirm`): cuenta creada, membresía `owner`, estado de
   seguridad y perfil, y enlace para elegir contraseña.

Las dos credenciales —el token del CLI y la clave de servicio del proyecto— se
leyeron en el momento (Credential Manager y Management API), vivieron sólo en el
entorno del proceso hijo y **se borraron al terminar**. Ninguna se imprimió ni
se escribió a disco. Ver `SECRET-SCAN.md`.

## 4. Dos defectos que sólo se vieron al ejecutarlo de verdad

El evento de auditoría **falló en el primer intento**, y el guion siguió: la
cuenta se creó bien, el rastro no.

| intentaba escribir | por qué rebotó |
|---|---|
| `actor_role = 'service_role'` | el CHECK sólo acepta los roles del comercio y `'system'` |
| `event_type = 'business_owner_bootstrapped'` | `event_type` es una **lista cerrada** de 16 valores; no hay uno propio |

Corregido en el guion: `actor_role = 'system'` y `event_type = 'member_activated'`
—que es literalmente lo que un bootstrap hace: activar al primer integrante—,
con `metadata.bootstrap = true` para distinguirlo de una aprobación normal.

El evento del arranque real se escribió aparte, con la misma forma, y dice en su
metadata que se registró después. **No se creó ninguna migración**: la lista de
tipos alcanza y agregarle uno para esto sería tocar el esquema por comodidad.

## 5. Lo único que falta, y es de Marco

**Elegir la contraseña desde el enlace de recuperación**, que se entregó en la
sesión y **no viaja en ningún artefacto**: es un token de un solo uso, válido
una hora desde las `19:43 UTC` del 2026-08-17.

Si vence antes de usarlo hay dos salidas:

* con SMTP configurado: «Olvidé mi contraseña» en el Panel;
* sin SMTP: volver a emitir el enlace. El bootstrap **ya no vuelve a correr**
  sobre este comercio —se niega, por diseño—, así que se emite con la clave de
  servicio del proyecto y se arma la URL como
  `https://la-taba.pages.dev/cuenta/?token_hash=<hashed_token>&type=recovery`.

Después de elegir la contraseña: entrar al Panel en
`https://la-taba.pages.dev/#negocio`. Ahí se registra la sesión y aparece la
bandeja de solicitudes.

## 6. La herramienta, auditada

| control | estado |
|---|---|
| guardia de destino | **sí** — la misma que usa el push de migraciones |
| ref explícito | sin default; si falta, aborta |
| comercio | valida uuid, existencia y que esté activo |
| idempotencia | si esa persona ya es owner activo: no hace nada y sale 0 |
| **no repetible** | con cualquier integrante presente y distinto: aborta y explica que las altas siguientes van por invitación o solicitud |
| rol | `owner`, una sola fila |
| ensayo por defecto | sí |
| contraseña | nunca se pasa; se rechaza `TABA_OWNER_PASSWORD` |
| rollback | borra la cuenta recién creada si falla membresía, seguridad o perfil |
| auditoría | **sí**, corregida en esta ejecución |
| enlace útil | **sí**, corregido antes de ejecutar (ver §7) |

## 7. El enlace que antes no servía

Hasta esta misión el guion imprimía el `action_link` de Supabase, que apunta a
`/auth/v1/verify` y termina redirigiendo al sitio con la sesión escrita en el
**fragmento** de la URL. Esta aplicación **no lee sesiones de la URL**
(`detectSessionInUrl: false`, a propósito), así que ese enlace aterrizaba en la
home sin hacer nada y el primer dueño se quedaba sin poder entrar.

Ahora arma el mismo enlace que arma la plantilla del correo: la pantalla
`/cuenta/` con el `token_hash`, que se canjea por POST. Verificado que la URL
emitida resuelve (HTTP 200) **sin consumir el token**: la verificación la hace
el JavaScript de la página, así que pedir el HTML no gasta el enlace.

## 8. Lo que ese owner puede y no puede

**Puede:** entrar al Panel, ver la bandeja, aprobar y rechazar accesos de Panel y
de reparto, elegir el rol de cada uno, y operar el comercio.

**No puede:** salirse de su comercio, modificar RLS, usar la credencial de
servicio —no la tiene—, ni aprobarse una solicitud propia.
