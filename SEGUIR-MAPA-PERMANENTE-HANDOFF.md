# «Seguir» como mapa permanente

Rama `feature/taba2-tracking-always-on-map`, en su propio worktree, sobre
`eda13f8` (`release/taba2-pilot-rc2-operational`, la punta que hoy sirve staging
tras el deployment `c184ffb6`). Sin push, sin producción, sin migraciones, sin
tocar el Rider Android y sin tocar precisión, redondeo ni GPS.

> Integrada en `feature/taba2-commercial-production-hardening` junto con el
> endurecimiento comercial del storefront. Las dos rutas locales que este
> documento citaba se reemplazaron por su ruta relativa: la higiene de release
> no admite rutas de disco en archivos versionados.

## Qué cambió, en una frase

El mapa del cliente dejó de ser algo que aparece cuando hay un rider que
dibujar, y pasó a ser **la superficie de la sección**: existe siempre, y lo que
cambia entre estados son sus capas.

## Antes y después, medido

`.local-staging/probe/audit-states.mjs` recorre el flujo real de la demo y mide
el DOM en cada estado. El **mismo** arnés se corrió contra los dos árboles —el
de la base por HTTP en un puerto aparte—, así que la comparación es directa.

**Base `eda13f8`, 390 px:**

| Estado | Mapa | Local | Destino | Rider | Recentrar | Barra |
|---|---|---|---|---|---|---|
| Sin pedido | **NO** | – | – | – | – | **NO** |
| Preparando | **NO** | – | – | – | – | **NO** |
| Rider asignado | **NO** | – | – | – | – | **NO** |
| En camino | sí | 1 | 1 | 1 | 1 | **NO** |
| Recarga | sí | 1 | 1 | 1 | 1 | **NO** |
| Señal perdida | sí | 1 | 1 | 1 | 1 | **NO** |
| Entregado | **NO** | – | – | – | – | **NO** |

El mapa existía en **2 de 7** estados; la barra inferior, en **0 de 7**.

**Esta rama**, a 320 / 360 / 390 / 432 px en Chromium y WebKit — 28 estados por
motor, **0 hallazgos** (sin overflow, sin errores de consola, sin 4xx, sin HTML
crudo, sin píldoras que anuncien fallas inexistentes):

| Estado | Mapa | Local | Destino | Rider | Recentrar | Barra |
|---|---|---|---|---|---|---|
| Sin pedido | sí | 1 | 0 | 0 | 0 | sí |
| Preparando | sí | 1 | 1 | 0 | 0 | sí |
| Rider asignado | sí | 1 | 1 | 0 | 0 | sí |
| En camino | sí | 1\* | 1 | 1 | 1 | sí |
| Recarga | sí | 1\* | 1 | 1 | 1 | sí |
| Señal perdida | sí | **0** | 1 | 1 | 1 | sí |
| Entregado | sí | 1 | 1 | **0** | 0 | sí |

\* En la demo, «en camino» corre sobre el **recorrido de muestra** de la
sandbox, cuya geometría declarada es local → ruta → destino: borrar el origen
dejaría una línea que empieza en la nada. En el camino **productivo** el pin del
local sí se retira cuando el rider sale, y eso lo demuestra «señal perdida», que
cae a ese camino y mide `local = 0`.

Capturas en `artifacts/taba2-seguir-mapa-permanente/{antes,despues}/`:
7 estados × 4 anchos por lado, con el mismo arnés
(`scripts/taba2-tracking-screenshots.mjs`, al que se le agregó el estado
`7-entregado` y se lo hizo tolerar los dos nombres del estado sin pedido para
poder capturar los dos árboles). El pase `AUDIT=1` sobre el después da **0
hallazgos** de overflow, objetivo táctil y superficie en los 28 estados.

## Las decisiones

### El mapa no se desmonta entre estados

`renderWithStableRealMap` ataba la identidad del lienzo al **pedido**. Pasar de
«sin pedido» a «preparando» tiraba el mapa y montaba otro: parpadeo, encuadre
perdido y tiles pedidos de nuevo. Ahora la superficie del cliente se resuelve
con `acrossOrders: true`, que ignora el pedido pero **nunca** el origen de los
datos —un mapa sandbox se monta con otra geometría y sí merece lienzo propio— y
copia encima los atributos de identidad del render nuevo.

Del lado del adaptador, los pines dejaron de fijarse al montar: `updatePlaces()`
agrega, mueve y **retira** marcadores sobre el mapa vivo, y `clearRider()` se
lleva el marcador, su halo de precisión y el motor de movimiento cuando el
pedido termina. El test «el pedido avanza cambiando capas: el mapa se monta UNA
vez» lo fija contando `calls.maps.length === 1` a lo largo de las tres
transiciones.

### El encuadre

- **Sin pedido**: sobre el local, a zoom 13,4, donde se reconoce el barrio. Se
  probó encuadrar el área de reparto completa y en 344 px entran Neuquén y
  Cipolletti enteras: el pin queda del tamaño de un alfiler. El área operativa
  quedó como respaldo para cuando el local **no** es ploteable.
- **Con pedido y sin rider**: encuadra **local y destino juntos**. Centrar en el
  local a zoom fijo dejaba el destino fuera de pantalla —medido: 1 km entre los
  dos puntos contra ~500 m de ancho visible—, así que el pin existía y no se
  veía. Se reaplica sólo cuando ese par CAMBIA; hacerlo en cada render pisaría
  el gesto del cliente cada pocos segundos.
- **Con rider**: manda el seguimiento, como antes.

### El pin del cliente es el punto de entrega, no la persona

Sin cambios de contrato: sigue saliendo de `plottableDeliveryPoint`, que exige
las tres piezas de `DELIVERY_LOCATION_REQUIRED` (coordenadas, origen declarado y
momento de confirmación). Se agregó una sola regla: **un pedido cancelado no
dibuja destino**, porque no hay entrega que apuntar. Visualmente ya estaban
separados —destino rojo TABA con glifo blanco, local blanco con filete dorado,
rider casco— y eso no se tocó.

### La barra inferior se queda (Misión 4)

**El hallazgo de Gemini está confirmado, y era peor de lo que parecía.**
`styles/responsive.css` ocultaba `.mobile-nav` en cuanto la vista montaba el
seguimiento premium, en todo ancho ≤ 820 px. La única salida en el teléfono era
tocar el nombre del comercio en el topbar —un wordmark que no se lee como
control—, porque el hamburguesa de `.tracking-brand-row` está colapsado a `0×0`
en este layout. Cualquier otro destino obligaba a pasar por el inicio.

Se decidió **mantener la barra**: «Seguir» ya no es una pantalla a la que se
entra con un pedido en curso, es una sección permanente, par de Catálogo,
Carrito y Perfil. La reserva no la pone `main` —que sigue en 0 para esta vista—
sino la propia sección, con `--taba-bottom-nav-clearance`, el mismo token que
usan las demás. `la-taba.spec.mjs` ahora prueba la salida de verdad: entra a
«Seguir» por la barra y sale por la barra, y mide en píxeles que la barra no
tape el final del contenido.

### Estados de fallo (Misión 6)

- **Sin pedido**: la píldora dice «La Taba 2» en vez de «Ubicación temporalmente
  no disponible», que era una frase de error prestada de otro estado.
- **Entregado**: mismo arreglo. Anunciar «ubicación no disponible» sobre un
  pedido ya entregado es inventar un problema encima de un final feliz. En el
  seguimiento del cliente, cuando no hay rider la píldora describe **qué es**
  este mapa; el porqué, cuando hace falta, lo explica la tarjeta de espera, que
  es su lugar. La vista del Rider conserva su copy.
- **Controles sin función**: recentrar y «Volver al Rider» sólo se dibujan
  cuando hay rider. Antes aparecían en preparando, asignado y entregado, donde
  `recenter()` no tiene objetivo y devuelve `false` sin hacer nada.
- **Mapa que no puede dibujarse**: verificado apagando WebGL
  (`.local-staging/probe/probe-nowebgl.mjs`). El lienzo se oculta, el respaldo
  se ve, la barra sigue, no hay overflow ni errores, y **el texto es el del
  estado**: sin pedido dice «Mapa no disponible por ahora. Vas a poder seguir tu
  pedido igual desde acá», no la promesa de seguir actualizando un pedido que no
  existe. Para eso el adaptador ahora respeta la copia que declara la vista
  (`data-map-fallback-copy`) y conserva la de siempre si no hay ninguna.
- **Token vencido / cierre en falso**: vuelve al mapa sin pedido, sin marcador
  de rider, sin `data-order-id` y sin código de entrega.

## Contratos que cambiaron a propósito

Seis suites afirmaban, de una forma u otra, que **sin GPS real no hay mapa**.
Ése era el mecanismo con el que se garantizaba la honestidad, y es justo el
modelo que este encargo invierte. Se actualizaron conservando —y en varios casos
reforzando— lo que protegían: el mapa está, pero sólo puede contener geografía
publicada.

| Suite | Antes | Ahora |
|---|---|---|
| `tracking-terminal-visibility.test.mjs` | «la pantalla final oculta el mapa» | «al terminar desaparece el **rider**, no el mapa», anclado en `ui.js`, en el guard de `map_view.js` y en `clearRider()` |
| `tracking-terminal-expiry.spec.mjs` | mapa en 0 | mapa presente **+** rider 0, `data-order-id` 0, código 0 |
| `operational-hardening.spec.mjs` | mapa en 0 tras `?reset=1` | mapa en modo `idle` **+** rider 0 |
| `honest-map.spec.mjs` | mapa en 0 | mapa en 1 **+** rider 0, ruta 0, `data-map-source="sandbox"` 0, `data-route-source` 0 |
| `la-taba.spec.mjs` | mapa 0; barra oculta | mapa 1, rider 0; barra visible y salida probada |
| `showcase-map-lifecycle.spec.mjs` | entregado desmonta el mapa | entregado conserva mapa; sigue habiendo **uno solo** vivo |
| `showcase.spec.mjs`, `delivery-proof.spec.mjs`, `direct-ordering-growth.spec.mjs`, `business-setup.spec.mjs`, `realtime.spec.mjs` | mapa en 0 | mapa en 1 **+** rider 0 |

El estado sin pedido pasó de `data-tracking-status="empty"` a `"idle"`, y su
encabezado de «Todavía no hay un pedido en curso» a «Seguí tu pedido».

## Gates

| Gate | Resultado |
|---|---|
| `npm run check` | verde (sintaxis, assets, higiene de release, contrato de ubicación) |
| `npm test` | **1317 / 1317** (1301 de base + 16 nuevos) |
| `npx playwright test` (Chromium + mobile WebKit) | **243 / 243** |
| Auditoría de estados, Chromium, 320/360/390/432 | 28 estados, **0 hallazgos** |
| Auditoría de estados, WebKit, 320/360/390/432 | 28 estados, **0 hallazgos** |
| Capturas con `AUDIT=1` (overflow, táctil, superficies) | 28 estados, **0 hallazgos** |
| Mapa sin WebGL, sin pedido | respaldo visible con la copia de SU estado, barra presente, 0 errores |

Una corrida intermedia tuvo 12 rojos: diez eran los contratos que este encargo
invierte —ya actualizados— y dos resultaron inestabilidad ajena
(`business-intake-reliability`, un contador de alertas en un arnés aislado sin
mapa ni navegación; y `delivery-location-confirmation` en WebKit, la hidratación
del perfil). Los dos pasan aislados **contra la base y contra la rama**, y los
dos pasan en la corrida final completa. No quedan rojos sin explicar.

## Deuda y límites

- **El pedido entregado no se va solo.** En producción el token vence y la
  limpieza lo saca del estado, y ahí vuelve el mapa sin pedido — cubierto por el
  e2e de expiración. Un pedido `delivered` local se queda en la lista, así que
  en la demo la sección no vuelve sola a idle. **No se agregó un temporizador**:
  esconder el pedido le sacaría al cliente el resumen de su propia compra, y eso
  es una decisión de producto.
- **El seguimiento sigue clavado en el último pedido del navegador.**
  `persistActiveOrderId` sigue sin llamador. Es el defecto de RC2 ya
  documentado; este encargo no lo toca y no lo empeora.
- **Diferencia de motor en «señal perdida» de la demo.** En Chromium el marcador
  sobrevive al fix viejo; en WebKit el arnés no llega a envejecerlo y la vista
  queda sin rider —con el mapa puesto y «Ubicación no disponible» escrito, que
  es lo correcto para ese estado—. **Ya existía en la base**, donde ese mismo
  estado directamente no tenía mapa. No es del camino productivo: con un fix de
  GPS real, `probe-stale.mjs` mide `rider: 1` con `freshness: lost` en los dos
  motores.
- **El arnés de capturas no maneja WebKit en esta máquina.** `page.goto` con
  `waitUntil: 'domcontentloaded'` expira. Se reprodujo **idéntico contra
  `eda13f8`**, así que es previo. La cobertura WebKit real la dan
  `audit-states.mjs` (28 estados, 0 hallazgos) y el proyecto `mobile-webkit` de
  la suite.
- **Los mapas de más cuestan tiles.** La rama monta MapLibre en muchos más
  estados de la suite, y el estilo sale de `tiles.openfreemap.org`. Corriendo
  ocho specs pesados de mapa seguidos se vio `initial-style-timeout` y fallos
  que no se reproducen aislados ni en la suite completa. No cambia el producto,
  pero conviene saberlo antes de leer un rojo de CI como una regresión.
- Los arneses viven en `.local-staging/probe/` —ignorado por git— y **no** en
  `test-results/`, que Playwright vacía al arrancar.
