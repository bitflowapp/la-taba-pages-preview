# Home de marca · La Taba 2

Documento de contrato de la home comercial móvil. Describe qué afirma la
superficie, de dónde sale cada dato y qué hace falta para encender lo que hoy
está apagado.

## 1. Alcance de la superficie

La app **sigue siendo clara**. El sistema oscuro se aplica a una sola vista:

```
body[data-active-view="home"]
```

Catálogo, carrito, checkout, tracking, perfil y los paneles de Negocio y
Repartidor conservan exactamente la superficie que el RC certificó. Todo el
sistema vive en `styles/brand-home.css`, que se importa **después** de
`responsive.css` porque es la última palabra sobre esa vista.

Consecuencia deliberada: al navegar de Inicio a Catálogo la barra superior y la
navegación inferior cambian de superficie. La geometría no cambia (mismo alto,
mismas columnas, mismos controles), sólo el color. Es una decisión de alcance,
no un efecto colateral: oscurecer el chrome de todas las vistas habría entrado
en catálogo, checkout y paneles operativos, que están fuera de esta tarea.

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

La caja del logo mide 56px por CSS en los tres estados, así que el aro nunca
mueve el layout. El estado no viaja sólo en el color: el texto del acceso lo
dice, que es lo que lo hace legible con `prefers-reduced-motion` y para quien no
distingue el aro.

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

## 6. Ofertas y banners

**Ofertas del día** es la sección de promociones existente. Se muestra sólo con
promociones reales, vigentes y aprobadas; sin ellas queda `hidden`. No se
fabrica ningún precio tachado ni porcentaje: el porcentaje se calcula únicamente
cuando hay un precio regular mayor al vigente.

**Banner** es editorial, no promocional. Enlaza a una categoría que existe y
tiene producto comprable, y su copy no afirma precio ni descuento (la suite lo
verifica: el banner no puede contener `%` ni `$`). Máximo dos; en teléfono se
muestra uno solo, porque el alto del primer pantallazo pertenece al producto.

## 7. Accesibilidad

- Objetivos táctiles ≥ 44×44 en todos los controles de la home, verificado a
  320, 360, 390 y 412 px.
- Contraste verificado sobre el color realmente pintado (resolviendo el fondo
  opaco más cercano), no sobre el token: 12 nodos de texto, mínimo 4,5:1.
- El logo se anuncia como botón **sólo** cuando es interactivo.
- La categoría activa lleva `aria-current`, no sólo color.
- La disponibilidad de una oferta se dice con texto ("Disponible" / "Agotado").
- El campo de búsqueda nunca baja de 16px: no dispara el zoom de iOS.
- El foco vuelve al logo al cerrar el visor de historias.

## 8. Movimiento

Se conserva el sistema certificado. Lo único que se agrega es la rotación del
aro de historias (5,5s, lineal, sólo en estado `unseen`). Con
`prefers-reduced-motion` la regla global de `tokens.css` la detiene y el aro
queda estático: el estado se sigue comunicando por el aro pintado y por el texto
del acceso.

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
