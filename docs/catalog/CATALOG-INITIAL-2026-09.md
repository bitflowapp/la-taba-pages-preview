# La Taba · catálogo real inicial · 26 de septiembre de 2026

## Resultado

**CATALOG_REAL_READY: PARTIAL · WAITING_FOR_REAL_PRICES: YES.** Se investigaron 46 presentaciones y se preparó un canary de 9 altas ocultas. Ninguna fila se escribió en Controlled Production y ninguna se publicó. El catálogo público sigue vacío. Los 46 precios y stocks de La Taba están sin confirmar; tampoco hay una licencia comprobada para reutilizar las imágenes candidatas.

La tienda servida por `https://la-taba-commercial-pilot.pages.dev/` usa el proyecto Supabase `tkanbadcglszlcyfjvpv` y el negocio `e7850ad2-a447-402c-8375-3fd74e9466ba`. La lectura de ese negocio antes de cualquier escritura devolvió `products=[]`, `catalog_assets=[]` y `catalog_product_drafts=[]`; el [backup lógico](catalog-backup-cp-2026-09-26.json) conserva exactamente ese estado. Los ocho productos presentes en otro negocio del proyecto pertenecen a QA y no se tocaron.

## Auditoría del contrato

| Campo | Hallazgo |
| --- | --- |
| CATALOG_SCHEMA | `public.products` guarda `name`, `brand`, `variant`, `capacity_value`, `capacity_unit`, `packaging_type`, `category`, `subcategory`, `price`, `price_status`, `stock`, `available`, `is_verified`, `is_alcoholic`, `minimum_age`, `external_id`, `sku` y referencias opcionales de imagen. `catalog_product_drafts` es una tabla separada y privada de revisión. |
| IMPORTER_FOUND | `scripts/import-commercial-catalog.mjs` permite altas ocultas con precio y stock vacíos. `scripts/import-product-catalog.mjs` exige precio positivo, stock entero y asset aprobado, por lo que no corresponde a este lote. El primero ya existe; no se creó otro importador. |
| IMAGE_STORAGE | CP sólo tiene el bucket privado `fiscal-documents`, restringido a PDF. No existe bucket de productos ni objetos de imagen. El contrato de `catalog_assets` exige rutas propias `assets/products/*.webp`, hashes vinculados y `rights_status` comercial documentado. Ninguna URL externa se usó como hotlink en producción. |
| PUBLICATION_RULES | `available=true` exige producto activo y verificado, `price_status=confirmed`, precio > 0 y stock conocido > 0. La RLS pública filtra además por negocio abierto y pedidos habilitados. El alcohol requiere `is_alcoholic=true` y `minimum_age>=18`; CP mantiene `alcohol_sales_enabled=false`. |
| REQUIRED_FIELDS | Para un alta oculta: SKU estable, nombre, categoría de la taxonomía y clasificación alcohólica explícita. Para verificar/publicar: identidad y presentación estructurada, subcategoría, precio autorizado, stock contado, revisión comercial e imagen asociada conforme al contrato de assets si se usa foto. |
| PRICE_STATUS | `price=0` con `price_status=pending` representa ausencia de precio en la tabla, pero no es un precio de venta. Ningún importe de otro comercio se copió al catálogo nuevo. |
| STOCK_STATUS | `stock=NULL` significa no contado; `stock=0` significa agotado. Es una distinción material. |

La interfaz incluye la confirmación “soy mayor de 18 años” y el repositorio de pedidos exige confirmarla para bebidas alcohólicas. La compuerta no pudo probarse en CP porque los pedidos y las ventas de alcohol están deshabilitados.

La taxonomía ya define Gaseosas, Cervezas, Fernet, Aperitivos, Vinos, Aguas, Energizantes, Jugos, Hielo y Snacks; no se duplicaron categorías. `Carnicería` y las categorías de cortes todavía no existen en la taxonomía canónica ni en la lista permitida para productos verificados.

**Bloqueo descubierto en la RPC existente:** `apply_commercial_catalog_plan` convierte una celda de stock vacía en `0`. Eso falsearía “no contado” como “agotado”. El importador quedó protegido para CP: antes de aplicar un alta con stock vacío consulta el contrato del servidor y se detiene si conserva esa conversión. La RPC de CP aún requiere una corrección antes de importar este lote sin stock.

El importador también se ajustó para leer explícitamente el catálogo CP. Su opción anterior `--catalogo produccion` consultaba otro proyecto y otro negocio; aplicar sobre CP con esa comparación podía clasificar erróneamente los SKU como existentes. `--catalogo cp` ahora mide el negocio CP y comprueba que el destino de escritura coincida. La variante histórica continúa disponible.

## Investigación y canary

La [tabla maestra](../../catalog/real-catalog-initial.csv) contiene los 46 SKU, sus variantes, tamaños, envases, categorías, URLs exactas de referencia, estados de imagen, precio, stock y publicación. Las 46 páginas de producto respondieron HTTP 200 y entregaron una URL de imagen candidata el 26 de septiembre; son referencias de retailer, no pruebas de licencia ni de disponibilidad en La Taba. El [archivo de procedencia](catalog-source-2026-09.json) registra `product_name`, `source_url`, `source_domain` y `date_retrieved` por imagen, además de la página de producto.

| Categoría | Presentaciones investigadas |
| --- | ---: |
| Gaseosas | 7 |
| Cervezas | 8 |
| Fernet | 1 |
| Aperitivos | 4 |
| Aguas | 5 |
| Energizantes | 4 |
| Vinos | 5: Malbec, Cabernet Sauvignon, red blend y blanco dulce |
| Jugos | 2 |
| Hielo | 1: Hielo Cristal, bolsa de 4 kg verificada en la fuente; no se presume que Walter venda esa bolsa |
| Snacks | 5 |
| Mixers | 4 |
| **Total** | **46** |

El canary preparado en [real-catalog-canary.csv](../../catalog/real-catalog-canary.csv) comprende Coca-Cola Sabor Original 2,25 L, Coca-Cola Sin Azúcar 2,25 L, Sprite Sin Azúcar 2,25 L, Fanta Naranja 2,25 L, Villavicencio Sin Gas 500 ml, Red Bull Energy Drink 355 ml, Quilmes Clásica 710 ml, Heineken Lager 710 ml y Fernet Branca 750 ml. El dry run del importador contra CP devolvió **9 altas, 0 modificaciones, 0 errores y 0 productos comprables**. Marca las tres bebidas alcohólicas con edad mínima 18.

### Imágenes

Las 46 URL son sólo candidatas. Se inspeccionaron visualmente las nueve del canary:

- Villavicencio Sin Gas 500 ml tiene un packshot limpio y coincide con la presentación. Aún requiere permiso de uso comercial.
- Coca-Cola Sabor Original, Coca-Cola Sin Azúcar, Fanta, Red Bull y Heineken tienen paneles de texto grandes en la foto; no cumplen el criterio visual de la tienda.
- Sprite Sin Azúcar es demasiado borrosa.
- Quilmes Clásica muestra una edición limitada del Mundial; no corresponde al SKU estándar.
- Fernet Branca está recortado y tiene un panel de texto externo.

Por ello, **8 imágenes del canary necesitan reemplazo** y **1 coincide visualmente pero requiere licencia**. Las otras 37 URL no han pasado revisión visual individual. No se descargó ningún asset al repositorio, no se subió nada a Storage y no se afirmó ningún permiso de uso. Los originales examinados quedaron sólo en el área temporal de trabajo, fuera del commit.

Dieciséis URL de imagen actuales difieren de las registradas en el manifiesto anterior del repositorio; el archivo de procedencia conserva ambas referencias para revisar el cambio antes de asociar cualquier asset.

La página oficial de [Coca-Cola Sabor Original](https://www.coca-cola.com/ar/es/brands/coca-cola/original), la página argentina de [Red Bull Energy Drink](https://www.redbull.com/ar-es/energydrink/products/red-bull-energy-drink) y la descripción de la [lata Heineken](https://www.heineken.com/ar/es/nuestros-productos/la-lata) corroboran marca o variante. Las presentaciones exactas se contrastaron con las páginas de retailer registradas por SKU. Es una inferencia de identidad comercial, no una autorización para usar sus fotografías.

### Carne

Walter mencionó cortes tradicionales, productos premium, milanesas y perniles como líneas a investigar, sin identificar SKU, formato ni peso de venta. Como referencia de nombres de cortes habituales, una [fuente pública argentina](https://www.argentina.gob.ar/node/360746) enumera asado, nalga, matambre, vacío, falda, paleta y tapa de asado. No se incorporaron como productos porque la tienda no tiene taxonomía de Carnicería ni un circuito de peso variable: la RPC de borradores permite registrar la modalidad `variable_weight`, pero una guarda impide aprobarla. “Milanesas” y “pernil” también requieren precisar especie, preparación, empaque y venta por kg o por unidad. No se asignaron fotos genéricas, pesos ni precios.

## Estado de importación y validación web

**CATALOG_BACKUP: PASS.** El snapshot del negocio CP se tomó antes de cualquier intento de escritura. **CANARY_IMPORT: DRY_RUN_PASS / NOT_APPLIED.** No hay token owner/admin para el negocio CP en el almacén local y el negocio no tiene miembros registrados. Se detuvo la aplicación antes de escribir. La protección de stock descrita arriba bloquearía igualmente el alta hasta corregir la RPC.

**CANARY_WEB_QA: BLOCKED.** La tienda CP respondió HTTP 200 en Chromium y WebKit a 390×844, 430×932 y 1366×768, sin errores de consola, imágenes rotas ni desbordamiento horizontal. La revisión visual mostró la pantalla “Por ahora no estamos tomando pedidos online”, sin cards de producto. En la base, el negocio figura `status=closed`, `ordering_enabled=false` y `ordering_verified=false`. No se cambió ese estado comercial. Cards, detalle y carrito del canary no pueden probarse aún.

## Pendientes para completar

1. Walter debe confirmar los SKU que efectivamente vende y entregar precios actuales y stock contado; la confirmación de rubros generales no asigna esos datos a cada presentación.
2. Provisionar una identidad owner/admin autorizada para el negocio CP, por el canal operativo existente. No modificar roles mediante este lote.
3. Corregir en CP la RPC de alta para que stock vacío se guarde como `NULL`; volver a ejecutar el dry run y comprobar la base tras el canary.
4. Obtener packshots exactos con permiso comercial documentado y resolver el alojamiento propio compatible con `catalog_assets`. Sustituir las ocho fotos rechazadas y revisar visualmente las otras 37.
5. Mantener la tienda cerrada hasta que el responsable habilite pedidos. Con el canary publicado, repetir QA de card, ficha y carrito en los seis tamaños/motores.
6. Diseñar la categoría y el circuito de pesaje/cobro de Carnicería antes de publicar carne por peso.

No se tocaron pagos, OAuth, webhooks, Rider, ARCA, LocalAgent, roles, RLS general ni checkout.
