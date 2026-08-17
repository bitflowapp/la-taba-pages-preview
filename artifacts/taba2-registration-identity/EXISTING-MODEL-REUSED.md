# TABA2 · FASE 0 · `EXISTING MODEL → REQUIRED DELTA`

Antes de escribir una tabla se auditó el schema 103 completo: 85 tablas, 220
funciones `SECURITY DEFINER`, y toda la capa de identidad de las migraciones
`20260812010000` a `20260812110000`.

El resultado cambió el alcance de la misión. **Dos de los tres tracks ya tenían
su modelo.** Lo que faltaba era una tercera parte del trabajo previsto, y pruebas
para las otras dos.

---

## 1. Lo que ya existía y se reutilizó tal cual

### Identidad y autorización

| Estructura | Desde | Qué aporta | Se reutilizó |
|---|---|---|---|
| `auth.users` | GoTrue | identidad, contraseñas, correos | sí, sin duplicar nada |
| `business_members(business_id, user_id, role, is_active)` | `20260601205707` + `20260812010000` | **la** autoridad. `unique(business_id,user_id)` | sí: la aprobación escribe acá |
| `staff_profiles` | `20260812010000` | identidad operativa de Panel, FK compuesta a la membresía | sí |
| `rider_profiles` | `20260812010000` | identidad operativa de reparto | sí |
| `identity_user_security` | `20260812010000` | baja y corte de sesiones | sí |
| `identity_sessions` | `20260812020000` | sesión lógica revocable | sí |
| `identity_permissions` / `identity_role_permissions` | `20260812010000` | catálogo explícito de permisos | sí: `identity.members.write` / `.read` / `roles.write` |
| `identity_audit_events` | `20260812020000` | auditoría append-only | sí: 3 tipos de evento nuevos |
| `identity_invitations` | `20260812050000` | alta por invitación (empuje) | intacta, conviven |

### Las funciones de la compuerta

| Función | Qué se usó |
|---|---|
| `identity_member_role(business)` | la decisión de autoridad; ninguna RPC nueva la reimplementa |
| `identity_require_permission(business, permission)` | primera línea de la aprobación y de la bandeja |
| `identity_has_permission(business, permission)` | para saber si el actor puede otorgar `admin` |
| `identity_is_anonymous()` | para que una sesión de cliente nunca pida acceso al equipo |
| `identity_session_id()` | para sellar la auditoría con la sesión real |
| `identity_record_audit_event(...)` | único escritor de la auditoría |
| `identity_guard_membership_write()` | trigger que impide escribir membresías fuera de las RPC |
| `set_updated_at()` | trigger de `updated_at` |
| `identity_register_session(...)` | lo que convierte una membresía en sesión operativa |

### Memoria del cliente — **completa desde antes**

| Estructura | Desde | Estado |
|---|---|---|
| `customers(id = auth.uid())` | `20260728090000` | tal cual |
| `customer_addresses` | `20260728090000` | tal cual |
| índice único de una sola predeterminada | `20260728090000` | tal cual |
| `get_current_customer_profile()` | `20260728090000` | tal cual |
| `upsert_current_customer_profile()` | `20260729150000` | tal cual |
| `upsert_current_customer_address()` | `20260728090000` | tal cual |
| `set_current_customer_default_address()` | `20260728090000` | tal cual |
| `archive_current_customer_address()` | `20260728090000` | tal cual |
| resolutor de dirección guardada en `create_order_with_items` | `20260728090000` | tal cual |
| frontend: repositorio, vista de perfil, hidratación con carrera resuelta | ya existían | tal cual |

### Modelo de Rider operativo

El Rider operativo **no** es la tabla `public.riders` (que no tiene vínculo con
`auth.users` y funciona como entidad de despacho). Es:

```
business_members(role = 'rider', is_active = true)
  + rider_profiles
  + orders.assigned_rider_user_id = auth.uid()
```

Verificado leyendo `get_rider_delivery_board`, `publish_rider_location_fanout` y
`rider_require_active_membership`: las tres arrancan resolviendo la membresía.

**Consecuencia que ahorró trabajo:** un Rider pendiente ya estaba bloqueado de
todo lo operativo antes de escribir una línea, porque todas las RPC exigen esa
membresía. El delta no era construir el bloqueo: era **probarlo**.

---

## 2. Lo que faltaba de verdad — el delta

| Delta | Cómo se resolvió | Migración |
|---|---|---|
| una persona no podía pedir entrar; sólo podía ser invitada | `business_access_requests` + `request_business_access` + `get_my_business_access_request` | 104 |
| no había forma de decidir esa solicitud en un solo acto | `identity_list_access_requests` + `identity_review_access_request` | 105 |
| tres tipos de evento de auditoría para el alta | `alter constraint` del vocabulario cerrado | 104 |
| el revisor no podía borrar su cuenta (defecto propio) | invariante reescrito | 106 |
| ninguna cuenta con membresía se podía borrar por Auth (defecto preexistente) | vía de limpieza en el guard | 107 |
| el Panel no ofrecía crear cuenta ni ver su espera | `signUpTeam`, `requestTeamAccess`, `readTeamAccessState`, 5 pantallas | frontend |
| el Panel no tenía dónde decidir | vista `team-access` con permiso `team.manage` | frontend |
| la app Rider no ofrecía crear cuenta ni tenía pantalla de espera | `signUp`, `requestRiderAccess`, `refreshAccessApplication`, estado `pendingApproval`, 2 pantallas | Kotlin + Dart |
| la memoria del cliente no tenía **ni una** prueba de base | 47 pruebas de aislamiento e invariantes | tests |
| el alta no tenía pruebas | 98 pruebas de no-escalada | tests |
| no había herramienta para el primer owner | `bootstrap-first-business-owner.mjs` | scripts |

---

## 3. Lo que se decidió NO crear

| Se descartó | Por qué |
|---|---|
| una tabla `rider_applications` aparte | sería la misma frase dos veces, con dos máquinas de estado que se desincronizan. `business_members` ya impone un rol por persona y comercio: nadie puede ser Rider y encargado del mismo comercio. |
| un `customer_profiles` nuevo | `customers` ya cuelga de `auth.uid()` y ya está probado en producción |
| una tabla de roles o permisos propia | `identity_permissions` / `identity_role_permissions` ya existen y están cableadas |
| un `authorization` propio en las RPC nuevas | duplicar `identity_member_role` sería crear una segunda autoridad que puede discrepar |
| estados `cancelled` y `revoked` | ninguna pantalla del producto los produce; revocar ya es `identity_set_member_active(false)` |
| una bandera `registration_enabled` en `businesses` | no agrega seguridad —una solicitud no otorga nada— y agregaría un paso manual en producción. La enumeración se cierra respondiendo `not_available` de forma uniforme. |
| geodata nueva en direcciones | el checkout ya produce lat/lng/precisión desde el paso de confirmación |
| account linking anónimo → email | Fase 9: no está implementado en la arquitectura actual y meterlo acá sería una segunda misión. Documentado como evolución. |
| CAPTCHA | no hay proveedor y no se inventa uno. Compuerta de lanzamiento. |
