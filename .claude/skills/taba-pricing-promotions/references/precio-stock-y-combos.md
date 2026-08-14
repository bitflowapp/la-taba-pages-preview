# Contrato de precio, stock, combos y promociones

Fuentes: `CONTRATO-PRECIO-STOCK.md`, `js/core/pricing.js`, `js/core/combos.js`,
`js/core/promotions.js`. Este documento explica el contrato; **los valores
vigentes se leen del código y de los datos, nunca de acá**.

## 1. Cliente y servidor imponen lo mismo

Del lado del cliente, cinco funciones y una etiqueta:

```js
isPricePending(product)            // el estado, con la regla completa
confirmedPrice(product)            // el número, o null. Nunca cero por ausencia
isStockPending(product)            // null/'' es pendiente; 0 no
knownStock(product)
isCommerciallyPurchasable(product) // la compuerta entera
pricingLabel(pricing)              // el ÚNICO camino para escribirlo en pantalla
```

`isCommerciallyPurchasable` es la compuerta de lo que entra al carrito y del
botón de agregar. Preguntar sólo por la bandera de "precio pendiente" deja pasar
una fila con la bandera en falso y precio 0, y termina en una línea de carrito a
cero pesos.

Del lado del servidor, una restricción de tabla exige que nada quede disponible
sin verificación, sin stock > 0 y sin precio confirmado > 0. La compuerta del
cliente existe para que la tienda **no ofrezca lo que el servidor va a rechazar**,
no para reemplazarla.

Además hay una función que devuelve una sola palabra por fila —precio pendiente,
stock pendiente, agotado, no publicado, publicable no publicado, comprable— para
que nadie vuelva a derivar el estado a mano. El orden de resolución no es
alfabético: **sin precio no se vende aunque sobre stock**.

## 2. Por qué el stock no tiene columna de estado

`stock` nullable ya distingue los tres casos sin ambigüedad: `null` es "nadie lo
contó", `0` es "se agotó", `N` es N. Una columna paralela sería una segunda
fuente de verdad que se desincroniza. Con el precio hace falta el estado porque
0 es un número legal.

## 3. Transiciones verificadas contra PostgreSQL real

| Transición | Resultado |
|---|---|
| pendiente → confirmado | el estado acompaña al número |
| confirmado → nuevo precio | conserva la publicación |
| stock pendiente → N | deja de ser pendiente |
| N → 0 | bloquea la compra; conserva precio y verificación |
| 0 → N | vuelve a ser publicable, **no** se publica solo |
| lote mixto con una fila inválida | se rechaza entero |
| rollback | ninguna fila buena queda escrita |

El simulacro se corre con `npm run catalog:commercial:drill`.

## 4. Ahorro de combo, paso a paso

1. Resolver cada componente contra el catálogo vivo, indexando por SKU **y** por
   id (en la demo el id es el SKU; contra la base es un UUID y el SKU viaja
   aparte — indexar sólo por id deja la góndola sin combos).
2. Si falta un componente, o tiene precio pendiente, o no tiene stock: se acumula
   un **bloqueo** y no hay precio que anunciar. Nunca un precio parcial.
3. `individualPrice` = suma de `precio unitario × cantidad` de los componentes.
4. `promotionalPrice` = `individualPrice × (1 − descuento/100)`, redondeado a la
   centena **inferior**. Es la convención de góndola en Argentina y garantiza que
   el ahorro anunciado nunca sea menor que el real.
5. `savings` = `individualPrice − promotionalPrice`. Si es 0, `hasRealSaving` es
   falso y la tarjeta no puede presentarse como promoción.
6. `stock` del combo = mínimo de `stock del componente / cantidad`.
7. `ageRestricted` = cualquier componente alcohólico.
8. `available` = tiene precio y stock. `chargeable` = además está aprobado
   comercialmente. **Sólo `chargeable` habilita cobrar el precio de combo.**

Las sustituciones declaradas se ofrecen sólo si el candidato existe, está
disponible, no tiene precio pendiente y **vale exactamente lo mismo**. Una
sustitución que cambió de precio deja de ofrecerse en vez de prometer un cambio
que el mostrador no puede hacer.

## 5. Promociones: campos y validación

Tipos soportados y estados de aprobación viven en `js/core/promotions.js`.
Validación para activar, en orden:

- identificador de promoción presente;
- título presente;
- al menos un SKU incluido;
- aprobación humana: estado aprobado **y** referencia de aprobación no vacía;
- vigencia: inicio y fin presentes, fin ≥ inicio (las fechas sin hora se
  interpretan como día completo, de 00:00:00.000 a 23:59:59.999);
- valores comerciales verificables:
  - envío gratis: no requiere precios;
  - descuento por porcentaje: porcentaje finito > 0 y precio regular > 0;
  - resto: precio promocional finito ≥ 0 y **estrictamente menor** que el
    regular, con regular > 0.

`isPromotionActive` exige además que esté marcada activa y que el momento esté
dentro de la vigencia. Una colección se normaliza deduplicando por id y se ordena
por prioridad.

**Cupones públicos**: hoy la constante de habilitación está apagada y no hay
cupón de demo con valor. Encender eso es una decisión comercial explícita, no un
efecto colateral de otra tarea.

## 6. Errores que este contrato existe para impedir

- Cargar el precio y dejar el producto sin vender porque el estado no acompañó.
- Publicar a cero pesos escribiendo `available` directo sobre la tabla.
- Anunciar un ahorro contra un precio de lista que ya cambió.
- Cobrar un combo a la suma de sus precios de lista porque `available` se
  confundió con `chargeable`.
- Mostrar "Ahorrás $ 0" con el precio tachado al lado.
- Dividir un pack para inventar el precio de la unidad.
