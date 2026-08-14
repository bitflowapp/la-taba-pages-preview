# TABA2 · auditoría de catálogo argentino

Fecha de auditoría: 2026-08-14. Alcance: demo/local de
`feature/taba2-commerce-growth-engine`. No se importó nada a staging ni se
cambiaron precios reales.

## Estado actual

| Capa | Registros | Lectura comercial |
| --- | ---: | --- |
| Fuente demo | 82 | Datos locales, con pendientes mezclados |
| Modelo retail | 91 | Separa unidades minoristas de packs de abastecimiento |
| Visible al cliente | 80 | Incluye productos pendientes para búsqueda honesta |
| Comprable ahora | 11 | 7 cervezas + 4 energizantes |
| Precio pendiente | 69 | No entran al ranking de compra ni al carrito |

La góndola comprable actual es:

- Cervezas: Heineken Original 473 ml, Imperial Golden/Extra Lager/APA/Cream
  Stout 473 ml, Schneider Rubia 710 ml y Corona Extra 330 ml.
- Energizantes: Red Bull Original 250 ml, Speed Original/Zero 473 ml y Monster
  Mango Loco 473 ml.

## Gaps y prioridad

| Prioridad | Gap | Evidencia local | No se publicó porque |
| --- | --- | --- | --- |
| MUST HAVE | Fernet real | Fernet Branca 750 ml, Fernet Vittone 1 L, Buhero Negro 450 ml | falta precio/stock; derechos pendientes |
| MUST HAVE | Coca y mixers | Coca-Cola Original/Sin Azúcar 2,25 L; packs heredados | unidades sin precio/stock; packs son procurement/review-only |
| MUST HAVE | Hielo | Hielo Cristal 4 kg | falta precio/stock; derechos pendientes |
| HIGH VALUE | Cerveza argentina | Quilmes, Patagonia, Brahma, Amstel y otras unidades | falta precio/stock; derechos pendientes |
| HIGH VALUE | Pack de cerveza minorista | Budweiser x6 pendiente; Heineken x6 rechazado | precio/stock/derechos; Heineken comparte hash con la lata individual |
| HIGH VALUE | Vodka | Smirnoff 700 ml | imagen declara 750 ml: conflicto SKU/asset, rechazado |
| NICE TO HAVE | Más estilos y mixers | resto de candidatos del catálogo | requiere autoridad comercial antes de completar la góndola |

## Packs y combos

Los registros Coca-Cola x12/x6 existentes son packs de abastecimiento y no se
convierten automáticamente en artículos minoristas. El SKU Heineken x6 tiene
una imagen idéntica a la lata individual y está rechazado; no se usa como pack.

Los combos comerciales existentes en `data/combos.csv` son:

- Previa Imperial x6
- Heineken x6
- Corona Extra x6
- Birra y energía
- Tabla de cervezas
- Noche larga
- Cuatro para arrancar

Sus componentes, stock, precio de lista, precio promocional y ahorro se derivan
del catálogo vivo. No existe un combo autorizado Fernet + Coca ni Fernet + Coca
+ hielo, por lo que no se creó ninguno.

Para combos de un solo SKU, la tarjeta usa tres imágenes de unidades reales y
un badge `x6`/`x4`; es una composición honesta, no packaging generado. Los
combos de componentes distintos mantienen una imagen por componente y sus
cantidades. No se generaron imágenes de marca ni etiquetas nuevas.

## Merchandising e intención

- Cold start mantiene `Destacados` y variedad general.
- Beer intent prioriza cervezas; la diversidad diferencia marca, categoría y
  presentación (lata/botella, unidad/pack cuando exista).
- Fernet intent tiene soporte genérico en ranking: Fernet primero; Coca/mixers y
  hielo sólo como secundarios cuando estén comprables.
- Vodka/destilados usan categoría y tags, pero no se fuerza un hero ni un SKU
  sin autoridad.
- El grafo de complementos actual es `fernet → gaseosas/mixers/hielo`,
  `cervezas → hielo` y `destilados → mixers/hielo/energizantes`. Desde un
  carrito alcohólico nunca se recomienda más alcohol.
- No se muestra una sección `Packs` vacía: el threshold no se cumple con packs
  minoristas aprobados. `Combos del local` permanece separado.

## Search y datos pendientes

Las búsquedas `fernet`, `coca`, `heineken`, `cerveza`, `imperial`,
`energizante` y `hielo` encuentran coincidencias locales; el nombre/brand exacto
queda antes que una coincidencia sólo por categoría. `vodka` devuelve cero
resultados porque el único candidato local fue rechazado por conflicto de
presentación. Eso es un gap documentado, no un SKU ficticio.

Pending catalog data requerido antes de publicar: precio, stock y decisión de
derechos para Fernet/Coca/Hielo y candidatos de cerveza; asset corregido y
confirmación comercial para Smirnoff; precio, stock, derechos y representación
real de pack para Budweiser x6. La lista pendiente no se aplica automáticamente.

## Cambios de esta fase

Productos agregados localmente: **ninguno**. Se ajustaron reglas genéricas de
cross-sell, búsqueda, diversidad por presentación y rendering visual de combos.
No hubo migraciones, import comercial, cambio de precio, credenciales ni datos
server-side nuevos.
