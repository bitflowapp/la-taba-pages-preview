# TABA — Plan de commits

Trece commits futuros, en orden. **Ninguno fue creado.** Cada uno debe ser revertible por separado: si el commit N rompe algo, `git revert` de ese commit deja el árbol funcionando.

Rama sugerida: `feature/taba-design-system` a partir del estado ya commiteado de `feature/catalog-checkout-premium`, **después** de que el trabajo en curso del otro agente esté commiteado.

---

### 1 · `feat(design-system): tokens únicos de color, tipografía y stack inferior`

`styles/tokens.css`, `styles/responsive.css`, `styles/showcase.css`, `styles/profile.css`, `js/ui.js` (sólo `data-cart`)

- Quita `Inter` del stack (no se cargaba).
- Reemplaza los 4 valores contradictorios de altura de nav por `--nav-h` única.
- **Declara la reserva derivada en `body`, no en `:root`** — es la corrección del token muerto.
- Escala de z-index de 9 niveles.
- `--taba-success` a `#0f7a3d` y `--taba-line-strong` para bordes de campo.

Verificación: test de solape en 7 viewports × 2 estados de carrito; contraste de la matriz de tokens.
**Revertible:** sí, aislado.

### 2 · `fix(mobile): la barra de carrito y la navegación dejan de tapar contenido`

`styles/responsive.css`

Nav a sangre de 56px, barra de carrito con `bottom` derivado y altura fija, toast por encima del stack, `button-row` del checkout recalculado.

Verificación: E2E de checkout en 320×568 con teclado abierto.
**Es el commit de mayor riesgo comercial:** toca el paso de confirmación de compra.

### 3 · `feat(business): panel móvil con banda operativa y cola prioritaria`

`js/business.js`, `styles/business.css`, `index.html`

Banda de 52px que resume y filtra, cola inmediata, app bar de 56px, tarjeta de pedido compacta con acción en tinta.

Verificación: ≥2 pedidos sobre el pliegue en 390×844.

### 4 · `feat(business): navegación móvil por bottom nav y secciones agrupadas`

`index.html`, `js/business.js`, `styles/business.css`

Elimina las tabs horizontales cortadas; 4 destinos; sección “Local” con filas agrupadas; detalle como pantalla apilada con acción primaria sticky.

### 5 · `feat(business): master-detail en escritorio`

`styles/business.css`, `js/business.js`

Tres a cuatro paneles con scroll independiente, sidebar con contadores, métricas en banda de 46px, riel de acciones ≥1440.

### 6 · `refactor(catalog): anatomía de tarjeta sin números mágicos`

`styles/catalog.css`, `js/ui.js`

Elimina `grid-template-rows: 190px…`, `min-height: 330px` y **`.product-media-control { bottom: 136px }`**. Media cuadrada por `aspect-ratio`, acción en flujo, stepper unificado.

Verificación: 0 intersecciones título/control con nombres largos; área del packshot ≥30 %.
**Corrige P0-02.**

### 7 · `feat(catalog): meta y estado vacío que explican el filtro activo`

`js/ui.js`, `index.html`

Título con la consulta, contador con contexto, chip de búsqueda removible, ninguna categoría activa con búsqueda, “Limpiar búsqueda” como primaria, barra de orden oculta con 0 resultados, **eliminación de “PREVIEW INTERNA”**.

**Corrige P1-06 y P1-04.**

### 8 · `fix(home): un único componente de tarjeta en Los más vendidos`

`js/ui.js`, `styles/storefront.css`

Elimina el rail con markup propio y colapsado. **Corrige P1-05 / F-01.**

### 9 · `feat(catalog): header compacto, dirección integrada y categorías en chips`

`index.html`, `styles/responsive.css`, `styles/storefront.css`

Header a 56px, dirección como control de 44px, categorías como chips, carrito del header con badge condicional.

Verificación: ≥2 precios sobre el pliegue en 390×844. **Corrige P0-03.**

### 10 · `feat(catalog): detalle en hoja inferior y modal de escritorio`

`js/ui.js`, `styles/catalog.css`

`<dialog>` en escritorio, hoja en móvil, foco atrapado y devuelto, producto sin precio no comprable.

### 11 · `feat(catalog): grilla fluida, filtros laterales y panel de pedido en escritorio`

`styles/catalog.css`, `index.html`

`auto-fill minmax(214px,1fr)`, sidebar de filtros con contadores, panel de pedido sólo con carrito lleno.

### 12 · `test(visual): regresión visual y aserciones de accesibilidad`

`tests/`, `playwright.config.mjs`

Portar `capture.mjs` de la propuesta: solape del stack, objetivos táctiles, fuente de inputs, desbordamiento, errores de consola. Regresión visual en 6 vistas × 11 viewports.

### 13 · `chore(build): concatenar CSS y auto-hospedar maplibre`

`styles.css`, `index.html`, `package.json`

Eliminar la cadena de 11 `@import` con esbuild; auto-hospedar `maplibre-gl.css`.

---

## Commits del rider (repositorio aparte)

| # | Repositorio | Commit |
|---|---|---|
| R1 | PWA + Supabase | `feat(orders): máquina de estados formal y RPCs idempotentes` |
| R2 | PWA | `refactor(rider): la vista web usa los RPCs en vez de escritura directa` |
| R3 | `taba-rider` (nuevo) | `chore: andamiaje Flutter, flavors, CI, tokens generados` |
| R4 | `taba-rider` | `feat(auth): sesión Supabase con Keystore y revocación` |
| R5 | `taba-rider` | `feat(orders): lectura, Realtime y reconciliación` |
| R6 | `taba-rider` | `feat(outbox): cola durable con idempotencia y drenaje` |
| R7 | `taba-rider` | `feat(location): foreground service y muestreo por estado` |
| R8 | `taba-rider` | `feat(notifications): FCM, canales y deep links` |
| R9 | `taba-rider` | `test: integración, contrato y matriz de dispositivos` |

**R1 y R2 son bloqueantes de R3.** No se crea el repositorio Flutter antes de que el contrato esté validado por la web en producción.

## Convenciones

- Conventional commits.
- Un commit no mezcla refactor con cambio de contenido.
- Cada commit deja la suite en verde.
- Los commits 1, 2 y 6 llevan capturas antes/después en la descripción del PR.
- Los commits 1, 2, 6 y 7 requieren revisión humana en dispositivo físico antes del merge.
