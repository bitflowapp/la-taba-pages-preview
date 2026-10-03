# TABA Rider Android — Contrato de backend

**Backend: Supabase.** Dos entornos: `staging` y `producción`.

**El relay de demostración (`scripts/realtime-relay.mjs`) NO es backend de la app Android.** Es una pieza de demo de la PWA, sin autenticación real, sin RLS y sin persistencia durable. La app Android habla con Supabase desde el primer día, contra `staging`.

## Autenticación

`supabase.auth.signInWithPassword` → sesión con `access_token` (JWT, ~1 h) y `refresh_token`.

- `refresh_token` en **Android Keystore** vía `flutter_secure_storage`.
- Refresco automático; ante fallo se va a `login` **conservando la cola local**.
- El JWT lleva `sub` (rider id) y un claim `business_id`. **La app no envía `rider_id` en ningún RPC**: el servidor lo toma del token. Enviarlo desde el cliente sería un vector de suplantación.

## Tablas y RLS

| Tabla | SELECT del rider | INSERT/UPDATE del rider |
|---|---|---|
| `orders` | Sólo pedidos de su `business_id` **y** (`status='ready'` sin rider **o** `rider_id = auth.uid()`) | **Ninguno** — el estado sólo cambia por RPC |
| `order_items` | Sólo de pedidos visibles según la regla anterior | Ninguno |
| `customers` | **Ninguno directo** — los datos del cliente llegan proyectados por la vista del pedido activo | Ninguno |
| `riders` | Sólo su propia fila | `is_available`, `device_id`, `push_token` |
| `rider_locations` | Sólo sus propias filas | INSERT sólo con `order_id` asignado y en estado con ubicación activa |
| `order_events` | Sólo de pedidos visibles | Ninguno — los escribe el RPC |
| `rider_feature_flags` | Todos | Ninguno |

**Principio:** el rider **lee poco y no escribe nada directamente**. Todo cambio de estado pasa por un RPC `SECURITY DEFINER` que valida precondición, autoría e idempotencia.

### Proyección del pedido activo

Vista `rider_active_order` que expone **sólo lo necesario**:

```
order_id, code (A-1042), status, created_at, promised_at,
store: { name, address, lat, lng },
customer: { display_name, phone_masked, address, reference, lat, lng },
items: [{ qty, name, presentation, line_total }],
totals: { subtotal, shipping, total },
payment: { method, pays_with, change_due },
delivery_code_hint: null          -- el código NUNCA viaja al rider
```

- `phone_masked` (`+54 ··· ··4821`); la llamada se hace por un enlace `tel:` que el servidor firma o por proxy. **El teléfono completo no se expone.**
- Los datos del cliente **desaparecen de la proyección** al pasar a `delivered`, `cancelled` o `failed`. El histórico del rider guarda sólo `order_id`, hora, importe y estado.
- **El código de entrega jamás viaja al dispositivo del rider.** El rider lo escribe y el servidor lo valida.

## RPCs

Todos reciben `p_cmd_id uuid` y son idempotentes: una segunda llamada con el mismo `cmd_id` devuelve el mismo resultado sin repetir el efecto.

| RPC | Parámetros | Devuelve | Errores |
|---|---|---|---|
| `rpc_claim_order` | `p_order_id`, `p_cmd_id` | pedido proyectado | `ORDER_TAKEN`, `NOT_READY`, `RIDER_OFF_SHIFT`, `RIDER_HAS_ACTIVE_ORDER` |
| `rpc_confirm_pickup` | `p_order_id`, `p_cmd_id`, `p_at`, `p_geo?` | `{status, at}` | `NOT_ASSIGNED_TO_YOU`, `INVALID_TRANSITION`, `ORDER_CANCELLED` |
| `rpc_start_delivery` | ídem | `{status, at}` | `INVALID_TRANSITION` |
| `rpc_mark_arriving` | ídem + `p_source ('auto'\|'manual')` | `{status, at}` | `INVALID_TRANSITION` |
| `rpc_confirm_delivery` | `p_order_id`, `p_code`, `p_cmd_id`, `p_at`, `p_geo?` | `{status, at}` | `INVALID_CODE` (+ `attempts_left`), `CODE_ATTEMPTS_EXCEEDED`, `INVALID_TRANSITION` |
| `rpc_report_incident` | `p_order_id`, `p_type`, `p_note?`, `p_cmd_id`, `p_at`, `p_geo?` | `{status, at}` | `INVALID_TRANSITION` |
| `rpc_release_order` | `p_order_id`, `p_reason`, `p_cmd_id` | `{status}` | `NOT_ASSIGNED_TO_YOU`, `ALREADY_PICKED_UP` |
| `rpc_set_availability` | `p_available`, `p_cmd_id` | `{is_available}` | `HAS_ACTIVE_ORDER` |
| `rpc_push_locations` | `p_points jsonb[]` | `{accepted, rejected}` | `NO_ACTIVE_ORDER`, `TOO_MANY_POINTS` |
| `rpc_register_device` | `p_device_id`, `p_push_token`, `p_platform` | `{ok}` | — |

### Formato de error

```json
{ "code": "INVALID_CODE", "message": "El código no coincide.",
  "details": { "attempts_left": 2 }, "retryable": false }
```

`retryable` decide el comportamiento de la outbox: `true` reintenta con backoff, `false` descarta el comando **y se lo muestra al rider**. Nunca hay descarte silencioso.

## Realtime

Canal por rider: `rider:{rider_id}`.

| Evento | Efecto en la app |
|---|---|
| `order.offered` | Nuevo trabajo en la lista + sonido + notificación |
| `order.assigned_to_you` | Se abre el detalle |
| `order.cancelled` | **Diálogo irruptivo**, se libera el trabajo, se detiene la ubicación |
| `order.unassigned` | Aviso y vuelta a `home` |
| `order.updated` | Reconciliación de estado |
| `session.revoked` | Cierre de sesión inmediato (logout remoto) |

Realtime es **acelerador, no fuente de verdad**. Al reconectar, la app hace un `GET` de reconciliación (`rpc_sync_state(p_since)`) y no confía en haber recibido todos los eventos.

## Ubicación

`rpc_push_locations` recibe **lotes** de puntos:

```json
[{ "order_id":"…", "lat":-38.95, "lng":-68.06, "acc":12.4,
   "speed":8.3, "at":"2026-07-31T14:41:02Z", "src":"gps" }]
```

- Máximo 60 puntos por llamada.
- El servidor **rechaza** puntos sin pedido activo o fuera de la ventana `picked_up`…`delivered`.
- El servidor rechaza puntos con `at` en el futuro o más de 2 h en el pasado.
- Se conservan **7 días** y luego se agregan a la ruta resumida del pedido.

## Reconciliación

`rpc_sync_state(p_since timestamptz)` devuelve pedidos activos del rider, cambios de estado desde `p_since` y `server_time`.

Se llama al: arrancar la app, volver del segundo plano, recuperar conexión y al drenar la outbox. **El reloj del dispositivo no se usa para ordenar nada**: el servidor decide por su propio orden de llegada.

## Contrato de idempotencia

```sql
create table command_log (
  cmd_id uuid primary key,
  rider_id uuid not null,
  rpc_name text not null,
  order_id uuid,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz default now()
);
```

Cada RPC empieza consultando `command_log` por `cmd_id`: si existe, devuelve la respuesta guardada. Es lo que permite reintentar sin límite desde la cola durable sin duplicar efectos.

## Compatibilidad con la web

La PWA sigue funcionando durante toda la migración. Los mismos RPCs sirven a ambas: **primero se migra la web a los RPCs**, y recién después la app Android consume el mismo contrato ya probado en producción. Así el contrato llega validado al día 1 de Android.
