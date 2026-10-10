# BUSQUEDA_FUENTES_RONDA3 · búsqueda de fotografías para los 89 productos pendientes

**Fecha:** 2026-10-10. Alcance: los 89 productos de la clase E de `CLASIFICACION_FINAL.csv` (marcas sin fuente permitida en el allowlist). Resultado por producto: `BUSQUEDA_PROFUNDA_89.csv`. Visor: `visor-busqueda-89.html` (fuera del repo: las imágenes se cargan desde su origen; no se descargan ni se publican).

**Regla aplicada:** el allowlist no se modificó. Ninguna foto se descargó de un host fuera del allowlist. Las imágenes fuera de alcance se muestran sólo como enlace/vista remota de revisión.

## 1. Resultado

| Resultado | Cantidad | Qué significa |
|---|---|---|
| **U · Foto exacta utilizable** | **0** | Requiere fuente autorizada **y** derechos acreditados **y** aprobación humana. Hoy ninguna cumple las tres |
| **P · Foto exacta encontrada, pendiente de autorización** | **47** | Identidad verificada (nombre + volumen + unidad, y EAN cuando hay) y foto de una fuente oficial o de supermercado. Uso no acreditado |
| **D · Foto aproximada descartada** | **13** | Hay foto, pero es otra variedad, otra marca, otro envase o una imagen de línea genérica |
| **N · No encontrada tras agotar las fuentes consultadas** | **29** | Sin foto exacta en las fuentes consultadas (con el motivo por producto) |

**Importante:** «pendiente de autorización» no quiere decir «usable». Las 47 P tienen foto exacta, pero el uso comercial no está acreditado en ningún caso. No hay evidencia archivada del acuerdo con el titular (`evidencia_documental.pendiente = true` en `autorizaciones-comerciales.json`).

## 2. Fuentes oficiales consultadas (fabricantes y distribuidores)

| Fuente | Plataforma y método | Resultado |
|---|---|---|
| **Luigi Bosca** `tienda.luigibosca.com` | VTEX, API de búsqueda; cada ficha con `Contenido` (750), unidad y EAN | **9 productos** (7 Luigi Bosca + 2 La Linda). Packshots 1200×1200 |
| **Rutini Wines** `tienda.rutiniwines.com` | Shopify, `/products.json` (243 productos) | **3 productos** (Trumpeter Reserve Malbec, Trumpeter Chardonnay, Rutini Colección Cabernet Franc Malbec). **La ficha vende «Caja x 6 botellas»**: hay que verificar que la foto sea de botella única |
| **Fratelli Branca / Brancastore** `www.brancastore.com.ar` | Tiendanube, `sitemap.xml` (132 fichas recorridas) | Sernova Candy Glow, Clásico y Wild Berries 700 ml; Carpano Rosso y Bianco 950 ml. Sernova Ice Pop sólo aparece en un combo |
| **Heredero Gin** `shop.herederogin.com` | Tiendanube, `sitemap.xml` (43 fichas) | Heredero Gin 700 ml Boysenberry (línea Pink) |
| **Santa Julia** `santajulia.com.ar` | WordPress. Lata Chenin 269 con imagen de archivo | 1 foto de lata 269 ml (contenido no verificado en ficha). Varias fichas tras **verificación de edad**: no sorteada |
| **Canciller** `canciller.com.ar` | WordPress. Página «canciller-blends» | Sólo imágenes de **línea** (blend tinto, blend dulce). Sin volumen ni etiqueta del SKU: **descartadas** |
| **Dr. Lemon** `drlemon.com.ar` | WordPress | Sólo imágenes de **campaña** («Latas», «New_*_mobile»). No son packshots: no utilizables |
| **Grupo Cepas** `grupocepas.com` | Páginas de marca | Sin packshots de Shake Pronto ni Amargo Obrero (sólo imágenes de portada) |
| **CCU Argentina** `ccu.com.ar/marcas` | WordPress. Packshots de marca | Grolsch y Miller (lata). Ambas marcas **fuera** del grupo de CCU en el allowlist. Capacidad no declarada en la imagen |
| **Finca Flichman** `flichman.com.ar` | WordPress (Sogrape). Sitio accesible | **Catálogo de producto no localizado** en las rutas estáticas |
| **Grupo Peñaflor** `grupopenaflor.com.ar` | Verificación de edad obligatoria | **No sorteada.** No se automatiza el paso de verificación de edad |
| **Cervecería Ortuzar** `cervezaortuzar.com.ar` | WooCommerce. Tienda sin fichas con imagen en la página estática | No encontrado |

## 3. Supermercados (descubrimiento e identidad, no imagen)

Consultas a las API de búsqueda VTEX de **Jumbo, Disco, Vea y Carrefour** (8 consultas por producto: 2 por tienda). Sirvieron para encontrar la presentación exacta y el EAN de tienda. **No se descargó ninguna imagen de supermercado.** Por el allowlist, los hosts de supermercado no son fuente de imagen salvo las marcas ya ampliadas (cervezas y aperitivos de Jumbo).

Límite: nuestra lista no trae EAN de referencia, así que la identidad se confirma por título y volumen, no por EAN de referencia. Varias coincidencias se corrigieron a mano (Esperado Malbec vs Syrah-Malbec, 1890 Quilmes unidad vs six pack, Julia Dulce Natural vs Chenin Dulce Natural).

## 4. Búsquedas web de EAN/GTIN (identidad)

Ver `BUSQUEDA_FUENTES_RONDA2.md`, sección 3. En esta ronda se agregó la identidad de Heredero Pink (Boysenberry) y de Dr. Lemon Red Berries 473 (EAN 7790950148848, en Coto y DIA). La página de Cepas no confirma la lata.

## 5. Estado de derechos por grupo de fuentes

| Grupo | Fuente | Host de imagen en el allowlist | Marca dentro del alcance | Derechos |
|---|---|---|---|---|
| Luigi Bosca | tienda oficial | **No** (`luigiboscaar.vteximg.com.br`) | **No** | Pendiente |
| Rutini / Trumpeter | tienda oficial | **No** (`cdn.shopify.com`) | **No** | Pendiente |
| Sernova, Carpano | Brancastore | Sí (CDN de Fratelli Branca) | **No** (el grupo sólo lista Fernet Branca) | Pendiente |
| Heredero | tienda oficial | Sí (CDN Tiendanube) | **No** (no hay grupo) | Pendiente |
| Grolsch, Miller | CCU | Sí (`www.ccu.com.ar`) | **No** (no están en la lista de marcas del grupo) | Pendiente |
| Santa Julia | sitio oficial | **No** | **No** | Pendiente |
| Supermercados | Carrefour, Disco, Vea, Jumbo | Carrefour y Jumbo: CDN sí; host de tienda no | **No** para las marcas de la lista | No acreditado; no se descargó |

## 6. Propuestas de ampliación del allowlist (NO aplicadas)

Para que el titular decida. Cada una necesita una autorización verificable para la fuente y el uso concreto, y la evidencia archivada.

1. **Luigi Bosca** (fabricante): grupo nuevo con `tienda.luigibosca.com` y CDN `luigiboscaar.vteximg.com.br`. Destraba 9 SKU.
2. **Rutini Wines** (fabricante): grupo nuevo con `tienda.rutiniwines.com` y `cdn.shopify.com/s/files/1/0756/0645/8590`. Destraba 3 SKU. Antes verificar la presentación (caja x6).
3. **Fratelli Branca**: agregar **Sernova** y **Carpano** a la lista de marcas del grupo `fratelli-branca-ar`. Destraba 5 SKU. Sernova Ice Pop tiene foto sólo en Carrefour (no se propone).
4. **Heredero Gin** (fabricante): grupo nuevo con `shop.herederogin.com`. Destraba 1 SKU.
5. **CCU**: agregar **Grolsch** y **Miller** a la lista de marcas de `ccu-argentina`. Destraba 2 SKU, con la capacidad a confirmar.
6. **Santa Julia** (fabricante): grupo nuevo, con verificación de la ficha (lata 269 ml). Destraba 1 SKU.

**No se propone** incluir Carrefour, Disco, Vea ni Coto como fuente de imagen. Son minoristas: el allowlist los rechaza (`rejectedHosts`). Se usan sólo para identidad.

## 7. Límites

- No se pudo sortear la verificación de edad de Peñaflor ni de Santa Julia. Hay que hacerla manualmente, o con permiso del titular.
- Flichman: sitio accesible, catálogo de producto no localizado. Requiere revisión manual.
- Sin EAN de referencia: la identidad de supermercado es por título.
- Stock de los 89: NO CONFIRMADO. Alcohol: cerrado por licencia.
