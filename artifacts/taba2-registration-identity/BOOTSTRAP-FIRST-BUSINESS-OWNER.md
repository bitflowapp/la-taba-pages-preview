# RUNBOOK · Alta del primer dueño de un comercio

**Estado: LISTO. No ejecutado.**
Falta un dato que sólo puede dar una persona: el correo del dueño real.

---

## 1. El problema que resuelve

La autoridad de TABA vive en `public.business_members`. Todas las altas la
exigen: `identity_create_invitation` pide `identity.invite`, y
`identity_review_access_request` pide `identity.members.write`. En un proyecto
nuevo **no hay nadie que las tenga**.

Producción está exactamente en ese estado: `auth_users = 0`,
`business_members = 0`, con un comercio canónico esperando.

Alguien tiene que ser el primero, y esa es la única alta de toda la vida del
comercio que no puede pasar por las reglas normales.

## 2. Lo que este procedimiento NO es

* **No** es «el primero que se registra queda de dueño». Esa regla convierte una
  carrera en una toma de control, y no se puede deshacer.
* **No** es una RPC. No hay ninguna función en la base que otorgue `owner` sin un
  `owner` previo, y no va a haberla: la excepción vive afuera, con credencial
  administrativa, fuera del alcance de cualquier cliente.
* **No** se puede repetir. Si el comercio ya tiene gente, el script se niega. Un
  bootstrap repetible es una puerta trasera.
* **No** pasa por el cliente. Ni la web ni la app Rider ven jamás una
  `service_role`.

## 3. Requisitos

| | |
|---|---|
| Herramienta | `scripts/bootstrap-first-business-owner.mjs` |
| Destino | `wwcpogltfgzgkrlilbcd` (`la-taba-production`) |
| Comercio | `00000000-0000-4000-8000-000000000001` — verificado contra la base |
| Credencial | `SUPABASE_SERVICE_ROLE_KEY` del proyecto productivo |
| **Dato humano que falta** | `TABA_OWNER_EMAIL` y `TABA_OWNER_NAME` del dueño real |

`FIRST OWNER IDENTITY = HUMAN GATE`. No se inventa una persona.

## 4. El procedimiento

### 4.1 Ensayo (no escribe nada)

```bash
cd <worktree del backend>

SUPABASE_URL=https://wwcpogltfgzgkrlilbcd.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<clave de servicio> \
TABA_OWNER_EMAIL=<correo del dueño> \
TABA_OWNER_NAME="<Nombre Apellido>" \
node scripts/bootstrap-first-business-owner.mjs \
  --ref wwcpogltfgzgkrlilbcd \
  --business 00000000-0000-4000-8000-000000000001
```

Sin `--confirm` **no escribe nada**. Ése es el modo por defecto, a propósito.
Salida esperada:

```
--- TARGET GUARD ---
  TARGET NAME     : la-taba-production
  TARGET REF      : wwcpogltfgzgkrlilbcd
  RESULTADO       : PASS (A, B, C, D, E)

--- BOOTSTRAP PRIMER OWNER ---
  Comercio : La Taba (00000000-0000-4000-8000-000000000001)
  Dueño    : <Nombre Apellido> <correo>
  Equipo   : 0 integrantes (correcto para un bootstrap)

ENSAYO. No se escribió nada.
```

Si el guard no pasa, o si el equipo no está vacío, se detiene ahí.

### 4.2 Alta real

El mismo comando con `--confirm` al final. Hace, en orden:

1. crea la cuenta en Auth con el correo ya confirmado y **sin contraseña**;
2. inserta `business_members(role='owner', is_active=true)` con la credencial de
   servicio, que es la única vía habilitada fuera de las RPC de identidad;
3. inserta `identity_user_security`, para que después se le pueda dar de baja;
4. inserta `staff_profiles` con su nombre;
5. emite un enlace de recuperación para que **la persona elija su contraseña**.

Si algo falla después del paso 1, la cuenta recién creada se borra: no queda una
identidad huérfana a medio dar de alta.

### 4.3 La contraseña

No se pasa nunca por variable de entorno. El script se niega si detecta
`TABA_OWNER_PASSWORD`, con este motivo: una contraseña en el entorno queda en el
historial de la consola.

El enlace de recuperación se imprime una sola vez y vence. Se entrega por un
canal seguro.

### 4.4 Verificación

```bash
supabase db query --linked -f scripts/registration-security-portrait.sql
```

Esperado: `registration.counts.business_members = 1`,
`staff_profiles = 1`, `identity_audit_events` con un evento nuevo.

Y desde el Panel: entrar con ese correo debe abrir la operación, y
`Solicitudes de acceso` debe estar disponible (permiso `team.manage`).

## 5. De acá en adelante

El bootstrap no vuelve a correr sobre ese comercio. Las altas siguientes salen
del Panel, por una de las dos vías:

* **invitación** — el owner emite un token para un correo y un rol;
* **solicitud** — la persona pide entrar y el owner o un admin decide.

Las dos quedan auditadas en `identity_audit_events`.

## 6. Dependencia de SMTP

El enlace de recuperación se emite con la credencial de servicio, así que el
bootstrap **no** depende de SMTP: se puede entregar a mano.

Lo que sí depende de SMTP es lo que viene después:

* que un candidato pueda **crear su cuenta** desde el Panel o la app (hoy
  producción tiene `mailer_autoconfirm = false` y el emisor compartido de Supabase
  se agota: `over_email_send_rate_limit`);
* que cualquiera pueda usar «olvidé mi contraseña» en operación.

Ver el P0 de SMTP en el informe final. El bootstrap del primer owner **no está
bloqueado por eso**.
