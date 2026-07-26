# Pipeline de imágenes

1. Completar `docs/catalog/image-source-audit.csv`.
2. Confirmar variante, capacidad, envase, pack, derechos y el SHA-256 completo
   del archivo fuente. Recién entonces marcar `status=APROBADA`.
3. Ejecutar `npm run catalog:images:fetch`.
4. Ejecutar `npm run catalog:images:normalize`.
5. Copiar al CSV del catálogo el `assets.master.path` registrado en
   `docs/catalog/image-manifest.json`. El importador deriva de esa misma entrada
   el thumbnail 400, hashes, fuente y referencia de derechos.
6. Ejecutar `npm run catalog:images:verify`.

Los archivos raw no se versionan. Los WebP master 1000×1000 y thumbnail
400×400 usan nombres deterministas que combinan SKU normalizado, hash de
identidad producto/fuente y hash del WebP. El manifiesto conserva URL,
derechos, `identitySha256` y un `bindingSha256` completo por asset. Intercambiar
master/thumbnail entre SKU rompe el nombre y el binding y la verificación falla.

Un pipeline sin fuentes o imágenes falla. `--allow-empty` existe exclusivamente
para validar la estructura inicial antes de recibir material comercial.

Valores controlados:

- `source_type`: `fabricante`, `marca`, `distribuidor_oficial`,
  `proveedor_aprobado` o `propio`.
- `rights_status`: `PROPIO`, `LICENCIA_COMERCIAL` o
  `PERMISO_DOCUMENTADO`.
- `status`: `PENDIENTE`, `REVISAR`, `RECHAZADA` o `APROBADA`.
- Fuentes raster admitidas: JPEG, PNG, WebP, AVIF o TIFF.
