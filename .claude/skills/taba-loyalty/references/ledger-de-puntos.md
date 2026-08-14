# Ledger de puntos: forma correcta y trampas

## Lo único que existe hoy

`js/core/loyalty.js` cuenta pedidos locales contra un hito configurable y produce
una frase para que **el comercio revise** si corresponde un beneficio. No hay
saldo, no hay canje, no hay acreditación y el número vive en el navegador.

Está bien que sea así: es un recordatorio, no una promesa. Cualquier propuesta
que convierta ese contador en un saldo canjeable deja de ser un cambio de copy y
pasa a ser un sistema de valor, con todo lo que sigue.

## Forma del ledger

Una tabla de asientos, append-only:

| Campo | Por qué |
|---|---|
| `id` | identidad del asiento |
| `customer_id` | dueño del saldo (y la clave de la política RLS) |
| `delta` | entero con signo. Positivo acredita, negativo debita |
| `reason` | enumerado cerrado: `compra`, `reversion`, `canje`, `ajuste_manual`, `vencimiento` |
| `order_id` | pedido que lo originó, cuando aplica |
| `reverses_entry_id` | asiento que revierte, cuando aplica |
| `rule_version` | qué versión de las reglas se aplicó |
| `actor` | quién lo originó: el sistema, o el usuario del panel |
| `idempotency_key` | única. Es lo que impide acreditar dos veces el mismo pedido |
| `created_at` | inmutable |

El saldo es `sum(delta)`. Se puede materializar por rendimiento, **nunca** como
fuente de verdad: si la vista materializada y la suma difieren, gana la suma y la
diferencia es un incidente, no un redondeo.

Enteros siempre. Un punto fraccionario obliga a decidir el redondeo en cada
operación, y esa decisión termina tomándose distinta en cada lugar del código.

## Reglas de escritura

- Sólo escribe el servidor, y sólo desde la transición a entregado o desde una
  operación del panel autenticada.
- **Idempotencia obligatoria.** Un webhook que llega dos veces, un reintento de
  red o un doble click no pueden acreditar dos veces. La clave de idempotencia
  hace el trabajo; sin ella, el reintento *es* el fraude.
- Los roles del navegador **no** tienen permiso de escritura sobre la tabla ni
  sobre las funciones que acreditan.
- RLS por dueño para lectura: cada persona ve su libro, nadie ve el ajeno.
- Un ajuste manual necesita actor identificado y motivo. Un ajuste anónimo es
  indistinguible de un fraude interno.

## Reversión

Devolución, cancelación posterior a la entrega o contracargo generan un asiento
`reversion` de signo contrario, referenciando el original.

El caso que hay que resolver de entrada: **la persona ya canjeó los puntos que
hay que revertir.** El saldo queda negativo, o se bloquea el canje hasta que se
regularice, o el comercio absorbe. Las tres son decisiones de negocio válidas y
una tiene que estar elegida **antes** del primer canje, porque el sistema se
comporta distinto en cada caso.

## Vencimiento

Si vencen, el vencimiento es un asiento más (`vencimiento`, delta negativo),
generado por un proceso programado y confiable, con aviso previo al cliente. Un
saldo que se evapora sin asiento y sin aviso es un reclamo garantizado.

## Qué NO va en el ledger

- Descuentos, cupones y precios promocionales: los gobierna
  `taba-pricing-promotions`, viven en el pedido y afectan dinero, no puntos.
- Métricas de engagement: las gobierna `taba-commercial-analytics`.
- Beneficios que el comercio otorga a mano fuera del sistema. Si no pasó por el
  ledger, no existió para el ledger, y está bien: lo que no se puede auditar no
  se registra como si se pudiera.

## Superficie de cliente

El navegador muestra saldo, historial y qué falta para el próximo beneficio;
todo leído del servidor. Nada se calcula localmente, ni siquiera "para que se vea
más rápido": un saldo optimista que después baja es peor que un saldo lento.

## Migración desde el contador local

El contador de pedidos locales **no se puede convertir en saldo inicial**: es un
número del navegador, sin autenticación, sin auditoría y trivialmente
manipulable. Si el comercio quiere reconocer historia previa, se hace con
asientos de `ajuste_manual`, con actor y motivo, sobre pedidos verificables del
lado del servidor.
