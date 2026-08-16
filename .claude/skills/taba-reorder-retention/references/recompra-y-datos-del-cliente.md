# Recompra: contratos existentes y estados

## `js/core/reorder.js`

`buildReorderPreview(order, products, options)` es la revalidación. Recorre los
ítems del pedido histórico y, por cada uno, **busca el producto en el catálogo
vivo**. Devuelve:

| Campo | Qué contiene |
|---|---|
| `items` | lo que sí se puede repetir, con `unitPrice` **actual**, `previousUnitPrice`, `lineTotal` y `previousLineTotal` |
| `skipped` | lo que no, cada uno con su `reason` en lenguaje del cliente |
| `priceChanged` | verdadero si algún unitario vigente difiere del histórico |
| `totals` | calculados con precios actuales y el modo de entrega |
| `previousTotal` | el total del pedido original, para poder comparar |
| `canRepeat` | falso si no quedó ningún ítem repetible |

Los tres motivos de omisión que ya existen: el producto no está en el catálogo,
el producto no es ordenable, y la cantidad pedida supera el stock (el motivo
incluye el stock disponible).

Que el preview devuelva **precio actual y precio anterior en el mismo objeto** es
deliberado: hace imposible dibujar la tarjeta sin poder mostrar el cambio.

`buildPendingReorder` guarda sólo `productId` y `quantity` por ítem, más el
origen y el momento. **No guarda precios.** Un pendiente que guardara precios
sería exactamente el defecto que este contrato evita.

`cartMatchesPendingReorder` compara la firma del carrito con el pendiente para
saber si la persona todavía está repitiendo o ya lo modificó.

## `js/core/customer-history.js`

Historial local acotado a los últimos pedidos (el límite está en la constante
del módulo). Guarda una versión normalizada del pedido: ítems, dirección,
totales, cupón si hubo. `resolveRepeatOrderItems(order, products)` resuelve el
histórico contra el catálogo vivo — mismo principio: el catálogo manda.

Es almacenamiento **del navegador**. No sobrevive a un cambio de dispositivo y no
pretende hacerlo. Un historial cross-device requiere identidad y una tabla con
RLS por dueño; hoy no existe y no se agrega como efecto lateral.

## Direcciones y perfil

`js/core/customer-addresses.js`, `js/core/customer-profile.js`,
`js/core/customer-delivery-address-hydration.js` y
`js/core/profile-checkout.js` gobiernan la dirección recordada y el prellenado
del checkout. La dirección estructurada (calle, número, barrio, referencia)
existe porque una dirección en texto libre no se puede validar contra zona de
entrega.

Antes de agregar un campo nuevo al perfil, preguntar: ¿qué decisión del pedido no
se puede tomar sin ese dato? Si no hay respuesta, el campo no va.

## Zona y horario

La cobertura de entrega y el horario del comercio son estado **del servidor**, no
del navegador. Una recompra que pasa la revalidación de ítems todavía puede caer
por zona u horario, y ese mensaje se da antes de pedir el pago, no después.

El huso horario del comercio es el que manda para "está abierto": usar el del
navegador hace que un cliente de otra zona vea el local cerrado o abierto cuando
no corresponde.

## Reservas de stock

"Te lo guardamos" implica una reserva real del lado del servidor, con expiración
y limpieza programada. Los límites por usuario/sesión y el máximo pendiente son
configurables y **no tienen defaults arbitrarios**: se deciden. Los eventos
antiabuso guardan hashes, nunca IP, teléfono, correo ni dirección.

Sin reserva real, la promesa correcta es más humilde: "lo agregamos al carrito;
se confirma al pagar".

## Métrica de la recompra

Las métricas de recompra (tasa de repetición, tiempo entre pedidos) las define
`taba-commercial-analytics`. Esta skill no define eventos: los consume.
