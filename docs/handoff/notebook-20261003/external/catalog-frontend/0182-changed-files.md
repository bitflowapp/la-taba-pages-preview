# Changed files

Snapshot: 2026-07-30.

- Added `data/catalog-real.csv` with 44 real candidate rows.
- Added the 44-row image audit to `docs/catalog/image-source-audit.csv` and generated `docs/catalog/image-manifest.json`.
- Added 44 masters under `assets/catalog/products` and 44 thumbnails under `assets/catalog/thumbnails` through the existing fetch/normalize pipeline.
- Extended image provenance to accept `retailer_public` and carried optional deterministic `crop_width` through fetch and normalize.
- Existing 22 demo assets and generated demo data were preserved.
