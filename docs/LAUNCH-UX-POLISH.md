# Pulido de lanzamiento — TABA2

Rama `feature/taba2-launch-ux-polish`, desde `release/taba2-production-candidate @ 317bbe9`.
Sin migraciones, sin cambios de Mercado Pago, sin tocar staging ni producción.

Esto no es un rediseño. Es el último tramo de producto: que la tienda se sienta
rápida, táctil y fácil de volver a usar, con la identidad que ya tiene.

---

## 1 · Lo que la auditoría encontró antes de tocar nada

Medido a 390×844 en Chromium y en WebKit/iPhone 13, sobre el modo demo.
Capturas y medidas en `artifacts/launch-ux-polish/before/`.

### Superficie

| # | Hallazgo | Medida |
|---|---|---|
| A1 | El fondo estaba a tres puntos del negro absoluto | `--brand-bg: #090b0e` |
| A2 | Seis nombres de superficie para cuatro grises reales | `--brand-surface #171a20` y `--shelf #191d23` difieren en menos de un punto de luminancia |
| A3 | No existía un hueco por debajo del fondo | `--shelf-sunken` (#101317) era **más claro** que el fondo, así que el "hueco" era un relieve |

El efecto compuesto es el que se veía: barra superior, huecos entre secciones y
fondo de la navegación eran la misma lámina, y la tarjeta despegaba sólo por su
hairline. Eso es lo que se lee como negro plano.

### Acción

| # | Hallazgo | Medida |
|---|---|---|
| B1 | "Agregar" tenía la geometría de un chip | radio 999px · 46×155,5px · rojo pleno |
| B2 | El CTA del checkout, igual | radio 999px · 52px de alto |
| B3 | El selector de cantidad, igual | radio 999px |
| B4 | La barra de carrito no compartía sistema con nada | radio 18px, un valor suelto |

La píldora es la forma del chip: una categoría, una etiqueta, un estado. Cuando
también es la forma de "Agregar" y de "Confirmar", deja de decir nada.

### Respuesta al toque

| # | Hallazgo | Medida |
|---|---|---|
| C1 | El sello "Agregado ✓" tapaba el selector de cantidad entero | `inset: 0` durante **1100 ms** |
| C2 | Cero háptica | ninguna llamada a `navigator.vibrate` en todo el repositorio |
| C3 | En pantalla táctil el único acuse era la escala | `:active { transform: scale(0.97) }`, sin cambio de color |

C1 es el más caro de los tres y no se ve en una captura estática: quien quiere
dos unidades toca "Agregar" y después tiene que apuntar a un "+" invisible
durante más de un segundo. El sello confirmaba una acción impidiendo ver la
siguiente.

### Fricción del que vuelve

| # | Hallazgo | Medida |
|---|---|---|
| D1 | El checkout pedía todo aunque estuviera todo guardado | 7 campos visibles · **1272 px** de formulario en un viewport de 844 |
| D2 | "Volver a pedir" estaba al final de la home | `top: 2411px` de una página de 2775px — casi tres pantallas de scroll |

### Copy

| # | Hallazgo |
|---|---|
| E1 | "Tu pedido de siempre" afirmaba un hábito que nadie midió: lo decía con un solo pedido en el historial |
| E2 | "1 producto(s) no disponible(s)" — voz de sistema, y no decía **cuál** |
| E3 | Con el precio cambiado se mostraba sólo el total nuevo |
| E4 | "Finalizá en pocos pasos" encabezaba un formulario de 1272 px |

### Lo que se auditó y NO estaba roto

- **La estabilidad del cambio "Agregar" → "− 1 +"**: la tarjeta mide 177,5 × 332,3 px
  antes y después. No hay salto de layout.
- **La guarda antidoble-despacho**: `runCartAction` descarta repeticiones de la
  misma acción dentro de 120 ms. Medido con toques reales: a 60 ms de separación
  se registran los 6 de 6; recién a 30 ms —33 toques por segundo, que ninguna
  persona produce— se pierden 2. Se dejó como está y se fijó con una prueba.
- **La barra de carrito no salta**: es `position: fixed` con `bottom` derivado
  del stack de tokens, y el cuerpo reserva el espacio con `--bottom-reserve`.

---

## 2 · La escala de grafito

Seis escalones, una sola familia, cada tinta remedida contra la superficie donde
se usa.

| Rol | Antes | Ahora |
|---|---|---|
| hueco | `--shelf-sunken` #101317 | **#0a0d10** |
| fondo de la app | `--brand-bg` #090b0e | **#101317** |
| superficie principal | `--brand-bg-raised` #111419 | **#161a1f** |
| tarjeta | `--shelf` #191d23 · `--brand-surface` #171a20 | **#1d222a** (los dos) |
| elevada | `--shelf-raised` #22272f · `--brand-surface-hover` #1e222a | **#262c35** (los dos) |
| hairline | `--shelf-line` 10% · `--brand-border` 12% | **11%** · **13%** |

**El fondo sube y la tarjeta sube con él.** El escalón fondo→tarjeta se conserva
(1,16:1 antes, 1,16:1 ahora) sobre una base que ya no es un pozo. Subir sólo el
fondo habría aplanado más las tarjetas, que es el error obvio de este ajuste.

Recién ahora existe un hueco **real** por debajo del fondo: antes era imposible
porque el fondo ya estaba contra el piso.

### El rojo tuvo que subir con la superficie

Al levantar `--shelf-raised` de #22272f a #262c35, `#ff4d55` cayó a **4,31:1**
sobre esa superficie y dejó el error de campo del Perfil por debajo de AA. Lo
detectó `tests/a11y-recovery-and-contrast.test.mjs`, que ya medía las dos
superficies donde vive ese campo; a ojo la diferencia no se ve, y ese es
exactamente el punto de tener la medición. Los dos rojos legibles
—`--shelf-red-ink` y `--brand-red-ink`— pasan a **#ff5f66**.

Contraste, todo por encima de 4,5:1 y verificado por prueba:

| Tinta | Sobre | Antes | Ahora |
|---|---|---|---|
| `--brand-ink` | fondo | 17,9:1 | 17,0:1 |
| `--brand-ink-muted` | fondo | 8,5:1 | 8,1:1 |
| `--brand-red-ink` | fondo | 6,0:1 | 6,3:1 |
| `--brand-gold` | fondo | 7,3:1 | 6,9:1 |
| `--shelf-ink` | tarjeta | 16,9:1 | 14,9:1 |
| `--shelf-muted` | tarjeta | 7,7:1 | 7,4:1 |
| `--shelf-gold` | tarjeta | 6,3:1 | 6,0:1 |
| `--shelf-red-ink` | tarjeta | — | 5,4:1 |
| `--shelf-red-ink` | superficie elevada | 4,57:1 | 4,7:1 |

### El literal que dejó de ser literal

`rgb(9, 11, 14)` estaba escrito a mano en cinco lugares: dos suites E2E, dos
guiones de certificación de staging y un espejo en pruebas unitarias. Ese literal
no mide un color por gusto: mide que la cadena de estilos esté **viva**, que es
el defecto real que cierra —un `<link>` presente con la hoja en cero reglas
dejaba pasar cualquier `toBeVisible` sobre una tienda apagada—.

El problema es que "el fondo es exactamente este" deja de ser cierto en cuanto
alguien toca el token, y entonces hay que acordarse de cinco archivos a la vez.
Ahora el valor se deriva de `styles/tokens.css` (`scripts/brand-surface.mjs`):
la prueba sigue comparando el color computado contra un valor exacto, pero ese
valor ya no puede quedar viejo.

Los dos guiones de certificación de staging derivan del token de **esta** rama,
así que fallan contra un staging que todavía sirva la superficie anterior. Es el
punto: certifican que lo desplegado es esto.

---

## 3 · El sistema de botones

Dos radios nuevos, y la píldora conservada donde corresponde.

- `--radius-action: 12px` — la forma de la **acción**: firme, con esquina
  reconocible, todavía amable.
- `--radius-action-lg: 14px` — la misma familia un escalón arriba, para
  superficies de acción grandes donde 12px sobre 52px de alto se lee apretado.
- `--radius-pill: 999px` — sigue siendo la forma del **chip**: categorías,
  insignias, estados, aros, avatares. No se tocó ninguno.

| Control | Antes | Ahora |
|---|---|---|
| `Agregar` en la góndola | 999px | `--radius-action` |
| `Agregar` en la ficha | 999px | `--radius-action-lg` |
| Selector de cantidad `− 1 +` | 999px | `--radius-action` |
| `Confirmar pedido` | 999px | `--radius-action-lg` |
| Barra de carrito | 18px suelto | `--radius-action-lg` + hairline interior |
| Aviso (toast) | 999px | `--radius-action-lg` |

El selector de cantidad toma **exactamente** el radio de "Agregar": ocupa su
mismo lugar, con su mismo alto y su mismo ancho, y si además cambiara de forma
el reemplazo se leería como un salto en vez de como una continuación.

Una prueba lee las reglas exactas que pintan cada acción y falla si alguna
vuelve a ser una píldora. No busca `999px` en bruto: eso daría falsos positivos
en todos los chips legítimos.

---

## 4 · La respuesta al toque

Presupuesto: el estado autoritativo cambia **primero**, en el mismo cuadro; la
animación acompaña.

1. **Presionado instantáneo, de color y no sólo de escala.** `:hover` no existe
   con un dedo, así que el 3% de escala era casi nulo en un botón ancho. Ahora
   `.motion-pressing` —que `js/motion.js` ya ponía en el `pointerdown`— también
   cambia el fondo al rojo presionado, con `transition: none`: heredar
   `--motion-duration-fast` haría llegar el color 160 ms tarde, que es justo lo
   que se quiere evitar. El stepper responde en la **mitad** que se tocó.
2. **El contador ya cambiaba primero** y se dejó así.
3. **El sello "Agregado ✓" pasó de 1100 ms a 520 ms** y dejó de cubrir la
   columna del "+" (`inset: 0 44px 0 0`, los 44px declarados de esa columna).
4. **Se retira con un barrido opaco, no con un desvanecido.** Un desvanecido
   sobre un control vivo mezcla dos textos —el sello y el número de abajo— y
   durante esos milisegundos la tarjeta parece rota. Se ve en cualquier captura
   tomada a mitad de la transición; de hecho así se descubrió, comparando el
   BEFORE con el primer AFTER. El barrido (`translateX(-101%)` con el stepper
   recortado) descubre el control en vez de disolverse encima de él.

`ADDED_FLASH_MS` en `js/ui.js` y `--motion-duration-added-flash` en
`styles/tokens.css` son el mismo número, y una prueba falla si divergen: si el
JS aguanta más que el CSS, la tarjeta queda con un sello invisible que igual
ocupa el lugar del "+".

### Háptica: qué soporta cada plataforma DE VERDAD

| Plataforma | `navigator.vibrate` | Vibra |
|---|---|---|
| Chrome / Edge / Samsung en Android | sí | **sí** |
| Firefox en Android | sí | **sí** |
| Safari en iOS / iPadOS | **no existe** | no |
| Chrome en iOS | **no existe** | no |
| Firefox en iOS | **no existe** | no |
| Chrome / Firefox / Edge escritorio | sí | **no** (sin motor) |
| Safari escritorio | no existe | no |

Los dos renglones que se suelen dar por sabidos al revés:

- **Ningún navegador de iOS soporta la Vibration API.** Chrome y Firefox en iOS
  son WebKit por obligación de plataforma, así que "probamos en Chrome" no dice
  nada sobre un iPhone. No hay alternativa web para el motor háptico de Apple.
- **En escritorio la API existe y no hace nada.** `'vibrate' in navigator` es
  verdadero en Chrome de escritorio y la llamada devuelve `true` sin hardware.
  No hay forma de detectar el motor: por eso `js/core/haptics.js` **nunca** usa
  el resultado para decidir nada de la interfaz.

Tres acuses y nada más: `add` (12 ms), `remove` (8 ms) y `confirm` (14-60-22 ms).
Por encima de ~30 ms un pulso deja de leerse como acuse y empieza a leerse como
alarma. Hay una ventana antirrebote de 60 ms: sin ella, mantener el dedo en "+"
convierte una serie de acuses en una vibración continua.

Se llama **dentro del manejador del gesto**: fuera de la activación del usuario
el navegador la descarta (Chrome además la anota como intervención). Si no hay
háptica no pasa nada: ni error, ni aviso, ni camino alternativo.

### Movimiento reducido

Con `prefers-reduced-motion: reduce` el sello no se pinta —sin animación que lo
apague quedaría tapando el control para siempre— y la confirmación queda a cargo
del aviso, que es texto y lo lee un lector de pantalla. La compra funciona
idéntica, medido: agregar, sumar, restar y confirmar. Y no queda ninguna
animación infinita corriendo.

---

## 5 · El cliente que vuelve

**La compuerta es un pedido anterior, no un perfil guardado.** La diferencia no
es cosmética: tener una dirección guardada sólo prueba que alguien la escribió;
tener un pedido en el historial prueba que ya se completó una compra con esos
datos. Un perfil a medio llenar no es un cliente recurrente, y presentarle un
resumen sería esconderle justamente los campos que todavía no llenó.

Con un pedido anterior, el checkout muestra tres renglones:

```
ENTREGA    Casa · Avenida Argentina 450, Neuquén Capital     Cambiar
CONTACTO   Marco · •••123                                    Cambiar
PAGO       Efectivo al recibir                               Cambiar
```

Medido: **1272 px → 787 px** de formulario y **7 → 1** campos visibles. Al tocar
"Cambiar" vuelve el checkout entero (1272 px, 7 campos), no el renglón suelto: un
resumen que se abre por partes deja a la persona sin saber qué quedó plegado, y
en una compra eso se paga confirmando algo que no se vio.

Los controles que el resumen reemplaza **no se quitan del árbol**: se pliegan con
un atributo en el `<form>` y una regla de CSS. Quitarlos perdería el valor
elegido y volvería a pedirlo, que es lo contrario de lo que esto hace.

### Lo que NO hace el resumen

**Recordar un dato no autoriza a usarlo.** La dirección, el stock, el precio, la
zona y el horario los revalida el envío del pedido, exactamente igual que para
alguien que compra por primera vez. El resumen ahorra tipeo, no controles.

- La dirección se **confirma** a la vista, no se asume: si la guardada perdió el
  punto de entrega confirmado, no hay resumen y el checkout pide resolverlo.
- El medio de pago se **propone** desde el último pedido y se revalida contra lo
  que el checkout ofrece hoy —un método dado de baja se descarta en silencio y
  queda el valor por defecto—. Proponer no es saltear: el medio elegido está en
  el resumen, con su propio "Cambiar". `taba-reorder-retention` prohíbe saltear
  la elección, no proponer la anterior a la vista de todos.
- El **modo de entrega no se preselecciona** desde el historial. Es una decisión
  deliberada de alcance: delivery es el default y el resumen lo muestra con su
  salida; preseleccionar pickup cascadearía sobre zona, envío y mínimo, y eso
  excede el pulido.
- Ninguna persistencia nueva. Todo sale de `js/core/customer-history.js`, que ya
  guardaba `paymentMethodCode` y `deliveryMode`. Cero migraciones.

### Volver a pedir

La tarjeta ya existía y ya revalidaba (`buildReorderPreview` devuelve precio
vigente **y** anterior en el mismo objeto, a propósito: hace imposible dibujar la
tarjeta sin poder mostrar el cambio). Lo que faltaba era mostrarlo.

- **Motivo por producto, no un conteo.** "1 producto(s) no disponible(s)" pasó a
  "Heineken: ahora no lo tenemos" / "Corona Extra: quedan 3" / "Coca-Cola: ya no
  se vende". Hasta tres renglones; el resto se cuenta, y el detalle completo
  aparece igual en el carrito.
- **Los dos totales.** Con el precio cambiado, el anterior aparece tachado al
  lado del vigente. Nunca sólo el nuevo.
- **Posición.** De `top: 2411px` (último bloque de la home) a inmediatamente
  después del primer carrusel comprable. No sube más porque "Destacados" es el
  primer tramo comprable y tiene que caer sobre el pliegue: la recompra no puede
  desplazar a la vidriera comercial, que es lo que ve quien entra por primera vez.

---

## 6 · Copy

Bajo `taba-copy-ux`.

| Antes | Ahora | Por qué |
|---|---|---|
| "Tu pedido de siempre" | "Tu último pedido" | Afirmaba un hábito sin dato; el último pedido sí es un hecho |
| "1 producto(s) no disponible(s)" | "Heineken: ahora no lo tenemos" | Voz de sistema, y no decía cuál |
| "Total actualizado con precios actuales." | "Cambió algún precio: el total es el de hoy" + total anterior tachado | Un total nuevo sin el anterior no es información, es un cambio |
| "Finalizá en pocos pasos" | "Para entregarte el pedido" / "Ya tenemos tus datos" | Prometía brevedad sobre un formulario de 1272px |

Sin urgencia inventada, sin porcentajes en texto editorial, sin gamificación,
sin exclamaciones. Los CTA siguen nombrando lo que pasa al tocarlos.

---

## 7 · Skills utilizadas

| Skill | Para qué decisión |
|---|---|
| `taba-copy-ux` | Los cuatro cambios de copy de arriba; y la regla de que un CTA nombra lo que hace sostuvo dejar "Agregar", "Cambiar" y "Repetir" como estaban |
| `taba-reorder-retention` | La compuerta del resumen (pedido anterior, no perfil); la revalidación explícita; el motivo por ítem; los dos totales; y el límite de que el medio de pago se propone pero no se saltea |
| `taba-commercial-qa` | El veredicto final sobre la UX resultante (§ del informe) |
| `taba-merchandising` | La posición de "Volver a pedir": pieza discreta que no desplaza la vidriera, y la regla de reservar altura |

`taba-loyalty` está disponible y **no se activó**: no hay puntos, premios, libro
de asientos ni descuentos por puntos en esta rama.

---

## 8 · Alcance

No entra nada de esto: Taba Puntos, Google Login, catálogo nuevo, promociones
nuevas, growth engine, auto-dispatch, wallet del Rider, funciones nuevas del
panel del negocio, cambios de Mercado Pago, cambios fiscales ni migraciones.
