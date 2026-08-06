# Home de marca · La Taba 2

Documento de contrato de la home comercial móvil. Describe qué afirma la
superficie, de dónde sale cada dato y qué hace falta para encender lo que hoy
está apagado.

## 1. Alcance de la superficie

El sistema tiene **dos** superficies y una sola frontera:

```
SHELL      grafito  →  body:not([data-active-view="business"]):not([data-active-view="rider"])
CONTENIDO  crema    →  tarjetas, formularios, hojas y modales del cliente
```

Inicio, catálogo, producto, carrito, checkout, seguimiento y perfil comparten
las dos. Los paneles de **Negocio** y **Repartidor** quedan afuera por
exclusión y conservan exactamente la superficie clara que el RC certificó.

Todo vive en `styles/brand-home.css`, que se importa **después** de
`responsive.css` porque es la última palabra sobre estas vistas.

### Por qué el contenido dejó de ser blanco

El salto que rompía la experiencia no era el fondo —el shell ya era continuo—
sino la **superficie del contenido**: la home mostraba una vidriera y al tocar
"Carrito" aparecía un formulario blanco puro, con otra sombra y otro radio. Se
leía como otra aplicación. Cada hoja elegía además su propio blanco
(`--taba-white` en las tarjetas, `#fffdfb` en la barra, `#fdfcf9` en
seguimiento, `#f7f4ef` en perfil), así que no había una superficie sino cinco.

Perfil fue la primera vista que llegó a la referencia aprobada. Su paleta se
promovió a tokens y hoy la consumen todas: **una** superficie, **un** radio,
**una** sombra.

| Token | Valor | Uso |
| --- | --- | --- |
| `--cream` | `#f7f4ef` | superficie de contenido |
| `--cream-raised` | `#fffdf9` | campo de formulario, fila, chip |
| `--cream-sunken` | `#efeae2` | hueco, separador, hover apagado |
| `--cream-line` | `#e9e3dc` | hairline interno de 1px |
| `--cream-line-strong` | `#d6cec3` | borde que porta información |
| `--cream-ink` | `#22242a` | texto principal (14,4:1) |
| `--cream-muted` | `#62605c` | texto secundario (6,3:1) |
| `--shadow-cream` | `0 10px 34px rgb(0 0 0 / 26%)` | superficie principal |
| `--shadow-cream-flat` | `0 4px 16px rgb(0 0 0 / 18%)` | ítem dentro de un rail |

**El packshot es la excepción y es deliberada.** Los bitmaps del catálogo traen
el fondo blanco horneado —son opacos, sin canal alfa—, así que teñir su caja no
sirve: el propio archivo pinta su rectángulo. En vez de pelear contra el bitmap,
la caja lo asume como **plato blanco** con radio propio y crema alrededor. Se
lee como la bandeja donde se apoya el producto, no como un recorte.

## 2. Tokens

Declarados en `styles/tokens.css` bajo el bloque `MARCA`.

| Token | Valor | Uso |
| --- | --- | --- |
| `--brand-bg` | `#090b0e` | fondo de la home |
| `--brand-bg-raised` | `#111419` | banner, tarjetas de estado |
| `--brand-surface` | `#171a20` | buscador, píldoras, chips |
| `--brand-surface-hover` | `#1e222a` | hover de las anteriores |
| `--brand-border` | `rgb(255 255 255 / 12%)` | hairline sobre oscuro |
| `--brand-ink` | `#f5f5f5` | texto principal (17,9:1) |
| `--brand-ink-muted` | `#a8abb2` | texto secundario (8,5:1) |
| `--brand-red-ink` | `#ff4d55` | **texto** de acción sobre oscuro (6,0:1) |
| `--brand-gold` | `#c9953e` | acento premium (7,3:1) |
| `--brand-story-ring` | conic rojo → naranja → dorado | único degradado de la identidad |

Dos reglas que explican los valores:

1. **El rojo no se duplica.** La acción sigue usando `--taba-red` (`#d0000d`),
   el mismo del sistema. Sobre negro ese rojo da 3,4:1: alcanza para superficie
   y borde, no para texto chico. Por eso existe `--brand-red-ink`, y es la única
   variante admitida para texto y enlaces sobre oscuro.
2. **El dorado es acento, no superficie.** Aparece en el aro de historias, en el
   filete del banner y en la línea de rubro/dirección. Nunca es fondo de sección
   ni color de párrafo largo.

El nombre del comercio **no** se escribió en el código: `BRAND.demoBusinessName`
es la semilla y la vista lee `businessConfig.businessName`. Cambiarlo desde
Panel Negocio → Configuración lo cambia en toda la app. `BRAND.productName`
sigue siendo `TABA2`: es el nombre del producto/plataforma (título, manifiesto,
presentación comercial), no el del local.

## 2b. Orden de la home

La vidriera tiene un orden y no es arbitrario: lo comprable va arriba y lo
editorial abajo.

| # | Bloque | Qué afirma |
| --- | --- | --- |
| 1 | Encabezado: emblema + acceso a historias | identidad y novedades |
| 2 | Bienvenida, rubro, dirección y estado | dato publicado por el comercio |
| 3 | Buscador | — |
| 4 | Categorías comprables | sólo rubros con precio publicado |
| 5 | **Destacados** | primer tramo comprable, sobre el pliegue |
| 6 | **Hero promocional** | editorial: invita, no afirma importe |
| 7 | Ofertas del día | oculto sin promoción vigente y aprobada |
| 8+ | Carruseles por rubro, con banner editorial intercalado | producto comprable |
| último | **Selección del local** | rubros sin precio, con estado honesto |

El encabezado se separó en dos filas. Antes el emblema de 100px compartía fila
con el título y el acceso a historias ocupaba un renglón entero debajo;
separarlos devuelve ~30px al primer producto y deja de partir "La Taba 2" en dos
líneas a 320px.

**El primer producto cae sobre el pliegue**: la primera tarjeta arranca en 481px
de 960 en el Moto G15.

## 3. Encabezado

`section.taba-home-hero.brand-hero` dentro de la vista `home`.

| Elemento | Origen | Si no está publicado |
| --- | --- | --- |
| Nombre | `businessConfig.businessName` | — |
| Rubro | `businessConfig.subtitle` | se omite |
| Dirección | `businessConfig.address` | se omite la parte de dirección |
| Estado | `[data-open-status]` (modelo de pedidos existente) | — |
| Horario | `businessConfig.openingHoursLabel` | el nodo queda `hidden` |

`publishedBusinessValue()` (en `js/ui.js`) descarta los textos de semilla que
dicen "a confirmar" o "no publicado". Es la regla que impide que el encabezado
muestre un horario o una dirección que el comercio todavía no confirmó.

**Estado abierto/cerrado.** No existe un modelo de horario computado: `openHour`
y `closeHour` sólo alimentan el formulario de configuración, nadie deriva de
ellos si el local está abierto. El chip usa el estado **real** de pedidos, que
es el que hoy decide si se puede comprar. Fijar un horario en el código habría
sido inventar el dato.

## 4. Historias comerciales

### Estado actual

**No hay backend.** `js/core/stories.js` implementa el contrato de UI completo
y es fail-closed: sin origen de datos no hay aro, no hay acceso y el logo deja
de ser un botón (vuelve a ser una imagen decorativa, sin nombre accesible).

Orígenes admitidos, en orden:

1. `window.TABA2_STORIES` — array. Es el punto de integración que deberá llenar
   el backend, del mismo modo que `runtime-config.js` alimenta la config.
2. Fixtures — **sólo** en modo preview explícito (`?showcase=1`) y en tests.

Un global con forma inválida no habilita fixtures: devuelve lista vacía.

### Contrato del registro

```
id            string, obligatorio
business_id   string
title         string
media_type    'image' | 'video'   (cualquier otro valor descarta el registro)
media_url     string, obligatorio (se rechazan javascript:, data:, vbscript:, file:)
thumbnail_url string (si falta, se usa media_url)
starts_at     timestamp | null    (null = ya vigente)
expires_at    timestamp | null    (null = sin vencimiento)
priority      integer
cta_type      'product' | 'offer' | 'category' | 'add_to_cart'
cta_target    string, obligatorio si hay cta_type
is_highlight  boolean
published     boolean, debe ser true estricto
```

Orden del visor: destacadas → mayor prioridad → la que empezó antes.

CTA admitidas y cómo se resuelven contra el storefront existente:

| `cta_type` | Etiqueta | Acción |
| --- | --- | --- |
| `product` | Ver producto | abre el modal de detalle |
| `offer` | Ver oferta | abre el modal de detalle |
| `category` | Ver categoría | filtra el catálogo real |
| `add_to_cart` | Agregar al carrito | alta en el carrito existente |

No hay acciones sociales. Una CTA sin tipo conocido o sin destino **no se
convierte en botón**: no se fabrican links muertos.

### Estados de la entrada

| Estado | Aro | Acceso |
| --- | --- | --- |
| `empty` | sin pintar | oculto; el logo no es botón |
| `unseen` | degradado + rotación sutil | "N historias nuevas" |
| `seen` | degradado atenuado (34%) | "Ver historias" |

La caja del logo mide 72px por CSS en los tres estados (64 en Perfil y por
debajo de 360px), así que el aro nunca mueve el layout. El estado no viaja sólo
en el color: el texto del acceso lo dice, que es lo que lo hace legible con
`prefers-reduced-motion` y para quien no distingue el aro.

### Lo que falta para encenderlo

Tabla `business_stories` con las columnas de arriba, RLS por `business_id`,
publicación en el arranque hacia `window.TABA2_STORIES`, y carga de medios.
Nada de eso entra en esta tarea visual.

## 5. Categorías

La fila **no** es una lista fija. Se compone de las categorías que hoy tienen al
menos un producto con precio publicado, disponible y con stock — exactamente el
mismo criterio que habilita el botón "Agregar". Se ordenan por prioridad
comercial de bebidas (`HOME_CATEGORY_PRIORITY`), con tope de 8, y "Todas" abre
la fila porque es el filtro activo por defecto y su marca tiene que verse sin
scroll.

Consecuencia: en el catálogo demo actual aparecen Gaseosas, Cervezas,
Energizantes y Mixers. Fernet, whisky, vinos, gin, aperitivos, aguas y
complementos **existen en el catálogo pero no publican precio**, así que no
entran en la vidriera; siguen a un toque desde "Todas". El día que el comercio
publique sus precios aparecen solas, sin tocar código.

## 6. Sistema de promociones

Cuatro piezas, una sola regla: **nada afirma un precio o un descuento que el
negocio no publicó.**

### Hero promocional

Fotografía curada a plena vista, título corto, subtítulo y una CTA que cae en
una categoría real con producto comprable. Es la pieza de apertura de la
vidriera y es **editorial**: la suite verifica que su texto no contenga `$`,
`%`, "descuento", "oferta", "promo" ni "antes". Fail-closed: si la categoría de
destino no tiene producto comprable, el hero no se pinta.

Ocupa el lugar que antes tenía el banner del encabezado, que por eso bajó a
cero: con el hero delante quedaban dos vidrieras fotográficas seguidas antes del
segundo producto.

### Banners editoriales

Puertas, no precios. Tienen **dos** clases de destino y las dos son reales:

| Clase | Atributo | Destino |
| --- | --- | --- |
| Rubro | `data-category-id` | filtra el catálogo por categoría |
| Marca | `data-brand-query` | busca esa marca en el catálogo |

La de marca existe porque el local tiene marcas que son motivo de compra en sí
mismas (Heineken) y que, metidas dentro del banner de "Cervezas",
desaparecían. Su destino no es inventado: es la misma búsqueda que escribiría el
cliente. Un banner sin producto en su destino **no se pinta** — es lo que hoy
mantiene apagado a Andes Origen: la pieza está vetada y registrada, el catálogo
todavía no la publica, y el día que el local la cargue aparece sola.

Invariantes que fija la suite: ningún banner duplica un rubro que ya tiene
carrusel, no hay dos destinos iguales, nunca hay dos seguidos y ninguno afirma
importe.

**Composición.** Copy a la izquierda, fotografía en panel propio a la derecha.
El motivo es medible: a 428×186 una foto de fondo se recorta a una franja de
2,3:1 —de la escena de Chivas quedaba una banda de mantel sin botella— y encima
había que apagarla al 30% para que el copy conservara contraste, así que el
banner "editorial" no mostraba nada editorial. Cada pieza declara su punto de
anclaje (`focus`), porque cada botella está en un lugar distinto de su escena.

### Tarjetas de producto

Imagen protagonista, marca, nombre, presentación, precio real y CTA. Sin precio
publicado la tarjeta **lo dice**: antes caía en `money(0)` y mostraba "$ 0", que
es peor que no mostrar nada porque afirma un precio que el local nunca ofreció.
La acción también cambia: en vez de un "Agregar" apagado, abre la ficha, que es
lo único que hoy se puede hacer con ese producto.

**Ofertas del día** sigue siendo la sección de promociones existente: se muestra
sólo con promociones reales, vigentes y aprobadas; sin ellas queda `hidden`. El
porcentaje se calcula únicamente cuando hay un precio regular mayor al vigente.

### Historias

Cuatro piezas curadas —Heineken, Jack Daniel's, Monster y Schweppes— con el
mismo contrato fail-closed de la sección 4. Ninguna menciona precio, descuento,
ranking ni stock, y cada CTA cae en una categoría que existe.

## 7. Accesibilidad

- Objetivos táctiles ≥ 44×44 en todos los controles de la home, verificado a
  320, 360, 390 y 412 px.
- Contraste verificado sobre el color realmente pintado (resolviendo el fondo
  opaco más cercano), no sobre el token: 12 nodos de texto, mínimo 4,5:1.
- El logo se anuncia como botón **sólo** cuando es interactivo.
- La categoría activa lleva `aria-current`, no sólo color.
- La disponibilidad de una oferta se dice con texto ("Disponible" / "Agotado").
- El campo de búsqueda nunca baja de 16px: no dispara el zoom de iOS. Ningún
  campo del cliente lo hace, verificado a los cinco anchos en los tres motores.
- El foco vuelve al logo al cerrar el visor de historias.
- El seguimiento **con pedido activo** tiene su propia medición: es el único
  estado donde hay texto directamente sobre el shell, y una regresión ahí no la
  detecta el recorrido de vistas vacías.

## 8. Movimiento

Se conserva el sistema certificado, con un ajuste: `--motion-duration-slow` bajó
de 320 a **240ms**. Ese token gobierna la entrada de cada sección y de cada
tarjeta al scrollear, que es la micro-interacción más visible de la home; a
320ms el contenido llegaba después del pulgar. `--motion-duration-modal` se
queda en 360ms porque no es una micro-interacción sino la presentación de una
hoja completa, y acortarla la vuelve un salto.

Se agrega la rotación del aro de historias (5,5s, lineal, sólo en estado
`unseen`). Con `prefers-reduced-motion` la regla global de `tokens.css` la
detiene y el aro queda estático: el estado se sigue comunicando por el aro
pintado y por el texto del acceso.

**Glass.** Sólo tres superficies desenfocan: la barra superior (16px), la
navegación inferior (18px) y el fondo del bottom sheet de filtros (3px). Los
tres son chrome; ninguna superficie de contenido lleva blur. El del sheet es
deliberadamente chico: en un Moto G15 un blur grande a pantalla completa se paga
en frames justo mientras el panel entra.

## 9. Regresión visual

La suite vive en `tests/e2e/taba2-brand-home.spec.mjs` y fija el **contrato
visual** —superficie, color resuelto, contraste, geometría, objetivos táctiles y
estado— en vez de comparar píxeles.

El motivo es concreto: el gate de CI corre en `ubuntu-latest` y el desarrollo
ocurre en Windows. Una baseline de píxeles generada en una plataforma pone la
otra en rojo por rasterizado de fuentes, no por una regresión real. El contrato
computado es idéntico en Chromium, WebKit y Firefox y en los dos sistemas.

Las capturas reales se generan como artefacto fuera del repositorio para la
revisión humana.

### Qué esperar de cada motor

`playwright.config.mjs` no declara proyectos, así que la suite corre en Chromium
por defecto y los otros dos motores hay que pedirlos con `--browser`. Eso importa
al leer un resultado:

| Motor | Estado | Nota |
| --- | --- | --- |
| Chromium | verde | es el gate |
| WebKit | 2 fallos | `business-windows-operations` y `delivery-proof`, ambos en paneles operativos y **reproducibles en el commit base** |
| Firefox | 3 fallos deterministas | `honesty-mode` y `mobile-touch-gesture` fallan con `browser.newContext: options.isMobile is not supported in Firefox`: crean contextos móviles, que Firefox no soporta. No pueden pasar en ningún build |

Además, en Firefox la familia `customer-delivery` es **no determinista**. Medido
sobre el commit base sin modificar, dos corridas idénticas dieron 7 fallos y 1
fallo. Un conteo de fallos de Firefox no significa nada por sí solo: para
distinguir regresión de inestabilidad hay que correr el mismo spec varias veces
sobre los dos builds y comparar, no comparar una corrida contra otra.
