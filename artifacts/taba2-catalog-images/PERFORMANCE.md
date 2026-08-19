# Peso y carga de las fotografías

Medido el 2026-08-18 sobre los 4 SKU con fotografía.

## Lo que pesa

| | bytes | KB |
|---|---:|---:|
| 4 master 1000×1000 | 75 638 | 73,9 |
| 4 thumbnail 400×400 | 21 758 | 21,2 |
| **total agregado al paquete** | **97 396** | **95,1** |

| | KB |
|---|---:|
| master promedio | 18,5 |
| thumbnail promedio | 5,3 |
| **mayor asset** (`fanta-naranja-…-pack-x6` master) | **21,5** |

WebP calidad 84, esfuerzo 6, fondo aplanado a blanco. Un master de 1000×1000 en
21 KB es un packshot sobre blanco: casi toda la imagen es fondo plano y comprime
muy bien.

Extrapolado a los 56 SKU con la misma clase de material: unos **1,3 MB** en total
para el catálogo completo, master y thumbnail incluidos. No es una cifra que
preocupe.

## Qué se descarga de verdad en 4G

La grilla y la ficha **no bajan el master**. `productThumb` sirve el thumbnail de
400 px y declara `srcset` de 400w/1000w con `sizes`, así que un teléfono pide la
variante de 400: **5,3 KB por producto**. El master de 1000 px lo pide sólo una
pantalla que lo necesite.

Además:

- `loading="lazy"` en la grilla, `eager` sólo en la ficha abierta;
- `decoding="async"`;
- `width` y `height` fijos en el `img` (400×400), así que **no hay salto de
  layout**: el hueco está reservado antes de que llegue el byte;
- un producto sin fotografía usa el mismo hueco de 400×400 con el recurso propio
  de TABA. Cambiar de «sin foto» a «con foto» no mueve nada de lugar.

## El service worker no se infló

| | antes | después |
|---|---:|---:|
| assets precacheados | 130 | **130** |
| identidad del release | `la-taba-runtime-v80-instalacion-temprana` | sin cambios |

Las fotografías **no entran al precache**, a propósito: `sw.js` no las nombra y
`check-release-identity` sigue contando 130. Precachear el catálogo entero
obligaría a bajar todas las fotos en la primera visita, incluidas las de
productos que esa persona nunca va a mirar. Se sirven por red con la estrategia
que ya rige para el resto del contenido.

Esto también es lo que mantiene intacta la PWA v80: el paquete de instalación
pesa lo mismo que antes de esta misión.

## Lo que este informe NO midió

No hay medición en un dispositivo real ni en una red 4G real. Los números de acá
son de archivo y de contrato —cuánto pesa, qué variante pide el navegador, qué
entra al precache—, no de campo. Con 95 KB agregados y cero cambios en el
precache, el riesgo de regresión de performance es bajo, pero «bajo» no es
«medido».
