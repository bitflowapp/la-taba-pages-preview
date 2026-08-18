# Configuración comercial · estado real y lo que hay que poner

## Lo que hay hoy en producción (medido, no heredado del informe anterior)

| campo | valor |
|---|---|
| `status` / `is_active` | `open` / `true` |
| `ordering_enabled` | **false** |
| `ordering_verified` | **false** |
| `currency_code` | **null** |
| `operating_timezone` | **null** |
| `address` | **null** |
| `delivery_enabled` | **false** |
| `pickup_enabled` | **false** |
| `delivery_fee` / `minimum_delivery_subtotal` | **null** / **null** |
| `hours_enforced` / `delivery_zone_enforced` | `false` / `false` |
| horarios · zonas | 0 · 0 |

El comercio es la fila que creó la migración: nombre y estado, nada más.

## El contrato que gobierna la apertura

`businesses_ordering_verified_configuration` — `ordering_verified` sólo puede
ser `true` si:

* `ordering_verified_at` **y** `ordering_verified_by` no son nulos;
* `currency_code` matchea `^[A-Z]{3}$`;
* hay delivery **o** pickup habilitado;
* y si hay delivery: `delivery_fee` **y** `minimum_delivery_subtotal` no nulos.

Y la política que hace visibles los productos al Customer exige **las dos
banderas**: `ordering_verified` **y** `ordering_enabled`, con el negocio
`is_active` y `status='open'`.

O sea que `ordering_enabled=true` **solo no alcanza**: sin `ordering_verified`
la vitrina sigue vacía.

## Dirección · encontrada, no inventada

`data/business-location.json` es el **contrato central de ubicación** del
proyecto —«la única fuente de verdad geográfica del comercio», de la que derivan
web, Panel, tracking y la app del Rider—:

| | |
|---|---|
| dirección | **Mendoza 827, Neuquén** |
| completa | Mendoza 827, Neuquén Capital, Neuquén, Argentina |
| coordenadas | **-38.9460616, -68.0533209** |
| fuente | `public_directory_cross_checked` · confianza alta · ±20 m |
| contrastada contra | ficha comercial (nombre + dirección + Plus Code + CID), geocodificación directa (7 m), interpolación catastral OSM (18 m), recomputación del Plus Code, vista satélite y reverse geocoding |
| descartados | 5 puntos, con distancia y motivo cada uno |

No es un fixture: tiene `business_id` y su propio gate en `npm run check`.

**Residuo declarado (P2):** `human_verified: false`. Nadie confirmó el pin contra
la puerta del local. El propio contrato dice que para pasar a `business_verified`
hace falta esa confirmación humana. No bloquea el piloto —el origen del mapa
queda a ±20 m— pero es una tarea física pendiente.

## Lo que hay que escribir para abrir

| campo | valor | de dónde sale |
|---|---|---|
| `currency_code` | `ARS` | lo pidió Marco |
| `operating_timezone` | `America/Argentina/Buenos_Aires` | lo pidió Marco |
| `delivery_enabled` | `true` | lo pidió Marco |
| `delivery_fee` | `0` | piloto, lo pidió Marco |
| `minimum_delivery_subtotal` | `0` | piloto, lo pidió Marco |
| `address` | `Mendoza 827, Neuquén` | contrato de ubicación |
| `ordering_verified_at` / `_by` | ahora / **una persona** | ver `GO-LIVE-STATE.md` |

## Enforcement apagado: decisión, no descuido

`hours_enforced=false` y `delivery_zone_enforced=false` quedan **como están**.
No se inventa ni un horario ni un polígono para desbloquear el piloto.

Consecuencia real, y por eso se documenta: con las dos en `false` el comercio
acepta pedidos **a cualquier hora y desde cualquier distancia**. Para un piloto
de un pedido, con el dueño mirando, es aceptable. Para operación abierta no lo
es. **P1 antes de publicitar la tienda.**
