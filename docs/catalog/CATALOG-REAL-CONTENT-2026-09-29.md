# La Taba: contenido real del catálogo, cierre 2026-09-29

Misión de contenido, sin cambios de código de producto: Rider, Panel, frontend, Caja Clara y backend no se tocaron. Proyecto CP `tkanbadcglszlcyfjvpv`, negocio `e7850ad2-a447-402c-8375-3fd74e9466ba`. Base: `main` `1358188`.

Hubo tres pasadas el mismo día:

1. La primera partió de que La Taba no tenía autorización para reutilizar fotos de comercios y terminó en 1/46.
2. El titular corrigió esa premisa para Supermercados DIA y TOP: 1/46 pasó a 31/46.
3. El titular incorporó Jumbo como fuente autorizada; se investigaron los 15 pendientes y se llegó a 42/46.

## Veredicto

| Medición | Resultado |
| --- | --- |
| `CATALOG_REAL_CONTENT_READY` | **PARTIAL** |
| `REAL_IMAGE_COVERAGE` | **42/46**: Campari (Open Food Facts, CC BY-SA 3.0) y 41 imágenes de Jumbo (12), Supermercados DIA (18) y Supermercados TOP (11) |
| Faltan | 4: 2 necesitan foto propia (Lay's 134 g, Pepsi Black 2,25 L) y 2 necesitan confirmación de producto (Cepita Naranja, Cinzano) |
| Canary | 12/12 con imagen real |
| Estado de venta | Nada cambió: 0 productos públicos, tienda cerrada, todos los productos con imagen siguen en borrador |

## Autorización y alcance

Registrada en [autorizaciones-comerciales.json](../../catalog/autorizaciones-comerciales.json) con `authorization_basis = AUTHORIZED_RETAIL_SOURCE`. Las fuentes cubiertas son **sólo** Supermercados DIA (`diaonline.supermercadosdia.com.ar`), Supermercados TOP (`www.supertop.com.ar`) y Jumbo (`www.jumbo.com.ar`). No se extendió a fabricantes, fotógrafos, marketplaces, otras cadenas (Vea, Disco, Carrefour, La Anónima…), distribuidores ni sitios de terceros. Los tests fallan si una imagen aprobada declara otro negocio o sale de un host que no sea el CDN de esas tres tiendas.

Queda pendiente para el titular el documento del acuerdo que respalde la declaración.

**La autorización no elimina la exactitud.** Jumbo tiene el GTIN exacto de los 15 pendientes y aun así se rechazaron dos de sus imágenes: la de Pepsi Black 2,25 L (de 2017, borrosa y con el envase anterior) y la de Lay's 134 g (edición FIFA/AFA).

## Cómo se eligió cada imagen

1. **Búsqueda por EAN** en los catálogos VTEX públicos de las tres tiendas, y por nombre exacto cuando el EAN no aparecía.
2. **Exactitud antes que derecho**: se descartaron la lata de 473 ml para el SKU de 710, la 0.0, la edición Vintage de Stella, la edición mundialista de Quilmes, la edición FIFA de Lay's y los renders que son recortes de etiqueta o dorsos.
3. **Placa de la tienda**: las tiendas superponen una placa lateral o inferior con el volumen. Se retiró sólo cuando cae fuera del envase. Si tapa la base, se ve a través de una botella translúcida o hay un halo pegado a la bolsa, se rechazó. Con Jumbo, Red Bull, Pepsi Black 1,5 L y Paso de los Toros Tónica pudieron aprobarse porque su placa está al costado.
4. **Envase actual, con fecha**: la fecha de cada imagen sale del parámetro de versión de la CDN y queda en el manifiesto (`image_date`). Las imágenes sin octógonos de advertencia o de 2017 se descartaron frente a las vigentes.
5. **Procesamiento**: recorte de la placa, centrado sobre blanco 1000×1000 (sin ampliar más de 1,15 veces) y WebP q90 con miniatura de 400 px. El envase no se retocó.
6. **Flujo oficial**: staging privado, vista previa (el hash de la vista previa se comparó con el archivo ya revisado), aprobación con `LICENCIA_COMERCIAL` y una referencia que cita la autorización, la tienda y el EAN, y asociación. Ninguna escritura directa en la base.
7. **Control visual**: cada imagen se miró a ojo antes de subirla y de nuevo desde el bucket público, contra nombre, volumen y GTIN.

El detalle de cada asset (URL, fecha, EAN de la fuente, hashes, cómo se adaptó, upload y asset) está en [retail-authorized-images-2026-09-29.json](retail-authorized-images-2026-09-29.json) y en [real-catalog-images.csv](../../catalog/real-catalog-images.csv).

## Correcciones de la propia misión

- **Coca-Cola Sin Azúcar 2,25 L y Sprite 600 ml** se habían rechazado en la segunda pasada por mostrar el envase «Zero», que yo había inferido anterior a partir de fotos de Open Food Facts de 2021 a 2023. Era erróneo: DIA actualizó la imagen de Coca-Cola el 2026-09-23 y sigue mostrando «Zero»; Sprite muestra «Zero» con el texto «Soy 100% hecha de otras botellas» (Jumbo 2025-08). Los dos se aprobaron. El nombre de la ficha («Sin Azúcar») no coincide con la palabra del envase, con el mismo GTIN en todas las tiendas.
- **Alamos Malbec**: la imagen de DIA que se había aprobado era el Alamos clásico (etiqueta roja, GTIN `7794450000781`), pero el GTIN de la ficha (`7794450091338`) es **Alamos Malbec Reserve** (etiqueta turquesa; el dorso de la botella en Jumbo muestra ese código). Se reemplazó por la imagen de Jumbo del GTIN exacto.
- **Stella Artois 473 ml**: la imagen de TOP era otro diseño de lata con otro GTIN. Se reemplazó por la de Jumbo con el GTIN exacto de la ficha.
- Los reemplazos usan el mismo flujo: el pipeline actualiza el mismo `catalog_assets` del SKU (no crea un duplicado) y retiró los objetos anteriores del bucket. Los archivos previos quedan en `superseded-2026-09-29` fuera del repo.

## Clasificación de los 46 SKU

| Estado | SKU |
| --- | ---: |
| `APPROVED_REAL_IMAGE` | 42 |
| `PHOTO_REQUIRED_FROM_STORE` | 2 |
| `PRODUCT_CONFIRMATION_REQUIRED` | 2 |
| `EXACT_PRODUCT_NOT_FOUND` / `READY_FOR_OWNER_APPROVAL` / `RIGHTS_PERMISSION_REQUIRED` | 0 |

- **`PHOTO_REQUIRED_FROM_STORE` (2)**: Lay's Clásicas 134 g y Pepsi Black 2,25 L.
- **`PRODUCT_CONFIRMATION_REQUIRED` (2)**:
  - Cepita Naranja: el GTIN de la ficha es el Tetra Brik de 1 L en Jumbo y DIA, pero `packaging_type` dice Botella (issue #118). La botella Hot Fill «Naranja Tentación» tiene otro GTIN (`7790895009815`). Se revisaron las imágenes limpias de las dos presentaciones, pero no se asocia ninguna hasta que Walter confirme cuál vende.
  - Cinzano Rosso: la ficha dice 950 ml; Jumbo y Vea lo venden como 950 ml y DIA y TOP como 1000 ml, con el mismo GTIN. No hay evidencia suficiente para igualar los volúmenes y ninguna tienda tiene una imagen del frente completo.
- **Cepita Durazno** está aprobado: su GTIN corresponde a la botella Hot Fill de 1 L, coherente con la ficha.

## Revisión de GTIN (sin modificar CP)

Tabla completa en [gtin-review-2026-09-29.csv](gtin-review-2026-09-29.csv), con GTIN de la ficha, GTIN de las tiendas, validez del dígito verificador, coincidencia de producto y acción recomendada. Resumen:

| SKU | GTIN de la ficha | Dígito válido | GTIN de las tiendas | Acción |
| --- | --- | --- | --- | --- |
| Corona Extra 330 ml | `8066145` | no | `7792798003709` | Verificar la botella; el GTIN de la ficha no es válido (Jumbo lista el mismo código interno) |
| Monster Mango Loco 473 ml | `7798422520045` | no | `7798422620045` | Verificar la lata; probable error de tipeo (Jumbo lista el mismo código) |
| Fernet Branca 750 ml | `7790290001193` | sí | `7790290101602` | Dos códigos vigentes para el mismo producto; mantener |
| Stella Artois 473 ml | `7792798010615` | sí | `7792798001293` | Mantener; confirmar qué diseño de lata compra Walter |
| Alamos Malbec 750 ml | `7794450091338` | sí | `7794450000781` | El GTIN es Reserve y el nombre no lo dice: confirmar Reserve o clásico |
| Sprite Sin Azúcar 2,25 L | `7790895641916` | sí | `7790895064166` | El GTIN de la ficha es un envase antiguo; revisar |

Ningún GTIN se cambió: hacerlo exige confirmar el código impreso en el producto que vende Walter.

## Invariantes

- Producción: precio/stock `c3f81a05…`, publicación `77fbc8e7…` y datos maestros `4b007b8b…` idénticos antes y después (lectura); 0 productos disponibles o verificados; tienda cerrada.
- Respaldos lógicos previos a cada tanda de asociaciones (productos, `catalog_assets`, cargas), fuera del repo.
- CP: 42 `catalog_assets` (uno por producto con imagen), 84 objetos en `catalog-images`, 0 en `catalog-image-staging`, 0 cargas pendientes. Los 42 pares master/miniatura responden 200 `image/webp` con el hash registrado.
- Panel real (escritorio 1366 y teléfono Pixel 7): 22/22 en las 11 imágenes de Jumbo y 4/4 en los dos reemplazos. La miniatura carga cuadrada (400×400 mostrada a 112×112), la referencia de la autorización y el enlace a la fuente son visibles, el producto sigue «No disponible · borrador», y no hay desborde ni errores de JavaScript. Capturas en `docs/catalog/visual-review/cp-images-2026-09-29/`.
- Campari conserva su atribución CC BY-SA; las 41 imágenes de tiendas no requieren crédito.
- Tests: 5 en `tests/catalog-real-images-manifest.test.mjs` (una fila por SKU, estados exactos, procedencia completa, sólo DIA, TOP y Jumbo, coincidencia con el archivo de procedencia y validador local).

## Los 4 que faltan y cómo se destraban

La lista de fotos, con el motivo de cada una, está en [PHOTO-SHOT-LIST.md](../../catalog/photo-intake/PHOTO-SHOT-LIST.md). Una foto propia resuelve Lay's y Pepsi sin pedir permiso a nadie; Cepita y Cinzano necesitan primero que Walter diga qué vende.

## Otras fuentes revisadas

- **Open Food Facts y Wikimedia Commons** (primera pasada): 104 fotos de OFF y 12 candidatos de Commons; sólo pasó Campari. Detalle en [image-rights-research-2026-09-29.json](image-rights-research-2026-09-29.json).
- **GS1 Argentina y distribuidores**: sin licencia verificable; no se contactó ni se contrató a nadie.
- **Vea, Disco y Carrefour**: se consultó sólo la existencia de los EAN; no se descargó ni se usó ninguna imagen porque no están cubiertos.
- **Carnicería**: el catálogo no tiene carnes ni productos por peso; no se generó ni asoció nada.

## Ingesta de fotos propias

Sin cambios: fotos `<sku>.jpg` en `catalog/photo-intake/`, `npm run catalog:photos:validate`, Panel → Catálogo → **Cargar fotos en lote** y aprobación del dueño con derecho `PROPIO`.
