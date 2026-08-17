# TABA2 · Contrato de aprobación

## 1. Aprobar es UN acto

El error que este contrato existe para hacer imposible es el que se comete solo:
que el cliente inserte la membresía y después marque la solicitud como aprobada.

Con dos viajes de red, la mitad de las veces que falla el segundo queda alguien
con acceso y una solicitud que sigue diciendo «pendiente»; y la mitad de las veces
que falla el primero queda una solicitud aprobada sin membresía. Las dos mitades
son irreparables desde el Panel, porque el Panel no puede escribir
`business_members`.

`identity_review_access_request` hace, dentro de una sola función y por lo tanto
dentro de una sola transacción:

```
lock de la fila         select ... for update
autoridad               identity_require_permission(business, 'identity.members.write')
no-auto-revisión        v_req.user_id <> auth.uid()
idempotencia            status = 'pending', o sale por already_decided
rol                     rider → 'rider' forzado
                        panel → 'staff' por defecto, 'admin' sólo con identity.roles.write
                        'owner' → invalid_role, siempre
marca de identidad      set_config('taba.identity_write', 'on', true)
  business_members       insert (role, is_active = true)
  identity_user_security insert on conflict do nothing
  staff_profiles         insert, o
  rider_profiles         insert
marca apagada           set_config('taba.identity_write', 'off', true)
sello                   update ... status='approved', decided_at, decided_by, granted_role
auditoría               access_request_approved
```

O pasan todas, o ninguna.

## 2. Las tres reglas que sostienen «nadie se da permisos a sí mismo»

### 2.1 La autoridad se pregunta al servidor

`identity_require_permission(business_id, 'identity.members.write')` sobre el
comercio **de la solicitud**, no sobre uno que venga en un parámetro. No hay rol
en la firma del que fiarse, ni claim, ni `user_metadata`.

Quién la pasa, según `identity_role_permissions`:

| Rol | `identity.members.write` | `identity.roles.write` |
|---|---|---|
| owner | sí | sí |
| admin | sí | **no** |
| staff | no | no |
| rider | no | no |

De ahí sale, sin ninguna regla extra, que un admin pueda aprobar staff y riders
pero no fabricar otro admin.

### 2.2 Nadie decide sobre su propia solicitud

```sql
if v_req.user_id = v_actor then
  return jsonb_build_object('ok', false, 'code', 'self_review');
end if;
```

Es la única regla del contrato que **no tiene excepción por rango**. Un owner con
una solicitud propia tampoco. Está probada creando la fila a mano, porque por la
vía normal un owner no puede llegar a tener una.

### 2.3 `owner` no es otorgable por esta vía

Ni por parámetro, ni por defecto, ni por reintento. Lo veta el `CHECK` de la
tabla (`granted_role in ('admin','staff','rider')`) y además la RPC antes de
escribir. Dos capas para el mismo veto, porque es el que importa.

## 3. Lo que aprobar NO toca

`identity_review_access_request` no menciona, ni directa ni indirectamente:

* `capacity` ni `rider_max_active_orders()`;
* `rider_order_offers`, `assign_order_rider`, `claim_available_rider_order`;
* `orders`, `order_events`, ningún estado de pedido;
* `businesses.ordering_enabled` ni `ordering_verified`;
* nada de pagos ni de fiscal.

Un Rider recién aprobado entra al **mismo** contrato certificado que ya existía:
registra su sesión y pide su tablero. Probado en la suite (`el Rider recien
aprobado ya puede registrar su sesion` + `el tablero le contesta`) y contra
producción real en el smoke.

## 4. Idempotencia y concurrencia

| Escenario | Resultado | Prueba |
|---|---|---|
| dos `request_business_access` simultáneos | el `unique` decide; el que pierde devuelve el pendiente del que ganó | RPC + control de `unique_violation` |
| aprobar dos veces | la segunda espera el lock, relee y sale por `already_decided` | suite, prueba 45 |
| aprobar dos veces con otro rol | el rol **no** cambia | suite, prueba 46 |
| aprobar y rechazar en carrera | el lock serializa; la segunda ve la fila decidida | mismo mecanismo |
| aprobar a quien ya entró por otra vía | `already_member`, sin tocar su rol | suite, pruebas 91-93 |

## 5. La bandeja

`identity_list_access_requests(business_id, status)` exige
`identity.members.read`. Devuelve, por solicitud:

* `email` completo. Es el correo de alguien que pide entrar **a ese comercio**, y
  es el mismo dato que el owner ya tipea a mano para invitar. Sin él, decidir
  sería adivinar.
* `full_name` y `contact_phone`: lo que la persona declaró.
* `attempt_count`: para que se vea quién está insistiendo.
* `is_member`: si ya entró por otra vía, la pantalla lo dice y no ofrece aprobar.
* `roles_grantable`: **lo calcula el servidor** según lo que quien mira puede
  realmente otorgar. Un encargado no ve la opción «Encargado» porque no puede
  crearla, no porque la pantalla la esconda.

`decision_reason` **no** viaja a la persona interesada: `get_my_business_access_request`
no lo devuelve. Al interesado le corresponde el resultado, no el expediente.
