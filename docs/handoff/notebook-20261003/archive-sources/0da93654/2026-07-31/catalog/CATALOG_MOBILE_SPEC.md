# TABA — Catálogo cliente móvil

Prototipo: `prototypes/prototype-catalog-mobile.html`
Capturas: `catalog-mobile-320x568`, `-390x844`, `-cart-390x844`, `-430x932`, `-home-390x844`, `-detail-390x844`, `-empty-390x844`, `-pending-390x844`, `-loading-390x844`.

## Objetivo

Que deje de parecer una vista previa técnica y se sienta una tienda de bebidas lista para vender. Criterio medible: **al menos dos precios completos sobre el pliegue en 390×844** (hoy: cero).

---

## Presupuesto vertical — antes y después (390×844)

| Bloque | Actual | Propuesto |
|---|---:|---:|
| App bar | 71 | **56** |
| Eyebrow “CATÁLOGO” | ~28 | 0 |
| H1 | ~52 | **28** (22px) |
| Buscador | ~65 | **46** |
| Tarjeta de dirección | ~92 (sólo home) | 0 — integrada al app bar |
| Categorías | ~105 | **44** |
| Contador | ~30 | **20** |
| Barra de orden | ~68 | 0 — el control va en la fila del título |
| **Antes del primer producto** | **~435** | **~208** |
| Alto de tarjeta | 330 | **~292** |

Se recuperan ~227px: el primer precio pasa de estar fuera de pantalla a aparecer a ~y560 de 844.

---

## App bar — 56px

`[ TABA ] [ 📍 ENVIAR A / Av. Argentina 1450, Neuquén  › ] [ 🛒 ]`

- **Marca:** wordmark de 19px con la regla roja.
- **Dirección:** control de 44px, flexible, con etiqueta pequeña “ENVIAR A”, valor truncado con elipsis y chevron. Absorbe la tarjeta de 92px de hoy. Sin dirección: el valor pasa a `danger-700` y dice “Elegí tu dirección”, abriendo Perfil.
- **Carrito:** botón de icono de 44px con badge que **sólo existe si hay contenido** (hoy muestra “0” y ocupa el 55% del ancho).
- **Perfil y seguimiento** viven en la navegación inferior; no duplicar accesos en el app bar.

Fondo `paper` translúcido con desenfoque y hairline inferior; `position: sticky`, `z-index: 200`.

## Hero — sólo en Inicio

Un único título de 22px (“¿Qué vas a pedir hoy?”) con una línea de apoyo de 13,5px. **En Catálogo no hay hero**: el título es el nombre del filtro. **Se elimina “PREVIEW INTERNA” y cualquier etiqueta técnica.**

## Buscador — 46px

Campo de 46 con `input` de 44 a **16px** (sin zoom en iOS), borde `line-strong` (3,26:1), icono a la izquierda, botón de limpiar de 44×44 que aparece con contenido, y a la derecha un botón de filtros de 44.

Búsqueda **inmediata** al escribir (el catálogo son 22 productos: no hace falta debounce de red). El `type="search"` permite limpiar con `Esc`.

## Categorías — chips de 44px

Scroll horizontal con `scroll-snap` y **máscara de degradado a la derecha** que señala continuidad. Activo: fondo `ink-900` + `aria-pressed`. Etiqueta de 13px (hoy 10px).

Ahorra ~60px y muestra 5 categorías en lugar de 4 cortadas. **La home y el catálogo usan el mismo componente**: no hay dos sistemas de categorías.

## Título, contador y orden

```
Todos                        [⇅ Recomendados]   ← fila del título, 22px + control de 44
22 productos                                     ← 20px, caption
```

- El título es el **nombre del filtro activo**: la categoría si no hay consulta, **la consulta entre comillas** si la hay.
- El contador incluye el contexto: `0 productos en Gaseosas`.
- El control de orden se oculta con 0 resultados.

## Grilla

- **≥360px:** 2 columnas, gap 12, padding lateral 16 → tarjeta de 171px en 390.
- **≤359px:** 1 columna con tarjeta **horizontal** (media de 108px a la izquierda, contenido a la derecha). Es la única forma de que a 320px el precio y la acción no se estrangulen. Verificado en `catalog-mobile-320x568.png`.
- Sin altura fija: las filas de la grilla se igualan solas.

## Tarjeta

```
┌──────────────────┐
│ media 1:1 blanco │  ← aspect-ratio, favorito 44px arriba-derecha
│   [ packshot ]   │
├──────────────────┤
│ COCA-COLA        │  eyebrow 11
│ Coca-Cola Original│ title-s 16, 2 líneas máx
│ Botella PET · … │  caption 12
│ $ 17.100         │  price-l 18 tabular
│ [   Agregar   ]  │  44px, ancho completo, EN FLUJO
└──────────────────┘
```

**Packshot.** Caja cuadrada por `aspect-ratio: 1/1`, `object-fit: contain`, `padding: 4px`. Pasa de ~15% del área de la tarjeta a **~35%**, y el producto crece cerca de un 90% en cada dimensión.

**Fondo blanco, obligatorio.** Los packshots de TABA son WebP con **fondo blanco horneado**. Un “estante” tintado queda tapado por el propio bitmap. El encuadre lo da el borde inferior de 1px. Un fondo tintado exigiría reproducir los 22 assets con canal alfa: tarea de assets, no de CSS. La clase `p-media--shelf` queda lista para ese día.

**Acción en flujo, nunca absoluta.** Es la corrección estructural de P0-02: el control ya no puede solaparse con el título porque no está posicionado sobre él. El pie va apilado (precio arriba, acción abajo) porque a 171px de ancho un precio de 5 dígitos y un control de 44px no conviven en un renglón.

**Favorito.** 44×44 arriba a la derecha del media, `aria-pressed`, relleno cuando está activo. Posición estable en todos los estados; no compite con la compra porque está en otra zona de la tarjeta.

## Stepper

Sustituye a la CTA **en su mismo lugar**: `44 · 1fr · 44`, alto 46, wash rojo, borde `red-300`. A cantidad 1, el “−” se convierte en papelera. Feedback inmediato: el número cambia al instante. `aria-label` por control nombrando el producto.

## Precio y disponibilidad

Jerarquía: **producto → presentación → precio → acción**.

**Producto sin precio** (caso real: `red-bull-original-lata-250ml-pack-4`):
- pill `● Sin precio` sobre el media;
- línea de precio “Precio a confirmar” en `warning-700`, no en la tipografía de precio;
- acción `--secondary` “Consultar” en lugar de “Agregar”;
- media desaturado al 55%;
- **no se puede agregar al carrito.**

Ver `catalog-mobile-pending-390x844.png`.

**Prohibido inventar** descuentos, popularidad, stock, urgencia o reseñas.

**Nota de datos de producto:** hoy dos productos distintos se muestran idénticos (“Speed Unlimited · Lata · 473 ml · Unidad · $ 2.925” para las variantes original y zero). La variante ya existe en el identificador; hay que exponerla. Es mostrar dato existente, no inventarlo.

## Detalle — hoja inferior

`t-sheet` con tirador, imagen 16:11, marca, nombre, presentación, pill de disponibilidad, descripción, precio grande y **acciones pegadas al pie de la hoja**: stepper + “Agregar al pedido” + guardar en favoritos.

`role="dialog"`, `aria-modal`, `aria-labelledby`, cierre con `Esc` y con toque en el fondo, foco atrapado y devuelto. Con producto sin precio, la acción primaria se sustituye por “Consultar”.

## Carrito sticky — resuelve P0-01

```css
.t-sticky-cta { bottom: calc(var(--t-nav-block) + var(--t-stack-gap)); height: 56px; left: 12px; right: 12px; }
main           { padding-bottom: var(--t-bottom-reserve); }
```

| Requisito | Cómo se cumple |
|---|---|
| Separada de la navegación inferior | `--t-stack-gap` de 8px entre ambas, e inset lateral de 12px |
| Respeta el safe area | `--t-nav-block` incluye `env(safe-area-inset-bottom)` |
| No tapa precio ni estado vacío | `main` reserva `--t-bottom-reserve`, **declarado en `body`** para que resuelva con el valor real de `--t-cta-block` |
| Cantidad y total | “4 productos” + “$ 40.800” con `tabular-nums` |
| CTA | “Ver pedido”, 44px, rojo |
| Altura controlada | 56px fija por token |
| Desaparece con carrito vacío | `body:not([data-cart="filled"]) .t-sticky-cta { display: none }` y entonces `--t-cta-block: 0` |

**Padding inferior que debe reservar el contenido:**
- carrito vacío → `56 + safe + 8` = **64px + safe**
- carrito con productos → `56 + safe + 56 + 8 + 8` = **128px + safe**

Verificado por medición al final del scroll en 320/390/430/768: cero nodos de texto cruzados.

## Navegación inferior

Barra a sangre de 56px + safe area, hairline superior, 4 destinos: **Inicio · Catálogo · Seguir · Perfil**. Activo: color rojo + barra de 2,5px + `aria-current="page"`. No compite con el carrito porque están separadas y la barra de carrito es oscura mientras la nav es de papel.

## Estado vacío — resuelve P1-06

Con búsqueda activa y 0 resultados:

1. El título pasa a ser **la consulta entre comillas**.
2. **Ninguna categoría queda marcada como activa.**
3. Aparece un **chip de búsqueda removible** antes de las categorías, con la consulta y una “✕”.
4. El contador dice `0 productos` (o `0 productos en Gaseosas`).
5. **El control de orden se oculta.**
6. El estado vacío nombra la consulta: “No encontramos «zzzzqqq»”.
7. Acción primaria **“Limpiar búsqueda”** (deshace la causa), más “Buscar en todo” si el filtro estaba acotado.
8. Tres chips de categoría como salida alternativa.
9. La barra de carrito sigue mostrando sus 4 productos — **es correcto**, y ya no se lee como contradicción porque el vacío está explicado.

Ver `catalog-mobile-empty-390x844.png`.

Otras variantes: **favoritos vacíos** (explica cómo guardar) y **categoría vacía** (ofrece el catálogo completo).

## Carga

- Esqueletos con **la caja exacta** del contenido final: media 1:1, tres líneas, bloque de acción → `layout shift = 0`.
- Las imágenes llevan `width`/`height` y `loading="lazy"`.
- Error de imagen: se mantiene la caja con el fondo neutro; **no** se colapsa la tarjeta.
- Catálogo no disponible: estado vacío propio con reintento, sin dejar la grilla a medio pintar.

Ver `catalog-mobile-loading-390x844.png`.

## Inicio vs Catálogo

| | Inicio | Catálogo |
|---|---|---|
| Función | Descubrir | Buscar y filtrar |
| Título | Hero de 22px | Nombre del filtro |
| Buscador | Sí (lleva a Catálogo al enviar) | Sí, persistente |
| Categorías | Grilla de 4 accesos | Chips con scroll |
| Contenido | Rail “Los más pedidos” + grilla de una categoría | Grilla completa filtrada |
| Tarjeta | **La misma** `p-card` | **La misma** `p-card` |

Se elimina la duplicación de estilos entre ambas: cambia la composición, no los componentes. También desaparece el rail roto de “Los más vendidos” (P1-05), porque hay un solo componente de tarjeta.

## Verificación

| Aserción | Umbral |
|---|---|
| Precios sobre el pliegue en 390×844 | ≥ 2 |
| Desbordamiento horizontal en 320 | 0 px |
| Objetivos táctiles < 44px | 0 |
| Inputs con fuente < 16px | 0 |
| Texto tapado por el stack al final del scroll | 0 nodos |
| Errores de consola / `pageerror` | 0 |
| Título con búsqueda activa | contiene la consulta |
| Categoría activa con búsqueda activa | ninguna |
| Control “Limpiar búsqueda” con 0 resultados | existe y es accesible |
| Contador del carrito con búsqueda activa | independiente del filtro |
