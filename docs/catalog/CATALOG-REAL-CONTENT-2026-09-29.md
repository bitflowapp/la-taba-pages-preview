# La Taba: contenido real del catálogo, cierre 2026-09-29

Misión de contenido, sin cambios de código de producto: Rider, Panel, frontend, Caja Clara y backend no se tocaron. Proyecto CP `tkanbadcglszlcyfjvpv`, negocio `e7850ad2-a447-402c-8375-3fd74e9466ba`. Base: `main` `1358188`.

## Veredicto

| Medición | Resultado |
| --- | --- |
| `CATALOG_REAL_CONTENT_READY` | **PARTIAL** |
| `REAL_IMAGE_COVERAGE` | **1/46** (Campari Bitter 750 ml) |
| Por qué no más | Cada foto limpia y exacta que existe pertenece a una marca que prohíbe su reutilización; las fotos con licencia abierta son de góndola, con la mano o de otra presentación. No se usó ninguna imagen dudosa, demo ni generada. |
| Qué lo destraba | Fotos propias del local: 45 fotos, lista en [PHOTO-SHOT-LIST.md](../../catalog/photo-intake/PHOTO-SHOT-LIST.md). Con ellas los 45 productos pasan a `READY_FOR_OWNER_APPROVAL` sin pedirle permiso a ninguna marca. |

## Clasificación de los 46 SKU

| Estado | SKU |
| --- | ---: |
| `APPROVED_REAL_IMAGE` | 1 |
| `READY_FOR_OWNER_APPROVAL` | 0 |
| `RIGHTS_PERMISSION_REQUIRED` | 39 |
| `EXACT_PRODUCT_NOT_FOUND` | 3 (Heineken 710 ml, Lay's 134 g, Cinzano 950 ml) |
| `PHOTO_REQUIRED_FROM_STORE` | 1 (Corona Extra 330 ml) |
| `PRODUCT_CONFIRMATION_REQUIRED` | 2 (Cepita Naranja y Durazno 1 L) |

`RIGHTS_PERMISSION_REQUIRED` significa que existe una imagen correcta del producto exacto (render del titular o de retail) pero no hay licencia para reutilizarla; se destraba con permiso escrito del titular o con foto propia. El detalle por SKU (fuente de referencia, términos, veredicto visual, qué falta) está en [real-catalog-images.csv](../../catalog/real-catalog-images.csv), una fila por SKU, con `final_status`, `rights_status` (`UNVERIFIED` salvo Campari), `visual_status`, rutas de staging/aprobada y `associated`.

## Qué se investigó esta noche

- **Fotos propias**: `catalog/photo-intake/` y `catalog/photo-capture/` no tienen fotos; se buscó también en Descargas, Imágenes, Escritorio y Documentos por nombre de marca. Sólo aparecieron los assets del catálogo estático anterior (capturas de retail con derechos `pending_review`), que no se pueden aprobar.
- **Open Food Facts**: se volvió a consultar cada GTIN por API. 35 de 46 tienen ficha y 11 no. Se descargaron y miraron una por una las 104 fotos crudas. Ninguna cumple identidad, derechos y calidad, salvo la de Campari ya aprobada. Las dos únicas preseleccionadas quedaron así:
  - Cepita Naranja (raw 5): frente limpio y vigente con licencia CC BY-SA, pero la presentación del SKU está sin confirmar; no se aprueba.
  - Monster Ultra (raw 1): lata completa con fondo desordenado. Un recorte local dejó bordes blandos sobre la etiqueta, dominante rosada, condensación y rayones; se descartó.
- **Wikimedia Commons**: búsquedas por marca y presentación (37 grupos). Los 12 candidatos que parecían fotos de producto se descartaron: Fernet Branca de 70 cl europeo, Corona de 355 ml de EE. UU., Stella Artois de 500 ml belga, Schneider de 473 ml (el SKU es de 710), Monster Mango Loco en la mano, Imperial Golden 0,0 y Alamos de 2005.
- **Distribuidores y GS1**: ningún mayorista declara licencia de reutilización de imágenes. GS1 Argentina tiene un Catálogo Electrónico que permitiría bajar imágenes por código de barras según el plan, pero sus términos no se pudieron verificar y no se contrató nada. Sirve para escalar el catálogo, no bloquea la apertura. Sólo el proveedor de Walter puede autorizar por escrito; no se contactó a nadie. Detalle en [image-rights-research-2026-09-29.json](image-rights-research-2026-09-29.json).
- Los assets descargados (`RESEARCH_ASSET`, 14 MB) quedaron fuera del repo y no se subieron.

## Carnicería y productos por peso

El catálogo de CP no tiene carnes ni productos por peso (0 de 46; se comprobó por categoría y por nombre). Si se suman, la lista de fotos ya prevé el grupo y pide foto propia real más la confirmación de qué vende Walter y en qué unidad. No se generó ni asoció nada.

## Cepita

Se mantiene sin resolver, sin adivinar: `packaging_type=Botella`, pero el GTIN de Naranja es un Tetra Brik de 1 L. Ambas Cepita quedan en `PRODUCT_CONFIRMATION_REQUIRED` (issue #118) hasta que Walter confirme presentación y GTIN.

## Ingesta de fotos de mañana

El flujo ya existía; no se construyó otro:

1. Sacar las fotos según la guía de la lista y nombrarlas `<sku>.jpg` (también sirve `<sku>__front.jpg`).
2. Copiarlas a `catalog/photo-intake/` y correr `npm run catalog:photos:validate`.
3. Panel → Catálogo → **Cargar fotos en lote**: el Panel reconoce el producto por el SKU exacto del archivo, lo sube al staging privado y lo deja pendiente.
4. El dueño aprueba cada foto con derecho `PROPIO`; recién ahí se copia a `catalog-images` y se asocia.

Ajuste mínimo a la herramienta de validación (`scripts/catalog-photos.mjs`): acepta `<sku>.jpg`, reconoce los 46 SKU de CP (14 no estaban en `products.json`), avisa si una foto pesa más de 5 MB (límite del Panel) y trata el fondo no blanco como aviso para el Panel. `ingest` ignora los SKU de CP, así que esta herramienta no puede escribir en la base. Las fotos están en `.gitignore`: el asset final vive en Storage.

## Invariantes de la misión

- Cero escrituras en CP: no hubo subidas a staging, aprobaciones ni asociaciones nuevas; por eso no se hizo un backup adicional (sigue vigente el del 2026-09-27) ni QA nueva del Panel (no hay nada nuevo que ver; la de Campari del 2026-09-28 sigue en pie).
- Huellas de solo lectura al inicio: precio/stock `c3f81a05…`, publicación `77fbc8e7…`. Los productos disponibles son 0, ninguno verificado y la tienda está cerrada.
- Campari, revisado de nuevo a ojo: botella completa, etiqueta legible, fondo blanco. Los dos objetos públicos de `catalog-images` responden 200 `image/webp` con los hashes registrados. Observación menor: la botella ocupa casi todo el alto del cuadro y deja poco aire; se aprobó así y no se retocó.
- Tests: 4 nuevos en `tests/catalog-real-images-manifest.test.mjs` (una fila por SKU, estados exactos, sólo una imagen aprobada y asociada con derechos verificados, la lista nombra cada SKU pendiente una vez con nombres que el Panel reconoce, y el validador local).
