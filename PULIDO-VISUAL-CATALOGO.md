# Pulido visual del catálogo del cliente — TABA2

**Rama** `feature/taba2-catalog-visual-polish` · **base** `4f49234`
(la candidata nocturna del cliente, que **no se movió**).

Sólo CSS del cliente. No se tocó lógica, navegación, datos, carrito, filtros ni
seguimiento; no hay cambios de marcado salvo uno que no existe (todo se resolvió
sobre el marcado actual). Nada se desplegó y nada se pusheó.

Encargo: mejorar la calidad visual real del catálogo a partir de cinco capturas
de un iPhone sobre `taba2-staging.pages.dev`. Todo lo que sigue se reprodujo
primero en local, en el mismo motor y el mismo tamaño (**WebKit, 390×844**), y
se volvió a medir después.

---

## Cómo se trabajó

Dos arneses nuevos, porque una captura sola no alcanza para decidir:

| Herramienta | Qué da |
|---|---|
| `scripts/visual-polish-shots.mjs` | 10 pantallas comparables en WebKit móvil + desbordamiento horizontal de cada una. `--label antes` / `--label despues`. |
| `scripts/visual-polish-measure.mjs` | los números que la foto no muestra: altos y radios reales, bordes izquierdos de cada bloque, tinta efectiva, y el **pliegue útil** (dónde termina el primer control de compra contra la barra inferior opaca). `--width/--height`. |

El segundo corre con `reducedMotion: 'reduce'` **a propósito**: sin eso, una
tarjeta que todavía no fue revelada devuelve su rectángulo desplazado 16px hacia
abajo por la animación de entrada, y el pliegue se mide sobre una posición que
no existe. Las primeras corridas mintieron por eso.

Capturas en `artifacts/taba2-catalog-visual-polish/{antes,despues}-390x844/`.

---

## Los defectos que se encontraron, y por qué pasaban

Ordenados por gravedad, no por pantalla.

### 1. El aviso de actualización era blanco sobre blanco

Es el peor de todos y el más fácil de explicar. `.pwa-banner` vive **fuera** de
`.app-view`, así que el remapeo de la paleta del cliente lo alcanza por la
**tinta** —que se hereda del `body`— pero no por la **superficie**, escrita como
`background: white` literal. Sobre la app oscura: título casi blanco sobre
blanco. Ilegible. La ✕ tampoco existía visualmente.

Encima, con `display: flex` en una fila, el botón y la ✕ se quedaban con ~200 de
los 358px disponibles y el título caía en tres renglones partidos a mitad de
palabra (`actualizació / n disponible`), tal cual se ve en la captura 5.

**Ahora**: tarjeta de góndola con la misma superficie y la misma sombra que la
tarjeta que tiene debajo; mensaje arriba, acción ancha abajo, ✕ como control
real en la esquina. A partir de 520px vuelve a ser una fila. Los otros tres
avisos del shell (instalar, guía de iOS, sin conexión) comparten la corrección.

### 2. El buscador dibujaba un segundo rectángulo adentro

En las dos vistas con buscador se veía una caja más clara que arrancaba después
de la lupa y terminaba antes del borde. No era un degradado ni un artefacto: la
regla que da superficie a los campos del cliente los enumera **por elemento**
(`input`, `select`, `textarea`) —a propósito, para que ningún campo nuevo nazca
blanco— y le ganaba en especificidad al `background: transparent` del buscador.
El `<input>` pintaba su propia superficie dentro de una caja que ya tenía la
suya.

**Ahora**: la caja completa es el campo; el input es sólo el texto.

### 3. "Filtros" y "Ordenar" eran dos controles distintos

`Filtros` tenía **dos contornos concéntricos**: el del `<details>` (radio 10) y
otro de píldora con `border: 1px solid currentcolor` sobre el `<summary>`, más
brillante que nada en pantalla. `Ordenar`, al lado, tenía uno solo. Además:
44 vs 46 de alto, radio de píldora vs 10px, etiqueta 13/800 vs 12/750, y dos
flechas dibujadas de forma distinta (el glifo `⌄` de la tipografía en uno, dos
bordes CSS en el otro).

**Ahora** los dos miden 48 de alto, comparten radio (14), tipografía (13/800) y
la misma flecha, que además gira al abrir. Es la corrección que más cambia la
sensación de "improvisado" de esa fila.

### 4. Un sistema de controles con cuatro geometrías

El buscador de la home medía 48×16px de radio y el del catálogo 46×10. Los chips
de categoría: 48/22px de icono/12,5px de texto en la home, 44/18/13 en el
catálogo. El botón "Agregar" era **píldora en la home y rectángulo en el
catálogo**: la diferencia más visible entre las dos vitrinas del mismo producto.

**Ahora** hay tres tokens (`--control-h: 48px`, `--radius-control: 14px`,
`--radius-plate: 13px`) y una sola geometría por tipo de control. El "Agregar"
es píldora en las dos vitrinas.

### 5. El plato del packshot no compartía borde con su propio texto

El marco de la foto tenía 9px de padding y el cuerpo de la tarjeta 12 (10 en
teléfono): el plato blanco arrancaba **tres píxeles a la izquierda del título
que describe ese producto**. En una grilla de dos columnas se lee como una foto
descentrada. Lo mismo en la tarjeta de combo, con 9 arriba y 14 abajo.

**Ahora** el aire interior sale de un solo token (`--card-pad`) y los dos bordes
coinciden. Medido: plato `@x24`, título `@x24`.

### 6. El corazón de favoritos estaba calibrado contra la superficie equivocada

Su tinta salía de `--taba-graphite-soft`, que en el cliente se remapea a
`--shelf-muted` (#aab0b9). Ese gris está medido contra la **tarjeta de
grafito**, pero el control vive sobre el **plato blanco**: daba **2,06:1**. Se
veía lavado, como un resto del render y no como un control.

**Ahora** usa un gris medido contra el plato (#6f7480, 4,0:1). Sigue siendo
secundario respecto del packshot, que es lo que la decisión original quería.

### 7. El "+18" era una pastilla blanca sobre un plato blanco

De la marca legal quedaba el hilo dorado y el texto flotando sobre el envase, y
donde el plato curva su esquina asomaba el grafito de la tarjeta por debajo: se
veía medio afuera de la foto. **Ahora** es grafito con tinta dorada —la misma
pareja que ya usaba `.combo-chip.is-age`— y se apoya en la parte recta del canto.

### 8. El sello de ahorro del combo estaba anclado al marco, no al plato

A `left: 10px` sobre un marco con 9px de padding, la píldora dorada arrancaba
**un píxel adentro** del plato, justo donde la esquina todavía está curvando.
**Ahora** se apoya en el canto recto y lleva sombra para despegarse del blanco.

### 9. "Precio próximamente" se dibujaba blanco

El aviso pedía dorado (`--taba-warning`), pero la regla que devuelve los títulos
de la góndola a `--shelf-ink` alcanza a cualquier `<strong>` de la tarjeta y es
más específica. Resultado: el aviso tenía **el mismo peso visual que un importe
real** y el único indicio de que el producto no se podía comprar quedaba en el
botón. **Ahora** el dorado vuelve y la tarjeta pendiente se lee de un vistazo.

### 10. El bloque "ninguno tiene precio publicado" era un parche

Una caja de 12px con una frase apretada contra un botón rojo a sangre. El rojo
terminaba siendo lo más brillante de una pantalla cuya noticia es justamente que
**no hay nada para comprar**. **Ahora** toma el lenguaje que la app ya reserva
para "pendiente" (hairline dorado, el mismo del botón `is-price-pending` que
tiene debajo), la frase respira a 15px y la salida es una acción de tamaño
normal. El filete dorado es decorativo y no entra en el árbol de accesibilidad.

### 11. Una columna que se corría dos píxeles a mitad de la vitrina

Medido: encabezado 16, buscador 16, chips 16, tarjetas 16… **hero 18, banner
editorial 18, rótulo de sección 18**. Tres bloques con `padding: 0 2px` propio.
**Ahora** los nueve bloques de la home arrancan en 16 y terminan en 374.

### 12. El wordmark no estaba alineado con la barra que lo contiene

El filete rojo de "La Taba" iba **en flujo**, así que la caja del wordmark medía
27,5px (20 de letra + 5 de aire + 2,5 de filete) y la barra centraba esa caja,
no la palabra. "La Taba" quedaba unos píxeles más alta que el bloque de
dirección de al lado y la fila se veía torcida sin que se pudiera decir por qué.
**Ahora** el filete es absoluto: se dibuja donde estaba y la palabra centra.

### 13. La barra inferior no era opaca

Al 97% se leían los títulos de los productos de la fila de abajo **a través** de
la barra (dos nombres fantasma detrás de "Seguir" y "Carrito"), y el
`blur(18px)` a pantalla completa se pagaba en frames del Moto G15 para tapar un
3% de nada. Todo el sistema de reservas inferiores asume que esa barra es opaca.
**Ahora lo es**, y sin desenfoque.

### 14. El disparador de "Filtros" quedaba cortado por su propio panel

Compartía `--z-modal` con el bottom sheet y el desempate lo decidía el orden del
DOM: el panel se pintaba después y partía la palabra "Filtros" por la mitad. El
toque funcionaba —de ahí que no figurara como defecto— pero el control se veía
roto. **Ahora** flota entero por encima, con su propia superficie.

### 15. Perfil: tres subrayados rojos y un verde que no es de la marca

"Editar", "Eliminar" y "Cerrar" eran enlaces subrayados en rojo dentro de
tarjetas de góndola —se leen como una página vieja— y competían en color con el
único rojo que importa, el de comprar. La dirección predeterminada llevaba 2px
de rojo pleno **más un halo de 22px**: era el único elemento con resplandor de
toda la app y se leía como un error de formulario. Y "Ubicación confirmada"
salía en `#7dc563`, un verde literal que no está en la identidad.

**Ahora**: píldoras de hairline que conservan el subrayado en `:hover`/`:focus`
(el estado nunca depende sólo del color) y mantienen los 44px táctiles; borde de
1,5px al 72% con anillo interior sin difuminar; y la confirmación pide
`--taba-success`, que el sistema ya remapea a dorado en el cliente y deja el
verde de papel intacto en Negocio y Repartidor.

### 16. Un token que no existe

`.price-condition` pedía `color: var(--ink-soft)`. **Ese token no está declarado
en ningún lado**: la declaración era inválida en tiempo de cómputo y el color
caía a `inherit`, o sea la tinta del título. En el cliente no se notaba porque
una regla de la góndola pinta los `<small>` de la tarjeta; en Negocio y
Repartidor la condición del precio se leía con el mismo peso que el precio.

---

## Lo que además se ajustó, sin defecto que lo forzara

- Jerarquía del precio en la tarjeta: 17 → 18px en teléfono, peso 850, tracking
  cerrado y `tabular-nums`. Un punto de diferencia no cambia el alto de la caja
  —la interlínea del pie ya reservaba más— y sí cambia qué se lee primero.
- Fila de precio del combo ordenada por jerarquía real: precio nuevo 22px/900,
  tachado 12,5/600, porcentaje como sello con su hairline. Antes los tres iban
  casi al mismo peso y la fila se leía como tres datos en disputa.
- Dos renglones **reservados** para el nombre del producto: sin eso, en una fila
  de dos tarjetas el "473 ml" de la izquierda quedaba un renglón más arriba que
  el de la derecha.
- El plato del packshot lleva un anillo interior al 7%: es el canto del plato.
  Sin él, el bitmap —que trae su propio blanco horneado— se derrama hasta el
  borde. **No se tocó el `#fff` exacto del plato**: cualquier tinte o degradado
  haría visible el rectángulo del propio archivo.
- Máscara de desvanecido en la fila de categorías de la home, la que ya tenía el
  catálogo: cortaba el último chip con un canto duro.
- Chip de categoría elegido: sombra propia. Sin ella la píldora blanca queda a
  ras del fondo y se lee como un hueco recortado, no como el chip activo. Los
  demás suben de 12% a 16% de hairline.
- Barra inferior: 2 → 4px entre icono y etiqueta. El alto de la barra no cambia
  (la fila usaba 38 de los 44px disponibles).

---

## Cómo se mantuvo la identidad

No hay rediseño. Fondo negro/grafito, rojo intenso sólo para la acción, dorado
sutil para lo premium y lo pendiente, blanco reservado al producto y a la tinta,
tarjetas oscuras con esquinas redondeadas.

Las tres reglas del sistema que ya estaban escritas se respetaron al pie:

1. **El rojo es acción, no decoración.** Ni un rojo nuevo. El del bloque sin
   precio se achicó, no se cambió de color; los de Perfil se retiraron porque no
   eran acciones de compra.
2. **El dorado informa.** Es el acento de "pendiente" y de "premium", y ahí fue:
   +18, ahorro, precio próximamente, bloque sin precio, ubicación confirmada.
3. **El producto vive sobre blanco.** El plato sigue siendo `#fff` exacto por la
   razón por la que se eligió: los packshots traen el fondo horneado.

Todo cambio que introdujo un número lo hizo como token, no como literal.

---

## Validaciones

| Gate | Resultado |
|---|---|
| `npm run check` | **5/5 verde** |
| `npm test` | **1362/1362** |
| Playwright | **351/351** — 291 chromium + 60 mobile-webkit (16,9 min, puertos 8231/18831) |
| Desbordamiento horizontal | **0px** en las 13 pantallas, WebKit 390×844 |
| Contraste (suite propia del repo) | verde: «ningún texto de las vistas del cliente queda por debajo de 3:1» y «el texto de la home cumple el contraste mínimo» |
| Objetivo táctil | verde: «todo control de la home alcanza 44×44 en los anchos compactos» |

### Los cuatro avisos del shell, mirados uno por uno

`.pwa-banner` es una clase compartida: la usan el aviso de instalación, la guía
de iOS, "sin conexión" y el de actualización. Cambiar la grilla base y mirar
sólo el cuarto habría sido cambiar a ciegas —la guía de iOS es la única con
lista numerada y la única sin acción, así que es la que se rompe con una fila
declarada de más—. Las cuatro se capturan ahora en el arnés
(`04`, `04b`, `04c`, `04d`) y las cuatro se dibujan enteras.

### El pliegue útil, medido antes y después

Es el criterio que fijó la candidata del catálogo premium: dónde termina el
borde **inferior** del primer control de compra contra la ventana menos la barra
inferior. Un botón que termina un píxel por debajo no se puede tocar.

| Ventana | Base `4f49234` | Esta rama | |
|---|---|---|---|
| 390×844 | 759 / 788 | **758 / 788** | entra |
| 360×800 (Moto G15) | 743 / 744 | **741 / 744** | entra, con 2px más de margen |
| 412×915 | — | **802 / 859** | entra |
| 320×720 | 736 / 664 | **735 / 664** | **no entra, ni antes ni ahora** |

Los 320×720 siguen sin dar altura, exactamente como quedó dicho en el trabajo
anterior. Esta rama no lo empeora (mejora 1px) y tampoco lo resuelve.

**Una decisión se revirtió por esta medición.** Se había abierto el aire del
hero de 1 a 3px entre rótulo, título y puerta. A 360×800 eso movió el "Agregar"
de 743 a **745** con el pliegue en 744: dos píxeles de aire en un banner dejaban
el botón fuera de alcance. Volvió a 1px y quedó anotado en la propia regla.

---

## Riesgos reales que quedan abiertos

1. **Nada de esto está publicado.** Sin push y sin deploy, igual que la
   candidata sobre la que se apoya.
2. **El gate de higiene de la candidata nocturna estaba en rojo antes de esta
   rama.** `CANDIDATA-CLIENTE-OVERNIGHT-RC.md` —el informe de cierre de esa
   misma candidata, agregado en su último commit, después de correr su gate—
   trae seis rutas con letra de unidad y hace fallar `check-release-hygiene` y
   `tests/release-hygiene.test.mjs`. Verificado contra `4f49234` limpio. Se
   corrigió acá (se les sacó la letra de unidad, el resto del texto no se tocó)
   porque si no, no había forma de correr el gate en verde. **Es un cambio sobre
   el informe de otra sesión**: queda dicho para que no aparezca como sorpresa.
3. **El `?v=` de `styles.css` y la caja del service worker NO se bumpearon**, a
   propósito y por el mismo criterio que la candidata del catálogo premium: esto
   no habilita despliegue. Antes de publicar hay que rotarlos, y hay que hacerlo
   sabiendo lo que ya está documentado: en este repo el `?v` de `styles.css`
   **no protege a sus trece `@import`**, cada uno es su propia URL.
4. **El gate del iPhone real sigue pendiente.** Todo lo de acá se midió en
   WebKit de escritorio a 390×844 con `deviceScaleFactor: 2`, que es una buena
   aproximación y no es un teléfono. La tipografía de sistema de iOS no es la de
   este WebKit, y los altos de línea pueden mover uno o dos píxeles el pliegue,
   que es justo donde el margen es de dos.
5. **La deuda de contenido que no se tocó.** La tarjeta sin precio dice lo mismo
   tres veces: "Precio próximamente", "Este producto todavía no está disponible
   para compra" y un botón "Precio pendiente". Es texto, no estilo, y cambiarlo
   toca `js/ui.js` y sus pruebas. Se dejó jerarquizado (dorado / muted / botón)
   pero sigue siendo redundante.
6. **En móvil el control de orden no muestra qué orden está aplicado.** El
   `<select>` va con `opacity: 0` cubriendo el control y sólo se lee la palabra
   "Ordenar". Está documentado como decisión —el valor largo se recortaba— y no
   se cambió, pero es una decisión de producto que conviene revisar: hoy no hay
   forma de saber si la grilla está por recomendados o por menor precio sin
   abrir el selector.
