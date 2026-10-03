# La Taba — auditoría de recuperación del rediseño rojo

Fecha de captura: 2026-08-02 (America/Buenos_Aires)

## Veredicto

`LA_TABA_RED_DESIGN_RECOVERED_IN_ISOLATED_WORKTREE`

El rediseño fue recuperado en un worktree separado, sin commits, merges, pushes, resets, restores, stashes, clean ni deploys.

## Evidencia congelada

- Fuente: `C:\Users\marco\dev\la-taba-pages-preview`
- Fuente branch/HEAD: `main` / `9cd8f8940671b1d8314a6f25abb6ccb4b8247cc4`
- Fuente al congelar: 29 archivos versionados modificados y 14 archivos nuevos.
- Artefactos: `SOURCE_STATUS.txt`, `SOURCE_DIFF.patch`, `SOURCE_FILES.csv`, `ASSET_HASHES.csv` y `la-taba-redesign-source-files.zip`.
- El inventario contiene ruta, estado, tamaño, fecha de modificación y SHA-256.

## Auditoría diferencial y clasificación

### Visual seguro trasladado

- `index.html`: identidad La Taba, hero rojo, copy visual, botones que conservan `data-category-id`/`data-nav-view`, y clase de barra inferior.
- `styles.css`: capa visual roja/negra/blanca, header/logo, hero, responsive, cards/rails/categorías y corrección de `font-size: 16px` para controles táctiles iOS.
- Los renderizadores, precios, promociones, categorías, favoritos, checkout, tracking y contratos canónicos permanecen en la base.

### Funcional mezclado — rechazado

`js/app.js`, `js/business.js`, `js/core/domain.js`, `js/data.js`, `js/delivery.js`, `js/orders.js`, `js/state.js`, `js/ui.js`, `js/repositories/demo_order_repository.js`, `js/repositories/http_order_repository.js` y `js/repositories/supabase_order_repository.js`.

La fuente combina cambios de delivery PIN, catálogo de bebidas/precios, estado, repositorios y UI. No se copiaron archivos completos ni se inventaron precios/promociones activas.

### Histórico/preexistente — rechazado

Los commits de la fuente (`9cd8f89`, `1c03725`, `3262033`, `9cfa9d2`, `a8df3f3`) están en una línea histórica distinta de la base canónica. Sus cambios de rider/tracking y hardening no se usaron como fuente de funcionalidad.

### Asset sin trazabilidad — rechazado

Se rechazaron `assets/fonts/`, `assets/products/bebidas/` y `docs/visual-review/taba-home-reference/`. Sus hashes, fechas y tamaños quedaron registrados, pero no se copiaron. El hero usa temporalmente imágenes WebP canónicas existentes en `assets/catalog/beverages/`.

### Service worker — rechazado

`sw.js` tenía cambios y no fue trasladado. No había una necesidad visual demostrada y se preservó el worker canónico.

### No trasladar

`docs/image-sources.md`, `js/core/delivery-pin.js`, `supabase/migrations/20260606090000_delivery_pin_v1.sql`, `tests/delivery-pin.test.mjs`, todos los tests modificados, y las referencias visuales nuevas. También se excluyeron las modificaciones funcionales de Gate 2 presentes en la base canónica.

## Entorno aislado

- Worktree: `C:\1212\la-taba-redesign-rojo`
- Branch: `feature/la-taba-redesign-rojo`
- HEAD: `c6270589756214eac617515248e93a8e8819190b`
- Cambios locales finales: únicamente `index.html` y `styles.css`.
- No hay commit nuevo.

## Validación

- `npm run check`: OK.
- `npm test`: 635/636 OK; un fallo preexistente de `tests/promotions.test.mjs` espera `800` y recibe `0`. No se modificó funcionalidad para ocultarlo.
- `npm run migrations:validate`: OK; 20 migraciones revisadas. No se aplicó ninguna migración.
- `npm run catalog:images:verify`: OK; 22 productos y 44 WebP canónicos verificados.
- `npm audit --audit-level=high`: 0 vulnerabilidades.
- `git diff --check`: OK.
- `npm run test:e2e -- --workers=1 --retries=0`: el puerto 8080 falló con `EACCES`; con puertos altos la ejecución agotó 120 s sin resultado. Se clasifica como bloqueo de infraestructura, no como pase.

## Capturas y QA visual

Capturas externas en `captures/`:

- `home-320x568.png`
- `home-390x844.png`
- `home-430x932.png`
- `home-1280x900.png`

Las cuatro vistas reportaron `scrollWidth - clientWidth = 0px`. Se verificaron hero rojo, identidad visible La Taba, navegación inferior, precios con `$`/ARS y controles táctiles con tamaño de fuente de 16px.

## Integridad de repositorios protegidos

- Fuente accidental: sigue en `main`, HEAD `9cd8f894…`, con el mismo working tree mezclado registrado en `SOURCE_STATUS.txt`.
- Base canónica: sigue en `staging/real-orders-walter`, HEAD `c627058…`, conservando sus cambios locales de Gate 2.
- No se tocó Supabase, pedidos, Gate 1, Gate 2 ni producción.

