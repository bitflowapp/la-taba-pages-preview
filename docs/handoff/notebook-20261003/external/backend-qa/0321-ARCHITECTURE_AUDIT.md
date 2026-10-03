# TABA Gate 1 — Auditoría de arquitectura de pedidos

Worktree: `C:\1212\la-taba-real-orders-staging` · rama `staging/real-orders-walter` ·
base `2e5f02b5d201f9addbe6d1d1a8f8b5aa900bbde0`.
Supabase staging: `la-taba-staging` (`ukxqbgswjlibmnjemrzd`), `ACTIVE_HEALTHY`, PostgreSQL 17.6.

Método: lectura de las 19 migraciones locales (7.693 líneas SQL) **más** verificación contra
la base real de staging (`supabase db dump` del esquema desplegado + consultas de sólo lectura).
No se asumió que lo existente fuera seguro: cada hallazgo se contrastó con el esquema realmente
aplicado, no con la intención de la migración.

## 0. Estado de partida (verificado en staging, no inferido)

| Hecho | Valor |
|---|---|
| Migraciones locales | 19 |
| Migraciones aplicadas en remoto | 19 — **local y remoto en sync**, sin drift |
| Negocios | 1 |
| Productos | 8, todos `catalog_origin='demo_fixture'`, verificados/activos/disponibles |
| Pedidos | 2 — `LT-0001=delivered`, `LT-0002=on_the_way` |
| Eventos de pedido | 19 |
| Clientes | 7 |
| Roles de miembros | `owner`, `rider` |

Los 2 pedidos existentes ya recorrieron el ciclo completo (incluido `delivered` con confirmación
de código de entrega), así que el motor actual **no es teórico: ya operó de punta a punta**.

## 1. Tablas y relaciones reales

- `businesses` — estado (`open/paused/closed`), `ordering_verified`, `ordering_enabled`,
  `delivery_enabled`, `pickup_enabled`, `currency_code`, `delivery_fee`,
  `minimum_delivery_subtotal`, política de alcohol (`alcohol_sales_enabled`,
  `alcohol_minimum_age`, ventana horaria + timezone).
- `business_members` — `(business_id, user_id, role)` con roles `owner|admin|staff|rider`.
- `products` — `business_id`, `sku`, `price`, `stock`, `is_active`, `is_verified`, `available`,
  `is_alcoholic`, `minimum_age`, `catalog_origin`
  (`commercial|demo_fixture|test_only|staging_only`).
- `orders` — FK a `businesses`; `customer_user_id` → `auth.users`; `code`/`public_code`;
  `status`; `delivery_mode`; `client_request_id` + `client_request_fingerprint`;
  totales (`subtotal`, `delivery_fee`, `total`); `assigned_rider_user_id`;
  `inventory_released_at`; sellos por estado (`accepted_at`, `preparing_at`, `ready_at`,
  `dispatched_at`, `arrived_at`, `delivered_at`).
- `order_items` — `order_id`, `product_uuid` (FK), snapshot de `name`/`unit`/`unit_price`/`subtotal`.
- `order_events` — `order_id`, `business_id`, `actor_user_id`, `actor_role`, `event_type`,
  `message`, `metadata`, `created_at`.
- `order_public_tokens` — `token_hash` (SHA-256), `expires_at`, `revoked_at`.
- `order_delivery_handoffs` — código de entrega hasheado + verificación.
- `rider_locations` — GPS, `source='gps'` forzado, sello de tiempo de servidor por trigger.
- `catalog_assets`, `customers`, `customer_addresses`, `order_abuse_events`, `riders` (legacy).

## 2. RPCs existentes (todas `SECURITY DEFINER` con `search_path` fijo)

| RPC | Rol |
|---|---|
| `create_order_with_items(jsonb)` | Wrapper: llama al core y emite el código de entrega |
| `create_order_with_items_core(jsonb)` | **Creación transaccional real del pedido** |
| `change_order_status(uuid, text, text)` | **Transición de estado con CAS** |
| `claim_available_rider_order(...)` | Toma de pedido por rider |
| `assign_order_rider(...)` | Asignación por el negocio |
| `publish_rider_location(...)` | GPS del rider |
| `issue_order_delivery_code(...)` / `confirm_order_delivery(...)` | Código de entrega |
| `get_public_order_tracking(text)` | Tracking público por token |
| `recover_order_tracking_access(uuid, text)` | Rotación de token perdido |
| `list_available_rider_orders(uuid)` / `list_active_business_riders(uuid)` | Directorios acotados |
| `revoke_public_tracking(uuid)` | Revocación |
| `release_expired_stock_reservations(int)` | Liberación de reservas vencidas |
| `import_qa_fixture_catalog(...)` / `publish_qa_fixture_product(...)` | Catálogo QA staging |
| `import_catalog_batch(...)` / `stage_catalog_products(...)` / `publish_catalog_product(...)` | Catálogo comercial |
| `can_access_order`, `has_business_role`, `is_business_member`, `is_assigned_rider` | Helpers de autorización |

Todas las RPC sensibles tienen `revoke all ... from public, anon, authenticated` seguido de
`grant execute ... to authenticated`. No hay RPC de pedido ejecutable por `anon`.

## 3. Policies RLS — verificadas contra la base desplegada

RLS está habilitado en las 14 tablas de dominio. Matriz real de policies en staging:

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `orders` | ✅ `can_access_order(id)` | ❌ | ❌ | ❌ |
| `order_items` | ✅ vía orden | ❌ | ❌ | ❌ |
| `order_events` | ✅ vía orden | ❌ | ❌ | ❌ |
| `order_delivery_handoffs` | ❌ (RLS on, 0 policies) | ❌ | ❌ | ❌ |
| `rider_locations` | ✅ operadores | ✅ rider asignado | ❌ | ❌ |
| `products` | ✅ públicos + equipo | ✅ equipo | ✅ equipo | ❌ |
| `businesses` | ✅ activos | ❌ | ✅ owner | ❌ |
| `business_members` | ✅ | ✅ admin | ✅ admin | ✅ admin |
| `customers` / `customer_addresses` | ✅ propio | ❌ | ❌ | ❌ |

**Hallazgo positivo y verificado**: `orders`, `order_items` y `order_events` **no tienen
ninguna policy de escritura**. Con RLS habilitado y cero policies de INSERT/UPDATE/DELETE, la
escritura directa desde el cliente está denegada por defecto. El requisito del Gate
("la UI no puede modificar estados mediante UPDATE directo") **ya se cumple estructuralmente**,
no por convención de código sino por ausencia de policy. La única vía de escritura es RPC
`SECURITY DEFINER`. `order_delivery_handoffs` es aún más estricta: RLS activo sin policies,
o sea inaccesible incluso para lectura directa.

## 4. Creación actual del pedido — `create_order_with_items_core`

Contrastada línea por línea contra los requisitos del Gate §2:

| Requisito Gate §2 | Estado | Evidencia |
|---|---|---|
| Requiere auth | ✅ | `if v_customer_user_id is null then raise ... 42501` |
| Deriva `customer_id` de `auth.uid()` | ✅ | `v_customer_user_id uuid := auth.uid()`; `customer_user_id` **no** está en la whitelist de claves del payload |
| Valida negocio | ✅ | `is_active`, `status='open'`, `ordering_verified`, `ordering_enabled`, `currency_code`, modo delivery/pickup habilitado |
| Valida dirección | ✅ | `customer_street_address` obligatorio si `delivery_mode='delivery'` |
| Recibe SKU/cantidad, nunca precios | ✅ | Cada item acepta **sólo** `product_id` y `quantity`; cualquier otra clave aborta |
| Precio y disponibilidad en servidor | ✅ | `select p.* ... for update`; usa `v_product.price`; exige `is_active/is_verified/available/stock not null/price>0` |
| Atómico (pedido + ítems + snapshots + primer evento) | ✅ | Una sola función plpgsql; inserta `orders`, `order_items` (con snapshot de nombre/precio/unidad), `order_events('order.received')` y `order_public_tokens` |
| `idempotency_key` única por cliente | ✅ | `client_request_id` + `client_request_fingerprint` (SHA-256 del intent normalizado) |
| Devuelve el mismo pedido al repetir | ✅ | Rama `if found then ... return v_result` |
| Impide pedidos parciales | ✅ | Transacción única; cualquier `raise` revierte todo |
| Impide cantidades inválidas | ✅ | Regex `^[1-9][0-9]*$`, máx. 1000 por producto, 1–100 ítems |
| Impide productos inexistentes | ✅ | `where p.id = ... and p.business_id = ...` → `23503` si no existe |

Defensas adicionales ya presentes (no pedidas explícitamente por el Gate pero relevantes):

- **Anti-deadlock**: los productos se bloquean con `for update` en orden determinista de UUID;
  las líneas duplicadas del mismo producto se agregan antes de validar y descontar stock.
- **Serialización de reintentos**: `pg_advisory_xact_lock(hashtext(business_id), hashtext(client_request_id))`
  antes del `select ... for update` sobre la orden existente. Una colisión de hash sólo reduce
  concurrencia; no puede fusionar pedidos porque la búsqueda exacta sigue mandando.
- **Reutilización de key con payload distinto**: si el `fingerprint` no coincide, aborta con
  `23505` en vez de devolver silenciosamente un pedido que no corresponde al carrito actual.
- **Robo de key**: si el `client_request_id` existe pero pertenece a otro `customer_user_id` o
  a otro `tracking_token`, aborta.
- **Política de alcohol**: exige `age_confirmed`, edad mínima configurada, y ventana horaria del
  negocio (soporta ventanas que cruzan medianoche).
- **Mínimo de delivery**: valida `subtotal >= minimum_delivery_subtotal`.

**Política de stock actual (documentada, no inventada)**: descuento inmediato en el momento de
crear el pedido — `update products set stock = stock - qty, available = (stock - qty) > 0`.
La reposición ocurre sólo en cancelación/rechazo **anteriores al despacho**
(`current_status not in ('picked_up','on_the_way','arrived')`) y una única vez, protegida por
`inventory_released_at`. Después del despacho el stock **no** se repone automáticamente, con el
criterio explícito de que la mercadería ya no está físicamente en el local y su reingreso exige
un ajuste humano de inventario. `available` se recalcula fail-closed en ambos sentidos.
Es la política más segura compatible con el esquema actual y se conserva sin cambios.

## 5. Máquina de estados actual — `change_order_status`

CAS real: recibe `p_expected_status` y aborta con `40001` si el estado actual no coincide
(protege doble toque y eventos atrasados). Bloquea la fila con `for update`. Valida rol vía
`has_business_role`. Un rider no puede tocar un pedido asignado a otro rider. Un pedido `pickup`
no admite operación de rider.

Vocabulario **real en la base** vs. el pedido por el Gate:

| Gate §3 | Estado en DB | Alias existente |
|---|---|---|
| `submitted` | `received` | ✅ `received ↔ submitted` |
| `accepted` | `accepted` | — |
| `preparing` | `preparing` | — |
| `ready_for_pickup` | `ready` | ❌ **sin alias** |
| `assigned` | `assigned` | — |
| `on_the_way` | `on_the_way` | — |
| `arriving` | `arrived` | ✅ `arriving ↔ arrived` |
| `delivered` | `delivered` | — |
| `cancelled` | `cancelled` | ✅ `canceled ↔ cancelled` |

La constraint `orders_status_check` acepta ambos vocabularios. El estado extra `picked_up`
existe en DB y no está en la lista del Gate; `rejected` también.

## 6. Realtime y recuperación

- Suscripción: `js/repositories/supabase_order_repository.js` → `createRealtimeWatch` con
  `postgres_changes` sobre `orders` filtrado por `id`/`public_code` (cliente) o `business_id`
  (negocio), más `initialTask` (snapshot al abrir) y `fallbackTask` (re-consulta periódica
  acotada, no polling agresivo).
- Un cambio Realtime **no trae el estado**: dispara `refresh()`, que re-consulta PostgREST.
  Es decir, Realtime ya se usa como señal y PostgreSQL como autoridad. ✅
- Para acceso por `tracking_token` el watch cae a `pollingOnly`, con un motivo correcto y
  documentado: el navegador no puede enviar headers por WebSocket, así que un canal Realtime
  quedaría `SUBSCRIBED` sin recibir nada por RLS.
- Ganchos de recuperación (`visibilitychange`, `pageshow`, `online`) existen en `js/app.js`,
  `js/tracking/customer_tracking_poll.js` y el repositorio sandbox.

## 7. Rider, GPS, tracking y código de entrega

- GPS: sólo el rider asignado puede insertar; `source='gps'` forzado por constraint; el sello
  temporal lo pone el servidor por trigger (`stamp_rider_location_server_time`).
- Purga terminal: trigger `orders_purge_terminal_rider_locations` borra el GPS exacto al llegar
  a estado terminal.
- Código de entrega: hasheado, con expiración acotada (≤48 h) y trigger
  `orders_require_verified_delivery_code` que **impide** marcar `delivered` sin verificación.
- Tracking público: token hasheado SHA-256, expiración 30 días, revocable; DTO terminal mínimo
  sin PII ni IDs administrativos.

## 8. Riesgos: duplicación, carreras y eventos fuera de orden

### R1 — Sin `revision`/`sequence` monótono (CRÍTICO, es el gap real del Gate)

**No existe ninguna columna `revision` ni `sequence`** en `orders` ni en `order_events`
(verificado sobre el esquema desplegado, no sólo sobre las migraciones). El ordenamiento de
versiones depende íntegramente de marcas de tiempo:

- `js/core/realtime-sync.js` → `orderTimestamp()` toma el `Math.max` de `createdAt` y los `at`
  del `statusHistory`, y `shouldReplaceOrder()` compara con `>` estricto.
- Consecuencia: **dos actualizaciones con la misma marca de tiempo son indistinguibles**, y la
  segunda se descarta silenciosamente por el `>` estricto.

Esto **no es teórico**. En los 19 eventos reales de staging hay **3 colisiones exactas de
`created_at`** (~16 %), incluidas dos del mismo pedido al mismo microsegundo:

```
2026-08-01 01:25:51.070103+00  order.status_changed
2026-08-01 01:25:51.070103+00  order.rider_claimed
2026-08-01 01:25:53.076168+00  order.status_changed
2026-08-01 01:25:53.076168+00  order.delivery_handoff_confirmed
```

Ocurre porque varios eventos se escriben dentro de la **misma transacción**, y `now()` en
PostgreSQL es constante durante toda la transacción. No es un problema de resolución del reloj:
es estructural, y ninguna precisión adicional lo arregla. Un cliente que reciba estos eventos
desordenados no puede reconstruir cuál fue el último.

Riesgo derivado: un cliente que perdió eventos y re-sincroniza puede quedarse con un estado
viejo si su copia local tiene el mismo timestamp que la del servidor. Es exactamente lo que el
Gate §4 pide evitar con "ignorar revisiones antiguas".

### R2 — `ready` sin alias a `ready_for_pickup` (MEDIO)

El adaptador de estados cubre `received↔submitted` y `arriving↔arrived`, pero **no**
`ready↔ready_for_pickup`. Un cliente que hable el vocabulario del Gate y mande
`ready_for_pickup` recibe `estado destino invalido` (`22023`). Inconsistencia de contrato.

### R3 — `order_events` sin orden total (MEDIO)

`order_events_order_created_idx` ordena por `(order_id, created_at desc)`. Con timestamps
empatados el orden entre eventos de la misma transacción es **no determinista** — depende del
plan de ejecución. Reproducir la historia de un pedido puede dar resultados distintos entre
consultas.

### R4 — Reposición de stock post-despacho (BAJO, decisión deliberada)

Cancelar después de `picked_up` no repone stock. Es la decisión correcta y está comentada en el
código, pero deja una brecha operativa que exige ajuste manual. Se documenta, no se cambia.

### R5 — Sin límite de pedidos pendientes por cliente (BAJO)

`.env.example` reserva `TABA_MAX_PENDING_ORDERS_PER_CUSTOMER` y
`TABA_ORDER_RATE_LIMIT_PER_10_MINUTES`, pero no hay enforcement en la RPC. La idempotencia
frena el reenvío del *mismo* carrito; no frena N carritos distintos. Fuera del alcance del
Gate 1 (no pide rate limiting), se registra como pendiente.

## 9. Conclusión de la auditoría

El motor existente cubre **ya** casi todo lo que pide el Gate 1: creación idempotente real,
precios de servidor, atomicidad, CAS por estado, validación de rol, RLS fail-closed sin
escritura directa, Realtime como señal y no como autoridad, y catálogo QA de staging con
provenance separada.

El gap sustantivo y verificado es **R1**: no hay versión monótona de pedido. Todo el
ordenamiento de versiones —backend e interfaz— descansa en timestamps que ya colisionan en
producción de staging con una tasa medida del 16 %. Ése es el trabajo central de este gate;
**R2** y **R3** se resuelven en el mismo movimiento.
