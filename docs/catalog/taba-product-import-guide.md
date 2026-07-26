# Importación del catálogo TABA

`data/catalog-template.csv` contiene sólo encabezados: no inventa precios,
stock, marcas ni productos. Completar una fila por SKU aprobado, UTF-8 y punto
decimal. `external_id` y `sku` deben ser estables y únicos por comercio.

Categorías exactas: Promos, Gaseosas, Aguas, Jugos, Energéticas, Isotónicas,
Cervezas, Vinos y espumantes, Gins y vodkas, Whisky y destilados, Picadas y
deli, Hielo y extras.

Validar antes de importar. El comando sin archivo falla deliberadamente para
evitar aprobar por accidente el template vacío:

```sh
npm run catalog:validate -- data/catalog-real.csv
```

El validador rechaza IDs/SKU duplicados, precio cero o negativo, stock inválido,
variante, valor o unidad de capacidad, categoría, flags, inconsistencias entre categoría/alcohol/edad,
imagen ausente/ruta insegura, diferencias contra `image-manifest.json` y campos maestros vacíos. Sólo
`catalog:template:validate` permite un CSV sin filas.

Los límites técnicos reflejan PostgreSQL: precio `numeric(12,2)` hasta
`9999999999.99`; stock, unidades por pack y orden visual usan enteros entre
`0` y `2147483647` (unidades por pack empieza en `1`). NaN, Infinity y valores
que JavaScript no puede representar de forma finita se rechazan antes de la RPC.

Revisar el plan determinista sin conectarse:

```sh
npm run catalog:import -- data/catalog-real.csv \
  --business-id 00000000-0000-4000-8000-000000000000 \
  --dry-run
```

Aplicar requiere reemplazar el UUID, indicar `--apply` expresamente y exportar
estas variables sólo en la terminal actual:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY (o SUPABASE_ANON_KEY)
SUPABASE_ACCESS_TOKEN
```

`SUPABASE_ACCESS_TOKEN` debe pertenecer a un owner/admin autorizado. El
importador no admite `service_role`/`sb_secret_`, no imprime credenciales,
envía assets y productos a una única RPC atómica y deja el lote en staging.
Si falla el registro, la reconciliación de identidad, el staging o la
cardinalidad de respuesta, PostgreSQL revierte el lote completo.

Toda importación fuerza `available=false`, `is_verified=false` y limpia la
verificación previa. Un owner/admin debe comparar producto, precio, stock e
imagen y publicar mediante `publish_catalog_product`; la RPC registra
`verified_by=auth.uid()` y `verified_at=statement_timestamp()`. Esos campos no
son editables directamente. El valor `available` del CSV queda visible en el
dry-run como intención comercial, pero nunca saltea ese gate.

La importación conserva `variant`, `capacity_value` y `capacity_unit` como
campos estructurados; `presentation` y `capacity` se derivan sólo por
compatibilidad. Una modificación posterior de identidad, variante, capacidad,
presentación compatible, precio, alcohol o asset
despublica el producto. Stock, pausa y orden visual siguen siendo operativos.

El gate comercial real requiere una ruta explícita:

```sh
npm run catalog:release:validate -- data/catalog-real.csv
```

Sin catálogo real o sin imágenes aprobadas el comando falla; el template vacío
no habilita staging ni release.
