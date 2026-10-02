# Resultados de QA — continuación del frontend

Fecha: 2026-10-02. Rama `feat/taba-frontend-commercial-polish`, PR #131.
Base de la comparación: `0364a58` (el HEAD del PR al empezar esta tanda).

Todo lo de esta página se midió en una notebook de 4 núcleos compartida con
otras sesiones de trabajo. Donde eso le quita valor a un número, está dicho.

## CI

| Corrida | Commit | Resultado |
|---|---|---|
| 36887542331 | `0364a58` (base) | Verde. 680 E2E, 4 omitidas, 2 inestables al reintento |
| 36974637300 | `0197ba5` (primera tanda de commits) | **Rojo.** Unitarias, migraciones y Windows en verde. E2E: 723 en verde, 4 omitidas, 1 en rojo |
| la de los arreglos | ver el PR | Se despacha al subir estos commits; el resultado va en el cuerpo del PR, no acá |

Clasificación de lo que falló o titubeó:

| Prueba | Clase | Qué era |
|---|---|---|
| `checkout-payment-handoff.spec.mjs:351` (inestable en la base) | TEST_BUG | Simulaba la vuelta de Mercado Pago antes de que el traspaso estuviera armado. Ahora espera la marca. En `0197ba5` pasó al primer intento |
| `service-worker-degraded-recovery.spec.mjs:224` (inestable en la base) | ENVIRONMENT_FLAKE | WebKit «Page crashed» en el runner. En `0197ba5` pasó al primer intento |
| `campaigns.spec.mjs` «la escena llena la banda que tiene» (rojo en `0197ba5`) | **PRODUCT_BUG** | La leyenda legal partía en dos renglones con la letra de sistema de Linux y la escena la pisaba. Arreglado en el producto; ver `review-findings.md` |

Ninguna aserción se aflojó. Las dos mediciones que cambiaron están explicadas
en `review-findings.md`.

## Pruebas locales, sobre el código final

| Qué | Chromium | WebKit (iPhone emulado) |
|---|---|---|
| `storefront-states.spec.mjs` (nueva, 20 pruebas) | 20 de 20 | 20 de 20 |
| `campaigns.spec.mjs` (15 pruebas) | 15 de 15 | 15 de 15 |
| Home y pliegue: `beverage-storefront`, `taba2-brand-home`, `storefront-stress-responsive`, `alcohol-gondola-mobile` | 45 de 45 | — (CI) |
| Dirección, traspaso de pago y movimiento: `address-flow`, `customer-delivery`, `delivery-location-confirmation`, `checkout-payment-handoff`, `motion` | 52 de 52 | — (CI) |

La suite E2E completa (728 pruebas, 42 min) sólo se corre en el CI: en esta
máquina tarda horas y da falsos rojos por tiempo.

En WebKit local hubo dos tropiezos que no son del producto:

- Una prueba de la ficha superaba los 45 s de tope porque encadenaba demasiados
  pasos. Se partió en dos; las dos pasan.
- Al cambiar de archivo de pruebas, el proceso de WebKit en Windows no termina
  de cerrarse y Playwright espera 5 minutos. Se corre un archivo por proceso.

**Unitarias.** Suite completa sobre el código final: 2.857 de 2.858. La que
falla es un gate de Gradle del Rider que en esta notebook se queda sin tiempo;
esta rama no toca esa parte y en el CI pasa. Una corrida anterior, con la
máquina saturada, había dado 2.848 de 2.853: de esos cinco rojos dos eran míos
(corregidos), uno era la identidad sin firmar y dos eran de la máquina.

## Accesibilidad

axe-core, reglas WCAG 2.0/2.1/2.2 A y AA, en home, catálogo, ficha y carrito, a
390 × 844.

| | Chromium | WebKit |
|---|---|---|
| Con campañas a la vista | 0 violaciones | 0 violaciones |
| Sin campañas (lo que se publica hoy) | 0 violaciones | — |

`CRITICAL_ACCESSIBILITY_VIOLATIONS: 0`. axe deja «por revisar a mano» el
contraste de texto sobre fotos y degradados, igual que antes de esta tanda.

## Estrés de 5 minutos

Scroll continuo, abrir y cerrar fichas, cambiar de rubro, buscar y borrar,
agregar y quitar del carrito, ir y volver de la home, con Realtime emitiendo y
las tres campañas a la vista.

| | Chromium | WebKit |
|---|---|---|
| Duración | 5,1 min, 23 vueltas | 5,2 min, 17 vueltas |
| CARD_REPLACEMENTS | 0 | 0 |
| IMAGE_REPLACEMENTS | 0 | 0 |
| Piezas de campaña reemplazadas | 0 | 0 |
| UNEXPECTED_RENDER_CYCLES | 0 | 0 |
| CONSOLE_ERRORS | 0 | 0 |
| NETWORK_ERRORS | 0 | 0 |
| LAYOUT_SHIFTS | 0 (CLS 0) | sin dato: WebKit no expone esa API |
| Cambio en vivo de un producto | sólo su tarjeta | sólo su tarjeta |

**IMAGE_REDOWNLOADS: 0**, contado en el servidor con la caché real del
navegador (2 minutos, sin interceptar pedidos): 42 miniaturas, cada una bajada
una sola vez, en Chromium y en WebKit. El contador del estrés no sirve para
esto: intercepta la red, y con eso cada `<img>` nuevo de una foto ya bajada se
ve como un pedido.

Una primera corrida en Chromium dio 11 errores de red. No eran de la tienda: el
servidor local de pruebas llegó a su tope de dos horas y se apagó en medio. Se
repitió con el servidor arriba y es la que figura.

## Performance: base contra final, intercaladas

Tres rondas, base y final alternadas en la misma máquina, dos corridas por
ronda. Teléfono: 390 × 844, densidad 3, CPU frenada 4×. Sin campañas, que es lo
que se publica.

### Lo que sí se puede afirmar

| | Base | Final |
|---|---|---|
| Una tecla en el buscador, script (perfil de CPU, teléfono) | 162 ms [152 – 167] | 53 ms [47 – 57] |
| Una tecla, hasta el segundo cuadro, p50 | 192 ms [186 – 206] | 77 ms [75 – 83] |
| Una tecla, hasta el segundo cuadro, p95 | 364 ms [339 – 415] | 292 ms [246 – 311] |
| Una tecla, manejador, escritorio sin freno | 66 ms [62 – 78] | 23 ms [21 – 23] |
| CLS, home y catálogo | 0 | 0 |
| Pedidos de red, home | 174 | 176 |
| Bytes de imágenes, home (teléfono) | 1.034.131 | 1.034.131 |
| Bytes de imágenes, catálogo (teléfono, 46 fotos) | 471.164 | 471.164 |
| Bytes totales, home, sin comprimir | 5.059.742 | 5.130.131 |
| Nodos del DOM, home | 2.738 | 2.739 |

La tecla es la mejora de esta tanda: antes cada tecla redibujaba la tienda
entera, incluida la home que no se ve. Los rangos no se tocan.

El costo: dos módulos más (las dos escenas nuevas) y 70 kB más de JS y CSS sin
comprimir. Las fotos no cambiaron.

### Scroll y LCP: dos mediciones, y sólo una sirve

**Con GPU** (ventana real fuera de pantalla, misma secuencia, tres rondas
intercaladas). Es la medición válida:

| | Base | Final |
|---|---|---|
| FPS, scroll de la home, teléfono (CPU 4×) | 59,6 [55,8 – 59,7] | 59,7 [59,4 – 59,9] |
| FPS, scroll del catálogo, teléfono, 1.ª pasada | 59,3 [58,9 – 59,8] | 59,9 [59,6 – 59,9] |
| FPS, scroll del catálogo, teléfono, 2.ª pasada | 60,1 [60,1 – 60,1] | 60,1 [58,4 – 60,1] |
| FPS, scroll de la home, escritorio | 60,1 [60,1 – 60,1] | 60,1 [59,9 – 60,1] |
| FPS, scroll del catálogo, escritorio | 59,8 [59,7 – 59,9] | 59,9 [59,6 – 59,9] |
| Cuadro p95, catálogo, teléfono | 16,8 ms | 16,7 ms |
| LCP, teléfono | 3.848 ms [3.140 – 3.896] | 3.488 ms [3.444 – 5.732] |
| LCP, escritorio | 1.768 ms [1.640 – 4.816] | 2.308 ms [1.528 – 3.100] |
| CLS, teléfono | 0 | 0 |
| CLS, escritorio | 0,006 | 0,006 |

El scroll va a 60 cuadros por segundo antes y después: **sin regresión y sin
mejora**, que es lo esperable porque esta tanda no tocó nada de lo que corre
durante el scroll. El LCP no cambió de forma medible: los rangos se pisan.

**Sin ventana** (la primera que corrí, con la máquina ocupada por otras
sesiones): entre 0,6 y 60 cuadros por segundo para el mismo código, con los
rangos de base y final pisándose enteros. Esos números no dicen nada y no se
usan; quedan anotados para que nadie los repita creyendo que miden algo. Lo
mismo el LCP de esa tanda (5.224 contra 2.840 ms en teléfono): las dos primeras
rondas de la base fueron las más castigadas.

`FPS_BASE` ≈ `FPS_FINAL` ≈ 60. `LCP`: sin cambio medible.

## Dónde queda el primer «Agregar» de la home

Borde superior del botón, en píxeles desde arriba de la página.

| Tamaño | Base | Final |
|---|---|---|
| 360 × 800 | 617 | 585 |
| 390 × 844 | 633 | 601 |
| 430 × 932 | 671 | 639 |
| 1366 × 768 | 872 (bajo el pliegue) | 741 (el nombre y el precio entran; el botón asoma) |
| 1920 × 1080 | 872 | 846 |

En el teléfono son los 32 px del renglón que el encabezado dejó de ocupar. En
la notebook de 1366 × 768 la banda bajó de 270 a 164 px.

## Capturas y videos

En esta carpeta:

- `before/` — el árbol base `0364a58`, en Chromium y WebKit.
- `after/` — el código final, en Chromium y WebKit.
- Cinco tamaños: 360 × 800, 390 × 844, 430 × 932, 1366 × 768, 1920 × 1080.
- Vistas: home, catálogo, ficha, búsqueda con y sin resultados, catálogo con
  productos agregados, carrito lleno y vacío, home con catálogo pendiente.
- `videos/` — diez grabaciones de las seis escenas, en el laboratorio de
  campañas (teléfono y escritorio).
- `after/campaigns/` — la banda de apertura y la franja con una campaña
  aprobada sólo para la prueba.

Errores de consola al tomar las capturas del código final: 0 en los cinco
tamaños y en los dos motores.

Un error mío en el camino: la primera tanda de capturas «antes» salió sin
estilos, porque el árbol base que había exportado no tenía `styles.css`. Lo
detecté por los 404, completé la exportación y las repetí. Las mediciones de
performance se hicieron después de esa corrección.

## Lo que no se probó

- Un teléfono físico. Safari real. Todo WebKit de acá es el de Playwright.
- Conexión lenta real: los estados de red se probaron cortando o demorando
  pedidos en el navegador de pruebas.
- Las campañas con datos reales: las cuatro del repositorio siguen apagadas y
  sin aprobación. Se probaron marcándolas como aprobadas sólo dentro de la
  prueba.
