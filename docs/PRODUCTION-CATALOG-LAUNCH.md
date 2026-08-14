# TABA2 · Catálogo mínimo de lanzamiento

Fuente: `catalog/CATALOG-COMMERCIAL-AUTHORITY.csv` · **99 filas**.

**Acá no se inventa ni un precio, ni un stock, ni una aprobación.** Todo lo que
falta está marcado como falta, con nombre y apellido de quién lo tiene que
resolver.

> **Dónde vive la matriz.** El CSV existe **sólo** en
> `feature/taba2-commerce-growth-engine` (commit `0192c68`). **No está en la
> RC.** Si el motor de growth se difiere —y se difiere—, este archivo hay que
> traerlo aparte: es un commit de sólo documentación y se puede tomar sin
> arrastrar el resto de la rama.

---

## 1 · De dónde partimos

| Estado | Filas |
|---|---|
| `NEEDS_PRICE` | 61 |
| `NEEDS_COMMERCIAL_APPROVAL` | 27 |
| `NEEDS_IMAGE` | 9 |
| `REJECTED_DATA_CONFLICT` | 2 |
| **`READY`** | **0** |

Pero el estado global engaña, porque **el 79 % del catálogo ya tiene la imagen
resuelta**:

| Imagen | Filas |
|---|---|
| `APPROVED` | **78** |
| `PACK_NEEDS_COMPOSITION` | 11 |
| `MISSING` | 9 |
| `WRONG_PRESENTATION` | 1 |

Y **27 filas ya tienen precio** (`precio_confirmado` = SI o SI derivado), de las
cuales **18 son comprables hoy en el runtime de demostración**: 11 unidades y 7
combos. Las otras 9 son packs con precio pero con la imagen bloqueada.

**La lectura que importa:** para llegar a 30 SKUs no hay que construir nada. Hay
que **decidir 30 veces**.

---

## 2 · La lista para Walter — 30 SKUs

### Lista A · 18 SKUs — precio e imagen ya están; falta que Walter los apruebe

Éstos ya tienen precio cargado e imagen aprobada. Lo único que los frena es
**autoridad comercial**: que Walter confirme que ése es su precio real, que
tiene stock, y que puede publicar la marca.

| # | `product_key` | Producto | Precio en la matriz |
|---|---|---|---|
| 1 | `imperial-golden-lata-473ml` | Imperial Golden · lata 473 ml | $3.000 |
| 2 | `imperial-extra-lager-lata-473ml` | Imperial Extra Lager · lata 473 ml | $3.000 |
| 3 | `imperial-apa-lata-473ml` | Imperial APA · lata 473 ml | $3.000 |
| 4 | `imperial-cream-stout-lata-473ml` | Imperial Cream Stout · lata 473 ml | $3.000 |
| 5 | `schneider-rubia-lata-710ml` | Schneider Rubia · lata 710 ml | $3.500 |
| 6 | `corona-extra-botella-330ml` | Corona Extra · botella 330 ml | $3.600 |
| 7 | `heineken-original-lata-473ml` | Heineken · lata 473 ml | $3.900 |
| 8 | `speed-original-lata-473ml` | Speed Unlimited · lata 473 ml | $2.925 |
| 9 | `speed-zero-lata-473ml` | **Speed Zero** · lata 473 ml ⚠️ ver §4 | $2.925 |
| 10 | `monster-mango-loco-lata-473ml` | Monster Mango Loco · lata 473 ml | $3.390 |
| 11 | `red-bull-original-lata-250ml` | Red Bull · lata 250 ml | $3.576 |
| 12 | `combo-cuatro-para-arrancar` | Combo «Cuatro para arrancar» | $10.500 |
| 13 | `combo-birra-y-energia` | Combo «Birra y energía» | $15.700 |
| 14 | `combo-previa-imperial-x6` | Combo «Previa Imperial» | $15.800 |
| 15 | `combo-tabla-de-cervezas` | Combo «Tabla de cervezas» | $17.100 |
| 16 | `combo-corona-x6` | Combo «Corona Extra x6» | $19.400 |
| 17 | `combo-noche-larga` | Combo «Noche larga» | $20.000 |
| 18 | `combo-heineken-x6` | Combo «Heineken x6» | $21.000 |

Los 7 combos tienen precio **derivado** de sus componentes y el backend los
cobra recalculándolos; no son un precio suelto que alguien tipeó.

### Lista B · 12 SKUs — imagen aprobada; sólo falta el precio

Walter escribe un número al lado de cada uno y quedan publicables.

| # | `product_key` | Producto | Categoría |
|---|---|---|---|
| 19 | `quilmes-clasica-710ml` | Quilmes Clásica · lata 710 ml | Cerveza |
| 20 | `brahma-chopp-1000ml` | Brahma Chopp · retornable 1 L | Cerveza |
| 21 | `patagonia-lager-del-sur-730ml` | Patagonia Lager del Sur · 730 ml | Cerveza |
| 22 | `amstel-lager-473ml` | Amstel Lager · lata 473 ml | Cerveza |
| 23 | `heineken-710ml` | Heineken · lata 710 ml | Cerveza |
| 24 | `fernet-branca-edicion-mundial-750ml` | Fernet Branca Edición Mundial · 750 ml | Fernet |
| 25 | `fernet-vittone-1000ml` | Fernet Vittone · 1 L | Fernet |
| 26 | `buhero-negro-450ml` | Buhero Negro · 450 ml | Fernet |
| 27 | `coca-cola-original-2250ml-local` | Coca-Cola · PET 2,25 L | Gaseosa |
| 28 | `coca-cola-sin-azucar-2250ml-local` | Coca-Cola Sin Azúcar · PET 2,25 L | Gaseosa |
| 29 | `7up-original-2000ml-local` | 7UP · PET 2 L | Gaseosa |
| 30 | `hielo-cristal-4kg` | Hielo Cristal · bolsa 4 kg | Hielo |

**Total: 30 SKUs**, con las 8 categorías prioritarias cubiertas salvo una.

---

## 3 · Lo que NO se puede cumplir de la lista de prioridades

### Vodka — **no existe un vodka publicable**

Hay **una sola** fila de vodka en las 99: `smirnoff-700ml`, y está
**`REJECTED_DATA_CONFLICT`**. Motivo textual de la matriz:

> «No aprobado: La revisión visual detectó conflicto: la imagen declara 750 ml y
> el SKU 700 ml.»

No es un problema de precio ni de aprobación: es un dato contradictorio. Para
tener vodka en el lanzamiento hace falta que **Walter diga cuál es la
presentación real que vende** y que se consiga una imagen que coincida. Hasta
entonces no se publica, porque publicarlo sería vender 700 ml mostrando una foto
de 750 ml.

### Packs — 9 tienen precio y ninguno tiene imagen válida

Los 9 packs con precio (`Coca-Cola x12`, `Coca-Cola Zero x12`, `Sprite x12`,
`Coca-Cola 1,5 x6`, `Coca Zero 1,5 x6`, `Sprite 1,5 x6`, `Fanta 1,5 x6`,
`Schweppes Tónica 1,5 x6`, `Schweppes Citrus 1,5 x6`) están en
`PACK_NEEDS_COMPOSITION`: el activo visible es **una unidad con un cartelito de
pack**, no una composición real. Y la fuente heredada es de un retailer, con los
derechos de uso comercial pendientes.

Además hay un pack rechazado de plano: `heineken-original-lata-473ml-pack-6`
comparte el SHA-256 exacto de la imagen de la lata individual — «no hay pack x6
verificable».

**Los packs quedan fuera del lanzamiento.** Los 7 combos de la Lista A cubren
esa necesidad comercial con material curado y precio que el backend recalcula.

---

## 4 · Defectos de datos que hay que corregir ANTES de publicar

Éstos no cuestan plata ni esperan a nadie: son errores de la matriz que, si se
importan tal cual, llegan a la góndola.

### 4.1 · 14 filas tienen un nombre visible que **oculta la variante**

El `product_key` declara una variante que el nombre que ve el cliente no dice.

Las dos graves:

| `product_key` | Se muestra como | Debería decir |
|---|---|---|
| **`stella-artois-sin-alcohol-330ml`** | «Stella Artois» | **Stella Artois SIN ALCOHOL** |
| **`speed-zero-lata-473ml`** | «Speed Unlimited» | **Speed Zero** |

`stella-artois-sin-alcohol-330ml` es el peor de los 14: una cerveza **sin
alcohol** publicada con el nombre de la cerveza con alcohol. Está mal para el
cliente y además hay que revisar qué dice su bandera `+18`.

`speed-zero-lata-473ml` está en la Lista A y al mismo precio que
`speed-original-lata-473ml`: hoy se dibujarían **dos tarjetas idénticas**.

Las otras 12: `sprite-sin-azucar-600ml`, `sprite-sin-azucar-2250ml-local`,
`schweppes-pomelo-sin-azucar-2250ml`, `villavicencio-sin-gas-500ml`,
`eco-de-los-andes-sin-gas-2000ml`, `glaciar-sin-gas-1500ml`,
`glaciar-con-gas-1500ml`, `bonaqua-sin-gas-2250ml-local`,
`manaos-lima-limon-2250ml-local`, `manaos-naranja-2250ml-local`,
`levite-manzana-2250ml`, `levite-manzana-2250ml-local`.

**De las 30 del lanzamiento, sólo una está afectada** (`speed-zero-lata-473ml`).
Corregir esa alcanza para publicar; las otras 13 se corrigen cuando les toque
entrar.

### 4.2 · 7 pares de gemelos `-local`

Siete productos aparecen dos veces: una fila con imagen faltante y su gemela
`-local` con la imagen resuelta pero sin precio.

`coca-cola-original-2250ml` / `-local` · `coca-cola-sin-azucar-2250ml` / `-local` ·
`schweppes-tonica-354ml` / `-local` · `levite-manzana-2250ml` / `-local` ·
`monster-ultra-473ml` / `-local` · `gancia-americano-950ml` / `-local` ·
`martini-bianco-1000ml` / `-local`

Éste es exactamente el defecto ya conocido de «tres productos publicados
aparecen dos veces en la góndola: uno comprable y su gemelo *Precio
próximamente*».

**Regla para la importación de producción: se publica UNA clave por producto.**
En la Lista B, las dos Coca-Cola entran por la clave `-local` (la que tiene
imagen) y sus gemelas **no se importan**.

### 4.3 · 3 pares que no son duplicados sino nombres incompletos

`Speed Unlimited` (×2 · en realidad Unlimited y Zero), `Glaciar 1,5 L` (×2 ·
con y sin gas) y `Manaos 2,25 L` (×2 · lima-limón y naranja) muestran el mismo
texto siendo productos distintos. Es peor que un duplicado: el cliente no puede
elegir. Se resuelve con §4.1.

---

## 5 · Lo que TABA2 exige del dato antes de dejar comprar

Esto no es una recomendación: es el contrato que la base ya impone, y por eso la
lista de arriba está armada así.

- Un producto sólo es comprable con **`price_status = 'confirmed'` y `price > 0`**.
  La migración `20260809060000` apagó (`available = false`) todo lo que no
  cumpliera, y dejó constancia en una tabla de auditoría.
- **`stock` es nullable y significa tres cosas distintas**: `NULL` = nadie lo
  contó, `0` = se agotó, `N` = hay N. No hay que rellenar `NULL` con `0`: son
  estados diferentes.
- **El precio de un combo lo recalcula el backend** desde sus componentes. No se
  carga suelto.
- Un producto sin precio se muestra como «Precio próximamente» y **no se puede
  agregar al carrito**. Publicar los 99 con 61 sin precio llenaría la góndola de
  tarjetas que no se pueden comprar.
- La venta de alcohol depende de `businesses.alcohol_sales_enabled`, que hoy es
  **`false`**. Con esa bandera apagada, **24 de los 30 SKUs de esta lista no se
  pueden vender**, y el rechazo llega al cliente como un error genérico que lo
  invita a reintentar algo imposible. Ver §6.

---

## 6 · Lo que Walter tiene que decidir, en orden

| # | Decisión | Bloquea |
|---|---|---|
| 1 | **¿Habilitamos la venta de alcohol?** (`alcohol_sales_enabled`) | 24 de los 30 SKUs. Es una decisión comercial y legal, no un bug |
| 2 | **Aprobar los 18 de la Lista A**: precio real, stock y derecho a publicar la marca | todo el lanzamiento |
| 3 | **Poner precio a los 12 de la Lista B** | la mitad del surtido |
| 4 | **Stock inicial de los 30** | ninguno se publica sin esto |
| 5 | **¿Qué vodka vende y en qué presentación?** | la categoría vodka entera |
| 6 | ¿Los 7 combos se venden a esos precios? | 7 SKUs de la Lista A |
| 7 | ¿Vuelve «Transferencia» como forma de pago? | se retiró porque la base la rechaza siempre; volver exige datos bancarios, comprobante y alguien que confirme |

---

## 7 · Cómo se carga en producción

1. Walter completa precio, stock y aprobación **sobre el CSV**, no sobre la base.
2. `npm run catalog:sheet:check` y `npm run catalog:release:validate` — que la
   matriz sea coherente antes de tocar nada.
3. `npm run catalog:commercial:drill` — el ensayo de importación, que corre sin
   escribir en producción.
4. `npm run catalog:commercial:import` contra **PROD**, nunca contra staging.
5. `npm run combos:import` para los 7 combos.
6. Verificar en el sitio de producción: **30 tarjetas, ninguna «Precio
   próximamente», ningún nombre repetido**, y las fotos que corresponden.

**Nunca se copia el catálogo de staging.** En staging hay fixtures de QA
(`catalog_origin` en `test_only` / `staging_only`) y precios de demostración.
