# TABA2 — Local Changes Inventory

Snapshot taken before preservation or cleanup. No worktree files were moved,
stashed, committed, discarded, reset, or cleaned while producing this report.

Classification:

1. `ALREADY-CLOSED-MISSION` — belongs to the already closed production mission.
2. `NEXT-MISSION-WORK` — real work outside the closed consolidation scope.
3. `GENERATED/RECREATABLE` — generated or reproducible review/build output.
4. `UNKNOWN` — origin cannot be established with confidence.
5. `MUST-PRESERVE` — preserve the bytes in a traceable branch/commit even when
   the work is not part of the current production authority.

## Main worktree

* Path: `C:\Users\marco\dev\la-taba-pages-preview`
* Branch: `main`
* HEAD: `9cd8f8940671b1d8314a6f25abb6ccb4b8247cc4`
* Tracked modified files: 29
* Untracked paths (18 files in 6 path groups)
* Classification result: no `UNKNOWN`; the changes are a coherent later
  storefront refresh plus Delivery PIN work, and are not part of the closed
  retail-catalog/PWA/image authority at `4daa448`.

### Main tracked modifications

| Path | Classification | Evidence / disposition |
|---|---|---|
| `docs/image-sources.md` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | New beverage-image/font source and rights notes; retailer rights are not verified, so it is not production catalog authority. |
| `index.html` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later La Taba beverage storefront/mobile brand refresh. |
| `js/app.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later storefront navigation/search/promotions/favorites behavior. |
| `js/business.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery-PIN/business-flow integration. |
| `js/core/domain.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery-PIN domain changes. |
| `js/data.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later beverage storefront data/model changes. |
| `js/delivery.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery-PIN flow changes. |
| `js/orders.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery-PIN/order flow changes. |
| `js/repositories/demo_order_repository.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery-PIN persistence path. |
| `js/repositories/http_order_repository.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery-PIN persistence path. |
| `js/repositories/supabase_order_repository.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery-PIN persistence path. |
| `js/state.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later storefront state changes. |
| `js/ui.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later beverage storefront UI changes. |
| `styles.css` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later mobile/brand visual refresh. |
| `sw.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Service-worker changes coupled to the later storefront snapshot; not part of the closed PWA v80 authority. |
| `tests/cart.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Tests updated for the later storefront behavior. |
| `tests/data.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Tests updated for the later beverage data/model. |
| `tests/delivery.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Delivery flow tests for later work. |
| `tests/domain.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Domain tests for later work. |
| `tests/e2e/business-inbox.spec.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | E2E updates coupled to later behavior. |
| `tests/e2e/honest-map.spec.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | E2E updates coupled to later behavior. |
| `tests/e2e/la-taba.spec.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | E2E updates coupled to later behavior. |
| `tests/e2e/realtime.spec.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | E2E updates coupled to later behavior. |
| `tests/github-pages.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Test updates for later storefront/deployment assumptions. |
| `tests/image-sources.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Tests for the later local image/source set. |
| `tests/orders.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Order-flow updates coupled to Delivery PIN. |
| `tests/state.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later storefront state tests. |
| `tests/supabase-repository.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Repository tests for later Delivery PIN behavior. |
| `tests/supabase-schema.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Schema assertions for the later migration. |

### Main untracked files

| Path/group | Classification | Evidence / disposition |
|---|---|---|
| `assets/fonts/archivo-italic-latin-var.woff2`<br>`assets/fonts/inter-latin-var.woff2` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Local font assets for the later storefront refresh; not part of the closed release. |
| `assets/products/bebidas/{coca-cola-original-1-5l,fanta-naranja-1-5l,fernet-branca-750ml,monster-energy-original-473ml,pepsi-cola-2l,quilmes-clasica-473ml,sprite-1-5l,villavicencio-sin-gas-1-5l}.jpg` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later local beverage imagery; source/rights notes are unverified and must not become production catalog assets in this mission. |
| `docs/visual-review/taba-home-reference/{taba-home-320x812,taba-home-375x812,taba-home-390x844,taba-home-393x852,taba-home-430x932}.png` | `GENERATED/RECREATABLE`, `MUST-PRESERVE` | Visual-review captures; reproducible, but retained byte-for-byte in the rescue commit so no local work is lost. |
| `js/core/delivery-pin.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | New Delivery PIN implementation. |
| `supabase/migrations/20260606090000_delivery_pin_v1.sql` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Later migration containing Delivery PIN schema/trigger work and backfill statements; not applied during this mission. |
| `tests/delivery-pin.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Tests for the later Delivery PIN implementation. |

No runtime-config, release package, or other untracked build artifact was
present in this main snapshot.

## Retail worktree

* Path: `D:\1212\la-taba2-retail-catalog-normalization`
* Branch: `feature/taba2-retail-catalog-normalization`
* HEAD: `4daa44879c43afccbabb1484d852b2f82848eaad`
* Tracked modified files: 5
* Untracked files: 3
* Classification result: no `UNKNOWN`; all eight paths form the later Panel
  Retail Publication Flow and are outside the closed authority at `4daa448`.

| Path | Classification | Evidence / disposition |
|---|---|---|
| `js/business/business-operations-center.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Adds commercial-publication UI/status and refresh behavior. |
| `js/production-operations.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Wires the publication operation into the Panel. |
| `js/repositories/supabase-inventory-repository.js` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Reads publication-relevant product fields and calls the new RPC. |
| `scripts/run-commercial-import-drill.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Adds local drill fixtures/assertions for publication roles and guards. |
| `styles/business.css` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Panel publication status styles. |
| `scripts/aplicar-publication-toggle-migracion.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Explicit follow-up migration runner; not executed. |
| `supabase/migrations/20260819060000_commercial_product_publication_toggle.sql` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Follow-up migration; depends on `20260819050000`; not applied to production. |
| `tests/business-commercial-publication.test.mjs` | `NEXT-MISSION-WORK`, `MUST-PRESERVE` | Focused tests for Panel publication guards and role behavior. |

## Inspection result and safety decision

The main changes are preserved as a later/rescue snapshot, not merged into
the production authority. The retail changes are preserved on a dedicated
follow-up branch, leaving `feature/taba2-retail-catalog-normalization` at its
clean, consolidable `4daa448` state. No file is classified `UNKNOWN`; no
`ALREADY-CLOSED-MISSION` change is present in either dirty worktree.

The migration `20260819060000_commercial_product_publication_toggle.sql` is
explicitly **not** to be applied or included in `main` in this mission.
