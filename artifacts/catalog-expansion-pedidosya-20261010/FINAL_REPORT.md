# FINAL_REPORT · expansión del catálogo con PedidosYa Market Neuquén · ronda 2 · 2026-10-10

**Estado:** preparado para aprobación. **No hay productos creados, ni precios aplicados, ni stock, ni imágenes aprobadas por una persona.** No se mergeó ni se desplegó nada.


## Ronda 3 · búsqueda de fotos para los 89 pendientes

Resultado por producto en `BUSQUEDA_PROFUNDA_89.csv`; método y fuentes en `BUSQUEDA_FUENTES_RONDA3.md`.

- **U · utilizable: 0.** Ninguna foto cumple a la vez fuente autorizada, derechos acreditados y aprobación humana.
- **P · exacta, pendiente de autorización: 47.** Identidad verificada (nombre, volumen, unidad y EAN cuando hay). Derechos no acreditados: no publicar.
- **D · aproximada descartada: 13.** Otra variedad, otra marca, otro envase o imagen de línea genérica.
- **N · no encontrada tras agotar las fuentes consultadas: 29.** Con el motivo por producto.

Fuentes que dieron fotos exactas: Luigi Bosca (9), Rutini/Trumpeter (3, con la advertencia de caja x6), Brancastore (Sernova y Carpano, 5), Heredero (1), Santa Julia (1), CCU (Grolsch y Miller, 2, capacidad a confirmar), y supermercados sólo para identidad. Ninguna imagen se descargó de un host fuera del allowlist. Propuestas de ampliación en `BUSQUEDA_FUENTES_RONDA3.md` (sección 6), sin aplicar.

## 1. Decisiones de la ronda 2 y su estado

| # | Decisión | Estado |
|---|---|---|
| 1 | Los 7 precios PedidosYa aprobados como **precios objetivo** | Registrado en `catalog/price-overrides-pedidosya-20261010.mjs` (`DECISION_COMERCIAL`). **Aplicación productiva BLOQUEADA** hasta: costo real, checkout y procedimiento de publicación |
| 2 | Revisión individual de las plausibles en un visor | Hecho: `visor-revision-imagenes.html` (fuera del repo). **Sin firmas**: sólo guarda decisiones en el navegador y las exporta |
| 3 | Investigar más fuentes sin copiar fuera de derechos | Hecho. Ver `BUSQUEDA_FUENTES_RONDA2.md`. Allowlist **no** modificado; propuesta en `PROPUESTA_AMPLIACION_ALLOWLIST_NO_APLICADA.md` |
| 4 | Conservar las 7 fichas del pool | Hecho: 7 exactos + 3 probables (Schneider, Campari, Smirnoff) **no se crean**; se usa la ficha del pool |
| 5 | Duplicados probables con EAN/GTIN y etiqueta | Hecho con EAN de comercios (no oficiales). Resultado: 3 duplicados probables, 2 **no duplicados** (Trumpeter Reserva, Rutini Cabernet Franc Malbec). Falta confirmar con la etiqueta física |
| 6 | Gancia Lima Limón Hibiscus y Vodka Hibiscus pendientes | Hecho: **pendientes**. El EAN 7790950144826 es «Vodka Spritz Hibiscus»; no apareció ningún «Lima Limón Hibiscus» |
| 7 | Sin stock confirmado, pendiente | Hecho: stock «NO CONFIRMADO» en los 134 |

## 2. Clasificación final de los 134 candidatos

| Clase | Qué significa | Cantidad |
|---|---|---|
| **A** · Productos preparados con imagen pendiente de aprobación | Foto plausible de fuente permitida; falta aprobación humana | **10** |
| **B** · Productos sin fotografía adecuada | Fuente permitida consultada, sin foto utilizable (incluye 3 Dr. Lemon hallados fuera del allowlist) | **18** |
| **C** · Productos ya presentes en el catálogo candidato | Ficha del pool: no crear | **10** |
| **D** · Identidad ambigua | Gancia Hibiscus (par), Stella Noire, Schneider Lager 473, Imperial Lager 473, Heineken porrón, Andes Rubia 710 botella | **7** |
| **E** · Necesitan fotografía propia | Marca sin fuente permitida en el allowlist | **89** |
| Total | | **134** |

Detalle: `CLASIFICACION_FINAL.csv`. Las 10 de la clase A que pueden pedir aprobación comercial (una vez aprobada la imagen) son: Corona Rubia 473, Andes Rubia Oro 473, Brahma Chopp 473, Andes IPA 473, Patagonia Vera IPA 473, Patagonia 24.7 Session IPA 473, Quilmes IPA 473, Andes Origen Negra 473, Fernet Branca 750 ml y Fernet Branca 450 ml. Las fotos de Fernet tienen 640 px: bajo para el master de 1000 px.

**Clase C (10), no crear:** Heineken Lager 710 · Imperial Golden Lata 473 · Imperial Cream Stout 473 · Trumpeter Malbec 750 · Rutini Cabernet Malbec 750 · Gancia Americano 950 · Aperol 750 · Schneider Rubia 710 (lata) · Campari (Bitter) 750 · Smirnoff Red N°21 700.

## 3. Imágenes

- **34 fotos** de la ronda 1 y **5** de la ronda 2 descargadas desde fuentes permitidas (fuera del repo, no versionadas).
- **Plausibles pre-revisadas: 10 SKU** en clase A. Son orientativas; la aprobación la firma una persona con `catalog:images:approve`.
- **Fuera del allowlist:** 3 fotos de Dr. Lemon (Jumbo). La marca no figura en la lista del grupo. **No usar** sin ampliación.
- **Descartadas por identidad:** Stella Artois Pure Gold, Trapiche sin «Alaris», Dr. Lemon Pomelo, Gancia Sin Alcohol, Patagonia Estelar, Vera IPA en lugar de Session, pack de seis latas, Amstel lata para un SKU botella, Imperial Golden lata para un SKU botella 710.
- **Calidad:** Fernet (640 px), Schneider y Imperial (429 px): bajas para el master de 1000 px.
- **Derechos:** hay base de autorización (TABA-AUT-2026-08-001 y ampliaciones), pero **falta el documento del acuerdo archivado**. Ningún asset tiene `rights_evidence_file`.
- **Placa de retailer:** la foto de Corona Rubia tiene una placa de Jumbo. Requiere recorte declarado.

## 4. Lo que se investigó y lo que no se pudo

- **Jumbo:** única fuente con coincidencia nueva (Corona Rubia 473).
- **Peñaflor / Andina:** la tienda del distribuidor no tiene ninguna de las marcas de vinos y destilados de la lista.
- **CCU:** packshots de Imperial, Heineken, Schneider y Amstel. Ninguno quedó utilizable sin dudas. Grolsch y Miller tienen packshots, pero su marca no está en el grupo.
- **Fratelli Branca:** Fernet 750 y 450, con fichas oficiales.
- **Carrefour, La Anónima, PedidosYa, Disco, Vea, Coto, DIA, Mercado Libre:** no usados para imágenes. Están rechazados por el allowlist o no están habilitados como fuente. Sólo se usaron para EAN (identidad), con fuentes de terceros.
- **Fabricantes sin grupo** (Rutini, Luigi Bosca, Trumpeter, Gancia, Diageo, Pernod, Brown-Forman): no descargados. Requieren ampliación con autorización verificable (ver propuesta).

## 5. Fotos propias del comercio

- `TOMAS_NECESARIAS_COMERCIO.csv`: **114 tomas** (clases B, D y E) con vista requerida, nombre de archivo y verificación previa.
- `INSTRUCCIONES_FOTOS_PROPIAS.md`: fondo blanco, luz, encuadre, unidad sola, etiqueta legible, 2000×2000 px, nombre `<sku>__front.jpg`.
- Sólo fotografiar lo que el local tiene en góndola.

## 6. Paquete para el importador y orden de góndola

- **`PAQUETE_IMPORTACION_PENDIENTE_APROBACION.csv`**: 117 filas en formato de la plantilla (clases A, B y E). Stock vacío, `available=false`, `sort_order` y `image_path` vacíos hasta completar.
- Validador oficial: falla sólo por stock, orden, imagen y asset aprobado en las 117 filas (`IMPORT_VALIDATION_PAQUETE.txt`). **No se relajó ninguna validación.**
- **`PROPUESTA_ORDEN_GONDOLA.csv`**: propuesta de diseño, agrupada por categoría de la góndola existente y familia de producto. **No aplicar.**

## 7. Autoridad del precio en el checkout

- Verificado en la definición **desplegada** en producción (lectura, sin pedidos): `create_order_with_items_core` y `create_checkout_session` leen `products.price` en el servidor y rechazan productos con precio no confirmado o cero.
- El cliente envía sólo `product_id` (o `combo_id`) y `quantity`. La Edge Function de Mercado Pago no lee precio del cuerpo.
- Pruebas de contrato: `tests/checkout-price-authority.test.mjs`, 4 de 4.
- Brecha conocida (no corregida): la tienda muestra el precio cargado al abrir la página, y el servidor cobra el precio del momento de la compra. Conviene que el resumen muestre el total devuelto por el servidor antes de confirmar. Ver `CHECKOUT_AUTHORITY_EVIDENCE.md`.

## 8. Overrides y recálculos

- `tests/price-overrides-pedidosya.test.mjs`: 7 de 7. Con el override en modo aprobado, **cambian exactamente los 7 SKU** y ningún otro precio de la góndola.
- Con la decisión registrada y la aplicación bloqueada, el generador produce los mismos precios que antes.

## 9. Pruebas

- Suite completa: `npm test` sobre el worktree (`npm ci` con `TMP` en D:). Resultado en la sección de estado del PR.
- Pruebas añadidas: override (7), autoridad de checkout (4).

## 10. Límites que siguen abiertos

1. Sin documento del acuerdo archivado, ningún derecho queda verificado.
2. Sin costo real por SKU, no se puede afirmar rentabilidad ni margen negativo de los nuevos.
3. Sin stock confirmado, ningún producto se publica.
4. Las 7 + 3 duplicaciones necesitan confirmación con la etiqueta física.
5. El alcohol sigue cerrado por licencia en todos los casos.
6. No se hizo prueba de carrito, checkout, PWA ni responsive en un navegador. Sólo pruebas de contrato y de código.
7. No se usó producción para pedidos de prueba. Staging no tiene los SKU ni una sesión owner vigente.

## 11. Siguiente paso recomendado

1. Revisar el visor y firmar las 10 de clase A con `catalog:images:approve`, o rechazarlas.
2. Archivar el acuerdo con el titular (o el paquete de packshots de cada marca).
3. Decidir sobre la propuesta de ampliación del allowlist (CCU: Grolsch y Miller; Dr. Lemon en el grupo de retailers).
4. Confirmar con la etiqueta los 3 duplicados probables y resolver el par Gancia Hibiscus.
5. Pedir al comercio las tomas de `TOMAS_NECESARIAS_COMERCIO.csv` (sólo lo que tiene en góndola).
