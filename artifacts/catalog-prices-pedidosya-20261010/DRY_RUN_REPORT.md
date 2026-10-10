# DRY_RUN_REPORT — precios PedidosYa 2026-10-10

**Tipo de prueba:** SIMULACIÓN LOCAL en Python sobre el snapshot `PRICE_BACKUP.json` (producción, 72 filas). **No se ejecutó nada contra PostgreSQL** ni en producción ni en staging. El RPC real requiere sesión owner/admin (`auth.uid()`), que no está disponible desde el CLI.

**Reglas simuladas (leídas de las migraciones):**

- `products_fail_close_master_change` (`20260725110000`): cambiar `price` de un producto con `is_verified=true` ⇒ `available=false`, `is_verified=false`, `verified_at=null`, `verified_by=null`.
- `apply_commercial_catalog_batch` (`20260928160000` y previas): `v_was_published = is_verified AND available`; republica sólo si era publicado y pasa las compuertas. Omitir `stock`/`publish` conserva el valor.

## Cambios simulados

| SKU | Precio antes | Precio después | verified antes→después | available antes→después | republicado |
|---|---|---|---|---|---|
| `andes-origen-rubia-lata-473ml` | 2650.00 | 3840.00 | true→false | false→false | no |
| `stella-artois-lata-473ml` | 3600.00 | 4635.00 | true→false | false→false | no |
| `budweiser-lata-473ml` | 2350.00 | 3345.00 | true→false | false→false | no |
| `quilmes-stout-lata-473ml` | 2050.00 | 2999.00 | true→false | false→false | no |
| `fernet-1882-750ml` | 8950.00 | 11880.00 | true→false | false→false | no |
| `fernet-branca-1000ml` | 26250.00 | 27585.00 | true→false | false→false | no |
| `gancia-lima-limon-lata-473ml` | 2550.00 | 3239.00 | true→false | false→false | no |

## Invariantes

- [x] Filas totales sin cambios de cantidad (72) — OK
- [x] Exactamente 7 filas con precio distinto — OK
- [x] Ninguna fila cambia stock — OK
- [x] Ninguna fila cambia nombre/SKU/categoría/imagen — OK
- [x] Ninguna fila cambia price_status — OK
- [x] Ninguna fila queda disponible tras el cambio (available antes = false en los 7) — OK
- [x] Ningún producto queda disponible que no lo estaba — OK
- [x] Ningún precio propuesto es <= 0 — OK
- [x] Republicación automática (RPC) ocurre en 0 filas — OK
- [ ] Pedidos históricos: NO verificado en esta simulación (no se leyeron órdenes; falta confirmar que las órdenes guardan su importe propio)

## Efecto que hay que aprobar

Los 7 productos quedan **fuera de la tienda pública** (la vidriera sólo lee `is_verified = true`, ver `js/repositories/supabase_order_repository.js` ~L718) hasta que un owner los vuelva a verificar con `publish_catalog_product`. Como hoy ninguno está disponible (compuerta de licencia del alcohol), **no se pierde venta**, pero sí visibilidad. Es un paso humano obligatorio, no una falla.

**RESULTADO DRY-RUN: PASS** (los 9 invariantes verificados; el de pedidos históricos queda pendiente) (simulación; no reemplaza una prueba contra base real).

## Reversión

`PROPOSED_RPC_BATCH.json` incluye `reversion_rows` con los precios anteriores. Revertir = aplicar esas filas con el mismo RPC; el RPC vuelve a dejar el producto no verificado, así que la reversión también exige re-verificación. Alternativa: restaurar desde `PRICE_BACKUP.json` en una transacción.
