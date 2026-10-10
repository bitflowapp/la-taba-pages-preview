# IMPORT_DRY_RUN · expansión PedidosYa 2026-10-10

**Tipo de prueba:** validación local con el validador oficial del repo (`scripts/validate-product-catalog.mjs`) sobre la plantilla generada desde `NEW_PRODUCTS.csv`. **No hubo conexión a Supabase**: ni producción, ni staging.

**Resultado: FAIL (esperado).** Los 134 candidatos quedan bloqueados por cuatro causas, todas por falta de datos que no se pueden inventar.

## Salida del validador

Archivo completo: `IMPORT_VALIDATION_OUTPUT.txt`. Resumen por tipo de error:

| Error | Filas afectadas | Por qué no se resuelve sin decisión humana |
|---|---|---|
| `stock está vacío` / `stock inválido o negativo` | 134 | El stock vacío significa «nadie lo contó». Poner 0 afirmaría «agotado» y no es un dato. Lo cuenta el negocio. |
| `sort_order está vacío` / `sort_order inválido o negativo` | 134 | Es el orden de góndola: decisión comercial. |
| `image_path está vacío` / `imagen faltante` | 134 | Ninguna imagen está aprobada por una persona (ver `PRODUCT_IMAGE_AUDIT.csv`). |
| `external_id/SKU no tienen una imagen aprobada en el manifiesto` | 134 | Igual que el anterior: el manifiesto sólo admite assets aprobados. |

**No aparece ningún otro error**: nombre, marca, variante, categoría canónica, capacidad, envase, alcohol con edad mínima 18, precio positivo y SKU único pasan todos.

## Por qué la vía oficial no crea nada todavía

- `stage_catalog_products` (migración `20260825160000`) exige una fila en `catalog_assets` con `external_id` y `sku` para **cada** producto del lote. Sin asset aprobado el lote entero falla con `No approved asset for external_id … and SKU …`.
- `import_catalog_batch` es la única puerta que escribe las columnas de imagen y, por dentro, llama a `stage_catalog_products`. No hay camino oficial para dar de alta un producto sin foto.
- El canal que creó productos sin foto en el pasado (`scripts/aplicar-gondola-neuquen.mjs`) usa un token de CLI elevado y está cerrado detrás de `TABA2_GONDOLA_APPLY` y de una confirmación humana. **No se usó.**

## Staging

No se ejecutó. Motivos:
1. Ningún producto tiene asset aprobado, así que el lote no pasaría `stage_catalog_products`.
2. Escribir en staging exige una sesión owner/admin verificada. No hay una vigente en este entorno (ver `taba2-staging-access-credentials` en la memoria).
3. Staging (`ucbtjcurawxjwjdvvcvj`) tiene 20 productos QA, ninguno de los 134.

## Producción

No se tocó. `PRODUCTION_UPDATED: NO`.

## Qué habría que tener para un dry-run real

1. Imágenes aprobadas por una persona (`npm run catalog:images:approve -- --revisado-por "…"`), con `rights_evidence_file` y el acuerdo archivado.
2. Stock contado y `sort_order` decididos por el negocio.
3. Resueltos los cinco duplicados probables y los dos ambiguos (ver `DUPLICATE_REVIEW.csv`).
4. Sesión owner/admin para staging, y que el lote pase `catalog:validate` completo antes del `--dry-run` del importador.
