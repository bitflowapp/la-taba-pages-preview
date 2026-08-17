# Primer owner · estado

**Estado: SIN OWNER. Ejecutado y REVERTIDO el 2026-08-17, a pedido de Marco.**

La herramienta quedó cambiada: ahora **promueve** una identidad que ya existe en
vez de crearla. El primer dueño va a crear su propia cuenta desde la pantalla
pública, con su contraseña.

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

## 3. Estado de producción al cerrar

| | |
|---|---|
| `auth.users` | **0** (humanos 0 · anónimos 0) |
| `business_members` | **0** |
| `business_access_requests` | **0** |
| `staff_profiles` / `rider_profiles` | **0** / **0** |
| `identity_user_security` / `identity_sessions` | **0** / **0** |
| `customers` / `customer_addresses` | **0** / **0** |
| `orders` | **0** |
| `auth.sessions` / `auth.identities` / `auth.one_time_tokens` | **0** / **0** / **0** |
| `identity_audit_events` | **72** — intacta, a propósito |
| `ordering_enabled` | **false** |
| ledger | **107** — sin migración nueva |

## 4. El flujo acordado, de acá en adelante

1. **Configurar SMTP.** Sin correo no hay confirmación, y sin confirmación el
   alta pública no termina. Es la única compuerta que queda:
   `SMTP-PRODUCTION-STATUS.md`.
2. Marco entra a `https://la-taba.pages.dev/#negocio`.
3. Crea su cuenta: **su** nombre, **su** correo, **su** contraseña.
4. Confirma el correo desde el enlace que le llega.
5. Recién entonces se promueve **esa identidad ya existente** a primer owner,
   sin tocar su contraseña ni ninguna credencial.

## 5. La herramienta, cambiada para ese flujo

`scripts/bootstrap-first-business-owner.mjs` **por defecto promueve**. Crear es
la excepción y hay que pedirla con `--create-identity`.

| control | comportamiento |
|---|---|
| identidad inexistente | **aborta** y explica que la cuenta la crea la persona |
| identidad sin correo confirmado | **aborta**: confirmar es la única prueba de que ese correo es suyo |
| `--create-identity` con la cuenta ya existente | **aborta**: no crea una segunda |
| credenciales al promover | **no se tocan**. No emite ningún enlace de recuperación: esa persona ya tiene su contraseña |
| rollback al promover | deshace **sólo las filas que escribió**. Nunca borra la cuenta de alguien que se registró solo |
| rollback al crear | sí borra la cuenta recién creada, que es suya y de nadie más |
| ensayo por defecto | sí, sigue |

Verificado en seco contra producción después de la reversión: aborta con
«No existe ninguna cuenta con jariel1970@gmail.com», sin escribir nada.

El resto de los controles auditados antes siguen igual: guardia de destino
reutilizada, ref explícito sin default, comercio validado, no repetible si el
comercio ya tiene equipo, y evento de auditoría (`member_activated` con
`metadata.bootstrap=true`, después de que dos CHECK rebotaran el intento
original).

## 6. Lo que hace falta cuando llegue el momento

| dato | quién |
|---|---|
| cuenta creada y **correo confirmado** | Marco, por la pantalla pública |
| `TABA_OWNER_EMAIL` / `TABA_OWNER_NAME` | los mismos con los que se registró |
| `SUPABASE_SERVICE_ROLE_KEY` | del panel de Supabase |

```powershell
# 1. Ensayo. No escribe nada.
node scripts/bootstrap-first-business-owner.mjs `
  --ref wwcpogltfgzgkrlilbcd `
  --business 00000000-0000-4000-8000-000000000001

# 2. De verdad.
node scripts/bootstrap-first-business-owner.mjs `
  --ref wwcpogltfgzgkrlilbcd `
  --business 00000000-0000-4000-8000-000000000001 `
  --confirm
```
