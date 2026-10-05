# Campañas animadas — diseño

Rama `feat/taba-frontend-commercial-polish`. Estado: **motor y cuatro escenas
listos; todas las campañas apagadas** hasta que el comercio las apruebe.

## Qué es

Una **campaña** es una pieza editorial con una escena animada: muestra un
producto que el local vende y lleva a su ficha. No es una promoción. No declara
precio, porcentaje ni oferta: eso tiene su propio contrato validado
(`js/core/promotions.js`) y su propio camino a pantalla.

**Lo que la pieza muestra del producto sale del producto.** La marca del
rótulo, el nombre y la presentación del subtítulo, la foto aprobada y el
**precio vivo** llegan del catálogo, con las mismas funciones que usa la
tarjeta (`cardTitle`, `cardPresentationLine`, `productPricePresentation` +
`pricingLabel`, `discountPercent`). La configuración sigue sin un solo campo de
dinero y su texto sigue sin poder nombrarlo: el precio que se ve es el de la
góndola, cambia con ella por Realtime y desaparece con la pieza cuando el
producto deja de poder comprarse. Tachado, porcentaje y condición existen sólo
si hay una promoción validada activa —en producción, nunca— y no entran en la
banda del teléfono, donde el importe comparte renglón con la acción.
`tests/e2e/campaigns.spec.mjs` (PROMO_PRODUCT_MATCHES_CATALOG) lo comprueba
contra las filas del backend, la tarjeta, la ficha y el carrito.

Todo está hecho con HTML, CSS y JavaScript nativo. No hay librerías, canvas,
WebGL, video ni sonido. Las escenas no piden ninguna imagen.

## Archivos

```text
js/campaigns/
  campaign-config.js      las campañas, por configuración (todas apagadas)
  campaign-engine.js      decide si se muestra, elige una por superficie, escribe el HTML
  campaign-motion.js      decide cuándo corre cada escena (un IntersectionObserver)
  presets/
    shared.js             el envase genérico y utilidades de color
    beer-pour.js          beer_pour
    cold-can.js           cold_can
    product-drop.js       product_drop
    ice-reveal.js         ice_reveal
styles/campaigns.css      la animación entera
scripts/campaign-lab/     laboratorio de QA (no entra a ningún paquete publicado)
```

El pedido proponía `promotions/promotion-engine.js`. Se usó `campaigns/` porque
en este proyecto «promoción» ya significa otra cosa: una oferta con precio,
vigencia y aprobación (`core/promotions.js`). Llamar igual a una pieza que
justamente NO puede afirmar un precio habría mezclado dos contratos.

| Archivo | Bytes | gzip |
|---|---:|---:|
| styles/campaigns.css | 38.389 | 9.225 |
| campaign-engine.js | 11.448 | 4.372 |
| campaign-motion.js | 7.015 | 2.719 |
| campaign-config.js | 4.067 | 1.702 |
| presets/ (5 archivos) | 8.621 | 4.300 |

## Una campaña

```js
{
  id: 'heineken-beer-pour',
  type: 'editorial',
  enabled: false,                                   // llave 1
  approval: { status: 'PENDIENTE', reference: '' }, // llave 2
  validFrom: '', validUntil: '',
  priority: 40,
  placements: ['home-hero', 'catalog-inline'],
  contexts: ['cervezas'],
  target: { type: 'product', skus: ['heineken-710ml'] },
  creative: { preset: 'beer_pour', vessel: 'can', tint: '#0c7a35', accent: '#e2231a' },
  copy: { eyebrow: 'Heineken', headline: 'Bien fría, recién servida', cta: 'Ver Heineken' },
}
```

El **subtítulo no se escribe**: sale del nombre y la presentación reales del
producto, con las mismas funciones que usa la tarjeta. La campaña no puede decir
otro nombre que el de la góndola.

Hay cuatro candidatas, una por escena: Heineken 710 ml (`beer_pour`), Red Bull
355 ml (`cold_can`), Coca-Cola 2,25 L (`product_drop`) y Aperol 750 ml
(`ice_reveal`). Los cuatro productos existen en el catálogo real.

## Qué tiene que pasar para que una pieza se vea

Falla cerrado en cadena. Se descarta si:

1. `enabled` no es `true`;
2. la aprobación no es `APROBADA` **con** referencia (quién y cuándo);
3. está fuera de vigencia, o una fecha no se puede leer;
4. el preset no existe o no hay superficie válida;
5. el texto afirma dinero, urgencia o popularidad (`$`, `%`, oferta, promo,
   descuento, gratis, 2x1, últimas unidades, la más vendida, antes…);
6. el producto no está en el catálogo, o no se puede comprar **ahora**
   (sin precio, sin stock, pausado, alcohol en vidriera);
7. la persona la ocultó en esta visita.

Encender una sola de las dos llaves no muestra nada. Si el producto se queda sin
stock, la pieza se va sola en el siguiente render y vuelve la vidriera de
siempre.

No existe ninguna bandera de URL ni gancho global que encienda una campaña en la
tienda. En QA se prueba sirviéndole al navegador otro archivo de configuración
(`tests/e2e/campaigns-fixture.mjs`) o con el laboratorio.

## Dónde aparece

| Superficie | Regla |
|---|---|
| `home-hero` | La banda de apertura de la home. Reemplaza a la puerta editorial y ocupa **la misma caja**: 80–112 px en teléfono, 268 px en escritorio. La puerta editorial sigue siendo la pieza por defecto. |
| `home-inline` | Una franja después del primer carrusel. Sin campaña, el hueco queda oculto. |
| `catalog-inline` | Una sola pieza en la grilla, tras la 4.ª tarjeta. Nunca en una búsqueda, con filtros ni en una lista de menos de 8 productos. |

En la home la misma campaña no ocupa dos lugares.

**Alcohol.** Un producto con alcohol lleva sola la leyenda «Beber con
moderación. Prohibida su venta a menores de 18 años.» (ley 24.788, art. 6): la
agrega el motor, no es un campo de la campaña. Y no se amplía la exposición:
puede ocupar la banda de apertura —que ya era una puerta de cervezas— y la
grilla de su propio rubro; nunca la franja intermedia de la home ni «Todas».

## Cómo se anima

**El cuadro final es la regla base.** Cada elemento de la escena está escrito,
en su regla CSS base, en su posición final: vaso lleno, envase parado, texto a
la vista. Eso es lo que se ve sin el módulo de movimiento, con movimiento reducido, en modo
liviano o si algo falla. Cuando `campaign-motion.js` marca la raíz con
`data-motion-campaign="on"`, cada elemento recibe una animación que **termina
exactamente en ese mismo cuadro**. No existe un estado intermedio roto.

**Sólo `transform` y `opacity`.** Nada cambia de tamaño ni vuelve a maquetar.
Sin `filter: blur`: los resplandores son degradados radiales. Una prueba lee la
hoja y falla si una animación toca otra propiedad.

**Una sola línea de tiempo por escena.** Todos los elementos duran lo mismo
(`--cmp-dur`) y se reparten por porcentajes, así pausar y reanudar no los
desincroniza.

**Marcado estático.** La escena es una cadena, función pura de la configuración.
No se crean nodos en tiempo de ejecución: las burbujas, gotas y partículas son un
cupo fijo que existe desde el primer render. Importa por dos razones: el catálogo
parchea el DOM por identidad y compara el HTML como versión, y `js/motion.js`
observa el documento entero —un nodo nuevo dispara una recolección completa—.

**El llenado sin simulación.** El líquido es una ventana que sube mientras su
contenido baja lo mismo: el líquido parece quieto y lo único que se mueve es la
superficie. La espuma mide un quinto de la ventana y baja «cinco veces su alto»,
así queda pegada al borde con la misma curva.

**Unidad.** La escena mide 11 × 10 unidades; la unidad es un décimo del alto de
la pieza. La misma escena sirve a 80 px y a 268 px.

### beer_pour — 5,6 s, 37 nodos

| Tramo | Qué pasa |
|---|---|
| 0–9 % | aparece el vaso |
| 5–23 % | el envase entra desde arriba a la derecha |
| 23–31 % | se inclina |
| 30–35 % | cae el chorro |
| 34–70 % | el vaso se llena; la espuma sube con la superficie |
| 68–73 % | corta el chorro |
| 71–94 % | el envase vuelve y se asienta, con un rebote mínimo |
| 62–84 % | corona de espuma |
| 28–44 % | subtítulo, precio y acción (todas las escenas) |
| después | siete burbujas suben, seis veces cada una, y se detienen |

### cold_can — 4,2 s, 31 nodos

El envase llega desde la derecha con una rotación mínima y se acomoda (0–46 %);
aparece la condensación (38–72 %); un brillo lo recorre (46–66 %). Después: tres
gotas bajan por la superficie, seis partículas frías flotan y una niebla baja se
mueve, un rato.

### product_drop — 3,2 s, 17 nodos

El producto baja y desacelera (0–46 %), rebota apenas (46–90 %); la sombra crece
y se contrae con él y un aro marca el impacto. Después **no queda nada
animándose**: es la escena más barata.

### ice_reveal — 4,6 s, 28 nodos

Una niebla fría se abre (0–46 %) y deja ver el producto (10–42 %); cinco cubos de
hielo se acomodan de a uno (14–58 %) —dos detrás, tres adelante—; aparece la
escarcha (38–72 %). Después: vapor tenue y una gota, un rato.

## Cuándo corre

- **Arranca** cuando el 40 % de la pieza está a la vista.
- **Se pausa** cuando sale de pantalla o la pestaña queda oculta
  (`animation-play-state: paused`), y sigue donde estaba al volver.
- **No se repite** al subir y bajar: recién vuelve a correr si pasaron 45 s
  desde que terminó.
- **Los bucles terminan solos**: burbujas, gotas y vapor hacen seis vueltas y se
  detienen. Una pieza que queda a la vista deja de moverse a los ~25 s.
- **Sin temporizadores.** El módulo no usa `setTimeout`, `setInterval` ni
  `requestAnimationFrame`: hay un IntersectionObserver y la escena avanza sola en
  el compositor. Tres oyentes (`visibilitychange`, `error`, cambio de
  preferencia), los tres se quitan al destruir.

## Movimiento reducido

Con `prefers-reduced-motion: reduce` el módulo no enciende la escena, y la hoja
tiene una segunda llave (`animation: none !important` dentro de `.cmp`). La pieza
se ve en su cuadro final: título, subtítulo, acción y leyenda legal a la vista.
Lo mismo en modo liviano (ahorro de datos o poca memoria).

## Respaldo

- La escena no carga nada de la red: no puede quedar un hueco por una imagen.
- Si el módulo de movimiento no arranca, lo atrapa su propio `try/catch`, la
  tienda abre igual y las piezas quedan estáticas. Hay una prueba que rompe el
  observador a propósito.
- No hay cargadores ni estados de espera.

## Accesibilidad

- Toda la pieza es **un botón** que abre la ficha del producto; su nombre
  accesible dice título, producto, precio y acción.
- La escena es `aria-hidden`: es decorativa y no hace falta para entender nada.
- La leyenda legal va fuera del botón: es texto que se lee.
- **Ocultar**: botón de 44 × 44 px con nombre «Ocultar este anuncio». Vale por la
  visita. El foco pasa a lo que ocupe ese lugar y se avisa por la región viva.
  Es además el mecanismo que pide WCAG 2.2.2 para contenido que se mueve más de
  cinco segundos.
- Se recorre con teclado; anillo de foco visible.
- axe-core (WCAG 2.0/2.1/2.2 A y AA): 0 violaciones con las campañas encendidas.

## Lo que no hace

Ventanas emergentes, pantalla completa, sonido, bloqueo de scroll, modales al
entrar, elementos que sigan al usuario, cuentas regresivas, urgencia.

## El envase es genérico, a propósito

Lo que se anima es una silueta (lata o botella) con el color de la campaña. No
lleva logotipo, tipografía ni emblema de ninguna marca. Una creatividad con marca
tiene que salir del lote curado con procedencia registrada; acá no se dibuja ni
se genera una. La relación con el producto real la dan el texto —que sale del
catálogo— y la ficha a la que lleva.

## Laboratorio

```text
node scripts/realtime-relay.mjs 8080
http://127.0.0.1:8080/scripts/campaign-lab/
```

Muestra las cuatro escenas con los dos envases en tres tamaños, con el mismo
motor y la misma hoja que la tienda. Parámetros para capturas reproducibles:
`?only=beer_pour&vessel=bottle&placement=home-hero&w=358&t=2.4` (congela la
escena en ese segundo) y `&static=1` (el cuadro de respaldo).

## Para encender una campaña

1. El comercio aprueba texto, producto y vigencia.
2. En `campaign-config.js`: `enabled: true` y
   `approval: { status: 'APROBADA', reference: '<quién, cuándo>' }`.
3. `npm test` y la suite E2E. Las pruebas no dejan pasar un texto con precio ni
   una campaña sobre un producto que no existe.
4. Subir la versión de caché y volver a firmar la identidad
   (`npm run release:identity`), como con cualquier cambio de la tienda.
5. Si la campaña toma la banda de apertura, quitar del `index.html` la precarga
   de la foto de la puerta editorial: deja de usarse y el navegador lo avisa en
   la consola.

## Límites conocidos

- En la banda del teléfono (80–112 px de alto) la escena mide ~90 px de lado: se
  lee como un acento, no como un afiche. El alto no se puede subir sin sacar el
  primer «Agregar» del pliegue a 360 × 800. En la franja intermedia, en la grilla
  y en escritorio la escena mide el doble o el triple.
- `color-mix()` tiñe el fondo de la pieza. Un navegador que no lo soporta
  (Safari anterior a 16.2) usa el fondo grafito de base.
- La hoja de campañas se carga con el resto del CSS aunque no haya campañas
  encendidas: 9,2 kB comprimidos.
