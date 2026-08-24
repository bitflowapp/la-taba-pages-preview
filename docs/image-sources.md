# Fuentes y trazabilidad de imágenes

No se publican imágenes de bebidas parecidas, reconstruidas con IA ni
descargadas sin comprobar producto y derechos.

## Estado al 2026-08-24

De los 33 SKU que hoy se pueden comprar en la tienda pública, **3 muestran
fotografía real** —los tres packs x12 con packshot oficial del embotellador— y
**30 muestran el recurso propio de TABA**. Ninguno muestra un producto que no
sea el suyo, y ninguno declara una ruta que no exista: 0 incorrectas, 0
ausentes. El mapa completo, SKU por SKU, está en
`docs/catalog/gondola-publica-imagenes.csv` y se regenera con
`npm run catalog:images:audit`.

Pero «30 en respaldo» junta dos situaciones que no se parecen, y la auditoría
las separa en su columna `clasificacion`:

| Clasificación | SKU | Qué significa |
| --- | ---: | --- |
| `OFFICIAL_EXACT` | 3 | packshot del embotellador, identidad exacta y derechos |
| `AUTHORIZED_EXACT` | 0 | ídem, pero publicado por un distribuidor oficial |
| `BLOCKED_IDENTITY` | 15 | la fuente oficial **sí publica** este producto exacto, pero su imagen anuncia un pack y no se puede limpiar |
| `BLOCKED_RIGHTS` | 0 | la imagen exacta existe pero la autorización no cubre a quien la publica |
| `FALLBACK` | 15 | no hay fuente oficial alcanzable en el mundo |

La diferencia es operativa, no cosmética: los 15 `BLOCKED_IDENTITY` se destraban
con un correo a la marca pidiendo el packshot sin sello; los 15 `FALLBACK`, sólo
con fotografía propia. No existe una clasificación `SIMILAR`, y no debe existir:
una imagen parecida es una imagen incorrecta.

Las 30 siguen en fallback por un motivo medido, no por falta de trabajo: la
única fuente oficial alcanzable —la tienda del embotellador Coca-Cola Andina—
es mayorista y publica 184 listados, **ninguno de una unidad suelta**. Su
packshot es la foto de una sola botella, correcta y con fondo blanco, pero con
un sello de cantidad («x6») estampado encima. Medidas **las 21 imágenes** que
esa tienda publica para los 15 SKU candidatos —la portada de cada producto y
las seis alternativas de la lata 354 ml—, las 21 traen sello y en las 21 el
sello **pisa el envase**: tapa entre 469 y 2.238 píxeles de producto, así que
no se puede quitar sin repintar. La medición está en
`catalog/sello-de-pack-medicion.json` y se rehace con
`npm run catalog:images:sello`.

Lo que lo destraba es una de dos cosas, y las dos son del comercio: un paquete
de packshots sin sello provisto por la marca, o fotografía propia —la lista de
tomas ya está en `catalog/photo-capture/PHOTO_CAPTURE_SHOT_LIST.csv`—.

### Segunda ronda de fuentes (2026-08-24)

La mitad de la góndola no es del sistema Coca-Cola, así que la primera ronda
dejó anotada una lista de marcas por investigar. Se investigaron. Ninguna de
las seis empresas publica packshots alcanzables por medio programático, y cada
negativa quedó escrita en `catalog/image-source-allowlist.json` (`sinFuente`)
para que nadie la vuelva a averiguar:

| Empresa | Marcas del catálogo | Qué se encontró |
| --- | --- | --- |
| Cervecería y Maltería Quilmes | Pepsi, 7UP, Paso de los Toros, Gatorade | Es quien embotella el portafolio PepsiCo en Argentina y su sitio lo confirma, pero de cada marca publica un **logotipo de 225×140 px**, no un packshot |
| Gatorade LATAM (`gatorade.lat/ar`) | Gatorade | Responde 200 con un bloqueo de Incapsula en el cuerpo |
| Refres Now S.A. | Manaos | `manaos.com.ar` es un dominio estacionado en venta; el dominio del fabricante sirve un login de Outlook |
| Danone Aguas | Villa del Sur, Villavicencio | 202 con desafío `sgcaptcha`; sin catálogo detrás |
| CCU Argentina | — | Su portafolio son cervezas, sidras y vinos: no toca ningún SKU visible |
| Red Bull / Monster | Red Bull, Monster | 403 al agente automático, como en la primera ronda |

**La trampa que dejó la ronda.** `www.speed.com.ar` descarga un catálogo
perfecto… de *Speed Anticloro*, antiparras y gorras de natación: otra empresa
con el mismo nombre de marca. Es exactamente lo que un matcher por coincidencia
de dominio habría aceptado sin mirar, y es la razón por la que una fuente entra
por marca revisada a mano y no por dominio.

### Ediciones limitadas

El único candidato oficial que corresponde a `coca-cola-original-lata-354ml` es
la lata de la «Edición Países Mundialistas»: **mismo GTIN** (7790895000232),
misma capacidad, mismo envase, y siete diseños de país distintos. Aunque el
sello desapareciera, esa foto no puede ir a la ficha de la lata estándar: el
cliente vería una lata de Brasil y recibiría cualquier otra. Coincidir en GTIN
no es coincidir en identidad visual. El matcher ya la marca `MEDIUM` —«la línea
no es idéntica»— y sólo se publica lo que da `HIGH`; hay una regresión que fija
esa conducta, porque el día que se afloje la edición limitada entra sola.

### Por qué el respaldo se ve como respaldo

El recurso propio de TABA es una silueta genérica de botella con la gota de la
marca propia: no lleva logotipo de terceros, no imita ningún envase real y no
puede confundirse con una fotografía. Además cada tarjeta sin foto se anuncia
por texto accesible. Es una decisión, no un pendiente: mientras el respaldo se
lea como respaldo, agregarle una leyenda visible es una decisión de copy
comercial, no una corrección técnica.

## Placeholder de preview

| Archivo | Rol | Fuente | Uso permitido |
| --- | --- | --- | --- |
| `assets/products/beverage-placeholder.svg` | Ilustración neutra | Creada dentro del repositorio | Preview privado únicamente; no representa una marca, variante, capacidad, envase ni pack comercial |

Su SHA-256 y estado están registrados en
`docs/final-commercial-release/catalog-asset-audit.csv`.

## Emblema de marca

| Archivo | Rol | Fuente | Estado |
| --- | --- | --- | --- |
| `assets/brand/taba2-emblem.svg` | Emblema de La Taba 2 en el encabezado de la home | Dibujado en vector dentro del repositorio, reproduciendo el emblema de la referencia visual aprobada por el comercio | **Provisorio** hasta recibir el archivo original de marca |

Es vector y no un recorte del mockup a propósito: en esa pieza el emblema mide
~148 px y la home lo pinta a 250 px físicos en el Moto G15, así que un
reescalado habría llegado borroso justo en el texto curvo.

No es una imagen de producto ni afirma nada comercial, así que no entra en la
cadena de abajo. Cuando el comercio entregue su archivo original, reemplazarlo
es cambiar ESE archivo: conserva el nombre y el lienzo cuadrado. El ícono de la
aplicación (`assets/icon.svg`) sigue siendo la marca reducida, porque a 48 px el
texto curvo del emblema deja de leerse.

## Artefactos de preview retirados

Las cuatro fuentes JPG del build v36 y sus cuatro recortes de la preview v37
quedaron fuera del candidato porque ya no tienen consumidores en el runtime y
el empaquetador publicaba todo `assets/` de manera recursiva. La trazabilidad
histórica permanece en Git, pero esos ocho artefactos no forman parte del árbol
publicable ni del precache.

El catálogo de 22 bebidas de `?demo=1` utiliza exclusivamente los WebP bajo
`assets/catalog/beverages/`, validados por SKU, dimensiones y SHA-256 mediante
`npm run catalog:images:verify`. Su uso demo no implica autorización comercial.

## Cadena obligatoria para imágenes comerciales

1. Registrar la fuente en `docs/catalog/image-source-audit.csv`.
2. Confirmar fabricante/proveedor, derechos de uso, variante, capacidad, envase
   y unidades por pack.
3. Registrar el SHA-256 completo de la fuente y marcarla `APROBADA`.
4. Descargar y comprobar el hash con `catalog:images:fetch`.
5. Generar WebP master/thumbnail content-addressed con
   `catalog:images:normalize`.
6. Verificar archivos, dimensiones, hashes y correspondencia con la auditoría
   mediante `catalog:images:verify`.
7. Usar en el CSV sólo la ruta master de
   `docs/catalog/image-manifest.json`.

El manifiesto vincula cada archivo final con su fuente, referencia de derechos
y hashes. Los raw no se versionan ni se distribuyen. Una imagen sin esa cadena
permanece fuera del catálogo productivo.

## Cómo agregar una imagen nueva, en orden

Lo que sigue es el camino completo desde «apareció una foto» hasta «el cliente
la ve». Los pasos 1 y 2 son los que deciden; el resto es mecánica.

1. **¿De dónde salió?** Sólo entra, en este orden: fabricante, embotellador o
   importador de la marca; distribuidor oficial; assets propios con procedencia
   escrita; material que la marca entregó a TABA. Un supermercado, un
   marketplace, un buscador de imágenes o cualquier foto con marca de agua **no
   entran**, y que algo esté accesible no significa que se pueda usar. Si el
   host es nuevo, agregarlo a `catalog/image-source-allowlist.json`: el
   pipeline falla cerrado y no descarga de un host que no esté ahí.

2. **¿Es exactamente este producto?** Tienen que coincidir marca, línea, sabor,
   Original/Zero, capacidad, tipo de envase, presentación y unidades por pack.
   Cualquier duda que no se pueda probar es un `FALLBACK`, y un fallback es un
   resultado correcto. Tres trampas concretas, las tres ya vistas acá:
   - un packshot de **pack** no autoriza un SKU de **unidad**: borrar el sello,
     recortar el «x6» o clonar la botella fabrica un envase que no existe;
   - una **edición limitada** puede compartir el GTIN con el producto estándar
     y aun así ser otra cosa a los ojos del cliente;
   - un **dominio homónimo** puede servir un catálogo impecable de otro rubro.

3. Registrar la fuente y correr la cadena obligatoria de la sección anterior
   (`catalog:images:fetch` → `normalize` → `verify`).

4. `npm run catalog:images:audit` y revisar que el SKU pasó de `FALLBACK` a
   `REAL`, y que ningún otro se movió.

5. `npm test` — las regresiones de `tests/gondola-imagenes-por-sku.test.mjs`
   comprueban identidad, volumen, envase, pack, derechos, faltante, roto y que
   la capa de imágenes no haya tocado ningún dato comercial.

6. Verificar contra la tienda publicada con
   `node scripts/verificar-imagenes-en-vivo.mjs`. Desde un entorno cuya salida
   TLS está interceptada hace falta pasarle los hashes SPKI del interceptor en
   `TABA_BROWSER_SPKI`; el propio script lo documenta en su encabezado.

**Lo que no hay que hacer nunca:** aflojar el scorer para que entre una foto.
Si un candidato correcto queda en `MEDIUM`, el arreglo es enseñarle al scorer el
sinónimo que le falta —como se hizo con «Sin azúcar» / «Zero»—, con prueba de
que lo que debe seguir rechazando se sigue rechazando. Bajar el umbral hace
entrar también todo lo que el umbral estaba frenando.
