# Plan del catálogo comercial de bebidas

Este documento resume cómo pasar del fixture QA al catálogo real sin inventar
productos, precios, stock ni disponibilidad.

## Fuente de verdad

- Plantilla: `data/catalog-template.csv`.
- Validador: `scripts/validate-product-catalog.mjs`.
- Auditoría de imágenes: `docs/catalog/image-source-audit.csv`.
- Manifiesto final: `docs/catalog/image-manifest.json`.
- Importador fail-closed: `scripts/import-product-catalog.mjs`.

Cada fila real debe incluir identidad comercial estable (`external_id` y `sku`),
marca, nombre, variante, categoría, valor y unidad de capacidad, envase,
unidades por pack, precio, stock, condición de frío y reglas de alcohol.
La base conserva variante, valor y unidad por separado; los textos de
presentación/capacidad se derivan por compatibilidad.

## Categorías admitidas

- Promos
- Gaseosas
- Aguas
- Jugos
- Energéticas
- Isotónicas
- Cervezas
- Vinos y espumantes
- Gins y vodkas
- Whisky y destilados
- Picadas y deli
- Hielo y extras

No se agregan categorías libres ni aliases gastronómicos al catálogo productivo.

## Secuencia segura

1. Recibir del comercio el listado real, precios y stock vigentes.
2. Normalizar identidad, presentaciones y categorías en la plantilla.
3. Auditar cada imagen oficial, sus derechos y SHA-256.
4. Generar master WebP 1000×1000 y thumbnail WebP 400×400.
5. Validar que CSV y manifiesto coincidan por `external_id`, `sku` y ruta.
6. Ejecutar el importador en `--dry-run`.
7. Importar con una sesión owner/admin. Todas las filas quedan despublicadas.
8. Revisar en staging.
9. Publicar cada producto mediante la RPC de autoridad.

El template vacío es válido únicamente como plantilla. Los gates de staging y
release fallan si no reciben un catálogo real con assets aprobados.
