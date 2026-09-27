# Controlled Production: informe final de imágenes de catálogo — 2026-09

## Resultado

La auditoría en vivo confirmó 46 productos del negocio de Controlled Production, 0 públicos, 0 verificados, 0 con imagen y 0 duplicados por SKU. Los 46 conservan precio pendiente y stock nulo. El respaldo lógico se creó antes de cualquier posible escritura.

No se descargó, subió ni asoció ninguna imagen: Controlled Production no tiene un Storage de imágenes ni un flujo compatible para estos 46 productos. No se escribió en la base de datos y no se modificaron precios, stock, publicación ni otros módulos.

## Auditoría inicial y respaldo

Consulta de solo lectura al proyecto tkanbadcglszlcyfjvpv, acotada al negocio e7850ad2-a447-402c-8375-3fd74e9466ba:

| Medición | Estado inicial |
| --- | ---: |
| PRODUCTS_IN_CP | 46 |
| PRODUCTS_PUBLIC (available=true) | 0 |
| Productos verificados | 0 |
| PRODUCTS_WITH_IMAGE | 0 |
| PRODUCTS_WITHOUT_IMAGE | 46 |
| Duplicates por SKU | 0 |
| price_status=pending | 46 |
| stock=NULL | 46 |
| catalog_assets del negocio | 0 |
| catalog_product_drafts del negocio | 0 |

CATALOG_IMAGE_BACKUP: PASS. Export lógico privado guardado en C:\Users\DELL\.taba-backups\controlled-production\catalog-images-2026-09-27\catalog-before-images.json. SHA-256: 39B47EFD47F18AF02C65A4D1209CB438E4B74E7448C5AD5DC52EC8CFD4A19AAD. El respaldo incluye las filas de products, catalog_assets, catalog_product_drafts y sus conteos.

## Investigación existente y canary

Se reutilizaron catalog/real-catalog-initial.csv, catalog/real-catalog-canary.csv, docs/catalog/catalog-source-2026-09.json y docs/catalog/catalog-image-review-2026-09.json de la rama feat/real-catalog-initial. No se creó ningún SKU nuevo.

Los 9 SKU canary existen en CP y coinciden con la presentación investigada. En la base siguen con available=false, price_status=pending, stock=NULL, image_url=NULL y sin verificación. Su revisión visual previa quedó registrada en el manifiesto existente:

| SKU | Presentación confirmada en CP | Estado del candidato |
| --- | --- | --- |
| coca-cola-original-2250ml-local | Coca-Cola Sabor Original, botella PET, 2,25 L | REPLACE_REQUIRED: panel lateral grande y texto adicional |
| coca-cola-sin-azucar-2250ml-local | Coca-Cola Sin Azúcar, botella PET, 2,25 L | REPLACE_REQUIRED: panel lateral grande |
| sprite-sin-azucar-2250ml-local | Sprite Sin Azúcar, botella PET, 2,25 L | REPLACE_REQUIRED: imagen borrosa |
| fanta-naranja-2250ml | Fanta Naranja, botella PET, 2,25 L | REPLACE_REQUIRED: panel lateral grande |
| villavicencio-sin-gas-500ml | Villavicencio Sin Gas, botella PET, 500 ml | LICENSE_REVIEW_REQUIRED: imagen limpia y presentación coincidente; permiso no documentado |
| red-bull-energy-drink-355ml | Red Bull Energy Drink, lata, 355 ml | REPLACE_REQUIRED: panel de texto grande |
| quilmes-clasica-710ml | Quilmes Clásica, lata, 710 ml | REPLACE_REQUIRED: imagen de edición limitada Mundial, no la presentación estándar |
| heineken-710ml | Heineken Lager, lata, 710 ml | REPLACE_REQUIRED: panel de texto grande |
| fernet-branca-750ml | Fernet Branca Original, botella, 750 ml | REPLACE_REQUIRED: botella recortada y panel lateral |

CANARY_COMPLETED: 0/9. La investigación y revisión visual previa cubren 9/9, pero ninguno llegó a descarga, Storage, asociación ni comprobación visual en el Panel.

De los otros 37 SKU no hay revisión visual individual suficiente para aprobar sus imágenes. Las URL guardadas son referencias secundarias de retail. El manifiesto previo cuenta APPROVED_SOURCE=0, LICENSE_REVIEW_REQUIRED=38 y REPLACE_REQUIRED=8. Para la clasificación principal de este log, los 37 candidatos no inspeccionados se dejan en REVIEW_REQUIRED hasta comprobar visualmente la identidad; el único candidato limpio se deja en LICENSE_REVIEW_REQUIRED; los 8 fallidos permanecen en REPLACE_REQUIRED. El CSV conserva prior_review_classification para rastrear el recálculo. La licencia comercial sigue sin documentarse para los 46.

Las páginas oficiales anotadas para Coca-Cola, Sprite, Fanta, Red Bull y Heineken son pistas de búsqueda, no packshots aprobados: la investigación previa no confirmó en ellas la presentación exacta ni permiso comercial. Las URLs originales de retail y sus dominios están en catalog/real-catalog-images.csv.

## Bloqueo del flujo de Storage y asociación

El único bucket actual de Supabase CP es fiscal-documents: privado, limitado a application/pdf y 16 MiB. No puede recibir packshots. No hay otro bucket de imágenes.

El contrato de catalog_assets registra rutas propias assets/products/*.webp, SHA-256, bindings, fuente y derechos; no define rutas de Supabase Storage. La restricción catalog_assets_rights_valid de catalog_assets sólo acepta PROPIO, LICENCIA_COMERCIAL o PERMISO_DOCUMENTADO. Los candidatos actuales no tienen evidencia que permita afirmar ninguno de esos derechos.

El pipeline existente en scripts/catalog-images/ prepara WebP y asociaciones para otra combinación de proyecto y negocio, y espera que los archivos assets/products/ formen parte del paquete web. No ofrece carga a Storage de CP. Adaptarlo exigiría cambiar la publicación de assets o crear una infraestructura de imágenes distinta, además de salvar el modelo actual de derechos. Ninguna opción está habilitada por el flujo desplegado del editor; el editor existente no tiene carga de imágenes. No se alteró el frontend, Storage, RLS ni la base de datos para abrir un camino nuevo.

## Registro SKU por SKU

catalog/real-catalog-images.csv registra los 46 SKU con product_name, marca, variante, tamaño, categoría, URL original, dominio, tipo de fuente, estado de licencia, ruta de Storage, image_status y notas. Todos los storage_path están vacíos y todos los permission flags permanecen sin evidencia.

| Estado principal | Cantidad |
| --- | ---: |
| APPROVED_SOURCE | 0 |
| LICENSE_REVIEW_REQUIRED | 1 |
| REPLACE_REQUIRED | 8 |
| REVIEW_REQUIRED | 37 |
| license_status=NOT_DOCUMENTED | 46 |
| Pendientes de imagen en CP | 46 |

Los 37 candidatos sin inspección visual están en REVIEW_REQUIRED. La falta de permisos se registra aparte en license_status; ninguna fila afirma autorización.

## QA y comprobación de seguridad

- Recuento CP y canary: lectura SQL de solo lectura; no hubo mutaciones.
- Comprobación pública anónima: HTTP 200 desde la clave publicable de runtime-config.js; REST devolvió 0 productos disponibles.
- Panel desktop/móvil: BLOCKED. La sesión de navegador del dueño no estaba conectada a las superficies disponibles. El intento de abrir un navegador dedicado no produjo una página inspeccionable. CAPTURAS: 0; no hay imágenes asociadas que fotografiar.
- WebKit: no disponible en la superficie de navegador.
- No se tocó la identidad de Walter, precios, stock, Mercado Pago, ARCA, Rider, LocalAgent, print_jobs, checkout, pedidos, roles o RLS.
- Relectura final contra el respaldo: 0 cambios en precios, stock, price_status, disponibilidad, verificación o referencias de imagen; 46 imágenes siguen pendientes.
- Secret scan: PASS en el árbol del worktree y PASS en los 6 logs npm de esta tarea; sin hallazgos de claves, tokens, enlaces de autenticación ni asignaciones de contraseña.

## Qué hace falta para continuar

1. Una ruta de imágenes propia compatible con el editor desplegado, o la habilitación expresa de un destino y flujo de Storage para imágenes en CP. El bucket fiscal actual no sirve.
2. Packshots exactos con permiso comercial documentado, o fotos propias de La Taba. Las licencias pendientes no se marcaron como aprobadas.
3. Una sesión de navegador accesible para revisar el Panel autenticado en 390x844 y 1366x768 después de asociar imágenes.

Hasta cubrir esos puntos, los 46 productos quedan como borradores sin imagen y sin publicación.
