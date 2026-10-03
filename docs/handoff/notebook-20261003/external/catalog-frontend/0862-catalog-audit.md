# Auditoría del catálogo · normalización minorista TABA2

| | |
|---|---|
| **Fecha** | 2026-08-05 |
| **Worktree** | `D:\1212\la-taba2-unit-catalog-normalization` |
| **Rama** | `feature/taba2-unit-catalog-normalization` |
| **Base** | `b66add06231ff9df5be25144a854a9c1858f01c4` (cierre comercial P1) |
| **Universo** | 82 productos del catálogo que ve el cliente en `?demo=1` (92 filas en el catálogo de release; 10 no llegan al runtime) |

---

## 1. Hallazgo central

La Taba 2 es un autoservicio de barrio, pero **9 de los 20 productos comprables (45 %) son packs de proveedor**: packs x6 y x12 a $17.100–19.999. En la práctica, un vecino que quiere **una** Coca-Cola de 1,5 L hoy no puede comprarla: la única forma de llevar ese producto es un pack de seis a $19.999. Los rubros donde eso pasa —gaseosas y mixers— son justamente los que dominan la vidriera.

Ese es el problema comercial. Los otros tres hallazgos son de higiene de datos:

1. **Dos tarjetas comprables idénticas.** `speed-original-lata-473ml` y `speed-zero-lata-473ml` se publicaban **las dos** como "Speed Unlimited · 473 ml · $ 2.925". La variedad (Original / Zero Sugar) estaba en el registro y no llegaba a la góndola. Corregido.
2. **Cuatro productos duplicados entre dos orígenes del catálogo** (el aprobado heredado y el de autoridad): Monster Mango Loco, Imperial Golden, Corona Extra y Speed Zero aparecen dos veces, una con precio y otra pendiente. **No se tocaron**: consolidar es decisión humana.
3. **Un producto con empaque contradictorio.** `budweiser-lata-473ml-pack-6-local` dice "Pack x6" en su presentación y en su descripción, el catálogo de release declara `pack_count=6`, y el dato estructurado del runtime dice `unitsPerPack=1`. Queda AMBIGUO y nadie lo convierte.

Dos datos que condicionan todo lo demás:

- **El catálogo no tiene ni un código de barras cargado.** Las 92 filas del catálogo de release traen `gtin` vacío. Nada que migrar, todo por conseguir.
- **No existe ningún dato de costo, proveedor ni precio mayorista** en el catálogo. Por lo tanto no hay ni un solo costo unitario calculable, y ningún precio de venta pudo proponerse (ver `unit-pricing-review.md`).

---

## 2. Clasificación de los 82

| Clase | Cantidad | Qué significa acá |
|---|---:|---|
| **A · UNIT_READY** | 58 | Ya representan una unidad minorista: multiplicador 1, presentación coherente, sin tokens logísticos. |
| **B · WHOLESALE_PACK_TO_SPLIT** | 2 | Packs de compra cuya unidad **ya existe y se vende**: Red Bull 250 ml x4 y Heineken 473 ml x6. |
| **C · INTENTIONAL_CONSUMER_PACK** | 9 | Packs con precio y stock propios, presentados como pack, **sin unidad suelta equivalente** en el catálogo. |
| **D · AMBIGUOUS** | 1 | Budweiser 473 ml: multiplicador contradictorio entre tres fuentes. |
| **E · DUPLICATE_OR_VARIANT_CONFLICT** | 12 | Seis pares con el mismo nombre público. Tres eran variedades distintas mal nombradas (corregidas), tres son el mismo producto duplicado (para consolidar). |
| **Total** | **82** | |

Detalle por fila en `unit-normalization-map.csv`.

### B · Los dos packs de compra

| Pack | Multiplicador | Unidad minorista vinculada | Estado del pack |
|---|---:|---|---|
| `red-bull-original-lata-250ml-pack-4` | x4 | `red-bull-original-lata-250ml` — $ 3.576, comprable | sin precio, no comprable |
| `heineken-original-lata-473ml-pack-6` | x6 | `heineken-original-lata-473ml` — $ 3.900, comprable | archivado; ya no llega al cliente |

Ambos quedaron vinculados: el pack lleva su bloque `procurement` (interno) y la unidad la referencia inversa, de modo que **una recepción de 1 pack x6 suma 6 unidades** y una venta descuenta 1. Ninguno se borró ni cambió de id.

### C · Los nueve packs que hoy sostienen la vidriera

| Producto | Presentación | Precio |
|---|---|---:|
| Coca-Cola Original, Coca-Cola Zero, Sprite Original | Botella PET 500 ml · Pack x12 | $ 17.100 |
| Coca-Cola Original, Coca-Cola Zero, Sprite Original, Fanta Naranja | Botella PET 1500 ml · Pack x6 | $ 19.999 |
| Schweppes Tónica, Schweppes Citrus | Botella PET 1500 ml · Pack x6 | $ 19.999 |

**Se conservan como productos públicos.** Cumplen los tres criterios formales de pack de consumo (precio propio, stock propio, presentación que dice "Pack xN") y **no existe la unidad suelta equivalente** en el catálogo, así que convertirlos exigiría dividir un importe para publicar un precio unitario — exactamente lo que esta tarea prohíbe. Lo que falta es una decisión del negocio y un precio unitario aprobado; queda en `commercial-data-needed.md`.

### E · Los seis pares con el mismo nombre

**Corregidos** (variedades genuinamente distintas: la variedad ya estaba en el registro y ahora llega al nombre público):

| Par | Antes | Ahora |
|---|---|---|
| Speed 473 ml | "Speed Unlimited" ×2, ambas comprables a $ 2.925 | "Speed Unlimited Original" / "Speed Unlimited Zero Sugar" |
| Glaciar 1,5 L | "Glaciar" ×2 | "Glaciar Sin gas, baja en sodio" / "Glaciar Con gas, baja en sodio" |
| Manaos 2,25 L | "Manaos" ×2 | "Manaos Lima limón" / "Manaos Naranja" |

Además, la misma regla completó el nombre de cuatro Sprite que colisionaban entre sí ("Sprite Original" / "Sprite Sin azúcar"). Total: **10 nombres públicos completados**, ninguno inventado.

**No corregidos, para consolidar** (son el mismo producto duplicado entre dos orígenes; renombrarlos los disfrazaría de productos distintos):

| Producto | Fila con precio | Fila pendiente |
|---|---|---|
| Monster Mango Loco 473 ml | `monster-mango-loco-lata-473ml` — $ 3.390 | `monster-mango-loco-473ml` |
| Imperial Golden 473 ml | `imperial-golden-lata-473ml` — $ 3.000 | `imperial-golden-473ml` |
| Corona Extra 330 ml | `corona-extra-botella-330ml` — $ 3.600 | `corona-extra-330ml` |
| Speed Zero 473 ml | `speed-zero-lata-473ml` — $ 2.925 | `speed-zero-473ml` |

Plan de consolidación en la sección 5.

---

## 3. Qué se cambió y qué no

**Se cambió** (todo derivado de datos que ya estaban en el registro, en el funnel de catálogo, sin editar archivos generados):

- 10 nombres públicos completados con su variedad.
- 2 packs de compra vinculados a su unidad minorista, con bloque `procurement` interno.
- Modelo, validaciones y pruebas: `js/core/retail-packaging.js`.

**No se cambió, deliberadamente:**

- Ningún precio, costo, stock, código de barras, imagen ni disponibilidad.
- Ningún id ni sku (deep links, favoritos y pedidos históricos siguen resolviendo).
- Ninguna fila de `catalog/products.json`, `products.csv` ni de los archivos de datos generados.
- El producto ambiguo (Budweiser) y las cuatro filas duplicadas.
- Los nueve packs de consumo.

---

## 4. Stock: clasificación del estado actual

La regla es que la unidad de stock sea la de venta. Hoy **eso se cumple**, y por eso no se transformó ningún stock:

| Situación | Productos | Estado |
|---|---:|---|
| Stock unitario, coherente con la venta por unidad | 11 comprables sueltos | correcto |
| Stock en packs, coherente con la venta por pack | 9 packs de consumo | correcto (99 packs = 99 unidades de venta) |
| Sin stock real | 62 pendientes | `stock: 0`, no comprables |

**No hay ningún caso demostrable de stock expresado en bultos vendiéndose por unidad**, que es el único que justificaría convertir. El valor 99 de los comprables es sintético de la demo (`requiresBusinessConfirmation: true` en las 82 filas): no es inventario real y no se tocó.

Las reglas de conversión quedan implementadas y probadas para cuando entre inventario real: `unitsReceivedFromPurchase` (1 pack x6 → +6 unidades), `applyUnitSale` (1 venta → −1 unidad), multiplicador inválido o ambiguo → `null`, y la pasada completa es idempotente (correrla dos veces no vuelve a multiplicar ni a dividir).

---

## 5. Plan de consolidación de duplicados

No se ejecuta acá: cambia identidades y eso afecta pedidos históricos, favoritos y deep links.

Para cada uno de los cuatro pares:

1. **Confirmar con el local que son el mismo producto** (misma marca, capacidad y envase). La evidencia sugiere que sí, pero la subcategoría difiere entre orígenes y eso merece una mirada humana.
2. **Elegir la fila superviviente.** Recomendación: conservar la fila **con precio** (la heredada aprobada), porque es la que ya tiene historial de compra y la que el cliente ve comprable.
3. **Trasladar a la superviviente lo que aporte la otra fila**: imagen verificada, `image_sha256`, subcategoría de autoridad, y el `gtin` cuando llegue.
4. **Archivar la fila redundante** (`archived: true`), nunca borrarla: conserva su id para pedidos históricos y deep links viejos.
5. **Regenerar el catálogo de autoridad** con `scripts/taba2-catalog-authority.mjs` para que el duplicado no vuelva a nacer en la próxima importación.

Riesgo si no se hace: el día que el local cargue precios, los cuatro pares quedan **los dos comprables** y el cliente ve dos tarjetas idénticas con precios distintos.

---

## 6. Códigos de barras — estado y necesidad

**Cero códigos cargados en las 92 filas.** Nada que corregir; todo por conseguir.

Quedan implementadas y probadas las reglas para cuando lleguen: validación de EAN-8, UPC-A, EAN-13 y GTIN-14 con dígito verificador, **conservación de ceros a la izquierda** (el código es cadena, nunca número), y la distinción entre código de unidad y código de agrupación logística — un GTIN-14 **no puede** usarse como código de la unidad.

**Fuera de alcance, documentado y detenido:** que el escáner del Panel distinga un escaneo de unidad de uno de pack de compra exige cambios en el Panel y en el backend (columna de código de pack, RPC de recepción de mercadería). No se implementó nada de eso acá; ver `commercial-data-needed.md`.

---

## 7. Imágenes

- **81 productos visibles tienen imagen**; ninguno quedó sin asset.
- Los 9 packs de consumo usan una imagen que muestra el pack (con su distintivo x6/x12). **Es correcto mientras el pack sea lo que se vende.** Si el negocio decide publicar la unidad suelta, esa unidad necesita su propia foto: no se puede recortar ni reutilizar la del pack.
- Los 2 packs de compra tienen imagen de pack y su unidad vinculada tiene la suya: correcto.
- No se descargó, generó ni reemplazó ninguna imagen. El hero y los banners no se tocaron.

---

## 8. Verificación

- `npm run check` PASS · unitarias **843/843** · Chromium **195/195** (4 shards, workers=1) · `secrets:scan` PASS · `git diff --check` limpio.
- Verificación viva a 320 / 390 / 432 / 1280: 81 tarjetas, 20 comprables, **0 duplicadas**, 0 nombres con logística, 0 `$0`, 0 overflow, 0 errores de consola, 0 requests fallidos y 0 filtraciones del bloque de compra al DOM.
- 28 pruebas nuevas del modelo y sus invariantes + 9 contratos e2e de presentación minorista.
- 0 errores de consola, 0 requests fallidos, 0 overflow, 0 `$0`, 0 productos mayoristas comprables por accidente.
