# Catálogo TABA2 — experiencia de compra

Rama `feature/taba2-catalog-premium-purchase`, sobre `e59ac1c`
(`feature/taba2-digital-commerce-100`, cerrada y certificada).

Este documento dice qué se midió, qué se cambió y qué **no** pasó el corte.

---

## Por qué esa base y no otra

`e59ac1c` es la punta certificada más nueva de la línea del storefront:
contiene `da56ce9` —lo que hoy sirve staging— más la transformación de
performance (−28 % de JavaScript, −22 % de LCP) que el encargo pide
explícitamente no empeorar.

No se partió de `59d8e03` (`fix/taba2-order-intake-dispatch`) para no arrastrar
cinco migraciones sin aplicar ni la Edge Function de pagos a una rama de UX de
catálogo. Verificado: esa rama **no toca un solo archivo del storefront del
cliente** (sólo `js/business`, `js/production-operations`, repositorios,
migraciones y specs SQL), así que las dos son hermanas con superficie de
conflicto cero.

---

## Cómo se midió el pliegue

Con el borde **inferior** de los controles, no el superior: lo que decide si
algo se puede *tocar* es dónde termina, no dónde empieza. Y contra el pliegue
**útil** —la ventana menos la barra de navegación inferior, que es opaca—, no
contra el alto de la ventana.

Esa distinción no es cosmética: a 360×800 el botón «Agregar» de la base
terminaba en 745 px con la barra empezando en 744. Medido por el borde
superior, entraba. En la mano, no.

| ancho×alto | pliegue útil | precio antes → después | «Agregar» antes → después |
|---|---:|---|---|
| 320×720 | 664 | 680 ✗ → 684 ✗ | 731 ✗ → 736 ✗ |
| 360×800 | 744 | 694 ✓ → 691 ✓ | **745 ✗ → 743 ✓** |
| 390×844 | 788 | 697 ✓ → 707 ✓ | 748 ✓ → 759 ✓ |
| 432×960 | 904 | 700 ✓ → 751 ✓ | 751 ✓ → 803 ✓ |

**A 320×720 el «Agregar» no entra, ni antes ni ahora.** Entre la barra
superior, el encabezado, el buscador, los chips y el rótulo de la sección no
queda altura, y no la hay sin volver miniatura al packshot. Se deja dicho, no
maquillado.

A 360 —el ancho del Moto G15— el botón entero entra por primera vez. Y en las
cuatro medidas la primera pantalla ahora incluye, además, el hero comercial y
los círculos de historias, que antes no estaban.

---

## Fricciones encontradas

Todas medidas sobre la demo local (`?demo=1`) en Chromium y WebKit móvil, en
320/360/390/432.

1. **Ningún precio entraba en la primera pantalla a 320.** El encabezado
   gastaba cuatro renglones en saludar: «¡Bienvenido a», el nombre del comercio
   a 40 px —que la barra superior ya dice—, el rubro con la dirección y el chip
   de estado.
2. **El hero comercial vivía a 2.480 px del inicio**, después de Destacados y
   de Combos. La única pieza de la home pensada para dar ganas no la veía
   nadie.
3. **Las historias se anunciaban sin mostrarse.** Una tarjeta ancha ocupaba el
   78 % del renglón para decir *cuántas* hay.
4. **«Disponible» en cada tarjeta de los rails.** Un renglón fijo que no
   distinguía nada. La grilla del catálogo ya aplicaba el criterio correcto
   (`cardAvailabilityLabel`): sólo se rotula lo que hay que avisar.
5. **La marca repetida dentro del nombre**: «HEINEKEN / Heineken», «RED BULL /
   Red Bull Energy Drink».
6. **«· Unidad» en las ochenta tarjetas** de una góndola donde los ochenta
   productos son unidades.
7. **`renderOffers()` pintaba el rail de Destacados para que
   `renderHomeBestSellers()` lo sobreescribiera inmediatamente después**, en
   cada render y por lo tanto en cada toque del carrito. Trabajo tirado.
8. **«Agotado» se pintaba `#fafafa` en el catálogo**: sobre grafito, el
   producto que *no* se puede comprar era la tarjeta más luminosa de la
   pantalla.
9. **«Filtros» ocupaba una franja de 60 px a lo ancho, sola**, para el control
   menos usado del catálogo.
10. **Agregar era mudo donde importaba.** El botón se convierte en el selector
    de cantidad; las cuatro señales que ya existían —aviso, barra de carrito y
    dos insignias— viven todas lejos del dedo.
11. **Buscar «coca» devolvía seis productos y los seis decían «Precio
    próximamente»**, sin una sola salida en pantalla.
12. **La línea del carrito imprimía el mismo número dos veces**: «Unidad ·
    $ 3.576» a la izquierda y «$ 3.576» a la derecha, cuando la cantidad es 1.
13. **Que algo se agotara sólo lo decía el botón de confirmar**, al final del
    recorrido y sin nombrar cuál de los productos era el problema.

---

## Decisiones de eliminar

- El saludo y el nombre a 40 px. El `h1` sigue existiendo, sigue siendo el
  encabezado de la vista y sigue saliendo de `businessConfig`: se achica la
  tipografía, no la verdad.
- La tarjeta «Novedades de hoy», reemplazada por los círculos.
- El renglón «Disponible» fijo, la marca repetida y «· Unidad» en la tarjeta.
  **«Unidad» se conserva** donde sí informa: la ficha del producto y la línea
  del pedido. Que lo publicado sea la unidad y no el pack lo fijan las pruebas
  por lo que de verdad lo prueba —el SKU de pack no tiene tarjeta, ninguna
  tarjeta comprable dice «pack x N»—, no por una palabra repetida ochenta
  veces.
- El subtítulo del hero en teléfono: es la línea que explica en vez de
  provocar. Vuelve en el afiche de escritorio.
- `renderOffers()` y su helper.

**Lo que NO se eliminó**: la dirección del local en el encabezado (orienta), el
chip de estado (orienta), el aviso al agregar (es el anuncio accesible: el
sello «Agregado ✓» es `content` de CSS y un lector de pantalla no lo lee).

---

## Micro UX

- **«Agregado ✓» en el propio control**, 1,1 s, sin temporizadores: la ventana
  se evalúa en cada render y la animación termina sola. Con `prefers-reduced-
  motion` no se pinta y el anuncio queda a cargo del aviso, que es texto.
- Ya existían y se conservan: feedback de presión, guardia de doble toque de
  120 ms, salto del contador y de la barra de carrito.
- Aviso accionable en la línea del carrito cuando algo se agota o la cantidad
  ya no entra, con la salida al lado («Quitar del pedido» / «Dejar 3»).
- Aviso con puerta de salida cuando ningún resultado de la búsqueda tiene
  precio publicado.

---

## Performance — A/B en el mismo entorno

Mediana de 5 corridas alternadas ANTES/DESPUÉS en cada vuelta, mismo host,
iPhone 13 emulado, red 4G y CPU a 1/4, sobre la góndola real (`?demo=1`).

| métrica | antes (`e59ac1c`) | después | diferencia |
|---|---:|---:|---:|
| módulos JS | 129 | 129 | 0 |
| JavaScript | 2.040 KB | 2.052 KB | +12 KB (+1 %) |
| imágenes | 19 | 24 | +5 |
| peso de imágenes | 910 KB | 843 KB | **−67 KB (−7 %)** |
| FCP | 1.572 ms | 1.636 ms | +64 ms (+4 %) |
| LCP | 6.764 ms | 5.580 ms | **−1.184 ms (−18 %)** |
| CLS | 0,0165 | 0,0165 | 0 |
| bloqueo de hilo | 2.149 ms | 2.007 ms | −142 ms (−7 %) |
| 1er producto comprable | 5.239 ms | 5.187 ms | −52 ms (−1 %) |
| respuesta al «Agregar» | 1.749 ms | 1.788 ms | +39 ms (+2 %) |

Honestidad sobre el ruido: la base midió entre 6.416 y 6.764 ms de LCP a lo
largo de cuatro sesiones de A/B en esta máquina, o sea ±350 ms. La diferencia
de 1.184 ms está por encima de esa banda; las de FCP y «respuesta al Agregar»
(+64 y +39 ms) están dentro de ella y no se reclaman como mejora ni como
regresión.

### El camino hasta ahí, que es la parte que importa

Subir el hero al primer pantallazo lo convierte en el elemento más grande de
esa pantalla, o sea en el LCP. La primera medición fue **+1.052 ms de LCP
(+16 %)**: la fotografía la inyecta el JS como `background-image`, así que el
navegador recién se entera de que existe cuando los módulos arrancaron.

Precargarla arregló el LCP (−476 ms) y rompió lo demás: **FCP +352 ms** y
**primer producto comprable +529 ms**, porque 249 KB compiten con el CSS y los
módulos por el mismo ancho de banda. O sea que el problema no era *cuándo* se
pide sino *cuánto* pesa.

`scripts/build-hero-band.mjs` recorta la **misma** fotografía curada al tamaño
que la banda usa de verdad: 249 KB → 35 KB (−86 %). Con eso el LCP queda por
debajo de la base y el peso total de imágenes **baja** 67 KB pese a que la
primera pantalla ahora muestra más imágenes que antes.

Una trampa de CSS en el camino, anotada porque vuelve a morder: un `url()`
dentro de una custom property se resuelve **relativo a la hoja que la
consume**, no al documento. Pasar las rutas desde el JS terminaba pidiendo
`/styles/assets/promos/...` y devolvía 404. Las rutas viven en la hoja, y
`tests/home-hero-preload.test.mjs` verifica que el manifiesto, la hoja y el
`<link rel="preload">` digan las tres lo mismo.

Ese 404 además invalidó una medición: la corrida que dio «LCP −64 ms» se hizo
con el hero **sin pintar imagen**, o sea midiendo una banda vacía. Se repitió
con la foto cargando de verdad y ahí aparecieron los −1.184 ms. Una medición
que sale bien no es una medición correcta.

Y el gate de imágenes del repo hizo exactamente lo que tiene que hacer:
`tests/image-sources.test.mjs` rechazó la derivada por no declarar
procedencia. Está declarada en `docs/catalog/promo-image-manifest.json`, con el
mismo origen del lote curado que la pieza de la que sale y con la
transformación escrita.

---

## Defectos propios que encontraron las pruebas

1. **Ocultar la fila de historias se llevaba puesto el emblema de marca**: vive
   en el mismo contenedor. Sin historias se vacía la *fila*, no el encabezado.
   Lo encontraron dos specs del emblema.
2. **Bajar el buscador a 46 px rompió su piso táctil de 48**, que tiene
   contrato y prueba propia. Los píxeles del pliegue salen del packshot, que no
   es un control.
3. **«Quedan 1 unidad»**: el verbo no concordaba. Lo encontró la prueba nueva
   del carrito antes que ninguna persona.
4. **El primer halo del favorito quedó peor que el problema que resolvía**:
   sacar el disco gris y poner un halo blanco de 2 px al 92 % dejó el corazón
   como un trazo grueso encima del packshot. Bajó a 1 px al 55 % y tinta
   secundaria.

---

## Pruebas

| gate | resultado |
|---|---|
| `npm run check` | verde |
| `npm test` | 1.220 / 1.220 |
| Playwright chromium | 220 / 220 |
| Playwright mobile-webkit | 7 / 7 |
| recorrido completo × 4 anchos × 2 motores | 96 capturas antes + 96 después |
| errores de página y respuestas 4xx | 0 antes, 0 después |
| carrito tras recargar | conserva el pedido en los 8 recorridos, antes y después |

El recorrido capturado es el que pide el encargo: inicio → historias →
categoría → catálogo → búsqueda con y sin resultados → ficha → agregar (en el
instante del toque y 1,6 s después) → carrito → volver → recargar.

Las capturas viven fuera del repositorio, en la carpeta de artefactos de este
encargo (`artifacts/taba2-catalog-premium/capturas/`, ramas `antes/` y
`despues/`), con la misma estructura `motor/ancho/NN-paso.png` para poder
abrirlas en paralelo. El arnés que las produce está versionado junto a los
artefactos, no acá: el repo no versiona imágenes de QA.

Un número más, del mismo arnés: la home completa pasó de 2.978 px a 2.500 px de
alto a 320 (−16 %), y de 2.994 a 2.548 a 390. Mismo contenido, menos recorrido.

Pruebas nuevas: `tests/cart.test.mjs` (criterio de línea no pedible y ajuste de
cantidad) y `tests/home-hero-preload.test.mjs` (las tres declaraciones del hero
coinciden y la derivada pesa lo que tiene que pesar).

Specs actualizadas, con el motivo en el propio archivo:
`taba2-brand-home.spec.mjs`, `taba2-commercial-p1-closure.spec.mjs`,
`approved-beverage-demo.spec.mjs`, `taba2-unit-catalog.spec.mjs`.

La spec del hero cambió de contrato: antes fijaba «el hero va último», que era
la decisión anterior. Ahora fija algo más fuerte y medible: **el hero no puede
empujar el precio ni el «Agregar» abajo del pliegue útil**.

---

## Conflictos potenciales con la rama de tracking

Medido, no supuesto. `feature/taba2-live-tracking-production-ux` toca
`index.html`, `js/ui.js`, `sw.js`, `styles/tracking.css`, `js/map/*` y cinco
tests.

Releído al cerrar: esa rama también toca `js/app.js` y
`tests/e2e/direct-ordering-growth.spec.mjs`, que al empezar no tocaba.

- `index.html`, `js/ui.js` y `js/app.js`: **regiones distintas** (home,
  catálogo y carrito contra seguimiento y mapa). En `js/app.js` esta rama toca
  tres manejadores del delegado de clicks —abrir historias, agregar al carrito
  y la salida del aviso de línea— y ninguno es de tracking. Conflicto textual
  posible, semántico ninguno.
- `sw.js`, `styles/tracking.css`, `js/map/*`: **esta rama no los toca**.

**Tarea de integración, deliberadamente no hecha acá**: bumpear la caché del
service worker y el `?v=` de los assets. Las dos ramas cambian CSS y las dos
tendrían que editar la misma línea; hacerlo por separado garantiza un
conflicto. Sin ese bump, un cliente con la app instalada puede quedarse con el
CSS viejo.

---

## Lo que no se tocó

Tracking, mapa, MapLibre, GPS, follow-mode, Rider, ARCA, WhatsApp, producción,
LT-0030, el Moto G15 (su lock estuvo ajeno y activo todo el encargo) y staging
(su lock también). Ningún dato inventado: precios, fotos y promociones salen
del catálogo y del contrato de promociones, como antes.
