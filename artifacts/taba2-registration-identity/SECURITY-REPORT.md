# TABA2 · Alta autogestionada · INFORME DE SEGURIDAD

Destino: `la-taba-production` (`wwcpogltfgzgkrlilbcd`), región `sa-east-1`.
Ledger: **103 → 107**, forward-only.
Todo lo que sigue está **medido contra la base**, no inferido de las migraciones.

---

## 1. El principio, y cómo se hace cumplir

> `SELF REGISTRATION = IDENTITY` · `SELF REGISTRATION != AUTHORIZATION`

| Lo que una persona puede hacer sola | Lo que produce |
|---|---|
| crear su cuenta (`signUp`) | una fila en `auth.users`. Nada más. |
| pedir acceso (`request_business_access`) | una fila en `business_access_requests` con `status = 'pending'`. Nada más. |
| consultar su estado (`get_my_business_access_request`) | su propia fila. |

Lo que **no** puede hacer sola, verificado uno por uno contra producción real:

| Intento | Respuesta |
|---|---|
| elegir su rol | la RPC no tiene parámetro de rol |
| elegir de quién es la solicitud | la RPC no tiene parámetro de usuario; deriva `auth.uid()` |
| insertar en `business_members` | 403 (sin grant), y debajo RLS, y debajo el guard |
| leer `business_access_requests` | 403 (cero grants) |
| aprobar su propia solicitud | 42501 (no tiene el permiso) |
| aprobar la de otro | 42501 |
| abrir la bandeja del comercio | 403 |
| que la aprueben como `owner` | `invalid_role`, siempre, para cualquiera |
| pedir acceso con sesión anónima | `not_authenticated` |

## 2. Dónde vive la autoridad

En la base, y en un solo lugar. La cadena completa:

```
auth.users                     ← identidad (GoTrue). No se duplica.
  └── business_members          ← autorización. unique(business_id, user_id).
        │                          Escritura sólo por RPC de identidad.
        ├── staff_profiles       ← identidad operativa de Panel
        ├── rider_profiles       ← identidad operativa de reparto
        └── identity_user_security ← baja y corte de sesiones

identity_member_role(business)  ← LA función que decide. Devuelve el rol o NULL.
  exige: no anónimo · membresía activa · persona no dada de baja
       · sesión registrada en identity_sessions · token posterior al corte

  ├── is_business_member()      ← cableada en decenas de policies
  ├── has_business_role()       ← idem, con coalesce a false (falla cerrada)
  ├── identity_has_permission() ← catálogo explícito de permisos
  └── identity_require_permission() ← corta la ejecución
```

Esta misión **no agregó una segunda autoridad**. Las cuatro RPC nuevas consultan
la misma compuerta que ya estaba cableada. No hay un mini-IAM paralelo.

## 3. Superficie nueva, medida

| Eje | Antes (103) | Después (107) |
|---|---|---|
| tablas | 85 | 86 |
| RLS activa | 85 / 85 | **86 / 86** |
| RLS faltante | 0 | **0** |
| `SECURITY DEFINER` | 220 | 224 |
| definers sin `search_path` | **0** | **0** |
| definers ejecutables por `anon` | **8** | **8** |
| grants de escritura a `anon`/`authenticated` | **0** | **0** |
| `EXECUTE` a `PUBLIC` en funciones nuevas | — | **0** |
| `CREATE` sobre `public` para anon/authenticated | no | no |
| vault accesible por anon/authenticated | no | no |

Las cuatro funciones nuevas son `SECURITY DEFINER` con `search_path` fijo
(`pg_catalog, public, pg_temp`), sin `EXECUTE` para `PUBLIC` ni para `anon`, y con
grant explícito sólo para `authenticated`. La quinta
(`business_access_request_retry_delay`) no la ejecuta ningún rol de cliente.

**El alta no agregó un solo definer ejecutable por `anon`.** Los 8 siguen siendo
los mismos 8 del contrato escrito.

## 4. Defensa en profundidad sobre la membresía

| Capa | Qué impide | Verificada |
|---|---|---|
| grants | que `authenticated` escriba `business_members` | sí, con intento real |
| RLS | que alguien sin autoridad inserte, aun con el grant | sí, control negativo: se devolvió el grant dentro de la transacción y la RLS siguió rechazando |
| guard | que **cualquiera**, incluso con autoridad, escriba fuera de las RPC | contra stack alojado (smoke), no desde pgTAP |

La tercera capa no se puede ejercitar desde `supabase test db`: su vía de escape
para conexiones directas mira `session_user`, que ahí es `postgres`. Queda dicho en
la suite en vez de fingir que se probó.

## 5. Los dos defectos que encontró el smoke en vivo

Ninguno era visible desde un stack local, y los dos por el mismo motivo:
dependían de que la conexión **no** fuera la de un superusuario. Vale registrarlo
como método: un contrato de identidad certificado sólo contra `psql` tiene un
punto ciego con la forma exacta de sus propias vías de escape.

### 5.1 El revisor no podía borrar su cuenta — defecto propio

`decided_by` es `on delete set null` (una decisión sobrevive a la cuenta de quien
la tomó). El CHECK original exigía `(decided_at is null) = (decided_by is null)`.
Juntas: en cuanto una persona aprobaba una sola solicitud, su cuenta ya **no se
podía borrar nunca**. El `UPDATE` que rompía el CHECK lo hacía el motor, no un
cliente.

Es el mismo error de razonamiento que la migración `20260812070000` arregló en la
auditoría de identidad. Corregido en `20260817030000`: el invariante ahora dice lo
que importaba —no puede haber revisor **sin** decisión— y una decisión sin revisor
es un hecho normal.

### 5.2 Ninguna cuenta con membresía se podía borrar por Auth — defecto preexistente

`DELETE /auth/v1/admin/users/{id}` sobre alguien con membresía contestaba 500. El
mismo DELETE por conexión directa funcionaba.

`business_members.user_id` es `on delete cascade`; ese DELETE lo dispara el motor,
y `identity_guard_membership_write` mira **quién** llama, no **qué** pasa. GoTrue
borra con `supabase_auth_admin`, que no está en ninguna de sus vías de escape.

Neto: la cuenta de cualquier integrante de un comercio no se podía borrar por la
única vía que tiene el tablero de Supabase, ni por la única que tendría un pedido
de baja de datos personales. Venía desde `20260812080000`.

Corregido en `20260817040000` **sin** agregar `supabase_auth_admin` a la lista de
roles de confianza —eso abriría una vía de escritura por rol— sino con una
condición sobre el hecho: se permite el DELETE cuando la persona o el comercio
referenciados **ya no existen**. Quitar una membresía que no describe a nadie no
es un acto administrativo, es limpieza.

## 6. Enumeración e información que no se filtra

| Superficie | Qué no revela |
|---|---|
| `request_business_access` con un comercio inexistente | responde `not_available`, **igual** que con un comercio dado de baja: no es un oráculo de identificadores |
| `signUpTeam` con un correo ya registrado | «Si ya tenés una cuenta con ese correo, iniciá sesión»: sirve igual en los dos casos |
| `get_my_business_access_request` | no devuelve `decision_reason` ni `decided_by`: al interesado le corresponde el resultado, no el expediente |
| pantallas del Panel | ninguna de las cinco menciona 403, PGRST, JWT, `policy` ni `row-level`; hay una prueba que lo revisa sobre el texto de las cinco |
| app Rider | los `messageKey` del nativo se traducen en un solo lugar; ninguno filtra vocabulario del backend |
| auditoría | guarda el **dominio** del correo, nunca el correo completo |

## 7. Anti-spam, sin inventar un proveedor

| Capa | Qué hace |
|---|---|
| `unique (business_id, user_id)` | una persona no puede tener dos solicitudes al mismo comercio. Nunca. |
| reuso de fila | volver a pedir actualiza la misma fila y suma `attempt_count`: la tabla no crece por insistir |
| espera de 24 h tras un rechazo | server-side, en `business_access_request_retry_delay()`; el cliente no puede saltearla |
| `attempt_count` en la bandeja | quien decide **ve** a quién está insistiendo |
| GoTrue | limita los intentos de alta y de ingreso por su cuenta |

No se agregó CAPTCHA: no hay proveedor y no se inventa uno. Queda como compuerta
de lanzamiento en el informe final.

## 8. Lo que el alta NO toca

Verificado leyendo las migraciones y midiendo la base después:

* `businesses.ordering_enabled` = **false**, `ordering_verified` = **false**;
* `orders` = 0, `order_items` = 0, `payment_intents` = 0;
* `rider_max_active_orders()` sin cambios; capacidad, ofertas, claim, release y
  reassign siguen verdes en sus cuatro suites;
* ninguna credencial de Mercado Pago, ningún endpoint de pago;
* `service_role` no aparece en ningún cliente: ni en la web, ni en la app Rider.
  Sólo la usan dos herramientas de línea de comandos.
