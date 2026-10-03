# TABA — Validación de los prototipos

**No se ejecutó la suite del repositorio.** Esta validación corre exclusivamente sobre los cinco prototipos de esta propuesta, con el Playwright que el repositorio ya tiene instalado (`node_modules`, sólo lectura).

Herramientas: `diagnostics/capture.mjs` (captura + medición) y `diagnostics/validate.mjs` (estructura y accesibilidad).
Datos crudos: `prototype-results.json`, `validation-results.json`, `summary.json`.

---

## Resultado

| Comprobación | Resultado |
|---|---|
| Capturas generadas | **39 / 39** |
| Capturas con hallazgos | **0** |
| Errores de consola | **0** |
| `pageerror` | **0** |
| Desbordamiento horizontal (suma de todos los viewports) | **0 px** |
| Objetivos táctiles por debajo de 44px | **0** |
| `input`/`select`/`textarea` con fuente menor a 16px | **0** |
| Nodos de texto tapados por el stack inferior al final del scroll | **0** |
| Hojas de estilo que no parsearon | **0** |
| `h1` expuestos por pantalla | **1** en los cinco prototipos |
| Imágenes sin `alt` | **0** |
| Imágenes rotas | **0** |
| Botones de sólo icono sin nombre accesible | **0** |
| Campos sin etiqueta asociada | **0** |
| `tabindex` positivo | **0** |
| Diálogos sin nombre accesible | **0** |
| Emoji usado como icono de interfaz | **0** |
| `z-index` fuera de la escala declarada | **0** |
| `lang` y `<meta viewport>` | presentes en los 5 |

## Cobertura de capturas

**Negocio (11):** `business-mobile-home-390x844` · `-430x932` · `business-mobile-order-detail-390x844` · `business-mobile-offline-390x844` · `business-mobile-empty-390x844` · `business-mobile-sections-390x844` · `business-tablet-768x1024` · `business-desktop-1024x768` · `-1280x900` · `-1440x1000` · `-1920x1080`

**Catálogo (14):** `catalog-mobile-320x568` · `-390x844` · `-cart-390x844` · `-430x932` · `-home-390x844` · `-detail-390x844` · `-empty-390x844` · `-pending-390x844` · `-loading-390x844` · `catalog-tablet-768x1024` · `catalog-desktop-1024x768` · `-1280x900` · `-1440x1000` · `-1920x1080`

**Rider Android (14):** `rider-login` · `rider-home` · `rider-orders` · `rider-order-detail` · `rider-at-store` · `rider-pickup` · `rider-on-the-way` · `rider-arriving` · `rider-delivery-code` · `rider-code-error` · `rider-incident` · `rider-offline` · `rider-recovered` · `rider-shiftend` (todas en 390×844)

Más `BEFORE_AFTER_BOARD.png` (12 imágenes embebidas, 0 rotas, 0 errores).

Todas con `deviceScaleFactor: 2` y `reducedMotion: 'reduce'`. Las móviles con `isMobile` y `hasTouch`.

---

## Qué mide cada comprobación

### Solape del stack inferior

No se inspecciona a ojo: se hace `scrollTo(scrollHeight)`, se calcula el borde superior de las superficies fijas (`.t-bottomnav`, `.t-sticky-cta`, `.b-actionbar`) y se busca cualquier nodo de texto de `main` que lo cruce. Es la comprobación que corresponde al hallazgo **P0-01**.

### Objetivos táctiles

Recorre `button, a[href], input, select, [role="button"]` visibles y falla por debajo de 43,5px de alto o 23,5px de ancho, excluyendo la barra de control del prototipo.

### `z-index`

Recorre el árbol completo y compara el valor calculado contra la escala declarada en los tokens. Detecta cualquier literal que se cuele.

---

## Defectos que esta validación encontró **en la propia propuesta**

Esto es lo más relevante del informe: la herramienta encontró errores reales en el trabajo de diseño y obligó a corregirlos.

| # | Defecto detectado | Corrección |
|---|---|---|
| 1 | **10 objetivos táctiles por debajo de 44px** en la primera versión: control de dirección (36px), `input` dentro del campo (23px), control de orden (32px), botones del stepper (40×42), “Consultar” (36px), enlaces “Ver todo” (16px), botón de limpiar búsqueda (32px), “Guardar” (36px), “Vaciar” (36px) | Alturas subidas; el campo pasó a 46px para contener un `input` de 44; el pie de la tarjeta se apiló para que la acción ocupe el ancho completo |
| 2 | **La barra de carrito tapaba el último precio.** Causa: `--t-bottom-reserve` declarado en `:root` resolvía `var(--t-cta-block)` con el 0px de `:root`, ignorando el override de `body` | Se movió la declaración a `body`. **Es exactamente el mismo mecanismo que dejó inerte a `--taba-floating-cart-reserve` en el repositorio**, y se documentó como invariante del sistema |
| 3 | **Dos reglas `@media` sin efecto** por estar escritas antes de la definición base del componente, con la misma especificidad (`.k-side{display:none}` y `.d-tab{min-height:44px}`) | Movidas después de la base; convertido en regla del sistema y anotado en el mapa de riesgo del CSS |
| 4 | **Desbordamiento de 37px** en la barra superior del negocio a 768px | Por debajo de 1120px la barra suelta contexto secundario antes que la búsqueda |
| 5 | **El "estante" tintado del packshot no se veía** | Los WebP de TABA traen fondo blanco horneado y tapan cualquier fondo. Se adoptó media blanco con borde inferior, y se documentó que un fondo tintado exige reproducir los 22 assets con canal alfa |
| 6 | **Tres CTA rojas apiladas** en la cola del negocio, contra la propia regla de “el rojo no ocupa superficie grande” | La acción repetida de la cola pasó a tinta; el rojo quedó para la decisión única del detalle |
| 7 | **`<img src="">`** en el detalle de producto (HTML inválido y petición espuria al documento) | Marcador de posición transparente en `data:` |
| 8 | **Cero `h1` expuestos** en el panel del negocio móvil | “Operación” del app bar pasó a `h1`; el ID del pedido en el detalle pasó a `h2` |
| 9 | **Emoji como icono** en 7 lugares del prototipo del rider | Sustituidos por SVG de la familia lineal; añadida la comprobación automática |
| 10 | **Contraste**: `#6c7480` sobre `#f5f7f9` daba 4,40:1 (por debajo de AA) y el borde de campo 1,39:1 (por debajo del 3:1 de WCAG 1.4.11) | `--t-ink-400` a `#656d79` (4,87:1) y borde de campo dedicado `#878f9d` (3,26:1) |

También obligó a **corregir la propia auditoría**: la estimación inicial daba el verde `#18864b` por debajo de AA. Calculado da **4,55:1 sobre blanco cálido**, es decir **cumple**. El hallazgo real de contraste era otro: los bordes de campo.

---

## Contraste

Calculado con la fórmula WCAG 2.1 de luminancia relativa sobre los 19 pares de la paleta. Resultados completos en `design-system/TOKENS.json` → `contrastAudit`.

- Pares de texto que no alcanzan AA: **0**.
- Par de texto más ajustado: `ink-400` sobre `surface-2` = **4,87:1**.
- Borde informativo de campo: **3,26:1** (WCAG 1.4.11 exige 3:1).
- `line-100/200/300` figuran por debajo de 3:1 **a propósito**: son decorativos y están declarados como tales.

---

## Lo que esta validación NO cubre

Hay que decirlo con claridad:

1. **Dispositivos físicos.** Chromium devuelve `env(safe-area-inset-bottom) = 0`. Todo lo relativo a safe areas debe verificarse en un iPhone con barra de gestos y un Android con navegación por gestos. La emulación no lo prueba.
2. **Lectores de pantalla.** Se comprueba que existan nombres accesibles, roles y regiones live; no se comprueba cómo suena. VoiceOver y TalkBack requieren persona.
3. **Recorrido con teclado.** Se verifica ausencia de `tabindex` positivo, no el orden real.
4. **Zoom del navegador y del sistema.** No cubierto; queda en el plan manual.
5. **Rendimiento real** en gama media.
6. **El repositorio.** Los prototipos son artefactos aislados: no prueban que la aplicación real vaya a comportarse igual tras la implementación.

## Cómo reproducirlo

```
cd C:\1212\artifacts\taba-opus-design-review\2026-07-31
node diagnostics/capture.mjs            # 39 capturas + mediciones
node diagnostics/capture.mjs catalog    # sólo las que coincidan
node diagnostics/validate.mjs           # estructura y accesibilidad
```

Ambos scripts usan `C:/1212/la-taba-catalog-checkout-premium/node_modules/playwright` en **modo lectura** y escriben únicamente dentro de este directorio de artefactos.
