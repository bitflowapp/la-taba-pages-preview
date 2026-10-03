# TABA — Catálogo cliente desktop

Prototipo: `prototypes/prototype-catalog-desktop.html`
Capturas: `catalog-desktop-1024x768`, `-1280x900`, `-1440x1000`, `-1920x1080`, `catalog-tablet-768x1024`.

## Principio

No es la versión móvil estirada. En escritorio hay ancho suficiente para que **filtro, catálogo y pedido convivan sin navegar**, que es lo que aumenta el ticket. La tarjeta se **adapta**, no se escala: al ganar ancho, el precio y la acción vuelven al mismo renglón.

---

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│ Barra superior 60px  · marca · nav · buscador · dirección · 🛒 │
├──────────┬──────────────────────────────────┬─────────────────┤
│ Sidebar  │  Título + orden                  │  Mi pedido      │
│ 216px    │  Grilla auto-fill                │  320px          │
│ sticky   │  minmax(214px, 1fr)              │  sticky         │
│          │                                  │                 │
│ Categoría│                                  │  líneas         │
│ Present. │                                  │  subtotal       │
│ Dispon.  │                                  │  envío          │
│          │                                  │  total          │
│          │                                  │  [Confirmar]    │
└──────────┴──────────────────────────────────┴─────────────────┘
```

**La columna del pedido sólo existe con carrito lleno** (`body[data-cart="filled"]`). Con carrito vacío, la grilla ocupa ese espacio: no hay un panel vacío ocupando un tercio de la pantalla.

## Barra superior — 60px, liviana

`[TABA] [Inicio · Catálogo · Seguir mi pedido · Perfil] ————— [buscador 420px] [dirección] [🛒]`

Sin hero, sin eyebrow, sin fondo negro. Papel translúcido con desenfoque y hairline. La navegación es de enlaces de 44px con estado `aria-current`.

## Sidebar de filtros — 216px, sticky

Tres grupos con contador por opción:

- **Categorías** — Todos 22 · Favoritos · Gaseosas 7 · Mixers 2 · Energizantes 5 · Cervezas 8
- **Presentación** — Unidad 11 · Pack 11
- **Disponibilidad** — Disponible ahora 21

Filas de 44px, activo `ink-900`. Los contadores son **datos reales del catálogo**, no adornos: si un filtro da 0, se ve antes de aplicarlo.

Separadores con la regla “horizonte” (degradado de 1px), único gesto gráfico de la dirección visual.

## Grilla

`repeat(auto-fill, minmax(214px, 1fr))`, gap 18. Columnas resultantes:

| Viewport | Ancho útil de grilla | Columnas |
|---|---:|---:|
| 1024×768 | ~760 | 3 |
| 1280×900 (carrito lleno) | ~660 | 3 |
| 1280×900 (carrito vacío) | ~1000 | 4 |
| 1440×1000 | ~820 | 3–4 |
| 1920×1080 | ~1090 con `minmax(232px)` | 4–5 |

**El número de columnas no se declara**: se deriva del ancho mínimo de tarjeta. Así ningún breakpoint queda desincronizado con el layout.

## Tarjeta

El mismo componente `p-card` que en móvil, con una sola diferencia: `p-foot--inline` devuelve **precio y acción al mismo renglón**, con la acción como botón cuadrado de 44px. Con ~214px de ancho hay espacio; con 171px no lo había.

Hover: borde más marcado + `e2`. Sin desplazamiento vertical (nada de `translateY`), que en una grilla densa produce ruido.

## Panel “Mi pedido” — 320px, sticky

Encabezado con contador y “Vaciar”; líneas con miniatura de 48px, nombre truncado, presentación, importe de línea y `n × precio unitario`; resumen con subtotal, envío y total; **una sola** acción primaria “Confirmar pedido” y una línea honesta: “Elegís forma de pago en el siguiente paso”.

`max-height: 46vh` con scroll interno en las líneas para que el resumen y la CTA queden siempre visibles.

## Detalle — modal `<dialog>`

Dos columnas: media a 380px sobre blanco (el packshot manda) y contenido a la derecha con marca, nombre, presentación, disponibilidad, descripción, precio de 26px, stepper, “Agregar al pedido” y favorito.

Se usa `<dialog>` nativo: `showModal()` da atrapado de foco, `Esc` y backdrop inerte sin código propio. Por debajo de 720px pasa a una sola columna.

## Comportamiento por breakpoint

| Viewport | Sidebar | Grilla | Pedido | Barra superior |
|---|---|---|---|---|
| **768×1024** (tablet) | Oculto — los filtros vuelven a chips sobre la grilla | 3 col mín. 190px | Oculto: el carrito se abre desde el icono | Sin enlaces ni dirección; buscador flexible |
| **1024×768** | 196px | 3 col | Oculto (`≤1279`) | Completa |
| **1280×900** | 196px | 3–4 col | Oculto | Completa |
| **1440×1000** | 216px | 3–4 col | **Visible 320px** | Completa |
| **1920×1080** | 216px | 4–5 col (mín. 232px) | Visible | Completa, contenido limitado a 1680px centrado |

Decisión: el panel de pedido aparece **a partir de 1280px reales de contenido**; por debajo compite con la grilla y deja tarjetas de menos de 200px, que es donde la tarjeta deja de funcionar.

En **1920** el contenido se limita a 1680px centrado: una grilla de 6–7 columnas a ancho completo convierte el catálogo en un depósito y aleja el precio del nombre.

## Estados

- **Búsqueda:** el título pasa a `Resultados para «imperial»`, con la misma regla que en móvil.
- **Vacío por búsqueda:** nombra la consulta, “Limpiar búsqueda” como primaria, y “Buscar en todo” si el filtro estaba acotado.
- **Vacío por categoría:** ofrece el catálogo completo.
- **Favoritos vacíos:** explica cómo guardar.
- **Carga:** 10 esqueletos con la caja exacta de la tarjeta.
- **Producto sin precio:** idéntico a móvil — pill, “Precio a confirmar”, “Consultar”, no comprable.

## Verificación

| Aserción | Umbral |
|---|---|
| Desbordamiento horizontal en 1024/1280/1440/1920 | 0 px |
| Objetivos táctiles en 768 (táctil) | ≥ 44px |
| Inputs con fuente < 16px | 0 |
| Errores de consola | 0 |
| Tarjetas por fila en 1280 con carrito lleno | ≥ 3 |
| Ancho mínimo de tarjeta | ≥ 214px |
| Panel de pedido con carrito vacío | no ocupa columna |
