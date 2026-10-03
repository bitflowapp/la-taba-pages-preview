# TABA — clasificación de cambios

## Alcance auditado

Los 23 archivos modificados pertenecen a sistema visual, catálogo/home/carrito/checkout, Perfil, workspace operativo, responsive, accesibilidad y pruebas E2E asociadas. No hay cambios en `supabase/`, `data/`, assets fuente ni migraciones.

## Commit 1 — `feat(ui): establish Mostrador Patagonico design system`

- `styles/tokens.css`: colores, tipografía, radios, sombras, z-index, safe-area y sticky stack.
- `styles/common.css`: reglas comunes de app bar, controles, formularios, CTA y capas.
- `styles.css`: consumo del token de z-index en herramientas sandbox.

## Commit 2 — `feat(storefront): redesign responsive shopping experience`

- `index.html`: superficie cliente, home, catálogo, búsqueda, empty state, carrito y checkout; el scaffold compartido del app bar queda separado del comportamiento operativo.
- `js/ui.js`: render y comportamiento visual de cliente, catálogo, búsqueda, carrito, checkout y Perfil.
- `js/app.js` (hunks de cliente): limpiar búsqueda y buscar en todo.
- `styles/catalog.css`, `styles/profile.css`, `styles/showcase.css`, `styles/storefront.css`, `styles/tracking.css`: superficies cliente.
- `styles/responsive.css` (hunks cliente): navegación, carrito, checkout, Perfil y breakpoints cliente.

## Commit 3 — `feat(business): add responsive operational workspace`

- `js/business.js`: app bar operativo, navegación de cuatro destinos, banda de estados, master-detail, acciones por breakpoint y sincronización visual.
- `js/app.js` (hunk operativo): chip de sincronización del app bar y compatibilidad del selector contractual.
- `styles/business.css`: workspace móvil/desktop, banda, master-detail y acción primaria.
- `index.html` (hunk compartido del app bar): contexto operativo, chip y control de sonido.
- `styles/responsive.css` (hunks operativo): app bar y navegación responsive del negocio.

## Commit 4 — `test(e2e): certify Mostrador Patagonico experience`

- Las 9 pruebas/helpers modificados: assertions visuales/contractuales y navegación del workspace, sin lógica de producción.

## Hilos mixtos separados

- `js/app.js`: hunk de búsqueda para Commit 2; hunk de sincronización operativa para Commit 3.
- `index.html`: markup cliente y scaffold común separados del bloque operativo.
- `styles/responsive.css`: hunks de cliente separados de reglas operativas.

## Exclusiones confirmadas

No se modificó lógica de Perfil como autoridad, creación de pedidos, relay, Supabase, tracking funcional, MapLibre, GPS, delivery code, estados/RPC/RLS/migraciones, datos, precios o imágenes fuente.
