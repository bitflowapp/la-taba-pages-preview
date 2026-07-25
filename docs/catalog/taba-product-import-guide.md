# Importación del catálogo TABA

`data/catalog-template.csv` contiene sólo encabezados: no inventa precios,
stock, marcas ni productos. Completar una fila por SKU aprobado, UTF-8 y punto
decimal. `external_id` y `sku` deben ser estables y únicos por comercio.

Categorías exactas: Promos, Gaseosas, Aguas, Jugos, Energéticas, Isotónicas,
Cervezas, Vinos y espumantes, Gins y vodkas, Whisky y destilados, Picadas y
deli, Hielo y extras.

Validar antes de importar:

```sh
node scripts/validate-product-catalog.mjs data/catalog-real.csv
```

El validador rechaza IDs/SKU duplicados, precio o stock inválidos, capacidad,
categoría, flags, alcohol sin edad, imagen ausente/ruta insegura y obligatorios
vacíos. Importar primero con `available=false`; un humano verifica producto,
precio, stock e imagen antes de publicar.
