# Resultados de QA

Rama `feat/taba-frontend-commercial-polish`. Fecha: 2026-10-01.

Cada resultado dice sobre qué commit se obtuvo. Los commits de código son, en
orden: `3b171e3` → `1936e9d` (corrige dos regresiones propias) → `fd54619`
(fusiona el commit que el PR #129 sumó después). Lo que viene después de
`fd54619` es sólo documentación y evidencia.

## CI

| Corrida | Commit | Resultado |
|---|---|---|
| `36817855269` | `3b171e3` | **ROJA.** E2E: 38 fallas, 638 pasadas. Unitarias, migraciones y Windows en verde |
| `36828580674` | `1936e9d` | **VERDE.** Unitarias 2.833 (2.832 pasadas, 1 omitida, 0 fallas). E2E 678 pasadas, 4 omitidas, ninguna necesitó reintento. Migraciones y Windows en verde |
| `36839210187` | `fd54619` | **Sin resultado.** Se canceló sola al despachar la corrida siguiente (el flujo cancela la corrida anterior de la misma rama). No cuenta como verde ni como roja |
| `36839761467` | `273c4e8` | **VERDE.** Unitarias 2.833 (2.832 pasadas, 1 omitida, 0 fallas). E2E 682 pasadas, 4 omitidas, ninguna necesitó reintento. Migraciones y Windows en verde |

`273c4e8` es `fd54619` más la documentación y la evidencia: el código es el
mismo, así que la última corrida verde cubre la fusión. Las 4 pruebas E2E que
suma respecto de la corrida anterior son las que trae el commit nuevo del PR
#129, en los dos motores.

La corrida roja era mía. 36 de las 38 fallas tenían una sola causa (R-01 en
`frontend-audit.md`): el agrupado por rubro reordenó el catálogo demo y los
recorridos de compra pasaron a agregar una cerveza. Las otras dos eran un nombre
largo que no entraba con la tipografía de Linux (R-02). Las dos se corrigieron
en el código, no en las pruebas existentes.

Una corrida anterior (`36813915512`, sobre `c9bd231`) la cancelé yo antes de que
terminara el E2E para volver a despachar: si la hubiera dejado correr, la falla
se veía una hora antes.

## Pruebas que agrega la rama

| Archivo | Casos | Qué cubre |
|---|---:|---|
| `tests/campaigns.test.mjs` | 26 | Motor: dos llaves, vigencia, texto prohibido, producto real y comprable, alcohol, marcado, hoja |
| `tests/catalog-search-tolerance.test.mjs` | 9 | Búsqueda exacta primero, parecidos declarados, lo que no se vende sigue en cero |
| `tests/catalog-frontend-polish.test.mjs` | 17 | Marca, retornable, orden, nombre largo, favoritos, brillo, miniaturas, memoización |
| `tests/e2e/campaigns.spec.mjs` | 10 | La pieza en la tienda real: Chromium y WebKit |
| `tests/e2e/catalog-polish.spec.mjs` | 9 | El catálogo como lo ve un cliente: Chromium y WebKit (1 caso sólo Chromium) |

No se eliminó ninguna prueba existente. Se editaron siete archivos de prueba que
ya estaban, todos por un valor que cambió a propósito: el fixture de nombres
(Brahma «1 L · Retornable»), las esperas del brillo en
`catalog-card-glow.spec.mjs`, y la versión de caché y de hojas en cinco pruebas de
PWA y de publicación. `playwright.config.mjs` suma los dos archivos nuevos a la
lista de WebKit.

## E2E local, sobre `1936e9d`

| Navegador | Alcance | Resultado |
|---|---|---|
| Chromium | 30 archivos: los 22 que fallaron en CI más los de home, catálogo, campañas y movimiento | 171 de 171, sin reintentos, 29 min |
| WebKit | 8 archivos: los que el repositorio corre en WebKit y tocan home, catálogo, campañas y checkout | 66 pasadas, 1 omitida (la de ritmo de cuadros) |

En la corrida de WebKit el corredor informó además «worker process did not exit
within 300000ms»: es el proceso huérfano de WebKit para Windows que
`playwright.config.mjs` ya documenta. No es una prueba fallida, pero la corrida
no terminó con código 0 y se deja dicho.

## E2E local, después de la fusión (`fd54619`)

La máquina estaba al 100 % de CPU por otros agentes. Tres resultados que no son
verdes limpios:

| Prueba | Qué pasó | Lectura |
|---|---|---|
| `pwa-update-lifecycle` «CP v131 a v136», Chromium | Falló 1 vez, pasó 2 | Depende del tiempo: la caché vieja todavía no se había borrado |
| `catalog-runtime-stability` «Realtime caído», Chromium | Falló 2 veces, pasó 4 | Cuenta lecturas de polling en una ventana de tiempo |
| `catalog-runtime-stability` «una nueva sesión de ficha…», WebKit | Falló 3 de 3 por tiempo (45 s) | Es una prueba nueva del PR #129. Corrida sobre el commit de ese PR, sin nada de esta rama, falló 1 de 2 con el mismo límite. No depende de esta rama |

Ninguna se dio por buena con esas corridas locales: quedaron a cargo del CI, que
corre en una máquina sin carga. En la corrida `36839761467` las tres pasaron al
primer intento, igual que el resto del E2E.

## Estrés de 5 minutos, sobre `1936e9d`

Recorrido en bucle, a 390 × 844, con las tres campañas de QA encendidas: scroll
continuo, abrir y cerrar una ficha, entrar y salir de un rubro, buscar y limpiar,
agregar y quitar del carrito, ir al carrito y volver, ir a la home y volver. Cada
tres vueltas, una ventana quieta con datos idénticos.

| | Chromium · Realtime | WebKit · Realtime | Chromium · Realtime caído (polling 5 s) |
|---|---:|---:|---:|
| Duración | 5,2 min | 5,4 min | 5,2 min |
| Vueltas | 19 | 15 | 18 |
| Fichas abiertas | 19 | 15 | 18 |
| Cambios de rubro | 38 | 30 | 36 |
| Búsquedas | 19 | 15 | 18 |
| Navegaciones | 38 | 30 | 36 |
| Eventos de Realtime emitidos | 38 | 30 | 0 |
| Lecturas del catálogo | 64 | 52 | 62 |
| CARD_REPLACEMENTS | 0 | 0 | 0 |
| IMAGE_NODE_REPLACEMENTS | 0 | 0 | 0 |
| Piezas de campaña reemplazadas | 0 | 0 | 0 |
| UNEXPECTED_RENDER_CYCLES | 0 | 0 | 0 |
| CONSOLE_ERRORS | 0 | 0 | 0 |
| NETWORK_ERRORS | 0 | 0 | 0 |
| LAYOUT_SHIFTS | 2 (CLS 0,003) | no medible | 2 (CLS 0,003) |

Los dos saltos de Chromium son el contador y el filete del título del rubro al
buscar (0,0015 cada uno). El arnés escribe en el buscador sin una tecla real y
por eso el navegador los cuenta; con una tecla real los descarta como respuesta
a una acción. WebKit no tiene la API de saltos de maqueta: el cero que devuelve
no es una medición.

Sobre `3b171e3` las tres pasadas habían dado lo mismo (0 reemplazos, 0 ciclos,
0 errores), con 7, 0 y 3 saltos.

### IMAGE_REDOWNLOADS

Se mide aparte, con un backend HTTP real y **sin** interceptar pedidos, que es la
única forma de que la caché del navegador funcione como en producción. El
servidor cuenta cada pedido que le llega.

| | Chromium | WebKit |
|---|---:|---:|
| Miniaturas distintas | 42 | 42 |
| Veces que el servidor entregó cada una | 1 | 1 |
| IMAGE_REDOWNLOADS | 0 | 0 |

En las pasadas de estrés de arriba los pedidos están interceptados, y eso apaga
la caché: Chromium muestra ahí 59–62 pedidos repetidos de miniaturas, que son la
ficha y el carrito construyendo su propia imagen. No son descargas reales; por
eso existe esta segunda medición.

## Cambio en vivo

Un producto cambia de precio y de stock en el backend (Realtime en dos corridas,
polling en una).

| | Chromium | WebKit |
|---|---:|---:|
| Tarjetas con alguna mutación | 1 | 1 |
| Mutaciones en esa tarjeta | 4 | 4 |
| Nodos reemplazados | 0 | 0 |
| Imagen recargada | no | no |
| Saltos de maqueta | 0 | no medible |

## Carrito

| Comprobación | Resultado |
|---|---|
| Tocar una pieza abre la ficha de su producto y no agrega nada | PASS (E2E, dos motores) |
| Agregar y quitar con campañas encendidas, 52 veces en el estrés | 0 nodos reemplazados, 0 errores |
| El carrito persiste al recargar | PASS |

## Movimiento reducido

`REDUCED_MOTION: PASS`. Con `prefers-reduced-motion: reduce`, en Chromium y en
WebKit: 0 animaciones, el módulo informa `running: 0, plays: 0`, y la pieza
muestra su cuadro final con título, producto, acción y leyenda legal.

## Accesibilidad

axe-core 4.10.2, reglas WCAG 2.0, 2.1 y 2.2 A y AA, sobre `1936e9d`:

| Vista | Sin campañas | Con campañas |
|---|---:|---:|
| Home | 0 violaciones | 0 violaciones |
| Catálogo | 0 | 0 |
| Ficha | 0 | 0 |
| Carrito | 0 | 0 |

axe deja como «incompleto» el contraste sobre fondos con degradado (no lo puede
calcular) y un `aria-prohibited-attr` que ya estaba. El contraste del corazón de
favoritos se midió aparte: 17,2:1 y 5,4:1.

Teclado: la pieza se alcanza con Tab, se activa con Enter y se oculta con su
botón; el foco pasa a lo que ocupa su lugar.

## Matriz y navegación

20 de 20 celdas y el recorrido de navegación completo en los dos motores, sobre
`1936e9d`. Detalle en `browser-matrix.md`.

## Capturas y videos

| Carpeta | Contenido |
|---|---|
| `before/chromium/` | 22 capturas de la base: home, catálogo, ficha, búsqueda, carrito; 390 × 844 y 1366 × 768 |
| `after/chromium/` | Las mismas 22, sobre `1936e9d` |
| `before/defects/`, `after/defects/` | Corazón de favoritos y título del rubro, recortes sin pérdida |
| `after/banners/` | 36: pieza de cerveza y pieza de lata dentro de la tienda, en tres momentos de la escena, teléfono y escritorio, dos motores |
| `after/matrix/` | 70: cinco tamaños por dos motores, con y sin campañas |
| `videos/` | 8: `beer_pour` (lata y botella), `cold_can`, `product_drop`, `ice_reveal`; teléfono y escritorio |

No hay «antes» de las piezas animadas: no existían. El «antes» de ese lugar es
la banda editorial de `before/chromium/*-home-top`.

Las capturas están en WebP para no cargar 35 MB al repositorio. Los videos se
grabaron del laboratorio (`scripts/campaign-lab/`), que usa el mismo motor y la
misma hoja que la tienda; cada uno se abrió y se miró en tres momentos antes de
darlo por bueno.

## Lo que no se probó

- Un teléfono físico, Android o iPhone.
- Safari real. WebKit de Playwright es el mismo motor, no el mismo navegador.
- La tienda publicada: producción no se tocó y nada de esto está desplegado.
- El backend real: todo corrió contra un backend en memoria con la copia de sólo
  lectura del catálogo. No se usó staging ni ningún dato del otro agente.
- La suite unitaria completa en esta máquina sobre el commit final: se cortó a
  mitad de camino cuando apareció la corrida roja. La completa es la de CI.
