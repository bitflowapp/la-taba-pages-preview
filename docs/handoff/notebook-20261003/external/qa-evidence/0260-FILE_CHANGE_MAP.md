# TABA — Mapa de cambios por archivo

Rutas relativas a `C:\1212\la-taba-catalog-checkout-premium`. **Ningún cambio de esta tabla fue aplicado.**

⚠️ El árbol tiene trabajo sin commitear de otro agente en `index.html`, `js/app.js`, `js/business.js`, `js/ui.js`, `js/realtime.js`, `js/core/realtime-sync.js`, `js/customer-delivery.js`, `js/customer-profile-view.js`, `js/delivery.js`, `styles/checkout.css`, `sw.js`, repositorios y tests. **Coordinar antes de tocar cualquiera de ellos.**

## Etapa 1 — Tokens y stack inferior

| # | Archivo | Componente | Cambio exacto | Selector / símbolo | Depende de | Riesgo | Prueba | Orden |
|---|---|---|---|---|---|---|---|---|
| 1.1 | `styles/tokens.css` | Tipografía | Quitar `Inter` del stack; dejar `system-ui, -apple-system, "Segoe UI", Roboto, …` | `:root { --font-sans }` | — | **Bajo**: hoy Inter no se carga, así que no cambia el render | Captura de referencia antes/después idéntica | 1 |
| 1.2 | `styles/tokens.css` | Chrome | Reemplazar `--taba-bottom-nav-height: 104px`, `--taba-bottom-nav-gap`, `--taba-floating-cart-height/gap` por `--nav-h: 56px`, `--cta-h: 56px`, `--stack-gap: 8px`, `--safe-b`, `--nav-block` | `:root` | — | **Alto**: lo consumen 6 archivos | Test de solape del stack en 320/375/390/430/768 | 2 |
| 1.3 | `styles/tokens.css` | Chrome | **Mover** la reserva derivada a `body` y añadir `body[data-cart="filled"]` | `body { --cta-block; --bottom-reserve }` | 1.2 | **Alto** | Idem 1.2 + medición al final del scroll | 3 |
| 1.4 | `js/ui.js` | Estado del carrito | Escribir `document.body.dataset.cart = count ? 'filled' : 'empty'` en el render del carrito | junto a `[data-floating-cart-count]` (≈línea 1375) | 1.3 | Medio — **archivo con cambios sin commitear** | Unit: el atributo refleja el contador | 4 |
| 1.5 | `styles/responsive.css` | Chrome | Eliminar la redefinición `--taba-bottom-nav-height: 76px` y `--taba-floating-cart-reserve` | líneas 61-68 | 1.2, 1.3 | Alto | Idem | 5 |
| 1.6 | `styles/responsive.css` | Nav inferior | `.mobile-nav`: `min-height: calc(70px + safe)` → `height: var(--nav-block)`; píldora flotante → barra a sangre con hairline | líneas 101-117 | 1.2 | Medio — cambio visual | Captura visual + solape | 6 |
| 1.7 | `styles/responsive.css` | Reserva | `main[data-app-main] { padding-bottom: var(--bottom-reserve) }` en un único lugar; borrar los duplicados | líneas 84, 1116-1126 | 1.3 | Alto | Solape | 7 |
| 1.8 | `styles/responsive.css` | Carrito sticky | `.floating-cart { bottom: calc(var(--nav-block) + var(--stack-gap)); height: var(--cta-h) }` y ocultar con carrito vacío | líneas 207-233 | 1.3 | Alto | Solape + “no existe si está vacío” | 8 |
| 1.9 | `styles/responsive.css` | Aviso efímero | `.toast, .pwa-banner-update { bottom: calc(var(--bottom-reserve) + 8px) }` | líneas 119-122 | 1.3 | Medio | El toast no cubre contenido | 9 |
| 1.10 | `styles/responsive.css` | Checkout | `.checkout-form .button-row { bottom: calc(var(--bottom-reserve) + 8px) }` | líneas 290-297 | 1.3 | **Alto — toca la compra** | E2E de checkout en 320×568 con teclado abierto | 10 |
| 1.11 | `styles/showcase.css` | Chrome | Eliminar los fallbacks literales `82px` / `52px` / `12px` | líneas 460-485 | 1.2 | Bajo | Visual del showcase | 11 |
| 1.12 | `styles/profile.css` | Chrome | `padding-bottom: calc(var(--taba-bottom-nav-clearance) + 18px)` → `var(--bottom-reserve)` | línea 497 | 1.3 | Bajo | Solape en Perfil | 12 |
| 1.13 | `styles/tokens.css` | Z-index | Añadir la escala de 9 niveles | `:root` | — | Bajo | — | 13 |
| 1.14 | `styles/*.css` | Z-index | Sustituir 1000/1150/1200/3000/500/40/8 por tokens | `.topbar`, `.mobile-nav`, `.floating-cart`, `.toast`, `.sandbox-*`, `.checkout-form .button-row` | 1.13 | Medio — orden de apilamiento | Visual de todas las capas superpuestas | 14 |
| 1.15 | `styles/tokens.css` | Color | `--taba-success: #18864b` → `#0f7a3d`; añadir `--taba-line-strong: #878f9d` | `:root` | — | Bajo | Cómputo de contraste en CI | 15 |
| 1.16 | `styles/common.css` | Campos | Borde de `input`/`select`/`textarea` → `--taba-line-strong` | selectores de campo | 1.15 | Bajo | Contraste ≥ 3:1 | 16 |

## Etapa 2 — Tarjeta de producto

| # | Archivo | Cambio exacto | Selector | Riesgo | Prueba | Orden |
|---|---|---|---|---|---|---|
| 2.1 | `styles/catalog.css` | Eliminar `grid-template-rows: 190px minmax(78px,1fr) 62px` y `min-height: 330px`; pasar a `grid-template-rows: auto 1fr` | `.product-card` (218-231) | **Alto** | Visual en 320/390/430/768/1280 | 1 |
| 2.2 | `styles/catalog.css` | `.product-media { aspect-ratio: 1/1; background: #fff; border-bottom: 1px solid … }` | `.product-media` (243-250) | Alto | Área del packshot ≥ 30 % | 2 |
| 2.3 | `styles/catalog.css` | `.thumb-img { padding: 4px }` (era `11%`) | `.thumb-img` (271-279) | Medio | Visual | 3 |
| 2.4 | `styles/catalog.css` | **Eliminar** `.product-media-control` con `position:absolute; bottom:136px` | `.product-media-control` (252-257) | **Alto — corrige P0-02** | Test de intersección título/control | 4 |
| 2.5 | `js/ui.js` | Mover la acción al pie de la tarjeta, en flujo, dentro de `.product-foot` | plantilla de tarjeta (≈1049+) | **Alto — archivo con cambios sin commitear** | E2E de agregar/quitar | 5 |
| 2.6 | `styles/catalog.css` | Nuevo `.product-foot` apilado; `--inline` sólo ≥700px | nuevo bloque | Medio | Visual y táctil | 6 |
| 2.7 | `styles/catalog.css` | Unificar `.qty-stepper` y `.quantity-control`; controles de 44px | 381-465, 558+ | Medio | Objetivos táctiles | 7 |
| 2.8 | `styles/catalog.css` | Quitar `min-height` encadenados de `h3`/`p`/`.product-availability`; `line-clamp: 2` sin `min-height` | 321-345 | Bajo | Visual con nombres largos | 8 |
| 2.9 | `styles/catalog.css` | `.product-favorite`: 44×44, anclado al media, contraste sobre blanco | 466-495 | Bajo | Táctil y contraste | 9 |

## Etapa 3 — Meta y estado vacío del catálogo

| # | Archivo | Cambio exacto | Símbolo | Riesgo | Prueba | Orden |
|---|---|---|---|---|---|---|
| 3.1 | `js/ui.js` | `renderCatalogMeta()`: el título usa la consulta si existe, si no la categoría | línea 986 | Medio | El título contiene la consulta | 1 |
| 3.2 | `js/ui.js` | Contador con contexto: `0 productos en Gaseosas` | 987-992 | Bajo | Texto del contador | 2 |
| 3.3 | `js/ui.js` | Con consulta activa, **ninguna categoría** queda activa | render de categorías | Medio | Ningún `aria-pressed=true` | 3 |
| 3.4 | `js/ui.js` | Chip de búsqueda removible antes de las categorías | render de categorías | Bajo | El chip existe y limpia | 4 |
| 3.5 | `js/ui.js` | Estado vacío: nombra la consulta; acción primaria **“Limpiar búsqueda”** | 1017-1046 | Bajo | Control accesible por nombre | 5 |
| 3.6 | `js/ui.js` | Ocultar la barra de orden con 0 resultados | 993-994 | Bajo | Ausente del árbol de accesibilidad | 6 |
| 3.7 | `index.html` | Eliminar el badge “PREVIEW INTERNA” de la superficie cliente | `.home-preview-label` | Bajo | El texto no aparece en el DOM del cliente | 7 |
| 3.8 | `js/ui.js` + `styles/storefront.css` | Unificar el rail “Los más vendidos” con `.product-card` | `.home-best-sellers.offers-rail` | **Alto — corrige P1-05** | Altura de tarjeta del rail > 200px; muestra nombre y precio | 8 |
| 3.9 | `data/` o `js/data.js` | Exponer la variante de `speed-original` / `speed-zero` | catálogo | Bajo | Unicidad de `(nombre, presentación)` | 9 |

## Etapa 4 — Header, categorías y dirección

| # | Archivo | Cambio | Selector | Riesgo | Orden |
|---|---|---|---|---|---|
| 4.1 | `styles/responsive.css` | `.topbar { min-height: 56px }` (era 70) | 1140-1143 | Medio | 1 |
| 4.2 | `index.html` + `js/ui.js` | Carrito del header: icono con badge que sólo existe con contenido | `.cart-button` | Medio | 2 |
| 4.3 | `index.html` + `styles/storefront.css` | Dirección: de tarjeta de 92px a control de 44px en el header | tarjeta de dirección | Medio | 3 |
| 4.4 | `styles/storefront.css` | Categorías: de tarjetas de 105px a chips de 44px con máscara | categorías home y catálogo | Medio | 4 |
| 4.5 | `styles/catalog.css` | H1 de 22px; quitar el eyebrow del catálogo | `.section-head` | Bajo | 5 |

## Etapa 5 — Negocio móvil

| # | Archivo | Cambio | Riesgo | Orden |
|---|---|---|---|---|
| 5.1 | `js/business.js` + `styles/business.css` | Sustituir las 4 tarjetas de métrica por la banda de 52px que además filtra | **Alto** | 1 |
| 5.2 | `js/business.js` | Eliminar la segunda fila de tabs de estado (queda fusionada en la banda) | Medio | 2 |
| 5.3 | `index.html` + `js/business.js` | Tabs de sección → bottom nav de 4 destinos + stack | **Alto** | 3 |
| 5.4 | `js/business.js` | App bar de 56px con contexto, sincronización y sonido; quitar el H1 gigante y la fila “Vista rider / Salir” | Medio | 4 |
| 5.5 | `js/business.js` | Tarjeta de pedido compacta con acción en tinta | Medio | 5 |
| 5.6 | `js/business.js` | Detalle como pantalla apilada con acción primaria sticky y nav retirada | **Alto** | 6 |
| 5.7 | `js/core/realtime-sync.js` | Franja de conexión sólo cuando no está sincronizado, con hora del último dato | Medio — **archivo con cambios sin commitear** | 7 |
| 5.8 | `js/business.js` | Sección “Local” con filas agrupadas | Bajo | 8 |

## Etapa 6 — Negocio escritorio

| # | Archivo | Cambio | Riesgo | Orden |
|---|---|---|---|---|
| 6.1 | `styles/business.css` | Layout master-detail de 3–4 paneles con scroll independiente | **Alto** | 1 |
| 6.2 | `styles/business.css` | Sidebar de 224px con 8 secciones y contadores; colapso a riel de iconos <1280 | Medio | 2 |
| 6.3 | `styles/business.css` | Métricas en banda de 46px, sólo accionables | Bajo | 3 |
| 6.4 | `js/business.js` | Selección en la cola + detalle sincronizado | Medio | 4 |
| 6.5 | `styles/business.css` | Riel de acciones ≥1440 | Bajo | 5 |
| 6.6 | `styles/business.css` | Barra superior que suelta contexto antes que la búsqueda por debajo de 1120 | Bajo | 6 |

## Etapa 7 — Catálogo escritorio

| # | Archivo | Cambio | Riesgo | Orden |
|---|---|---|---|---|
| 7.1 | `styles/catalog.css` | Grilla `repeat(auto-fill, minmax(214px,1fr))` en lugar de 4 columnas fijas | Medio | 1 |
| 7.2 | `styles/catalog.css` + `index.html` | Sidebar de filtros de 216px con contadores | Medio | 2 |
| 7.3 | `styles/catalog.css` | Panel “Mi pedido” de 320px, sólo con carrito lleno | Medio | 3 |
| 7.4 | `styles/catalog.css` | Modal de detalle con `<dialog>` | Medio | 4 |
| 7.5 | `styles/responsive.css` | Límite de 1680px a partir de 1920 | Bajo | 5 |

## Archivos que NO se tocan

`styles/tracking.css` (2.981 líneas — sólo hereda tokens), `js/tracking/*`, `js/map/*`, `js/sandbox/*`, `scripts/realtime-relay.mjs`, `supabase/`, `sw.js`, `manifest.webmanifest`.

**`sw.js` merece atención aparte:** cambiar CSS sin invalidar la caché del service worker puede servir estilos viejos. Verificar la estrategia de versionado (`styles.css?v=40`) antes de la etapa 1.
