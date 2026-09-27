# La Taba · continuación del catálogo CP · 26 de septiembre de 2026

## Estado alcanzado

Los 46 candidatos preparados en el primer lote están ahora en el negocio CP como **productos comerciales ocultos y no verificados**. La tabla `public.products` contiene 46 SKU únicos y 46 identidades marca/nombre/variante/capacidad únicas. Los 46 mantienen `price_status='pending'`, `price=0` como centinela técnico y `stock=NULL`; ninguno está disponible al público. No se asociaron fotos y no se cambió el estado del comercio ni la venta de alcohol. La lectura pública anónima devolvió 0 productos.

El [backup anterior a la primera importación](catalog-backup-cp-2026-09-26-pre-import.json) confirma que ese negocio tenía 0 productos, 0 assets y 0 filas en `catalog_product_drafts`. El [recibo de importación](catalog-draft-import-2026-09.json) registra el hash del payload, los resultados de carga y la repetición idempotente: **46 creados en la primera llamada; 0 creados y 46 reutilizados en la segunda**. Estos borradores viven en `products`, que es el modelo del importador comercial existente; no se crean filas paralelas en `catalog_product_drafts`.

El payload se regenera desde la evidencia versionada con `node scripts/catalog/build-cp-draft-payload.mjs --out <ruta-privada>`. Sin `--out`, el comando sólo informa cantidad y hash; no escribe ni cambia la base. La función administrativa exige exactamente ese lote de 46 y comprueba de nuevo cada identidad existente antes de reutilizarla.

## Contrato de stock y seguridad

La causa estaba en `apply_commercial_catalog_plan`: una celda de stock vacía hacía `v_stock := 0`. La migración `20260927004045_catalog_pending_stock_and_cp_drafts` sustituyó esa conversión por `commercial_catalog_parse_stock`. El test SQL ejecutado contra CP confirmó:

| Entrada | Resultado |
| --- | --- |
| `{"stock":null}` | `NULL` |
| `{}` | `NULL` |
| `{"stock":0}` | `0` |
| `{"stock":5}` | `5` |

Una segunda migración (`20260927004347_catalog_draft_juice_taxonomy`) alineó la categoría Jugos con la taxonomía publicada: la primera carga atómica detectó que esa categoría faltaba en la lista administrativa y se revirtió íntegra, sin insertar filas. La tercera (`20260927005628_cp_published_requires_approved_image`) añadió una compuerta exclusiva de CP: ningún producto puede quedar `available=true` sin imagen asociada a un asset comercial aprobado. La restricción está validada y hay 0 productos publicados.

Para cargar sin inventar dueño, se usó la función `catalog_admin.import_pending_catalog` fuera de los esquemas expuestos. Corre como `SECURITY INVOKER`, exige el operador de base y el ID exacto del negocio CP, comprueba que la tienda siga cerrada y rechaza precio, stock, publicación o imagen en el payload. No concede ejecución a `anon`, `authenticated` ni `service_role`. Un conflicto de identidad o una fila distinta revierte el lote completo. No se modificaron roles ni RLS general.

## Panel comercial

El Panel real de CP usa `js/production-operations.js`. La mesa de Catálogo que ya existe en `js/business.js` pertenece al modo demo y no se renderiza en producción. Se añadió la vista **Catálogo** al Panel operativo, visible sólo para owner/admin por la capacidad `products.price`.

La vista lista los productos comerciales del negocio con nombre, marca, SKU, categoría y presentación; permite buscar, editar precio y stock en la fila, guardar una fila o guardar varios cambios mediante una única llamada atómica a `apply_commercial_catalog_batch`. Un campo vacío conserva el dato anterior. `0` en stock es un conteo explícito, nunca el valor implícito de un campo vacío. Las etiquetas distinguen **Sin contar**, **Agotado** y **N unidades**. Un precio positivo confirma `price_status`, pero la edición no incluye `publish` y no publica borradores.

La disponibilidad y la publicación se muestran por separado: **No disponible · borrador** o **Disponible · publicado**. El botón para publicar sólo se ofrece cuando hay precio confirmado, stock positivo, ficha verificada e imagen asociada; el servidor vuelve a comprobar las compuertas. Ocultar un producto publicado usa la RPC existente. El Panel no abre el comercio ni habilita alcohol.

El código y el diseño de la vista se probaron con datos derivados de los borradores a 390×844, 430×932 y 1366×768 en Chromium y WebKit: 5 filas de muestra, 5 campos de precio, 5 de stock, 0 botones de publicación y 0 errores de página, sin desbordamiento horizontal. Esta es **QA local de la vista**. No se declara QA autenticada en CP porque el negocio aún no tiene una identidad owner/admin real; tampoco se desplegó este cambio de frontend al sitio CP mediante el proceso de release, que exige sus propios controles.

### Verificación técnica

- Test SQL en CP: los cuatro casos de stock devolvieron el valor esperado; el parser y la RPC corregida están instalados.
- Importación: 46 creados, repetición 46 reutilizados/0 creados; 46 precios pendientes y 46 stocks `NULL`; consulta anónima pública: 0.
- `npm run migrations:validate`: 143 migraciones revisadas en orden. `npm run check`: PASS, incluidos grafo de precache, identidad de release y escaneo de secretos.
- Pruebas dirigidas de catálogo y Panel: 64/64; pruebas dirigidas de PWA, release visual y navegación: 61/61.
- La suite general se ejecutó antes de ajustar los literales de versión de CSS y precache: 2652/2663. Las ocho fallas de versión/diseño se corrigieron y sus suites dirigidas pasaron. Las otras tres pertenecen al empaquetado del Edge release: el checkout de trabajo usa un enlace de `node_modules` fuera del repositorio y esa prueba lo rechaza por diseño. No se debilitó la verificación; no se declara la suite completa verde en este checkout.

## Imágenes y almacenamiento

El [registro de revisión](catalog-image-review-2026-09.json) clasifica los 46 enlaces: **0 APPROVED_SOURCE, 8 REPLACE_REQUIRED y 38 LICENSE_REVIEW_REQUIRED**. Los ocho reemplazos corresponden al canary: paneles promocionales o gráficos, una foto borrosa, una botella recortada y una lata Quilmes de edición limitada que no corresponde al producto estándar. Se buscaron páginas oficiales de [Sprite](https://www.coca-cola.com/ar/es/brands/sprite/productos), [Fanta](https://www.coca-cola.com/ar/es/brands/fanta/productos), [Red Bull](https://www.redbull.com/ar-es/energydrink/products/red-bull-energy-drink) y [Heineken](https://www.heineken.com/ar/es/nuestros-productos/la-lata) como posibles puntos de partida; ninguna acredita todavía la foto exacta de esa presentación ni licencia de reutilización comercial.

No se descargó ni subió ninguna imagen a producción. CP sólo tiene el bucket privado `fiscal-documents` para PDF; además, `catalog_assets` espera assets propios con rutas y hashes vinculados. Crear un bucket sin imágenes autorizadas no resolvería esa asociación. Las 46 filas quedaron con `image_url=NULL` y `catalog_asset_id=NULL`. La nueva restricción evita que se publiquen así.

## Pendientes de operación

- **OWNER_SETUP: PENDING_REAL_IDENTITY.** El negocio CP tiene 0 miembros activos owner/admin. No se creó ninguna identidad ficticia. Un owner/admin real debe entrar para operar la nueva vista del Panel cuando se despliegue.
- Walter debe confirmar qué SKU/presentaciones de la lista vende, sus precios actuales y sus cantidades contadas. La confirmación previa fue por rubros, no por SKU.
- Las fotos necesitan packshots exactos y derechos documentados. Ocho candidatas requieren reemplazo visual y las otras 38 revisión de licencia. Sin ellas, la compuerta CP impide publicar.
- El código de Panel está listo en la rama, pero la validación autenticada y el despliegue CP quedan pendientes del flujo de release autorizado.
- Carnicería sigue fuera de este lote: falta categoría y circuito de peso variable. No se inventaron cortes, pesos ni fotos.

**CANARY_READY_FOR_PRICE_CONFIRMATION: DATA_READY.** Los nueve registros están en CP, ocultos, con precio pendiente y stock `NULL`. Para completar el canary desde el Panel faltan la identidad real, el despliegue del editor, los importes y conteos de Walter, y las imágenes aprobadas. **CANARY_READY_TO_PUBLISH: NO.**
