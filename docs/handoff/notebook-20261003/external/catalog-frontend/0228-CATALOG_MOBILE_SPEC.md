# Catálogo — móvil

Prototipo: `prototype-catalog-mobile.html`
Capturas: `screenshots/catalog-mobile-320x568.png`, `catalog-mobile-390x844.png`,
`catalog-mobile-430x932.png`

---

## 1. Problema que resuelve

Medido en la app real:

| | 320×568 | 390×844 | 430×932 |
|---|---|---|---|
| Primer precio (y) | 813 px | 798 px | 801 px |
| **Precios visibles sin scrollear** | **0 / 22** | **0 / 22** | 2 / 22 |
| Encabezado antes del primer producto | 494 px | 495 px | 498 px |
| Banda inferior fija | 28 % | 17 % | 15 % |

El encabezado consume el **59 %** del viewport en 390×844. Un catálogo de
bebidas que no muestra un precio en la primera pantalla no vende.

**Objetivo duro: encabezado ≤300 px y al menos 2 precios visibles en 390×844.**

---

## 2. Estructura

```
┌─────────────────────────────────┐
│ TABA              🛒 2  $34.200 │  topbar 56px
├─────────────────────────────────┤
│ 🔍 Buscar bebidas               │  buscador 44px
├─────────────────────────────────┤
│ 📍 Av. Argentina 450        ›   │  dirección 36px
├─────────────────────────────────┤
│ (Todos)(Gaseosas)(Cervezas)(Mix │  categorías 40px
├─────────────────────────────────┤
│ Catálogo · 22 bebidas   Orden ⌄ │  contexto 36px  ← total 212px
├─────────────────────────────────┤
│ ┌────────────┐ ┌────────────┐   │
│ │            │ │            │   │
│ │   [🥤]     │ │   [🥤]     │   │  imagen 148px
│ │         ♡  │ │         ♡  │   │
│ ├────────────┤ ├────────────┤   │
│ │Coca-Cola   │ │Coca-Cola   │   │
│ │Original    │ │Zero        │   │
│ │PET 500ml x12│PET 500ml x12│   │
│ │            │ │            │   │
│ │$17.100  (+)│ │$17.100  (+)│   │  ← precio visible en 1er viewport
│ └────────────┘ └────────────┘   │
├─────────────────────────────────┤
│ [ 🛒 2 productos     $34.200 › ]│  carrito sticky
│  ── ── 12px de aire ── ──       │
│ [Inicio][Catálogo][Seguir][Perfil]│ nav
└─────────────────────────────────┘
```

### 2.1 Header compacto — 56 px

Se elimina el bloque kicker + H1. `CATÁLOGO` + `Todos` ocupan 104 px para decir
lo que la pestaña activa ya dice.

**Un solo título principal**, en la fila de contexto (§2.5), a 16 px. El `<h1>`
sigue existiendo para el árbol de accesibilidad pero no como un display de
42 px.

Topbar: logo TABA a la izquierda; a la derecha el botón de carrito **sólo si el
carrito tiene algo**. Hoy muestra `🛒 0 · $ 0` permanentemente y ocupa 170 px
para no comunicar nada.

### 2.2 Buscador — 44 px

De `min-height: 64px` a 44 px. Radio `--radius-pill`, borde `--taba-border`,
fondo `--taba-surface`. Lupa en `--taba-muted`, **no en rojo**: es un icono
decorativo (§7 del sistema de diseño). Placeholder corto: `Buscar bebidas`.

### 2.3 Dirección — 36 px

Una línea, no una tarjeta de 54 px. `📍 Av. Argentina 450 ›`, truncada con
`text-overflow: ellipsis` **al final de la línea completa**, no a mitad de
palabra como hoy (`…al confirmar el pe…`).

Sin dirección elegida: `📍 Elegí dónde recibir tu pedido ›` en `--taba-muted`.
El prefijo "ENVIAR A" en rojo desaparece: no aporta y gasta rojo.

### 2.4 Categorías — 40 px

**De fichas de 88×102 px a chips de 40 px de alto.** Chip = etiqueta de texto,
sin icono. Los iconos de categoría en 25 px no se distinguen entre sí (la
medición muestra el mismo glifo genérico para "Todos" y "Mixers") y son el
motivo de los 102 px.

- Activo: fondo `--taba-ink`, texto blanco. **No rojo** (§7).
- Inactivo: fondo `--taba-surface`, borde `--taba-border`.
- Altura táctil: 40 px visual + 4 px de padding vertical = **44 px de área
  táctil real** vía pseudo-elemento.

**Affordance de scroll obligatoria.** Hoy el 37 % de la tira queda oculta sin
ninguna señal. Se agrega una máscara de degradado de 24 px en el borde derecho
mientras haya contenido, con `scroll-snap-type: inline proximity`.

**Una sola fuente de categorías.** Inicio y Catálogo hoy difieren: Catálogo
muestra `Todos, Favoritos, Gaseosas, Mixers, Energizantes, Cervezas`; Inicio sólo
`Gaseosas, Mixers, Energizantes, Cervezas`. Se unifica en un componente
`.cat-bar` con la misma lista y el mismo orden; Inicio puede ocultar `Todos` con
un parámetro, nunca con otro componente.

### 2.5 Fila de contexto — 36 px

`Catálogo · 22 bebidas` a la izquierda (16 px/800 — este es el título visible).
A la derecha, el orden como **botón de texto** que abre un sheet: `Orden ⌄`.

Se elimina el `<select>` de 126 px dentro de una píldora de ancho completo con
`justify-content: flex-end`, que deja ~200 px vacíos.

**Con 0 productos, la fila de orden no se renderiza.**

Presupuesto: 56 + 44 + 36 + 40 + 36 = **212 px** (hoy 495 px).

### 2.6 Tarjeta de producto

Dos columnas fijas. En 390 px: (390 − 32 padding − 12 gap) / 2 = **173 px**.

| Zona | Alto | Contenido |
|---|---|---|
| Imagen | 148 px | packshot + favorito |
| Nombre | 36 px | 2 líneas, `line-clamp: 2`, 15 px/700 |
| Presentación | 16 px | 12 px, `--taba-muted`, 1 línea |
| Precio | 26 px | 18 px/900, `white-space: nowrap` |
| Acción | 44 px | botón o stepper, **ancho completo** |
| **Total** | **~290 px** | (hoy 316–355 px) |

**Precio y acción van en filas separadas.** Se probó la variante de una sola
fila (precio a la izquierda, control a la derecha) y falla de forma medible: en
una tarjeta de 173 px, `$ 17.100` (72 px) más un stepper de 104 px no entran
juntos. El resultado era que el precio se partía en dos líneas — el nodo pasaba
de 26 px a 52 px de alto — y la tarjeta cambiaba de altura según si el producto
estaba o no en el carrito, lo que desalineaba toda la fila de la grilla.

Con dos filas fijas: todas las tarjetas miden lo mismo en cualquier estado, los
precios quedan alineados entre columnas, el control gana ancho completo (área
táctil mucho mayor que un botón redondo de 44 px) y el botón puede llevar texto
(`+ Agregar`) en vez de sólo un glifo.

**Packshot protagonista.** Hoy `.thumb-img` aplica `padding: 11%` con
`object-fit: contain` sobre una botella alta y angosta: la botella queda en
~90 px dentro de una caja de 175×150 px. Se baja el padding a **6 %** y se fija
`aspect-ratio: 1/1` en el contenedor con la imagen centrada. El packshot pasa a
ocupar **~58 % del alto de la tarjeta** (hoy ~40 % con la mitad en blanco).

**El botón deja de flotar.** Se elimina `.product-media-control` con
`position: absolute; bottom: 166px` — el número mágico que produce la deriva de
+14 px en 320 px (auditoría §3.6). El control vive **en flujo**, en la fila de
precio, a la derecha. Sin acoplamiento a `grid-template-rows`, sin deriva
posible por un nombre largo.

- Estado sin cantidad: botón redondo de 44 px con `+`.
- Con cantidad: el stepper reemplaza al botón **dentro de la misma fila**, a
  112 px de ancho (`36px 1fr 36px`, área táctil 44 px). El precio se mantiene
  visible: hoy el stepper de 118 px flota sobre la imagen.

Favorito: 44 px, arriba a la derecha sobre la imagen, `--taba-muted` en reposo y
`--taba-red` activo. Es el **único** rojo permitido en la tarjeta junto al
precio.

Disponibilidad: sólo se muestra cuando **no** es "Disponible" (`Últimas
unidades`, `Sin stock`). Hoy 22 tarjetas repiten "Disponible" en verde: ruido
que ocupa 16 px por tarjeta.

Sombra: ninguna en reposo (sólo borde). 22 sombras en una grilla ensucian.

### 2.7 "Precio a confirmar"

Producto con `pricePending`:

- En lugar del precio: `Precio a confirmar` en 13 px/800, `--taba-warning`.
- El botón de agregar **no existe** (no se deshabilita: se omite). Un botón
  deshabilitado invita a tocarlo.
- En su lugar, `Consultar ›` como texto, que abre el sheet.
- La tarjeta lleva borde `--taba-warning` al 30 %.

No se muestra ningún precio tachado, porcentaje ni "antes $X" que no venga de
una promoción aprobada y vigente. **Sin promociones, descuentos ni popularidad
inventados.**

### 2.8 Carrito sticky y nav

El apilado actual no se solapa (la aritmética de tokens es correcta), pero
consume **28 % del viewport en 320×568**. Cambios:

| | Hoy | Propuesto |
|---|---|---|
| Alto de la nav | 66 px + 10 px de inset | 62 px + 10 px |
| Alto del carrito | 52 px | 56 px |
| Aire entre ambos | 14 px | **12 px, visible** |
| Banda total en 320 px | 28 % | **22 %** |

- El carrito **sólo existe con carrito no vacío**. Hoy también.
- Contenido: `🛒 2 productos` a la izquierda, `$ 34.200 ›` a la derecha. Cantidad
  y total siempre visibles, nunca truncados.
- Reserva de contenido vía `--cart-band` (§2.2 del sistema de diseño), derivada
  de los valores que la barra usa realmente. Se elimina la coincidencia de
  `--taba-bottom-nav-height: 76px` contra una barra que mide 66 px.
- `env(safe-area-inset-bottom)` en la nav, no en el carrito: la nav es la
  superficie más baja.
- **La vista carrito necesita un ítem de nav activo** (auditoría §3.3). Se
  resuelve marcando `Catálogo` como activo mientras se está en el carrito,
  vía `data-nav-match="cart catalog"`.

### 2.9 Estado vacío

```
┌─────────────────────────────────┐
│ TABA                            │
│ 🔍 fernet                    ✕  │
│ 📍 Av. Argentina 450        ›   │
│ (Todos)(Gaseosas)(Cervezas)     │
│ Catálogo · 0 bebidas            │  ← sin selector de orden
├─────────────────────────────────┤
│                                 │
│      No encontramos "fernet"    │  18px/850
│                                 │
│   Probá con la marca o la       │  14px muted
│   presentación.                 │
│                                 │
│      [ Limpiar búsqueda ]       │  secundario 44px
│                                 │
│   También podés ver:            │  12px muted
│   (Gaseosas) (Cervezas)         │  chips sugeridos
└─────────────────────────────────┘
```

- **El selector de orden desaparece** con 0 resultados.
- `Limpiar búsqueda` conserva la categoría. Es distinto de `Ver todo el
  catálogo`, que borra ambos filtros. Hoy hay una sola acción
  (`data-clear-catalog-filters`) que borra los dos mientras el texto dice
  "limpiá el buscador".
- El chip de categoría activa **no** queda seleccionado si el vacío viene de la
  búsqueda: manda el filtro más restrictivo.
- Separación mínima de `--cart-band` respecto del carrito sticky.
- Sin ilustración genérica.

### 2.10 Detalle de producto — bottom sheet

Hoy `.modal-card` declara `grid-template-columns: minmax(250px,.9fr)
minmax(300px,1.1fr)` (≥550 px) dentro de un modal de `min(100vw - 24px, 760px)`.
En 390 px eso serían 366 px para un contenido que pide 550. **Está correctamente
corregido** por `responsive.css:272-288` (una columna a ≤820 px). Se conserva la
corrección y se cambia la presentación:

- **Bottom sheet**, no diálogo centrado: entra desde abajo, radio 24 px arriba,
  `max-height: 88vh`, handle de arrastre de 36×4 px.
- Fondo `rgb(20 20 22 / 45%)`, cierre por toque fuera, `Escape` y arrastre hacia
  abajo.
- Orden: imagen (aspect 1/1, `min(52vw, 300px)`) · nombre · presentación ·
  precio · disponibilidad · nota · stepper + `Agregar al pedido` sticky al pie.
- Foco atrapado; al cerrar vuelve a la tarjeta de origen.
- `Agregar al pedido` es la **única** acción primaria del sheet.

### 2.11 Skeletons

Medido: el rail de Inicio está vacío hasta ~900 ms y al poblarse empuja el
documento **+451 px (+51 %)** (auditoría §3.5).

- La grilla renderiza **6 tarjetas skeleton** con la geometría exacta de la
  tarjeta real (252 px de alto) desde el primer paint.
- El rail de Inicio reserva su alto (78 px) con 3 skeletons.
- Animación: `opacity` entre .55 y 1, 1.4 s. Sin shimmer que barra la pantalla.
- Con `prefers-reduced-motion`, estático.
- El skeleton se reemplaza cuando hay datos, sin transición de alto.

---

## 3. Comportamiento por breakpoint

| Ancho | Cambios estructurales |
|---|---|
| **320** | Padding 12 px. Grilla 2 col, gap 10 px → tarjeta de 138 px. Imagen 120 px, tarjeta 224 px. Presentación a 1 línea. El carrito muestra `2 · $34.200` (formato corto). |
| **390** | Padding 16 px, gap 12 px → tarjeta 173 px. Imagen 148 px, tarjeta 252 px. Geometría de referencia. |
| **430** | Padding 16 px, gap 12 px → tarjeta 193 px. Imagen 164 px. Se agrega la línea de disponibilidad cuando aplica. |
| **600+** | **3 columnas.** La fila de contexto pasa a una sola línea con el orden como `<select>` real. |
| **900+** | Cambia la estructura: sidebar de categorías + grilla de 4 (ver `CATALOG_DESKTOP_SPEC.md`). La nav inferior se reemplaza por la nav superior. |

Lo que **cambia de estructura** (no de tamaño) entre móvil y tablet/desktop:

1. Categorías: tira horizontal con scroll → **sidebar vertical fija**.
2. Navegación: barra inferior fija → **nav en el topbar**.
3. Carrito: botón sticky inferior → **panel lateral persistente**.
4. Detalle: bottom sheet → **diálogo centrado de dos columnas**.
5. Orden: sheet de opciones → **`<select>` en línea**.

---

## 4. Presupuesto vertical — 390×844

Cifras **medidas sobre el prototipo**, no estimadas
(`screenshots/prototype-metrics.json`):

| Bloque | Hoy | Propuesto |
|---|---|---|
| Topbar | 70 px | 56 px |
| Kicker + H1 | 104 px | 0 px |
| Buscador | 82 px | 44 px |
| Dirección | — | 36 px |
| Categorías | 114 px | 40 px |
| Contador + orden | 105 px | 36 px |
| **Encabezado total** | **495 px** | **~232 px** |
| Alto de tarjeta | 339 px | ~290 px |
| **Primer precio (y)** | **798 px** | **476 px** |
| **Precios en 1er viewport** | **0 / 22** | **2 / 8 visibles** |
| Banda inferior fija | 17 % | 16 % |

Resultado por breakpoint, medido:

| | Primer precio hoy | Primer precio propuesto | Precios sobre el pliegue |
|---|---|---|---|
| 320×568 | 813 px | **401 px** | 0 → **2** |
| 390×844 | 798 px | **476 px** | 0 → **2** |
| 430×932 | 801 px | **476 px** | 2 → 2 |
| 768×1024 | 791 px | **448 px** | 2 → **6** |
| 1280×900 | 792 px | **356 px** | 4 → 4 |
| 1440×1000 | 792 px | **356 px** | 4 → **6** |

> 320×568 es el caso más ajustado: quedan ~428 px útiles sobre la banda fija. El
> prototipo entra con un encabezado reducido (dirección y categorías más bajas,
> packshot de 92 px). Es una excepción explícita de ese breakpoint, no la
> geometría general.

---

## 5. Accesibilidad

- Chips de categoría: `role="tab"` dentro de `role="tablist"`, con
  `aria-selected`. Área táctil real de 44 px.
- La tira de categorías es navegable con flechas y `scroll-snap`.
- Tarjeta: la imagen y el nombre son **un solo** botón (`data-product-detail`)
  con `aria-label="Ver Coca-Cola Original"`. Hoy ya es así.
- Favorito: `aria-pressed` + etiqueta que cambia entre Guardar y Quitar. Ya
  existe.
- Stepper: botones con `aria-label="Quitar una unidad"` / `"Agregar una unidad"`
  y la cantidad con `aria-live="polite"`.
- Sheet: `role="dialog"`, `aria-modal="true"`, foco atrapado, retorno de foco.
- Precio: `aria-label` con la moneda dicha (`17.100 pesos`).
- `Precio a confirmar` se anuncia como parte del nombre accesible, no como
  atributo suelto.
- Skeletons: `aria-hidden="true"` + un `role="status"` que dice `Cargando
  catálogo`.
- Un único `aria-current="page"` en el documento (corrige auditoría §3.2).
