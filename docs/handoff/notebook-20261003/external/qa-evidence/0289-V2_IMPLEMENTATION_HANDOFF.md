# TABA v2 — Delta de implementación

**Complementa, no reemplaza,** `2026-07-31/implementation/`. El plan de 13 commits, el mapa de archivos y el grafo de dependencias de la v1 siguen vigentes. Acá va **sólo lo que la v2 agrega o corrige**.

## Regla previa, sin cambios

El árbol sigue con 33 archivos modificados y 6 sin seguimiento. **Coordinar antes de tocar** `js/ui.js`, `js/business.js`, `index.html`, `js/realtime.js`, `js/core/realtime-sync.js`, `styles/checkout.css` y `js/core/profile-checkout.js`. Empezar por CSS.

---

## Cambio de plan: dos etapas nuevas y un reordenamiento

El plan de la v1 tenía 13 etapas. La v2 introduce dos y mueve una:

| Etapa | v1 | v2 |
|---|---|---|
| 6 · Carrito sticky y navegación | ✔ | sin cambios |
| **6b · Carrito y checkout** | — | **NUEVA** |
| 7 · Responsive y accesibilidad | ✔ | sin cambios |
| **8b · Pruebas de interacción** | — | **NUEVA** (se separa de la regresión visual) |

**Y un cambio de prioridad:** la etapa 1 (tokens) ahora es bloqueante también de 6b, porque `.checkout-form .button-row` depende de la reserva derivada. En la v1 esto figuraba como el cambio 1.10 aislado; en la v2 pasa a ser el requisito de una etapa completa.

---

## Etapa 6b · Carrito y checkout

| # | Archivo | Componente | Cambio exacto | Selector / símbolo | Riesgo | Prueba |
|---|---|---|---|---|---|---|
| 6b.1 | `styles/checkout.css` | Barra de acción | Reemplazar el `bottom` sticky por la reserva derivada y **medir la altura real** de la barra para alimentar `--cta-block` | `.checkout-form .button-row` | **Alto — toca la compra** | Solape con viewport de 390×420 **y** en iPhone físico con teclado |
| 6b.2 | `styles/checkout.css` | Pantalla apilada | Retirar la bottom nav en carrito y checkout; `--nav-block: 0` | `body[data-active-view="cart"]`, `="checkout"` | Medio | Que la nav no aparezca y la reserva sea la de la barra |
| 6b.3 | `js/ui.js` o vista de carrito | Línea del carrito | Stepper de 44px, papelera a cantidad 1, precio unitario + importe de línea | plantilla de línea | Medio — **archivo con cambios sin commitear** | Objetivos táctiles; quitar el último producto → estado vacío |
| 6b.4 | `js/core/profile-checkout.js` | Dirección | Presentar las direcciones guardadas como `role="radio"` con `aria-checked`; "Usar otra dirección" abre Perfil | selección de dirección | Medio — **archivo nuevo de otro agente** | Sin direcciones → estado propio con llamado a agregar |
| 6b.5 | `js/core/profile-checkout.js` | Contacto | Precargar nombre y teléfono del Perfil, editables, con error **en línea** por campo | campos de contacto | Bajo | `aria-invalid` + `aria-describedby`; foco al primer error |
| 6b.6 | Vista de checkout | Pago | Efectivo/transferencia; con efectivo, cálculo de vuelto en vivo y aviso si no alcanza | sección de pago | Bajo | El vuelto coincide con `abona − total`; vacío no bloquea |
| 6b.7 | Vista de checkout | Modalidad | Retiro oculta la sección de dirección y pone el envío en "Sin cargo" | sección de entrega | Medio | El total recalcula; el resumen dice "Retiro en el local" |
| 6b.8 | Vista de checkout | Barra de acción | Total siempre visible + **una sola** primaria | barra sticky | Bajo | Una acción primaria visible |
| 6b.9 | Confirmación | Código de entrega | Mostrarlo destacado con `tabular-nums` y separación amplia | pantalla de éxito | Bajo | Coincide con el que ve el negocio |

**Criterio de aceptación:** compra completa en 320×568 y 390×844, con y sin dirección guardada, en envío y en retiro, **con el teclado abierto**, sin que ningún elemento quede bajo la barra de acción.

## Etapa 3 (negocio escritorio) · adición

| # | Archivo | Cambio | Riesgo | Prueba |
|---|---|---|---|---|
| 3.7 | `styles/business.css` | A ≤1023, el detalle **no se oculta**: `position: fixed` + `translateX(100%)`, y `body[data-sheet="open"]` lo trae. Barra "← Cola de pedidos" | Medio | Abrir a 768px y ver el detalle completo |
| 3.8 | `js/business.js` | Elegir un pedido abre la hoja **sólo** bajo `matchMedia("(max-width: 1023px)")` | Medio | A ≥1024 nada cambia |
| 3.9 | `js/business.js` | Cerrar con botón y con `Escape`, devolviendo el foco a la tarjeta seleccionada | Bajo | Prueba de teclado |
| 3.10 | `styles/business.css` | Acción primaria al pie de la hoja; **sin backdrop** | Bajo | Una primaria visible |

**Orden de cascada obligatorio:** la definición base de `.d-sheetbar` y `.d-sheet-actions` va **antes** del `@media`. Al revés no falla: simplemente no se ve el control (ver `V2_VALIDATION.md`, defecto 1).

## Etapa 4 (catálogo) · adición

| # | Archivo | Cambio | Riesgo | Prueba |
|---|---|---|---|---|
| 4.10 | `styles/catalog.css` | `.product-body` a `flex-direction: column` y `.product-foot` con `margin-top: auto` | Bajo | Los precios de una fila comparten `rect.top` |
| 4.11 | Datos de catálogo | Exponer la variante de `speed-original` / `speed-zero` | Bajo | `(nombre, presentación)` único |
| 4.12 | Pipeline de catálogo | Validación que **falla** ante `(nombre, presentación)` duplicado | Bajo | Hoy falla con Speed: es el caso de prueba |

## Etapa 8b · Pruebas de interacción

Se separa de la regresión visual porque **la v2 demostró que capturar no es validar**: dos defectos (botón que no dispara, backdrop intocable) producían capturas perfectas.

| Prueba | Qué verifica |
|---|---|
| Hoja de tablet | Abre al elegir, cierra con botón y con `Escape`, devuelve el foco |
| Carrito | Quitar el último producto lleva al estado vacío |
| Checkout · modalidad | Retiro oculta dirección y pone envío en cero |
| Checkout · vuelto | Coincide con `abona − total`; aviso si no alcanza |
| Checkout · validación | Foco al primer campo con error; `aria-invalid` |
| Catálogo · búsqueda | Limpiar restablece los 22 productos |
| Rider | Cada transición lleva a la pantalla correcta |

### Regla de lint bloqueante

Añadir a la etapa 8 una regla que **rompa el build** si una declaración dentro de `@media` tiene la misma especificidad que una regla base escrita después. Es el defecto que la v1 documentó como riesgo R6 y que la v2 volvió a cometer. Documentarlo no alcanza.

Herramientas: `stylelint` con `no-duplicate-selectors` y una regla propia de orden, o un chequeo que recorra el AST comparando posición y especificidad.

---

## Ajuste del plan de commits

Sobre los 13 de la v1:

| # | Commit | Estado |
|---|---|---|
| 1–5 | sin cambios | — |
| **5b** | `feat(checkout): carrito y confirmación con dirección del Perfil` | **NUEVO**, después del 5 y antes del 6 |
| 6 | `fix(mobile): la barra de carrito y la navegación dejan de tapar contenido` | **Ahora incluye `.checkout-form .button-row` con altura medida** |
| 7–11 | sin cambios | — |
| **10b** | `feat(business): hoja de detalle en tablet` | **NUEVO**, junto al commit 5 de escritorio |
| 12 | `test(visual): regresión visual y aserciones de accesibilidad` | **Se divide**: 12a visual, **12b interacción** |
| 13 | sin cambios | — |

## Distribución

**Claude Opus** — barra de acción del checkout con altura medida (6b.1, 6b.2); hoja de tablet y su orden de cascada (3.7–3.10); anclaje del pie de tarjeta (4.10).

**Codex** — resto de la etapa 6b una vez definidos los contratos; regla de lint de orden de cascada; suite de interacción 8b; validación de unicidad del catálogo (4.12).

**Revisión humana** — nombre comercial de las variantes Speed; **prueba en iPhone y Android físicos con teclado abierto**; si se pide el vuelto en el checkout; tiempo de espera del protocolo de cliente ausente.

---

## Qué queda fuera, otra vez

- Perfil y Seguimiento del cliente siguen **sin prototipar**. La nav inferior los ofrece; la v2 cerró carrito y checkout porque son el camino del dinero, no ellos.
- No se creó el proyecto Flutter.
- No se tocó el repositorio.
