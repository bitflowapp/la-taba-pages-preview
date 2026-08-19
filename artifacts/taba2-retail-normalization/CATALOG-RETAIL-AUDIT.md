# TABA — auditoría de góndola minorista

Rama `feature/taba2-retail-catalog-normalization` @ base `d87fb6e`
(`feature/taba2-catalog-image-pipeline`, que a su vez contiene `786e6a6`
gondola-neuquen como ancestro — la autoridad productiva verificada, no
asumida). Producción: `wwcpogltfgzgkrlilbcd`, negocio
`00000000-0000-4000-8000-000000000001`, sitio `la-taba.pages.dev`.

Censo: **56 SKU**, tomados de dos fuentes primarias que se leyeron
literalmente (no se retipeó ningún número a mano):

- `catalog/gondola-neuquen.mjs` → `GONDOLA` (52 filas), la autoridad
  declarada del surtido inicial cargado el 2026-08-18.
- `artifacts/taba2-catalog-images/ASSOCIATION-READBACK.json`, la lectura
  de vuelta REAL de producción del pipeline de imágenes (2026-08-19
  03:53Z, el evento más reciente contra `wwcpogltfgzgkrlilbcd`), que
  confirma los 56 SKU exactos que hoy existen en la base — incluidos los 4
  packs Coca-Cola-system con sus **strings de SKU reales**
  (`coca-cola-original-botella-pet-500-ml-pack-x12`, etc., distintos de
  los nombres usados en los CSV de preparación `catalog/products.json` /
  `catalog/pending-unit-prices.csv`, que pertenecen a un pool de 92 fichas
  candidatas MÁS AMPLIO y no reflejan 1:1 lo que está vivo hoy).

## Resultado

| | cantidad |
|---|---|
| Total SKU | 56 |
| No alcohólicos | 33 |
| Alcohólicos | 23 |
| `UNIT_OK` (ya modelados correctamente como unidad) | 51 |
| `PACK_OK` (pack legítimo, se conserva) | 1 |
| `SHOULD_BE_UNIT` (falta la unidad hermana) | 4 |
| `REVIEW` | 0 |

**Hallazgo central: el defecto conceptual que motivó esta misión existe,
pero está acotado a exactamente 4 SKU — no está distribuido por la
góndola.** Las 29 filas no alcohólicas de `gondola-neuquen.mjs` YA se
venden por unidad (`soldAsPack=false`, `unitsPerPack=1`) desde que se
cargaron el 2026-08-18; ninguna de ellas necesita corrección. El único
lugar donde un no-alcohólico existe HOY sólo como pack mayorista (x12 o
x6) sin ninguna unidad hermana comprable son los 4 SKU Coca-Cola-system
que trajo el pipeline de imágenes — y son exactamente los que ese informe
ya señalaba como "packs de abastecimiento, no unidad de venta".

En cerveza, el único pack (`quilmes-clasica-lata-473ml-pack-6`) es
legítimo por el propio criterio del usuario ("Pack x6 de cerveza no es
automáticamente un error") y se conserva sin cambios.

## Detalle por categoría

### Aguas

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `benedictino-sin-gas-2250ml` | Benedictino | 2250 ml | no | 1 | $2.250 | 12 | no | UNIT_OK |
| `villa-del-sur-sin-gas-600ml` | Villa del Sur | 600 ml | no | 1 | $1.700 | 24 | no | UNIT_OK |
| `villavicencio-con-gas-500ml` | Villavicencio | 500 ml | no | 1 | $1.900 | 12 | no | UNIT_OK |
| `villavicencio-sin-gas-1500ml` | Villavicencio | 1500 ml | no | 1 | $2.400 | 24 | no | UNIT_OK |

### Aguas saborizadas

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `aquarius-manzana-1500ml` | Aquarius Manzana | 1500 ml | no | 1 | $1.800 | 12 | no | UNIT_OK |
| `aquarius-pera-1500ml` | Aquarius Pera | 1500 ml | no | 1 | $1.800 | 12 | no | UNIT_OK |
| `aquarius-pomelo-2250ml` | Aquarius Pomelo | 2250 ml | no | 1 | $2.650 | 12 | no | UNIT_OK |

### Aperitivos

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `dr-lemon-vodka-pomelo-lata-473ml` | Dr. Lemon Vodka Pomelo | 473 ml | no | 1 | $2.200 | 12 | sí | UNIT_OK |
| `gancia-americano-450ml` | Gancia Americano | 450 ml | no | 1 | $4.350 | 12 | sí | UNIT_OK |
| `gancia-lima-limon-lata-473ml` | Gancia Lima Limón | 473 ml | no | 1 | $2.550 | 12 | sí | UNIT_OK |

### Cervezas

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `andes-origen-roja-lata-473ml` | Andes Origen Roja | 473 ml | no | 1 | $2.650 | 12 | sí | UNIT_OK |
| `andes-origen-rubia-lata-473ml` | Andes Origen Rubia | 473 ml | no | 1 | $2.650 | 24 | sí | UNIT_OK |
| `brahma-chopp-lata-710ml` | Brahma Chopp | 710 ml | no | 1 | $3.000 | 24 | sí | UNIT_OK |
| `budweiser-lata-473ml` | Budweiser | 473 ml | no | 1 | $2.350 | 12 | sí | UNIT_OK |
| `corona-extra-botella-330ml` | Corona Extra | 330 ml | no | 1 | $3.400 | 12 | sí | UNIT_OK |
| `patagonia-amber-lager-botella-730ml` | Patagonia Amber Lager | 730 ml | no | 1 | $5.300 | 6 | sí | UNIT_OK |
| `quilmes-clasica-botella-710ml` | Quilmes Clásica | 710 ml | no | 1 | $3.000 | 24 | sí | UNIT_OK |
| `quilmes-clasica-lata-473ml` | Quilmes Clásica | 473 ml | no | 1 | $2.050 | 24 | sí | UNIT_OK |
| `quilmes-clasica-lata-473ml-pack-6` | Quilmes Clásica | 473 ml | sí | 6 | $11.400 | 4 | sí | PACK_OK |
| `quilmes-stout-lata-473ml` | Quilmes Stout | 473 ml | no | 1 | $2.050 | 12 | sí | UNIT_OK |
| `stella-artois-lata-473ml` | Stella Artois | 473 ml | no | 1 | $3.600 | 12 | sí | UNIT_OK |

### Destilados

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `gin-gordons-700ml` | Gordon's London Dry | 700 ml | no | 1 | $16.800 | 6 | sí | UNIT_OK |
| `vodka-skyy-700ml` | Skyy Vodka | 700 ml | no | 1 | $9.500 | 6 | sí | UNIT_OK |

### Energizantes

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `monster-green-zero-473ml` | Monster Green Zero | 473 ml | no | 1 | $3.250 | 12 | no | UNIT_OK |
| `red-bull-original-250ml` | Red Bull | 250 ml | no | 1 | $2.800 | 24 | no | UNIT_OK |
| `red-bull-sin-azucar-250ml` | Red Bull Sugarfree | 250 ml | no | 1 | $2.800 | 12 | no | UNIT_OK |
| `speed-original-473ml` | Speed | 473 ml | no | 1 | $2.850 | 24 | no | UNIT_OK |
| `speed-zero-473ml` | Speed Zero | 473 ml | no | 1 | $2.850 | 12 | no | UNIT_OK |

### Fernet

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `fernet-1882-750ml` | Fernet 1882 | 750 ml | no | 1 | $8.950 | 6 | sí | UNIT_OK |
| `fernet-branca-1000ml` | Fernet Branca | 1000 ml | no | 1 | $26.250 | 6 | sí | UNIT_OK |

### Gaseosas

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `coca-cola-original-2250ml` | Coca-Cola | 2250 ml | no | 1 | $5.900 | 24 | no | UNIT_OK |
| `coca-cola-original-botella-pet-500-ml-pack-x12` | Coca-Cola Original | 500 ml | sí | 12 | $17.100 | no releído en vivo (no se toca) | no | SHOULD_BE_UNIT (pack se conserva, falta unidad hermana) |
| `coca-cola-original-lata-354ml` | Coca-Cola | 354 ml | no | 1 | $1.800 | 24 | no | UNIT_OK |
| `coca-cola-zero-2250ml` | Coca-Cola Zero | 2250 ml | no | 1 | $5.900 | 24 | no | UNIT_OK |
| `coca-cola-zero-botella-pet-500-ml-pack-x12` | Coca-Cola Zero | 500 ml | sí | 12 | $17.100 | no releído en vivo (no se toca) | no | SHOULD_BE_UNIT (pack se conserva, falta unidad hermana) |
| `coca-cola-zero-lata-354ml` | Coca-Cola Zero | 354 ml | no | 1 | $1.800 | 24 | no | UNIT_OK |
| `fanta-naranja-2250ml` | Fanta Naranja | 2250 ml | no | 1 | $5.900 | 24 | no | UNIT_OK |
| `fanta-naranja-botella-pet-1500-ml-pack-x6` | Fanta Naranja | 1500 ml | sí | 6 | $19.999 | no releído en vivo (no se toca) | no | SHOULD_BE_UNIT (pack se conserva, falta unidad hermana) |
| `pepsi-black-1500ml` | Pepsi Black | 1500 ml | no | 1 | $2.650 | 12 | no | UNIT_OK |
| `pepsi-original-2000ml` | Pepsi | 2000 ml | no | 1 | $3.800 | 24 | no | UNIT_OK |
| `seven-up-original-2000ml` | 7UP | 2000 ml | no | 1 | $3.800 | 12 | no | UNIT_OK |
| `sprite-botella-pet-500-ml-pack-x12` | Sprite | 500 ml | sí | 12 | $17.100 | no releído en vivo (no se toca) | no | SHOULD_BE_UNIT (pack se conserva, falta unidad hermana) |
| `sprite-original-2250ml` | Sprite | 2250 ml | no | 1 | $5.900 | 24 | no | UNIT_OK |
| `sprite-original-lata-354ml` | Sprite | 354 ml | no | 1 | $1.800 | 24 | no | UNIT_OK |
| `sprite-zero-2250ml` | Sprite Zero | 2250 ml | no | 1 | $5.900 | 12 | no | UNIT_OK |

### Isotónicas

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `gatorade-cool-blue-500ml` | Gatorade Cool Blue | 500 ml | no | 1 | $2.000 | 12 | no | UNIT_OK |
| `gatorade-manzana-1250ml` | Gatorade Manzana | 1250 ml | no | 1 | $2.650 | 12 | no | UNIT_OK |
| `powerade-mountain-blast-500ml` | Powerade Mountain Blast | 500 ml | no | 1 | $1.450 | 12 | no | UNIT_OK |

### Mixers

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `paso-de-los-toros-pomelo-1500ml` | Paso de los Toros Pomelo | 1500 ml | no | 1 | $3.250 | 12 | no | UNIT_OK |
| `paso-de-los-toros-tonica-1500ml` | Paso de los Toros Tónica | 1500 ml | no | 1 | $3.250 | 24 | no | UNIT_OK |
| `soda-manaos-sifon-2000ml` | Soda Manaos | 2000 ml | no | 1 | $1.750 | 24 | no | UNIT_OK |

### Vinos

| SKU | Nombre | Cap. | Pack | u/pack | Precio | Stock | Alcohol | Clasificación |
|---|---|---|---|---|---|---|---|---|
| `cafayate-torrontes-750ml` | Cafayate Torrontés | 750 ml | no | 1 | $5.400 | 6 | sí | UNIT_OK |
| `dada-caramel-750ml` | Dada Caramel | 750 ml | no | 1 | $5.900 | 12 | sí | UNIT_OK |
| `toro-tinto-1000ml` | Toro | 1000 ml | no | 1 | $2.300 | 24 | sí | UNIT_OK |
| `toro-viejo-clasico-tinto-750ml` | Toro Viejo Clásico | 750 ml | no | 1 | $2.550 | 24 | sí | UNIT_OK |
| `trapiche-origen-malbec-750ml` | Trapiche Origen Malbec | 750 ml | no | 1 | $6.150 | 12 | sí | UNIT_OK |

## Los 4 `SHOULD_BE_UNIT`

| Pack (se conserva, intacto) | Unidad que falta | Precio del pack | ¿Precio unitario con fuente real? |
|---|---|---|---|
| `coca-cola-original-botella-pet-500-ml-pack-x12` | Coca-Cola Original · 500 ml · Unidad | $17.100 | **NO** |
| `coca-cola-zero-botella-pet-500-ml-pack-x12` | Coca-Cola Zero · 500 ml · Unidad | $17.100 | **NO** |
| `sprite-botella-pet-500-ml-pack-x12` | Sprite · 500 ml · Unidad | $17.100 | **NO** |
| `fanta-naranja-botella-pet-1500-ml-pack-x6` | Fanta Naranja · 1,5 L · Unidad | $19.999 | **NO** |

Por qué no hay precio: se buscó en las cinco fuentes que declara el
proyecto — `catalog/gondola-neuquen.mjs` (sólo tiene costo mayorista de
Coca-Cola/Sprite/Fanta en presentación de **2.250 ml**, una capacidad
distinta; extrapolar un costo de 2,25 L a 500 ml o 1,5 L sería inventar),
`catalog/planilla-negocio.csv` (tiene precios minoristas reales medidos
para otros SKU — p. ej. cervezas y energizantes del pool de 92 — pero
las filas de estos 4 productos están vacías), `catalog/pending-prices.csv`,
`catalog/image-sources.csv` y `catalog/pending-unit-prices.csv` +
`.reference.csv`. Este último archivo ya deja escrito, de una sesión
previa, el precio del PACK ($17.100 / $19.999, que coincide exacto con
`LT-0001` y con el precio vivo en producción) junto con una columna
`division_del_pack_NO_USAR` y el motivo explícito: *"El precio unitario
incluye el margen minorista que fija el local; no es el pack dividido."*
Es la misma conclusión a la que llega esta auditoría, por un camino
independiente. **No existe, en ningún archivo del repositorio, un costo
mayorista o precio minorista real para la presentación de 500 ml o 1,5 L
de estas 3 marcas.**

Quedan marcados `PRICE_REVIEW_REQUIRED` → ver `RETAIL-DATA-REQUIRED.md`.

## Por qué no hubo ninguna escritura a producción en esta misión

Con los 4 precios ausentes, no hay ningún SKU para el que corregir
mayorista→minorista sea seguro hoy. Además, la arqueología de esquema y
RPC (migración `20260725110000_catalog_publication_authority.sql`) deja
un hecho que condiciona cualquier intento futuro:

- La única RPC que puede escribir campos fuera de
  `(stock, available, is_active, sort_order)` es `import_catalog_batch`
  → `stage_catalog_products`, y **exige una fila `catalog_assets` real
  (imagen procesada, con derechos) para CADA producto del lote, nuevo o
  existente — no hay forma de crear un SKU sin foto por esta vía**, ni
  siquiera con `rights_status='PROPIO'`.
- El único canal que sí creó productos sin foto (los 52 de
  `gondola-neuquen.mjs`, con `image_url = null`, hoy renderizados con el
  recurso propio de TABA) es `scripts/aplicar-gondola-neuquen.mjs`, que
  habla con la Management API de Supabase con un token de CLI elevado —
  bypassea RLS y los grants de `authenticated` por diseño, y está
  cerrado detrás de `TABA2_GONDOLA_APPLY` + `--confirmado-por-humano`.

O sea: crear las 4 unidades con "recurso propio de TABA" (explícitamente
permitido por la consigna) sólo es posible por el canal que bypassea
RLS/grants, y la consigna pide explícitamente no violar RLS/grants. Es
una tensión real entre dos instrucciones, no una ambigüedad menor — y de
cualquier forma es un punto discutible **sin efecto práctico hoy**, porque
aunque se resolviera, seguiría faltando el precio real de las 4 unidades,
que es el bloqueo independiente y suficiente. Se deja documentado para
que quien continúe esta misión —con los 4 precios en mano— sepa que
además necesita una decisión explícita sobre qué canal usar, no sólo el
número.

## Confirmaciones de seguridad de esta auditoría (sólo lectura)

- `LT-0001` y toda orden histórica: no se leyeron ni se tocaron filas de
  `order_items`; esta auditoría no ejecutó ningún UPDATE/INSERT.
- `alcohol_sales_enabled`: confirmado como columna real de
  `public.businesses` (migración `20260725060000`), no de `products`;
  no se tocó.
- Los 4 packshots oficiales (Coca-Cola Andina, `TABA-AUT-2026-08-001`)
  siguen ligados exclusivamente a sus 4 SKU pack; el propio marco de
  autorización excluye explícitamente reusarlos en una ficha de unidad
  suelta ("muestran una cosa y se entrega otra") — ninguna unidad nueva
  los usará cuando se creen.
- 0 escrituras a `wwcpogltfgzgkrlilbcd` en esta sesión.
- 0 mutaciones a staging.
