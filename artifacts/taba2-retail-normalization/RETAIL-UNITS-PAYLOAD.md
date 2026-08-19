# TABA — payload de las 4 unidades minoristas, y el guard contra producción

Medido en vivo contra `wwcpogltfgzgkrlilbcd` el 2026-08-19 (sólo lectura,
`node scripts/aplicar-retail-unidades.mjs --ref=wwcpogltfgzgkrlilbcd`, sin
`--aplicar`). 0 escrituras. Nada de esto se ejecutó contra la base todavía.

## El payload exacto (`catalog/retail-unidades.mjs`)

| Campo | Coca-Cola Original | Coca-Cola Zero | Sprite | Fanta Naranja |
|---|---|---|---|---|
| sku / external_id | `coca-cola-original-pet-500ml` | `coca-cola-zero-pet-500ml` | `sprite-pet-500ml` | `fanta-naranja-pet-1500ml` |
| name | Coca-Cola Original | Coca-Cola Zero | Sprite | Fanta Naranja |
| brand | Coca-Cola | Coca-Cola | Sprite | Fanta |
| variante / presentación (Customer) | 500 ml | 500 ml | 500 ml | 1,5 L |
| capacity (interno) | 500 ml | 500 ml | 500 ml | 1500 ml |
| envase | Botella PET | Botella PET | Botella PET | Botella PET |
| GTIN | 7790895000782 | 7790895067532 | 7790895000829 | 7790895000454 |
| tipo de código | EAN-13 | EAN-13 | EAN-13 | EAN-13 |
| price | $2.290 | $2.290 | $2.290 | $4.990 |
| stock | 0 | 0 | 0 | 0 |
| available | false | false | false | false |
| sold_as_pack | false | false | false | false |
| units_per_pack | 1 | 1 | 1 | 1 |
| categoría | Gaseosas | Gaseosas | Gaseosas | Gaseosas |
| subcategoría | Cola | Cola sin azúcar | Lima limón | Naranja |
| imagen | fallback propio de TABA (las 6 columnas de imagen en null) | ídem | ídem | ídem |
| sort_order | 0 | 0 | 0 | 0 |
| business_id | `00000000-0000-4000-8000-000000000001` (las 4) | | | |
| hermano (pack, se conserva) | `coca-cola-original-botella-pet-500-ml-pack-x12` | `coca-cola-zero-botella-pet-500-ml-pack-x12` | `sprite-botella-pet-500-ml-pack-x12` | `fanta-naranja-botella-pet-1500-ml-pack-x6` |

Precios usados EXACTAMENTE como los dio el dueño: **no** se aplicó margen
adicional, **no** se multiplicó por 1,15, **no** se dividió el precio de
ningún pack.

**Por qué `stock = 0` y no `null`.** El contrato real de producción
(`products_verified_master_data`) exige `stock is not null` para que una fila
comercial pueda estar `is_verified = true`. No hay stock unitario real y
demostrable — no se prorrateó desde los packs — así que `0` es el único valor
que es a la vez cierto (nunca existió una línea de inventario separada para
la unidad) y compatible con dejar los datos maestros verificados.
`available` no se decide aparte: con `stock = 0`, el CHECK
`products_available_requires_verification` lo exige en `false`.

**Por qué `sort_order = 0`.** Los 4 packs hermanos ya ocupan `sort_order`
1..4 sin ningún hueco (no se les toca: packs modified = 0). `0` es el propio
valor por omisión de la columna, es `>= 0` (lo exige
`products_verified_numeric_ranges`, que prohíbe negativos), y con `0 < 1..4`
cada unidad ordena antes que su pack para las 4 parejas a la vez, sin renumerar nada existente.

**Por qué GTIN va en `product_barcodes` y no en `products`.** `products` no
tiene ninguna columna de código de barras (confirmado contra
`information_schema.columns` en vivo). `product_barcodes` sí es una tabla
real para esto — la misma que usa `publish_catalog_product_draft` — con
`gtin_check_digit_valid()` como autoridad. Los 4 GTIN se validaron contra esa
función real de la base, no contra una reimplementación:

```
gtin           valido
7790895000782  true
7790895067532  true
7790895000829  true
7790895000454  true
```

`source = 'manual'` porque son códigos de referencia dados por el dueño, no
un escaneo físico — es el mismo valor que usa el flujo real de la app cuando
un humano confirma un GTIN (`publish_catalog_product_draft`, línea
`values (..., 'manual', ...)`). `package_type = 'unit'`, `unit_factor = 1`,
`is_primary = true`.

## El guard contra producción (releído en vivo, no asumido)

| Chequeo | Resultado |
|---|---|
| Negocio `00000000-…001` existe | sí — La Taba · open · activo=true |
| `alcohol_sales_enabled` | `false` (sin cambios; ninguna fila de este lote es alcohólica) |
| Productos actuales | 56 |
| Códigos de barra actuales para este negocio | 0 |
| Pedidos actuales | 1 (LT-0001) |
| Los 4 packs hermanos existen, con foto propia, intactos | sí — sort 1..4, `available=true`, `image_url` presente en los 4 |
| Colisión de `external_id`/`sku` contra los 56 vivos | **ninguna** |
| Colisión de `gtin` contra `product_barcodes` del negocio | **ninguna** (tabla vacía) |
| `LT-0001` | intacto — `total=$17.100`, 1 renglón `Coca-Cola Original Pack x12 ×1`, `product_id` apunta al pack real |
| Coherencia de precio pack-vs-unidad (nadie paga más por litro en el pack) | las 4 pasan: pack siempre más barato por litro que su unidad |

## Coherencia de precio por litro (control de sanidad, no del contrato)

| | pack | $/L pack | unidad | $/L unidad |
|---|---|---|---|---|
| Coca-Cola Original | $17.100 / 6 L | $2.850 | $2.290 / 0,5 L | $4.580 |
| Coca-Cola Zero | $17.100 / 6 L | $2.850 | $2.290 / 0,5 L | $4.580 |
| Sprite | $17.100 / 6 L | $2.850 | $2.290 / 0,5 L | $4.580 |
| Fanta Naranja | $19.999 / 9 L | $2.222 | $4.990 / 1,5 L | $3.327 |

El pack es más barato por litro que la unidad en los 4 casos — coherente con
cualquier mayorista real, y con la misma regla que ya corre en
`gondola-neuquen-plan.mjs` (`revisarCoherenciaDePrecios`).

## Qué va a escribir el lote, exactamente

`scripts/retail-unidades-plan.mjs --sql --verificado-por=<uuid>` emite
`artifacts/taba2-retail-normalization/retail-unidades.sql`: una transacción,
INSERT liso (nunca `on conflict do update`) de las 4 filas de `products` +
las 4 filas hermanas de `product_barcodes`, con un guard `do $$ ... $$` que
aborta el lote entero si cualquiera de los 4 SKU o los 4 GTIN ya existe. No
hay ningún UPDATE ni DELETE en todo el archivo.
