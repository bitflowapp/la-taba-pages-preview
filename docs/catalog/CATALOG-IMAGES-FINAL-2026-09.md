# Controlled Production: carga real de imágenes — 2026-09

Última revisión: 2026-09-27. Se reutilizaron los 46 SKU existentes. Esta revisión no creó productos ni cambió el catálogo en CP.

## Estado auditado en vivo

Consulta de solo lectura al proyecto `tkanbadcglszlcyfjvpv`, negocio `e7850ad2-a447-402c-8375-3fd74e9466ba`:

| Medición | Estado |
| --- | ---: |
| Productos en CP | 46 |
| SKU distintos / duplicados | 46 / 0 |
| Productos con imagen asociada | 0 |
| Productos sin imagen asociada | 46 |
| Productos verificables/visibles para el storefront | 0 |
| Precio pendiente | 46 |
| Stock nulo | 46 |
| Canaries presentes en CP | 9 |
| Revisiones de imagen pendientes en la cola | 0 |
| Objetos en `catalog-image-staging` / `catalog-images` | 0 / 0 |

`is_active=true` no los publica: los 46 siguen `is_verified=false`, `available=false`, `price_status=pending` y `stock=NULL`. La política pública del catálogo requiere verificación, disponibilidad y stock conocido mayor que cero; por eso el recuento visible es 0.

## Respaldo lógico

`CATALOG_IMAGE_BACKUP: PASS`. Se encontró que la ruta indicada en el informe anterior no estaba presente en el workspace; antes de cualquier escritura en Storage se tomó un export lógico nuevo, se releyó desde disco y se verificó que contiene las 46 filas de producto, 0 duplicados y 0 referencias de imagen. Incluye también `catalog_assets`, `catalog_product_drafts`, cola de imágenes y objetos de ambos buckets.

Ruta privada fuera del repo: `C:\Users\DELL\Desktop\la-taba\catalog-image-backups-2026-09-27\controlled-production-catalog-before-images-2026-09-27.json`

SHA-256: `28715EFD5F0A6AB36E36ABF7831F50D2C7FFAFF346616B58872B13BC833433E3`

Snapshot de CP: `2026-09-28 00:11:41 UTC`. El export contiene los valores existentes de catálogo, incluidos precios y stock, sólo como respaldo; no se modificaron.

## Canaries y fuentes revisadas

Se verificaron los nueve SKU en CP y se revisaron visualmente las alternativas. El detalle por producto, URL de imagen, página de referencia, dominio, licencia y notas está en [canary-image-source-review-2026-09-27.json](canary-image-source-review-2026-09-27.json) y [real-catalog-images.csv](../../catalog/real-catalog-images.csv).

| SKU | Candidato revisado | Estado actual |
| --- | --- | --- |
| `coca-cola-original-2250ml-local` | Botella Original 2,25 L limpia, galería de Vea/Jumbo | `LICENSE_REVIEW_REQUIRED` |
| `coca-cola-sin-azucar-2250ml-local` | Botella Sin Azúcar 2,25 L limpia, galería de Vea/Jumbo | `LICENSE_REVIEW_REQUIRED` |
| `sprite-sin-azucar-2250ml-local` | Botella Sprite Zero 2,25 L limpia, galería de Vea/Jumbo | `LICENSE_REVIEW_REQUIRED` |
| `fanta-naranja-2250ml` | Botella Fanta Naranja 2,25 L limpia, galería de Jumbo | `LICENSE_REVIEW_REQUIRED` |
| `villavicencio-sin-gas-500ml` | Botella sin gas 500 ml limpia, packshot de retail | `LICENSE_REVIEW_REQUIRED` |
| `red-bull-energy-drink-355ml` | Lata Original 355 ml limpia, galería de Jumbo | `LICENSE_REVIEW_REQUIRED` |
| `quilmes-clasica-710ml` | Lata clásica 710 cc estándar en retail; la imagen disponible tiene una banda lateral ancha | `REPLACE_REQUIRED` |
| `heineken-710ml` | Lata Heineken Original 710 cc; la imagen exacta disponible tiene una banda lateral ancha | `REPLACE_REQUIRED` |
| `fernet-branca-750ml` | Botella completa 750 ml en la tienda oficial Branca | `LICENSE_REVIEW_REQUIRED` |

Los packshots oficiales de Coca-Cola Original y Zero disponibles en la página argentina muestran 500 ml; el de Sprite muestra 500 ml; el de Fanta es una lata de 473 ml de edición limitada; el asset de Red Bull observado es de 250 ml; el de Quilmes es una lata de 473 ml y la página de Heineken no indica el volumen del asset. No se reutilizaron esas variantes para los SKU de 2,25 L, 355 ml, 710 ml ni 750 ml. Las páginas oficiales verificadas fueron [Coca-Cola Original](https://www.coca-cola.com/ar/es/brands/coca-cola/original), [Coca-Cola Zero](https://www.coca-cola.com/ar/es/brands/coca-cola/zero), [Sprite](https://www.coca-cola.com/ar/es/brands/sprite/productos), [Fanta](https://www.coca-cola.com/ar/es/brands/fanta/productos), [Red Bull](https://www.redbull.com/ar-es/energydrink/products/red-bull-energy-drink), [Quilmes Clásica](https://www.quilmes.com.ar/clasica), [Heineken lata](https://www.heineken.com/ar/es/nuestros-productos/la-lata) y [Villavicencio](https://www.villavicencio.com.ar/nuestra-agua.html).

`LICENSE_REVIEW_REQUIRED` significa que el producto y la presentación coinciden, pero no se encontró permiso comercial verificable. La tienda oficial Branca confirma el producto 750 ml, pero tampoco publica una licencia de reutilización para tiendas externas. Ningún candidato está marcado como autorizado.

En total se descargaron 29 copias temporales de candidatos para inspección visual; quedaron fuera del repo y no se subieron a CP. No se alteraron ni versionaron. No se pasó a los otros 37 productos porque aún no se puede completar el paso de canary en el Panel.

## Pipeline CP disponible

El pipeline se desplegó mediante PR [#116](https://github.com/bitflowapp/la-taba-pages-preview/pull/116), merge `1e6d106fd3f0a5802c34c8b3d8bee9e312bc9b5c`:

- `catalog-image-staging`: privado, JPEG/PNG/WebP, hasta 5 MiB.
- `catalog-images`: lectura pública para imágenes aprobadas, WebP, hasta 5 MiB.
- Edge Function `catalog-image-manager` v1 con `verify_jwt=true`.
- Carga y revisión requieren JWT de OWNER/ADMIN; el navegador sólo recibe URLs firmadas de una vez para staging.
- La aprobación exige preview y evidencia de derechos (`PROPIO`, `LICENCIA_COMERCIAL` o `PERMISO_DOCUMENTADO`). El objeto público y la asociación activa ocurren sólo tras la aprobación.
- El producto debe continuar como borrador; la carga no publica.
- `fiscal-documents` permanece privado y sin cambios.

`CATALOG_IMAGE_STORAGE: READY`; `PANEL_IMAGE_UPLOAD: READY`; `PRODUCT_IMAGE_ASSOCIATION: READY`; `ANON_IMAGE_READ: READY` (bucket público configurado; no hay aún un objeto aprobado para hacer un GET positivo); `OWNER_ADMIN_WRITE_ONLY: PASS`.

## QA y cambios colaterales

- Revalidación de sólo lectura en CP: 46 productos, 46 SKU distintos, 0 duplicados, 0 públicos, 0 con imagen, 46 precios pendientes y 46 stocks nulos. Los 9 SKU canary existen con nombre exacto; continúan `available=false`, `price_status=pending`, `stock=NULL` y sin imagen.
- La comprobación anónima directa a la API pública devolvió HTTP 200 y 0 filas disponibles (`ANON_PUBLIC_CHECK: PASS`).
- En esta reanudación, Supabase informó `catalog-image-manager` ACTIVE v1 con `verify_jwt=true`; la migración `20260927195533_catalog_image_storage_pipeline` está aplicada. `catalog-image-staging` sigue privado y ambos buckets tienen límite de 5 MiB. La cola, `catalog_assets` y los dos buckets siguen en cero.
- La Edge Function respondió 401 sin JWT; los buckets nuevos no contienen objetos.
- `PRICE_VALUES_CHANGED: 0`; `STOCK_VALUES_CHANGED: 0`; `PRODUCTS_PUBLIC: 0`; `DUPLICATES: 0`.
- No se modificaron precios, stock, publicación, Mercado Pago, ARCA, Rider, LocalAgent, `print_jobs`, checkout, pedidos, roles, RLS ni identidad de Walter.
- El Panel publicado abre en `/#business`, pero la sesión disponible llega a la pantalla de email/contraseña. No se ingresaron credenciales ni se solicitó un enlace de acceso. Sin una sesión OWNER/ADMIN, `PANEL_QA`, `MOBILE_QA` y `DESKTOP_QA` quedan bloqueados; no se guardaron capturas de categorías ni de productos.

## Resultado de la misión de carga

La revisión canary previa descargó 29 copias temporales locales para inspección visual; ninguna se subió a CP. Las siete que coinciden visualmente con el producto siguen sin permiso comercial documentado. Dos canaries requieren una presentación visual más limpia, y los otros 37 productos no tienen revisión visual individual suficiente. No se procesó el lote 2.

`catalog/real-catalog-images.csv` conserva sus campos de investigación e incorpora `source_url`, `rights_status`, `staging_path`, `approved_path` y `association_status`. Las 46 filas tienen `rights_status=RIGHTS_REVIEW_REQUIRED`, rutas de staging/aprobación vacías y `association_status=NOT_ASSOCIATED_RIGHTS_UNVERIFIED`.

| Medición | Resultado |
| --- | ---: |
| `PRODUCTS_IN_CP` | 46 |
| `PRODUCTS_WITH_REAL_IMAGES` / `PRODUCTS_PENDING_IMAGE` | 0 / 46 |
| `CANARY_COMPLETED` | 0/9 |
| `RIGHTS_VERIFIED` / `RIGHTS_REVIEW_REQUIRED` | 0 / 46 |
| `REPLACE_REQUIRED` / `REVIEW_REQUIRED` | 2 / 37 (37 SKU fuera del canary sin revisión visual) |
| `IMAGES_DOWNLOADED` / `IMAGES_STAGED` | 29 / 0 |
| `IMAGES_APPROVED` / `IMAGES_ASSOCIATED` | 0 / 0 |
| `PRODUCTS_PUBLIC` / `DUPLICATES` | 0 / 0 |
| `PRICE_VALUES_CHANGED` / `STOCK_VALUES_CHANGED` | 0 / 0 |
| `ANON_PUBLIC_CHECK` | PASS — HTTP 200, 0 filas |
| `PANEL_QA` / `MOBILE_QA` / `DESKTOP_QA` | Bloqueados por falta de sesión OWNER/ADMIN |


## Pendientes para terminar la carga

1. Iniciar sesión manualmente en la pestaña abierta del Panel con una cuenta OWNER/ADMIN. No compartir la contraseña en el chat.
2. Aportar permiso/licencia comercial verificable para cada candidato externo, o confirmar fotos propias del negocio. El permiso no se infiere del dominio ni de la página oficial de una marca.
3. Conseguir packshots limpios, sin banda lateral, para Quilmes Clásica 710 ml y Heineken 710 ml, o una foto propia exacta de cada envase.

Por ahora `CANARY_COMPLETED: 0/9`; `IMAGES_UPLOADED: 0`; `IMAGES_ASSOCIATED: 0`. Los 46 productos siguen como borradores sin imagen y sin publicación.
## Clasificación vigente, seguridad y discrepancia de migración

| Clasificación del candidato | Cantidad en los 46 SKU |
| --- | ---: |
| `APPROVED_SOURCE` | 0 |
| `LICENSE_REVIEW_REQUIRED` | 7 |
| `REPLACE_REQUIRED` | 2 |
| `REVIEW_REQUIRED` | 37 |

`SECRET_SCAN: PASS`. Se buscaron claves privadas, JWT y claves secretas de Supabase, credenciales en URLs, asignaciones de contraseñas/tokens y cabeceras Bearer con forma de credencial en el repo, diff, logs/evidence y el respaldo privado. No se encontraron valores de credenciales. Las coincidencias de búsqueda amplia fueron nombres de variables, placeholders y fixtures sintéticos de pruebas.

La lista remota de migraciones de Supabase reporta `20260927195533_catalog_image_storage_pipeline`; el branch actual contiene `supabase/migrations/20260927175058_catalog_image_storage_pipeline.sql`. Ambos usan el nombre lógico `catalog_image_storage_pipeline`, pero difiere la versión registrada. El manager, la tabla y los buckets están activos y las comprobaciones de solo lectura pasan. Esta diferencia queda documentada para reconciliarla antes de cualquier `db push` futuro; no se modificó la historia de migraciones en esta misión.

## Revalidación posterior al aviso de inicio manual

Tras el aviso del titular de que la sesión OWNER/ADMIN se había iniciado manualmente, se recargó la pestaña `/#business` disponible en el navegador de Codex. Sigue mostrando “Ingresá con tu cuenta”; esta pestaña no permite confirmar la sesión ni usar el cargador. No se ingresaron credenciales.

La carpeta `catalog/photo-intake/` contiene sólo su README. `catalog/photo-capture/` contiene guía, etiquetas y lista de tomas, sin archivos fotográficos propios. Los ocho canary que aparecen en `catalog/image-manifest.json` tienen `source_type=cadena_comercial_secundaria` y `rights_status=pending_review`; el candidato de Fernet Branca 750 ml sigue sin licencia comercial documentada. El registro `TABA-AUT-2026-08-001` conserva evidencia documental pendiente y excluye las imágenes de cadenas minoristas.

Se mantuvieron excluidas las 29 imágenes locales de revisión marcadas `RIGHTS_REVIEW_REQUIRED`. No se hicieron búsquedas nuevas en Internet en esta reanudación. Ninguno de los 9 canary tiene una foto propia disponible ni un asset con derechos comerciales confirmados, así que no se inició staging.

La lectura final de CP tras esta revisión confirma 46 productos, 0 públicos, 0 duplicados, 0 imágenes asociadas, 0 cargas, 0 objetos en staging y 0 objetos públicos; los 46 precios siguen pendientes y los 46 stocks siguen nulos. No hubo escrituras: `CANARY_COMPLETED=0/9`, `IMAGES_STAGED=0`, `IMAGES_APPROVED=0`, `IMAGES_ASSOCIATED=0`, `PRODUCTS_PUBLIC=0`, `PRICE_VALUES_CHANGED=0`, `STOCK_VALUES_CHANGED=0`. Panel QA y capturas móviles/de escritorio permanecen bloqueados mientras la pestaña conectada siga sin autenticación.
