# TABA — Riesgos de regresión

Qué se puede romper al aplicar el plan, y cómo detectarlo antes de que llegue a un cliente.

## Riesgos por etapa

### Etapa 1 · Tokens

| Qué se rompe | Cómo | Detección | Mitigación |
|---|---|---|---|
| **Seguimiento del cliente** (`tracking.css`, 2.981 líneas) | Hereda todos los tokens; un cambio de radio, sombra o z-index lo afecta sin que nadie lo toque | Regresión visual de la vista de seguimiento en los 11 breakpoints | Capturar seguimiento **antes** de la etapa 1 y comparar; `tracking.css` no se edita pero **sí se verifica** |
| **Checkout** | `button-row` es sticky y depende del token de reserva | E2E de compra completa en 320×568 con teclado abierto | Es el cambio 1.10; se prueba aparte |
| **Showcase / demo** | Tiene fallbacks literales (`82px`) que quedan desincronizados | Visual del showcase | Cambio 1.11 en el mismo commit |
| **Orden de apilamiento** | Al pasar de 1000/1150/1200/3000 a 200/300/400/700 puede invertirse alguna superposición no evidente | Test que abra a la vez modal + toast + carrito + nav y verifique el orden | Cambiar todos los z-index en un solo commit, nunca parcialmente |
| **Service worker sirve CSS viejo** | `styles.css?v=40` cacheado; el usuario ve tokens nuevos con CSS viejo o al revés | Probar con SW registrado, no sólo en incógnito | Subir la versión del query y verificar la estrategia de `sw.js` **antes** de la etapa 1 |

### Etapa 2 · Tarjeta de producto

| Qué se rompe | Detección | Mitigación |
|---|---|---|
| Las tarjetas del **carrito**, de **recomendaciones** y del **detalle** comparten estilos con `.product-card` | Visual de las vistas de carrito y detalle | Consolidar en el mismo commit; revisar los 5 markups del inventario |
| Los tests E2E que buscan `.product-media-control` o el `+` en su posición actual | La suite falla | Actualizar selectores en el mismo commit; preferir selectores por rol y nombre accesible |
| Nombres largos que ahora ocupan 2 líneas cambian la altura de fila | Visual con “Red Bull Energy Drink” e “Imperial Cream Stout” | La grilla iguala las filas; verificar en 320 |
| Imágenes que no cargan | Visual con red bloqueada | El media conserva su caja por `aspect-ratio`; test con imagen rota |

### Etapa 3 · Meta y estado vacío

| Qué se rompe | Detección | Mitigación |
|---|---|---|
| Tests que asumen que el H1 del catálogo es siempre la categoría | La suite falla | Actualizar; el nuevo contrato está en el spec |
| El rail de ofertas ya se ocultaba con búsqueda activa (decisión correcta y documentada en `js/ui.js:952-954`) | Test de que sigue ocultándose | **No tocar esa lógica**; sólo cambia la presentación |
| El contador del carrito se confunde con el de resultados | Test de independencia: 4 en el carrito + búsqueda sin resultados | Ya está en el plan de pruebas |

### Etapa 5 · Negocio móvil

| Qué se rompe | Detección | Mitigación |
|---|---|---|
| `js/business.js` tiene cambios sin commitear de otro agente | Conflicto de merge | Coordinar antes; hacerlo después de que ese trabajo esté commiteado |
| Flujos operativos que dependen de las tabs actuales | E2E de `business-inbox.spec.mjs` | Migrar el test junto con el cambio |
| El sonido de pedido nuevo depende de un gesto previo del usuario (política de autoplay) | Prueba manual con la pestaña en segundo plano | Mantener el comportamiento actual; sólo cambia la presentación del control |
| Realtime: `realtime-sync.js` está siendo modificado | Conflicto | Sólo se cambia la presentación de la franja, no la lógica |

### Etapas de rider

| Qué se rompe | Detección | Mitigación |
|---|---|---|
| Migrar la vista rider web a RPCs cambia el camino de escritura | E2E de `delivery-code.spec.mjs`, `tracking-arriving.spec.mjs` | Los RPCs replican la semántica actual; se migra con flag |
| El relay de demostración deja de coincidir con el backend real | Tests de demo-realtime | Mantener el modo demo detrás de flag durante toda la migración |
| Estados divergentes entre web y Android durante la convivencia | Auditoría de `order_events` con origen | Un solo juego de RPCs |

## Riesgos transversales

| Riesgo | Comentario |
|---|---|
| **`body { overflow-x: hidden }` enmascara desbordes** | Las mediciones dan 0px de desbordamiento en todos los viewports, pero puede deberse a esta regla. El test de CI debe medir `scrollWidth` **con la regla desactivada**, o los desbordes reales seguirán invisibles |
| **Las safe areas no se pueden verificar en emulación** | Chromium devuelve `env(safe-area-inset-bottom) = 0`. Toda la etapa 1 debe validarse en un iPhone con barra de gestos y un Android con navegación por gestos antes del merge |
| **Cascada por orden de fuente** | Varias reglas actuales dependen de que el `@media` esté después de la base. Al concatenar el CSS con esbuild (etapa 13) el orden cambia. **La etapa 13 debe ir con regresión visual completa**, no tratarse como un cambio de build inocuo |
| **Trabajo concurrente sin commitear** | 32 archivos modificados y 6 sin seguimiento. Cualquier etapa que toque `js/ui.js`, `js/business.js` o `index.html` colisiona. Es el riesgo de proceso más probable de todos |
| **Regresión de rendimiento** | La tarjeta pasa a `aspect-ratio`; con 22 productos no hay problema, pero conviene medir CLS y LCP antes/después |

## Suite de regresión mínima

Antes de cada merge de las etapas 1 a 7:

1. **Solape del stack** — 7 viewports × 2 estados de carrito × 6 vistas.
2. **Objetivos táctiles y fuente de inputs** — todas las vistas.
3. **Desbordamiento horizontal** — con `overflow-x` desactivado.
4. **Errores de consola y `pageerror`** — cero.
5. **Regresión visual** — 6 vistas × 11 breakpoints, con aprobación manual de los cambios esperados.
6. **E2E de compra completa** — 320×568 y 390×844.
7. **E2E del panel del negocio** — aceptar, preparar, listo, entregar.
8. **Contraste de la matriz de tokens.**
9. **Vista de seguimiento** — aunque no se toque, porque hereda tokens.

La herramienta de esta propuesta (`diagnostics/capture.mjs`) implementa los puntos 1 a 4 y puede portarse tal cual: usa el Playwright que el repositorio ya tiene.
