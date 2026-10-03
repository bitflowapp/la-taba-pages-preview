# Catálogo — escritorio

Prototipo: `prototype-catalog-desktop.html`
Capturas: `screenshots/catalog-tablet-768x1024.png`,
`catalog-desktop-1280x900.png`

---

## 1. Problema que resuelve

Medido a 1280×900 y 1440×1000:

- Sólo **4 de 22** precios son visibles sin scrollear.
- El encabezado sigue ocupando **486 px** — el mismo bloque vertical que en
  móvil, sin aprovechar los 1280 px de ancho.
- La grilla es de 4 columnas fijas (`catalog.css:207-212`) con `gap: 16px` sobre
  un contenedor de 1180 px: tarjetas de 283 px con un packshot de ~190 px y el
  resto en blanco.
- Las categorías siguen siendo una tira horizontal con scroll, en una pantalla
  que tiene espacio de sobra para mostrarlas todas.
- El carrito sigue siendo un botón flotante. No hay resumen lateral.

En escritorio el problema no es la falta de espacio: es que **el espacio no se
usa**.

---

## 2. Estructura

```
┌────────────────────────────────────────────────────────────────────┐
│ TABA   Inicio  Catálogo  Seguir  Perfil     🔍 Buscar    🛒 2      │ 64
├──────────┬──────────────────────────────────────────┬──────────────┤
│CATEGORÍAS│ Catálogo · 22 bebidas   Orden: [Recom ⌄] │ TU PEDIDO    │
│          │                                          │              │
│ Todos  22│ ┌────────┐┌────────┐┌────────┐┌────────┐ │ 🥤 Coca-Cola │
│ Favoritos│ │        ││        ││        ││        │ │    Original  │
│ Gaseosas6│ │  [🥤]  ││  [🥤]  ││  [🥤]  ││  [🥤]  │ │ 2× $34.200   │
│ Mixers  2│ │     ♡  ││     ♡  ││     ♡  ││     ♡  │ │  [−] 2 [+]   │
│ Energiz 4│ ├────────┤├────────┤├────────┤├────────┤ │              │
│ Cervezas8│ │Coca-Cola││Coca-Cola││Sprite  ││Fanta   │ │ ──────────── │
│          │ │Original ││Zero     ││        ││Naranja │ │ Subtotal     │
│──────────│ │PET 500  ││PET 500  ││PET 500 ││PET 1500│ │    $34.200   │
│ FILTROS  │ │$17.100 +││$17.100 +││$17.100+││$19.999+│ │              │
│ ☐ Sólo   │ └────────┘└────────┘└────────┘└────────┘ │ [Ir al pago] │
│   disponi│ ┌────────┐┌────────┐┌────────┐┌────────┐ │              │
│          │ │        ││        ││        ││        │ │              │
└──────────┴──────────────────────────────────────────┴──────────────┘
   220px                   fluido                        320px
```

### 2.1 Header horizontal — 64 px

Se aligera respecto del topbar actual (`--topbar: 72px`, degradado radial +
lineal + `backdrop-filter: blur(16px)` + sombra).

- Fondo `--taba-surface-inverse` plano. Sin degradado radial, sin blur.
- Izquierda: logo TABA (con su subrayado rojo — uso de marca permitido).
- Centro-izquierda: **nav horizontal** (Inicio · Catálogo · Seguir · Perfil).
  Reemplaza a la barra inferior a partir de 900 px. Activo: subrayado de 2 px en
  blanco + texto blanco pleno. **No rojo** (§7 del sistema de diseño).
- Centro-derecha: buscador de 320 px, siempre visible.
- Derecha: botón de carrito, sólo con contenido.

El contraste duro topbar negro → contenido blanco se suaviza con una franja de
`--taba-surface-sunken` de 1 px de borde bajo el header, en lugar del corte seco
actual.

### 2.2 Sidebar de categorías — 220 px

**Cambio estructural: la tira horizontal con scroll se convierte en lista
vertical.** A ≥900 px se ven las 6 categorías completas sin scroll ni máscara.

- Fila de 40 px: etiqueta a la izquierda, **conteo de productos a la derecha** en
  `--taba-muted`. El conteo es dato real, no decoración.
- Activo: fondo `--taba-surface-sunken`, texto `--taba-ink` en 700, filete
  izquierdo de 3 px en `--taba-ink`. Sin rojo.
- Sticky (`top: 88px`), scroll propio si la lista crece.
- Debajo, un bloque **Filtros** con `☐ Sólo disponibles`. Es el único filtro
  honesto que el modelo de datos soporta hoy: no se inventan filtros por precio,
  marca ni popularidad que no existan.

### 2.3 Barra de contexto

Una sola línea alineada con la grilla:

- Izquierda: `Catálogo · 22 bebidas` (18 px/800). Cambia a
  `Gaseosas · 6 bebidas` al filtrar. Este es el título visible; el `<h1>` no es
  un display de 42 px.
- Derecha: `Orden:` + `<select>` real de 180 px. En escritorio el select nativo
  es correcto; el sheet es sólo para móvil.

**Con 0 resultados el selector de orden no se renderiza.**

### 2.4 Grilla — 3 a 5 columnas

| Ancho | Columnas | Ancho de tarjeta | Cálculo |
|---|---|---|---|
| 600–899 | 3 | ~236 px | sin sidebar, padding 24 px |
| 900–1179 | 3 | ~262 px | sidebar 220 + carrito oculto |
| 1180–1439 | **4** | ~248 px | sidebar 220 + carrito 320 |
| ≥1440 | **5** | ~236 px | sidebar 240 + carrito 320 |

`grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` con `gap: 16px`.
El ancho de la tarjeta se mantiene entre 220 y 280 px en todos los anchos: **el
producto no cambia de tamaño, cambia la cantidad de productos visibles**. Hoy,
con 4 columnas fijas, la tarjeta crece hasta 283 px y el packshot flota en
blanco.

Tarjeta idéntica a la móvil en estructura, con la imagen a `aspect-ratio: 1/1` y
el mismo control en flujo. Se agrega en `:hover` una elevación de
`--shadow-xs` a `--shadow-sm` y el botón `+` pasa a etiqueta `Agregar`.

**Imágenes consistentes:** todos los packshots comparten `aspect-ratio: 1/1`,
`object-fit: contain`, padding del 6 % y fondo blanco. Un pack x12 y una lata de
473 ml se ven al mismo tamaño de caja aunque el producto tenga proporciones
distintas.

### 2.5 Carrito lateral — 320 px

**Cambio estructural: el botón flotante se convierte en panel persistente** a
partir de 1180 px.

- Sticky (`top: 88px`), `max-height: calc(100vh - 112px)`, scroll propio.
- Encabezado `TU PEDIDO` + cantidad.
- Ítems: miniatura de 48 px, nombre a 2 líneas, stepper de 100 px, subtotal.
- Pie fijo dentro del panel: subtotal + `Ir al pago` (única acción primaria de
  la pantalla, y por lo tanto **el único rojo grande**).
- Vacío: `Todavía no agregaste nada` + `Elegí una categoría para empezar`. El
  panel no desaparece: su ausencia haría saltar la grilla de 4 a 5 columnas cada
  vez que se vacía el carrito.

Por debajo de 1180 px el panel se oculta y vuelve el botón de carrito del
header, que abre la vista de carrito.

### 2.6 Detalle de producto

En escritorio se mantiene el **diálogo centrado de dos columnas** que ya existe
(`.modal-card`), corregido:

- `width: min(90vw, 880px)`, `max-height: 86vh`.
- Columna izquierda: imagen `aspect-ratio: 1/1` sobre `--taba-surface-sunken`.
  Hoy `min-height: 480px` fuerza un alto que no respeta la proporción.
- Columna derecha: nombre, presentación, precio, disponibilidad, nota, stepper y
  `Agregar al pedido`.
- `.modal-actions { grid-column: 2 }` se mantiene sólo a ≥900 px; a menos, ya
  está corregido a `grid-column: 1`.
- El padding superior de `.modal-product-copy` baja de 56 px a 32 px: los 56 px
  existen para esquivar el botón de cerrar, que se reubica.

### 2.7 Densidad comercial

| Métrica | Hoy 1280×900 | Propuesto |
|---|---|---|
| Encabezado antes del primer producto | 486 px | **152 px** |
| Precios visibles sin scrollear | 4 / 22 | **12 / 22** |
| Columnas | 4 fijas | 4 (auto-fill 220–280) |
| Carrito visible junto al catálogo | no | sí |
| Categorías visibles sin scroll | 4 de 6 | **6 de 6** |
| Espacio vertical vacío bajo el contenido | ~0 | 0 |

Sin espacios gigantes: el contenedor deja de estar limitado a `--content:
1180px` centrado con márgenes muertos; el layout de tres columnas usa el ancho
completo con `max-width: 1600px`.

---

## 3. Comportamiento por breakpoint

| Ancho | Estructura |
|---|---|
| **768×1024** | Sin sidebar ni carrito lateral. Grilla de **3 columnas**. Categorías siguen siendo tira horizontal, pero entran las 6 sin recorte (medido: sólo 6 % oculto a 768 px). Nav inferior todavía presente. |
| **900–1179** | Aparece la **sidebar de categorías** (220 px). Nav pasa al header, desaparece la barra inferior. Grilla de 3. Sin carrito lateral. |
| **1280×900** | **Tres columnas de layout**: sidebar 220 + grilla 4 + carrito 320. |
| **1440×1000** | Sidebar 240 + grilla **5** + carrito 320. |

El salto en 900 px es el estructural: tres cosas cambian de naturaleza a la vez
(categorías, navegación, carrito).

---

## 4. Accesibilidad

- Sidebar de categorías: `<nav aria-label="Categorías">` con lista y
  `aria-current="true"` en la activa. Un solo `aria-current="page"` en el
  documento sigue siendo el de la nav principal.
- Grilla: `role="list"` con `role="listitem"` por tarjeta; el orden de foco
  sigue el orden visual.
- Carrito lateral: `<aside aria-label="Tu pedido">` con `aria-live="polite"` en
  el subtotal.
- El `<select>` de orden es nativo, con `<label>` visible.
- Foco visible sobre fondo oscuro en el header (`:focus-visible` ya definido).
- Zoom al 200 % en 1280 px: el layout cae a 2 columnas de contenido sin scroll
  horizontal.
- `Ir al pago` es el único elemento con `--taba-red` de fondo en toda la
  pantalla.
