# Registro de riesgos

Riesgo = probabilidad × impacto. Sólo se listan riesgos con mitigación concreta.

---

## 1. Riesgos altos

### R1 — Colisión con el trabajo en curso de Codex

**Probabilidad:** alta si se empieza ahora. **Impacto:** alto.

`feature/catalog-checkout-premium` tiene 33 archivos modificados y 6 sin
seguimiento, incluidos `styles/checkout.css`, `js/ui.js`, `js/app.js`,
`js/business.js` e `index.html` — exactamente los archivos de este plan.

**Mitigación:** no empezar hasta que ese trabajo esté mergeado o descartado, y
partir de `main` estabilizado. Es la precondición 1 del plan, no una
recomendación.

**Señal de alarma:** cualquier conflicto en `styles/` al hacer rebase.

---

### R2 — Quitar `PREVIEW INTERNA` rompe la suite e2e

**Probabilidad:** certeza. **Impacto:** medio.

`tests/e2e/beverage-storefront.spec.mjs:21` afirma que el rótulo existe:

```js
await expect(page.locator('.home-preview-label')).toHaveText('PREVIEW INTERNA');
```

Quitarlo del HTML rompe el test.

**Mitigación:** el commit 3 modifica el test **en el mismo commit**. No se
comenta ni se salta: se reemplaza por la aserción inversa
(`await expect(page.locator('.home-preview-label')).toHaveCount(0)`), para que la
fuga no pueda volver a entrar sin que un test falle.

**Riesgo residual:** si el rótulo era un requisito deliberado de la preview
privada, quitarlo cambia una decisión de producto. **Debe confirmarlo el
usuario.** El análisis dice que es una fuga (se renderiza también en producción,
sin condición de modo), pero la decisión no es del equipo de diseño.

---

### R3 — `responsive.css` es frágil por orden de cascada

**Probabilidad:** alta. **Impacto:** alto.

Cinco bloques `@media (max-width: 820px)`, tres de 560 px, dos de 360 px. El
comportamiento actual depende de cuál gana por posición, no por especificidad.
Al menos tres reglas están muertas hoy (`:741`, `:753`, `:761`). Consolidar los
bloques **cambia qué regla gana** y puede alterar superficies que nadie estaba
mirando — incluida la vista de tracking, que está fuera de alcance pero comparte
el archivo.

**Mitigación:**
1. La consolidación va en el commit 5, **después** de que el resto esté estable,
   nunca mezclada con cambios de diseño.
2. Antes de consolidar: capturas de referencia de **todas** las vistas
   (incluidas tracking y rider) en los 6 breakpoints.
3. Comparación visual después. Cualquier diferencia en tracking se revierte.
4. Se consolida un breakpoint por vez, con la suite corriendo entre cada uno.

**Alternativa si sale mal:** dejar los bloques duplicados y limitarse a borrar
las reglas muertas. Pierde limpieza pero no rompe nada.

---

### R4 — Eliminar `.product-media-control` afecta el render de producto

**Probabilidad:** media. **Impacto:** alto.

El control de cantidad pasa de `position: absolute` a estar en flujo. Cambia el
DOM que producen `renderProducts()` (`js/ui.js:1010`) y `quickAddControl()`, de
los que dependen varios e2e que hacen clic en `[data-add-product]`.

**Mitigación:** conservar los mismos atributos de datos
(`data-add-product`, `data-product-detail`, `data-favorite-toggle`) y los mismos
`aria-label`. Los tests seleccionan por atributo, no por posición: si los
atributos se conservan, siguen pasando. Se verifica corriendo la suite e2e
**antes** de tocar el CSS, con el DOM nuevo y el CSS viejo.

---

## 2. Riesgos medios

### R5 — El apilado de superficies fijas se desalinea

**Probabilidad:** media. **Impacto:** medio.

Hoy `--taba-bottom-nav-clearance` da el valor correcto **por coincidencia**: se
calcula con `--taba-bottom-nav-height: 76px` mientras la barra real mide 66 px y
flota a 10 px. Al pasar a `--nav-band` cambia la aritmética y puede aparecer
contenido tapado o un hueco.

**Mitigación:** el commit 4 incluye una medición automatizada del solapamiento
entre superficies fijas (`stickyOverlapPx`, ya implementada en
`tools/capture-prototypes.mjs`) que debe dar 0 en los 6 breakpoints. Los tokens
viejos se redefinen en función de los nuevos, así que cualquier regla que no se
migre sigue funcionando.

---

### R6 — Regresión de `safe-area-inset-bottom` en iPhone con notch

**Probabilidad:** media. **Impacto:** medio.

Ningún breakpoint de la auditoría corrió con `safe-area-inset-bottom` real: en
Chromium headless vale 0. La banda inferior crece en un iPhone real y el margen
de precio sobre el pliegue en 390×844 es de sólo ~40 px.

**Mitigación:** verificación manual en un iPhone con notch antes del commit 6.
Si el precio se cae del pliegue, se reduce el packshot de 148 a 132 px sólo en
`@media (max-height: 850px)`.

**Esto es una limitación conocida de la evidencia, no una suposición.**

---

### R7 — Unificar categorías cambia el contenido de Inicio

**Probabilidad:** alta. **Impacto:** medio.

Medido: Catálogo muestra `Todos, Favoritos, Gaseosas, Mixers, Energizantes,
Cervezas`; Inicio muestra sólo las cuatro últimas. Unificar el componente hace
que Inicio muestre `Todos` y `Favoritos`, y
`tests/e2e/beverage-storefront.spec.mjs:16` afirma `toHaveCount(4)`.

**Mitigación:** el componente unificado acepta un parámetro de exclusión, para
que Inicio siga mostrando cuatro categorías con el **mismo** componente y la
misma estética. El test no cambia. Si se decide mostrar las seis, el test se
actualiza deliberadamente.

---

### R8 — El resumen operativo de 4 columnas se aprieta en 320 px

**Probabilidad:** baja. **Impacto:** bajo.

"En preparación" en una columna de ~70 px.

**Mitigación:** ya resuelto en el prototipo — la etiqueta es `Preparación` y el
número baja a 20 px en `@media (max-width: 350px)`. Medido limpio en 320×568,
sin desborde ni truncado.

---

## 3. Riesgos bajos

### R9 — Quitar `overflow-x: hidden` de `body` revela desbordes

**Probabilidad:** baja. **Impacto:** bajo.

La medición no encontró desborde horizontal en ningún breakpoint, así que quitar
la regla no debería cambiar nada. Pero la medición cubrió Inicio, Catálogo y
Negocio, **no** Checkout, Perfil, Tracking ni Rider.

**Mitigación:** medir esas cuatro vistas antes de quitar la regla. Si alguna
desborda, se arregla la causa o se deja la regla. Es lo último del commit 5 y lo
primero que se revierte si molesta.

---

### R10 — El bottom sheet pierde el foco o no atrapa el tabulado

**Probabilidad:** media. **Impacto:** bajo.

Pasar de `<dialog>` centrado a bottom sheet puede romper el manejo de foco.

**Mitigación:** conservar `<dialog>` con `showModal()`, que ya atrapa el foco
por sí solo, y cambiar sólo la presentación (posición, radio, animación de
entrada). No se reimplementa el diálogo a mano.

---

### R11 — Densidad del panel de escritorio en pantallas de 1366×768

**Probabilidad:** media. **Impacto:** bajo.

El layout de tres paneles se diseñó a 1280×900. En 1366×768 el alto útil baja a
~600 px tras la barra superior y la franja de métricas.

**Mitigación:** cola e inspector tienen scroll propio, así que el layout no se
rompe. Se agrega `@media (max-height: 800px)` que baja la franja de métricas de
56 a 44 px.

---

## 4. Riesgos que se aceptan sin mitigar

| Riesgo | Por qué se acepta |
|---|---|
| Los botones del stepper miden 36×44 px, no 44×44 | En una tarjeta de 173 px, dos botones de 44 px de ancho no dejan lugar al número. WCAG 2.2 AA pide 24 px con separación. Documentado como excepción explícita. |
| El segmento de la cola de escritorio mide 38 px de alto | Control de puntero, no táctil. |
| 320×568 muestra 2 precios con un encabezado reducido | Viewport marginal en 2026. Optimizarlo más degradaría 390 y 430 px, que son el volumen real. |
| `js/business.js` y `js/ui.js` siguen siendo monolitos | Dividirlos junto a un rediseño visual haría irrevisable cualquiera de los dos cambios. Fuera de alcance declarado. |

---

## 5. Criterio de reversión

Se revierte el commit completo, sin discusión, si:

1. Cualquier test de `tests/e2e/tracking-*.spec.mjs` o `honest-map.spec.mjs`
   falla. El tracking está fuera de alcance: si se rompe, el cambio se pasó de
   los límites.
2. Aparece desborde horizontal en cualquier breakpoint.
3. El panel del negocio pierde una acción operativa que existía antes.
4. El tiempo hasta el primer producto renderizado empeora respecto de la línea
   de base.

---

## 6. Limitaciones de esta auditoría

Se declaran para que las conclusiones se lean con el margen correcto.

1. **Las cinco imágenes adjuntas nunca llegaron.** La evidencia es propia,
   generada con Playwright. Cubre lo que el enunciado describía, pero no puede
   confirmar detalles que sólo estuvieran en esas capturas.
2. **Chromium headless en Windows.** Sin Safari iOS ni Chrome Android reales.
   `env(safe-area-inset-bottom)` vale 0; `backdrop-filter` y el
   redimensionamiento por teclado virtual no se ejercitaron.
3. **El worktree cambia mientras se audita.** Todas las mediciones corresponden a
   `HEAD 4197bdb` con el árbol sucio del 2026-07-30 20:45. Si Codex tocó
   `styles/` después, algún número puede haberse movido.
4. **Fuentes del host.** Inter puede no estar instalada; el navegador cae a la
   pila del sistema. Los altos de texto medidos varían unos pocos píxeles según
   la máquina.
5. **No se ejercitó el panel con carga real.** El flujo automatizado de pedido
   falló por un timeout del selector de checkout, así que el panel se midió con
   la cola vacía. Eso **no** afecta a los hallazgos de layout (navegación
   recortada, fichas, ausencia de navegación), que son independientes de los
   datos, pero la tarjeta de pedido real no se midió en la app viva.
6. **Sin datos de rendimiento.** No se midió CPU, memoria ni consumo de red.
