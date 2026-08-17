# Primer owner · estado

**Estado: RESUELTO el 2026-08-17.** El comercio tiene dueño, y la cuenta la creó
Marco con su propia contraseña.

| | |
|---|---|
| `user_id` | `61f238ad-fc2b-446a-9f17-257f4622cd86` |
| email | `jariel1970@gmail.com` · **confirmado** |
| rol | **`owner`** activo en `00000000-0000-4000-8000-000000000001` («La Taba») |
| perfil | `Marco Luna` |
| contraseña | **la eligió él, en su terminal. Nadie más la conoce ni la vio** |
| enlaces de recuperación emitidos | **0** |
| auditoría | `member_activated` · `actor_role=system` · `metadata.bootstrap=true` |

Cómo se llegó: primero se hizo mal —una herramienta fabricó la identidad—, se
revirtió, y se rehizo con la persona escribiendo su contraseña. El detalle de
las dos vueltas está más abajo, porque lo que se aprendió en la primera es lo
que hizo bien a la segunda.

---

## 1. Qué pasó, en orden

1. Con autorización explícita de Marco en la sesión, se arrancó el primer owner
   con `jariel1970@gmail.com` / «Marco Luna». La herramienta creó la identidad
   sin contraseña y emitió un enlace de recuperación para que la persona
   eligiera la suya.
2. **Marco lo rechazó, y tenía razón:** no quiere conocer ni usar una
   contraseña que originó una herramienta, ni estrenar su cuenta con una
   identidad fabricada. Quiere crearla él, por la interfaz pública, eligiendo
   nombre, correo, contraseña y confirmando el correo.
3. Se revirtió esa identidad, y sólo esa.

Que la primera vuelta «funcionara» no la hacía correcta. El dueño de un comercio
es la persona con más razones para haber creado su cuenta con sus propias manos.

## 2. Qué se eliminó, exactamente

Vía **administrativa de Auth** —`DELETE /auth/v1/admin/users/{id}`—, que es la
única que tiene el tablero de Supabase y la única que tendría un pedido de baja
de datos personales. La migración 107 es la que hace que funcione con una
membresía presente.

| tabla | filas | cómo |
|---|---|---|
| `auth.users` | **1** (`308410cc-a0cb-401d-86f4-70ef6f33be30`, `jariel1970@gmail.com`) | borrado administrativo, HTTP 200 |
| `public.business_members` | **1** (rol `owner`) | cascada `on delete cascade` |
| `public.staff_profiles` | **1** («Marco Luna») | cascada |
| `public.identity_user_security` | **1** | cascada |
| `auth.identities` | **1** | cascada |
| `auth.one_time_tokens` | **1** | cascada — **es el enlace de recuperación emitido** |

Nada más. `identity_sessions`, `customers`, `customer_addresses`,
`business_access_requests`, `rider_profiles` y `orders` ya estaban en cero.

### Lo que NO se tocó

* **`identity_audit_events`: 72 antes, 72 después.** No tiene ninguna clave
  foránea hacia `auth.users` —verificado en `pg_constraint` antes de borrar—, así
  que el borrado no podía llevársela ni por accidente. El rastro del arranque
  (`member_activated` con `metadata.bootstrap=true`) sigue ahí, apuntando a un
  `subject_user_id` que ya no existe. Eso es exactamente lo que tiene que pasar
  con una auditoría append-only: la historia no se reescribe.
* Esquema, migraciones (**ledger 107**), staging, cualquier otro dato.
* `ordering_enabled`, que sigue en **false**.

### El enlace emitido quedó muerto, y está probado

No se dio por descartado: se canjeó contra el endpoint público real.

```
POST /auth/v1/verify {"type":"recovery","token_hash":"294ef…"}
→ 403 {"error_code":"otp_expired","msg":"Email link is invalid or has expired"}
```

## 3. La segunda vuelta: la cuenta la creó él

Sin SMTP no había forma de que Marco se registrara por la pantalla pública —el
alta necesita el correo de confirmación—, así que se hizo una **excepción
administrativa one-shot**: un guion que corre **en su terminal**, no en la
sesión de Claude.

La distinción no es formal. Las herramientas de Claude corren sin terminal
interactiva: un `Read-Host` ahí lee vacío. Que el guion lo corriera él es
exactamente lo que hace que su contraseña no haya pasado por ningún lugar que
Claude pueda leer.

Qué hace el guion, en orden:

1. preflight: `auth.users=0`, `business_members=0`, `pedidos=0`, comercio activo,
   `ordering=false`;
2. **prueba la credencial administrativa con una llamada de sólo lectura ANTES
   de pedir la contraseña**: si eso falla, no la pide;
3. pide la contraseña dos veces, oculta (`Read-Host -AsSecureString`);
4. la valida: 12 caracteres y **contra brechas conocidas**;
5. crea la identidad con `email_confirm=true`;
6. prueba el ingreso por el camino público y **cierra esa sesión**;
7. borra la contraseña de la memoria: el BSTR en cero, referencias sueltas, GC.

Si la creación fallaba, abortaba sin reintentar. La contraseña nunca se imprimió,
ni se escribió a disco, ni pasó por una variable de entorno o un argumento.

### Dos defectos que aparecieron ahí, y lo que enseñaron

**1. `Forbidden use of secret API key in browser`.** Las claves `sb_secret_*`
nuevas rechazan lo que parece un navegador, y PowerShell 5.1 se presenta como
`Mozilla/5.0 (compatible; MSIE 9.0; …)` si nadie le dice otra cosa. Aislado con
la misma credencial y el mismo endpoint de sólo lectura:

```
GET /auth/v1/admin/users?page=1&per_page=1
  sin User-Agent explícito  ->  HTTP 401
  con taba2-production-owner-bootstrap/1.0  ->  HTTP 200
```

La corrección fue **declarar quién llama**, no degradar la credencial. Los
guiones en Node nunca lo vieron porque no mandan ese User-Agent.

**2. La política de contraseñas no vive en el camino administrativo.** Medido con
tres identidades de QA creadas y borradas en el acto:

| contraseña en `POST /admin/users` | resultado |
|---|---|
| `Password123456` (filtrada, 14 caracteres) | **aceptada**, HTTP 200 |
| 8 caracteres | **aceptada**, HTTP 200 |

El camino público rechaza las dos con `422 weak_password`. O sea que una cuenta
creada por vía administrativa puede quedar **por debajo** de la política del
proyecto. Por eso el guion valida largo y brechas él mismo, con k-anonimato: el
SHA-1 se calcula en la máquina y sólo salen los 5 primeros caracteres del hash.

## 4. La promoción

Con la identidad ya existente y confirmada, se corrió la herramienta **sin**
`--create-identity`:

```
Identidad: ya existe (61f238ad-fc2b-446a-9f17-257f4622cd86) — se PROMUEVE
Listo.  rol: owner  ·  auditoría: member_activated (bootstrap)
```

**No tocó credenciales, y hay prueba:** `auth.users.updated_at` quedó en
`21:26:49.965`, el mismo instante en que el guion creó la cuenta y probó el
ingreso. La promoción corrió minutos después y no escribió una sola vez en
`auth.users`. Y `auth.one_time_tokens = 0`: no se emitió ningún enlace.

## 5. Estado de producción al cerrar

| | |
|---|---|
| `auth.users` | **1** — el owner, confirmado, no anónimo |
| `business_members` | **1** — `owner`, activo, comercio canónico |
| `staff_profiles` / `identity_user_security` | **1** / **1** |
| `business_access_requests` / `rider_profiles` | **0** / **0** |
| `customers` / `customer_addresses` / `orders` | **0** / **0** / **0** |
| `auth.sessions` | **0** — la sesión de prueba se cerró |
| `auth.one_time_tokens` | **0** — ningún enlace vivo |
| `identity_audit_events` | **73** (72 + el de la promoción) |
| `ordering_enabled` | **false** |
| ledger | **107** — sin migración nueva |

Panel productivo: `https://la-taba.pages.dev/` responde **200**, con
`mode: production`, host `wwcpogltfgzgkrlilbcd.supabase.co` y el comercio
canónico. La vista `#negocio` existe en el shell servido.

## 6. La herramienta, como quedó

`scripts/bootstrap-first-business-owner.mjs` **por defecto promueve**. Crear es
la excepción y hay que pedirla con `--create-identity`.

| control | comportamiento |
|---|---|
| identidad inexistente | **aborta** y explica que la cuenta la crea la persona |
| identidad sin correo confirmado | **aborta**: confirmar es la única prueba de que ese correo es suyo |
| `--create-identity` con la cuenta ya existente | **aborta**: no crea una segunda |
| credenciales al promover | **no se tocan**, y no emite ningún enlace |
| rollback al promover | deshace **sólo las filas que escribió**. Nunca borra la cuenta de alguien que se registró solo |
| rollback al crear | sí borra la cuenta recién creada |
| no repetible | si el comercio ya tiene equipo, se niega |
| ensayo por defecto | sí |

Un detalle chico y real: al promover, el guion seguía imprimiendo «la contraseña
la elige la persona desde el enlace» y «se emitió el enlace». Las dos cosas eran
falsas en ese modo. Corregido: ahora dice «la de esa persona, sin tocar. No se
emitió ningún enlace». Un informe que afirma algo que no pasó es peor que uno
que no dice nada.

## 7. Lo que sigue

El owner ya puede entrar a `https://la-taba.pages.dev/#negocio` con su correo y
su contraseña. La compuerta que queda es **SMTP**, y ahora es la del alta del
resto del equipo: sin correo, nadie más puede registrarse ni recuperar su
contraseña. Ver `SMTP-PRODUCTION-STATUS.md`.
