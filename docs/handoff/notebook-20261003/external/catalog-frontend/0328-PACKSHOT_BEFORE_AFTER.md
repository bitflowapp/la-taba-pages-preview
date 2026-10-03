# Packshots — antes / después

Worktree: `C:\1212\la-taba-promos-packshots` · branch `feature/catalog-packshots-promos` ·
base `64615dbd594279945257078f315ec911dbade5d6` · sin commits.

## Qué se hizo

Los 22 productos del catálogo demo aprobado (`assets/catalog/beverages/`, consumido por
`js/approved-beverage-demo-data.js`, sólo carga con `?demo=1`) ya tenían fondo blanco puro,
sin deformación y sin recortes de etiqueta/tapa/pack. El problema real era el margen blanco
interno: la mayoría de las botellas PET ocupaban 52–61 % del alto del lienzo de 1000×1000, muy
por debajo del rango objetivo (70–82 %). Un caso (Monster Mango Loco) estaba en el extremo
opuesto (92,2 %), con menos aire del deseable.

No existe en este repositorio un archivo "original" crudo (pre-webp) para estos 22 SKU — el
`sourceImageSha256` declarado en cada producto referencia un origen externo que nunca se
versionó. Por eso el pipeline nuevo (`scripts/catalog-images/normalize-demo-packshots.mjs`)
trata el WebP publicado actualmente como punto de partida, respalda ese WebP intacto en
`packshots-before-after/{sku}/{product,thumbnail}-before.webp` **antes** de tocar nada, y sólo
entonces genera el reemplazo.

## Algoritmo (sin IA generativa, sin reconstrucción de etiqueta)

1. **Detección de bounding box por flood-fill desde el borde**: en vez de clasificar cada
   píxel como "blanco = fondo" (lo que confundiría tapas blancas, brillos especulares en latas
   plateadas o el reflejo de una botella transparente con el margen), el algoritmo inunda desde
   los cuatro bordes del lienzo sólo la región de blanco puro *conectada al borde*. Un cap
   blanco o un highlight en el medio del producto, rodeado de píxeles no blancos, nunca se
   conecta al borde y por lo tanto nunca se recorta.
2. **Recorte con margen de seguridad**: se agrega un padding de `max(4px, 1% del lado mayor
   del bbox)` alrededor del bbox detectado para no clipear antialiasing del borde real del
   producto.
3. **Reescalado uniforme** (mismo factor en X e Y — nunca deformación) para que el producto
   ocupe el 76 % del alto del lienzo (punto medio del rango 70–82 % pedido).
4. **Clamp de seguridad por ancho**: si esa escala empujara el ancho más allá del 94 % del
   lienzo, se reduce la escala para no arriesgar recorte lateral. **No se activó en ninguno de
   los 22 SKU** — el ancho resultante máximo fue 72,4 % (imperial-golden-lata-473ml).
5. **Recentrado** exacto en un lienzo blanco puro nuevo, `flatten` + `webp` calidad 84 (mismos
   parámetros que el pipeline comercial `normalize.mjs`, para consistencia de compresión).
6. **Thumbnail 400×400** derivado del master 1000×1000 ya normalizado (mismo encuadre,
   evita procesar el bbox dos veces).
7. **Recalculo de SHA-256** de ambos archivos; `sourceImageSha256` no se toca (sigue
   apuntando al origen externo, ya distinto del WebP servido antes de este cambio).

## Resultado

- **22/22 productos normalizados**, 0 diferidos.
- **0 activaciones del clamp de seguridad por ancho** (ningún SKU necesitó sacrificar el
  objetivo de 76 % de alto).
- Todos los productos, botellas PET altas y angostas, latas, packs multi-envase, quedaron en
  exactamente **76,0 % de ocupación de alto** (dentro de 70–82 %), sin cropear tapa, etiqueta,
  pack ni vidrio.
- Caso extremo verificado visualmente: Monster Mango Loco (antes 92,2 %) redujo su ocupación a
  76 % agregando aire alrededor sin alterar el arte de lata. Imperial Cream Stout (antes 44,7 %,
  el más chico) ganó el mayor salto de tamaño relativo sin artefactos visibles en la lata negra.
- Ver `PACKSHOT_AUDIT.csv` para el detalle numérico por SKU y `screenshots/PACKSHOT_BEFORE_AFTER_BOARD.png`
  para la comparación visual (catálogo completo + 6 SKU representativos: PET chico, PET grande,
  lata simple, lata ancha/plateada, lata energizante angosta, botella de vidrio).
- Respaldo completo (`product-before.webp`, `thumbnail-before.webp`, `product-after.webp`,
  `thumbnail-after.webp`) de los 22 SKU en `packshots-before-after/{sku}/`.

## Trazabilidad

`js/approved-beverage-demo-data.js` se regeneró con `scripts/import-approved-beverages.mjs`
(script nuevo — el generador citado en el encabezado original, `import-approved-beverees.mjs`,
no existía en ningún branch del repo). Sólo cambiaron `imageSha256`, `imageThumbnailSha256`
(44 valores) y la constante `PREVIEW_CATALOG_VERSION`
(`approved-beverages-2026-07-29-v1` → `approved-beverages-2026-07-31-packshots-v2`). Ningún
otro campo (precio, stock, alcohol, SKU, nombre, `sourceImageSha256`) fue tocado — confirmado
línea por línea en el diff.
