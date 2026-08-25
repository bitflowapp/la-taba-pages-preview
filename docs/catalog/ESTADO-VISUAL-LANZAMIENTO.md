# Estado visual del catálogo — lanzamiento comercial

Los 33 productos que la tienda publica hoy, con lo que dibuja cada tarjeta ahora
y lo que va a dibujar cuando se aplique el lote de fotografías. Medido el
2026-08-25 contra el catálogo productivo, no contra una lista histórica.

## El resumen

| | antes de esta versión | ahora | tras aplicar el lote |
|---|---|---|---|
| Fotografía oficial | 3 | 3 | **13** |
| Lámina propia de TABA (una por producto) | 0 | **30** | 20 |
| Mismo dibujo genérico para todos | **30** | 0 | 0 |
| Imagen INCORRECTA | 0 | **0** | **0** |
| Imagen AUSENTE | 0 | **0** | **0** |

**INCORRECT = 0** y **MISSING = 0** en los tres estados. Lo que cambia es la
calidad de lo que se ve cuando no hay fotografía: hasta esta versión eran treinta
tarjetas con el mismo envase gris; ahora cada producto tiene su propio dibujo,
con la silueta de su envase, el color de su línea y el tamaño de su formato.

## Las tres clasificaciones, y qué significa cada una

**PREMIUM_REAL** — fotografía del fabricante, del embotellador o de un
distribuidor oficial, sobre fondo blanco, sin sello de cantidad ni texto
promocional, con marca, variante, capacidad, envase y unidad verificados a ojo
contra la fila del SKU. Cada una pasó además por una verificación adversarial
independiente cuyo trabajo era refutarla.

**LAMINA_TABA** — obra propia del comercio, generada desde
`catalog/lamina-taba/especificacion.json`. No es una foto y no la imita: dice
envase, formato y color, que es lo que hace falta para reconocer una bebida
cuando el nombre está justo debajo. Su procedencia la prueba `npm run check`
regenerándola y comparando byte a byte.

**GENERICA** — el respaldo del respaldo, para un producto que todavía no tiene
pieza en la especificación. Hoy no lo usa ningún producto de la góndola.

## El catálogo, producto por producto

| producto | presentación | categoría | hoy | tras el lote | fuente |
|---|---|---|---|---|---|
| 7UP | 2 L | Gaseosas | lámina | LAMINA_TABA | obra propia |
| Coca-Cola | 2,25 L | Gaseosas | lámina | **PREMIUM_REAL** | coca-colaentucasa.com |
| Coca-Cola | 354 ml | Gaseosas | lámina | LAMINA_TABA | obra propia |
| Coca-Cola Original | 500 ml · pack x12 | Gaseosas | REAL | **PREMIUM_REAL** | andinacocacolaar.vteximg.com.br |
| Coca-Cola Original | 1,5 L | Gaseosas | lámina | LAMINA_TABA | obra propia |
| Coca-Cola Zero | 2,25 L | Gaseosas | lámina | **PREMIUM_REAL** | coca-colaentucasa.com |
| Coca-Cola Zero | 500 ml · pack x12 | Gaseosas | REAL | **PREMIUM_REAL** | andinacocacolaar.vteximg.com.br |
| Coca-Cola Zero | 354 ml | Gaseosas | lámina | LAMINA_TABA | obra propia |
| Fanta Naranja | 2,25 L | Gaseosas | lámina | LAMINA_TABA | obra propia |
| Pepsi | 2 L | Gaseosas | lámina | LAMINA_TABA | obra propia |
| Pepsi Black | 1,5 L | Gaseosas | lámina | LAMINA_TABA | obra propia |
| Sprite | 500 ml · pack x12 | Gaseosas | REAL | **PREMIUM_REAL** | andinacocacolaar.vteximg.com.br |
| Sprite | 2,25 L | Gaseosas | lámina | **PREMIUM_REAL** | coca-colaentucasa.com |
| Sprite | 354 ml | Gaseosas | lámina | **PREMIUM_REAL** | coca-colaentucasa.com |
| Sprite Zero | 2,25 L | Gaseosas | lámina | **PREMIUM_REAL** | coca-colaentucasa.com |
| Benedictino | 2,25 L | Aguas | lámina | **PREMIUM_REAL** | coca-colaentucasa.com |
| Villa del Sur | 600 ml | Aguas | lámina | LAMINA_TABA | obra propia |
| Villavicencio | 500 ml | Aguas | lámina | LAMINA_TABA | obra propia |
| Villavicencio | 1,5 L | Aguas | lámina | LAMINA_TABA | obra propia |
| Aquarius Manzana | 1,5 L | Aguas saborizadas | lámina | LAMINA_TABA | obra propia |
| Aquarius Pera | 1,5 L | Aguas saborizadas | lámina | LAMINA_TABA | obra propia |
| Aquarius Pomelo | 2,25 L | Aguas saborizadas | lámina | LAMINA_TABA | obra propia |
| Monster Green Zero | 473 ml | Energizantes | lámina | **PREMIUM_REAL** | web-assests.monsterenergy.com |
| Red Bull | 250 ml | Energizantes | lámina | LAMINA_TABA | obra propia |
| Red Bull Sugarfree | 250 ml | Energizantes | lámina | LAMINA_TABA | obra propia |
| Speed | 473 ml | Energizantes | lámina | LAMINA_TABA | obra propia |
| Speed Zero | 473 ml | Energizantes | lámina | LAMINA_TABA | obra propia |
| Gatorade Cool Blue | 500 ml | Isotónicas | lámina | LAMINA_TABA | obra propia |
| Gatorade Manzana | 1,25 L | Isotónicas | lámina | LAMINA_TABA | obra propia |
| Powerade Mountain Blast | 500 ml | Isotónicas | lámina | LAMINA_TABA | obra propia |
| Paso de los Toros Pomelo | 1,5 L | Mixers | lámina | **PREMIUM_REAL** | boulevard-sa.com.ar |
| Paso de los Toros Tónica | 1,5 L | Mixers | lámina | **PREMIUM_REAL** | boulevard-sa.com.ar |
| Soda Manaos | 2 L | Mixers | lámina | **PREMIUM_REAL** | www.manaosargentina.com |

## Lo que falta para que las diez fotos aparezcan

Los archivos WebP ya viajan en el paquete publicado. Lo único pendiente es
**asociarlos a sus productos en la base**, y eso exige una sesión de owner
autenticada: el `UPDATE` directo sobre `products` está revocado para
`authenticated`, y la única puerta con permiso es `import_catalog_batch`.

```
node scripts/catalog-images/apply-association.mjs --dry-run     # ensayo, no escribe
<token de owner> | node scripts/catalog-images/apply-association.mjs
```

El ensayo en seco llega hasta el payload y se planta en
`fanta-naranja-botella-pet-1500-ml-pack-x6`, que hoy está fuera de venta: la
clave publicable no devuelve los productos ocultos y la sesión de owner sí. No es
un error del lote.

El aplicador entra en modo `ALTA_PARCIAL`: los tres packs ya tienen su fotografía
desde agosto y las diez unidades no tienen ninguna. Reescribe las trece con los
mismos bytes —es idempotente por diseño— y vuelve a publicar todo al final,
porque tocar la imagen desverifica el producto y dejarlo fuera de venta es peor
que cualquier error que se esté manejando.

## Lo que se rechazó, y por qué importa

| producto | fuente candidata | por qué NO entró |
|---|---|---|
| Fanta Naranja 2,25 L | coca-colaentucasa.com | el render vigente es una **edición co-marcada Call of Duty × Xbox**: la etiqueta trae el wordmark del videojuego. No es el envase que se entrega. |
| Coca-Cola lata 354 ml (Original y Zero) | coca-colaentucasa.com | sólo existen como edición Copa Mundial **por país** —la Original en versión Brasil— y no dejan distinguir Original de Zero. |
| Gatorade Cool Blue 500 ml | distribuidorarel.com.ar | la capacidad no es legible en la imagen, y es el único campo que el contrato exige exacto. |
| Gatorade Manzana 1,25 L | boulevard-sa.com.ar | misma razón. |
| Powerade Mountain Blast 500 ml | coca-cola.com/ar | el render de la marca declara **995 mL** en la etiqueta, no 500. |
| Coca-Cola Original 1,5 L | — | la presentación no existe en el catálogo de FEMSA Buenos Aires (ahí va 1,75 L); en Andina existe pero siempre en pack y con sello. |
| Aquarius (3 sabores) | coca-colaentucasa.com | su única imagen trae una banda gráfica lateral que ocupa el 24 % derecho. Es recortable sin repintar nada, pero recortar es una decisión que nadie tomó todavía. |
| Quilmes lata 473 ml (4 variantes) | quilmes.com.ar | packshots legítimos del fabricante, pero **ninguno de esos SKU existe en el catálogo** y la venta de alcohol sigue deshabilitada. |

Una imagen incorrecta es peor que el respaldo. Los ocho rechazos de arriba son la
razón por la que este trabajo cierra con trece fotos y no con veinte.

## Lo que destrabaría el resto

1. **Un paquete de packshots provisto por cada marca.** Es lo único que resuelve
   PepsiCo, Danone Aguas, Red Bull y Speed de una vez: sus dominios de marca
   argentinos no resuelven o devuelven 403, medido host por host el 2026-08-25.
2. **Fotografía propia del comercio.** `catalog/photo-capture/PHOTO_CAPTURE_SHOT_LIST.csv`
   ya tiene la lista de tomas y entraría como `PROPIO`, sin depender de nadie.
3. **Una decisión sobre el recorte de Aquarius.** Tres SKU a un `crop` de
   distancia, sin repintar un píxel del producto.
