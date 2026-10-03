# Fuentes y trazabilidad de assets

## Packshots normalizados (22 SKU)

- **Origen**: WebP ya publicados en `assets/catalog/beverages/{sku}/{product,thumbnail}.webp`
  antes de esta tarea. No existe en el repositorio (ni en el historial de git de ningún branch
  relacionado) un archivo crudo/original anterior a esos WebP: `sourceImageSha256` en
  `js/approved-beverage-demo-data.js` referencia un origen externo que nunca se versionó aquí.
  Se confirmó antes de tocar nada que `imageSha256 ≠ sourceImageSha256` en los 22 productos
  (ya había habido un procesamiento previo fuera del repo).
- **Transformación aplicada**: recorte de margen blanco + recentrado, sin IA generativa, sin
  reconstrucción de etiqueta. Ver `PACKSHOT_BEFORE_AFTER.md` para el algoritmo completo.
- **Herramienta**: `sharp` (ya era devDependency del proyecto), script nuevo
  `scripts/catalog-images/normalize-demo-packshots.mjs`.
- **Respaldo**: cada WebP anterior se copió sin modificar a
  `packshots-before-after/{sku}/{product,thumbnail}-before.webp` antes de sobrescribir el
  archivo servido.
- **Derechos**: sin cambios — cada producto sigue declarando
  `rightsStatus: "RETAILER_SOLO_REFERENCIA"` (exigido y verificado por
  `scripts/catalog-images/verify-approved-demo.mjs`).

## Imágenes de promoción (3 combos válidos)

- **Origen**: recortes tomados directamente de los packshots ya normalizados y publicados en
  `assets/catalog/beverages/{sku}/product.webp` (los mismos 22 productos de arriba, después de
  la normalización). Ninguna imagen de stock externa, ninguna generación por IA.
- **Composición**: fondo blanco cálido (#faf6ef), productos completos a escala coherente entre
  sí (un único factor de escala por composición, no un ajuste independiente por producto), sin
  collage desordenado, sin marcas de agua, sin alterar el envase, sin texto ni precio superpuesto
  al producto — las badges de descuento son responsabilidad de la UI, no de la imagen (cumple
  el punto explícito del pedido).
- **Herramienta**: script nuevo `scripts/catalog-images/compose-promotion-images.mjs`.
- **Tamaños generados por promoción**: `hero-1200x800.webp` (Home), `square-1000x1000.webp`
  (catálogo), `thumb-400x400.webp` (miniatura).
- **Ubicación de los archivos generados**: **fuera del árbol del repositorio**, en
  `promotions/{promoId}/` dentro de esta misma carpeta de evidencia. Motivo: mientras estas
  candidatas no tengan aprobación comercial real (`approval_status=APROBADA` +
  `approval_reference`) ni una entrada en el manifiesto comercial
  (`docs/catalog/image-manifest.json`), no deben convivir con los WebP servidos en `assets/` del
  repo — `tests/image-sources.test.mjs` exige explícitamente que todo WebP bajo `assets/` sea
  del catálogo demo aprobado o esté registrado en ese manifiesto, como control anti-huérfanos.
  Por eso `image_path` queda vacío en `data/preview-promotions.csv` para las 3 candidatas
  nuevas, igual que en las 2 candidatas preexistentes del archivo. Cuando Negocio apruebe una
  promoción, el paso correcto es: registrar la fuente en el manifiesto comercial, mover la
  imagen aprobada a `assets/promotions/{promoId}/` (o al esquema que el manifiesto exija), y
  recién entonces completar `image_path`.

## Scripts nuevos escritos en esta tarea (generadores reales, no edición manual)

Los archivos `js/approved-beverage-demo-data.js` y `js/preview-promotions-data.js` llevan un
encabezado "Generado por... No editar manualmente" que referencia scripts generadores. Se
verificó exhaustivamente (`git log --all --diff-filter=A` sobre todos los branches locales,
incluida la línea paralela `feature/catalog-expansion-argentina`) que esos scripts **nunca
existieron** en este repositorio. Para cumplir la instrucción de no editar a mano archivos
generados, se escribieron los generadores reales:

- `scripts/import-approved-beverages.mjs` — recalcula hash/dimensiones de imagen desde los
  archivos en disco; preserva el resto de la metadata del producto tal cual estaba.
- `scripts/import-preview-promotions.mjs` — parsea `data/preview-promotions.csv` (parser CSV
  propio con soporte de comillas) y regenera `PREVIEW_PROMOTION_SEED` en el mismo formato que
  ya usaba el archivo.
- `scripts/catalog-images/normalize-demo-packshots.mjs` — normalización de packshots (detalle
  en `PACKSHOT_BEFORE_AFTER.md`).
- `scripts/catalog-images/compose-promotion-images.mjs` — composición de imágenes de
  promoción.

Ninguno de estos scripts toca el pipeline comercial existente
(`scripts/catalog-images/normalize.mjs`, `fetch.mjs`, `verify.mjs`, `lib.mjs`), que sigue
vacío/fail-closed como antes.
