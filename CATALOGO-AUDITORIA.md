# Catálogo · 92 en el repo, 10 vivos, 8 vendibles

Auditoría read-only cruzando `catalog/products.csv` (92 filas) contra la tabla
`products` de staging (10 filas). Sin inventar un solo precio ni un solo stock.

---

## 1 · El hallazgo que hay que ver primero

**4 de los 8 productos vendibles son packs de abastecimiento con precio de pack.**

| Producto | Precio | `units_per_pack` | SKU |
|---|---|---|---|
| Coca-Cola Original 1500 ml | **$19.999** | **6** | `coca-cola-original-pet-1500ml-pack-6` |
| Sprite 1500 ml | **$19.999** | **6** | `…-pack-6` |
| Fanta Naranja 1500 ml | **$19.999** | **6** | `…-pack-6` |
| Coca-Cola Original 500 ml | **$17.100** | **12** | `coca-cola-original-pet-500ml-pack-12` |

El precio es coherente con el pack —no está mal cargado—, pero **están en la
góndola**, y el trabajo de «unit catalog» existía justamente para que un pack de
compra no se ofrezca como unidad de venta. Los tests que lo protegen pasan contra
fixtures locales; **nadie los corrió contra el catálogo vivo**.

Además hay un **duplicado real**: «Coca-Cola Original» aparece **dos veces** en la
góndola, a $19.999 y a $17.100, y sólo se distinguen por el tamaño del pack.

Y el que se coló en `LT-0142`: **Red Bull Energy Drink, lata de 250 ml,
`units_per_pack=1`, a $3.576.** Ése no es un pack: es un precio de unidad, y si
está bien o mal lo decide Walter.

> Con esto, la mitad de la góndola vendible tiene un problema de presentación de
> precio. No es un defecto de código: es catálogo.

---

## 2 · Clasificación de las 92 filas del repo

| Clase | Cantidad | Qué significa |
|---|---|---|
| **FALTA PRECIO** | **61** | `price_status = pending` |
| **NO PUBLICAR** | **11** | 1 rechazado + 10 con imagen rechazada |
| **DECISIÓN DE WALTER** | **10** | precio confirmado y cargado, pero con `review_only` o derechos de imagen pendientes |
| **FALTA STOCK** | **10** | precio confirmado, **nunca cargados en la base** |
| **LISTO PARA LANZAMIENTO** | **0** | ninguno pasa todas las puertas |

**Cero listos.** No es pesimismo: los 8 que hoy se venden arrastran
`rights_status = pending_review` o `catalog_status = review_only` en la planilla.
Se están vendiendo productos cuya revisión nunca se cerró.

### Estado crudo de la planilla

| Campo | Distribución |
|---|---|
| `price_status` | 20 confirmados · **71 pendientes** · 1 rechazado |
| `stock_status` | **90 `confirmation_required`** · 2 `unavailable` |
| `publication_status` | **71 `blocked`** · 21 vacío |
| `catalog_status` | 60 aprobados · 31 `review_only` · 1 rechazado |
| `rights_status` | **70 `pending_review`** · 22 vacío |
| `image_status` | 60 verificadas · 10 rechazadas · 22 vacío |
| `is_active` | 20 en `true` · 72 en `false` |

**Nadie confirmó stock de nada**: 90 de 92 siguen en `confirmation_required`. El
stock que hay en la base se cargó por otro camino, no desde esta planilla.

---

## 3 · Fixture / demo

Dos productos viven en la tabla de producción y **la propia base los reconoce
como fixtures** (`product_is_qa_fixture` devuelve `true`):

| Producto | Precio | Activo |
|---|---|---|
| `QA TEST iPhone - compra de prueba` | $850 | **false** |
| `Bebida QA sintética Task 04` | $400 | **false** |

No son vendibles porque están apagados, y son la razón de que exista el trigger
que reclasifica pedidos a `origin='qa'`. **No deben viajar a producción.**

---

## 4 · Los 10 que están a un paso

Precio confirmado en la planilla, **sin cargar en la base**. Les falta que alguien
confirme stock:

Coca-Cola Zero *(duplicado en la planilla)* · Schweppes Tónica · Schweppes Citrus ·
Monster Mango Loco · Imperial Golden · Imperial Extra Lager · Imperial Cream
Stout · Schneider Rubia · Corona Extra

Es la vía más rápida para ampliar la góndola: **no requieren decidir precio, sólo
stock.**

---

## 5 · Los 11 que no se publican, y por qué

| Producto | Motivo |
|---|---|
| Heineken *(fila del CSV)* | `catalog_status=rejected` **y** `price_status=rejected` |
| Coca-Cola Sabor Original · Coca-Cola Sin Azúcar · Schweppes Tónica · Levité · Aquarius · Monster Ultra · Brancamenta · Gancia · Martini Bianco · Smirnoff | **imagen rechazada** + precio pendiente |

Ojo con la coincidencia de nombres: hay un «Heineken» **rechazado en la planilla**
y otro **Heineken vivo y vendiéndose a $3.900**. Son filas distintas. Vale
confirmar cuál es el bueno.

---

## 6 · Lo vivo, tal cual está

| Producto | Precio | Stock | Activo | Nota |
|---|---|---|---|---|
| Coca-Cola Original 1500×6 | $19.999 | 99 | sí | **pack en góndola** |
| Sprite 1500×6 | $19.999 | 99 | sí | **pack en góndola** |
| Fanta Naranja 1500×6 | $19.999 | 99 | sí | **pack en góndola** |
| Coca-Cola Original 500×12 | $17.100 | 87 | sí | **pack + duplica el nombre** |
| Heineken 473 ml | $3.900 | 89 | sí | unidad |
| Red Bull 250 ml | $3.576 | 78 | sí | unidad · **precio a confirmar** |
| Imperial APA 473 ml | $3.000 | 99 | sí | unidad |
| Speed Unlimited 473 ml | $2.925 | 69 | sí | unidad |
| QA TEST iPhone | $850 | 19 | **no** | fixture |
| Bebida QA sintética | $400 | 17 | **no** | fixture |

Los stocks (69–99) son de siembra, no de inventario real.

---

## 7 · Qué se necesita para abrir

Por orden de impacto:

1. **Decidir qué hacer con los 4 packs.** O se sacan de la góndola, o se los
   presenta explícitamente como pack. Es lo único que hoy puede hacerle cobrar a
   un cliente $19.999 creyendo que compra una botella.
2. **Resolver el duplicado de Coca-Cola Original.**
3. **Confirmar el precio unitario de Red Bull** ($3.576 por lata de 250 ml).
4. **Confirmar stock real** de lo que se vende: los 8 activos, más los 10 que
   sólo esperan eso.
5. **Cerrar la revisión** de los 8 que se venden con `review_only` / derechos
   pendientes.
6. **Poner precio a los 61**, o dejarlos fuera del lanzamiento a propósito.
7. **Excluir los 2 fixtures** de cualquier importación a producción.

Los puntos 1, 2, 3, 4 y 6 son **decisiones de Walter**. El 5 y el 7 son trabajo
técnico que se puede hacer sin él.

---

## 8 · Lo que no se hizo

No se cambió un precio, un stock, un estado ni una publicación. No se activó ni
desactivó ningún producto. No se importó nada. Detalle fila por fila en
`<TMP>/catalogo-clasificado.json`.
