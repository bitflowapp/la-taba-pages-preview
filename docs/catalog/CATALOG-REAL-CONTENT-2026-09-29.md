# La Taba: contenido real del catálogo, cierre 2026-09-29

Misión de contenido, sin cambios de código de producto: Rider, Panel, frontend, Caja Clara y backend no se tocaron. Proyecto CP `tkanbadcglszlcyfjvpv`, negocio `e7850ad2-a447-402c-8375-3fd74e9466ba`. Base: `main` `1358188`.

Hubo dos pasadas el mismo día. La primera partió de que La Taba no tenía autorización para reutilizar fotos de comercios y terminó en 1/46. El titular corrigió esa premisa (La Taba sí está autorizada a usar imágenes de los supermercados que el proyecto autoriza) y la segunda pasada reevaluó los 39 productos que estaban en `RIGHTS_PERMISSION_REQUIRED`.

## Veredicto

| Medición | Resultado |
| --- | --- |
| `CATALOG_REAL_CONTENT_READY` | **PARTIAL** |
| `REAL_IMAGE_COVERAGE` | **31/46**: Campari (Open Food Facts, CC BY-SA 3.0) y 30 imágenes de Supermercados DIA y TOP |
| Faltan | 15: 13 necesitan foto propia y 2 necesitan confirmación de producto |
| Canary | 8/12 con imagen real |
| Estado de venta | Nada cambió: 0 productos públicos, tienda cerrada, todos los productos con imagen siguen en borrador |

## Autorización y alcance

La ampliación del 2026-09-29 quedó registrada en [autorizaciones-comerciales.json](../../catalog/autorizaciones-comerciales.json) con `authorization_basis = AUTHORIZED_RETAIL_SOURCE`. Cubre **sólo** las fuentes que el titular nombró: Supermercados DIA (`diaonline.supermercadosdia.com.ar`) y Supermercados TOP (`www.supertop.com.ar`). No se extendió a fabricantes, fotógrafos, marketplaces, otros supermercados, distribuidores ni sitios de terceros. Un test verifica que ninguna imagen aprobada salga de otro host.

Queda pendiente para el titular el documento del acuerdo que respalde la declaración y la confirmación por escrito de qué otros comercios están cubiertos.

## Cómo se eligió cada imagen

1. **Búsqueda por EAN** en los catálogos VTEX públicos de DIA y TOP para los 46 GTIN (y por nombre exacto cuando el EAN no aparecía). 39 SKU tuvieron alguna imagen candidata.
2. **Exactitud antes que derecho**: se descartaron la lata de 473 ml para el SKU de 710, la 0.0, la edición Vintage de Stella, la edición mundialista de Quilmes, la edición FIFA de Lay's 40 g y los renders que son recortes de etiqueta o dorsos.
3. **Placa de la tienda**: DIA y TOP superponen una placa lateral o inferior con el volumen. Se retiró sólo cuando cae fuera del envase. Si tapa la base o se ve a través de una botella translúcida (Red Bull, Pepsi Black, Paso de los Toros Tónica) o hay un halo pegado a la bolsa (Lay's 134 g), se rechazó, porque no se puede quitar sin tocar el envase.
4. **Envase actual**: el render de DIA de Coca-Cola Sin Azúcar 2,25 L y el de Sprite de 600 ml muestran el envase anterior «Zero», mientras el catálogo los llama «Sin Azúcar» (las fotos de Open Food Facts de 2021 a 2023 ya muestran «Sin azúcar»). Se rechazaron.
5. **Procesamiento**: recorte de la placa, centrado sobre blanco 1000×1000 (sin ampliar más de 1,15 veces) y WebP q90 con miniatura de 400 px. El envase no se retocó.
6. **Flujo oficial**: staging privado, vista previa (el hash de la vista previa se comparó con el archivo ya revisado), aprobación con `LICENCIA_COMERCIAL` y una referencia que cita la autorización, la tienda y el EAN, y asociación. Ninguna escritura directa en la base.
7. **Control visual**: cada imagen se miró a ojo antes de subirla y de nuevo desde el bucket público, contra nombre, volumen y GTIN. Los volúmenes que se leen en el propio envase (710 en Heineken, Quilmes y Schneider; 473 en Speed y Monster; 100 g en Maní King) coinciden con la ficha.

El detalle de cada asset (URL, fecha, EAN de la fuente, hashes, cómo se adaptó, upload y asset) está en [retail-authorized-images-2026-09-29.json](retail-authorized-images-2026-09-29.json) y en [real-catalog-images.csv](../../catalog/real-catalog-images.csv).

## Clasificación de los 46 SKU

| Estado | SKU |
| --- | ---: |
| `APPROVED_REAL_IMAGE` | 31 |
| `PHOTO_REQUIRED_FROM_STORE` | 6 |
| `EXACT_PRODUCT_NOT_FOUND` | 7 |
| `PRODUCT_CONFIRMATION_REQUIRED` | 2 |
| `READY_FOR_OWNER_APPROVAL` / `RIGHTS_PERMISSION_REQUIRED` | 0 / 0 |

- **Aprobadas por GTIN exacto (26)**: el EAN de la ficha coincide con el de la tienda.
- **Aprobadas por nombre, volumen y variante con GTIN distinto (5)**: el nombre y el volumen coinciden, pero el GTIN del catálogo no es el que vende la tienda. Conviene revisar esos GTIN de la ficha, sin cambiarlos a ciegas:
  - Corona Extra 330 ml: el GTIN `8066145` no es un EAN válido; las tiendas venden `7792798003709`.
  - Fernet Branca 750 ml: catálogo `7790290001193`, tiendas `7790290101602`; los dos son el producto de 750 ml.
  - Stella Artois 473 ml: catálogo `7792798010615`, las tiendas listan otros EAN de la lata estándar.
  - Monster Mango Loco 473 ml: el GTIN `7798422520045` tiene el dígito verificador mal; el vigente es `7798422620045`.
  - Alamos Malbec 750 ml: el GTIN de la ficha no aparece en las tiendas; DIA vende el mismo vino con `7794450000781`.
- **`PHOTO_REQUIRED_FROM_STORE` (6)**: Lay's 134 g, Coca-Cola Sin Azúcar 2,25 L, Sprite Sin Azúcar 600 ml, Red Bull 355 ml, Pepsi Black 1,5 L y Paso de los Toros Tónica 1,5 L.
- **`EXACT_PRODUCT_NOT_FOUND` (7)**: Sprite Sin Azúcar 2,25 L, Pepsi Black 2,25 L, Bonaqua 2,25 L, Glaciar sin gas 1,5 L, Hielo Cristal 4 kg, Pehuamar Palitos 90 g y Trapiche Cabernet Sauvignon 750 ml: las tiendas autorizadas no venden esa presentación.
- **`PRODUCT_CONFIRMATION_REQUIRED` (2)**:
  - Cepita Naranja: el GTIN de la ficha es el Tetra Brik de 1 L, pero `packaging_type` dice Botella (issue #118). Para la botella Hot Fill las tiendas usan otro GTIN. No se asoció nada.
  - Cinzano Rosso: el catálogo dice 950 ml y las dos tiendas venden ese mismo GTIN como 1000 ml.
- **Cepita Durazno** sí se aprobó: su GTIN corresponde a la botella Hot Fill de 1 L (TOP), coherente con la ficha. La inconsistencia sólo afecta a Naranja.

## Los 15 que faltan y cómo se destraban

La lista de fotos a sacar, con el motivo de cada una, está en [PHOTO-SHOT-LIST.md](../../catalog/photo-intake/PHOTO-SHOT-LIST.md). Una foto propia resuelve los 13 sin pedir permiso a nadie. Los 2 de confirmación necesitan que Walter diga qué vende y, después, foto propia.

Una sonda **sólo de referencia** mostró que Jumbo, Vea, Disco y Carrefour tienen los 13 SKU pendientes con su EAN. No se descargó ni se usó ninguna imagen de esas cadenas porque la autorización, tal como se declaró, sólo nombra a DIA y TOP. Si el titular confirma que otras cadenas están cubiertas, esos SKU se pueden reevaluar con el mismo procedimiento.

## Otras fuentes revisadas

- **Open Food Facts y Wikimedia Commons** (primera pasada): 104 fotos de OFF y 12 candidatos de Commons; sólo pasó Campari. Detalle en [image-rights-research-2026-09-29.json](image-rights-research-2026-09-29.json).
- **GS1 Argentina y distribuidores**: sin licencia verificable de reutilización; no se contactó ni se contrató a nadie.
- **Fotos propias**: `catalog/photo-intake/` y `catalog/photo-capture/` no tienen fotos.
- **Carnicería**: el catálogo no tiene carnes ni productos por peso; no se generó ni asoció nada.

## Invariantes

- Producción: precio/stock `c3f81a05…` y publicación `77fbc8e7…` idénticos antes y después (lectura), 0 productos disponibles o verificados, tienda cerrada.
- Respaldo lógico previo a las asociaciones (productos, `catalog_assets`, cargas), fuera del repo.
- CP: 31 `catalog_assets` (uno por producto con imagen), 62 objetos en `catalog-images`, 0 en `catalog-image-staging`. Los 31 pares master/miniatura responden 200 `image/webp` con el hash registrado.
- Cargas: 30 aprobadas en esta pasada y una rechazada por una interrupción transitoria de la subida de Maní King (se reintentó y quedó aprobada).
- Panel real (escritorio 1366 y teléfono Pixel 7): el gestor de imagen muestra la miniatura asociada, la referencia de la autorización y el enlace a la fuente original; sin desborde ni errores de JavaScript. Capturas en `docs/catalog/visual-review/cp-images-2026-09-29/`.
- Campari conserva su atribución CC BY-SA; las 30 imágenes de tiendas no requieren crédito.
- Tests: 5 en `tests/catalog-real-images-manifest.test.mjs` (una fila por SKU, estados exactos, procedencia completa, sólo DIA y TOP, coincidencia con el archivo de procedencia y validador local).

## Ingesta de fotos propias

Sin cambios respecto de la primera pasada: fotos `<sku>.jpg` en `catalog/photo-intake/`, `npm run catalog:photos:validate`, Panel → Catálogo → **Cargar fotos en lote** y aprobación del dueño con derecho `PROPIO`.
