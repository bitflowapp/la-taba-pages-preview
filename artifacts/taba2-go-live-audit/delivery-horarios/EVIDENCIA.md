# Auditoría READ-ONLY · Delivery y Horarios · La Taba (TABA2) producción

- **Fecha**: 2026-08-21 · **Worktree**: `D:\1212\la-taba2-gondola-retail-final` (main productivo `95ac129`)
- **Target**: Supabase `wwcpogltfgzgkrlilbcd` (producción) · business canónico `00000000-0000-4000-8000-000000000001` · https://la-taba.pages.dev
- **Método**: sólo `node scripts/consulta-solo-lectura.mjs --ref=produccion --sql="select ..."` (guarda que rechaza todo lo que no sea un único SELECT/WITH; verificada leyendo el script antes de usarlo) + lectura de código. **Cero mutaciones.** Las dos sondas de `commerce_availability` son SELECT sobre una función declarada `STABLE` (no puede escribir).
- Cada JSON de esta carpeta es la salida cruda de la consulta que lo nombra.

---

## 1 · Negocio y ubicación

**DB producción** (`business-row.json`):

| Campo | Valor |
| --- | --- |
| name / address | La Taba · **Mendoza 827, Neuquén** |
| status / is_active / ordering_enabled / ordering_verified | open / true / true / true |
| delivery_enabled / **pickup_enabled** | true / **false** |
| phone / whatsapp_phone | null / null |
| operating_timezone | **America/Argentina/Buenos_Aires** (sí está seteado) |

**Coordenadas**: `businesses` NO tiene columnas lat/lng (consulta `information_schema.columns`). La coordenada del local vive en dos lugares:

1. **Contrato del repo** — `js/core/business-location.js:23-34` y `data/business-location.json`: `-38.9460616, -68.0533209`, accuracy 20 m, `source: public_directory_cross_checked`, confidence high, **`human_verified: false`** (contrastada contra ficha de Google Maps + Plus Code 3W3W+HM + catastro OSM + satélite; ver `source_note`). Nadie la confirmó contra la puerta.
2. **DB producción** — `private.rider_map_business_locations`: **0 filas** (consulta directa y `counts-globales.json`). El punto del negocio NUNCA se cargó en producción. `scripts/set-pickup-point.mjs` (la herramienta que crea esa fila) está clavado a STAGING: `const REF = 'ukxqbgswjlibmnjemrzd'` (línea ~35) — no existe tooling apuntado a producción.

**¿Se dibuja el pin del negocio en el mapa del cliente?** **NO.** Cadena medida en código:

- `js/config.js:43` → semilla `businessLocationVerified: BUSINESS_LOCATION_IS_PLOTTABLE` = `true` (contrato ploteable).
- **PERO** `js/repositories/supabase_order_repository.js:534`: al hidratar la config del negocio desde Supabase (modo producción) escribe **`businessLocationVerified: false` hard-codeado**, pisando la semilla.
- `js/map/map_view.js:190`: `if (config.businessLocationVerified !== true) return null;` → sin pin.
- `js/ui.js:191-206` (`applyBusinessMapsLink`): mismo gate → el enlace a Google Maps también se oculta.

Conclusión: en producción el pin sigue bloqueado, y por partida doble: el hard-code `false` del repositorio y la ausencia total de fila `human_verified` en la DB. En modo demo sí se dibuja.

---

## 2 · Delivery

**Flags y valores en DB** (`business-row.json`):

| Campo | Valor |
| --- | --- |
| delivery_fee | **0.00** |
| minimum_delivery_subtotal | **0.00** |
| delivery_zone_enforced | **false** |
| delivery_max_radius_meters | **null** (sin tope) |
| Zonas cargadas (`delivery_zones`) | **0 filas** (en toda la DB, no sólo el negocio — `counts-globales.json`) |

**Quién puso 0/0** (`config-audit.json`): `business_config_audit` id 1, 2026-08-18 01:11:26Z, `actor_kind='service'` (script de plataforma, sin usuario), `before: {delivery_fee: null, minimum: null}` → `after: {delivery_fee: 0, minimum: 0}`. No fue una decisión del Panel con actor humano. (El `null` previo habría roto el checkout con «configuracion de delivery no verificada» — enforcement migration líneas 458-467 —, así que el 0/0 se puso para destrabar.)

**¿Qué pasa HOY con una dirección fuera de zona?** No existe «fuera de zona»:

- Código: `supabase/migrations/20260812210000_business_operations_resolution.sql:249-259` — con `delivery_zone_enforced=false`, `resolve_delivery_zone` devuelve `eligible=true` con el fee/mínimo del negocio **para cualquier punto del planeta**. El chequeo `OUT_OF_DELIVERY_ZONE` de los dos caminos de checkout (`20260812220000...sql:446-454` efectivo, `:1343-1346` MP) queda inerte.
- **Medido en vivo** (`commerce-availability-obelisco-1130km.json`): contexto lat/lng del Obelisco (Buenos Aires, ~1130 km) → `{"eligible": true, "delivery_fee": 0, "minimum_subtotal": 0, "is_open": true}`. Idéntico a la sonda sin dirección (`commerce-availability-sin-direccion.json`).

Los únicos gates de delivery vigentes hoy: pin confirmado en mapa (`DELIVERY_LOCATION_REQUIRED`, enforcement `:947-952`), banderas del negocio, stock/precio confirmado. El mínimo $0 siempre pasa.

**Radio máximo**: null. Además hoy **no se puede encender**: `resolution.sql:270-285` ancla el tope en `private.rider_map_business_locations` con `human_verified=true`; sin fila (caso actual) devolvería `max_radius_needs_point` y **negaría TODAS las entregas**. Primero la fila verificada, después el tope.

**Nota UX latente**: el mensaje de fuera-de-cobertura del carrito ofrece «Podés elegir retiro en el local» (`js/cart.js:528-529`), pero `pickup_enabled=false` en producción: cuando enciendan zonas, ese fallback será falso si pickup sigue apagado.

---

## 3 · Horarios

**DB** (`business-row.json`, `counts-globales.json`):

| Campo | Valor |
| --- | --- |
| hours_enforced | **false** |
| operating_timezone | America/Argentina/Buenos_Aires (ya configurado — audit id 2, mismo script 2026-08-18) |
| business_service_hours | **0 filas** |
| business_service_exceptions | **0 filas** |
| alcohol_hours_enforced | false (coherente: alcohol_sales_enabled=false, LICENSE GATE) |

**¿`hours_enforced=false` = siempre abierta?** **Sí, literalmente.** `resolution.sql:99`: `if not v_enforced then return true;` — `business_is_open` contesta `true` a cualquier hora, y `BUSINESS_CLOSED` (enforcement `:422-427` y `:1327-1334`) nunca dispara. Medido: `is_open: true`, `next_open_at: null`, `hours: []` (las franjas sólo se publican al cliente si la exigencia está encendida — `resolution.sql:413-420`; cargar filas sin encender la bandera tampoco mostraría nada).

**¿Qué ve un cliente a las 4 AM?** La tienda normal, comprable: catálogo, «envío $0 / mínimo $0» en la home (`js/ui.js:219-220`: con `orderingDetailsVerified=true` se muestra `money(0)`), sin cartel de cerrado, sin horarios (home header los oculta por el filtro de no-publicados `js/ui.js:276-281`; la ficha del negocio muestra el texto semilla «Horarios no publicados», `js/state.js:781` + `js/ui.js:225`). Puede confirmar el pin y completar un pedido en efectivo; queda `received` hasta que alguien lo mire. **Evidencia real**: el único pedido de producción (LT-0001) nació a las **00:25 hora local** (`orders-produccion.json`, created 2026-08-18 03:25Z).

**Veredicto**: aceptable para **piloto controlado** (clientes conocidos, expectativa gestionada por WhatsApp, el freno de emergencia es manual: `ordering_enabled`). **P1 bloqueante antes de publicidad/venta pública**: un desconocido que paga a las 4 AM y no recibe nada es un reclamo seguro. El costo de cerrar el gap es bajo: el huso ya está, las funciones ya están desplegadas; faltan filas de franjas + encender `hours_enforced` vía RPCs del Panel (sin deploy).

---

## 4 · Tracking / estados / cancelaciones

**Vocabulario en DB** (`orders-constraints.json`, `orders_status_check`): `received, accepted, preparing, ready, on_the_way, delivered, cancelled, rejected, draft, submitted, assigned, picked_up, arrived, arriving, canceled` (incluye legacy y doble grafía `canceled/cancelled`, normalizada por `normalize_order_status_vocabulary`).

**Máquina real** (`supabase/migrations/20260725030000_taba_production_orders.sql:~984-1046`):
- Negocio: `received|submitted → accepted|rejected|cancelled`; `accepted → preparing|cancelled`; `preparing → ready|cancelled`; `ready → delivered` (sólo pickup); cancelar desde cualquier estado no terminal.
- Rider (sólo delivery, sólo asignado): `ready → assigned|on_the_way`; `assigned → picked_up|on_the_way`; `picked_up → on_the_way`; `on_the_way → arrived|delivered`; `arrived → delivered`.
- Cliente: sólo cancelar en `received|submitted`.

**Cancelación con motivo — confirmado por código**: `20260814040000_paid_orders_require_payment_refund.sql:74-128` — `cancel_order(p_order_id, p_expected_revision, p_reason, p_idempotency_key)` exige motivo de **3-300 caracteres** (línea 92, «motivo de cancelacion requerido») y lo persiste como evento `business_cancel_reason` con `metadata.reason` (líneas 122-123). Los atajos sin motivo están revocados para clientes: `transition_order` y `change_order_status` sin EXECUTE para `authenticated` (líneas 137-138). Pedido cobrado por MP no admite cancelación genérica sin reversa financiera (trigger líneas 41-72). Todas las funciones existen en producción (`funciones-produccion.json`).

**Estado real de la DB** (`orders-produccion.json`, `order-events-lt-0001.json`): 1 solo pedido, **LT-0001**, efectivo, origin production, subtotal 17.100 / envío **0.00** / total 17.100, GPS confirmado, destino «Neuquén Capital». Circuito recorrido: received → accepted → preparing → ready → (oferta rider aceptada) assigned → picked_up → on_the_way… y ahí quedó: `order.rider_issue_reported` 2026-08-18 04:51Z y **sigue en `on_the_way` desde hace 3 días**, sin delivered ni cancelled. Cancelaciones en producción: 0 (nada que verificar en datos; el contrato queda verificado por código). Ningún pedido fue tocado en esta auditoría.

---

## 5 · Tarifas (sin inventar valores)

| Concepto | Valor real | Juicio |
| --- | --- | --- |
| Envío (negocio) | **$ 0.00** | **Sospechoso**: lo puso un script (`actor_kind=service`) el 18-08 para reemplazar null; se muestra al cliente en la home y se cobró $0 en LT-0001. Nadie del comercio lo decidió por Panel. |
| Mínimo de pedido | **$ 0.00** | Ídem. Con zonas apagadas el mínimo null rompería el checkout (enforcement `:465-467`), así que 0 fue el destrabe; falta la decisión comercial real. |
| Tarifas por zona | no existen (0 zonas) | — |
| Tope de radio | null | No encendible sin fila `human_verified` (negaría todo). |
| Mercado Pago | `business_payment_settings`: **0 filas** (`mp-settings.json`) | Producción vende **sólo efectivo** hoy; `create_checkout_session` fallaría con «Mercado Pago no esta configurado». Contexto, fuera del alcance delivery/horarios. |

---

## Clasificación

**P0 (impide vender hoy)** — ninguno en este dominio. La venta en efectivo funciona de punta a punta (LT-0001 lo demuestra). Las compuertas de enforcement están desplegadas y apagadas exactamente como se diseñaron (migración 20260812200000: «nada cambia hasta que alguien lo encienda»).

**P1 (cerrar ANTES de publicidad / venta pública)**
1. **Cobertura apagada y 0 zonas**: producción acepta delivery a cualquier punto del país — medido `eligible=true` con el Obelisco a 1130 km. Cargar zonas reales (RPCs del Panel) y encender `delivery_zone_enforced`.
2. **Horarios apagados y 0 franjas**: tienda abierta 24/7 sin aviso; pedido pagable a las 4 AM que nadie va a preparar. Cargar franjas y encender `hours_enforced` (huso ya listo).
3. **Envío $0 / mínimo $0 sin decisión comercial**: los puso un script de plataforma; hoy son la cara pública del precio de envío. Confirmar con el comercio (¿gratis de lanzamiento?) y asentarlo vía Panel (queda auditado con actor humano), o cargar la tarifa real.
4. **Ubicación del negocio inexistente en DB y sin verificación humana**: sin fila en `private.rider_map_business_locations` no hay pin del cliente (además del hard-code `repository:534`), no hay ancla del Rider ni tope de radio posible. Verificar el pin contra la puerta, cargarlo (`set-pickup-point.mjs` necesita variante para producción) y recién entonces evaluar levantar el hard-code.
5. **LT-0001 abierto hace 3 días** en `on_the_way` con incidencia de rider reportada: cerrarlo operativamente (delivered o `cancel_order` con motivo). Es el único pedido real y contamina cualquier métrica/vista de «en curso».

**P2**
- Fallback «elegí retiro en el local» del carrito con `pickup_enabled=false` (incoherencia latente al encender zonas).
- `phone`/`whatsapp_phone` null: cliente sin canal de contacto publicado.
- Vocabulario legacy en `orders_status_check` (draft, submitted, arriving, doble grafía) — deuda contenida por el normalizador.
- `order_rate_limit_per_10_minutes` null (sin límite de tasa por cliente).
- Cargar franjas sin encender la bandera no publica nada al cliente (`resolution.sql:420`): el encendido es publicación+exigencia juntas; documentarlo para quien opere el Panel.

---

## Índice de evidencia

| Archivo | Consulta / fuente |
| --- | --- |
| `business-row.json` | SELECT fila del negocio canónico |
| `counts-globales.json` | Conteos globales: 1 negocio, 0 horas, 0 zonas, 0 excepciones, 0 ubicaciones, 1 pedido |
| `config-audit.json` | `business_config_audit` (2 filas, actor service 2026-08-18) |
| `commerce-availability-sin-direccion.json` | Sonda STABLE sin contexto |
| `commerce-availability-obelisco-1130km.json` | Sonda STABLE con lat/lng Obelisco CABA |
| `orders-produccion.json` | Todos los pedidos del negocio (1: LT-0001) |
| `order-events-lt-0001.json` | Timeline de eventos de LT-0001 |
| `orders-constraints.json` | CHECKs de `orders` (status, fee, total) |
| `funciones-produccion.json` | Funciones de enforcement presentes en producción |
| `mp-settings.json` | `business_payment_settings` del negocio: vacío |

Código citado: migraciones `20260812200000`/`210000`/`220000`, `20260814040000`, `20260725030000`; `js/core/business-location.js`, `js/config.js`, `js/repositories/supabase_order_repository.js`, `js/map/map_view.js`, `js/ui.js`, `js/cart.js`, `js/state.js`, `js/core/commerce-availability-store.js`, `data/business-location.json`, `scripts/set-pickup-point.mjs`.
