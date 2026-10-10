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
| 1 | `campaigns.spec` «un renderer lento conserva el packshot real…» | **Preexistente.** Condición de carrera `image.complete` justo después de ver el atributo `src`. **Falla también en `main` sin cambios** (`D:\work\la-taba-baseline-main`, `campaigns.spec.mjs:417`) y pasa al reintentar en la rama. | Flaky de `main`; no se tocó. |
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
- **CI de GitHub:** ver el PR.
