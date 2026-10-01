# Contratos y esquema reales — backend La Taba (staging, ledger 157 = repo)

Todo lo de este archivo se leyó del STAGING REAL (`pg_get_functiondef`, `pg_policies`,
`information_schema`) con el rol `supabase_read_only_user`, después de llevar staging a
paridad con `main`. No es inferencia de código: es lo desplegado.

Tipos de evidencia usados en este directorio:

| Etiqueta | Qué es |
|---|---|
| `STAGING_REAL_EXECUTION` | llamada real a PostgREST/GoTrue de staging con la sesión del actor |
| `DB_OBSERVER` | lectura SQL de sólo lectura (`supabase_read_only_user`, Management API) |
| `STATIC_INSPECTION` | lectura de definiciones desplegadas (este archivo) |

## 1 · Superficies y capas

No hay Edge Function en el camino de un pedido con pago manual. Todo es
PostgREST (RPC `SECURITY DEFINER` + RLS) y GoTrue.

| Capa | Contrato | Quién |
|---|---|---|
| Cliente (storefront) | `auth.signInAnonymously` → `upsert_current_customer_profile(p_name,p_phone)` → `upsert_current_customer_address(p_address jsonb)` → `create_order_with_items(payload jsonb)` | sesión anónima (rol `authenticated`, `is_anonymous`) |
| Tracking cliente | `get_public_order_tracking(p_public_id)` con header `x-order-token` (se guarda sólo el sha256 en `order_public_tokens`) | `anon`/`authenticated` |
| Código de entrega | `issue_order_delivery_code(p_order_id,p_tracking_token)` | el cliente dueño del pedido + token |
| Panel (bandeja) | `from('orders').select('*,order_items(*),order_combos(*)').eq('business_id').eq('origin','production').in('status', BUSINESS_INBOX_DATABASE_STATUSES)` — `js/repositories/supabase_order_repository.js::fetchBusinessOrderSnapshot` | owner/admin/staff con sesión de identidad |
| Panel (auditoría) | `from('order_events').select('order_id,sequence,event_type,type,metadata,payload,created_at')` — `fetchOrderEvents` | idem |
| Panel (operación) | `transition_order(p_order_id,p_expected_revision,p_new_status,p_idempotency_key)`, `cancel_order(...)`, `confirm_manual_order_payment(...)`, `reverse_manual_order_payment(...)` (owner/admin), `offer_order_to_rider(p_order_id,p_expected_status,p_expected_rider_user_id,p_new_rider_user_id)`, `list_business_rider_availability(p_business_id)`, `classify_order_as_qa(p_order_id,p_reason)` (owner/admin), `apply_inventory_movement(...)` | idem |
| Rider (app Android) | `identity_register_session(...,'rider_android',...)`, `get_rider_delivery_board()`, `set_rider_availability(p_business_id,p_available,p_expected_version,p_idempotency_key)`, `heartbeat_rider_availability(p_business_id)`, `accept_rider_order_offer(p_offer_id,p_expected_version,p_idempotency_key)`, `mark_delivery_picked_up` / `start_rider_delivery` / `mark_rider_arrived` `(p_order_id,p_expected_revision,p_idempotency_key)`, `publish_rider_location_fanout(...)`, `confirm_delivery_code(p_order_id,p_expected_revision,p_delivery_code,p_idempotency_key)`, `identity_close_own_session(p_business_id)` | miembro `rider` con sesión de identidad |
| Identidad | `identity_register_session(p_business_id,p_client,p_device_label,p_device_key_hash,p_app_version)`; `has_business_role()` exige membresía activa + sesión registrada no revocada (`identity_member_role`) | todos los operadores |

## 2 · Tablas del pedido (columnas relevantes)

- `orders`: `id`, `business_id`, `public_code`/`code` (`LT-NNNN`), `status`, `revision` (bigint, sube en cada UPDATE real; no sube al reclasificar `origin`), `delivery_mode`, `payment_method`, `manual_payment_status`, `subtotal`, `delivery_fee`, `total`, `customer_user_id`, `client_request_id` + `client_request_fingerprint` (idempotencia), `assigned_rider_user_id`, `origin` (`production`/`qa`), `origin_reason`, `inventory_released_at`, marcas `accepted_at/preparing_at/ready_at/picked_up_at/dispatched_at/arrived_at/delivered_at/cancelled_at`, instantánea de entrega `delivery_latitude/longitude/location_source/location_confirmed_at/zone_*`.
- `order_items`: `order_id`, `product_uuid`, `name`, `quantity`, `unit_price`, `subtotal` (precio congelado al crear).
- `order_events`: `order_id`, `sequence`, `event_type`, `actor_role`, `actor_user_id`, `metadata`, `created_at`.
- `order_public_tokens`: `order_id`, `token_hash`, `expires_at`, `terminal_visible_until` (el token en claro no se guarda).
- `order_delivery_handoffs`: `order_id`, `code_hash` (bcrypt), `code_ciphertext` (pgp con el token), `failed_attempts`, `locked_until`, `confirmed_at`.
- `rider_order_offers` (oferta con `version` y `expected_order_revision`), `rider_availability` (`available`, `version`, `last_seen_at`; presencia efectiva = `available` y latido ≤ 90 s), `rider_locations` (se purga al llegar a estado terminal), `rider_delivery_operations` (recibos idempotentes del rider).
- `business_command_receipts` (recibos idempotentes del Panel), `inventory_movements` (ledger de stock), `inventory_reservations` (sólo camino Mercado Pago / `checkout_sessions`; el pago manual no reserva: descuenta al crear).
- `notification_outbox`, `delivery_outbox`: se escriben; NO existe consumidor (ni función, ni Edge Function, ni servicio).

## 3 · Creación: `create_order_with_items(payload)`

Capas: `create_order_with_items` (punto de entrega confirmado) → `create_order_with_items_profile_v2` → `..._profile_v1` → `create_order_with_items_core`.

- Lista blanca de claves; cualquier otra → `22023` (el navegador no puede mandar precio, envío ni total).
- `quantity` debe cumplir `^[1-9][0-9]*$` y ≤ 1000 → 0 y negativos `22023`.
- Idempotencia: `pg_advisory_xact_lock(hashtext(business), hashtext(client_request_id))`, búsqueda del pedido existente `FOR UPDATE`; si coinciden hash del token + cliente + huella → devuelve el MISMO pedido; token/cliente distinto o huella distinta → `23505`.
- Negocio: activo, `open`, `ordering_verified`, `ordering_enabled`, canal habilitado, `business_is_open(...)` → si no `55000`.
- Producto (bloqueo en orden de UUID): inexistente `23503`; inactivo/no verificado/no disponible `55000`; `stock < qty` → `23514`.
- Delivery: zona por `resolve_delivery_zone`; fuera de zona `55000`; bajo el mínimo `23514`; punto no confirmado `22023`.
- Efectos: `orders` (`status='received'`), `order_items`, `products.stock -= qty` (y `available = stock>0`), evento `order.received`, `order_public_tokens` (hash), y por trigger `notification_outbox('new_order')`.
- `payment_method in ('cash','coordinate')` → `manual_payment_status='pending'`.

## 4 · Máquina de estados real (`change_order_status`)

```
received(submitted) ─negocio→ accepted ─negocio→ preparing ─negocio→ ready
ready ─oferta del negocio + accept del rider→ assigned ─rider→ picked_up ─rider→ on_the_way ─rider→ arrived ─rider + código→ delivered
ready(pickup) ─negocio→ delivered          ready(delivery, sin rider) ─negocio→ on_the_way (reparto propio)
cualquier no-terminal ─negocio→ cancelled   received ─cliente→ cancelled   received ─negocio→ rejected
```

- Conflicto de revisión o de estado esperado → `PT409` (HTTP 409, sin reintento de PostgREST; antes de la migración 20260924200000 era `40001`).
- Arista no permitida → `23514`; estado desconocido → `22023`; sin rol → `42501`; pedido inexistente → `P0002`.
- `transition_order` (4 args) guarda un recibo en `business_command_receipts`: misma clave + mismo hash → resultado guardado con `idempotent_replay:true`; misma clave + otro payload → `23505`; mismo estado → `idempotent_no_op:true` sin evento ni revisión.
- Cancelación/rechazo antes de `picked_up` devuelve stock una vez (`inventory_released_at`).
- `delivered` exige código confirmado (`prevent_unverified_delivery` / `confirm_delivery_code`).

## 5 · Rider

- La oferta la crea el negocio (`offer_order_to_rider`); con `rider_presence_required` el rider debe tener presencia efectiva. Una sola oferta `pending` por pedido (`already_offered` / `offer_in_flight`).
- `accept_rider_order_offer` valida dueño de la oferta, versión, capacidad (`rider_max_active_orders = 3`), revisión del pedido; pasa el pedido a `assigned`.
- Pasos del rider devuelven `{ok:false, code:'not_assigned'|'stale_revision'|...}` (no excepción) y guardan recibo por `(order, rider, operation, idempotency_key)` → reintento con la misma clave = `idempotent_no_op:true`.
- `confirm_delivery_code`: código incorrecto → `incorrect_code` y contador (5 fallos → bloqueo temporal exponencial); correcto → `delivered`; repetido tras entregar → `already_delivered` (no-op idempotente, sin segundo evento).

## 6 · Lectura (RLS)

- `orders` / `order_items`: `can_access_order(id)` = cliente dueño, o miembro owner/admin/staff con sesión, o rider ASIGNADO mientras el pedido está `assigned|picked_up|on_the_way|arrived`.
- `order_events`: sólo owner/admin/staff. `rider_locations`, `rider_order_offers`, `order_public_tokens`: sin acceso directo (sólo RPC).
- `products`: lectura pública sólo de verificados, disponibles y con stock de un negocio abierto; columnas `unit_cost` y `verified_by` no son legibles por `anon`/`authenticated`.
- Tracking público: sin PII (ni nombre, ni teléfono, ni dirección, ni ids), GPS redondeado a 4 decimales con precisión mínima publicada de 100 m; token inválido → `null`.
