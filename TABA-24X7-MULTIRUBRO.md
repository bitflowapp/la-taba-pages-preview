# TABA 24/7 MULTI-RUBRO

De una tienda de bebidas a una tienda de conveniencia digital, sin dejar de ser
**un** comercio, **un** catálogo, **un** inventario y **un** checkout.

Este documento es el mapa de lo que cambió, lo que NO cambió y lo que quedó
pendiente. La evidencia de cada afirmación está en el archivo que se nombra.

---

## 1. LA AUDITORÍA: DÓNDE ESTABA ESCRITO «TABA = BEBIDAS»

Se recorrieron JS, HTML, CSS, migraciones, tests, scripts y fixtures. Los
hallazgos, clasificados como pide el encargo.

### B · Había que generalizarlo (y se generalizó)

| Dónde | Qué asumía | Consecuencia medible |
| --- | --- | --- |
| `js/core/catalog-store.js` | `TONE_BY_CATEGORY` y `UNIT_BY_CATEGORY`, dos mapas con una entrada por categoría de bebida | Una categoría ausente caía en los valores de `gaseosas`: un detergente llegaba a la vitrina etiquetado como bebida |
| `js/core/catalog-store.js` | `CATEGORY_IDS` sólo aceptaba categorías del catálogo cargado | El Panel **no tenía dónde poner una lavandina**: la validación rechazaba cualquier id que el catálogo no trajera |
| `js/core/beverage-home-sections.js` | Orden de la home y catorce secciones, las dos escritas a mano | Sumar un rubro pedía editar dos listas y acordarse de las dos |
| `js/core/catalog-search.js` | Sinónimos sólo de familias de bebida | «limpieza» y «higiene personal» no encontraban nada |
| `js/ui.js` | Glifos y orden de chips con vocabulario de **dos** taxonomías atrás | Media docena de categorías caía al icono genérico de grilla |
| `js/repositories/supabase_order_repository.js` | `tone: is_alcoholic ? 'alcoholic' : 'drink'` | Todo producto no alcohólico de producción se marcaba como bebida |
| `supabase/.../gondola_beverage_taxonomy.sql` | Vocabulario **cerrado** de 25 nombres, los 25 de bebida | **No se podía publicar una lavandina**: la fila moría con `23514` al verificarse |
| `supabase/.../business_operations_panel_rpcs.sql` | Horas `^([01][0-9]\|2[0-3]):[0-5][0-9]$` | Con `hours_enforced=true` **no existía** forma de estar abierto a las 03:00 |
| `js/business.js` | Lista de catálogo «primeros 8 + Ver los 38» | Operar cientos de productos era desplegar todo y usar el Ctrl+F del navegador |
| `js/ui.js` → `renderProducts` | La grilla dibujaba TODOS los filtrados | 22.519 nodos y 1,64 s para abrir «Todas» con 1000 SKU |
| `scripts/import-commercial-catalog.mjs` | «Un SKU desconocido no se da de alta por acá» | Abrir un rubro nuevo no tenía camino operativo |
| Copy: `index.html`, `js/config.js`, `js/ui.js`, `js/state.js` | «Tienda de bebidas», «Buscar bebidas o marcas», «Tu autoservicio de bebidas» | El título del enlace compartido anunciaba un rubro más chico que la góndola |

### C · Es de alcohol y sigue separado (no se tocó)

- `businesses.alcohol_sales_enabled`, `alcohol_minimum_age`, `alcohol_sales_start/end`,
  `alcohol_timezone`: la política de expendio, con su propia compuerta en
  `create_order`.
- Canal `alcohol` en `business_service_hours`, detrás de `alcohol_hours_enforced`:
  **filas distintas** de las de `delivery` y `pickup`.
- `ALCOHOLIC_CATEGORY_IDS`: mismo conjunto exacto de nueve ids que antes; ahora
  se deriva de la taxonomía en vez de escribirse a mano.

### A · Ya era genérico

- El checkout **no pregunta por la categoría**. `create_order` mira `is_alcoholic`
  y nada más, así que agregar un rubro no lo toca. Es la propiedad que el encargo
  pedía y ya estaba.
- `commerce_availability` y `resolve_delivery_zone`: la cobertura y la tarifa las
  decide el backend, y el navegador nunca calcula un horario.
- `catalog-store` normaliza `sku`, `external_id`, `subcategory`, `price_status`,
  `stock`, `is_active`, `is_verified`: el esquema alcanza para multi-rubro y **no
  se creó ninguna columna nueva**.

### D · Deuda irrelevante para esta misión

- El nombre del archivo `js/core/beverage-home-sections.js` y sus exportaciones
  `*Beverage*`. Renombrarlos toca 40+ importaciones, el grafo de precache del
  service worker y la identidad firmada del release, sin agregar una garantía.
  Se conservan y se agregaron alias genéricos (`buildStoreHomeSections`, …).
- El nombre de las restricciones `products_verified_canonical_beverage_category`
  y `products_verified_alcohol_coherence`: las referencian otras migraciones, dos
  scripts de plan y un ensayo pgTAP. Se corrigió el **comentario**, que es lo que
  una persona lee.

---

## 2. LA TAXONOMÍA

`js/core/store-taxonomy.js` es ahora la única declaración de una categoría:
nombre, rubro, si lleva alcohol, en qué carrusel de la home cae, qué glifo usa y
con qué palabras se la pide. Las cinco superficies la leen.

**Rubros nuevos** (ids estables, cada nombre slugifica exactamente a su id):

`snacks` · `golosinas` · `almacen` · `limpieza` · `higiene-personal` · `hogar` ·
`mascotas` · `otros`

Las catorce categorías de bebida conservan su id, su nombre y su posición: el
orden del rubro histórico se afirma **entero y como prefijo** en
`tests/beverage-home-sections.test.mjs`.

`tests/store-taxonomy.test.mjs` cruza la taxonomía contra el SQL de la migración
nombre por nombre, en las dos direcciones. Una categoría que el cliente ofrezca y
la base rechace —o al revés— rompe la prueba antes de que un producto muera
contra el CHECK.

---

## 3. OPERACIÓN 24/7

El modelo de horarios de la 20260812200000 ya distinguía los tres contratos que
el encargo pide separar: canal `delivery`, canal `pickup` y canal `alcohol`, cada
uno con su grilla, y `hours_enforced` / `alcohol_hours_enforced` /
`delivery_zone_enforced` como banderas independientes.

Lo que **faltaba** era poder escribir «abierto todo el día»:

- la tabla prohíbe `opens_at = closes_at` a propósito («cero» y «todo el día» no
  pueden escribirse igual);
- la RPC del Panel topaba en `23:59`.

Con la exigencia encendida, 24/7 sólo se lograba **apagando** `hours_enforced`,
que apaga los dos canales de venta a la vez y confunde «atiende siempre» con «no
cargó horario».

**La solución no agrega una columna ni una bandera.** El día completo se escribe
`00:00 – 24:00`: `time` admite `24:00:00` como valor máximo, la hora local de un
instante siempre es menor, y con eso la comparación que **ya existe** en
`business_is_open` da verdadero a cualquier hora sin tocar una línea de esa
función. Siete de esas filas son un canal abierto las 24 horas.

Lo único que cambia es la regla de formato de `set_business_service_hours`, que
acepta `24:00` **sólo como cierre** (migración `20260828130000`). El Panel gana el
botón «Abrir las 24 horas», porque un `<input type="time">` no puede escribir
`24:00`.

Instantes probados: **23:59, 00:00, 02:00, 05:00 y 12:00**, los siete días, en
`tests/operacion-24x7.test.mjs` (semántica de la franja) y en
`supabase/tests/horario_24x7_test.sql` (la función de la base, con el huso del
comercio).

---

## 4. ALCOHOL, DELIVERY Y NEGOCIO: TRES CONTRATOS

Fijado por prueba contra el SQL del checkout (`tests/operacion-24x7.test.mjs`):

- **El bloque de alcohol de `create_order` no menciona `hours_enforced`, ni
  `business_is_open`, ni `business_service_hours`.** Exige
  `alcohol_sales_enabled`, edad mínima, ventana y huso propios.
- La ventana horaria de alcohol, cuando se exige, consulta
  `business_is_open(business, 'alcohol', …)` — **filas distintas**, detrás de
  `alcohol_hours_enforced`.
- `BUSINESS_CLOSED` (horario) y `OUT_OF_DELIVERY_ZONE` (cobertura) son dos
  compuertas consecutivas con dos motivos distintos. Abrir de madrugada **no**
  promete una entrega.

**Que TABA abra 24 horas no vuelve comprable una cerveza a las 03:00.**

---

## 5. ESCALA: MEDIDA, NO DECLARADA

### El cuello demostrado

`linkProcurementPacks` barría el catálogo entero por cada pack de
abastecimiento. Medido con `scripts/benchmark-catalog-scale.mjs`:

| SKU | barrido | índice |
| ---: | ---: | ---: |
| 500 | 3,2 ms | 1,4 ms |
| 1000 | 9,0 ms | 2,6 ms |
| 2000 | 28,3 ms | 4,8 ms |

Crecía con el cuadrado. Indexado, crece con el tamaño.
`tests/catalog-scale.test.mjs` compara la versión rápida contra una
implementación de referencia escrita como dice la regla en palabras: «más
rápido» no fue «distinto».

### Una optimización medida y revertida

La desambiguación de nombres también se reescribió. Con un catálogo de la forma
que tiene una góndola real —una marca comparte nombre con dos o tres artículos,
no con doscientos— la versión «rápida» resultó **tres veces más lenta**: 7,1 ms
contra 1,1 ms con 2000 SKU. Se revirtió y el motivo quedó escrito en el código.

### El DOM, medido en Chromium

`scripts/benchmark-catalog-browser.mjs`, viewport 390×844, sitio servido:

| SKU | abrir catálogo (antes → después) | nodos del documento (antes → después) |
| ---: | ---: | ---: |
| 100 | 216 ms → **168 ms** | 4.056 → **3.902** |
| 500 | 684 ms → **299 ms** | 13.232 → **4.963** |
| 1000 | 1.640 ms → **437 ms** | 22.519 → **5.035** |

El documento dejó de crecer con el catálogo. La grilla se dibuja de a 120
productos con «Ver N productos más».

**El tramo es inerte para la tienda de hoy**: el catálogo publicado tiene 80
productos visibles, así que no corta nada y empieza a trabajar recién cuando el
catálogo pasa de 120. El primer intento usó 60 y cortaba el catálogo actual por
la mitad, dejando los veinte productos que esperan precio detrás de un botón que
nadie pidió; lo encontró `tests/e2e/taba2-unit-catalog.spec.mjs`, que busca la
unidad de 1,5 L en la grilla y dejó de encontrarla.

**No es virtualización**: no hay ventana deslizante, ni altura calculada, ni
posicionamiento absoluto. Se eligió así porque la virtualización rompe el Ctrl+F
del navegador y el enlace a un producto, y porque lo que la medición señala es el
costo de **construir** mil tarjetas, que un tramo ya elimina.

**El filtro no se pagina**: la búsqueda y la categoría siguen corriendo sobre el
catálogo entero, y el contador de arriba dice el total.

---

## 6. IMPORTADOR: ALTA PROPUESTA

`scripts/import-commercial-catalog.mjs` acepta cinco columnas más —`nombre`,
`categoria`, `subcategoria`, `alcohol`, `imagen`— y con ellas puede proponer
productos nuevos. **El modo se enciende con el encabezado**: o están las cinco, o
el comportamiento es el de siempre (un SKU desconocido es un error).

El dry-run distingue cuatro cosas: **MODIFICACIÓN**, **SIN CAMBIO**, **RECHAZO** y
**ALTA PROPUESTA**, y para un alta escribe la ficha completa campo por campo,
porque no hay un «antes» que diffear.

Prohibiciones, cada una con su ensayo en `tests/commercial-import-altas.test.mjs`:

- **no convierte normal → alcohol ni alcohol → normal**: un SKU conocido es una
  modificación y las columnas de alta se ignoran; sólo viajan precio, stock y
  publicación;
- **no publica alcohol**: un alta nace **siempre oculta**, y el importador lo dice
  en vez de ignorar la celda;
- **no crea SKU duplicados**: ni contra el catálogo ni dentro de la planilla;
- **no sobrescribe por nombre**: el apareo es por SKU, y un alta que duplicaría un
  nombre existente se rechaza nombrando el SKU que ya lo tiene;
- **no inserta una fila sólo porque tiene un nombre**: SKU estable, nombre,
  categoría de la taxonomía y clasificación alcohólica **explícita** son
  obligatorios. El alcohol nunca se infiere.

Aplicar es **una sola llamada**: `apply_commercial_catalog_plan` (migración
`20260828140000`) crea las altas y delega las modificaciones a
`apply_commercial_catalog_batch` **en la misma transacción**. Todo o nada.

---

## 7. PANEL DEL NEGOCIO

Búsqueda por nombre, marca, SKU, categoría y subcategoría; filtro por góndola
—derivado de lo que el comercio **tiene**, no de la taxonomía completa— y filtro
por estado: visibles, pausados, stock bajo (1 a 5) y sin stock. El SKU se ve en
cada fila.

No es un ERP: no hay columnas configurables, ni exportación, ni edición masiva.
Lo que resuelve es el camino de todos los días —encontrar, tocar, guardar—.

---

## 8. LO QUE NO CAMBIÓ

- **Mercado Pago: DISABLED.** No se cargó ningún secreto, no se creó ninguna fila
  de `business_payment_settings`, no se tocó ninguna Edge Function.
- **`alcohol_sales_enabled = false`**, y ninguna migración de este trabajo lo
  escribe. `0 alcohol comprable`.
- **Ninguna fila de producción se modificó.** Las tres migraciones nuevas amplían
  vocabulario y agregan una función: no hay un solo `update` sobre datos.
- **Ningún producto, precio, stock, promoción ni horario inventado.**
- **Ninguna imagen generada.** La política de imágenes reales sigue intacta y
  `commercial:gate` sigue detectando un comprable sin foto.
- Carrito, checkout, dirección, delivery, pickup, pedidos, inventario, tracking y
  la compuerta de alcohol: sin cambios de contrato.

---

## 9. LO QUE QUEDÓ PENDIENTE

- **Aplicar las migraciones.** Las tres pasan la revisión estática
  (`npm run migrations:validate`) y no se aplicaron a ninguna base: el entorno
  cloud no tiene Supabase local ni credenciales de staging. Van por el pipeline
  normal del repositorio.
- **`supabase/tests/horario_24x7_test.sql`** (14 aserciones pgTAP) no pudo
  correrse: necesita `supabase test db --local`. Está registrado como
  `npm run test:db:24x7`.
- **Cargar los rubros nuevos.** Este trabajo abre el camino; no da de alta un solo
  producto. Snacks, golosinas, almacén, limpieza, higiene, hogar y mascotas
  siguen vacíos hasta que el comercio cargue su góndola.
- **La segunda pasada de publicación.** Un alta nace oculta por diseño; publicarla
  exige `is_verified`, que a su vez exige la ficha de identidad comercial
  completa. El camino existe (la misma planilla con el SKU ya cargado) y no se
  ejercitó contra una base real.
