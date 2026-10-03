# Validación de la investigación

Consulta y validación local: 2026-08-01T04:05:24-03:00.

## Checks mecánicos

- `COMMERCIAL_CATALOG_CANDIDATES.csv`: 120 filas de productos, 120 SKU únicos.
- Categorías: 15/15 cubiertas.
- `PRICE_SOURCES.csv`: 78 filas.
- `PROMOTION_CANDIDATES.csv`: 13 filas; todas `inactive/pending`.
- `REGIONAL_NEUQUEN_PRODUCTS.csv`: 12 filas.
- `REJECTED_OR_UNCERTAIN.csv`: 20 filas.
- `TOP_60_RECOMMENDED.csv`: 60 filas.
- `IMAGE_MANIFEST.csv`: 17 filas, incluyendo una fila sentinel que documenta los 120 candidatos sin asset verificado.
- Se verificó que no hay URLs con espacios.
- Se verificó que no hay packs con `pack_quantity < 2`.
- Se verificó que las rutas locales de imágenes descargadas existen y sus SHA-256 coinciden con el manifiesto.

## Segunda pasada de enlaces

Se re-chequearon 40 URLs únicas de los CSV mediante solicitud HTTP de solo lectura:

- 39 respondieron correctamente al chequeo.
- 1 quedó intermitente/404: Casa Dionisio, usada únicamente como contraste antiguo/outlier para Gin Aquiles. Se conserva en las fuentes para trazabilidad y se excluye de una recomendación firme.

## Revisión visual

- 16 archivos binarios descargados solo para investigación/revisión.
- 1 quedó `retailer_research_only` por packshot limpio, sin asumir derechos.
- 15 fueron `rejected` por manos, ambiente, fondo o encuadre no apto.
- No se aplicó IA ni se modificaron etiquetas.
