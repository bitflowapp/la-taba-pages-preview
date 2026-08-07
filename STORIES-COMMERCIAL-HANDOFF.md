# STORIES-COMMERCIAL-HANDOFF — TABA2, las historias como canal comercial

Worktree `la-taba2-commercial-stories` · Rama `feature/taba2-commercial-stories`

| | |
| --- | --- |
| Base | `55093e0` — HEAD de `release/taba2-pilot-rc` |
| Alcance | Historias: contrato, almacén, Panel (Marketing → Historias), visor, analítica, +18 |
| Deploy | **Ninguno.** Sin push, sin `amend`, `reset`, `clean`, `stash` ni `git add .` |
| Backend | **Sin tocar.** Cero migraciones nuevas, cero Edge Functions, cero mutaciones en staging |

---

## 1. Qué base se eligió y por qué

La consigna pedía "la RC visual más reciente". Hay cuatro ramas `release/*` vivas y **dos líneas
divergentes** desde `6294a98`:

| Rama | Fecha | Qué integra | ¿Trae el pulido visual? |
| --- | --- | --- | :-: |
| `release/taba2-first-physical-e2e` | 07/08 14:57 | E2E físico + Panel endurecido + mapa nocturno | **no** |
| `release/taba2-pilot-integration` | 07/08 01:06 | Contrato de combos server-side | no |
| **`release/taba2-pilot-rc`** | **06/08 21:57** | **Pedidos reales + `feature/taba2-fable-visual-polish`** | **sí** |
| `release/taba2-e2e-test-staging-rc` | 06/08 15:40 | Base común | no |

`release/taba2-first-physical-e2e` es más nueva **en el tiempo**, pero no contiene los 11 commits
del pulido visual de Fable —el buscador de una sola superficie, el favorito sobre el plato blanco,
el toast sobre la navegación, la nota del mínimo de delivery—. Medido, no recordado:

```
git log --oneline feature/taba2-fable-visual-polish --not release/taba2-first-physical-e2e
    → 11 commits
git diff release/taba2-first-physical-e2e release/taba2-pilot-rc -- styles/brand-home.css
    → 43 líneas de diferencia, todas del pulido
```

Las historias viven en **Home y Perfil**, que es exactamente la superficie que ese pulido toca, y la
consigna pide mantener el lenguaje visual premium y revisar esas dos vistas. Construir sobre una
base que no lo tiene habría significado auditar contra un storefront viejo. Por eso la base es
`release/taba2-pilot-rc`: la RC más reciente **de la línea visual**.

**Riesgo declarado:** esta rama no contiene el sistema visual nocturno del mapa
(`feature/taba2-tracking-visual-polish`) ni el endurecimiento del Panel de
`feature/taba2-business-panel-hardening`. Nada de lo que se entrega acá los toca —el trabajo es
Home, Perfil y la sección Marketing del Panel—, pero la integración final tendrá que unir las dos
líneas.

---

## 2. Qué eran las historias y qué son ahora

Antes: una vidriera decorativa con un contrato de UI y sin backend. Cuatro campos útiles, dos CTA
que caían en categorías, y ningún lugar donde el comercio pudiera tocarlas.

Ahora: un canal comercial con **un contrato**, **un almacén**, **una pantalla de administración**,
**seis contadores** y **una regla +18 que no se puede relajar**.

### 2.1 El contrato del registro

`js/core/stories.js`. Es el mismo objeto que escribirá el Panel, que guardará el almacén y que
tendrá que devolver la tabla cuando exista:

| Columna | Qué es | Notas |
| --- | --- | --- |
| `id` | identificador | obligatorio |
| `business_id` | comercio | |
| `title` | título | ≤ 120 caracteres |
| `body` | texto breve | ≤ 220. Sin precios ni porcentajes: el número lo dice el destino |
| `media_type` | `image` \| `video` | cualquier otro valor descarta el registro |
| `media_url` | imagen o video | esquemas `javascript:`/`data:`/`vbscript:`/`file:` rechazados |
| `thumbnail_url` | miniatura | cae en `media_url` si falta |
| `starts_at` | inicio | `null` = ya |
| `expires_at` | expiración | `null` = sin vencimiento |
| `sort_order` | orden | 1, 2, 3… de menor a mayor |
| `cta_type` | acción | `product` \| `combo` \| `buy` \| `category` |
| `cta_target` | destino | **identificador**, no URL (ver §2.3) |
| `age_restricted` | +18 declarado | es un PISO, nunca un techo (§5) |
| `enabled` | activar/desactivar | booleano **estricto**: `"true"` no publica nada |

### 2.2 Las cuatro CTA del brief

| Código del brief | `cta_type` | Etiqueta en el botón | Qué abre |
| --- | --- | --- | --- |
| VER PRODUCTO | `product` | Ver producto | la ficha real del producto |
| VER COMBO | `combo` | Ver combo | la ficha del combo, con su composición derivada |
| COMPRAR | `buy` | Comprar | `addToCart` — el mismo alta que la ficha |
| VER CATEGORÍA | `category` | Ver categoría | el catálogo filtrado por ese rubro |

El código y la etiqueta se declaran por separado a propósito: el lenguaje visual TABA2 escribe en
caja de oración, y una vidriera premium no le grita a quien compra. `Object.values(STORY_CTA_TYPES)
.map(d => d.code)` devuelve exactamente los cuatro nombres del brief, y hay un test que lo fija.

Los nombres del contrato anterior (`offer`, `add_to_cart`, `add`) se **traducen**, no se rompen.

### 2.3 El destino abre contenido real, y no puede no hacerlo

Tres candados, en capas:

1. **Alfabeto.** `cta_target` sólo acepta `[A-Za-z0-9._-]{1,80}`. Por construcción no existe un
   destino que pueda ser `javascript:`, una ruta absoluta o un host externo. Es más fuerte que una
   lista negra de esquemas porque no hay nada que mantener.
2. **El formulario no ofrece otra cosa.** `storyDestinationOptions()` arma los `<select>` con
   productos comprables, combos con precio y stock, y rubros con al menos un producto comprable. No
   hay campo de texto libre para el destino.
3. **La vidriera revalida en cada render.** `storyPublishability()` apaga la historia cuyo destino
   dejó de tener precio o stock. Nadie tiene que acordarse de nada: **reaparece sola** cuando el
   local vuelve a publicar el precio.

Los tres viven en `js/core/story-destination.js`, que es el único lugar que resuelve destinos de
historia. `js/core/purchasable-destination.js` conserva el hero y los banners; su traductor de
historias se retiró para no tener dos módulos decidiendo lo mismo con reglas distintas.

**No se inventó ni un precio ni una promoción.** Una historia no guarda precio, ni ahorro, ni
"quedan 3": guarda a qué apunta, y todo lo demás se deriva del catálogo vivo cada vez que se
pregunta. Es la misma decisión que ya toma `core/combos.js`.

---

## 3. Los cuatro estados, y por qué son derivados

`BORRADOR` · `PROGRAMADA` · `ACTIVA` · `FINALIZADA`.

**No se guardan.** Se calculan contra el reloj cada vez que se pregunta:

```
1. apagada          → BORRADOR     (nunca salió; su ventana es irrelevante)
2. venció           → FINALIZADA   (salió y terminó)
3. todavía no llega → PROGRAMADA
4. resto            → ACTIVA
```

Un estado guardado envejece en silencio —una historia "ACTIVA" en la base que venció hace tres
días— y eso es exactamente lo que hace que una historia vencida **no** desaparezca sola. Con la
derivación, la consigna "una historia vencida debe desaparecer sola" no necesita ni un cron ni un
botón: el único que la apaga es el paso del tiempo. Fijado con `now` inyectado:

```
publishedStories([{ …, expires_at: '2026-08-07T12:00:00Z' }], { now: …11:59:59Z }).length → 1
publishedStories([… mismo registro …],                        { now: …12:00:00Z }).length → 0
```

Sólo `ACTIVA` llega a la vidriera. El Panel ve las cuatro.

---

## 4. Panel → Marketing → Historias

`js/business/business-stories-panel.js` (render puro) + el despacho en `js/business.js`.

Ocho verbos, ni uno más:

| Verbo | Cómo | Detalle |
| --- | --- | --- |
| crear | "Nueva historia" | nace apagada: BORRADOR |
| editar | "Editar" en la fila | conserva la posición: cambiar el título no reordena la vidriera |
| preview | "Vista previa" | abre el **visor real**, no una maqueta (§4.2) |
| activar/desactivar | "Activar"/"Desactivar" | valida antes de encender (§4.1) |
| programar | inicio y expiración | `datetime-local`, hora local |
| ordenar | ↑ / ↓ | dos botones de 44 px, no arrastrar (§4.3) |
| eliminar | dos pasos | el primer toque arma la confirmación, el segundo borra |
| ver estado | chip por fila + resumen | los cuatro estados con su explicación en el idioma del local |

### 4.1 Qué se valida, y cuándo

Sólo al **activar**, nunca al guardar: un borrador incompleto tiene que poder guardarse a medias
—para eso existe BORRADOR—. Lo que no puede pasar es que una historia incompleta llegue a la
vidriera. Se exige: medio propio (el marcador de posición del borrador no alcanza), título, ventana
coherente (`expires_at > starts_at`) y destino comprable si declara CTA.

### 4.2 La vista previa abre el visor de verdad

Enseñar una maqueta aparte garantiza que algún día deje de parecerse a lo que ve la clientela. La
previsualización monta la historia en el visor real —incluso si es BORRADOR o PROGRAMADA— y **no
toca ni las métricas ni el registro de vistas**: medir la propia previsualización del comercio
ensuciaría el único número que el Panel tiene para decidir. Verificado en E2E: después de
previsualizar, `la_taba_story_metrics_v1` y `la_taba_stories_seen_v1` siguen sin existir.

### 4.3 El orden se mueve con botones

Arrastrar en una pantalla de 320 px con una mano ocupada es la interacción que primero se rompe.
Dos botones de 44 px funcionan con el pulgar, con teclado y con lector de pantalla sin ninguna
adaptación. Los extremos se **deshabilitan** en vez de no hacer nada al tocarlos.

### 4.4 Dónde vive el Panel, y la limitación que eso trae

Marketing → Historias vive en el **Panel sandbox** (`js/business.js`), junto a Catálogo,
Promociones, Reportes, Configuración y Guía, que es donde vive toda la administración comercial no
operativa. El Panel productivo (`js/production-operations.js`) es enteramente operativo —apertura
del día, pedidos, pagos, packing, mostrador, escáner, inventario, fiscal, cierre—, con autorización
por rol y contra Supabase. Agregarle una vista habría sido tocar contratos operativos, que la
consigna prohíbe explícitamente.

**Consecuencia, dicha en el propio Panel y no escondida acá:** las historias se guardan **en este
dispositivo** hasta que el backend publique la tabla. Lo que se carga en un teléfono no aparece en
otro. Es el P1 de §9.

---

## 5. +18: la declaración es un piso, nunca un techo

La restricción de edad **se deriva del destino real** y la declaración del formulario sólo puede
sumarse a ella:

| Destino | Declarado | Resultado | Por qué |
| --- | --- | --- | --- |
| producto alcohólico | `false` | **+18** | el catálogo gana sobre la declaración |
| producto sin alcohol | `true` | **+18** | la pieza puede mostrar alcohol aunque el destino no lo sea |
| rubro 100 % alcohólico | — | **+18** | "cervezas", "whisky" |
| rubro mixto | — | sin aviso | el aviso pierde sentido donde no corresponde; el control real sigue en la ficha y en el carrito |

`minimumAge` nunca baja de 18 y respeta un valor mayor declarado por el catálogo.

**No se creó ningún camino nuevo.** "Comprar" llama al **mismo** `addToCart` que la ficha del
producto, así que hereda entera la validación del catálogo —stock, disponibilidad, precio
confirmado— y la puerta +18 sigue siendo la del carrito. Verificado en E2E: comprar alcohol desde
una historia deja el carrito con la confirmación de edad **visible y sin marcar**, exactamente como
si se hubiera agregado desde la góndola.

En el Panel, cuando el +18 lo impone el catálogo la casilla queda **marcada y deshabilitada**, con
el motivo escrito ("Lo impone el catálogo: el destino es alcohólico. No se puede desmarcar."), y el
valor derivado se **guarda** en el registro para que no dependa de que alguien lo vuelva a derivar.

---

## 6. Analítica: seis contadores y ninguna persona adentro

`js/core/story-analytics.js`.

| Evento | Cuándo |
| --- | --- |
| `impression` | la historia se mostró en el visor |
| `open` | alguien abrió el visor |
| `advance` | pasó de esa historia a la siguiente |
| `cta` | tocó el botón |
| `product_open` | la CTA abrió la ficha de un producto o de un combo |
| `add_to_cart` | la CTA agregó el producto al carrito, **y el carrito lo aceptó** |

Lo que **no** se guarda, y no por olvido: identificador de persona, de sesión o de dispositivo;
dirección; teléfono; carrito; pedido; user agent; IP; y **ninguna marca de tiempo por evento**. Un
contador no distingue a nadie; una secuencia de timestamps sí, así que no existe. El único dato
temporal es el **día** en que el almacén empezó a contar, a nivel colección.

**Lo que no se mide, y por eso no se nombra: la COMPRA.** El pedido lo cierra el backend y no vuelve
marcado con la historia que lo originó. Llamar "conversión" a `add_to_cart` sería ponerle nombre de
venta a un agregado al carrito. El Panel dice "Agregado al carrito" y ahí termina la cadena
medible; no publica ninguna tasa. Hay un test E2E que falla si aparece un porcentaje en la fila de
métricas o una tasa de conversión en la pantalla.

Detalles que importan:

- **Una impresión por apertura, no por repintado.** El visor se repinta al avanzar y al cambiar el
  catálogo; contar cada repintado inflaría el número hasta volverlo inútil.
- **`add_to_cart` sólo cuenta el alta aceptada.** Contar el intento fallido convertiría un "sin
  stock" en una métrica de venta.
- **Cota dura de 300 historias**, descartando las de menos actividad: perder el registro de la que
  nadie miró cuesta menos que perder el de la que se está midiendo.
- Eliminar una historia **se lleva sus contadores**.

---

## 7. El visor

`js/ui.js`. Lenguaje visual premium TABA2 intacto: superficie grafito, aro dorado, tipografía y
radios de la identidad.

- **Barra de progreso** con relleno animado en dorado —el final del degradado del aro—. Con
  `prefers-reduced-motion: reduce` el segmento se pinta entero y no cuenta el tiempo.
- **Avance automático** de 5 s para imágenes; el video avanza al terminar. No corre con movimiento
  reducido, con la pestaña oculta, en la última historia, ni mientras el foco está dentro del
  cuerpo: si alguien está por tocar "Comprar", el visor no le cambia el botón debajo del dedo.
- **Gestos**: mitad izquierda vuelve, mitad derecha avanza; deslizar horizontal avanza o vuelve. El
  gesto sólo cuenta si el desplazamiento horizontal le gana claramente al vertical, para que un
  pulgar que baja a cerrar no termine avanzando. Las zonas dejan libres los últimos 56 px para que
  tocar la pausa de un video no avance la historia.
- **Teclado**: `←` `→` mueven, `Inicio`/`Fin` saltan a los extremos, `Esc` cierra (nativo del
  `<dialog>`, no se intercepta).
- **Foco**: entra a la tarjeta al abrir; al avanzar **vuelve al mismo control** que se pulsó. Antes
  de esto el foco caía al `<body>` y había que volver a tabular en cada historia. Al cerrar vuelve
  al control que abrió —el de la home o el de Perfil, no siempre el de la home—.
- **Zonas táctiles fuera del árbol de accesibilidad** (`aria-hidden`, sin foco): quien navega con
  teclado o lector usa los botones "Anterior" y "Siguiente", con nombre y estado. Duplicarlas sólo
  agregaría dos paradas mudas.
- **Conexiones lentas**: con `saveData` o `effectiveType` 2g, el video pasa a `preload="none"`. En
  2G un `preload="metadata"` compite con la imagen que la persona está tratando de ver.
- **Abre donde quedó**: en la primera historia sin ver, no siempre en la primera.
- La lista **se congela al abrir**: una historia que vence a mitad de la lectura termina de verse en
  vez de correr los índices debajo del dedo; la próxima apertura ya no la trae.

Home y Perfil comparten el mismo estado: `renderStoryEntry` pinta todos los slots a la vez, así que
el aro, la cuenta de nuevas y la etiqueta no pueden divergir.

---

## 8. Dos defectos encontrados y arreglados

### 8.1 La vidriera del piloto prometía cuatro historias y mostraba dos

Medido sobre el catálogo del piloto, no sobre el fixture: de las cuatro historias sembradas,
**`whisky` y `mixers` estaban enteros en "precio próximamente"**, así que `storyPublishability` las
apagaba y la home mostraba dos. El fail-closed funcionaba; la semilla era la que mentía. El E2E que
supuestamente protegía esto fijaba `2` historias: estaba pinchando el síntoma, no el contrato.

La semilla nueva ejercita **las cuatro CTA, una vez cada una**, contra destinos que existen y son
comprables hoy en la demo: producto (Heineken), combo (Heineken x6), comprar (Monster) y rubro
(energizantes).

Y el arte también tuvo que cambiar. Los dos candidatos que quedaban para el rubro eran:

- `cervezas-patagonia.jpg` — un packshot precioso de una cerveza que en el catálogo del piloto
  **no tiene precio ni stock**. Una historia con esa foto vende algo que el local no puede entregar.
- `cervezas-andes-origen.webp` — no es un packshot: es una **tarjeta de receta de marca con un botón
  "DESCARGUE" impreso adentro**. Un control falso dentro de una superficie táctil, en una vidriera
  donde todo lo demás que parece un botón lo es.

La historia usa el packshot de Red Bull, que es el mismo que ya encabeza el rubro de energizantes en
la home, y los cuatro productos de ese rubro sí se pueden comprar.

*(Observación fuera de alcance, para quien siga: `cervezas-andes-origen.webp` también es el banner
de marca de Andes Origen en `js/ui.js`. Hoy es inerte —el banner sólo se pinta si la marca tiene
producto comprable, y Andes Origen no lo tiene—, pero el día que se publique ese precio va a
aparecer una tarjeta de receta con un botón falso en la home. No se tocó: no es de esta entrega.)*

### 8.2 `normalizeStoryRecord` no sabía leer su propia salida

`normalizeCta` sólo miraba `cta_type`/`ctaType`, nunca `cta.type`. El almacén **re-normaliza sus
propias listas** en cada alta, baja, activación y reordenamiento, así que cada una de esas
operaciones borraba en silencio la CTA de **todas** las historias: se guardaba una vidriera sin un
solo botón y nada fallaba. Apareció al escribir el E2E de compra de alcohol, no en el código.

Arreglado leyendo las tres formas del contrato, y fijado con dos tests: uno de idempotencia pura y
otro que mueve, apaga y borra historias con CTA y verifica que las que quedan la conserven.

---

## 9. Gates

Todos corridos en este worktree, sobre el árbol final.

| Gate | Resultado |
| --- | --- |
| `npm run check` | passed |
| `npm test` | **1089 / 1089** — 1042 de la base + 47 nuevos |
| `npm run test:e2e` | **215 / 215** en la corrida limpia (8,0 min) · ver §9.2 |
| `npm run secrets:scan` | passed |
| `npm run migrations:validate` | revisión estática aprobada (cero migraciones nuevas) |
| `git diff --check` | limpio |
| Auditoría visual Chromium | **84 bloques, 0 hallazgos** |
| Auditoría visual WebKit | **84 bloques, 0 hallazgos** |

`npm run config:check` sigue fallando por `runtime-config.js` vacío. Es heredado y deliberado
(§11.4); esta entrega no lo tocó.

### 9.1 Auditoría visual — 14 vistas × 6 anchos × 2 motores

`WIDTHS=320,375,390,414,432,1280` con `ENGINE=chromium` y `ENGINE=webkit`, sobre el sitio servido
localmente. Mide el color REALMENTE pintado, no el token: contraste WCAG AA, superficies claras
fuera de la identidad, desbordamiento horizontal y objetivos táctiles < 44 px.

| Motor | Bloques | Contraste | Superficie clara | Overflow | Tap |
| --- | :-: | :-: | :-: | :-: | :-: |
| Chromium | 84 | 0 | 0 | 0 | 0 |
| WebKit | 84 | 0 | 0 | 0 | 0 |

El auditor **no miraba el visor de historias**: su selector cubría `.app-view` y `.modal-card`, y la
tarjeta del visor no es ninguna de las dos. Se agregaron tres pasos (`stories`, `stories-last`,
`stories-close`) y la tarjeta al selector, así que los 12 bloques de historias de la tabla —seis
anchos por motor— son superficie nueva que antes no se auditaba. Comprobado que los pasos abren de
verdad el visor: 26 nodos recorridos por tarjeta, CTA pintada y overflow 0 en los dos motores.

El visor en las pantallas más chicas, medido en Chromium y WebKit:

| Ancho × alto | Diálogo | Tarjeta | ¿Desplaza? | CTA sobre el pliegue | Alto de CTA / nav | Overflow X |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 320 × 568 | 544 | 560 | sí, 16 px | **sí** | 44 / 44 | 0 |
| 375 × 667 | 606 | 606 | no | sí | 44 / 44 | 0 |
| 390 × 844 | 687 | 687 | no | sí | 44 / 44 | 0 |
| 1280 × 900 | 713 | 713 | no | sí | 44 / 44 | 0 |

En 320 × 568 la tarjeta desborda 16 px y el diálogo se desplaza, pero **la CTA queda por encima del
pliegue**: no hay que ir a buscar el botón. Es lo que compra el tope `max-height: 46dvh` del medio.

El **Panel** queda fuera del auditor a propósito (es superficie de trabajo, no vidriera), así que
Marketing → Historias se midió aparte, con la lista y con el formulario abierto, en los seis anchos
y los dos motores: **0 desbordamiento horizontal y 0 controles por debajo de 44 px** en las 24
combinaciones.

### 9.2 E2E — qué significa el 215/215, y qué pasa cuando no da

`tests/e2e/commercial-stories.spec.mjs` aporta **11 casos** y pasa 11/11 de forma repetida y aislada.
La suite completa dio **215/215 en verde**. En otras dos corridas de la misma suite falló **un**
caso ajeno (`showcase.spec.mjs › touch-safe`), y la evidencia dice que es del host y no de esta rama:

| Medición | Resultado |
| --- | --- |
| `showcase › touch-safe` aislado, esta rama | 3 / 3 passed |
| `showcase › touch-safe` aislado, base `release/taba2-pilot-rc` | 3 / 3 passed |
| Suite completa, esta rama | 215/215 · 214/215 · 214/215 |
| Suite completa, **base intacta** | **203 / 204** — falla `business-windows-operations`, que en esta rama pasa |
| `sandbox-flow.spec.mjs` aislado, base intacta | **2 / 5** (8,6 min) |
| `sandbox-flow.spec.mjs` aislado, esta rama | 4 / 5 (1,3 min) |

La base intacta también deja un caso rojo por corrida completa, y es **otro** caso cada vez. Es
saturación de la máquina —animación medida a mitad de vuelo, mapa que no llega a `ready`, carrera de
dos pestañas—, no una regresión. El host tenía 2,6 GB de RAM libres y el navegador del usuario
abierto durante estas corridas.

---

## 10. Lo que no se tocó

Pagos, stock, ARCA (`services/arca-fiscal-bridge` sin cambios), Rider y los contratos operativos.
Cero migraciones nuevas, cero Edge Functions, cero mutaciones en `la-taba-staging` ni en producción.
El Panel productivo (`js/production-operations.js`) quedó **intacto**. Ningún dato humano alterado.

Único archivo ajeno al alcance que cambió: `PILOT-RC-HANDOFF.md` línea 291, una ruta de disco local
que hacía fallar `npm run check` en la base heredada. Es exactamente el arreglo que ya hizo
`feature/taba2-pilot-ops` en su propio handoff ("docs(ops): sacar rutas de disco local del
handoff"). Sin ese cambio el gate arranca en rojo por algo que no es de esta entrega.

---

## 11. Riesgos y P1 abiertos

1. **Las historias son locales al dispositivo (P1, bloqueante para operar de verdad).** El backend
   no tiene tabla de historias, así que el Panel escribe en `localStorage`. Un comercio con dos
   teléfonos ve dos vidrieras distintas. El contrato de la tabla es §2.1 y el almacén ya persiste en
   `snake_case` con esas columnas exactas: migrar es cambiar el origen, no reescribir el Panel. El
   global `TABA2_STORIES` sigue ganando siempre, así que el día que el backend publique, el
   dispositivo deja de mandar sin tocar una línea del visor.

2. **Marketing → Historias sólo existe en el Panel sandbox (P1, ligado al anterior).** Ver §4.4. Sin
   tabla no hay nada compartido que administrar desde el Panel productivo, así que los dos P1 se
   cierran juntos.

3. **La base no trae el mapa nocturno ni el Panel endurecido.** Ver §1. Integrable, pero es trabajo
   de integración que esta rama no hizo.

4. **`runtime-config.js` vacío hace fallar `npm run config:check`.** Heredado y deliberado: el
   archivo falla cerrado y la configuración se inyecta en el artefacto de deploy.

5. **El precache del service worker sigue incompleto.** Se cerró **el camino entero de las
   historias** (los cuatro módulos nuevos más `combos.js`, `combos-data.js`,
   `beverage-home-sections.js`, `purchasable-destination.js` y `preview-stories-data.js`, que ya
   faltaban), pero quedan 43 módulos del gráfico sin precachear. Es previo a esta entrega y no rompe
   nada online porque el worker es network-first.

6. **Playwright necesita `npx playwright install`** en un worktree nuevo, y `npm ci`: el worktree
   nace sin `node_modules` y el gate falla por ejecutable ausente, no por regresión.

---

## 12. Archivos

**Nuevos**

```
js/core/story-destination.js          destino real + derivación del +18
js/core/story-store.js                almacén administrable y CRUD puro
js/core/story-analytics.js            seis contadores, sin PII
js/business/business-stories-panel.js render de Marketing → Historias
tests/story-destination.test.mjs
tests/story-store.test.mjs
tests/story-analytics.test.mjs
tests/e2e/commercial-stories.spec.mjs
STORIES-COMMERCIAL-HANDOFF.md
```

**Modificados**

```
js/core/stories.js                    contrato del canal (reescrito)
js/core/purchasable-destination.js    se retira el traductor de historias
js/preview-stories-data.js            semilla con las cuatro CTA y destinos reales
js/ui.js                              visor, entrada, contexto de catálogo
js/app.js                             despacho de las cuatro CTA + analítica
js/business.js                        sección Marketing y su despacho
styles/brand-home.css                 visor premium (progreso, zonas, +18, texto)
styles/business.css                   pantalla de administración
scripts/taba2-commercial-audit.mjs    el auditor ahora entra al visor
index.html · styles.css · sw.js       rotación de caché v47 + precache del canal
tests/stories.test.mjs                contrato nuevo + idempotencia
tests/purchasable-destination.test.mjs
tests/pwa.test.mjs · tests/github-pages.test.mjs · tests/startup-recovery.test.mjs
tests/e2e/ios-blank-screen.spec.mjs   la ruta interceptada fijaba `?v=37`
tests/e2e/taba2-commercial-p1-closure.spec.mjs  fijaba el síntoma (2), no el contrato
.gitignore                            capturas de esta entrega, fuera de Git
PILOT-RC-HANDOFF.md                   ruta de disco local (ver §10)
```

Capturas de revisión humana en `artifacts/stories-commercial/` (fuera de Git, como el resto de los
artefactos visuales del proyecto): el aro en la home, el visor con el aviso +18, el visor del combo
y la pantalla del Panel con la lista y el formulario en 390 y en 320.

---

TABA2_COMMERCIAL_STORIES_READY_FOR_INTEGRATION
