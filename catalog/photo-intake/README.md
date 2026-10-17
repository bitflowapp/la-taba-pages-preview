# Entrada de fotos propias

Copiá acá las fotos sacadas en el local, nombradas `<sku>.jpg` (también se acepta `<sku>__front.jpg`, `<sku>__pack.jpg` o `<sku>__alternate.jpg`). El SKU tiene que ser exacto; la lista está en [PHOTO-SHOT-LIST.md](PHOTO-SHOT-LIST.md).

- `npm run catalog:photos:validate`: dice qué fotos se reconocen, cuáles no y por qué (nombre, SKU, resolución mínima de 1200×1200, peso máximo de 5 MB para el Panel).
- Para la tienda real (CP) las fotos se suben desde el Panel: Catálogo → **Cargar fotos en lote**. Quedan privadas y pendientes hasta que el dueño las aprueba con derecho PROPIO.
- No correr `catalog:photos:ingest` con SKU de CP: ese comando es del catálogo estático y los ignora.
- Las fotos no se versionan en git (están en `.gitignore`): el asset final vive en Storage.
