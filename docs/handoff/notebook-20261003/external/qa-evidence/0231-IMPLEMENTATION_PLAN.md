# Plan de implementación

**No se implementó nada.** Este documento define el orden y las condiciones.

---

## 0. Precondiciones — antes del primer commit

1. **Codex termina** su trabajo en `feature/catalog-checkout-premium` y ese
   trabajo queda mergeado o descartado. El worktree tiene hoy 33 archivos
   modificados y 6 sin seguimiento; empezar sobre esa base garantiza conflictos
   en `styles/*.css`, `js/ui.js` y `js/business.js`, que son exactamente los
   archivos de este plan.
2. Rama nueva desde `main` estabilizado: `feature/taba-visual-system`.
3. Suite verde antes de tocar nada: `npm test` y `npx playwright test`.
   Se guarda la salida como línea de base.
4. Se congela el alcance: nada de este plan toca tracking, mapas, relay,
   Supabase, repositorios ni el modelo de pedidos.

---

## 1. Orden de implementación

Seis commits, en este orden. **El orden importa**: los tokens habilitan todo lo
demás, y el panel del negocio va primero porque es la superficie más dañada y la
que menos riesgo de regresión tiene (no la ve el cliente).

### Commit 0 — `fix(ui): correcciones de bajo riesgo y tokens base`

Va primero porque son defectos objetivos, independientes del rediseño, y
reducen ruido en los commits siguientes.

| Cambio | Archivo | Referencia |
|---|---|---|
| Definir `--taba-border-strong` | `styles/tokens.css` | auditoría §3.4 |
| Agregar tokens de superficie, tipografía, fila, banda inferior y estado | `styles/tokens.css` | sistema §2.2 |
| Agregar `@media (prefers-reduced-motion: reduce)` | `styles/tokens.css` | sistema §10 |
| Acotar `renderNavigation()` a `.mobile-nav`/`.desktop-nav` | `js/ui.js:217-228` | auditoría §3.2 |
| Marcar `Catálogo` activo en la vista carrito | `js/ui.js` | auditoría §3.3 |
| Quitar `.icon-store` (CSS muerto) | `styles/responsive.css:182-189` | auditoría §3.9 |

**Pruebas:** unitarias completas + e2e de navegación. Se agrega un test que
verifica que existe **exactamente un** `aria-current="page"` en el documento en
cada vista.

### Commit 1 — `feat(business): panel del negocio móvil`

| Cambio | Archivo |
|---|---|
| Header compacto + barra de estado con `.sync-chip` | `js/business.js`, `styles/business.css` |
| Resumen operativo de 4 columnas en 64 px (reemplaza `.business-stat-grid` 2×2) | `js/business.js:202-207`, `styles/business.css:118-149` |
| `.taba-group` / `.taba-row` (secciones agrupadas) | `styles/business.css` |
| Sustituir `.business-jump-nav` por filas verticales en móvil | `js/business.js:208-217` |
| Selector de segmento (≤4 opciones) en vez de `.inbox-tabs` scrolleable | `js/business.js:396`, `styles/business.css:86-116` |
| `.order-card` con filete de prioridad y una sola acción primaria | `styles/business.css` |
| Pantalla de detalle de pedido con CTA de estado | `js/business.js`, `styles/business.css` |
| Devolver una salida explícita al panel (hoy no hay navegación) | `styles/responsive.css:1-10` |

**Pruebas:** e2e `business-inbox.spec.mjs` sigue verde. Se agregan asertos: en
390×844 ninguna nav del negocio tiene contenido fuera de vista
(`scrollWidth <= clientWidth + 2`).

### Commit 2 — `feat(business): panel del negocio escritorio`

| Cambio | Archivo |
|---|---|
| Layout de tres paneles a ≥900 px (sidebar, cola, inspector) | `styles/business.css` (nuevo bloque `@media (min-width: 900px)`) |
| Sidebar de navegación con badges | `js/business.js`, `styles/business.css` |
| Franja de métricas de 56 px | `styles/business.css` |
| Cola con búsqueda y segmento; selección con teclado | `js/business.js` |
| Inspector con el mismo contenido que el detalle móvil | `js/business.js` |
| `.data-table` para Catálogo, Stock, Caja, Reportes | `styles/business.css` |

**Nota de reutilización:** el detalle de pedido se escribe **una vez** y se monta
en dos contenedores (pantalla completa en móvil, panel derecho en escritorio).
No se duplica el render.

### Commit 3 — `feat(catalog): tarjeta y encabezado del catálogo`

| Cambio | Archivo |
|---|---|
| Quitar `PREVIEW INTERNA` del shell | `index.html:132-135` |
| **Actualizar el test que lo fija** | `tests/e2e/beverage-storefront.spec.mjs:21` |
| Quitar `.home-preview-label` (8 px) | `styles/storefront.css:631-637` |
| Encabezado compacto: sin kicker, título en la fila de contexto | `index.html:212-217`, `styles/catalog.css:1-23` |
| Buscador 64 → 44 px | `styles/catalog.css:25-31` |
| Categorías 102 → 40 px + máscara de scroll + `scroll-snap` | `styles/catalog.css:58-107` |
| Unificar categorías de Inicio y Catálogo en `.cat-bar` | `js/ui.js`, `styles/storefront.css` |
| Tarjeta: packshot 6 % de padding, precio y acción en filas separadas | `styles/catalog.css:207-331` |
| **Eliminar `.product-media-control` absoluto** | `styles/catalog.css:252-257, 537-540`, `js/ui.js:1068` |
| Barra de orden como botón + sheet; se oculta con 0 resultados | `index.html:231-241`, `styles/catalog.css:127-205` |
| Grilla mobile-first (base 2 col, `min-width` hacia arriba) | `styles/catalog.css:207-212` |

**El commit 3 es el más riesgoso.** Toca la superficie que ve el cliente y el
render de producto, del que dependen varios e2e.

### Commit 4 — `feat(catalog): carrito y superficies fijas`

| Cambio | Archivo |
|---|---|
| `--nav-band` / `--cart-band` como fuente única de verdad | `styles/tokens.css` |
| Redefinir los tokens viejos en función de los nuevos | `styles/tokens.css` |
| Nav 66 → 62 px, carrito 52 → 56 px, aire de 12 px | `styles/responsive.css:207-234, 1263-1297` |
| Carrito sticky con cantidad y total siempre legibles | `styles/storefront.css:594-645` |
| Estado vacío: `Limpiar búsqueda` ≠ `Ver todo el catálogo` | `js/ui.js:1026-1046` |
| Bottom sheet de producto en móvil | `styles/catalog.css:563-717` |
| Carrito lateral a ≥1180 px | `styles/catalog.css` (nuevo `@media`) |

### Commit 5 — `feat(ui): responsive, skeletons y accesibilidad`

| Cambio | Archivo |
|---|---|
| Consolidar media queries duplicadas (5×820, 3×560, 2×360) | `styles/responsive.css` |
| Migrar a mobile-first `min-width` | `styles/responsive.css` |
| Eliminar reglas muertas (`:741`, `:753`, `:761`) | `styles/responsive.css` |
| Skeletons con geometría real en grilla y rails | `js/ui.js:1010-1047`, `styles/catalog.css` |
| Quitar `overflow-x: hidden` de `body` una vez verificado que no hay desborde | `styles/tokens.css:76-86` |
| Acotar `overflow-wrap: anywhere` a campos de dato de usuario | `styles/tokens.css` |
| Sidebar de categorías + nav superior a ≥900 px | `styles/catalog.css`, `styles/responsive.css` |

### Commit 6 — `test(ui): evidencia visual y de accesibilidad`

| Cambio | Archivo |
|---|---|
| Test de presupuesto de pliegue: ≥1 precio visible en 390×844 | `tests/e2e/catalog-fold.spec.mjs` (nuevo) |
| Test de navegación del negocio sin recorte en 390×844 | `tests/e2e/business-mobile.spec.mjs` (nuevo) |
| Test de `aria-current` único por documento | `tests/e2e/a11y-nav.spec.mjs` (nuevo) |
| Test de objetivos táctiles ≥44 px con excepciones declaradas | ampliar `tests/e2e/` |
| Test de estabilidad de carga (sin salto >100 px tras el primer paint) | nuevo |
| Actualizar capturas de referencia | `docs/` |

---

## 2. Archivos que se modificarían

| Archivo | Commits | Riesgo |
|---|---|---|
| `styles/tokens.css` | 0, 4, 5 | Medio — global |
| `styles/business.css` | 1, 2 | Bajo — sólo negocio |
| `styles/catalog.css` | 3, 4 | **Alto** — cliente |
| `styles/responsive.css` | 1, 4, 5 | **Alto** — global |
| `styles/storefront.css` | 3, 4 | Medio |
| `index.html` | 3 | Medio |
| `js/ui.js` | 0, 3, 4, 5 | **Alto** |
| `js/business.js` | 1, 2 | Medio |
| `tests/e2e/beverage-storefront.spec.mjs` | 3 | Bajo — obligatorio |
| `tests/e2e/*` (nuevos) | 6 | Bajo |

## 3. Archivos que **no** se tocan

`styles/tracking.css`, `styles/rider.css`, `styles/checkout.css`,
`styles/profile.css`, `styles/showcase.css`, `js/map/*`, `js/tracking/*`,
`js/realtime.js`, `js/core/realtime-sync.js`, `js/core/domain.js`,
`js/core/pricing.js`, `js/repositories/*`, `js/vendor/*`,
`scripts/realtime-relay.mjs`, `supabase/`, `sw.js`, `manifest.webmanifest`.

---

## 4. Pruebas necesarias

**Por commit:** `npm test` + `npx playwright test` completos. Ningún commit se
sube con la suite roja.

**Específicas del rediseño:**

| Prueba | Umbral |
|---|---|
| Precio sobre el pliegue | ≥1 en 390×844, ≥2 en 430×932 |
| Nav del negocio sin recorte | `scrollWidth ≤ clientWidth + 2` en 390×844 |
| Objetivos táctiles | ≥44 px, con lista blanca explícita de excepciones |
| `aria-current="page"` | exactamente 1 por documento y por vista |
| Desborde horizontal | 0 px en los 6 breakpoints |
| Estabilidad de carga | sin salto >100 px de alto tras el primer paint |
| Superficie roja | ≤10 % de píxeles del viewport en catálogo |
| Contraste | AA en texto y controles |

**Manual, en dispositivo real:** el Moto G15 del usuario a 360 px, con teclado
abierto, y un iPhone con notch para verificar `safe-area-inset-bottom`.

---

## 5. Estimación por etapas

| Commit | Alcance | Estimación |
|---|---|---|
| 0 | Tokens y correcciones puntuales | 0,5 día |
| 1 | Negocio móvil | 2 días |
| 2 | Negocio escritorio | 2,5 días |
| 3 | Catálogo y tarjetas | 2 días |
| 4 | Carrito y superficies fijas | 1,5 días |
| 5 | Responsive y accesibilidad | 1,5 días |
| 6 | Pruebas y evidencia | 1 día |
| | **Total** | **11 días** |

Supone un desarrollador dedicado sobre una base estabilizada. Los commits 1 y 2
son los únicos paralelizables entre sí; el resto es secuencial porque comparten
`responsive.css`.

---

## 6. Fuera de alcance

Se declara explícitamente para que nadie lo espere en esta entrega.

- **Tracking, mapas y MapLibre.** Recién estabilizados; no se tocan.
- **Relay, Supabase y repositorios.** Ningún cambio de datos ni de transporte.
- **Modelo de pedidos, precios y promociones.** No se agrega ninguna promoción,
  descuento ni señal de popularidad que no exista hoy.
- **Checkout y perfil.** Sólo heredan los tokens; su layout no se rediseña.
- **Vista rider.** Sólo recibe el `.sync-chip` unificado.
- **Modo oscuro.** `tokens.css` declara `color-scheme: light`; no se agrega.
- **Internacionalización.** Todo sigue en es-AR.
- **Refactor de `js/business.js` (104 KB) y `js/ui.js` (111 KB).** Se tocan las
  funciones necesarias; no se dividen los módulos. Ese refactor merece su propio
  proyecto y mezclarlo con un rediseño visual haría imposible revisar cualquiera
  de los dos.
- **Rediseño de Inicio.** Sólo recibe el componente de categorías unificado, los
  skeletons y la baja del `PREVIEW INTERNA`. Su estructura de rails no se
  rediseña en esta tanda.
