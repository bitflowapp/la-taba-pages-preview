# Lista de imágenes oficiales del catálogo

TABA necesita una imagen verificable por producto real. No se usan fotografías
parecidas, imágenes generadas ni archivos tomados de internet sin derechos.

## Por producto

- Una fotografía master que identifique la variante exacta.
- Marca, capacidad, envase y unidades por pack legibles.
- Fondo limpio y color fiel.
- Sin promociones o precios incrustados que puedan quedar desactualizados.
- Fuente HTTPS de fabricante, distribuidor oficial, proveedor aprobado o toma
  propia con permiso comercial documentado.

## Entregables técnicos

- Fuente registrada en `docs/catalog/image-source-audit.csv`.
- SHA-256 completo de la fuente.
- Referencia de derechos.
- Master WebP 1000×1000 content-addressed.
- Thumbnail WebP 400×400 content-addressed.
- Entrada correspondiente en `docs/catalog/image-manifest.json`.

Los nombres finales los genera el pipeline desde el SKU y el hash. No deben
renombrarse manualmente.

## Tomas del comercio

- Fachada y acceso.
- Mostrador o exhibidor ordenado.
- Heladeras si aportan contexto comercial.
- Material de entrega neutro, sin mostrar datos personales.

Estas imágenes institucionales no sustituyen la foto oficial de cada producto.
