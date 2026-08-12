# P1 · La tienda volvía sin estilos al regresar de Mercado Pago

Estado: **corregido y medido en los dos motores. Sin publicar.**
Base: `1d26c4b` (lo servido en staging) es ancestro del HEAD de esta rama; los
commits intermedios son documentación y scripts, así que el cliente de este
worktree es byte a byte el que está publicado.

## El defecto, como lo vive una persona

Tienda → carrito → checkout → elegir Mercado Pago → salir → volver con «atrás»
para cambiar el medio de pago. La página volvía con el HTML entero y sin la
tienda: fondo blanco, sin la identidad negro/rojo, pills grises, iconos y
carrito sobredimensionados, la barra inferior despegada del borde.

## Lo que se midió, antes y después

Mismo teléfono simulado (WebKit, iPhone 13), misma secuencia, caché del worker
caliente con 167 entradas y `styles.css` guardado:

| | antes de salir | al volver (antes) | al volver (después) |
|---|---|---|---|
| `body` background | `rgb(9,11,14)` | `rgba(0,0,0,0)` | `rgb(9,11,14)` |
| `styles.css` | 13/13 `@import` | **0 reglas, 0 `@import`** | 13/13 `@import` |
| `.mobile-nav` | `fixed` | `static` | `fixed` |
| icono de la barra | 21 px | **55 px** | 21 px |
| `.brand` | 90 px | **154 px** | 90 px |
| `scrollWidth` | 390 | **424** sobre 390 | 390 |
| shell / productos | sí / 79 | sí / 79 | sí / 79 |
| carrito | 2 | 2 | 2 |

El `<link>` seguía en su lugar y `link.sheet` existía. Lo que no había eran
reglas: por eso ningún `toBeVisible` veía nada raro.

Capturas de la secuencia completa en `.taba-evidencia/mp-back-navigation/`
(directorio ignorado por git): `ANTES-back-css503.png` es exactamente la
pantalla reportada; `DESPUES-back-css503.png` es la tienda intacta.

## La causa raíz

El `fetch` del service worker era red-primero con respaldo en caché, pero el
respaldo vivía dentro de un `catch`, y un `catch` sólo corre cuando la red
**rechaza**. Un 503 del borde, un 404 de un despliegue a medio publicar y la
página de un portal cautivo con estado 200 son promesas **resueltas**: el worker
las devolvía tal cual —una página de error servida como hoja de estilos— con la
copia buena guardada al lado.

`styles.css` es una cadena de trece `@import`, así que perderlo no degrada la
tienda: la apaga entera.

## Por qué justo al volver de Mercado Pago

Medido en WebKit: esa vuelta es `back_forward` con `persisted=false`. La página
tiene realtime abierto, así que **no entra al back-forward cache**; el documento
se rearma completo y vuelve a pedir sus ~120 subrecursos de una sola vez, en el
mismo instante en que el teléfono retoma la red desde otra aplicación. Es el
único momento del flujo comercial donde eso ocurre.

No fue el BFCache, ni el router, ni una mezcla de versiones: se probaron y
sobreviven. Un despliegue nuevo aterrizando mientras el cliente está afuera
(worker nuevo, `activate` borrando la caché anterior, `clients.claim()` tomando
la pestaña que se está armando) también sobrevive.

## Por qué ningún test lo veía

`playwright.config.mjs` corre con `serviceWorkers: 'block'`. El gate entero
nunca ejerció el worker, que es justamente quien decidía qué recibía el
documento.

## El arreglo

`sw.js` — una respuesta que la red contestó pero contestó mal ya no llega al
documento si hay copia guardada. Y un 200 cuyo tipo declarado contradice lo que
el documento pidió (HTML donde va CSS o un módulo) no pasa **ni se guarda**:
cachearlo dejaba al cliente roto hasta la próxima publicación.

Cada rama nueva termina en `|| response`: cuando no hay nada mejor que ofrecer,
el cliente recibe exactamente lo que recibía antes. El arreglo no puede devolver
algo peor que la versión que reemplaza.

**No hay ningún `window.location.reload()` nuevo.** No hizo falta: el documento
que devuelve WebKit es perfectamente recuperable, lo que estaba roto era lo que
el worker le entregaba. `CACHE_NAME` sigue en v61 a propósito —los assets no
cambiaron—, así que `activate` no borra nada y no hay ventana con la caché
vacía.

### Cuándo llega el arreglo a un cliente que ya usó la tienda

El arreglo vive en el worker, así que **rige recién cuando el worker nuevo
activa**. Un cliente que ya tiene la PWA abierta sigue con el worker viejo hasta
que acepte «Actualizar ahora» o cierre todas sus pestañas. Es el mismo camino de
cualquier publicación —no hay nada especial que hacer—, pero conviene saberlo:
durante las primeras horas después de publicar puede quedar alguien con el
comportamiento anterior, y eso no significa que el arreglo no esté.

## Estado del checkout

Verificado en las nueve pruebas nuevas: al volver, el carrito queda idéntico
(mismos productos y cantidades), la dirección del perfil intacta, el formulario
visible y la forma de pago se puede cambiar. No se crea pedido, no se crea pago,
no se pierde la sesión anónima. Los cuatro retornos de Mercado Pago —cancelado,
pendiente, rechazado, aprobado— no desvían el router ni tocan el carrito por sí
solos: la autoridad del pago sigue siendo el backend.

## Cobertura nueva

- `tests/service-worker-degraded-edge.test.mjs` — 17 pruebas de comportamiento
  del handler, no de la forma del fuente. Contra el `sw.js` anterior fallan 7 y
  pasan las que fijan lo que no debía cambiar.
- `tests/e2e/mp-back-navigation-ui.spec.mjs` — 9 pruebas del recorrido humano
  con service workers habilitados, en **Chromium y WebKit**, midiendo geometría
  y color computados. Contra el `sw.js` anterior fallan las 3 centrales.
- `scripts/realtime-relay.mjs` — `/__edge-fault`, sólo para el gate. Hace falta
  porque los `fetch` de un worker no pasan por `page.route()`: sin un servidor
  que pueda contestar mal, esto no se reproduce de forma automática.

## Suite

| | resultado |
|---|---|
| `npm run check` | **5 / 5** |
| `npm test` | **1341 / 1341** |
| Playwright Chromium | **255 / 255** |
| Playwright mobile-webkit | **28 / 28** |

`check-release-hygiene` marcaba 19 hallazgos `local-drive-path` que eran
**anteriores a este trabajo**: reproducidos sobre `e2890be` en un worktree
aparte dan los mismos 19, y el diff contra la lista del HEAD del P1 es vacío.
Se limpiaron en un commit de higiene **separado** (`5a7d4e5`), reemplazando las
rutas de una máquina por los marcadores que el repo ya usaba. Sólo
documentación: los siete archivos son `.md` y no se tocó una línea de producto.

## El contrato del service worker, caso por caso

| lo que devuelve el borde | con copia guardada | sin copia guardada |
|---|---|---|
| **404** | la copia guardada | ese 404, y no se guarda nada |
| **5xx** (500, 503, 403…) | la copia guardada | ese error, y no se guarda nada |
| **la red RECHAZA** | la copia guardada | `Response.error()`; sólo una navegación recibe `index.html` |
| **200 con tipo incompatible** (HTML por CSS o por JS) | la copia guardada | esa respuesta, y **no se guarda** |
| **200 sano** | gana la red y se guarda | gana la red y se guarda |

`response.ok` no alcanza para el portal cautivo: contesta **200**, así que sin
el control de tipo se habría cacheado y el cliente arrastraría esa página como
hoja de estilos hasta la próxima publicación. El control alcanza a `style` y
`script`; una imagen o un `fetch()` del propio cliente —`destination` vacío—
siguen con el contrato de siempre.

**Límite conocido:** se contrasta el tipo **declarado**, no el cuerpo. Un borde
que además mienta en el `content-type` —HTML servido como `text/css`— pasa. Está
fijado con un test que lo dice, para que nadie suponga una cobertura que no
existe.

## Lo que esto NO prueba

No se puede probar desde acá **cuál** fue la respuesta degradada exacta que
recibió el iPhone de la persona. Lo que sí está probado es que el cliente tenía
un agujero que convierte cualquier respuesta contestada-pero-mala en exactamente
la pantalla reportada, que el retorno desde Mercado Pago es el momento del flujo
donde eso se dispara, y que el agujero está cerrado.

Por eso queda un gate humano corto, en un iPhone real contra staging, después de
publicar:

1. Entrar, agregar dos productos, ir al checkout.
2. Elegir Mercado Pago y salir.
3. Volver con «atrás».
4. Mirar: fondo negro con la marca roja, barra inferior pegada al borde, iconos
   a escala, sin franja horizontal de más.
5. Confirmar que el carrito sigue con lo mismo y que se puede elegir otro medio.

## Observación que no se tocó

`styles.css` sirve trece hojas encadenadas por `@import`. Funciona, y ahora está
respaldado, pero concentra toda la presentación en un único recurso cuyo fallo
apaga la tienda entera. Cambiar eso es un trabajo aparte, no de este P1.
