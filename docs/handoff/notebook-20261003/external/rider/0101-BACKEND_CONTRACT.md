# Contrato real de backend — La Taba Rider

## Alcance y evidencia

Auditoría de sólo lectura realizada sobre:

- Proyecto: `C:\1212\la-taba-real-orders-staging`
- Rama: `staging/real-orders-walter`
- HEAD solicitado: `c6270589756214eac617515248e93a8e8819190b`
- Supabase staging: `ukxqbgswjlibmnjemrzd` (`la-taba-staging`)
- Migraciones observadas: desde `20260531030000` hasta `20260801040000`.
- Verificación remota: `supabase migration list --linked` reportó `20260801040000` aplicada remotamente.

El working tree del backend no estaba limpio al auditar. Tenía cambios locales en documentación, JS y tests, además de la migración Gate 2 y su test. No se modificó nada. Este documento describe el contrato efectivo de las migraciones aplicadas y marca las diferencias legacy donde importan.

Fuentes principales:

- `supabase/migrations/20260601205707_operational_orders_v1.sql`
- `supabase/migrations/20260725030000_taba_production_orders.sql`
- `supabase/migrations/20260725050000_tracking_rider_privacy.sql`
- `supabase/migrations/20260725080000_rider_assignment_tracking_gate.sql`
- `supabase/migrations/20260725100000_tracking_handoff_recovery.sql`
- `supabase/migrations/20260725090000_delivery_handoff_code.sql`
- `supabase/migrations/20260801020000_order_revision_and_event_sequence.sql`
- `supabase/migrations/20260801040000_rider_gps_tracking_gate2.sql`
- `js/services/supabase-auth.js`
- `js/repositories/supabase_order_repository.js`
- `js/map/route_geometry.js`
- `tests/rider-gps-gate2.test.mjs`

## Auth real

El cliente web actual usa el cliente oficial Supabase con `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false` y almacenamiento de sesión del runtime. El rider Android debe conservar el mismo comportamiento semántico, pero la autoridad física será Kotlin.

Operaciones observadas:

- `auth.getSession()` devuelve `session` y `user`.
- `auth.signInWithPassword({email, password})` autentica al equipo.
- Luego se consulta `business_members` con `business_id`, `user_id` y `is_active = true`; roles admitidos por el cliente: `owner`, `admin`, `staff`, `rider`.
- `auth.onAuthStateChange(callback)` notifica cambios de sesión.
- `auth.signOut({scope: 'local'})` cierra la sesión local.
- Para el rider, el servidor vuelve a comprobar `auth.uid()`, membresía activa y `role = 'rider'` en cada RPC sensible. La membresía local no es una autorización suficiente.

No usar sesión anónima en la app rider. La sesión anónima existente está destinada al flujo cliente.

## Tabla de RPCs consumibles por Rider

### 1. Pedidos disponibles

```text
list_available_rider_orders(p_business_id uuid)
returns table (
  public_code text,
  general_zone text,
  pickup_branch text,
  approximate_packages integer,
  payment_method text,
  collection_amount numeric,
  estimated_minutes integer,
  operational_restrictions text,
  revision bigint
)
```

Requisitos server-side: sesión autenticada, rol `rider` activo para el negocio, `delivery_mode = 'delivery'`, `status = 'ready'`, `assigned_rider_user_id is null`. Ordena por `ready_at` y `created_at`, límite 50. No devuelve UUID interno, dirección exacta, nombre, teléfono ni historial GPS.

`estimated_minutes` sólo aparece si la metadata de ETA tiene fuente `business` o `routing`, fue actualizada hace como máximo 15 minutos, no está más de 30 segundos en el futuro y la llegada aún es futura. Si no, es `null`.

### 2. Claim atómico

```text
claim_available_rider_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_revision bigint,
  p_expected_status text default 'ready',
  p_expected_rider_user_id uuid default null
)
returns jsonb
```

La RPC toma la fila con `FOR UPDATE`, exige `delivery_mode = 'delivery'`, estado y rider esperado, compara `revision`, actualiza `assigned_rider_user_id = auth.uid()` y `status = 'assigned'`, genera evento `order.rider_claimed` y devuelve `rider_order_rpc_payload(order_id)` más:

```json
{ "idempotent_no_op": false }
```

Un segundo toque del mismo rider cuando ya está `assigned` devuelve el payload con `idempotent_no_op: true`, sin evento ni nueva revisión. Otro rider no pasa por ese camino.

Errores observados:

| SQLSTATE | Mensaje exacto | Situación |
|---|---|---|
| `42501` | `autenticacion requerida` | No hay `auth.uid()`. |
| `42501` | `rol rider requerido para este negocio` | Membresía ausente/inactiva o rol incorrecto. |
| `22023` | `public_code requerido` | Código vacío. |
| `22023` | `expected_revision requerido` | Revisión nula o menor que 1. |
| `P0002` | `pedido inexistente` | Código no pertenece al negocio. |
| `42501` | `los pedidos con retiro no admiten rider` | `delivery_mode <> delivery`. |
| `40001` | `revision desactualizada: esperada %, actual %` | Snapshot viejo. |
| `40001` | `conflicto de asignacion: estado, revision o rider esperado cambio` | CAS de estado/assignee falló. |
| `40001` | `conflicto de asignacion: otro rider gano la carrera` | Otro claim ganó. |

### 3. Inicio de entrega

```text
start_rider_delivery(
  p_order_id uuid,
  p_expected_revision bigint
)
returns jsonb
```

Exige Auth, membresía rider activa, `delivery_mode = 'delivery'`, asignación al `auth.uid()`, y estado `assigned` o `picked_up`. Compara `revision`, delega la transición a `transition_order(order_id, expected_revision, 'on_the_way')`, y devuelve el payload completo más `idempotent_no_op`.

Si el estado ya es `on_the_way`, el segundo toque es no-op exitoso. No crea otro evento ni incrementa la revisión.

Errores observados:

| SQLSTATE | Mensaje exacto |
|---|---|
| `42501` | `autenticacion requerida` |
| `22023` | `pedido y expected_revision requeridos` |
| `P0002` | `pedido inexistente` |
| `42501` | `rol rider requerido para iniciar el reparto` |
| `42501` | `solo el rider asignado puede iniciar el reparto` |
| `40001` | `estado invalido para iniciar el reparto: %` |
| `40001` | `revision desactualizada: esperada %, actual %` |

### 4. Publicación GPS Gate 2

```text
publish_rider_location(
  p_order_id uuid,
  p_expected_revision bigint,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_heading double precision default null,
  p_speed double precision default null,
  p_captured_at timestamptz default null
)
returns jsonb
```

Respuesta exitosa, sin campos históricos adicionales:

```json
{
  "id": "uuid",
  "order_id": "uuid",
  "business_id": "uuid",
  "rider_user_id": "uuid",
  "order_revision": 12,
  "sequence": 345,
  "lat": -38.95,
  "lng": -68.06,
  "accuracy": 18.0,
  "heading": 120.0,
  "speed": 8.4,
  "source": "gps",
  "recorded_at": "server timestamp",
  "created_at": "server timestamp"
}
```

Validaciones server-side:

- Auth requerida.
- `p_order_id` y `p_expected_revision >= 1` requeridos.
- Latitud `[-90,90]`, longitud `[-180,180]`, sin NaN/Infinity.
- `p_accuracy` requerido, finito y `[0,250]` metros.
- `p_heading`, si existe, finito y `[0,360)`.
- `p_speed`, si existe, finito y `[0,70]`.
- `p_captured_at`, si existe, no más de 30 s futuro ni más de 3 minutos viejo respecto del reloj del servidor.
- El pedido debe existir, ser delivery, tener membresía rider activa, estar asignado al `auth.uid()` y estar en `assigned`, `picked_up`, `on_the_way` o `arrived`.
- `orders.revision` debe ser igual a `p_expected_revision`.
- Si existe `captured_at`, no puede ser menor o igual a la última muestra aceptada del mismo rider/pedido.
- No acepta una muestra si existe GPS del mismo rider/pedido recibida en los últimos 5 s.

Mensajes observados:

| SQLSTATE | Mensaje exacto |
|---|---|
| `42501` | `autenticacion requerida` |
| `22023` | `ubicacion GPS invalida o imprecisa` |
| `22023` | `muestra GPS futura o atrasada` |
| `P0002` | `pedido inexistente` |
| `42501` | `pedido no asignado a este rider o reparto finalizado` |
| `40001` | `revision desactualizada: esperada %, actual %` |
| `40001` | `muestra GPS atrasada respecto de la ultima aceptada` |
| `P0001` | `ubicacion GPS publicada demasiado pronto` |

El trigger `rider_locations_server_time` sobreescribe `recorded_at` y `created_at` con `clock_timestamp()`. `sequence` es global, positivo y único; `order_revision` es obligatorio y positivo. La app no escribe ninguno de esos campos.

### 5. Snapshot público tokenizado

```text
get_public_order_tracking(p_public_id text)
returns jsonb
```

La autorización usa el header `x-order-token`; el servidor guarda hash, comprueba expiración/revocación y devuelve `null` si no autoriza. El DTO puede incluir `public_code`, `delivery_mode`, estados y timestamps, ETA sólo si confiable, `terminal_visible_until`, el código de entrega sólo en `arrived`, y un único `rider_location`:

```json
{
  "lat": -38.950,
  "lng": -68.060,
  "accuracy": 100,
  "source": "gps",
  "sequence": 345,
  "recorded_at": "server timestamp",
  "created_at": "server timestamp"
}
```

La ubicación se redondea a tres decimales, se limita al rider asignado, a la revisión vigente o anterior, a `accuracy <= 250`, a los últimos 3 minutos y a 30 s de tolerancia futura. Se ordena por `sequence desc`; no devuelve array/historial ni `assigned_rider_user_id`.

### 6. Confirmación de entrega

```text
confirm_order_delivery(
  p_order_id uuid,
  p_expected_status text,
  p_delivery_code text
)
returns jsonb
```

Sólo el rider asignado y con pedido en `arrived` puede confirmar. El código se normaliza a cuatro dígitos. Respuestas estructuradas observadas: `INVALID_FORMAT`, `CODE_UNAVAILABLE`, `LOCKED`, `MISMATCH`, `{ok:true, already_confirmed:true}` o `{ok:true, public_code, status:'delivered', confirmed_at}`. El trigger impide pasar a `delivered` si el código requerido no fue confirmado.

## Payload de pedido para rider

`rider_order_rpc_payload(uuid)` devuelve, después de Gate 2:

- Identidad operativa: `id`, `public_code`, `status`, `revision`, `delivery_mode`, `assigned_rider_user_id`.
- Datos del cliente y entrega: `customer_name`, `customer_phone`, `address_label`, `customer_street_address`, `customer_neighborhood`, `customer_reference`, `customer_notes`.
- Cobro: `payment_method`, `subtotal`, `delivery_fee`, `total`, `currency_code`.
- Ítems: `product_uuid`, `product_id`, `name`, `quantity`, `unit`, `unit_price`.
- Timestamps, restricciones de edad y ETA confiable.

No incluye `rider_locations` histórico en Gate 2. La app debe minimizar el almacenamiento local de estos campos y no debe mostrar teléfono/dirección completa hasta que exista aprobación de producto.

## Pedidos, revisión y sequence

Estados permitidos por el esquema operativo incluyen `received`, `accepted`, `preparing`, `ready`, `on_the_way`, `delivered`, `cancelled`, `rejected` y compatibilidad con `draft`, `submitted`, `assigned`, `picked_up`, `arrived`, `canceled`, `arriving`. Gate 1 normaliza:

```text
received        -> submitted
canceled        -> cancelled
arriving        -> arrived
ready_for_pickup -> ready
```

Para la app rider, el flujo observable es `ready -> assigned -> on_the_way -> arrived -> delivered`, con `picked_up` como estado permitido antes de iniciar. `delivered`, `cancelled`, `canceled` y `rejected` son terminales en las superficies correspondientes. No inventar estados nuevos.

`orders.revision` es `bigint`, inicia en 1 y el trigger `orders_zz_bump_revision` la incrementa en cada UPDATE efectivo. `order_events.sequence` es un bigint global único generado por secuencia; sirve para ordenar eventos que comparten timestamp.

## RLS y privilegios efectivos

- Todas las tablas operativas relevantes tienen RLS habilitado.
- `business_members`: un usuario autenticado puede leer sus propias filas; owners tienen administración.
- `orders`: la lectura pasa por `can_access_order`, que contempla cliente propio, rol de negocio o rider asignado en estado operativo. La app no depende de seleccionar pedidos ajenos.
- `orders`: existe una policy de update para negocio y rider, pero la app rider debe usar RPCs con CAS. No se autoriza mutar directamente desde Android.
- `order_items` y `order_events`: lectura acotada por acceso al pedido; Gate 1 restringe eventos operativos de assignment al negocio.
- `rider_locations`: Gate 2 revoca privilegios de tabla para `public`, `anon` y `authenticated`, elimina policies de lectura/escritura directa y deja la escritura sólo en `publish_rider_location` SECURITY DEFINER. La app no usa `.insert`, `.select` ni Realtime crudo sobre esta tabla.
- RPCs rider (`list_available_rider_orders`, claim, start, publish) tienen `EXECUTE` para `authenticated`, no para `anon`; `get_public_order_tracking` puede ejecutarse por `anon, authenticated` con token de header.
- `order_public_tokens` guarda hash, revocación, expiración y ventana terminal. La ubicación histórica exacta se purga al pasar a terminal mediante trigger de privacidad.

## Freshness y límites

| Superficie | Regla |
|---|---|
| Publicación | GPS con precisión máxima 250 m; servidor mínimo 5 s; `captured_at` entre -3 min y +30 s. |
| Snapshot público | Último `sequence` del rider asignado, `recorded_at` dentro de 3 min y +30 s futuro. |
| UI existente | `fresh <= 15 s`, `delayed <= 45 s`, `lost > 45 s`, `none` sin fix. |
| ETA | Sólo source `business`/`routing`, actualizado <= 15 min y llegada futura. |

La app Android no debe afirmar que un GPS es “en vivo” sólo porque está guardado localmente.

## Contratos legacy que no debe usar la app

El claim de cuatro argumentos y el publish GPS sin `p_expected_revision` fueron reemplazados por Gate 2. La app no debe hacer fallback a ellos. La escritura directa legacy de `rider_locations` tampoco es válida aunque alguna policy histórica la mencione.

