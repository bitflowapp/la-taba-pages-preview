# TABA v2 — Validación

Instrumental: `diagnostics/capture.mjs` (captura y medición) y `diagnostics/validate.mjs` (estructura y accesibilidad), sobre el Playwright del repositorio **en modo lectura**.
Datos crudos: `v2-results.json`, `v2-validation.json`, `v2-summary.json`.

**No se ejecutó la suite del repositorio.**

## Resultado

| Comprobación | Resultado |
|---|---|
| Capturas generadas | **24 / 24** |
| Capturas con hallazgos | **0** |
| Errores de consola y `pageerror` | **0** |
| Desbordamiento horizontal (suma) | **0 px** |
| Objetivos táctiles por debajo de 44px | **0** |
| Campos con fuente menor a 16px | **0** |
| Nodos tapados por el stack al final del scroll | **0** |
| Vistas validadas estructuralmente | **8 / 8** |
| `h1` expuestos por pantalla | **1** en todas |
| Ids duplicados · imágenes sin `alt` · imágenes rotas | **0 · 0 · 0** |
| Controles de sólo icono sin nombre accesible | **0** |
| Campos sin etiqueta asociada | **0** |
| `tabindex` positivo · diálogos sin nombre | **0 · 0** |
| Emoji o glifo usado como icono | **0** |
| `z-index` fuera de la escala | **0** |

## La comprobación que la v1 no hizo: teclado abierto

`.checkout-form .button-row` es, según el mapa de riesgo de la v1, el cambio de **mayor riesgo comercial** de todo el plan: si la CTA de confirmar queda parcialmente bajo el stack con el teclado abierto, el pedido no se cierra.

La v1 lo señaló y no lo verificó, porque no tenía checkout prototipado.

**Método.** Playwright no abre el teclado virtual del sistema. Se usa como proxy un viewport de altura reducida — **390×420**, aproximadamente lo que queda utilizable en un iPhone con el teclado desplegado — y se mide el solape al final del scroll.

| Caso | Nodos tapados | Desbordamiento |
|---|---|---|
| `checkout-keyboard-390x420` | **0** | 0 px |
| `checkout-cart-keyboard-390x420` | **0** | 0 px |

**Limitación declarada:** es un proxy geométrico. No reproduce `visualViewport`, ni el desplazamiento que hace iOS al enfocar un campo, ni `safe-area-inset-bottom`. **Sigue siendo obligatoria la prueba en dispositivo físico.**

## Interacción verificada, no sólo capturada

| Flujo | Verificación | Resultado |
|---|---|---|
| Hoja de tablet · abrir | Clic en una tarjeta a 768px → `data-sheet="open"`, `x` de 768 a 0 | ✔ |
| Hoja de tablet · cerrar con botón | Clic en "Cola de pedidos" → `closed`, `x` vuelve a 768 | ✔ |
| Hoja de tablet · cerrar con teclado | `Escape` → `closed` y **el foco vuelve a la tarjeta seleccionada** (`o-card`) | ✔ |
| Hoja de tablet · no invade escritorio | A 1440px la barra de la hoja es `display:none` y el detalle queda en su panel (`x=612`) | ✔ |
| Mapa del rider | Los tres pines quedan por encima de la tarjeta de ETA (fondos 149/199/242 vs ETA en 270) | ✔ |
| Carrito | Quitar el último producto lleva al estado vacío | ✔ |
| Checkout | Retiro oculta dirección y pone el envío en "Sin cargo" | ✔ |

---

## Defectos que esta validación encontró **en la propia v2**

| # | Defecto | Cómo se detectó | Corrección |
|---|---|---|---|
| 1 | **El orden de cascada volvió a fallar.** Las reglas `@media` de la hoja de tablet quedaron escritas **antes** de la definición base y, con la misma especificidad, perdieron por orden de fuente. La barra "volver" nunca se renderizó: en tablet se entraba al detalle y **se quedaba atrapado** | Captura visual — el medidor no lo detecta, porque no hay error ni solape | Base primero, `@media` después. Documentado en el propio CSS |
| 2 | **`data-sheet-close` fuera del selector del manejador.** El botón "volver" existía y no disparaba | Prueba de interacción con Playwright, no captura | Se agregó al `closest()` |
| 3 | **Backdrop inservible.** Quedaba íntegramente cubierto por la hoja de ancho completo: invisible e intocable | Al intentar cerrarlo con clic en la prueba de interacción | Eliminado; se agregó cierre con `Escape` y devolución de foco |
| 4 | **Ruta y pines del mapa por encima de la tarjeta de ETA** | Captura visual | `z-index: 3` en `.r-eta` |
| 5 | **Pin de destino tapado por la tarjeta de ETA** tras corregir el punto 4 | Medición de rects contra el borde de la tarjeta | Ruta redibujada en la mitad superior del mapa |
| 6 | **Stepper del carrito a 40px**, contra la propia regla de 44 | Medidor de objetivos táctiles | Se quitó el override de tamaño |
| 7 | **Glifo `✕` (U+2715) como icono de cierre** | Detector de emoji/glifos | Sustituido por SVG |

### El hallazgo que importa

El defecto **#1 es el mismo error de orden de cascada que la v1 documentó como riesgo R6** en `audit/CSS_RISK_MAP.md` — y volvió a ocurrir, escrito por quien lo había documentado horas antes, en el mismo directorio de trabajo.

Eso es evidencia dura de que **documentar la regla no alcanza**. La conclusión para la implementación es concreta:

> El orden "base antes que `@media`" tiene que ser una **regla de lint** que rompa el build, no una convención escrita. Un `@media` de la misma especificidad colocado antes de su definición base no produce error, no produce solape y no produce advertencia: produce una interfaz donde un control simplemente no aparece.

Y el defecto **#2** refuerza lo mismo desde el otro lado: **capturar no es validar**. Las capturas de los puntos 2 y 3 salían perfectas; los defectos sólo aparecieron al *ejercitar* la interacción. La suite de regresión de la etapa 8 del plan de implementación debe incluir pruebas de interacción, no sólo comparación de imágenes.

---

## Lo que esta validación no cubre

1. **Dispositivos físicos** — safe areas y teclado real. Chromium devuelve `env(safe-area-inset-bottom) = 0`.
2. **Lectores de pantalla** — se comprueba que existan nombres accesibles y roles; no cómo suenan. VoiceOver y TalkBack requieren persona.
3. **Recorrido completo con teclado** — se verifica ausencia de `tabindex` positivo y el cierre con `Escape` de la hoja, no el orden de foco de punta a punta.
4. **Zoom** del navegador y del sistema.
5. **Rendimiento** en gama media.
6. **El repositorio** — los prototipos son artefactos aislados.

## Reproducción

```
cd C:\1212\artifacts\taba-opus-design-review\2026-07-31-v2
node diagnostics/capture.mjs             # 24 capturas + mediciones
node diagnostics/capture.mjs checkout    # sólo las que coincidan
node diagnostics/validate.mjs            # estructura y accesibilidad
```
