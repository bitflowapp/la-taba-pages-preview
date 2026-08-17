# TABA2 · Alta autogestionada · MÁQUINA DE ESTADOS

Una sola frase sostiene todo lo que sigue:

> **Registrarse crea una identidad. No crea un permiso.**

Entre «creé mi cuenta» y «puedo trabajar» hay siempre una decisión de otra
persona, y esa decisión vive en la base de datos, no en la pantalla.

---

## 1. Las dos rutas de alta, y por qué conviven

| | Invitación (empuje) | Solicitud (pedido) |
|---|---|---|
| Quién empieza | Owner o admin | La persona interesada |
| Contrato | `identity_create_invitation` → `identity_accept_invitation` | `request_business_access` → `identity_review_access_request` |
| Desde | Migración `20260812050000` | Migración `20260817010000` (esta misión) |
| Termina en | `business_members` | `business_members` |

Las dos desembocan en la misma tabla y ninguna deja que el interesado se otorgue
nada. La invitación sirve cuando el comercio ya sabe a quién quiere; la solicitud
sirve cuando no lo sabe todavía, que es el caso que faltaba.

---

## 2. El estado de una persona frente a un comercio

```
                        ┌──────────────────────────────────────┐
                        │  SIN IDENTIDAD                       │
                        │  no hay cuenta                       │
                        └───────────────┬──────────────────────┘
                                        │ signUp (GoTrue)
                                        ▼
                        ┌──────────────────────────────────────┐
                        │  IDENTIDAD, SIN SOLICITUD            │
   identity_member_role │  auth.users existe                   │
        devuelve NULL   │  business_members: 0 filas           │
                        └───────────────┬──────────────────────┘
                                        │ request_business_access(panel|rider)
                                        ▼
                        ┌──────────────────────────────────────┐
                        │  PENDING                             │
   identity_member_role │  business_access_requests.status =   │
        devuelve NULL   │  'pending'                           │
                        └────────┬────────────────────┬────────┘
       identity_review_          │                    │  identity_review_
       access_request            │                    │  access_request
       ('approve', rol)          │                    │  ('reject', motivo)
                                 ▼                    ▼
        ┌────────────────────────────────┐  ┌──────────────────────────────┐
        │  APPROVED                      │  │  REJECTED                    │
        │  business_members insertado    │  │  0 filas en business_members │
        │  identity_user_security        │  │  se puede volver a pedir     │
        │  staff_profiles/rider_profiles │  │  pasadas 24 h                │
        │  granted_role ∈ admin|staff|   │  └───────────┬──────────────────┘
        │  rider                         │              │ request_business_access
        └────────────────────────────────┘              │ (misma fila, +1 intento)
                    │                                   └───────────► PENDING
                    │ identity_register_session
                    ▼
        ┌────────────────────────────────┐
        │  OPERATIVO                     │
        │  identity_member_role devuelve │
        │  el rol; el contrato Rider o   │
        │  el Panel funcionan normal     │
        └────────────────────────────────┘
```

### Lo que NO existe, y por qué

* **`cancelled`.** No hay ninguna pantalla del producto donde alguien retire su
  solicitud. Un estado sin transición que lo produzca es un estado que sólo
  complica las consultas.
* **`revoked`.** Quitar el acceso ya es `identity_set_member_active(false)` sobre
  la membresía. Repetirlo en el papel de la solicitud crearía dos verdades sobre
  el mismo hecho.
* **Un estado `owner`.** `granted_role` no lo admite. La conducción de un
  comercio se transfiere con `identity_set_member_role` —que exige
  `identity.roles.write`— o se arranca con la herramienta de bootstrap.

---

## 3. Una fila por persona, para siempre

`business_access_requests` tiene `unique (business_id, user_id)`. No es un índice
parcial sobre `pending`: es un `unique` a secas.

Con un índice parcial, cada rechazo habilita una fila nueva y a los seis meses la
tabla es el historial de intentos de quien más insista. Acá la fila se **reusa**:
volver a pedir la devuelve a `pending` y suma `attempt_count`. El historial de
decisiones vive en `identity_audit_events`, que es append-only de verdad.

Consecuencias medidas (pruebas 7 a 9 y 41 a 43 de `registration_approval_test`):

* insistir sobre un pendiente devuelve el pendiente y **no** suma intento;
* volver a pedir antes de la espera devuelve `retry_later` con la fecha;
* pasada la espera, la misma fila vuelve a `pending` con `attempt_count + 1`;
* la tabla nunca crece por insistir.

---

## 4. Las cinco pantallas del Panel

`js/business/business-access-registration.js` es una función pura que elige entre
cinco pantallas según lo que contestó el backend:

| Estado del backend | Pantalla | Qué ofrece |
|---|---|---|
| — (sin sesión) | `sign_in` | ingresar, o crear cuenta |
| — (creando) | `sign_up` | email + contraseña; dice que no da acceso |
| `none` | `request` | nombre + teléfono; cerrar sesión |
| `pending` | `pending` | estado, actualizar, cerrar sesión |
| `rejected` | `rejected` | estado, volver a pedir si la espera venció, cerrar sesión |
| `unknown` | `sign_in` | fallar hacia el ingreso, nunca hacia el formulario |

Ese último renglón es una decisión, no un descuido: fallar hacia «pedí acceso»
mostraría un formulario a alguien que quizás ya es del equipo.

### La app Rider

Tres estados en vez de cinco (`lib/features/auth/presentation/`):

| Estado | Pantalla |
|---|---|
| sin sesión | `login_page` + `sign_up_page` |
| `pendingApproval` con `none` | `access_application_page` → formulario |
| `pendingApproval` con `pending`/`rejected` | `access_application_page` → estado |
| `signedIn` con rol `rider` | la app operativa de siempre |

El estado `pendingApproval` **nunca lleva rol**. Es deliberado: `hasRiderAccess`
mira el rol, así que ninguna pantalla operativa puede confundir una espera con
una sesión de trabajo.

---

## 5. Qué ve un pendiente, medido

| Superficie | Rider pendiente | Verificado en |
|---|---|---|
| `get_rider_delivery_board` | 403 | suite DB + smoke en vivo |
| `get_rider_queue` | 403 | suite DB + smoke en vivo |
| `publish_rider_location_fanout` | 403 | suite DB + smoke en vivo |
| `orders` (tabla) | 0 filas | suite DB |
| `rider_order_offers` (tabla) | sin grant | suite DB |
| `business_access_requests` (tabla) | 403 | suite DB + smoke en vivo |
| `business_members` (insert) | 403 | suite DB + smoke en vivo |
| `identity_list_access_requests` | 403 | suite DB + smoke en vivo |
| `identity_current_context` | `role: null` | suite DB + smoke en vivo |
| su propia solicitud | la ve | suite DB + smoke en vivo |
