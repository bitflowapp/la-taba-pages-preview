# Auth productivo · qué se cerró, qué no, y por qué

Proyecto `la-taba-production` (`wwcpogltfgzgkrlilbcd`). Todo lo de acá abajo está
**medido contra la base**, no leído de la documentación.

---

## Lo que se encontró

| | valor | veredicto |
|---|---|---|
| `site_url` | `http://localhost:3000` | **gate externo** — no hay dominio productivo |
| `uri_allow_list` | `""` | vacía = falla cerrado, ver §3 |
| `disable_signup` | `false` (signup abierto) | ver §2 |
| `external_anonymous_users_enabled` | **`false`** | **defecto: el Customer no podía autenticarse** |
| `password_min_length` | `6` | débil para cuentas de equipo |
| `security_update_password_require_reauthentication` | `false` | débil |
| `security_captcha_enabled` | `false` | gate externo (hace falta credencial de hCaptcha) |
| proveedores externos | sólo `email` | correcto: no hay OAuth inventado |

---

## 1 · El defecto que se arregló

`external_anonymous_users_enabled` estaba en **`false`**, y el Customer web
autentica con `signInAnonymously` (`js/services/supabase-auth.js:26`, y
`:152` distingue la sesión de cliente por `user.is_anonymous === true`).

Medido contra producción antes del cambio:

```
anonymous signin -> HTTP 422 anonymous_provider_disabled
```

O sea: **el camino del cliente estaba roto en producción y nadie lo sabía.** No
era una postura de seguridad, era una configuración que faltaba.

Después:

```
anonymous signin -> HTTP 200, usuario creado
```

El usuario sintético se borró. `auth.users` volvió a **0**.

---

## 2 · Por qué el signup público sigue abierto

Es la conclusión de una medición, no un olvido.

Se cerró `disable_signup = true` y se volvió a sondear:

```
anonymous signin -> HTTP 422 signup_disabled
email signup     -> HTTP 422 signup_disabled
```

**En GoTrue el ingreso anónimo pasa por el mismo `/signup` que el alta por
correo, y `disable_signup` los apaga a los dos.** No son independientes. Cerrar
el signup público apaga el Customer entero.

Se revirtió a `disable_signup = false` y se verificó que el anónimo vuelve a
funcionar.

### Por qué eso no deja un agujero

Una cuenta creada por cualquiera desde afuera **no puede hacer nada**. El acceso
no lo da la cuenta: lo da `identity_member_role()`, que exige tres cosas a la vez
(`20260814030000_identity_requires_registered_session.sql:42-52`):

1. una sesión registrada en `identity_sessions` y no revocada;
2. una fila en `business_members` con ese `business_id`;
3. un rol de la lista cerrada `owner | admin | staff | rider`.

Sin fila en `business_members` no hay rol, y sin rol las policies de las 85
tablas devuelven vacío. El Panel además cierra la sesión y niega el ingreso si el
rol no es del negocio (`js/production-operations.js:199-212`), y el Rider si no
es `rider`.

O sea: el costo real del signup abierto es **filas en `auth.users`**, acotado por
`rate_limit_email_sent = 2` y `rate_limit_anonymous_users = 30` por hora. No es
acceso.

### Cómo se cerraría de verdad

Sólo dejando de depender del ingreso anónimo en el Customer — un cambio de
producto, no de configuración. Queda anotado, no ejecutado: la misión pide no
abrir una fase nueva de producto.

---

## 3 · El dominio · GATE EXTERNO

`site_url = http://localhost:3000` y `uri_allow_list` vacía.

**No se inventa un dominio.** No existe hostname productivo en ningún lado del
repositorio: sin `CNAME`, sin `wrangler.toml` del sitio, sin `_redirects`, y el
único host desplegado que aparece es el de staging.

Lo que importa: **hoy eso falla cerrado, no falla mal.** Con la allow-list vacía
GoTrue rechaza cualquier `redirect_to` que no sea el `site_url`, así que no hay
redirección abierta. Lo único que apunta a `localhost` son los enlaces de correo
—confirmación y recuperación— y ninguno de los dos es alcanzable hoy: no hay
cuentas, y el alta del equipo se hace por admin.

El paso exacto para cerrarlo está en `../RUNBOOK-GO-LIVE.md` §2. Es un `PATCH` de
dos campos, y depende de una sola decisión humana.

---

## 4 · Lo que sí se endureció

| campo | de | a | por qué |
|---|---|---|---|
| `external_anonymous_users_enabled` | `false` | `true` | el Customer lo necesita; estaba roto |
| `password_min_length` | `6` | `12` | son cuentas de equipo con acceso operativo; seis caracteres es una contraseña de demo |
| `security_update_password_require_reauthentication` | `false` | `true` | una sesión robada no puede además quedarse con la cuenta |

Ya estaba bien y no se tocó: rotación de refresh token activada, ventana de
reutilización de 10 s, `jwt_exp` 3600, `mailer_autoconfirm` en `false`, teléfono
deshabilitado, y ningún proveedor OAuth.

CAPTCHA queda apagado: encenderlo exige una credencial de hCaptcha que no existe,
y la misión prohíbe inventarla.

---

## 5 · Estado final medido

```
site_url                                          http://localhost:3000     GATE EXTERNO
uri_allow_list                                    ""                        falla cerrado
disable_signup                                    false                     inocuo, ver §2
external_anonymous_users_enabled                  true                      ARREGLADO
external_email_enabled                            true                      lo usa el equipo
external_phone_enabled                            false
security_captcha_enabled                          false                     GATE EXTERNO
password_min_length                               12                        ENDURECIDO
security_update_password_require_reauthentication true                      ENDURECIDO
refresh_token_rotation_enabled                    true
jwt_exp                                           3600
auth.users                                        0
```

Las dos identidades sintéticas que se crearon para medir esto están borradas.
