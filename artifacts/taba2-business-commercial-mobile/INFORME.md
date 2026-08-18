# Panel del negocio — herramienta de trabajo, en grafito y en un teléfono

El Panel deja de ser una vista clara heredada del cliente y pasa a ser lo que
tiene que ser: la pantalla que alguien mira ocho horas seguidas mientras entran
pedidos, y que además funciona desde el teléfono del mostrador.

Nada de esto está integrado a la línea de producción. La rama vive aparte y el
preview apunta a **staging**, nunca a producción.

## Preview para revisar desde el celular

**https://taba2-panel-mobile-preview-2.taba2-staging.pages.dev/#business**

(también `https://9cc5497c.taba2-staging.pages.dev/#business`)

| | |
|---|---|
| proyecto | `taba2-staging` (Cloudflare Pages) |
| tipo | **deployment de rama** — `taba2-panel-mobile-preview-2f59bc7` |
| backend | `ukxqbgswjlibmnjemrzd` — **staging**, no producción |
| `runtime-config.js` | el vivo de staging, byte a byte: 684 B, sha256 `57d8a007…` |
| alias `taba2-staging.pages.dev` | **intacto**, sigue sirviendo `la-taba-runtime-v65-authoritative-gates` |
| preview | sirve `la-taba-runtime-v72-business-commercial-mobile` |

Se comprobó después de publicar, pidiendo el `sw.js` de las tres URLs: el alias
de staging no se movió. El `runtime-config` del preview se verificó con el gate
de despliegue: `entorno=staging, host=ukxqbgswjlibmnjemrzd.supabase.co`.

Entrás con la misma cuenta owner de staging que usás siempre.

## La paleta

Cinco escalones de una sola familia, neutros, medidos en luminancia relativa:

```
hueco     #16181b   cabecera, canaleta, pista de progreso
fondo     #1b1e22   fondo de página
superficie#222529   panel, sección, barra
tarjeta   #282c31   la tarjeta de pedido
elevada   #31353b   campo, chip, fila activa, hover
```

Cada paso es apenas perceptible —1,06 · 1,09 · 1,10 · 1,14— a propósito: la
jerarquía la dibuja el hairline, no un salto de luz.

**No son los valores del storefront.** El grafito del cliente tira a azul y lleva
dorado, brillo de góndola y sombras largas: es una vitrina y tiene que sentirse
así. El Panel usa la misma idea con una familia más neutra y un escalón más alta,
porque lo que se mira acá es texto denso, no packshots.

### La tinta, medida sobre la superficie donde se usa

| tinta | hueco | fondo | superficie | tarjeta | elevada |
|---|---|---|---|---|---|
| `#eceef1` primaria | 15,30 | 14,39 | 13,24 | 12,09 | 10,61 |
| `#b6bcc4` secundaria | 9,30 | 8,75 | 8,05 | 7,34 | 6,45 |
| `#9aa0a9` apagada | 6,76 | 6,35 | 5,84 | 5,34 | 4,68 |

Ninguna baja de 4,5:1. La primaria es blanco roto y no `#fff`: sobre grafito el
blanco puro vibra y la diferencia de contraste no compra nada.

La apagada es `#9aa0a9` y no `#8f959e`, que era el candidato obvio: ese daba
4,09:1 sobre la superficie elevada, justo donde se usa para la etiqueta de un
campo.

### El rojo

`--taba-red` es una **superficie**, no una tinta: sobre la tarjeta da 2,47:1,
pero como fondo de botón con texto blanco da 5,69:1. Por eso el rojo queda para
la acción principal, el destino activo de la barra de escritorio y el error
crítico. El texto rojo usa `--panel-red-ink` (`#ff7d84`).

En la barra inferior el destino activo se marca con la **tinta** y una barrita,
no con fondo rojo: cinco botones y uno rojo permanente convertirían el rojo en
decoración.

### El defecto que sólo aparece al retematizar

`background: var(--taba-ink); color: #fff` funciona mientras la tinta sea oscura,
y queda **blanco sobre blanco** cuando la tinta se aclara. Pasaba en el chip
activo de reportes y en la acción principal de la cola. Ahora existe
`--ink-contrast`: blanco en la superficie clara, fondo del Panel en el Panel.

Por lo mismo `--taba-white` **no** se reapunta: además de superficie es la tinta
del botón primario.

### De 113 literales a 0 alcanzables

`styles/business.css` traía 113 literales de color, 58 distintos. Quedan 51, y
los 51 son el valor de respaldo de un `var(--token, #fallback)` que ya no se usa
porque el token está definido. Medido: **cero literales alcanzables fuera de un
fallback**.

## La densidad, antes y después

Es la medida que decide si el rediseño sirvió. No es una opinión sobre una
captura: la sonda mide cuánto hay antes del primer pedido, cuánto mide una
tarjeta, y cuántos pedidos entran **enteros** descontando la barra inferior.

| ancho | chrome antes del 1er pedido | alto de tarjeta | pedidos enteros |
|---|---|---|---|
| 360×740 | 507 → **249** | 680 → **395** | 0 → **1** |
| 375×812 | 507 → **249** | 680 → **395** | 0 → **1** |
| 390×844 | 484 → **249** | 680 → **395** | 0 → **1** |
| 393×851 | 484 → **249** | 680 → **395** | 0 → **1** |
| 412×915 | 484 → **249** | 699 → **395** | 0 → **1** |
| 430×932 | 464 → **249** | 699 → **395** | 0 → **1** |
| 768×1024 | 378 → **218** | 570 → **372** | 0 → **1** |
| 1366×768 | 431 → **364** | 699 → **403** | 0 → **1** |
| 1440×900 | 431 → **364** | 699 → **403** | 0 → **2** |
| 1920×1080 | 431 → **364** | 699 → **403** | 0 → **2** |

**En ningún ancho entraba un pedido entero.** Ni en teléfono ni en escritorio.

## Qué cambió, y por qué

### Navegación (B8)

Los diecisiete destinos se envolvían en **seis renglones** de píldoras en 390px.
Debajo de 1020px la fila desaparece y la navegación baja: cuatro destinos fijos
—Pedidos, Qué pasa, Pagos, Mostrador— más «Más», que abre una hoja con los trece
restantes.

Cuatro y no nueve: una barra con nueve destinos no es una barra, es la misma
pared acostada.

`splitBusinessMobileNavigation` filtra la preferencia por lo que el rol tiene
permitido, así que un `staff` sin acceso a pagos recibe el siguiente destino de
la lista y no un botón que no puede usar.

La reserva de espacio ya existía en `responsive.css`, así que la barra usa
exactamente `--nav-h` y no inventa una segunda medida.

### El tablero (B9/B10)

Cuatro cajas de metadatos de 64px —HORA, ENTREGA, PRODUCTOS, TOTAL— apiladas de a
dos, más el contacto en formato ficha con etiqueta arriba y valor abajo: 128px
para decir cuatro cosas de una palabra.

Se comprimen a filas. **No se esconde nada**: el teléfono, el pago, la dirección,
las observaciones, los productos y la asignación de rider siguen todos en la
tarjeta y siguen todos en el DOM. La jerarquía que queda es pedido → estado →
cliente → dirección → total → pago → rider → acción siguiente.

La acción siguiente ocupa el ancho completo, mide 50px y va última. «Cancelar con
motivo» ya no comparte fila con ella: son la decisión opuesta y a 390px
terminaban pegadas, con el campo de motivo exprimido entre las dos.

### Escritorio (B6)

Desde 1200px la cola es un tablero de dos columnas, y de tres desde 1700. Un solo
`auto-fill` con mínimo de 440px hace las dos cosas sin un segundo breakpoint.

Los diecisiete destinos van en **una** fila que se desplaza y no en dos que se
envuelven: además de los 100px, la segunda fila cambiaba de contenido según el
ancho, así que la posición de un destino dejaba de ser estable entre monitores.

### Estado de conexión (B20)

«Conectado · Última sincronización: …» y «Sin comandos pendientes · Última
reconciliación: … · 0 comandos pendientes» son cinco datos para decir que no pasa
nada.

`is-quiet` se calcula en **JS y no en CSS**: la hoja de estilo no puede saber si
el contador está en cero, y esconder el detalle «cuando el estado es connected»
habría escondido también una cola pendiente. Con uno o más comandos esperando, el
número se muestra siempre. Y el recuento en cero directamente no se escribe: la
etiqueta de al lado ya dice «Sin comandos pendientes».

### Realtime (B19)

`panelMoreSheetOpen` vive en el módulo, no en el DOM. El workspace se repinta
cada vez que llega un pedido; guardado en el marcado, la hoja se habría cerrado
sola en la mano de quien la acababa de abrir, justo cuando entra trabajo. Hay una
prueba que dispara un repintado y comprueba que sigue abierta.

## Dos cosas que no eran de maquetado

**`paymentLabel()` no tenía `mercadopago`**, que es el código que el backend
guarda de verdad —es el mismo que compara `isMercadoPagoOrder()` para decidir si
un pedido se puede cancelar sin devolver la plata primero—. El Panel le mostraba
al operador el enum crudo, «mercadopago», sin espacio y en minúscula, en el
renglón «Pago» de cada pedido cobrado por tarjeta.

**`sanitizeNotes()` devuelve 'Sin notas'** cuando el campo viene vacío, así que
`order.notes` es siempre verdadero y la tarjeta imprimía «Observaciones: Sin
notas» en todos los pedidos que no tenían ninguna. Un renglón por tarjeta que no
dice nada, multiplicado por la cola entera. Se compara en el Panel y no se cambia
en el saneador, porque en el historial del cliente «Sin notas» sí es la respuesta
correcta.

## Tauri (B21)

`minWidth` de la ventana pasa de 1024 a **1100**. El Panel cambia a navegación de
teléfono por debajo de 1020px, y 1024 son cuatro píxeles de margen medidos sobre
la **ventana**: en Windows el área de cliente descuenta bordes y barra de
desplazamiento, así que una ventana en su mínimo dejaba un webview de ~1000 y la
aplicación de escritorio habría mostrado la barra inferior de teléfono dentro de
un monitor.

`tests/desktop-shell-contract.test.mjs` ata los dos números: lee el corte móvil
del CSS y exige que la ventana mínima quede 64px por encima.

El bundle de escritorio se regeneró y sirve la hoja nueva (`?v=51`,
`la-taba-runtime-v72-business-commercial-mobile`).

## Lo que se midió y NO se cambió

El Panel de producción **no abre ningún modal**: `js/production-operations.js` no
llama a `showModal()` una sola vez, y sus superficies son paneles en línea. Los
cuatro diálogos del panel de **demostración** viven en `js/business.js`, que en
modo producción está oculto (`applyRenderedModeState`).

Así que no hay «modal de 800px cortado» que convertir en hoja: la única hoja del
Panel es la de «Más», y nació hoja.

Tampoco hay una pantalla de **catálogo** con lista, búsqueda y edición en el
Panel de producción. Los destinos que existen son `product-create`,
`inventory-receive`, `inventory-adjust` y `stock-count`; el catálogo se carga por
las herramientas de importación. No se inventó una pantalla que no existe.

## Evidencia

121 combinaciones —11 anchos × 11 pantallas—, antes y después:

| | antes | después |
|---|---|---|
| desborde horizontal | 0 | **0** |
| áreas táctiles < 44px | 11 combinaciones | **0** |
| contraste < 4,5:1 | 0 | **0** |
| errores de navegación | 0 | **0** |

Las 11 combinaciones con áreas táctiles chicas del «antes» eran los campos de
motivo de cancelación, a 42px.

Doce pruebas de Playwright fijan las propiedades —no el diseño— en cuatro anchos
de teléfono y dos de escritorio, más la hoja de «Más», el ingreso con teclado
abierto, el foco por teclado y el texto al 150% y al 200%.

Las capturas versionadas son las de 390×844, 412×915 y 1440×900; los dos reportes
JSON cubren los once anchos.

## Lo que hay que mirar a ojo

Un teléfono de verdad. Todo lo de acá se midió en Chromium con emulación táctil:
el teclado virtual, el rebote del scroll de iOS y el recorte del notch se
comportan distinto en un aparato. El preview está publicado justamente para eso.
