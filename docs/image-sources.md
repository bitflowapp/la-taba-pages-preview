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

## Derivados locales para la preview interna v37

Cuatro imágenes ya presentes en el build v36 incluían franjas publicitarias
laterales. Para v37 se generaron recortes locales deterministas que conservan
el envase completo y eliminan únicamente ese espacio externo. No se descargó
material nuevo ni se alteraron los archivos fuente.

| Derivado | Fuente local | Transformación | SHA-256 | Estado |
| --- | --- | --- | --- | --- |
| `assets/products/bebidas/coca-cola-original-1-5l-clean-preview.jpg` | `coca-cola-original-1-5l.jpg` | recorte `756×1000` desde `x=0` | `204584a6cffcbfe03f516317f22e13b593f7ae3932db15e09863881d467cce8d` | `REVISION_INTERNA` |
| `assets/products/bebidas/sprite-1-5l-clean-preview.jpg` | `sprite-1-5l.jpg` | recorte `532×1000` desde `x=0` | `2aa4ceeda5bc0c6bfab4dd7970afac2dbdf4597fd2bdb71eb3dd72cec18ec3b3` | `REVISION_INTERNA` |
| `assets/products/bebidas/fanta-naranja-1-5l-clean-preview.jpg` | `fanta-naranja-1-5l.jpg` | recorte `763×1000` desde `x=0` | `0a218a4b06c50737258d8787477e511d0bab104741fbb8df0a5b1b55e6668eca` | `REVISION_INTERNA` |
| `assets/products/bebidas/monster-energy-original-473ml-clean-preview.jpg` | `monster-energy-original-473ml.jpg` | recorte `565×1000` desde `x=0`, centrado en lienzo blanco `605×1000` | `64fd245575b3c8f5317b500ac0910fb8de749517702efb72d47e1b945b079c70` | `REVISION_INTERNA` |

Estos derivados mejoran únicamente la presentación visual de la preview. No
resuelven ni implican autorización comercial; la marca `PREVIEW INTERNA` debe
mantenerse mientras los derechos sigan pendientes.

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
