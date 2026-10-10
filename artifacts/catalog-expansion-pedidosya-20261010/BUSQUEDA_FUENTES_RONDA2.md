# BUSQUEDA_FUENTES_RONDA2 · qué se consultó, qué devolvió y con qué derecho

**Fecha:** 2026-10-10. Regla aplicada en todo momento: sólo se descarga de hosts y marcas del `catalog/image-source-allowlist.json`. El allowlist **no** se modificó; las propuestas de ampliación están en `PROPUESTA_AMPLIACION_ALLOWLIST_NO_APLICADA.md`.

## 1. Fuentes con descarga permitida

| Fuente | Tipo (allowlist) | Qué se consultó | Resultado | Derecho |
|---|---|---|---|---|
| **Jumbo Argentina** (VTEX `/api/catalog_system/pub/products/search`) | `proveedor_aprobado` | 17 productos pendientes de marcas del grupo `retailers-serios` (Andes, Stella, Corona, Quilmes, Brahma, Patagonia, Gancia, Budweiser); ~37 consultas con variantes de nombre | **1 coincidencia válida**: Corona Rubia 473 cc (lata) | Autorización TABA-AUT-2026-08-001 + ampliación 2026-08-26 (cervezas y aperitivos ya cargados). Requiere recorte de la placa de Jumbo y revisión individual |
| **Jumbo**, Dr. Lemon | `proveedor_aprobado` | 3 fotos plausibles | **Descartadas del uso**: Dr. Lemon no figura en la lista de marcas del grupo `retailers-serios` del allowlist | Fuera de alcance hasta una ampliación |
| **Coca-Cola Andina / Peñaflor** (tienda VTEX `tienda.coca-cola.com.ar`) | `distribuidor_oficial` | Toro Clásico 700, Trapiche Alaris, y 38 sondeos de marcas de la familia Peñaflor (Trumpeter, Santa Julia, Finca Flichman, Callia, Rutini, Luigi Bosca, Salentein, Esperado, Killka, Sernova, Campari, Aperol, Carpano, Malibu, etc.) | **0** productos de la lista. Sólo aparecen Smirnoff y Monster (combos) | No aplica |
| **Fratelli Branca** (brancastore) | `fabricante` | Fichas unitarias Fernet Branca 750 ml y 450 ml | **2 fichas** con packshot oficial (640 px) | Fabricante, TABA-AUT-2026-08-001 |
| **CCU Argentina** (ccu.com.ar, páginas de marca c1–c16) | `fabricante` | 74 imágenes de marca. Packshots de Schneider, Imperial, Heineken, Amstel (marcas en el allowlist) y de Grolsch, Miller, Warsteiner, Isenbeck, Bieckert, Sol, Pilsen, Blue Moon (**fuera** de la lista de marcas de CCU) | Imperial Golden, Imperial Lager, Imperial Cream Stout, Heineken botellín, Schneider Lager, Amstel lata: **candidatas** con dudas (sin capacidad visible, envase distinto o 429 px). Grolsch y Miller: **no descargadas** (marca fuera del allowlist) | Fabricante |

## 2. Fuentes consultadas sin descarga (no permitidas o no autorizadas)

| Fuente | Por qué no se descargó |
|---|---|
| **Carrefour** (`carrefour.com.ar`) | Está en `rejectedHosts` como minorista. El grupo `retailers-serios` sólo lo usa como CDN, sin tienda de descubrimiento. No se consultó su API. |
| **La Anónima** | No figura en el allowlist. Apareció en búsquedas como ficha con EAN (identidad, no imagen). **Sin descarga.** |
| **PedidosYa Market** | Plataforma de marketplace: `No habilita marketplaces`. Es la fuente de precios, no de imágenes. **Sin descarga.** |
| **Disco, Vea, DIA, Coto, Mercado Libre** | En `rejectedHosts`. Aparecieron en búsquedas de EAN; no se usaron para imágenes. |
| **Maxiconsumo, Pampa, Hiper Libertad, Toledo, Zetta, Growler, Borrachines** | Distribuidores y tiendas sin grupo en el allowlist. Sólo sirvieron como evidencia de EAN. |
| **Sitios oficiales de fabricantes sin grupo** (Rutini, Luigi Bosca, Trumpeter, Finca Flichman, Diageo, Pernod, Brown-Forman, Campari/Gancia) | No están en el allowlist. Descargar requiere ampliación con autorización verificable. Ver propuesta. |
| **Bancos de imágenes de marcas** | No encontrados de forma accesible en esta ronda. |

## 3. Identidad por EAN (búsquedas en la web, evidencia de terceros)

Estas búsquedas sirven para identidad, no para imagen. Son fuentes de comercio, no oficiales. Confirmar con la etiqueta.

| Producto | EAN encontrado | Dónde | Conclusión |
|---|---|---|---|
| Schneider Rubia lata 710 cc | 7793147570606 | Pricely, Atomo, Vea, Masonline | Igual a la ficha del pool (lata 710). **Duplicado** |
| Trumpeter Reserva Malbec 750 | 7790577041553 | Aquilastore, La Colonia, Socilink, Fullescabio | Distinto del Malbec base 7790577002165. **No duplicado** |
| Rutini Cabernet Franc Malbec 750 | 7790577043595 | Cosmos (Bluesoft), Roma Shopping | El pool no tiene esa variante. **No duplicado** |
| Rutini Cabernet Malbec 750 | 7790577001663 | Vea (dato estructurado), Solyvino | «Cabernet y Malbec» del pool. **Duplicado** |
| Campari 750 | 7791200200781 (supermercados) · 7891136052000 (Open Food Facts, origen inconsistente) | DIA, Disco, Vea, Pricely | Los supermercados lo venden como «Campari Bitter 750 cc», igual que el pool. **Duplicado probable** |
| Smirnoff Red N°21 700 | 7791250001345 | SuperUno, Vea | «Vodka Smirnoff Red 21 700», igual que el pool. **Duplicado probable** |
| Gancia Americano 950 | 7790950000160 | Pricely, Growler, Argewine, Pampa | Igual al pool (Americano 950). **Duplicado** |
| Gancia Hibiscus Vodka Spritz 473 | 7790950144826 | Toledo, Zetta, Disco, Vea, Jumbo | Es «Vodka Spritz Hibiscus». No apareció ningún producto «Lima Limón Hibiscus». **Par pendiente** |
| Gancia Americano + Lima Limón 473 | 7790950142921 | Coto, Borrachines, DIA, La Anónima | Es el producto ya existente en La Taba |

**Límite:** el pool de fichas (`catalog/products.json`) **no trae GTIN** en ninguna fila. Las conclusiones de duplicado se apoyan en nombre y presentación del mercado, no en EAN del pool. Hay que confirmar con la etiqueta física antes de cerrar.

## 4. Lo que quedó sin fuente

- 89 productos (clase E): su marca no tiene ninguna fuente permitida en el allowlist.
- 18 productos (clase B): fuente permitida consultada sin candidata utilizable. Incluye 3 de Dr. Lemon, con foto hallada pero fuera del allowlist.
- Las fotos de Grolsch y Miller existen en la web de CCU, pero su marca no está en el grupo: quedan como propuesta de ampliación.
