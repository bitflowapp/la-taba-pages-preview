# Alta y aprobación contra producción · informe

**34 de 34 pasos.** Corrido el 2026-08-17 contra `wwcpogltfgzgkrlilbcd`, con la
base productiva viva. Datos crudos: `AUTH-SMOKE-REPORT.json`.
Herramienta: `npm run production:smoke:registration`.

---

## Lo que se midió

### Business · alta

| paso | resultado |
|---|---|
| entra con contraseña | HTTP 200 |
| el JWT dice `authenticated` y no dice anónimo | ✓ |
| **tener cuenta NO otorga rol** | `role = null` |
| la solicitud se registra | `code = pending` |
| la persona ve su solicitud pendiente y no es miembro | `status=pending`, `is_member=false` |

### Business · pendiente no es acceso

| paso | resultado |
|---|---|
| no puede registrar sesión operativa | `ok=false` |
| no lee ninguna de las 6 tablas cerradas | 0 filas |
| no puede darse un rol a sí misma | HTTP 403 |
| no puede aprobar su propia solicitud | `42501` (privilegio insuficiente) |

### Política de contraseñas, desde una sesión viva

| paso | resultado |
|---|---|
| contraseña filtrada (HIBP) | **rechazada** · 422 `weak_password` |
| contraseña más corta que 12 | **rechazada** · 422 `weak_password` |
| contraseña válida | aceptada · 200 |
| la anterior deja de servir | 400 |
| la nueva sirve | 200 |

### Business · aprobación

| paso | resultado |
|---|---|
| el owner entra y **registra su sesión** | `code=registered` |
| la solicitud aparece en su bandeja | HTTP 200, con el id |
| aprueba en un solo acto | `code=approved` |
| la persona aprobada registra su sesión del Panel | `code=registered` |
| **obtiene el rol que decidió el owner** | `role="staff"` |
| un staff aprobado no puede promoverse a owner | `42501` |

> **La trampa, para el próximo:** la compuerta de permisos sólo reconoce
> sesiones **registradas**. Preguntar por `identity_current_context` antes de
> `identity_register_session` devuelve `role=null` aunque la membresía ya
> exista. El cliente real lo hace en el orden correcto; una sonda que lo haga al
> revés reporta un defecto que no existe. Costó tres corridas.

### Rider

| paso | resultado |
|---|---|
| entra y pide acceso de reparto | `code=pending` |
| **pendiente no ve ninguna oferta** | HTTP 403 |
| ni ningún perfil de repartidor | 0 filas |
| el owner lo aprueba como `rider` | `code=approved` |
| registra sesión y obtiene su rol | `role="rider"` |

### Rechazo

| paso | resultado |
|---|---|
| el owner rechaza | `code=rejected` |
| la persona ve su estado, no un error | `status=rejected` |
| y sigue sin rol | `role=null` |

### No revelar de más

| paso | resultado |
|---|---|
| contraseña mala vs correo inexistente | **idénticos**: 400 `invalid_credentials` |
| alta con un correo que ya existe | 200 sin cuerpo — GoTrue no confirma ni desmiente |

---

## Lo que NO se pudo medir, y por qué

**El paso del enlace del correo.** Sin SMTP propio, GoTrue genera el token de
confirmación, intenta mandar el correo, el envío falla y la transacción se
revierte: el token nunca llega a existir.

Medido en esta corrida:

| llamada | respuesta |
|---|---|
| `POST /auth/v1/signup` | **429** `over_email_send_rate_limit` |
| `POST /auth/v1/recover` (cuenta existente) | **429** `over_email_send_rate_limit` |
| `POST /auth/v1/recover` (cuenta inexistente) | **200** |

Las dos primeras agotaron la cuota del remitente integrado: **2 correos por
hora para todo el proyecto**.

Las identidades de prueba se crearon por SQL, ya confirmadas —el mismo patrón
que ya usaba la sonda de sesión—, con contraseña bcrypt por `extensions.crypt`,
que es el formato que escribe GoTrue: el login funciona por el camino real.

**Lo que deliberadamente no se hizo:** escribir a mano un token de confirmación
o de recuperación en `auth.users` para poder canjearlo. Es técnicamente posible
—GoTrue guarda `sha224(correo || código)` y Postgres lo calcula— pero un guion
que fabrica enlaces de recuperación para una cuenta ajena es exactamente la
herramienta con la que se roba una cuenta, y no entra a este repositorio. El
tramo se certifica el día que haya SMTP, con una casilla real, en tres minutos.

---

## Hallazgos de seguridad (no son fallas del contrato de alta)

1. **Cambiar la contraseña no pide la anterior.** Con
   `security_update_password_require_reauthentication = true`, GoTrue igual
   exime a **toda sesión de menos de 24 horas** (y a las que vienen de un enlace
   de recuperación — esa segunda exención es la que hace posible recuperar la
   contraseña). Medido: `PUT /auth/v1/user` con una sesión recién creada devolvió
   200 y la contraseña vieja dejó de servir. Significa que **un token de sesión
   robado alcanza para quedarse con la cuenta**.

2. **`/auth/v1/recover` distingue si la cuenta existe** cuando la dirección no
   es enviable: existente 429, inexistente 200. Para una cuenta que no existe
   GoTrue contesta antes de intentar el envío; para una que existe intenta y
   falla. Con SMTP propio hay que volver a medirlo con una dirección real que
   rebote.

Los dos están en `SECURITY-RECHECK.md` con su clasificación.

---

## Limpieza

```
propias 0 · usuarios 0 · miembros 0 · solicitudes 0 · staff 0 · riders 0 ·
sesiones 0 · clientes 0
```

`identity_audit_events = 71`. Los eventos de la corrida **quedan a propósito**:
la auditoría es append-only por contrato y borrarla sería peor que dejarla. Son
identificables por su metadata y por sus nombres (`Panel QA SMOKE`,
`Rider QA SMOKE`, `Rechazo QA SMOKE`).

`ordering_enabled = false`, antes y después.
