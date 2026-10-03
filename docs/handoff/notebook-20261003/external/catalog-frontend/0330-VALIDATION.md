# Validación técnica

Worktree: `C:\1212\la-taba-promos-packshots` · branch `feature/catalog-packshots-promos` ·
base `64615dbd594279945257078f315ec911dbade5d6`.

## Comandos ejecutados

| Comando | Resultado |
|---|---|
| `npm run check` | ✅ pasa (`check-syntax.mjs && check-static-assets.mjs && check-release-hygiene.mjs`) |
| `npm test` | ✅ 605/605 tests, 0 fallas, 0 skips |
| `npm run catalog:images:verify` | ✅ `22 productos y 44 WebP demo aprobados verificados.` / `0 imagen(es) WebP verificadas con fuente, derechos y SHA-256.` (pipeline comercial sigue vacío/fail-closed, como antes) |
| `git diff --check` | ✅ sin conflictos de espacio en blanco / merge markers, exit 0 |

## Qué cubren esos 605 tests (relevante para esta tarea)

- `tests/promotions.test.mjs` → `the versioned CSV only seeds inactive promotion candidates
  until confirmation exists`: confirma que el orden de `promoId` en
  `PREVIEW_PROMOTION_SEED` coincide exactamente con el orden de filas en
  `data/preview-promotions.csv` (ahora 5 filas: 2 preexistentes + 3 nuevas), que
  **todas** tienen `active === false`, y que `getActivePromotions(seed, NOW).length === 0`.
- `tests/data.test.mjs` → `browser runtime seeds reference approved SKUs instead of legacy QA
  products`: confirma que no aparece ningún identificador `qa-*` en
  `js/preview-promotions-data.js` ni en `data/preview-promotions.csv`.
- `tests/image-sources.test.mjs` → `tracked storefront WebP are approved demo assets or
  commercial manifest entries`: confirma que **todo** WebP bajo `assets/` sigue siendo o el
  catálogo demo aprobado (44 archivos) o una entrada del manifiesto comercial (0 hoy). Esta es
  la razón por la que las imágenes de las 3 promociones nuevas se generaron **fuera** de
  `assets/` (ver `ASSET_SOURCES.md`) en vez de romper este control anti-huérfanos.
- `scripts/catalog-images/verify-approved-demo.mjs` (corre dentro de `catalog:images:verify`):
  valida uno por uno los 22 productos — SHA-256 real del archivo contra el declarado, formato y
  dimensiones leídas con `sharp` contra lo declarado (1000×1000 / 400×400), cero huérfanos, cero
  referencias sin archivo, exactamente 44 WebP. **Pasa después de la normalización**, confirmando
  hashes recalculados correctamente.

## Confirmaciones explícitas pedidas

- ✅ Imágenes exactas (hash recalculado y verificado, no sólo reemplazado a ciegas).
- ✅ Fondos blancos puros (`flatten` contra `#ffffff` en cada normalización).
- ✅ Dimensiones correctas (1000×1000 / 400×400, verificado por `verify-approved-demo.mjs` leyendo
  los bytes reales con `sharp`, no sólo el metadato declarado).
- ✅ Hashes correctos (recalculados con `crypto.createHash('sha256')` sobre los bytes finales).
- ✅ Cero archivos huérfanos (`verify-approved-demo.mjs` + `tests/image-sources.test.mjs`
  exigen que la cuenta de WebP en disco sea exactamente la esperada).
- ✅ Cero imágenes rotas (cada asset se leyó con `sharp` antes y después; todas decodifican).
- ✅ Cero productos deformados (todo reescalado usó el mismo factor en X e Y; verificado
  visualmente en `screenshots/PACKSHOT_BEFORE_AFTER_BOARD.png` para 6 SKU representativos de
  distinta forma — botella PET angosta, lata simple, lata ancha/plateada, botella de vidrio).
- ✅ Promociones bloqueadas cuando falta SKU o precio: las 3 candidatas nuevas quedan
  `active=false` / `approval_status=PENDIENTE` con precios en blanco en el CSV — verificado por
  captura `screenshots/business-promotions-manager-1280x1400.png` (panel Negocio → Promociones
  muestra "0 activas" y "No publicada" en las 5 filas, incluidas las 3 nuevas). Las 3
  restantes (Fernet+Coca-Cola, Gin+Tónica, Vodka+Energizante) ni siquiera llegan al CSV: no
  hay SKU real que referenciar.
- ✅ Flags de alcohol correctos: no se tocó `alcoholic`/`requiresAgeConfirmation`/`minimumAge`
  de ningún producto (fuera del diff de `js/approved-beverage-demo-data.js`, que sólo cambió
  campos de imagen). Las promociones que incluyen un SKU alcohólico heredan la condición de
  edad del producto, documentado en `PROMOTION_RULES.md`.

## Archivos modificados (git status --short, 51 entradas)

- 44 WebP normalizados en `assets/catalog/beverages/**` (22 SKU × product+thumbnail)
- `js/approved-beverage-demo-data.js` (sólo hashes de imagen + versión del catálogo)
- `data/preview-promotions.csv` (+3 filas)
- `js/preview-promotions-data.js` (regenerado desde el CSV)
- 4 scripts nuevos (sin tracking previo): `scripts/import-approved-beverages.mjs`,
  `scripts/import-preview-promotions.mjs`,
  `scripts/catalog-images/normalize-demo-packshots.mjs`,
  `scripts/catalog-images/compose-promotion-images.mjs`

Ningún archivo fuera de esta lista fue tocado. No se modificó Mostrador Patagónico, checkout,
Perfil, relay, Supabase, tracking, MapLibre, GPS, código de reparto, estados de pedido,
migraciones, ni el precio individual de ningún producto.

## Git — estado final

- `git branch --show-current` → `feature/catalog-packshots-promos`
- `git rev-parse HEAD` → `64615dbd594279945257078f315ec911dbade5d6` (sin commits nuevos)
- `git status --short` → 51 entradas (44 imágenes + 3 archivos de datos + 4 scripts nuevos),
  todo `working tree`, nada staged/committed
- **No se ejecutó** `reset`, `restore`, `stash`, `clean`, `rebase`, `merge`, `push` ni cualquier
  operación de deploy en ningún momento de esta tarea.
