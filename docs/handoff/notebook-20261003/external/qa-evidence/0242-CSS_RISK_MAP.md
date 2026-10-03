# TABA — Mapa de riesgo del CSS

Base: `C:\1212\la-taba-catalog-checkout-premium` (sólo lectura). 11.313 líneas de CSS en 11 archivos importados en cadena desde `styles.css`.

| Archivo | Líneas | Superficie |
|---|---:|---|
| `styles/tracking.css` | 2.981 | Seguimiento cliente |
| `styles/storefront.css` | 1.714 | Home/tienda |
| `styles/responsive.css` | 1.385 | **Todas** (breakpoints) |
| `styles/checkout.css` | 914 | Checkout |
| `styles/catalog.css` | 717 | Catálogo |
| `styles/common.css` | 723 | Todas |
| `styles/showcase.css` | 594 | Demo |
| `styles/profile.css` | 575 | Perfil |
| `styles/business.css` | 456 | Negocio |
| `styles/rider.css` | 352 | Rider |
| `styles/tokens.css` | 136 | Todas |

---

## R1 · Token derivado que no resuelve — el riesgo estructural principal

**Severidad: alta. Es la causa raíz de P0-01.**

```css
/* tokens.css:50 */
:root { --taba-bottom-nav-clearance: calc(var(--taba-bottom-nav-height) + var(--taba-bottom-nav-gap) + var(--safe-area-bottom)); }
/* responsive.css:65 (dentro de @media max-width:820px, sobre :root) */
:root { --taba-floating-cart-reserve: calc(var(--taba-bottom-nav-clearance) + var(--taba-floating-cart-height) + var(--taba-floating-cart-gap)); }
```

La sustitución de una custom property se resuelve **en el elemento donde se declara**. Ambas están declaradas en `:root`, así que cualquier redefinición de sus entradas en un scope inferior (`body`, `body[data-…]`) **no las afecta**: el valor ya quedó fijado con los valores de `:root`.

- **Cómo detectarlo:** en DevTools, `getComputedStyle(main).getPropertyValue('--taba-floating-cart-reserve')` devuelve una expresión con los valores de `:root`, no los del contexto.
- **Mitigación:** declarar el token derivado en el mismo scope donde varían sus entradas, o componer en el sitio de uso. Ver la regla escrita en `design-system/taba-tokens.css`.
- **Verificación reproducible:** este mismo error apareció espontáneamente al construir el prototipo de esta propuesta y se detectó midiendo, no leyendo. Cualquier corrección debe verificarse con una medición al final del scroll, no por inspección visual.

## R2 · Cuatro fuentes de verdad para la altura de la nav inferior

| Origen | Valor |
|---|---|
| `tokens.css:45` | `104px` |
| `responsive.css:63` (≤820px) | `76px` |
| `responsive.css:110` | `min-height: calc(70px + safe)` |
| `showcase.css:467,480` | fallback `82px` |
| **Medición real** | **68px** |

Todo cálculo de reserva, `bottom:` de sticky, `scroll-padding-bottom` y posición del toast depende de este número. **Mitigación:** una sola declaración; el resto derivado. Prohibir literales de altura de chrome fuera de `tokens.css`.

## R3 · Números mágicos acoplados a filas de grid

```css
/* catalog.css:221 */ .product-card { grid-template-rows: 190px minmax(78px, 1fr) 62px; min-height: 330px; }
/* catalog.css:252 */ .product-media-control { position: absolute; bottom: 136px; right: 10px; }
```
`136 ≈ 62 + 78 - 4`. Si cambia cualquier fila, el control se desplaza sobre el contenido. Es la causa de P0-02.
**Mitigación:** ningún control absoluto anclado a una medida derivada de otra regla. Las acciones van en flujo. El único absoluto admisible dentro de la tarjeta es el favorito, anclado a `.p-media`, que tiene `aspect-ratio` propio y por lo tanto altura conocida.

## R4 · Superficies fijas/sticky superpuestas sin escala común

| Elemento | Posición | z-index | Alto medido |
|---|---|---:|---:|
| `header.topbar` | sticky | 1000 | 70–72 |
| `nav.mobile-nav` | fixed | 1150 | 68 |
| `button.floating-cart` | fixed | 1200 | 52 (62 en desktop) |
| `div.toast` | fixed | 3000 | 48–69 |
| `.checkout-form .button-row` | sticky | 8 | — |
| `.sandbox-tools-panel` | fixed | 40 | — |
| `.sandbox-map-stats` | absolute | 500 | — |

Tres órdenes de magnitud distintos y ningún criterio. `z-index: 8` del checkout convive con `z-index: 3000` del toast.
**Mitigación:** escala de 9 niveles documentada; ningún `z-index` literal fuera de los tokens.

## R5 · Sticky del checkout anclado al token roto

```css
/* responsive.css:290-297 */
.checkout-form .button-row { position: sticky; bottom: calc(var(--taba-bottom-nav-clearance) + 8px); z-index: 8; }
```
Hereda el error de R1/R2 en el paso donde el usuario confirma la compra. **Riesgo comercial máximo**: si la CTA de confirmar queda parcialmente bajo el stack, el pedido no se cierra. Verificar explícitamente en 320×568 con teclado abierto.

## R6 · Breakpoints contradictorios y dependientes del orden de fuente

- `@media (max-width: 820px)` aparece **al menos tres veces** en `responsive.css` (líneas 61, 1111 y otras), con reglas que se pisan entre sí.
- `catalog.css:514` define `@media (max-width: 560px)` con `min-height: 316px` para la tarjeta, mientras `responsive.css:263-270` define la grilla y el media a 820px. Dos archivos distintos gobiernan el mismo componente en rangos solapados.
- Varias reglas dependen de que el `@media` esté **después** de la definición base (misma especificidad, gana el orden). Al concatenar o reordenar imports, se rompen silenciosamente.

**Comprobado en esta propuesta:** al escribir los prototipos, dos reglas dentro de `@media` colocadas **antes** de la definición base no tuvieron efecto (`.k-side{display:none}` y `.d-tab{min-height:44px}`). El síntoma es idéntico al de un bug de layout y sólo se detecta midiendo.
**Mitigación:** los breakpoints van siempre después de la definición base del componente, en el mismo archivo, y se declara un único juego de breakpoints en el sistema.

## R7 · `:has()` como mecanismo de layout crítico

```css
/* responsive.css:1120-1126 */
html:has([data-floating-cart]:not(.hidden)) { scroll-padding-bottom: var(--taba-floating-cart-reserve); }
body:has([data-floating-cart]:not(.hidden)) main[data-app-main] { padding-bottom: var(--taba-floating-cart-reserve); }
/* responsive.css:87-91 */
body[data-active-view="tracking"]:has(.tracking-premium) main[data-app-main] { padding-bottom: 0; }
```
La especificidad de `:has()` es la de su argumento más específico, lo que produce comparaciones no evidentes contra reglas hermanas (`body[data-active-view="home"] main[data-app-main]`). Además, si el estado del carrito se expresa alternando `.hidden`, cualquier cambio en ese nombre de clase rompe la reserva **sin error**.
**Mitigación:** expresar el estado con un atributo en `body` (`data-cart="filled"`) y usar selectores de atributo simples. El `:has()` queda para conveniencias, no para invariantes de layout.

## R8 · Reglas globales demasiado amplias

- `styles.css`: bloque `@media (hover:none),(pointer:coarse)` con ~35 selectores enumerados manualmente para `touch-action: manipulation`. Cada componente nuevo debe acordarse de sumarse a esa lista.
- `tokens.css:104-108`: `img, svg { display:block; max-width:100% }` — correcto, pero conviene documentarlo como decisión.
- `tokens.css:117-122`: `h1,h2,h3,strong { overflow-wrap: anywhere }` — evita overflow pero **permite cortes de palabra feos** en precios y nombres de producto.
- `body { overflow-x: hidden }` — oculta desbordes en vez de impedirlos: enmascara regresiones. Las mediciones dan `horizontalOverflowPx = 0` en todos los viewports, pero eso puede deberse a esta regla.
**Mitigación:** mantener `overflow-x: hidden` pero añadir un test que mida `scrollWidth` **con la regla desactivada** en CI.

## R9 · Componentes con markup distinto para la misma función

| Función | Implementaciones detectadas |
|---|---|
| Tarjeta de producto | `.product-card` (catálogo) · `.home-catalog-card` · `.offer-card` · `.recommendation-card` · rail de `.home-best-sellers.offers-rail` |
| Media de producto | `.product-media` · `.home-catalog-media` · `.offer-card-media` · `.recommendation-media` · `.promo-product-art .thumb` |
| Favorito | `.product-favorite` · `.home-favorite-button` |
| Cantidad | `.qty-stepper` · `.quantity-control` · `.modal-quantity-field` |

Cinco variantes de tarjeta y tres de stepper. Es la causa directa de P1-05 (rail roto) y del costo alto de cualquier cambio visual.
**Mitigación:** un componente `p-card` con modificadores de densidad; un `p-step` único.

## R10 · Safe areas

`index.html:5` declara `viewport-fit=cover` y `tokens.css:49` define `--safe-area-bottom`. Está bien planteado, pero el valor se consume dentro de los tokens rotos de R1, así que en iPhone con barra de gestos la reserva efectiva es aún menor. **Verificar en iPhone físico**, no en emulación: Chromium devuelve `env(safe-area-inset-bottom) = 0`.

## R11 · Cadena de `@import` bloqueante

`styles.css` importa 11 hojas en serie. El navegador no descubre `responsive.css` hasta haber descargado y parseado las anteriores. En red móvil de Neuquén son varios RTT antes del primer render correcto. `esbuild` ya es dependencia del proyecto: el bundle es una mejora barata.

## R12 · Dependencia externa de CSS por CDN

`index.html:15-20` carga `maplibre-gl.css` desde `unpkg.com` con SRI. Si unpkg falla, el mapa del seguimiento y del rider queda sin estilos. Con SRI, un cambio de bytes upstream **bloquea** la hoja. **Mitigación:** auto-hospedar.

---

## Prioridad de intervención

1. **R1 + R2 + R4** — tokens de chrome y escala z. Desbloquea P0-01, P1-03 y R5.
2. **R3 + R9** — anatomía de tarjeta y unificación de componentes. Desbloquea P0-02, P1-05, P1-07.
3. **R6** — orden y unicidad de breakpoints. Requisito para que 1 y 2 no regresen.
4. **R7 + R8** — expresar estado por atributo, reducir reglas globales.
5. **R11 + R12** — rendimiento y resiliencia.
