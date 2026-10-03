# Resultados cross-browser

Fecha: 2026-08-03

Árbol UI certificado: commit `83dc8e2922259eb2c7bd0994f55e5bd53c6c772c`. El commit posterior `0587712` sólo cambia backend de pagos, migración y tests; no modifica HTML/CSS/JS de storefront.

| Motor | Resultado | Duración | Workers | Retries |
|---|---:|---:|---:|---:|
| Chromium | 149/149 PASS | 5.2 min | 1 | 0 |
| WebKit | 149/149 PASS | 7.9 min | 1 | 0 |
| Firefox | 149/149 PASS | 12.7 min | 1 | 0 |

Reduced motion forma parte de la suite completa de cada motor. Firefox pasó un preflight 1/1, cerró limpio, no dejó procesos y liberó puertos. WebKit tuvo además estabilidad focal 21/21 repetida tres veces, bootstrap/search 10/10 y geometría touch 5/5; Chromium touch 10/10.

## Registro individual de los once casos WebKit

Las capturas de los ocho fallos reproducidos fueron revisadas visualmente; sólo contienen fixtures/demo TABA2 y no muestran credenciales. Cada caso conserva `trace.zip`; los binarios no se copian a los artefactos de entrega ni a Git.

| # | Pantalla / test | Reproducción individual y error | Evidencia | Clasificación | Corrección y cierre |
|---:|---|---|---|---|---|
| 1 | Catálogo, CTA móvil compacta | FAIL; `toBeTruthy`, `beverage-storefront.spec.mjs:302`; el viewport conservaba overflow/posición inestable. | 1 screenshot, 1 video, 1 trace | app + compositor WebKit + test | bootstrap `ready`, click tras scroll estable, contexto nuevo por viewport y scroll global opt-in; PASS en suite completa. |
| 2 | Negocio → restaurar catálogo | FAIL; `toBeTruthy`, `business-catalog.spec.mjs:70`; overflow horizontal. | 1 screenshot, 1 trace | app/CSS | `overflow-x: clip` limitado a la vista catálogo; no se ocultó overflow vertical ni se relajó la aserción; PASS. |
| 3 | Central de pedidos | PASS aislado, sin error; trace completo. | 1 trace | runner/secuencia + precondición | readiness explícito, carrito confirmado antes de navegar y runner serial; PASS completo. |
| 4 | Configuración del negocio → restaurar | FAIL; `toBeTruthy`, `business-setup.spec.mjs:120`; overflow horizontal visible tras volver al catálogo. | 1 screenshot, 1 trace | app/CSS + test | mismo cierre de overflow de catálogo y precondición autoritativa de carrito; PASS. |
| 5 | Rider / comprobante de entrega multi-pestaña | FAIL; `toContainText`, `delivery-proof.spec.mjs:94`; la pestaña principal perdió el pedido/estado al hidratar y mostró login Rider. | 1 screenshot, 1 trace | app (race IndexedDB) + test | la hidratación preserva cambios de carrito posteriores a su baseline; se eliminó navegación redundante y se espera el pedido exacto; PASS. |
| 6 | Catálogo, input de búsqueda iOS | FAIL; overflow al enfocar: esperado ≤1 px, recibido 6 px, `ios-autozoom-safety.spec.mjs:120`. | 1 screenshot, 1 trace | app/CSS WebKit | clipping horizontal sólo en catálogo, manteniendo fuente ≥16 px y prueba de escala; PASS. |
| 7 | Catálogo 390×844, scroll fantasma | FAIL; overflow esperado ≤1 px, recibido 6 px, `ios-phantom-scroll.spec.mjs:97`. | 1 screenshot, 1 trace | app/CSS WebKit | cierre de overflow catalog y scroll estable; PASS. |
| 8 | Catálogo 320×568, scroll fantasma | FAIL; overflow esperado ≤1 px, recibido 8 px, `ios-phantom-scroll.spec.mjs:97`. | 1 screenshot, 1 trace | app/CSS WebKit | mismo cierre bajo el mínimo soportado de 320 px; PASS. |
| 9 | Catálogo/bottom nav + safe-area | FAIL; `toBeFalsy`, `la-taba.spec.mjs:640`; una captura quedó blanca durante transición y otra mostró la grilla contra el nav. | 2 screenshots, 1 video, 1 trace | compositor/scroll + test | scroll al máximo real (`scrollHeight-clientHeight`) con polling; `scroll-behavior` global `auto`; targets 44.1 px para evitar redondeo 43.9999; PASS. |
| 10 | `?reset=1` → tracking vacío | PASS aislado, sin error; trace completo. | 1 trace | runner/secuencia | readiness y runner de servidor único/serial; PASS completo. |
| 11 | Simulación GPS / MapLibre | PASS aislado, sin error; trace completo. | 1 trace | entorno MapLibre + test | espera explícita de `data-map-status=ready` hasta 15 s, sin falsificar mapa/ETA; PASS completo. |

Los errores se extrajeron de `test.trace` y las rutas de stack quedaron asociadas a cada caso. Los tres casos que no fallaron individualmente no se etiquetaron como “infraestructura”: se clasificaron como dependientes de secuencia/runner sólo después del PASS aislado, trazas limpias y cierre reproducible de la suite completa con un servidor estable, un worker y cero retries.

La suite completa deberá repetirse una vez más sobre el HEAD final después de cualquier cambio de frontend o runner.
