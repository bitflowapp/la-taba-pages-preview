# Controlled Production: imágenes reales del catálogo — 2026-09

Última revisión: 2026-09-28 (misión «cerrar catálogo real de imágenes end-to-end»). Proyecto `tkanbadcglszlcyfjvpv`, negocio `e7850ad2-a447-402c-8375-3fd74e9466ba`. No se crearon productos ni se tocó precio, stock, publicación, Mercado Pago, ARCA, Rider, LocalAgent, `print_jobs`, checkout, pedidos ni roles.

## Resultado

| Medición | Resultado |
| --- | ---: |
| `PRODUCTS_IN_CP` | 46 |
| `PRODUCTS_WITH_REAL_IMAGES` / `PRODUCTS_PENDING_IMAGE` | 0 / 46 |
| `CANARY_COMPLETED` | 0/9 |
| `RIGHTS_VERIFIED` | 1 (Campari Bitter 750 ml, no canary) |
| `RIGHTS_REVIEW_REQUIRED` | 41 |
| `REPLACE_REQUIRED` | 4 (Heineken 710, Lay's 134 g, Cinzano 950, Corona 330) |
| `REVIEW_REQUIRED` | 0 (los 46 tienen revisión visual documentada) |
| `PRODUCTS_PUBLIC` / `DUPLICATES` | 0 / 0 |
| `PRICE_VALUES_CHANGED` / `STOCK_VALUES_CHANGED` | 0 / 0 |
| `ANON_PUBLIC_CHECK` | PASS: HTTP 200, 0 filas; listado anónimo de `catalog-images` vacío |
| `OWNER_SESSION` | Pendiente: la ventana dedicada del Panel sigue en «Ingresá con tu cuenta» |

La única imagen con derechos verificados no se asoció todavía porque la carga, la vista previa y la aprobación se hacen desde el Panel con sesión OWNER/ADMIN, y esa sesión no se inició. El archivo está preparado y el procedimiento está en [Cómo terminar](#cómo-terminar).

## Por qué casi todo sigue bloqueado por derechos

El bloqueo es el mismo en las 45 fichas restantes: las fotos limpias y exactas de cada presentación sólo existen en canales del titular (sitio oficial, tienda oficial, renders que la marca entrega al retail), y ninguno publica una licencia que permita a otra tienda reutilizarlas. Los términos revisados dicen lo contrario:

| Titular | Fichas | Términos revisados | Qué dicen |
| --- | ---: | --- | --- |
| Sistema Coca-Cola (Coca-Cola, Sprite, Fanta, Schweppes, Bonaqua, Cepita) | 10 | [coca-cola.com/ar · términos](https://www.coca-cola.com/ar/es/legal/terms-of-service) | Uso personal y exclusivamente no comercial; prohíbe reproducir o descargar contenido y usar marcas sin permiso escrito |
| PepsiCo (Pepsi Black, Paso de los Toros, Lay's, Doritos, Pehuamar) | 8 | [PepsiCo · términos del grupo](https://www.pepsico.com.mx/legal/terminos-de-uso) | Uso personal no comercial; `pepsico.com.ar` no resolvió DNS desde este equipo |
| Cervecería y Maltería Quilmes (Quilmes, Brahma, Stella Artois, Patagonia, Corona, Glaciar) | 7 | [quilmes.com.ar · términos](https://www.quilmes.com.ar/terminos-y-condiciones) | Material sólo para uso personal no comercial (la página responde 403 a lectura automática; verificado por búsqueda) |
| Heineken / CCU (Heineken, Imperial, Schneider) | 3 | [heineken.com · condiciones](https://www2.heineken.com/es/terms-of-use-and-privacy) | El acceso no implica licencia; se reservan reproducción y distribución |
| Danone (Villavicencio) | 1 | [danone.com.ar · términos](https://corporate.danone.com.ar/ar/footer/links/terminos-y-condiciones/) | Uso personal no comercial; sin reproducción sin consentimiento escrito |
| Red Bull | 1 | [Red Bull · términos](https://policies.redbull.com/policies/RedBull.com_International/202003040354/en/terms.html) | Licencia privada/no comercial |
| Monster (Mango Loco, Ultra) | 2 | [Monster · términos](https://www.monsterenergy.com/en-us/terms-of-use/) | Licencia personal y no comercial |
| Fratelli Branca (Fernet, Branca Menta) | 2 | [Branca Store · términos](https://www.brancastore.com.ar/terminos-y-condiciones/) | Prohíbe reproducir imágenes y fotografías sin autorización escrita |
| Campari Group (Campari, Aperol, Cinzano) | 3 | [Campari Group · términos](https://www.camparigroup.info/usa/terms-conditions/) | Todo uso o reproducción requiere autorización escrita |
| Bodegas (Alamos, Norton, Trapiche x2, Santa Julia) | 5 | [Santa Julia · kit de prensa](https://santajulia.com.ar/press-kit/) | Santa Julia publica imágenes de botellas para prensa, sin términos; las otras bodegas no publican licencia |
| Marcas locales (Eco de los Andes, Speed, Maní King, Hielo Cristal) | 4 | — | No se encontró licencia publicada |

No se infirió permiso por el dominio oficial ni por el kit de prensa. La autorización declarada `TABA-AUT-2026-08-001` (catalog/autorizaciones-comerciales.json) sigue sin documento: con el acuerdo o el paquete de packshots de cada marca, esas imágenes pasarían a `PERMISO_DOCUMENTADO`.

## Fuentes con licencia abierta revisadas

- **Open Food Facts**: las imágenes están bajo CC BY-SA 3.0 ([términos](https://world.openfoodfacts.org/terms-of-use)), que permite uso comercial con atribución y licencia igual. Se buscó cada GTIN: 35 de 46 tienen ficha. Casi todas son fotos amateur: producto en la mano, góndola, recortes de etiqueta, botellas a medio consumir, ediciones limitadas o diseños viejos.
- **Wikimedia Commons / Openverse**: búsqueda por marca y por nombre + presentación. Sólo aparecieron fotos que no sirven: Quilmes Clásica 473 cm³ (el SKU es 710), una lata de Heineken en el pasto, góndolas de Fernet y Branca Menta, y una etiqueta de Alamos de la cosecha 2005.
- **Fotos propias**: `catalog/photo-intake/` sólo tiene su README en este worktree y en todos los demás worktrees de La Taba. `catalog/photo-capture/` tiene la guía y la lista de tomas, sin fotos.

La única candidata que pasó derechos, identidad y revisión visual:

| SKU | Fuente | Derechos | Identidad | Visual |
| --- | --- | --- | --- | --- |
| `campari-bitter-750ml` | [Open Food Facts 7791200200781](https://world.openfoodfacts.org/product/7791200200781), foto de `smoothie-app`, 2026-04-24 | CC BY-SA 3.0, atribución obligatoria | Etiqueta legible «Cont. Neto 750 ml», «Industria Argentina», 28,5 % vol. | Botella completa; fondo reemplazado por blanco con un modelo local (u2net), sin retocar el producto; leve desenfoque en la base |

Otras tres fotos se recortaron y se descartaron: Pepsi Black 1,5 L arrastra bordes de otras botellas y corta la tapa, Maní King tiene un reflejo sobre el logo con 384×612 px de producto, y el frente limpio de Cepita Naranja muestra el diseño anterior del envase.

## Canary

| SKU | Estado | Bloqueo concreto |
| --- | --- | --- |
| `coca-cola-original-2250ml-local` | `RIGHTS_REVIEW_REQUIRED` | Render limpio sólo de Coca-Cola/retail; en OFF la foto entera corta la tapa |
| `coca-cola-sin-azucar-2250ml-local` | `RIGHTS_REVIEW_REQUIRED` | Render limpio sólo de Coca-Cola/retail; en OFF la botella está a medio consumir |
| `sprite-sin-azucar-2250ml-local` | `RIGHTS_REVIEW_REQUIRED` | Render limpio sólo de Coca-Cola/retail; OFF sin ficha |
| `fanta-naranja-2250ml` | `RIGHTS_REVIEW_REQUIRED` | Render limpio sólo de Coca-Cola/retail; en OFF la botella está casi vacía |
| `villavicencio-sin-gas-500ml` | `RIGHTS_REVIEW_REQUIRED` | Danone prohíbe reproducir; en OFF la botella está en la mano |
| `red-bull-energy-drink-355ml` | `RIGHTS_REVIEW_REQUIRED` | Red Bull: licencia no comercial; en OFF la lata está en la mano |
| `quilmes-clasica-710ml` | `RIGHTS_REVIEW_REQUIRED` | La placa lateral del render es recortable, pero Quilmes no licencia; Commons sólo tiene la lata de 473 |
| `heineken-710ml` | `REPLACE_REQUIRED` | Ninguna imagen muestra la lata 710 completa; además faltan derechos |
| `fernet-branca-750ml` | `RIGHTS_REVIEW_REQUIRED` | Branca prohíbe reproducir; en OFF la botella está en la mano |

Siete de las nueve fichas coinciden visualmente con una imagen de referencia, pero no tienen derechos. Quilmes dejó de estar en `REPLACE_REQUIRED` porque su placa lateral no pisa el envase.

## Resto del catálogo

Detalle por SKU (fuente revisada, términos, veredicto de Open Food Facts, estado y cómo destrabarlo) en [real-catalog-images.csv](../../catalog/real-catalog-images.csv) y [image-rights-research-2026-09-27.json](image-rights-research-2026-09-27.json).

- `REPLACE_REQUIRED`:
  - Heineken 710: la referencia recorta la lata.
  - Lay's Clásicas 134 g: la referencia es la edición especial FIFA Qatar 2022, no la bolsa estándar vigente; la foto de OFF corta la bolsa.
  - Cinzano Rosso 950 ml: la referencia recorta la botella, y OFF declara 1000 ml.
  - Corona Extra 330 ml: no hay imagen en retail, y OFF mezcla botellas de 12 fl oz de EE. UU.
- Corrección de ficha detectada, sin aplicar: `cepita-naranja-1000ml` tiene `packaging_type=Botella`, pero el GTIN 7790895648267 es un Tetra Brik de 1 L. Hay que corregirla antes de asociarle una imagen.
- Carnes: el catálogo de CP no tiene cortes de carne, así que no aplica.

## Cómo terminar

1. **Sesión**: iniciar sesión OWNER/ADMIN en la ventana dedicada del Panel. Esa ventana es un perfil aparte de Chrome con depuración local, abierto en `/#business`.
2. **Campari**, en el Panel:
   1. Catálogo → «Campari Bitter 750 ml» → Imagen.
   2. Archivo: el recorte preparado.
   3. Tipo de fuente: «Retail de referencia», porque el pipeline no tiene la categoría «licencia abierta».
   4. URL de origen: la de la foto en Open Food Facts.
   5. «Subir para revisión» → «Vista previa privada» → Derecho de uso «Licencia comercial» con la referencia CC BY-SA → «Aprobar y asociar».
   6. Verificar después: el producto sigue en borrador y hay 0 productos públicos.
3. **Atribución antes de publicar Campari**: mostrar «Foto: Open Food Facts (smoothie-app), CC BY-SA 3.0» con enlace a la ficha, o reemplazarla por foto propia.
4. **Las 45 restantes**, cualquiera de estos caminos:
   - Fotos propias con [la guía de captura](../../catalog/photo-capture/PHOTO_CAPTURE_GUIDE.md), subidas con fuente «Foto propia» y derecho `PROPIO`. Es el camino más rápido y el único que no depende de terceros.
   - Permiso escrito de cada titular o distribuidor oficial, o su paquete de packshots, que documentaría `TABA-AUT-2026-08-001` como `PERMISO_DOCUMENTADO`.
   - Suscripción al catálogo electrónico de GS1 Argentina, que distribuye imágenes de los fabricantes a los comercios.

## Atribución de fotos con licencia abierta

PR [#119](https://github.com/bitflowapp/la-taba-pages-preview/pull/119) agrega el soporte mínimo para cumplir CC BY-SA sin cambiar el diseño:

- **Registro del crédito**: `js/core/image-attribution.js` guarda autor, fuente, enlace a la fuente, licencia, enlace a la licencia y cambios.
  - Está indexado por el SHA-256 del archivo original aprobado (`products.source_image_sha256`).
  - Si la foto se reemplaza, el crédito deja de aplicarse solo.
  - La base conserva la misma evidencia en `catalog_assets.rights_reference`.
- **Ficha pública**: muestra «Foto: Open Food Facts (smoothie-app) · CC BY-SA 3.0 · fondo reemplazado por blanco». La fuente y la licencia van enlazadas, y el crédito sólo aparece junto a la foto oficial.
- **Guarda en el Panel**: no ofrece «Publicar» si la revisión aprobada declara una licencia CC y la tienda no tiene su crédito. El gestor de imagen indica si el crédito está listo.
- **Tests**:
  - 9 tests unitarios.
  - E2E en Chromium y WebKit (iPhone 13): 4/4.
  - `npm test`: 2688/2689, con el flake conocido `rider-pilot-target-gate`, que pasa aislado.
  - `npm run check` en verde.
- **Estado**: no desplegado. Hay que desplegarlo antes de publicar cualquier producto con foto CC BY-SA. Hoy Campari no puede publicarse: está en borrador, con precio pendiente y sin venta de alcohol habilitada.

El mismo PR corrige un bug del Panel: `listCatalogProducts` no pedía `image_thumbnail_url`. Por eso una imagen aprobada aparecía como «Sin imagen aprobada» en el gestor de imágenes.

## GS1 Argentina

- **Opción**: `REQUIRES_CONTACT`.
- **Qué es**: GS1 Argentina ofrece sincronización de datos (GDSN) y el catálogo electrónico DATA.COD, operado por E-Way.
  - Los proveedores publican los datos de cada GTIN, con hasta 4 imágenes; los reciben cadenas, mayoristas y retail online.
  - Las condiciones de uso de las imágenes las fija cada proveedor.
- **Requisitos**:
  - Asociarse a GS1 Argentina: formularios AD010 a AD013; razón social, CUIT, GLN y cuota según el tamaño.
  - Suscribirse como receptor.
  - Que cada marca publique sus productos en ámbito público o autorice a La Taba en ámbito privado.
- **Costo**: no publicado; la cuota se informa a pedido. La única tabla pública es de DATA.COD en 2007 y no está vigente.
- **Integración**: ya tenemos el GTIN de referencia de los 46 SKU. El camino sería pedir el catálogo por GTIN, descargar la imagen del proveedor y subirla por el mismo pipeline con derecho `PERMISO_DOCUMENTADO`, citando el acuerdo.
- **Qué no sirve**: NegociAR (una red para que las pymes ofrezcan productos a supermercados) y Verified by GS1 (consulta de identidad) no son fuentes de imágenes con licencia.
- **Acción humana**: contactar a GS1 Argentina (info@gs1.org.ar) y aprobar el costo. No se contrató nada.

## Distribuidores y recursos B2B

- **BEES (Quilmes)**: cubre cervezas, aguas, Pepsi y Red Bull.
- **Mi Coca-Cola / Coca-Cola Andina B2B**: cubre el sistema Coca-Cola.
- **CCU**: cubre Heineken, Imperial y Schneider.
- **Mayoristas de Neuquén**: usan las mismas imágenes de marca y no pueden ceder derechos que no tienen.

Los tres portales de marca requieren cuenta de cliente y no publican condiciones que habiliten usar sus imágenes en la tienda propia. Red Bull Content Pool es libre sólo para uso editorial: el uso comercial se licencia a pedido y con precio. El camino es pedir permiso escrito al representante comercial de cada marca.

## Cepita Naranja

- **Estado**: `CEPITA_PACKAGING: BUG_CONFIRMED`, registrado en el issue [#118](https://github.com/bitflowapp/la-taba-pages-preview/issues/118).
- **Inconsistencia**: la ficha dice `Botella`, pero su referencia (GTIN 7790895648267) es un Tetra Brik de 1 L.
- **Por qué no se corrigió**: el sistema Coca-Cola vende cuatro «Cepita Naranja» de cerca de 1 L (dos Tetra Brik, uno en botella PET de 1 L y otro de 995 ml). La corrección depende de cuál vende el local.
- **Qué se hizo**: nada en la base; tampoco se le asoció imagen.

## Fotos propias

[catalog/photo-capture/README.md](../../catalog/photo-capture/README.md) es la guía simple para Marco y Walter. Pide:

- una foto del frente;
- luz natural, sin flash;
- fondo liso;
- el producto entero;
- sin manos, sin precios y sin otros objetos;
- el archivo original, sin comprimir por WhatsApp.

La guía trae el nombre de archivo de los 46 SKU. El catálogo de CP no tiene carnes; si se suman, cada corte necesita su propia foto.

## Pipeline, respaldo y observaciones técnicas

- **Pipeline**: el de PR [#116](https://github.com/bitflowapp/la-taba-pages-preview/pull/116) (merge `1e6d106`). CP sirve `la-taba-runtime-v126-catalog-image-pipeline`.
  - `catalog-image-staging` es privado; `catalog-images` es público y sólo recibe imágenes aprobadas.
  - La Edge Function es `catalog-image-manager` con `verify_jwt=true`.
  - No se construyó infraestructura nueva.
- **Respaldo previo a cualquier escritura** (fuera del repo):
  - Archivo: `controlled-production-catalog-before-images-2026-09-27.json`, en la carpeta privada `catalog-image-backups-2026-09-27/` junto a los worktrees de La Taba (fuera del repo).
  - SHA-256 `28715EFD5F0A6AB36E36ABF7831F50D2C7FFAFF346616B58872B13BC833433E3`, verificado de nuevo el 2026-09-27.
- **Huellas de solo lectura del 2026-09-28 02:3x UTC**, para comprobar que no cambiaron precio, stock ni publicación:
  - precio/stock `1da03ffce4f6f0730b412706e1cda9e0`;
  - publicación `e6d1ba5dc6a473ad18500611fc6d793a`;
  - 0 cargas, 0 `catalog_assets` y 0 objetos en los dos buckets.
- **`source_type`**: el enum no tiene una categoría de licencia abierta, así que una foto CC BY-SA sólo puede registrarse como `retail_reference`. La procedencia real queda en `source_url` y `rights_reference`. Una mejora futura sería agregar `open_license` (migración + contrato + Panel). No se hizo porque no es un bug que bloquee la carga.
- **Migraciones**: CP registra `20260927195533_catalog_image_storage_pipeline`, pero el repo tiene `20260927175058_…`. Hay que reconciliarlas con `migration repair` antes de cualquier `db push`. Esta misión no hizo ningún `db push`.
- **Secretos**: el PAT de CP se leyó del Credential Manager en memoria y nunca se imprimió. La clave publicable sólo se usó para la consulta anónima. No se leyeron ni guardaron contraseñas.
