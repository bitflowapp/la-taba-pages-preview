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
