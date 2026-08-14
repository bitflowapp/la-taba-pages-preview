# Fuentes de autoridad comercial de TABA2

Mapa único de "dónde se pregunta cada cosa". Todas las rutas son relativas a la
raíz del repositorio. **Ninguna skill del paquete guarda precios, stock,
promociones ni conteos**: se leen de acá, en el momento, porque envejecen.

## Qué contesta cada archivo

| Pregunta | Fuente | Nota |
|---|---|---|
| ¿Qué productos existen y con qué identidad? | `catalog/products.csv` | dato crudo por SKU |
| ¿En qué estado comercial está cada SKU? | `catalog/CATALOG-COMMERCIAL-AUTHORITY.csv` | corte auditado; incluye `estado`, `bloqueo`, `ahorro_calculado` |
| ¿Cuál es la lectura ejecutiva de ese corte? | `docs/CATALOG-COMMERCIAL-AUTHORITY.md` | resumen por rubro; **tiene fecha de corte** |
| ¿Qué falta para completar la góndola? | `docs/catalog-merchandising.md`, `docs/CATALOG-WALTER-PENDING.md` | gaps y prioridad |
| ¿Qué precios faltan? | `catalog/pending-prices.csv`, `catalog/pending-unit-prices.csv` | |
| ¿Qué imágenes faltan o están rechazadas? | `catalog/pending-images.csv`, `catalog/rejected-assets.csv` | |
| ¿Una imagen está aprobada y con derechos? | `docs/catalog/image-manifest.json`, `catalog/image-rights.csv`, `docs/catalog/image-source-audit.csv` | un WebP no manifestado invalida el pipeline |
| ¿Cómo se produce una imagen válida? | `docs/catalog/taba-image-guidelines.md` | 1000×1000 + thumb 400×400, fondo blanco |
| ¿Qué combos existen y con qué componentes? | `data/combos.csv` | el precio NO está acá: se deriva |
| ¿Cómo se resuelve un combo contra el catálogo vivo? | `js/core/combos.js` | fuente de verdad del ahorro |
| ¿Qué significa "precio pendiente" o "stock pendiente"? | `js/core/pricing.js` + `CONTRATO-PRECIO-STOCK.md` | contrato cliente/servidor |
| ¿Qué valida una promoción? | `js/core/promotions.js` | aprobación humana + vigencia + precios verificables |
| ¿Cómo se importa y publica? | `docs/catalog/taba-product-import-guide.md` | |
| ¿Qué exige el alcohol? | `docs/legal/alcohol-operational-requirements.md` | |
| ¿Cómo se decide qué pieza se muestra? | `docs/commerce-personalization.md` + `js/growth/` | |

## Comandos que devuelven estado actual

Son de lectura y no tocan datos remotos salvo donde se indica.

```sh
npm run catalog:readiness         # estado de publicación por SKU
npm run catalog:readiness:check   # falla si el estado no coincide con lo versionado
npm run catalog:sheet:check       # verifica la planilla comercial
npm run catalog:prices:check      # pendientes de precio unitario
npm run catalog:validate -- <archivo.csv>   # valida un CSV antes de importar
npm run catalog:images:verify     # imágenes aprobadas contra manifiesto
npm run catalog:release:validate  # compuerta de release del catálogo
```

`catalog:validate` sin archivo **falla a propósito**: evita aprobar por accidente
el template vacío.

## Categorías (lista cerrada)

Promos · Gaseosas · Aguas · Jugos · Energéticas · Isotónicas · Cervezas · Vinos y
espumantes · Gins y vodkas · Whisky y destilados · Picadas y deli · Hielo y
extras.

La taxonomía interna del storefront usa ids propios (`cervezas`, `gaseosas`,
`energizantes`, `destilados`, `hielo`…). **No existen `whisky` ni `gin` como ids
sueltos**: son `destilados`. Inventar un id de categoría rompe el ranking en
silencio, porque nada matchea y la sección queda vacía sin error.

## Lo que NO es autoridad

- **Internet.** Que un producto exista en el mundo, o que un buscador devuelva su
  ficha, su volumen o su precio de lista, no lo vuelve parte del surtido de este
  comercio. Lo que se vende, en qué presentación y a qué precio lo decide el
  dueño del local. Una búsqueda web sirve para *contrastar* un dato que alguien
  ya afirmó; nunca para *originarlo*.
- La memoria de una sesión anterior.
- Un informe con fecha de corte, para decir qué **hay hoy**. Sirve para saber qué
  se auditó y por qué se bloqueó algo; el número vigente está en el CSV/código.
- El fixture de demo. `js/approved-beverage-demo-data.js` pasa por
  `applyRetailCatalogModel` antes de llegar al storefront: un análisis estático
  sin aplicar ese modelo describe un catálogo que nadie ve.
- El valor `available` de un CSV de importación: es intención comercial, y nunca
  saltea la verificación humana.

## Datos volátiles: prohibido congelarlos

No escribir en una skill, ni en un documento de skills, valores de: precio, stock,
cantidad de productos comprables, promociones vigentes, costos de servicios,
alícuotas ni reglas legales. Se referencia dónde se leen. Un número copiado en
una skill sobrevive al día en que dejó de ser cierto.
