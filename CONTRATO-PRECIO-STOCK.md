# Contrato canónico de precio y stock

Qué significa cada estado, quién lo impone y qué no se puede escribir.

---

## 1. Corrección de un diagnóstico anterior

`STOREFRONT-COMERCIAL-HANDOFF.md` decía que la base «representa sin precio como
cero». **Eso era incompleto y llevaba a la conclusión equivocada.** El estado
explícito ya existía desde el 2 de agosto:

```sql
-- 20260802090000_mercadopago_checkout_pro_foundation.sql
alter table public.products add column if not exists price_status text;
alter table public.products add constraint products_price_status_check
  check (price_status in ('confirmed', 'pending'));
```

Lo cierto es más preciso: `products.price` es `not null check (price >= 0)`, así
que **el número** de un producto sin precio se guarda como 0, pero **el estado**
vive aparte y es explícito. La cadena de reserva y de pago ya lo respetaba: seis
RPC distintas cortan con `price_status <> 'confirmed'`.

Lo que faltaba de verdad era otra cosa, y es lo que esta rama cierra: **la tabla
no lo imponía**.

---

## 2. Los estados

| Estado | Cómo se escribe | Se puede comprar |
|---|---|---|
| precio confirmado | `price_status = 'confirmed'` y `price > 0` | sí, si además hay stock |
| precio pendiente | `price_status = 'pending'`, o `price <= 0` | **no** |
| stock conocido | `stock` es un entero ≥ 0 | sólo si es > 0 |
| stock pendiente | `stock is null` | **no** |
| publicable | verificado, activo, precio confirmado > 0 y stock > 0 | — |
| comprable | lo anterior **y** `available = true` | sí |

`public.product_commercial_state()` devuelve una palabra por fila —
`precio_pendiente`, `stock_pendiente`, `agotado`, `no_publicado`,
`publicable_no_publicado` o `comprable`— para que nadie vuelva a derivarlo a
mano. El orden de resolución no es alfabético: sin precio no se vende aunque
sobre stock.

### Por qué `stock is null` y no una columna de estado

`stock` es nullable y ya distingue los tres casos sin ambigüedad: NULL es «nadie
lo contó», 0 es «se agotó» y N es N. Una columna `stock_status` paralela sería
una segunda fuente de verdad que puede desincronizarse de la primera. Con el
precio hace falta porque **0 es un número legal** y no se puede distinguir de la
ausencia; con el stock, no.

---

## 3. Lo que impone el servidor

```sql
-- 20260809060000
constraint products_available_requires_verification check (
  not available
  or (is_verified and is_active
      and stock is not null and stock > 0
      and price_status = 'confirmed' and price > 0)
)
```

Las dos últimas condiciones son nuevas. Antes una fila podía quedar
`available = true` con `price_status = 'pending'` y `price = 0`, y lo único que
impedía venderla era que las RPC de checkout la frenaran más adelante. El grant
`update (stock, available, is_active, sort_order)` permite escribir `available`
directo sobre la tabla: cualquier camino nuevo que lo hiciera publicaba un
producto a cero pesos sin que nada del motor se opusiera.

**Verificado contra PostgreSQL real:** un `update products set price_status =
'pending'` sobre un producto disponible es rechazado por la restricción.

### Impacto y compatibilidad

La migración **mide antes de endurecer**. Copia a
`public.commercial_contract_remediation` toda fila `available` con precio
pendiente o ≤ 0 —con su precio, estado y stock previos— y recién después las
apaga y agrega la restricción. Si la tabla queda vacía, el catálogo ya era
coherente y la migración fue un no-op.

No es pérdida de dato: es el estado que esas filas debían tener y el que el
checkout ya les imponía.

### Lo que NO se hizo, y por qué

**No se convirtió `price` en nullable.** Sería la representación más limpia de
«sin precio», pero es una migración de riesgo alto —toca una columna `not null`
que leen catorce RPC, la app del Rider y el Panel— a cambio de cero beneficio
funcional: `price_status` ya distingue el estado y la restricción ya impide que
un cero se venda. Queda anotado como deuda con el terreno preparado.

**No se tocó `products_fail_close_master_change`.** Ese disparador cuenta el
precio como dato maestro y despublica al cambiarlo. Está bien: nada verificado
puede cambiar en silencio. `apply_commercial_catalog_batch` lo deja actuar y
republica explícitamente sólo lo que ya estaba publicado y sigue cumpliendo las
cinco compuertas.

---

## 4. Lo que impone el cliente

`js/core/pricing.js` es el único lugar donde se decide si un producto tiene
precio. La regla vale en las dos direcciones:

- un `price_status = 'pending'` es pendiente **aunque traiga un número**;
- un precio que no es un número mayor a cero es pendiente **aunque el estado
  diga `confirmed`**.

Esa segunda mitad es la que hace que la tienda falle cerrada si el backend manda
una fila incoherente. Y si los dos nombres del estado —`priceStatus` y
`price_status`— se contradicen, gana el que dice que no se puede vender.

Tres funciones y una etiqueta:

```js
isPricePending(product)          // el estado, con la regla completa
confirmedPrice(product)          // el número, o null. Nunca cero por ausencia
isStockPending(product)          // null/'' es pendiente; 0 no
isCommerciallyPurchasable(product)  // la compuerta entera
pricingLabel(pricing)            // el ÚNICO camino para escribirlo en pantalla
```

`isCommerciallyPurchasable` es ahora la compuerta de `isProductOrderable` —lo
que decide si algo entra a un carrito— y de `quickAddControl`, el botón
«Agregar». Antes preguntaban por la bandera `pricePending` sola, así que una
fila con la bandera en falso y precio 0 pasaba y terminaba en una línea de
carrito a cero pesos.

---

## 5. La puerta comercial

`apply_commercial_catalog_batch` es la única forma segura de mover precio, stock
y publicación de un producto que ya existe.

- **Cargar un precio ES confirmarlo.** El defecto que esto cierra: la versión
  anterior escribía `price` y no tocaba `price_status`, así que cargar el precio
  de un producto pendiente le ponía el número y lo dejaba sin poder venderse.
  Nadie se habría enterado hasta que un cliente no pudiera comprar.
- **`price_pending: true`** lo devuelve al estado pendiente y apaga la venta en
  el mismo movimiento.
- **Un valor omitido preserva el estado.** Una celda vacía no es un cero.
- **Publicar exige las cinco compuertas**: estado del precio confirmado, precio
  mayor a cero, stock mayor a cero, producto activo e imagen que coincide con el
  registro aprobado.
- **Una llamada es una transacción.** Cualquier `raise` deshace el lote entero.

---

## 6. Las siete transiciones, verificadas

Contra una base PostgreSQL real y descartable
(`node scripts/run-commercial-import-drill.mjs`, **36/36**):

| # | Transición | Resultado |
|---|---|---|
| 1 | pendiente → confirmado | `price_status` acompaña al número |
| 2 | confirmado → nuevo precio | conserva la publicación |
| 3 | stock pendiente → 10 | deja de ser `stock_pendiente` |
| 4 | 10 → 0 | bloquea la compra, conserva precio y verificación |
| 5 | 0 → 10 | vuelve a ser publicable, **no** se publica solo |
| 6 | lote mixto con una fila inválida | se rechaza entero |
| 7 | rollback total | ninguna fila buena queda escrita |

Dos detalles que el simulacro corrigió sobre lo que yo esperaba: quedarse sin
stock **no** des-verifica un producto, y volver a precio pendiente tampoco. La
verificación es sobre identidad e imagen; el stock y el precio se apagan con
`available`. Exigir una nueva revisión para reponer sería trabajo inventado.
