# La Taba — investigación de catálogo comercial candidato para Neuquén

Fecha de consulta: 2026-08-01, zona horaria America/Argentina/Buenos_Aires. Estado: investigación para revisión; ningún precio, producto, imagen o promoción está aprobado para publicación.

## Resumen ejecutivo

- 120 productos candidatos, todos con SKU candidato estable, categoría, presentación, capacidad cuando la fuente la expuso, unidad/pack, fuente, fecha de consulta, disponibilidad, imagen/derechos y nivel de confianza.
- 15 categorías cubiertas. La cobertura incluye gaseosas, aguas, aguas saborizadas, jugos, energizantes, cervezas, vinos, fernet, gin, vodka, aperitivos, mixers, hielo, snacks y packs/combos.
- 78 registros de fuentes de precio para 73 candidatos con precio observado. Seis grupos de SKU tienen dos observaciones; cinco son comparables exactos y uno es un rango mixto Tang/Clight que se excluye de la mediana.
- 31 observaciones de precio o señal comercial provienen de fuentes con ciudad Neuquén Capital, principalmente Vinoteca El Lagar y señales locales de Jacc/Rappi. Los precios mayoristas de Los Bielitas y los de otros mercados se mantienen como contraste, no como precio de La Taba.
- 13 combos reales candidatos en `PROMOTION_CANDIDATES.csv`; todos permanecen `inactive/pending` y con margen desconocido.
- Se descargaron 16 imágenes solo para revisión visual. Una es `retailer_research_only`; 15 fueron rechazadas visualmente por fondo/encuadre/manos o quedaron como asset de investigación no mapeado. No se asumió ningún derecho comercial.

## Cobertura por categoría

| Categoría | Candidatos |
|---|---:|
| Gaseosas | 12 |
| Aguas | 6 |
| Aguas saborizadas | 6 |
| Jugos | 7 |
| Energizantes | 7 |
| Cervezas | 18 |
| Vinos | 21 |
| Fernet | 5 |
| Gin | 12 |
| Vodka | 4 |
| Aperitivos | 6 |
| Mixers | 4 |
| Hielo | 2 |
| Snacks | 8 |
| Packs y combos | 2 |
| **Total** | **120** |

## Fuentes utilizadas

- [Vinoteca El Lagar](https://www.ellagarwineshop.com.ar/), local en Edelman 35, Neuquén Capital: fichas de vinos, destilados, fernet y categoría gin. Se usó para precios retail candidatos, disponibilidad señalada y productos regionales; el sitio puede mostrar precios históricos según la antigüedad del rastreo.
- [Jacc Isla Cervecera](https://jacc.buenacarta.com/?over18=1), Mar del Sur 540, Neuquén: señal local de agua 500 ml, gaseosas, cervezas, Speed, fernet + Coca-Cola, vodka + Speed, Aperol y otros tragos. Es una carta de consumo en local, no una lista de retail empaquetado.
- [Vea / Jumbo Argentina — Quilmes 473 cc](https://www.vea.com.ar/cerveza-quilmes-clasica-lata-473-cc/p), [pack x6](https://www.vea.com.ar/cerveza-quilmes-clasica-lata-473mlx6/p) y [Quilmes 0.0](https://www.vea.com.ar/cerveza-quilmes-0-0-lata-473mlx1/p): fichas con SKU, formato, pack y ABV; algunas fichas no exponen precio o informan falta de stock.
- [Los Bielitas](https://www.losbielitas.ar/): lista mayorista reciente con bebidas, cervezas, vinos, destilados, gaseosas, energizantes, snacks y packs. Se conserva como precio mayorista de contraste y no como cotización de Neuquén.
- [Vea vía Rappi — snacks](https://www.rappi.com.ar/tiendas/247137-vea/snacks-y-galletitas/snacks): precios de referencia para snacks, marcados como posiblemente viejos por la antigüedad visible del rastreo.
- [Coca-Cola Argentina — marcas](https://www.coca-cola.com/ar/es/brands), [Coca-Cola Original](https://www.coca-cola.com/ar/es/brands/coca-cola/original), [Sprite](https://www.coca-cola.com/ar/es/brands/sprite) y [Fanta](https://www.coca-cola.com/ar/es/brands/fanta/productos): existencia de marca/variante y presentaciones documentadas por fabricante.
- [Municipalidad de Neuquén — cervecerías artesanales](https://www.neuquencapital.gov.ar/turismo/donde-comer/cervecerias-artesanales/), [fuente provincial de cervecerías](https://produccioneindustria.neuquen.gov.ar/2023/10/02/se-viene-el-10o-festival-provincial-de-cerveza-artesanal/) y [Cervecería Owe](https://www.cerveceriaowe.com.ar/): leads regionales sin inventar SKU, precio ni presentación.

## Precios verificados y límites

Los archivos separan precio observado de precio candidato para revisión. Los campos `price_min_ars`, `price_max_ars`, `price_median_ars` y `price_diff_percent` solo sirven para revisión interna. No se debe presentar ningún valor como precio aprobado.

Los comparables exactos con dos observaciones incluyen Fernet Branca 750 ml, Gin Brighton, Gin Beefeater 1 L, Gin Malfy Originale y Gin Aquiles 750 ml. Aquiles se marca como valor atípico porque una fuente estaba sin stock y era antigua. Tang/Clight queda fuera del cálculo porque la fuente entrega un rango combinado y no separa SKU.

Las señales de precio de Los Bielitas se marcan `wholesale_only`; las de snacks de Rappi/Vea y los listados antiguos de El Lagar se marcan `possibly_old`; los valores de Jacc se excluyen de precios retail porque corresponden a servicio en local. La siguiente pasada comercial debe capturar precio y stock con ubicación de entrega en Neuquén Capital.

## Imágenes

La imagen de Fernet Branca 750 ml de Vea/Jumbo se conserva como `retailer_research_only`: tiene fondo limpio y presentación exacta, pero no hay autorización de uso comercial. Las imágenes descargadas de El Lagar fueron inspeccionadas y rechazadas como packshots por manos, ambientación o encuadre. No se modificaron etiquetas ni se aplicó IA.

Todos los hashes SHA-256 y URLs originales están en `IMAGE_MANIFEST.csv`. La ausencia de una imagen no se rellenó con una imagen genérica o de otra presentación.

## Productos regionales

El candidato regional más sólido es Mabellini Malbec: la ficha local declara uvas de Chacra Confluencia, Neuquén. También aparecen Gin Yunta Patagónico, Zorro Colorado, Zorro Colorado Hibiscus, Restinga y Casa Rosa en la categoría local de gin; quedan como candidatos con ficha, ABV, origen y derechos de imagen pendientes. Owe y Beyla se registran como leads de cervecería regional, no como productos importables sin formato/stock/precio exactos.

## Promociones candidatas

Se prepararon 13 combinaciones con los SKU exactos del catálogo, incluyendo Fernet + Coca-Cola, gin + tónica, vodka + energizante, previa, juntada, asado, sin alcohol, gin patagónico, vino neuquino, Aperol Spritz, picada y Fernet Menta. Las sumas que pueden calcularse son provisionales; cuando falta un componente se deja `pending_pricing`. No se activó ninguna promoción.

## Duplicados, revisión doble y bloqueos

La segunda pasada encontró 120 SKU únicos, sin URLs con espacios y sin packs con cantidad menor a 2. Las fuentes duplicadas del mismo producto se consolidaron en una fila de catálogo y se conservaron como filas separadas en `PRICE_SOURCES.csv`. Chandon Extra Brut y Chandon Apéritif se mantuvieron separados porque son productos distintos.

Bloqueos restantes: precios y stock de Neuquén para varios productos; capacidad exacta de líneas mayoristas que no la informan; confirmación retornable/descartable; proveedor y habilitación de hielo; derechos de uso de packshots; fichas individuales de varios gins regionales; y re-chequeo de Casa Dionisio, cuya URL respondió de forma intermitente/404 aunque había sido encontrada en la recopilación.

## Entregables

- `COMMERCIAL_CATALOG_CANDIDATES.csv` — 120 candidatos.
- `PRICE_SOURCES.csv` — 78 observaciones de precio/fuente.
- `IMAGE_MANIFEST.csv` — URLs, archivos descargados, dimensiones estimadas desde el asset, SHA-256 y decisión visual.
- `PROMOTION_CANDIDATES.csv` — 13 combos inactivos/pendientes.
- `REGIONAL_NEUQUEN_PRODUCTS.csv` — 12 productos/leads regionales.
- `REJECTED_OR_UNCERTAIN.csv` — 20 bloqueos o descartes.
- `TOP_60_RECOMMENDED.csv` — selección priorizada de 60.
- `CATALOG_BOARD.html` — tablero visual local.
- `RIGHTS_AND_RISKS.md` — derechos, riesgos de precio/stock y uso de imágenes.
- `IMPORT_READINESS.md` — checklist de importación y estados por campo.

## Veredicto

**LA_TABA_COMMERCIAL_CATALOG_RESEARCH_READY_FOR_REVIEW**
