# TABA2 · pipeline de imágenes del catálogo

Artefactos de la misión del 2026-08-18. Rama
`feature/taba2-catalog-image-pipeline`, base `190b344`.

## Dónde está cada entregable

Los que son **resultado de una corrida** viven acá. Los que son **configuración
que el pipeline lee** viven en `catalog/`, junto al código que los usa: tenerlos
duplicados es la forma más segura de que las dos copias se separen y nadie sepa
cuál manda.

| entregable | ubicación |
|---|---|
| `SKU-IMAGE-MATRIX.csv` | acá |
| `SOURCE-MANIFEST.json` | acá |
| `RIGHTS-AUDIT.md` | acá |
| `IMAGE-MATCH-REPORT.md` | acá |
| `MISSING-ASSETS.md` | acá |
| `DUPLICATE-ASSETS.md` | acá |
| `PERFORMANCE.md` | acá |
| `PACKAGE-SCAN.json` | acá |
| `TEST-REPORT.md` | acá |
| `contact-sheet.html` · `contact-sheet.webp` | acá |
| `asociar-imagenes.sql` | acá — el lote de asociación, **sin aplicar** |
| `harvest.json` | acá — los 347 candidatos crudos, para poder repetir el análisis sin red |
| `perceptual-hashes.json` | acá — firma de color por SKU con foto |
| `revision/` | acá — las 5 imágenes que se miraron antes de aprobar. No se versiona. |
| `SOURCE-ALLOWLIST.json` | **`catalog/image-source-allowlist.json`** |
| `PUBLIC-PRODUCT-ASSETS.json` | **`catalog/PUBLIC-PRODUCT-ASSETS.json`** |

## El resumen en una tabla

| | |
|---|---:|
| SKU en producción | 56 |
| con fotografía procesada y lista | **4** |
| coincidencia exacta frenada por derechos | 1 |
| en revisión humana | 3 |
| con fuente oficial que no publica este producto | 17 |
| sin fuente oficial encontrada | 31 |
| activos históricos de retailer reutilizados | **0** |

Los 4 son los packs: Coca-Cola Original x12, Coca-Cola Zero x12, Sprite x12 y
Fanta Naranja x6, con el packshot oficial del embotellador Coca-Cola Andina.

Los 52 restantes siguen con el recurso propio de TABA, que es lo correcto: la
tienda oficial publica packs y no unidades, y usar un packshot con el sello «x12»
para una unidad suelta es exactamente lo que la autorización comercial prohíbe.

## Por dónde empezar a leer

1. [IMAGE-MATCH-REPORT.md](IMAGE-MATCH-REPORT.md) — cómo se decidió qué foto va
   con qué producto, y los cuatro defectos del matcher que aparecieron midiendo.
2. [RIGHTS-AUDIT.md](RIGHTS-AUDIT.md) — qué se puede publicar, bajo qué autoridad,
   y el P0 que tenía al guard de derechos ciego a su propio pipeline.
3. [MISSING-ASSETS.md](MISSING-ASSETS.md) — la lista de trabajo del próximo round.
4. `contact-sheet.html` — los 56 juntos, para mirarlos.
