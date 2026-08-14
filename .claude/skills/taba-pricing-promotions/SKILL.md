---
name: taba-pricing-promotions
description: Autoridad sobre precio, stock, descuentos, combos y promociones de TABA2. Usar cuando se pida cargar o cambiar un precio, crear un descuento o una promo, armar un combo, mostrar "Ahorrás X" o un precio anterior tachado, definir vigencias, o revisar por qué un producto no se puede comprar. También ante cualquier número de dinero que vaya a ver un cliente.
allowed-tools: Read, Grep, Glob
---

# Precio, stock y promociones de TABA2

Dueña de **todo número de dinero que ve un cliente** y de los estados que
habilitan la compra. Ninguna otra skill inventa, deriva ni redondea plata.

## Las dos reglas duras

1. **Nunca inventar un precio, un descuento ni un ahorro.** Un precio existe
   porque una persona con autoridad comercial lo cargó. No se estima, no se
   deduce de un pack, no se copia de otra presentación, no se toma de internet.
2. **Todo número mostrado se deriva matemáticamente de datos reales.** Si en
   pantalla dice `Ahorrás X`, X = `suma de precios individuales vigentes −
   precio promocional`. Si no se puede calcular con precios confirmados, no se
   muestra el ahorro: se muestra el producto sin ahorro.

Un descuento pedido sin autoridad comercial no se crea. La respuesta correcta es
declarar qué falta —quién autoriza, con qué precio de referencia, con qué
vigencia— y detenerse.

## Estados: qué se puede comprar

| Estado | Cómo se declara | ¿Comprable? |
|---|---|---|
| precio confirmado | `price_status = 'confirmed'` y `price > 0` | sí, si hay stock |
| precio pendiente | `price_status = 'pending'`, **o** `price <= 0` | no |
| stock conocido | entero ≥ 0 | sólo si > 0 |
| stock pendiente | `stock is null` | no |
| publicable | verificado, activo, precio confirmado > 0 y stock > 0 | — |
| comprable | lo anterior **y** `available = true` | sí |

Dos asimetrías que hay que tener presentes:

- **Cero no es ausencia.** En precio, 0 es un número legal, por eso el estado
  vive aparte. En stock, `null` es "nadie contó" y `0` es "se agotó": son
  distintos y se resuelven distinto (uno contando, el otro reponiendo).
- **Los dos lados fallan cerrado.** Un `pending` con número sigue siendo
  pendiente; un `confirmed` con precio ≤ 0 también. Si los dos nombres del
  estado se contradicen, gana el que dice que no se puede vender.

`js/core/pricing.js` es el único lugar del cliente donde se decide esto, y
`pricingLabel()` es el único camino para escribirlo en pantalla. El servidor
impone la misma compuerta por restricción de tabla. El contrato completo está en
[references/precio-stock-y-combos.md](references/precio-stock-y-combos.md).

## Cargar un precio ES confirmarlo

Escribir el número sin mover el estado deja el producto con precio y sin poder
venderse, y nadie se entera hasta que un cliente no puede comprar. La puerta
comercial (`apply_commercial_catalog_batch`) es la única forma segura de mover
precio, stock y publicación de un producto existente:

- un valor omitido **preserva** el estado (una celda vacía no es un cero);
- volver a pendiente apaga la venta en el mismo movimiento;
- publicar exige las cinco compuertas (estado del precio, precio > 0, stock > 0,
  producto activo, imagen que coincide con el registro aprobado);
- una llamada es una transacción: cualquier error deshace el lote entero.

## Combos: el precio no se guarda, se deriva

Un combo guarda componentes, cantidades y el descuento que el comercio decidió.
Precio individual, precio promocional, ahorro, stock y +18 se **derivan del
catálogo vivo cada vez**. Un precio guardado envejece en silencio y sigue
prometiendo un ahorro que ya no existe.

Consecuencias que se usan a diario:

- Un componente sin precio confirmado **bloquea** el combo; no se completa con un
  número inventado.
- El stock del combo es el del componente **limitante**.
- El +18 de cualquier componente se propaga al combo entero.
- Un combo puede existir sin ahorrar un peso. Sigue siendo un combo legítimo,
  pero **no es una promoción**: mostrarlo con precio tachado y `Ahorrás $ 0` es
  mentir con la verdad.
- `available` ("se puede armar") y `chargeable` ("se puede cobrar a este precio")
  son distintos. Confundirlos cobra el precio de lista con cara de combo.

## Promociones: qué exige una promo para existir

Una promoción sólo está activa si pasa **todas**: identificador, título, al menos
un producto incluido, aprobación humana registrada con su referencia, vigencia de
inicio y fin válida, y valores comerciales verificables según el tipo
(porcentaje > 0, o precio promocional ≥ 0 y **menor** que el regular, o envío
gratis).

Sin eso, la promo no se muestra, no rankea y no descuenta. No hay estado
intermedio "casi activa".

## Qué entregar

1. El número, con su derivación explícita y las fuentes de cada término.
2. Qué está pendiente, nombrado por su casilla.
3. Si falta autoridad comercial: decirlo, decir qué persona y qué dato la
   cierran, y no crear nada mientras tanto.

## Nunca

- Estimar un precio unitario dividiendo un pack.
- Mostrar un precio anterior que no fue precio real vigente.
- Anunciar un ahorro mayor al calculado. El redondeo del precio promocional va
  **hacia abajo**: sólo puede agrandar el ahorro real, nunca achicarlo.
- Activar una promoción sin aprobación humana registrada ni vigencia.
- Escribir un precio directo sobre la tabla salteando la puerta comercial.
- **Aplicar** un lote contra una base real. Esta skill prepara el lote y lo
  valida en seco; aplicarlo es una acción de una persona con autoridad
  comercial, en una sesión con permiso explícito.
