# Pipeline de imágenes del catálogo · Controlled Production · 2026-09

## Alcance

Este cambio añade carga, revisión, almacenamiento y asociación de imágenes a productos comerciales en borrador de La Taba. No publica productos ni escribe precio, stock, disponibilidad, verificación u otros módulos. Los campos de imagen existentes de `products` y el registro aprobado `catalog_assets` siguen siendo la autoridad de publicación.

## Buckets

| Bucket | Acceso | Tipos | Máximo | Uso |
| --- | --- | --- | ---: | --- |
| `catalog-image-staging` | Privado | JPEG, PNG, WebP | 5 MiB por archivo | Original y variantes pendientes de aprobación |
| `catalog-images` | Público de lectura | WebP | 5 MiB por archivo | Sólo imágenes cuya aprobación ya quedó confirmada en la base |
| `fiscal-documents` | Privado, sin cambios | PDF | 16 MiB | Documentos fiscales; nunca recibe imágenes |

`storage.objects` no concede escrituras a `anon` ni a usuarios autenticados en ninguno de los dos buckets de catálogo. El Edge Function usa `service_role` únicamente del lado servidor. El navegador recibe URL firmadas de un solo uso para subir al bucket privado.

## Contrato de rutas

Las rutas se crean en el servidor con UUID normalizados; el navegador no envía paths:

```text
business/{business_id}/products/{product_id}/pending/{upload_id}/source.{jpg|png|webp}
business/{business_id}/products/{product_id}/pending/{upload_id}/master.webp
business/{business_id}/products/{product_id}/pending/{upload_id}/thumbnail.webp
business/{business_id}/products/{product_id}/{sha256}.webp
business/{business_id}/products/{product_id}/thumb-{sha256}.webp
```

La asociación mantiene el formato lógico `assets/products/*.webp` ya usado por el catálogo. Sólo los aliases marcados de Storage se resuelven al bucket `catalog-images`; los assets estáticos existentes mantienen su ruta.

## Flujo y autorización

1. El Edge Function `catalog-image-manager` exige JWT válido, verifica al usuario y consulta `has_business_role` para `owner` o `admin` del negocio solicitado.
2. Valida pertenencia del producto, origen comercial, SKU estable y estado borrador (`available=false`, `is_verified=false`). Una revisión abierta por producto bloquea otra carga hasta terminarla.
3. Emite tres URL firmadas de subida al bucket privado. El Panel valida y decodifica la imagen y genera WebP cuadrado de 1000 × 1000 y 400 × 400, con el producto completo contenido sobre fondo blanco.
4. El servidor vuelve a leer bytes, valida firmas JPEG/PNG/WebP, MIME declarado, tamaño, dimensiones y SHA-256. Una URL externa requiere HTTPS y no puede contener credenciales; la foto propia queda etiquetada sin URL externa.
5. El owner/admin abre una vista previa privada temporal. Aprobar requiere esa vista previa reciente y una referencia de derechos: `PROPIO`, `LICENCIA_COMERCIAL` o `PERMISO_DOCUMENTADO`. No se infiere ni se marca permiso automáticamente.
6. La asociación de `catalog_assets` y los cinco campos de imagen del producto ocurre en una RPC transaccional que vuelve a validar membresía, identidad, derechos y borrador. Los objetos WebP pasan al bucket público sólo después de confirmar esa RPC; si falla la copia, la fila queda aprobada pero el Panel ofrece reintentarla. La copia compara SHA antes de reutilizar una ruta.
7. Al completar Storage, se retiran staging y el asset anterior cuando corresponde. Las fallas de limpieza quedan registradas para reintento e inventario.

No se da permiso de escritura Storage al cliente, y la RPC de aprobación no cambia precio, stock, `available` ni `is_verified`.

## Modelo de datos

- `products.image_url`, `image_thumbnail_url`, sus hashes, `source_image_sha256` y `catalog_asset_id`: campos existentes, se reutilizan.
- `catalog_assets`: se extiende con `product_id`, `master_storage_path` y `thumbnail_storage_path`; continúa como registro comercial aprobado y conserva hash, identidad, fuente y evidencia de derechos.
- `catalog_image_uploads`: historial/revisión con estado `pending`, `approved` o `rejected`, provenance (`source_url`, dominio y tipo), hashes, preview/revisor, evidencia de licencia, rutas generadas y estado de limpieza. RLS permite SELECT sólo a owner/admin; escrituras sólo pasan por Edge Function.

## Operación segura

- Función: `catalog-image-manager`, `verify_jwt = true`.
- Acciones: `list`, `prepare`, `complete`, `preview`, `approve`, `reject`/`cancel`.
- El preview firmado dura cinco minutos. Las rutas y el negocio se derivan o validan en servidor; no se aceptan paths aportados por navegador.
- La aprobación requiere producto comercial no publicado y no verificado, con una imagen revisada y evidencia de derechos registrada.
- El pipeline no descarga imágenes externas por URL. El operador selecciona el archivo y registra su procedencia; no hay hotlink de producción.
- Sin carga o aprobación automática, sin publicación automática y sin cambios a precio o stock.

## Verificación al implementar

La auditoría anterior al cambio en CP registró 46 productos, 0 públicos, 0 duplicados, 0 con imagen, 46 precios pendientes y 46 stocks nulos. La migración y la función sólo habilitan el pipeline; no cargan candidatos ni cambian ese estado. La verificación posterior, el SHA desplegado, las pruebas y el estado del Panel se agregan al informe `CATALOG-IMAGES-FINAL-2026-09.md` tras completar el release controlado.

### Backend aplicado en CP

El 2026-09-27 se aplicó `20260927175058_catalog_image_storage_pipeline` al proyecto `tkanbadcglszlcyfjvpv` y se desplegó `catalog-image-manager` v1 con `verify_jwt=true`. La inspección posterior confirmó ambos buckets, límites/MIME esperados, RLS activo en `catalog_image_uploads`, ninguna escritura directa `anon`/`authenticated`, y ejecución de las RPC de finalización/aprobación sólo por `service_role`.

La lectura de productos después de DDL/backend sigue dando: 46 productos del negocio objetivo, 0 públicos, 0 duplicados, 0 imágenes, 46 precios pendientes y 46 stocks nulos. El bucket público todavía no contiene imágenes; su acceso anónimo queda habilitado por su configuración `public=true`, y el único camino que deposita objetos es la función después de la aprobación transaccional. La política de `fiscal-documents` y sus límites PDF siguen iguales.

La actualización visual del Panel aún depende del release controlado de Pages. Su workflow quedó habilitado para `workflow_dispatch` sólo en `release/taba-controlled-production` cuando `CP_DEPLOY_SHA` coincide exactamente con `github.sha`; el paso de CI sigue exigiendo los workflows push verdes de web y Android para ese SHA. El despliegue de Pages y la QA visual se registran cuando termine ese paso.
