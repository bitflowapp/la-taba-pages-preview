# Campos de producto y qué los valida

Dos esquemas conviven y no hay que mezclarlos.

- **Importación** (`data/catalog-template.csv`): lo que una persona completa.
- **Catálogo auditado** (`catalog/products.csv`): lo que el repo ya conoce, con
  los estados de verificación agregados.

## Esquema de importación

| Campo | Obligatorio | Regla |
|---|---|---|
| `external_id` | sí | estable y único por comercio; no se recicla |
| `sku` | sí | estable y único; es la clave que referencian los combos |
| `brand` | sí | marca real, tal como figura en el envase |
| `name` | sí | nombre público, sin información logística ("Pack x6" no va en el nombre) |
| `variant` | no | variedad (Original, Sin Azúcar, Zero); si duplica el nombre, se omite |
| `category` | sí | de la lista cerrada de categorías |
| `subcategory` | no | |
| `capacity_value` | sí | número finito > 0 |
| `capacity_unit` | sí | `ml`, `l`, `cc`, `kg`, `g` según el producto |
| `package_type` | sí | lata, botella, retornable, PET, bolsa… |
| `units_per_pack` | sí | entero ≥ 1. **1 = individual**; > 1 exige imagen de pack |
| `price` | sí | `numeric(12,2)`, > 0. Cargar un precio **es confirmarlo** |
| `stock` | sí | entero ≥ 0. Vacío no es cero: vacío es "nadie contó" |
| `available` | sí | intención comercial; no saltea la verificación humana |
| `alcoholic` | sí | debe ser coherente con la categoría |
| `minimum_age` | sí si `alcoholic` | sin valor, la venta de alcohol falla cerrada |
| `chilled` | no | |
| `featured` | no | |
| `sort_order` | no | entero 0..2147483647 |
| `image_path` | sí | ruta segura dentro del repo, presente en el manifiesto |
| `tags` | no | **aliases de búsqueda**; acá va el nombre popular |

El validador rechaza: ids/SKU duplicados, precio cero o negativo, stock inválido,
variante/valor/unidad de capacidad inconsistentes, categoría desconocida, flags
incoherentes entre categoría/alcohol/edad, imagen ausente o con ruta insegura,
diferencias contra `image-manifest.json`, y campos maestros vacíos. `NaN`,
`Infinity` y valores no representables se rechazan **antes** de llegar a la RPC.

## Campos de estado del catálogo auditado

`catalog/products.csv` agrega, entre otros: `price_status`, `stock_status`,
`is_active`, `is_verified`, `publication_status`, `catalog_status`,
`image_status`, `rights_status`, `identity_status`, `commercial_status`,
`alcohol_status`, `image_sha256`, `image_thumbnail_sha256`, `priority`.

Son estados **independientes**. "Tiene imagen" no implica "tiene derechos", y
"está verificado" no implica "está publicado". Un informe que colapsa estos ejes
en un solo semáforo pierde exactamente la información que sirve para desbloquear.

## Estados de la matriz de autoridad

`catalog/CATALOG-COMMERCIAL-AUTHORITY.csv` resume el bloqueo en `estado`:

| Estado | Significa |
|---|---|
| `READY` | todas las casillas cerradas |
| `NEEDS_PRICE` | falta precio confirmado por el negocio |
| `NEEDS_STOCK` | falta conteo de stock |
| `NEEDS_IMAGE` | falta imagen frontal válida |
| `NEEDS_PRESENTATION` | la presentación declarada está incompleta |
| `NEEDS_COMMERCIAL_APPROVAL` | falta autoridad de publicación, derechos o stock de fuente |
| `REJECTED_DATA_CONFLICT` | dos fuentes se contradicen sobre un hecho verificable |

Estado de imagen: `APPROVED`, `PACK_NEEDS_COMPOSITION`, `MISSING`,
`WRONG_PRESENTATION`, `LOW_QUALITY`.

## Verificación e identidad

Toda importación fuerza `available=false` e `is_verified=false` y limpia la
verificación previa. Publicar exige una ruta explícita con una persona
owner/admin comparando producto, precio, stock e imagen. La RPC registra quién
verificó y cuándo; esos campos **no son editables** directamente.

Cambiar identidad, variante, capacidad, presentación, precio, alcohol o asset
**despublica** el producto. Es deliberado: nada verificado cambia en silencio.
Stock, pausa y orden visual sí son operativos y no despublican.

Dos matices que un simulacro contra PostgreSQL real corrigió: quedarse sin stock
**no** des-verifica un producto, y volver a precio pendiente tampoco. La
verificación es sobre identidad e imagen; precio y stock apagan la venta por
`available`.
