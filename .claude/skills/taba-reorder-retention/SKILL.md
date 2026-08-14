---
name: taba-reorder-retention
description: Recompra y fricción del cliente que vuelve en TABA2 — volver a pedir, dirección recordada, checkout resumido, favoritos, compra rápida e historial. Usar cuando se pida repetir un pedido, guardar datos del cliente, acortar el checkout, diseñar "pedí lo de siempre", o revisar por qué una recompra falla o cambia de precio.
allowed-tools: Read, Grep, Glob
---

# Recompra y retención en TABA2

Dueña de **la fricción del cliente que vuelve**. No es dueña del precio, del
stock ni de la disponibilidad: los consulta cada vez.

## La regla crítica

**Repetir un pedido no es reutilizar un pedido.** Un pedido histórico es una
*intención* —qué quiso esta persona—, nunca una *cotización*.

Antes de armar cualquier recompra se revalida, ítem por ítem, contra el estado
vigente:

| Se revalida | Si no pasa |
|---|---|
| El producto sigue existiendo en el catálogo | se omite y se dice por qué |
| Es comprable hoy (precio confirmado, disponible) | se omite y se dice por qué |
| Hay stock para la cantidad pedida | se ofrece la cantidad posible, nombrando el límite |
| El precio unitario vigente | se marca que cambió, con el anterior y el actual |
| La zona de entrega cubre la dirección | se resuelve antes de cobrar |
| El horario del comercio permite el pedido | se dice cuándo se puede |

Nada de esto se puede saltear "porque el pedido es de hace pocos días". El precio
puede haber cambiado ayer.

## Qué ve la persona

Una recompra honesta muestra **antes de confirmar**:

1. Qué se repite y en qué cantidad.
2. Qué **no** se pudo repetir, con el motivo por ítem, en su idioma: "no
   disponible", "quedan N", "ya no está en el catálogo".
3. Si el total cambió: el anterior y el actual. Nunca sólo el nuevo.

Un carrito que se llena solo y cambia de precio en silencio es la forma más
rápida de perder a un cliente que volvía por confianza.

## Lo que ya existe

`js/core/reorder.js` (previsualización y revalidación), `js/core/customer-history.js`
(historial local acotado), `js/core/customer-addresses.js` y
`js/core/customer-preferences.js`, más la tarjeta de recompra del storefront.
El detalle de contratos y de los estados que devuelve cada uno está en
[references/recompra-y-datos-del-cliente.md](references/recompra-y-datos-del-cliente.md).

Antes de proponer una función nueva de retención: leer ahí qué existe. La mayor
parte de los pedidos de "agregá volver a pedir" se resuelven conectando lo que ya
está, no construyendo otra cosa.

## Datos del cliente

- Guardar lo mínimo para no volver a preguntarlo: dirección, referencia,
  preferencia de entrega. Nada más.
- La dirección recordada se **confirma**, no se asume. Cambiar de casa es normal;
  entregar en la anterior no.
- Todo lo local es local: sin identificación entre dispositivos y sin
  fingerprinting.
- Nada de datos personales en eventos ni en telemetría — eso lo gobierna
  `taba-commercial-analytics`.

## Favoritos y compra rápida

Un favorito es una marca del cliente sobre un producto; **no** garantiza que ese
producto esté disponible. Una sección de favoritos muestra el estado real de cada
uno, incluido "no disponible ahora", en vez de esconder lo que no se puede
comprar: esconderlo hace que la persona lo busque por toda la app.

La compra rápida sólo puede acortar pasos que no son decisiones. Se pueden
recordar: dirección, modo de entrega, preferencias. **No** se pueden saltear:
confirmación de edad cuando hay alcohol, confirmación del total, ni la elección
del medio de pago.

## Qué entregar

1. El diseño o la corrección, con la revalidación explícita en el flujo.
2. Qué pasa en cada caso de falla parcial (ítem faltante, precio cambiado, stock
   insuficiente, zona u horario fuera).
3. Qué se guarda del cliente, dónde y por cuánto tiempo.

## Nunca

- Repetir un pedido con precios o stock históricos.
- Confirmar un pedido con una dirección guardada sin que la persona la vea.
- Saltear la confirmación de edad en una compra rápida con alcohol.
- Guardar datos personales que la recompra no necesita.
- Prometer disponibilidad futura ("te lo guardamos") sin una reserva real de
  stock del lado del servidor.
