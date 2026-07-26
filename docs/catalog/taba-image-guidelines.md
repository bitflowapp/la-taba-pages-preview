# Imágenes de catálogo

Salida: WebP principal 1000×1000 y miniatura 400×400, fondo blanco, producto
centrado y proporción original. Sin precio, promociones, watermark ni cambios
de etiqueta.

Prioridad de fuente: fabricante/marca, distribuidor oficial, mayorista
autorizado, proveedor aprobado o material propio. Registrar URL, tipo de fuente,
estado y referencia de derechos, fecha, SHA-256 completo, variante, capacidad,
envase y pack en `image-source-audit.csv`.

No usar miniaturas de buscadores, envases parecidos ni IA para reconstruir
etiquetas. Si variante, capacidad, envase o pack no coinciden exactamente,
marcar `REVISAR` y no publicar.

`status=APROBADA` exige derechos comerciales documentados, cuatro verificaciones
de identidad en `true` y un `expected_sha256` de 64 caracteres. Los outputs
master y thumbnail se registran en `image-manifest.json`; una imagen WebP no
manifestada invalida el pipeline.

Usar sólo fuentes raster JPEG, PNG, WebP, AVIF o TIFF. SVG remoto, GIF y otros
formatos activos/animados se rechazan antes de normalizar.
