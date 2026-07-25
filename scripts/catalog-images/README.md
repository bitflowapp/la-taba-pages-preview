# Pipeline de imágenes

1. Completar y aprobar `docs/catalog/image-source-audit.csv`.
2. Ejecutar `node scripts/catalog-images/fetch-approved.mjs`.
3. Instalar `sharp` localmente y ejecutar
   `node scripts/catalog-images/normalize.mjs`.
4. Ejecutar `node scripts/catalog-images/verify.mjs`.

Los scripts se niegan a procesar filas sin estado `APROBADA` y nunca sustituyen
una variante por otra.
