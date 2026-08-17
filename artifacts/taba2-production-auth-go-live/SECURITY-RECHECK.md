# Revisión de seguridad después de tocar el Auth hosted

Medido el 2026-08-17 contra `wwcpogltfgzgkrlilbcd`, después de aplicar
`site_url`, las seis plantillas y HIBP.

---

## 1. La base no se movió

| control | antes de la misión | ahora |
|---|---|---|
| ledger | 107 | **107** — sin migración 108 |
| tablas | 86 | 86 |
| **tablas sin RLS** | 0 | **0** |
| tablas con RLS y sin policy (sólo por RPC) | 30 | 30 |
| SECURITY DEFINER | 224 | 224 |
| definers **sin `search_path` fijado** | 0 | **0** |
| definers ejecutables por `anon` | 8 | 8 |
| **`anon` con escritura** | 0 | **0** |
| grants a `PUBLIC` | 0 | 0 |
| `CREATE` en el schema `public` | ninguno | ninguno |
| buckets de storage | 1 (`fiscal-documents`, privado) | igual |
| `ordering_enabled` | false | **false** |

Datos en producción al cerrar: `businesses 1`, `identity_permissions 20`,
`identity_role_permissions 44`, `identity_audit_events 71`,
`operational_sweep_runs` (telemetría del cron). **`auth.users = 0`.**

Herramienta: `npm run production:security` · retrato completo en
`artifacts/production-supabase/SECURITY-PORTRAIT-production.json`.

## 2. Lo que ve una identidad anónima: nada

`npm run production:smoke` → **TODO CERRADO**.

* 16 tablas cerradas probadas, 0 devolvieron filas.
* rol de negocio: ninguno.
* auto-membresía: HTTP 403.
* insert en `orders`: HTTP 400.
* limpieza: `auth.users = 0`.

## 3. La allow-list de redirects, medida por el camino real

Con `site_url = https://la-taba.pages.dev` y la allow-list **vacía**:

```
PERMITE  https://la-taba.pages.dev              (es el site_url)
PERMITE  http://127.0.0.1:9999/                 <- exención de GoTrue
PERMITE  http://[::1]:9999/                     <- exención de GoTrue
rechaza  http://localhost:9999/otro-puerto      <- ANTES permitía
rechaza  http://sub.localhost:9999/
rechaza  http://localhost.example-que-nadie-autorizo/
rechaza  https://taba2-staging.pages.dev/
rechaza  https://bitflowapp.github.io/la-taba-pages-preview/
rechaza  https://redirect-que-nadie-autorizo.example/
```

Todo lo rechazado cae al `site_url`: **falla cerrada**.

### La exención de loopback quedó más chica

El informe anterior decía que GoTrue exime «localhost / 127.0.0.1 / [::1]». Al
mover el `site_url` a un host productivo se vio que no es así:

| `site_url` | `localhost:9999` | `127.0.0.1:9999` |
|---|---|---|
| `http://localhost:3000` | PERMITIDO | PERMITIDO |
| `https://la-taba.pages.dev` | **RECHAZADO** | PERMITIDO |

O sea que `localhost` entraba por **parecerse al host del `site_url`**, no por
ser loopback. Lo que GoTrue exime siempre son las **IP de loopback literales**
sobre http, en cualquier puerto y cualquier ruta.

**Clasificación: P2.** Para aprovecharlo hacen falta tres cosas a la vez: una
cuenta del Panel o del Rider, que esa persona abra un enlace preparado, y un
proceso escuchando en su propia máquina que además sirva HTML (el token viaja en
el fragmento, así que un listener a secas no lo ve). Y hay una mitigación
estructural nueva: **ningún correo de TABA manda `redirect_to`** —las plantillas
apuntan al `site_url` con `token_hash`—, así que ningún flujo real de TABA pasa
por ese camino.

No se intentó «arreglar» con un hack: es comportamiento del servidor y no se
apaga desde la configuración.

## 4. Enumeración de cuentas

| superficie | resultado |
|---|---|
| ingreso con contraseña mala vs correo inexistente | **idénticos** (400 `invalid_credentials`) |
| alta con un correo ya registrado | 200 sin cuerpo: no confirma ni desmiente |
| alta en el Panel (copy del cliente) | «Si ya tenés una cuenta con ese correo, iniciá sesión» — sirve igual en los dos casos |
| recuperación desde el Panel (copy del cliente) | «Si ese correo tiene una cuenta, te mandamos un enlace» — la misma frase exista o no |
| **`/auth/v1/recover` (servidor)** | **difiere**: existente 429, inexistente 200 |

**P2 · oráculo de enumeración en `/auth/v1/recover`.** Para una cuenta que no
existe GoTrue contesta **antes** de intentar el envío; para una que existe
intenta mandar y ahí falla, y el error se ve. Hoy se dispara con el límite del
remitente integrado. **Con SMTP propio hay que volver a medirlo con una
dirección real que rebote**: si el patrón se mantiene (existe → 5xx, no existe →
200), es enumeración por diferencia de tiempo y de código.

Ninguna copia de las pantallas revela nunca si un correo pertenece a un Rider,
a un administrador o a nadie.

## 5. Escalada de privilegios: 0

Probado contra la base viva (`AUTH-SMOKE-REPORT.md`):

* tener cuenta no otorga rol;
* nadie se aprueba a sí mismo (ni un owner con su propia solicitud);
* nadie se escribe una membresía por tabla (HTTP 403);
* el rol lo decide quien aprueba, no quien pide;
* un `staff` aprobado no puede promoverse a `owner`;
* un Rider pendiente no ve ninguna oferta ni ningún perfil;
* una identidad anónima no puede ni pedir acceso de equipo.

## 6. Cambio de contraseña sin la anterior

**P2 · medido.** `security_update_password_require_reauthentication = true`
suena a «pide la contraseña anterior». No la pide: GoTrue exime a toda sesión de
menos de 24 horas, y también a las que vienen de un enlace de recuperación —esa
segunda exención es la que hace que «Olvidé mi contraseña» pueda funcionar—.
Además `security_update_password_require_current_password = false`.

Consecuencia: **un token de sesión robado alcanza para quedarse con la cuenta.**
Es el contrato de GoTrue, no un defecto de TABA, y no se puede separar de lo
que hace falta para la recuperación. Mitigaciones disponibles, en orden de costo:

1. revocar sesiones desde el Panel ante cualquier sospecha (ya existe);
2. activar la notificación `mailer_notifications_password_changed_enabled`
   cuando haya SMTP: le avisa a la persona que le cambiaron la contraseña;
3. MFA TOTP, que ya está disponible en el proyecto y sin nadie inscripto.

## 7. Sesiones sin caducidad

**P2 · sin cambio, y es una decisión de producto.** `sessions_timebox = 0` y
`sessions_inactivity_timeout = 0`. Son ajustes **del proyecto entero**: Supabase
no permite una política para el Panel y otra para el Customer. Ponerle
caducidad al Panel se la pone también al Customer anónimo, y ahí caduca la
memoria del cliente, que es justo lo que no se quiere.

Separarlas requeriría un sistema propio de expiración sobre `identity_sessions`.
No se improvisó. Queda como decisión humana.

## 8. Captcha

**Apagado.** Corrección de un informe anterior: **no es una compuerta externa**.
La cuenta de Cloudflare de esta máquina tiene el permiso
`challenge-widgets.write`, así que un widget de Turnstile se crea sin comprar
nada ni dar de alta ninguna cuenta.

Lo que falta es trabajo de cliente: prendido en GoTrue, **todos** los `/signup`,
`/token` y `/recover` tienen que mandar el token del widget, incluido el ingreso
anónimo del Customer. Prenderlo sin eso apaga la tienda.

**P1 antes de abrir pedidos**, no antes de esto: hoy la persiana está cerrada.

## 9. Claves de servidor en los clientes: 0

`npm run production:artifacts` sobre `dist_release` (363 archivos, 8,7 MB):

* **1 solo host**: `wwcpogltfgzgkrlilbcd.supabase.co`;
* **1 solo negocio**: `00000000-0000-4000-8000-000000000001`;
* ninguna credencial de servidor;
* las 3 coincidencias informativas son comentarios y una dependencia de terceros.

`npm run check` incluye `scan-secrets.mjs`: **sin credenciales de pago ni claves
privadas** en el árbol.

## 10. Lo que esta misión agregó al modelo de amenaza

**Identidades anónimas por visita.** Publicar el sitio con ingreso anónimo
significaba que **cada visita creaba una fila permanente en `auth.users`**, antes
de que la persona tocara nada. Se vio en producción a los minutos de publicar.
Arreglado: la identidad se crea cuando la persona guarda algo. Lo que queda es
el techo de `rate_limit_anonymous_users = 30/hora/IP` y, para el día que se
abran los pedidos, el captcha.

---

## Resumen

| | |
|---|---|
| P0 | **ninguno** |
| P1 | captcha antes de abrir pedidos públicos |
| P2 | loopback por IP · enumeración en `/recover` · contraseña sin la anterior · sesiones sin caducidad · marca inconsistente (TABA2 vs La Taba) |
| ordering | **cerrado**, antes y después |
| staging | **0 mutaciones** |
