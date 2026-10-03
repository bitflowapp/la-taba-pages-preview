# Resumen de catálogo en expansión

Worktree: `C:\1212\la-taba-catalog-expansion`
Rama: `feature/catalog-expansion-argentina`
Base commit: `4197bdbc1df7d3eb1328af4a7a01e1067f14316`
Fecha de inicio objetivo: `2026-07-30`

## Fase 1 concluida y preparación Fase 2

- Rutas y contratos clave identificados y operativos para importación comercial: `data/catalog-real.csv`, `data/catalog-template.csv`, `scripts/import-product-catalog.mjs`, `scripts/validate-product-catalog.mjs`, `scripts/catalog-images/fetch-approved.mjs`, `normalize.mjs`, `verify.mjs`.
- Pipeline de imágenes comerciales separado del demo y protegido por manifiesto (`assets/catalog/products`, `assets/catalog/thumbnails`).
- `js/approved-beverage-demo-data.js` sigue como fixture demo y no debe editarse manualmente.

### Estado base
- Productos demo actuales: `22`.
- Catálogo real aún no existe: `data/catalog-real.csv`.
- Manifiesto final de imágenes base: `docs/catalog/image-manifest.json` con `schemaVersion: 1` y `sources: []`.

### Estado de investigación (arranque Fase 2/3)
- `PRODUCT_RESEARCH.csv`: `11` filas de investigación inicial.
- `PRICE_SOURCES.csv`: `11` filas (incluye referencia regional de COTO Neuquén).
- `IMAGE_SOURCES.csv`: `3` entradas en revisión.
- `DEFERRED_PRODUCTS.md`: actualizado con bloqueo explícito por no tener segunda fuente/imágenes aprobadas.

### Bloqueadores actuales para avanzar a catálogo real
1. No hay segunda fuente verificable para la mayoría de los precios tomados.
2. No hay evidencia de derechos y calidad de imagen aprobada para los SKUs de investigación.
3. `docs/catalog/image-source-audit.csv` no contiene entradas APROBADAS todavía.
4. Sin esas condiciones, no se puede construir `catalog-real` que pase `catalog:release:validate`.

### Próximos hitos inmediatos
- Completar segunda fuente de precio (fuente local/nacional oficial).
- Documentar imagen exacta con `source_url`, `rights_status`, `rights_reference`, `checked_at`, y hash de fuente.
- Generar manifiesto de imágenes aprobado y luego cargar filas válidas en `data/catalog-real.csv`.

## Métricas de progreso
- Total objetivo del proyecto: `60+` productos.
- Meta mínima de nuevos reales: `38`.
- Agregados actuales confirmables para fase real: `44` filas nuevas en `data/catalog-real.csv`.
- Total del catálogo real preparado: `66` productos (`22` demo preservados + `44` nuevos).
- Todas las filas nuevas quedan `available=false`, `stock=0` y requieren confirmación operativa antes de publicarse.
- Las imágenes pasan verificación de fuente/SHA/dimensiones, pero su `rights_status` sigue `PENDIENTE_DERECHOS`.

## Snapshot de integración 2026-07-30

- Fuentes de precio: Jumbo VTEX API, precio positivo observado el 2026-07-30, sin inventar stock.
- Imágenes: 44 fuentes exactas, 44 masters WebP 1000x1000 y 44 thumbnails WebP 400x400.
- Categorías nuevas: `fernet-y-aperitivos` (8), `aguas-y-sodas` (6), `isotonicas` (3), `vodkas` (6), `gin` (3), `whisky` (4), `ron-tequila-y-licores` (6), `vinos` (4), `espumantes` (4).
- Productos excluidos: Gatorade con panel de marketing inferior, Johnnie Walker Red Label y Chivas Regal con paneles no removibles sin degradar la ficha; quedan en `DEFERRED_PRODUCTS.md`.
- Veredictos de pipeline: `catalog:images:verify`, `catalog:validate` y `catalog:release:validate` aprobados.
