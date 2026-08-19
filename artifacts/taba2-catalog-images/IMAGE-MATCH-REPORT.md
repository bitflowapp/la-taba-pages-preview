# Cómo se decidió qué foto va con qué producto

Medido el 2026-08-18. 56 SKU, 347 candidatos cosechados de fuentes permitidas.

## Resultado

| estado del matcher | SKU | qué significa |
|---|---:|---|
| `HIGH` | **5** | los cinco ejes cierran y no hay ambigüedad: se puede asociar solo |
| `MANUAL_REVIEW` | 3 | hay candidato pero con reparos, o hay más de uno |
| `SIN_CANDIDATO` | 17 | la marca tiene fuente oficial y esa fuente no publica este producto |
| `SIN_FUENTE` | 31 | no se encontró fuente oficial programática para la marca |

De los 5 `HIGH`, **4 se publicaron** y **1 quedó frenado por derechos**: Trapiche
Origen Malbec coincide exacto y se verificó a ojo, pero lo publica un
distribuidor y la autorización cubre marca, embotellador o importador. Ver
[RIGHTS-AUDIT.md](RIGHTS-AUDIT.md).

Coincidir y poder publicar son dos compuertas distintas, y el pipeline las
mantiene separadas a propósito: mirar la foto resuelve si es el producto
correcto, no si se tiene derecho a usarla.

## El hallazgo que ordena todo lo demás

**La tienda oficial de Coca-Cola Andina publica packs, no unidades.** De 87
productos en Gaseosas, todos son `x6` o `x12`. Y el packshot de un pack es *una
sola botella con un sello rojo de cantidad encima*: «x12», «x6».

Eso parte el catálogo en dos:

- para los **4 SKU que son packs**, ese packshot es exactamente correcto,
  incluido el sello, porque el producto ES el pack;
- para las **52 unidades sueltas**, el mismo archivo sería una mentira: el sello
  promete doce botellas donde se entrega una.

La autorización comercial ya dice esto mismo en su lista de lo que no cubre
(«imágenes de multipack usadas en la ficha de una unidad suelta: muestran una
cosa y se entrega otra»). El matcher lo aplica: la cantidad del pack es el único
eje que rechaza siempre, sin excepción y sin degradar a revisión.

## Los cinco ejes

Cada candidato se compara contra el SKU en marca, capacidad, envase, cantidad del
pack y línea/variante. Ninguno se decide «por parecido visual».

- **ALTA** — los cinco cierran y ninguno quedó sin dato. Único estado que se
  asocia solo, y sólo si hay exactamente un candidato ALTA.
- **MEDIA** — cierra lo esencial y algún eje quedó sin declarar. Va a revisión.
- **RECHAZO** — algún eje se contradice. No se descarga.

El envase, cuando el título no lo nombra, sale de una convención **por categoría**
declarada en `catalog/image-source-allowlist.json` y verificada mirando
packshots. No es una inferencia del matcher: es un hecho escrito sobre la fuente,
versionado, que se puede discutir. Un token explícito en el título («Lata»,
«Vidrio») siempre gana.

## Cuatro defectos del matcher, encontrados midiendo

**1. No comparaba la línea del producto.** «Trapiche Origen Malbec» aceptaba
también «Trapiche Reserva Malbec», «Trapiche Puro Malbec» e «Impuro»: misma
marca, misma cepa, mismos 750 ml. Y «Powerade Mountain Blast» aceptaba «Powerade
Sour». Se agregó comparación de *tokens distintivos*: se le sacan al título la
marca, las medidas, los envases y los conectores, y lo que queda tiene que
coincidir de los dos lados. No hace falta que nadie enumere «Mountain Blast» ni
«Incrediblends» en ninguna lista para que el matcher note que la fuente habla de
otra cosa.

**2. «chocolate» contenía «cola».** Los marcadores de variante se buscaban con
`includes` sobre el texto entero, así que «DADA N8 CHOCOLATE» declaraba una
contradicción de sabor que no existía. Ahora se buscan como palabra.

**3. El acento agudo partía la marca en dos.** La tienda escribe «GORDON´S» con
U+00B4. Al normalizar, NFKD lo descompone en espacio + tilde combinante, y sacar
la tilde dejaba «gordon s»: la marca dejaba de coincidir consigo misma y el
producto desaparecía sin candidatos. Los apóstrofos ahora se unifican **antes**
de NFKD. Gordon's pasó de invisible a revisión humana.

**4. `1x750ml` contaba como palabra del producto.** La tienda pega cantidad y
medida en un token; el filtro de medidas no lo reconocía y lo trataba como parte
del nombre, así que ningún vino podía dar ALTA.

## Los cuatro que quedaron en revisión

| SKU | qué pasó |
|---|---|
| `dada-caramel-750ml` | 11 candidatos Dada en la tienda, ninguno es Caramel (hay N1, N2, N3, White Malbec, Incrediblends, espumantes). El matcher se niega a elegir el más parecido. |
| `gin-gordons-700ml` | «GORDON´S GIN 1X700ml» contra «Gordon's London Dry». Mismo producto casi con seguridad, pero la línea no es idéntica en el texto y eso lo decide una persona. |
| `powerade-mountain-blast-500ml` | Sólo aparece «POWERADE SOUR 500x6»: otro sabor, y además un pack. |

## Una compuerta que existe y no la alimenta nadie

`productPhotoIsOfficial` exige `product.imageShowsMultipack !== true`, y
`isUnitStorefrontProduct` saca de la vitrina de unidades a cualquier producto con
esa bandera en `true`. Es exactamente la defensa contra el error que este informe
describe.

Sólo que **`image_shows_multipack` no es una columna de `products`**, y el
repositorio de producción no la escribe: para todo producto real llega
`undefined`. La compuerta pasa siempre, no porque el caso esté resuelto sino
porque nadie le pasa el dato. Hoy no hace daño —el pipeline ya impide que una
foto de pack llegue a una unidad, del lado de la asociación— pero la protección
del lado del cliente es decorativa.

Cerrarlo pide una columna nueva, o sea una migración, que esta misión no toca.
Queda anotado.

Además: cuando la cadena de imagen está completa, el cliente declara
`rightsStatus: 'PERMISO_DOCUMENTADO'` sin leer el estado real del asset. Los
nuestros son `LICENCIA_COMERCIAL`. Los dos habilitan, así que la vitrina decide
bien, pero afirma un estado que el asset no tiene.

## Revisión visual

Los 5 candidatos descargados se abrieron y se miraron a tamaño completo antes de
aprobar ninguno. Los 4 packs muestran la botella correcta, la capacidad impresa
en la etiqueta coincide con el SKU y el sello de cantidad coincide con
`units_per_pack`. La aprobación quedó firmada en
`docs/catalog/image-source-audit.csv` con responsable y fecha.

La hoja de contactos (`contact-sheet.html`, `contact-sheet.webp`) muestra los 56
juntos: 4 con fotografía, 52 con el recurso propio de TABA.
