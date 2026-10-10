# TEST_RESULTS

Máquina: Windows 11, Node 24.8.0, Playwright 1.60 (chromium-headless-shell 1223, webkit 2287),
`workers: 1`, `TMP` en D:. Árbol: rama `fix/catalog-promotions-purchase-audit-20261009`
sobre `origin/main` `0b7f5427`.

## 1 · Verificaciones estáticas

| Comando | Resultado |
|---|---|
| `npm run check` (sintaxis, config Supabase, activos estáticos, grafo de precache, higiene, identidad de release, contrato de ubicación, codificación, escaneo de secretos) | **PASS** — «Identidad de release coherente: `la-taba-runtime-v153-campaign-buy-control` · 214 archivos». |

## 2 · Pruebas unitarias (`npm test`, en serie)

| Corrida | Resultado |
|---|---|
| `tests/*.test.mjs` completo (antes de agregar los dos archivos nuevos) | **2912 / 2912 PASS**, 0 fallos, 0 cancelados (364 s). |
| `tests/campaigns.test.mjs` (4 pruebas nuevas de la compra en la pieza) | 44 / 44 PASS. |
| `tests/catalog-commercial-coverage.test.mjs` (nuevo) | 9 / 9 PASS. |
| `tests/asset-version-coherence.test.mjs` (nuevo) | 8 / 8 PASS. |

## 3 · E2E de navegador (`npx playwright test`, Chromium + WebKit iPhone 13)

Listado: **826 casos** (proyectos `chromium`, `mobile-webkit`, `mobile-webkit-recovery`).

| Tramo | Resultado |
|---|---|
| Corrida completa, Chromium (1–`#568`) y WebKit interacción (hasta `#753`) | **741 PASS · 5 FAIL** de 746 ejecutados. |
| Corrida completa, tramo no alcanzado | 80 casos no ejecutados: el worker de WebKit quedó colgado en `#754` (NetworkProcess huérfano, el defecto de WebKit-en-Windows que ya documenta `playwright.config.mjs`); se mató y se reejecutó aparte. |
| Reejecución `mobile-webkit`: `storefront-states` + `catalog-commercial-coverage` | **39 / 39 PASS** |
| Reejecución `mobile-webkit-recovery` (los 10 specs de recuperación) | **71 / 71 PASS** |
| Reejecución `chromium`: `catalog-commercial-coverage` | **19 / 19 PASS** |

### Los 5 fallos de la corrida completa

| # | Caso | Causa | Estado |
|---|---|---|---|
| 1 | `campaigns.spec` «un renderer lento conserva el packshot real…» | **Preexistente.** Condición de carrera `image.complete` justo después de ver el atributo `src`. **Falla también en `main` sin cambios** (worktree limpio de `origin/main`, `campaigns.spec.mjs:417`) y pasa al reintentar en la rama. | Flaky de `main`; no se tocó. |
| 2 | `pwa-update-lifecycle` «CP v131 a v139» | Falló bajo carga (otras corridas de navegador en la misma máquina); **PASS** reejecutado solo (1.4 s). El arnés usa su propio servidor y el `sw.js` real con regex sobre `CACHE_NAME`/`ASSETS`: el cambio de versión no lo afecta. | Inestable por carga. |
| 3 | `storefront-states` «una combinación de filtros sin resultados…» | **Consecuencia deseada de CPA-003.** La prueba armaba la lista vacía eligiendo «Sin alcohol» *dentro de Cervezas*; ahora el rubro no ofrece una opción sin resultado. Se reescribió para armarla como la arma un cliente (aplicar el filtro en «Todas» y pasar a «Cervezas») y se agregó que «Cervezas» ya no ofrece «Sin alcohol». | **PASS** (Chromium y WebKit). |
| 4–5 | `catalog-commercial-coverage` «las opciones de marca son las del rubro…» (Chromium y WebKit) | Selector ambiguo de mi spec (`.empty-state` aparece dos veces en la vista). | Corregido; **PASS** (19/19 y 39/39). |

## 4 · Auditoría con arneses (Playwright, mismo recorrido, sin red de pago)

| Arnés | Contra | Resultado |
|---|---|---|
| `catalog-commercial-audit.mjs` (51 productos: tarjeta, foto, ficha por foto y por nombre, agregar, carrito) | Producción — Chromium 390 | 51 tarjetas · 51/51 fichas correctas · 34 agregan y el carrito queda con 1 línea al precio de la fila · 17 bloqueados con texto honesto · 0 errores. |
| ídem | Producción — WebKit emulado 390 | idéntico. |
| ídem | Producción — Chromium 1440×900 | idéntico. |
| ídem | Rama — Chromium 390 y WebKit 390 | idéntico (51/51, 34, 17, 0 errores). |
| `promotion-audit.mjs` (mapa 16×6, 6 puntos de toque, compra, carrito) | Producción ×3 | 4 piezas × 5 puntos abren la ficha correcta (60/60); **0 de 4 con «Agregar» en la pieza**. |
| ídem | Rama ×3 | 4 piezas con «Agregar» (1 toque → 1 unidad al precio de la fila → carrito 1 línea); 5 puntos abren la ficha. |
| `catalog-navigation-audit.mjs` | Producción y rama — Chromium 390 | 14 rubros con la cantidad esperada · 15 búsquedas razonables · favoritos persisten tras recargar · volver del carrito conserva el rubro. Filtros: 29 marcas ofrecidas vs 5/3/2 presentes en producción → **5/3/2 ofrecidas** en la rama. |
| Imágenes (102 archivos, maestra + miniatura) | Producción | 102 / 102 HTTP 200; 1000×1000 y 400×400; 0 duplicadas; revisión visual de las 51 maestras sin cruces. |
| `npm run campaigns:verify-live` | Producción en línea | `REAL_PRODUCT_GATE: PASS` (3 encendidas, 2 pendientes). |

## 5 · Qué NO se probó

- **Safari / iPhone físico.** Sólo WebKit de Playwright con el descriptor «iPhone 13».
- **Pagos reales.** Mercado Pago no se invocó en producción; el handoff está cubierto por
  `checkout-payment-handoff`, `checkout-mp-cliente-nuevo`, `mp-back-navigation-ui` (PASS en la
  corrida completa) y `npm run test:payments` dentro de `npm test`.
- **Pedidos.** Ninguno se creó en producción: la auditoría sólo agregó al carrito local.
- **Backend/base de datos real** (`test:db:*`): fuera de alcance, no se tocó backend.
- **CI de GitHub:** ver la sección 6.

## 6 · Matriz de viewports de la rama (medida, Chromium)

| Viewport | Banda de apertura | «Agregar» | Alcanzable | Desborde horizontal |
|---|---|---|---|---|
| 360×800 | 109 px (puerta editorial 101 px con leyenda legal; la pieza con leyenda mide 100) | 26 px (44 al dedo) | sí | no |
| 390×844 | 112 px | 26 px (44 al dedo) | sí | no |
| 430×932 | 114 px = puerta editorial | 26 px (44 al dedo) | sí | no |
| 1366×768 | 164 px = puerta editorial | 42 px | sí | no |
| 1440×900 / 1920×1080 | 270 px | 46 px | sí | no |

WebKit (iPhone 13, 390×844): mismo recorrido que Chromium, 39/39 del spec nuevo y de `storefront-states`.

## 7 · CI de GitHub (PR #146)

| Job | Resultado | Nota |
|---|---|---|
| Migrations, pgTAP and isolated restore | PASS | |
| Web, backend, fiscal and security gates | 1.ª corrida FAIL «Release hygiene» (ruta de disco local en este documento; quitada) · 2.ª corrida (Linux, 828 casos): **818 PASS · 3 FAIL** | Los 3 fallos: `campaigns.spec` — `locator.click` sobre el botón de la ficha agotó el tiempo (45 s / 90 s). En el runner Linux la tipografía acomoda la pieza de modo que el **centro** del botón de la ficha cae sobre «Agregar», que lo intercepta (ahí un toque compra en vez de abrir la ficha: correcto para el cliente, inválido para una prueba que quería abrir la ficha). En Windows el centro caía en el texto y pasaba. Corregido: las pruebas tocan la esquina del título (`position: {x:14,y:14}`). Verificado local: 42/42. |
| Native PWA update and integrated Rider motion | **PASS** con `js/app.js` idéntico a `main` | Ver abajo. |
| Windows Rust and unsigned verification bundles | PASS | |

### El job de PWA y los bytes de `js/app.js`

Con un cambio de 5 líneas en `js/app.js` (restaurar el foco del teclado tras agregar) el job
«Native PWA update» —WebKit, paso «offline reload»— falló de forma consistente en el runner
Linux, mientras Chromium pasaba. Se aisló con ramas de control descartables desde `main`
(`workflow_dispatch`, cada una con otra identidad de release; las ramas ya se borraron):

| Variante | Qué cambia respecto de `main` | Job PWA |
|---|---|---|
| Control | sólo `CACHE_NAME` | 4 / 4 verde |
| V1 | sólo versiones (`?v=80`, `app.js?v=54`) | 3 / 3 verde |
| V2a | sólo `js/ui.js` de la corrección | 2 / 2 verde |
| V2b | sólo motor + `campaigns.css` | 2 / 2 verde |
| **V2c** | **sólo `js/app.js` (+5 líneas)** | **0 / 2** |
| E1 | `js/app.js` + 420 bytes de comentario | 2 / 2 verde |
| E3 | V2c + service worker sin cabeceras de transporte en la copia de runtime | 1 / 2 |
| Rama completa (con `app.js` cambiado) | | 1 / 6 |

**Qué se concluye y qué no.** El factor es el contenido de `js/app.js`, no el tamaño ni las
versiones. El mecanismo **no está aislado**: la hipótesis más plausible (la copia que
`networkFirst` guarda al servir de la red conserva `content-encoding`/`content-length` del
transporte, y WebKit la rechaza sin red) **no se confirmó** (E3). No se modificó el service
worker. La decisión fue mantener `js/app.js` byte a byte como en `main` y descartar la
restauración de foco; con eso el job pasa (PR y corrida adicional). En Windows local el mismo
script pasa con y sin el cambio. Queda como deuda para quien toque `app.js` o el worker: la
suite necesita un mecanismo, no una racha de suerte.

La corrida de CI de `main` `0b7f5427` tiene este job en rojo en otro paso («activate update»,
ambos motores); no es de esta rama.
