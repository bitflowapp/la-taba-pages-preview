# Fuentes y trazabilidad de imágenes

TABA no tiene fotografías comerciales de productos aprobadas en este
repositorio. No se publican imágenes de bebidas parecidas, reconstruidas con IA
ni descargadas sin comprobar producto y derechos.

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
