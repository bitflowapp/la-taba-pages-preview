# Estado visual del catálogo — lanzamiento comercial

Los 33 productos que la tienda publica hoy, con lo que dibuja cada tarjeta ahora
y lo que va a dibujar cuando se aplique el lote de fotografías. Medido el
2026-08-25 contra el catálogo productivo, no contra una lista histórica.

## La regla

**FOTOGRAFÍA REAL DEL PRODUCTO EXACTO = pasa. Cualquier sustituto generado = no
pasa.** Sin foto correcta, la tarjeta muestra el marcador propio de TABA, que es
deliberadamente neutro y no imita a ningún producto.

Se probó un camino intermedio —una lámina dibujada por producto, con la silueta
de su envase y el color de su línea— y se descartó: una aproximación dibujada de
una Coca-Cola no es una Coca-Cola, y en una tienda que vende marcas reales un
sustituto generado se lee peor que un marcador honesto.

## El resumen

| | hoy en producción | tras aplicar el lote |
|---|---|---|
| Fotografía real del producto exacto | 3 | **18** |
| Marcador neutro de TABA | 30 | 15 |
| Imagen INCORRECTA | **0** | **0** |
| Imagen AUSENTE | **0** | **0** |

Las 18 son packshots del fabricante, del embotellador o de un distribuidor
oficial, sobre fondo blanco, con la etiqueta argentina, sin sello de cantidad ni
texto promocional, y con marca, variante, capacidad, envase y unidad verificados
mirando la imagen contra la fila del SKU.

## El catálogo, producto por producto

| producto | presentación | categoría | hoy | tras el lote | fuente |
|---|---|---|---|---|---|
| 7UP | 2 L | Gaseosas | marcador | marcador | — |
| Coca-Cola | 2,25 L | Gaseosas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Coca-Cola | 354 ml | Gaseosas | marcador | marcador | — |
| Coca-Cola Original | 500 ml · pack x12 | Gaseosas | foto | **FOTO REAL** | andinacocacolaar.vteximg.com.br |
| Coca-Cola Original | 1,5 L | Gaseosas | marcador | marcador | — |
| Coca-Cola Zero | 2,25 L | Gaseosas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Coca-Cola Zero | 500 ml · pack x12 | Gaseosas | foto | **FOTO REAL** | andinacocacolaar.vteximg.com.br |
| Coca-Cola Zero | 354 ml | Gaseosas | marcador | marcador | — |
| Fanta Naranja | 2,25 L | Gaseosas | marcador | marcador | — |
| Pepsi | 2 L | Gaseosas | marcador | marcador | — |
| Pepsi Black | 1,5 L | Gaseosas | marcador | marcador | — |
| Sprite | 500 ml · pack x12 | Gaseosas | foto | **FOTO REAL** | andinacocacolaar.vteximg.com.br |
| Sprite | 2,25 L | Gaseosas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Sprite | 354 ml | Gaseosas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Sprite Zero | 2,25 L | Gaseosas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Benedictino | 2,25 L | Aguas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Villa del Sur | 600 ml | Aguas | marcador | marcador | — |
| Villavicencio | 500 ml | Aguas | marcador | marcador | — |
| Villavicencio | 1,5 L | Aguas | marcador | marcador | — |
| Aquarius Manzana | 1,5 L | Aguas saborizadas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Aquarius Pera | 1,5 L | Aguas saborizadas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Aquarius Pomelo | 2,25 L | Aguas saborizadas | marcador | **FOTO REAL** | coca-colaentucasa.com |
| Monster Green Zero | 473 ml | Energizantes | marcador | **FOTO REAL** | web-assests.monsterenergy.com |
| Red Bull | 250 ml | Energizantes | marcador | marcador | — |
| Red Bull Sugarfree | 250 ml | Energizantes | marcador | marcador | — |
| Speed | 473 ml | Energizantes | marcador | marcador | — |
| Speed Zero | 473 ml | Energizantes | marcador | marcador | — |
| Gatorade Cool Blue | 500 ml | Isotónicas | marcador | **FOTO REAL** | boulevard-sa.com.ar |
| Gatorade Manzana | 1,25 L | Isotónicas | marcador | **FOTO REAL** | boulevard-sa.com.ar |
| Powerade Mountain Blast | 500 ml | Isotónicas | marcador | marcador | — |
| Paso de los Toros Pomelo | 1,5 L | Mixers | marcador | **FOTO REAL** | boulevard-sa.com.ar |
| Paso de los Toros Tónica | 1,5 L | Mixers | marcador | **FOTO REAL** | boulevard-sa.com.ar |
| Soda Manaos | 2 L | Mixers | marcador | **FOTO REAL** | www.manaosargentina.com |

## Lo que falta para que las fotos aparezcan

Los archivos WebP ya viajan en el paquete publicado. Lo único pendiente es
**asociarlos a sus productos en la base**, y eso exige una sesión de owner
autenticada: el `UPDATE` directo sobre `products` está revocado para
`authenticated` y la única puerta con permiso es `import_catalog_batch`.

```
node scripts/catalog-images/apply-association.mjs --dry-run     # ensayo, no escribe
<token de owner> | node scripts/catalog-images/apply-association.mjs
```

El ensayo en seco llega hasta el payload y se planta en
`fanta-naranja-botella-pet-1500-ml-pack-x6`, que hoy está fuera de venta: la
clave publicable no devuelve los productos ocultos y la sesión de owner sí. No es
un error del lote.

La evidencia visual de cómo va a quedar está en
`artifacts/taba-premium-catalog/packshots/`: son capturas de la tienda REAL con
las fotografías puestas en la tarjeta real, no una maqueta.

## Los recortes, y por qué no son un retoque

Cinco de las dieciocho llevan un recorte declarado en
`catalog/recortes-declarados.json`. Un recorte no fabrica una imagen: los
píxeles del producto quedan intactos. Sirve para dos cosas y ninguna más:

1. **Sacar una banda de marketing lateral** que el embotellador estampa para su
   propia vidriera (los tres Aquarius).
2. **Corregir un encuadre** en el que la botella chica queda diminuta y
   descentrada dentro del lienzo que el distribuidor usa para la familiar (los
   dos Gatorade).

La regla se verifica mecánicamente antes de aplicarse: el corte tiene que pasar
por un canal de al menos 24 columnas de **blanco puro** y el producto tiene que
quedar entero del lado que se conserva. Si el rectángulo se acercara al envase,
el canal desaparece y `normalize.mjs` se planta sin escribir nada.

**No habilita** retocar, repintar, ni sacar un sello estampado ENCIMA del
envase: ése sigue siendo motivo de rechazo, porque quitarlo exigiría inventar
los píxeles que tapa.

## Lo que se rechazó, y por qué importa

| producto | fuente candidata | por qué NO entró |
|---|---|---|
| Coca-Cola lata 354 ml Original | coca-colaentucasa.com | la que publica el embotellador es la versión **BRASIL** |
| Coca-Cola lata 354 ml Zero | coca-colaentucasa.com | edición **Copa Mundial** con los colores de la Selección: no es la lata que se vende |
| Fanta Naranja 2,25 L | FEMSA / Andina | FEMSA devuelve su propio placeholder para ese SKU; Andina sólo la tiene con el sello «x6» **pisando el envase**. Dos embotelladores, ninguna foto |
| Coca-Cola Original 1,5 L | FEMSA / Andina | FEMSA llega hasta 1,75 L; Andina, otra vez con sello |
| Powerade Mountain Blast 500 ml | coca-colaentucasa.com | edición coleccionable «Argentina Campeón» con fotos de jugadores, y el pack de seis dentro del cuadro |
| Pepsi Black 1,5 L | boulevard-sa.com.ar | foto correcta, pero el envase trae impreso un flash **«SUPER Precios!»**: anunciaría una promoción que La Taba no está haciendo |
| Red Bull 250 ml y Sugarfree | boulevard-sa.com.ar | reales y exactas, pero el producto mide **209 px** de alto en el original: en una tarjeta de 400 px se ve blando |
| Pepsi 2 L · 7UP 2 L | boulevard-sa.com.ar | a esa capacidad el distribuidor sólo publica el **retornable**, y no está confirmado que sea el envase que La Taba vende |
| Villa del Sur 600 ml | ccu.com.ar/ado | la única foto oficial trae **«PACK AHORRO 100 ml MÁS»** impreso en la etiqueta |
| Villavicencio 1,5 L y 500 ml con gas | ccu.com.ar/ado | la marca publica 2 L y 2,25 L: no son nuestras capacidades |
| Speed 473 ml y Speed Zero | — | la marca no publica ninguna imagen alcanzable; dos dominios homónimos son de otras empresas |

Una imagen incorrecta es peor que el marcador. Esos once rechazos son la razón
por la que este trabajo cierra con dieciocho fotos y no con veintinueve.

## Lo que destrabaría el resto

1. **Un paquete de packshots provisto por cada marca.** Resuelve PepsiCo, Danone
   Aguas, Red Bull y Speed de una vez: sus dominios de marca argentinos no
   resuelven o devuelven 403, medido host por host el 2026-08-25.
2. **Fotografía propia del comercio.** `catalog/photo-capture/PHOTO_CAPTURE_SHOT_LIST.csv`
   ya tiene la lista de tomas y entraría como `PROPIO`, sin depender de nadie.
   Es la única vía que resuelve Fanta 2,25 L y Coca-Cola 1,5 L, que son producto
   de primera línea y hoy no tienen foto en ningún embotellador.
