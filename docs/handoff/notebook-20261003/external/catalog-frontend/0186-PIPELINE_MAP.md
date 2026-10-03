# TABA Catalog Pipeline Map

Worktree
- `C:\1212\la-taba-catalog-expansion`
- Branch: `feature/catalog-expansion-argentina`
- Base head: `4197bdbc1df7d3eb1328afc4a7a01e1067f14316`

Canonical product source
- `data/catalog-template.csv`

Canonical category/metadata source
- `data/catalog-template.csv`

Importer and generation
- `scripts/import-product-catalog.mjs`
- `scripts/validate-product-catalog.mjs`
- `scripts/validate-release-catalog.mjs`
- `scripts/validate-staging-readiness.mjs`

Runtime catalog inputs and consumers
- `js/beverage-demo-data.js`
- `js/approved-beverage-demo-data.js` (generated output; no manual edits)
- `js/data.js`
- `js/core/catalog-store.js`

Image pipeline
- `docs/catalog/image-source-audit.csv`
- `scripts/catalog-images/.raw/manifest.json`
- `scripts/catalog-images/lib.mjs`
- `scripts/catalog-images/fetch-approved.mjs`
- `scripts/catalog-images/normalize.mjs`
- `scripts/catalog-images/verify.mjs`
- `scripts/catalog-images/verify-approved-demo.mjs`
- `docs/catalog/image-manifest.json`
- `docs/image-sources.md`

Authority and migrations
- `supabase/migrations/20260725070000_catalog_category_authority.sql`
- `supabase/migrations/20260725110000_catalog_publication_authority.sql`

Documentation references
- `docs/catalog/taba-product-import-guide.md`
- `docs/implementation/taba-staging-setup.md`

Notes
- Importer for `js/approved-beverage-demo-data.js` is referenced as `scripts/import-approved-beverages.mjs` in comments, but that script is missing in current tree.

Expansion snapshot 2026-07-30
- Canonical real catalog: `data/catalog-real.csv`.
- Image audit: `docs/catalog/image-source-audit.csv`; `retailer_public` is a provenance type for public retailer assets and remains rights-gated.
- Deterministic panel removal uses optional `crop_width` carried through fetch raw manifest into normalization; source bytes and source SHA remain unchanged.
- Final manifest: `docs/catalog/image-manifest.json` with 44 commercial candidate sources and 88 generated WebP assets.
- Runtime publication remains fail-closed: all new rows are unavailable/unpublished until business confirmation and rights authorization.
