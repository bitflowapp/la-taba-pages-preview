# TABA2 · Rider multi-pedido — auditoría y decisión de modelo

Rama aislada. No forma parte de la Production Candidate.

- Backend: `feature/taba2-rider-multi-order-backend`, base `release/taba2-production-candidate @ 317bbe9`.
- Rider: `feature/taba2-rider-multi-order`, base `feature/taba2-rider-pilot-integration @ 894267a`.

---

## FASE A · Dónde estaba impuesto «un Rider = un pedido»

No estaba en un solo lugar. Estaba en cinco, y sólo uno de los cinco era una
regla de servidor.

### 1. SQL · el único límite duro, y está en un camino que el piloto no usa

`claim_delivery_order` (`20260802100000`, reescrita por `20260806220000`):

```sql
if exists (
  select 1 from public.orders active
  where active.assigned_rider_user_id = auth.uid()
    and active.id <> v_order.id
    and active.status in ('assigned','picked_up','on_the_way','arrived')
) then
  return jsonb_build_object('ok', false, 'code', 'active_delivery_exists');
end if;
```

Es el único chequeo server-side de cardinalidad que existe hoy. Y pertenece al
camino de *toma libre de cola*, que la RC del piloto apagó: con
`manualAssignmentOnly` el pedido entra sólo por asignación del Panel.

### 2. SQL · el camino que el piloto SÍ usa no tiene límite ninguno

`assign_order_rider` (`20260812110000`) escribe
`assigned_rider_user_id = p_new_rider_user_id, status = 'assigned'` sin contar
nada. **Hoy el Panel ya puede asignarle cuatro pedidos al mismo Rider.**

Lo que lo hacía invisible es la lectura, no la escritura.

### 3. SQL · la raíz real del piloto — la lectura devuelve uno solo

`get_active_rider_delivery()` (`20260812100000`) termina en:

```sql
   order by o.updated_at desc, o.id desc
   limit 1;
```

El Rider veía un pedido porque la RPC devolvía un pedido. Los otros tres
existían, estaban asignados, contaban para la caja y para el tracking del
cliente — y la app no tenía forma de nombrarlos.

**Ésa es la causa raíz del comportamiento observado.** El `limit 1` no protege
capacidad: la deja sin auditar.

### 4. Rider (Dart) · `assigned` es un `Order?`, no una lista

- `OrdersViewState.assigned` es un único `Order?`.
- `OrdersController.claimAvailableOrder` corta con
  `orders_rider_already_assigned` si `_state.assigned != null`.
- `RiderHomePage.build`: `assigned == null ? …mapa… : OrderDetailPage(...)`.
  Un pedido ocupa la pantalla entera; no hay superficie donde vivan tres.

### 5. Rider (Kotlin) · el servicio de primer plano rastrea UN pedido

`DeliveryServiceCoordinator` guarda un `ActiveDeliveryMetadata`
(orderId, revision, generation) y `beginDeliveryStart` tira
`delivery_already_active` si ya hay uno. `RiderForegroundService` publica GPS
contra ese `orderId`. Es la imposición más profunda de las cinco.

### Auditoría READ-ONLY de `feature/taba2-automated-rider-dispatch @ 226bca2`

Se leyó. No se cherry-pickeó nada.

Qué sirve, como **forma** de contrato de accept/reject:

- recibo de idempotencia por comando;
- CAS de versión sobre la oferta **y** CAS de revisión sobre el pedido dentro
  del propio `UPDATE ... where revision = … and assigned_rider_user_id is null
  and status = 'ready'`, que es lo que hace que dos aceptaciones no se pisen;
- motivo de rechazo como código cerrado, no texto libre, para que el Rider no
  pueda escribir datos personales dentro de la auditoría;
- payload de oferta minimizado, separado del payload del pedido aceptado.

Qué **no** sirve y no se copia:

- `rider_shifts.current_active_orders` es un **contador mutable**, y
  `max_concurrent_orders integer not null default 1 check (max_concurrent_orders = 1)`
  clava la capacidad en el esquema. Es exactamente el `active_count` con drift
  que este trabajo tiene prohibido;
- la capacidad se serializa con `dispatch_lock_job(job_id)` — un lock **por
  pedido**. Con máximo 1 y un índice de «una oferta viva por rider» la carrera
  quedaba tapada. Con máximo 3 y dos ofertas simultáneas al mismo Rider, dos
  jobs distintos toman locks distintos, cuentan 2 los dos, y escriben los dos.
  **Sería 4/3.** El lock tiene que ser por RIDER, no por pedido;
- todo lo demás (turnos, heartbeat, presencia, cola, scoring, ledger de
  recompensas, worker) queda fuera por pedido explícito.

---

## Modelo de datos

### OPTION A — la oferta es una fila propia, el pedido no se entera

Tabla `rider_order_offers(order_id, rider_user_id, status, version, …)`.
Mientras hay oferta el pedido sigue `ready` y `assigned_rider_user_id is null`.
Al aceptar, y sólo entonces, el pedido pasa a `assigned` con rider.

### OPTION B — reusar el pedido con un estado nuevo `offered`

El Panel escribe `status='offered'` + `assigned_rider_user_id = rider`.
Aceptar → `assigned`. Rechazar → vuelve a `ready` con rider en `null`.

### CHOSEN — **OPTION A**

Tres razones, en orden de peso.

**1. La privacidad no es una vista, es la autorización.** En este esquema, quién
ve la dirección exacta, el teléfono y las notas de un pedido lo decide
`assigned_rider_user_id`, y lo decide en muchos lugares a la vez:
`can_access_order` (RLS de `orders`, `order_items`, `order_events`),
`is_assigned_rider` (RLS de `rider_locations`), `rider_active_delivery_payload`,
y las once RPC del Rider. La OPTION B pone el `rider_user_id` en el pedido
*antes* de que el Rider acepte: en ese instante el Rider ya pasa todas esas
compuertas. Habría que agregarle `and status <> 'offered'` a cada una, y **una
sola omisión es una fuga de datos del cliente**. La OPTION A no toca ni una:
antes de aceptar el pedido no lo nombra, así que el Rider no pasa ninguna
compuerta y la única lectura posible es la RPC minimizada de la oferta.

**2. `orders.status` es el enum más cargado del sistema.** Aparece en la guía de
transiciones, en el normalizador del vocabulario público, en el tracking del
cliente, en las policies, en `ASSIGNED_STATUSES` del Rider y en predicados
`status in (…)` repartidos por 24 migraciones. Agregarle `offered` es inventar
un estado duplicado justo donde el modelo actual ya sabe representar
«ofrecido»: no representándolo en el pedido.

**3. El rechazo necesita memoria.** «Rechazado por Rider» tiene que quedar
escrito para que el Panel lo muestre y para que la misma oferta no vuelva a
caerle al mismo Rider en un bucle. En la OPTION B el rechazo es un rollback: no
deja rastro de quién dijo que no.

### Capacidad: derivada, nunca almacenada

```sql
select count(*) from public.orders
 where business_id = … and assigned_rider_user_id = …
   and status in ('assigned','picked_up','on_the_way','arrived')
```

No hay columna `active_count`, así que no hay drift posible: la cuenta sale de
las mismas filas que lee el resto del sistema. `delivered`, `cancelled` y
`rejected` no aparecen en el `in`, así que liberan cupo por el solo hecho de
llegar ahí.

### Atomicidad: el lock es por Rider, y el guard está en la tabla

Dos capas, a propósito:

1. **Serialización por Rider.** `pg_advisory_xact_lock` sobre
   `'taba.rider_capacity:' || rider_user_id`, tomado **antes** de contar y antes
   de bloquear cualquier fila. Dos aceptaciones simultáneas del mismo Rider se
   ordenan; la segunda recuenta y ve 3.
2. **Invariante de tabla.** Un trigger `before insert or update` en
   `public.orders` recuenta cuando una fila *entra* al conjunto activo con un
   rider, y aborta si el resultado pasaría de 3. Cubre `accept_rider_order_offer`,
   `assign_order_rider`, `claim_delivery_order`, `release_or_reassign_delivery` y
   cualquier `UPDATE` suelto. **La capacidad no la garantiza una función: la
   garantiza la tabla.** Una RPC nueva que se olvide del lock sigue sin poder
   crear un 4/3.

El trigger toma el lock sólo cuando la fila entra al conjunto contado, no en
cada `UPDATE`, y siempre en el mismo orden (advisory de rider → fila de pedido),
que es el orden que usan las RPC.

### `manualAssignmentOnly` ≠ un solo pedido activo

Se separan explícitamente. `manualAssignmentOnly` sigue significando **no hay
auto-despacho**: ninguna oferta nace sola, siempre la origina una persona del
Panel. La cantidad de pedidos activos la gobierna `rider_max_active_orders()`,
que es otra cosa y vive en otro lado.
