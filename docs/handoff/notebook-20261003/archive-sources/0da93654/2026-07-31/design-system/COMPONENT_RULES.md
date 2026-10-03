# TABA — Reglas de componentes

Implementación de referencia: `prototypes/proto-shared.css`. Prefijo `t-` para primitivas compartidas, `p-` producto, `o-` pedido, `b-` negocio móvil, `d-` negocio escritorio, `k-` catálogo escritorio, `r-` rider.

---

## Botón `t-btn`

| Variante | Uso | Aspecto |
|---|---|---|
| `--primary` | **Una por pantalla.** La decisión que avanza el flujo | Relleno `red-600`, texto blanco |
| `--dark` | Acción operativa repetida en listas | Relleno `ink-900`, texto blanco |
| `--secondary` | Alternativa, navegación lateral | Blanco, borde `line-300`, texto `ink-700` |
| `--ghost` | Terciaria, dentro de barras | Sin fondo hasta hover |
| `--danger` | Destructiva | Blanco, borde `red-300`, texto `danger-600`, **siempre con confirmación** |

Tamaños: `--lg` 48 (56 en rider) · base 44 · `--sm` 36 **sólo con `pointer:fine`**.

Reglas:
1. **Nunca dos primarias visibles a la vez.** Si una lista repite la misma acción por fila, esa acción es `--dark`, no `--primary`.
2. Las destructivas no comparten fila con la primaria: van en la fila secundaria, separadas.
3. El rótulo nombra el resultado (“Aceptar y comenzar preparación”), no el mecanismo (“Enviar”).
4. Ningún botón cambia de tamaño entre estados: el stepper ocupa exactamente el lugar de la CTA que reemplaza.

## Chip `t-chip`

44px de alto, píldora, borde `line-300`. Activo = fondo `ink-900` + texto blanco. Variante `--query` (wash rojo) para la **búsqueda activa**, siempre con “✕” y `aria-label` que nombra la consulta.

Reglas:
1. Los chips filtran. **No navegan.**
2. Con búsqueda activa, **ninguna categoría queda marcada como activa**: el chip de consulta es el filtro dominante.
3. Los contenedores con scroll horizontal llevan máscara de degradado a la derecha para señalar continuidad.

## Campo `t-field`

Alto 46 con un `input` de 44 y `font-size: 16px`. Borde `line-strong` (**3,26:1**, WCAG 1.4.11). Foco: borde `focus` + halo de 3px.

Reglas:
1. El `<label>` envuelve el campo, o hay `aria-label`. Nunca sólo `placeholder`.
2. El botón de limpiar es de 44×44 y sólo existe con contenido.
3. Ningún campo baja de 16px, ni siquiera en escritorio: es un solo componente para todas las superficies.

## Pill de estado `t-pill`

Alto mínimo 22, `punto + texto`. Variantes `ok / warn / danger / info / neutral`.
**Regla dura: el estado nunca se comunica sólo con color.** El punto es redundancia de forma; el texto es el portador real.

## Fila agrupada `t-row`

`icono(34) · título+subtítulo · valor · chevron(16)`, 56px de alto, separador interno de 1px, agrupada en `t-group` con rótulo `t-group-label` encima.

Es la adaptación del principio estructural de Ajustes de iPhone: agrupación temática, jerarquía constante, valor a la derecha, densidad controlada. **No se copia** ningún icono, color, material ni componente de Apple: los iconos son de la familia lineal TABA y los colores son los tokens TABA.

Uso: secciones del negocio, configuración del rider, cliente/dirección/pago en el detalle de pedido.

## Tarjeta de producto `p-card`

```
┌──────────────────┐
│  p-media 1:1     │  ← blanco, aspect-ratio, favorito arriba a la derecha
│      [packshot]  │
├──────────────────┤
│ MARCA            │  eyebrow 11
│ Nombre (2 líneas)│  title-s 16
│ Presentación     │  caption 12
│ $ 17.100         │  price-l 18 tabular
│ [ Agregar   44 ] │  ← acción a ancho completo, EN FLUJO
└──────────────────┘
```

Reglas:
1. **`aspect-ratio: 1/1` en el media. Nunca altura fija.** La tarjeta se adapta a la columna sin números mágicos.
2. **El media es blanco.** Los packshots de TABA traen fondo blanco horneado: cualquier tinte queda tapado por el bitmap. Un “estante” tintado requiere reproducir los assets con canal alfa — es trabajo de assets, no de CSS. La clase `p-media--shelf` queda preparada para ese día.
3. **Ninguna acción se posiciona en absoluto.** El único absoluto permitido es el favorito, anclado al media, que tiene altura conocida por `aspect-ratio`. Así el solape título/control es imposible por construcción.
4. **Pie apilado en móvil** (precio arriba, acción abajo): a ~171px de ancho el precio y un control de 44px no conviven en un renglón. `p-foot--inline` sólo en tarjetas anchas de escritorio.
5. El stepper sustituye a la CTA **en el mismo lugar**, con controles de 44px. A cantidad 1, el “−” pasa a papelera.
6. Jerarquía fija: producto → presentación → precio → acción.
7. **Producto sin precio:** pill “Sin precio” sobre el media, precio en `warning-700` como “Precio a confirmar”, acción `--secondary` “Consultar”. **No se puede agregar al carrito.**
8. Prohibido inventar descuentos, popularidad, stock, urgencia o reseñas.

## Stepper `p-step`

Tres columnas 44 · 1fr · 44, alto 46, wash rojo, borde `red-300`. Cada botón lleva `aria-label` con el nombre del producto (“Agregar una unidad de Coca-Cola Original”). Feedback inmediato: el número cambia antes de cualquier confirmación de red.

## Tarjeta de pedido `o-card`

Borde izquierdo de 3px que codifica el estado (`red` nuevo · `warning` preparando · `success` listo · `info` en camino) **más** la pill textual. Contenido: `#ID · pill · [demorado] · hora·min` / cliente · modalidad / dirección truncada a una línea / artículos · total / acción.

Regla: el borde de color es refuerzo, **nunca** el único portador del estado.

## Barra sticky de acción `t-sticky-cta` / `b-actionbar`

Altura fija tomada de los tokens, `bottom` derivado, `box-shadow: e2`.
Reglas:
1. **No existe si no hay nada que resumir** (`display:none` con carrito vacío) — y entonces la reserva inferior es 0.
2. Nunca comparte franja con la navegación inferior: van separadas por `--t-stack-gap`.
3. En una pantalla apilada de detalle, la navegación inferior se retira y la barra de acción ocupa su lugar.

## Navegación inferior `t-bottomnav`

Barra a sangre (no píldora flotante), `height: var(--t-nav-block)`, `padding-bottom: var(--t-safe-b)`, hairline superior. Activo: color `red-600` + barra de 2,5px arriba + `aria-current="page"`.
**Máximo 4 destinos. Nunca scroll horizontal en navegación.**

## Aviso efímero `t-toast`

`bottom: calc(var(--t-bottom-reserve) + 8px)`, `role="status"`, 2,6s. **Nunca sobre contenido**: por encima de todo el stack inferior. No lleva acciones destructivas ni es el único canal de una confirmación importante.

## Hoja inferior `t-sheet`

Radio superior 18, `max-height: 88vh`, `padding-bottom: var(--t-safe-b)`, tirador visual, `role="dialog"` + `aria-modal` + `aria-labelledby`, fondo `t-backdrop` cliqueable, cierre con `Esc`, foco atrapado y devuelto al disparador.

## Estado vacío `t-empty`

Marca circular + título + explicación (≤34ch) + acciones. Reglas:
1. **Explica la causa concreta**, nombrando el filtro o la consulta.
2. La acción primaria **deshace la causa** (“Limpiar búsqueda”), no lleva a un lugar genérico.
3. Ofrece salidas alternativas (chips de categoría).
4. Vive donde el usuario está mirando: con 0 resultados, los controles inútiles (orden) se ocultan.

## Esqueleto `t-skel`

Reserva **exactamente** la caja del contenido final: media 1:1, tres líneas y el bloque de acción. Objetivo: `layout shift = 0`. Se desactiva con `prefers-reduced-motion`.

## Banda operativa `b-band`

Cuatro segmentos de 52px que son **resumen y filtro a la vez**: número grande tabular + etiqueta + subrayado rojo en el activo + punto de alerta cuando hay novedades. Reemplaza 4 tarjetas de métrica (~260px) y una fila de tabs (~60px) por 52px.
Semántica: `role="group"` + `aria-pressed` en cada segmento.

## Reglas transversales

1. **Un componente, un markup.** Las densidades son modificadores, no componentes nuevos.
2. **Ninguna medida de chrome se escribe dos veces.**
3. **Ninguna acción se ancla con `position: absolute`** a una medida derivada de otra regla.
4. Todo control interactivo mide ≥44px en su dimensión menor sobre superficie táctil.
5. Todo icono lleva `aria-hidden="true"` si acompaña texto, o el control lleva `aria-label` si es sólo icono.
6. Los `@media` se escriben después de la definición base del componente.
