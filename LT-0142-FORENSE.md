# LT-0142 · forense read-only

Nada se modificó. Ningún dato personal fue impreso: los campos del cliente se
reportan por **presencia y forma** (clase de carácter, longitud, hash corto).

---

## 1 · Qué es, en una línea

Un **ensayo conducido por una persona** el 11-ago a las 23:17 UTC: alguien compró
desde el storefront con un perfil anónimo guardado, y el **dueño del negocio** lo
llevó por el Panel hasta asignárselo al **rider de QA**. No movió dinero y no
retiene stock.

---

## 2 · Línea de tiempo exacta

| Momento (UTC) | Evento | Quién |
|---|---|---|
| 23:17:27 | `order.received` | **cliente** `f1feacf5` (anónimo) |
| 23:18:14 | `received → accepted` | **negocio** `542f6931` (owner) |
| 23:18:24 | `accepted → preparing` | owner |
| 23:18:29 | `preparing → ready` | owner |
| 23:18:39 | `ready → assigned` + `order.rider_assigned` | owner |

Los intervalos son **47 s · 10 s · 5 s · 10 s**: irregulares. Es alguien haciendo
clic, no un script — un guion automatizado deja tiempos parejos.

Estado actual: `assigned`, revisión 7, sin `dispatched_at`, `picked_up_at` ni
posteriores. Lleva **más de 5 horas** ahí.

---

## 3 · Por qué bloquea al Rider QA

`assigned_rider_user_id = aab5bc54` — que en `business_members` figura como
`role=rider, is_active=true`, y es **la cuenta `rider-map-qa`** cuya credencial se
recuperó — y `status='assigned'`, que pertenece al conjunto «en vuelo»
`(assigned, picked_up, on_the_way, arrived)`.

Lo ven **dos comprobaciones independientes**, por eso el preflight falla dos veces
por una sola causa:

1. la consulta directa del preflight sobre `orders`;
2. la RPC `get_active_rider_delivery`, que es lo que **la propia app del Rider**
   pregunta al arrancar.

Consecuencia práctica: mientras siga así, la app del Moto va a abrir mostrando
esta entrega, y no se puede correr un gate físico limpio.

---

## 4 · Pago, sesión y stock

| | |
|---|---|
| `payment_method` | `cash` |
| `checkout_sessions` ligadas | **0** |
| `payment_attempts` ligados | **0** |
| Mercado Pago | **no intervino** |
| `reservation_expires_at` | NULL |
| `inventory_released_at` | NULL |

**No movió dinero y no está reteniendo inventario.** Un pedido en efectivo no crea
sesión de checkout: por eso no hay rastro de pago, y es correcto que no lo haya.

Importe: subtotal $3.576 + envío $150 = **$3.726**. Un ítem: `Red Bull Energy
Drink` ×1 a $3.576.

> Al margen, pero anotado: $3.576 por **una** lata es un precio de bulto vendido
> como unidad. Es exactamente la clase de defecto que el trabajo de
> «unit catalog» venía a corregir, y refuerza que el catálogo vivo necesita
> revisión antes de abrir.

---

## 5 · El cliente

`customer_user_id = f1feacf5`, usuario **anónimo** de Supabase (`is_anonymous`,
sin email), creado el 2026-08-06.

Sus datos tienen forma real: nombre alfabético de 5 caracteres, teléfono numérico
de 12 dígitos, calle de 12 y barrio de 15. La dirección de entrega trae
**coordenadas confirmadas por GPS con 4,58 m de precisión**, confirmadas el
**2026-08-09T17:42Z** y reutilizadas desde `customer_address_id` — o sea, es una
dirección guardada dos días antes, no tipeada en el momento.

Ese mismo perfil anónimo tiene **6 pedidos**: LT-0142 (`assigned`), LT-0117,
LT-0114, LT-0108 (`cancelled`), LT-0107 y LT-0036 (`received`). Un navegador que
viene ensayando hace días.

---

## 6 · La corrección que hay que hacer sobre `origin`

En el informe anterior escribí que «`origin` ya no distingue lo real de lo
ensayado». Es cierto, pero el motivo importa y es otro.

**`origin` nunca fue una afirmación de autenticidad.** Mirando el esquema:

```sql
add column if not exists origin text not null default 'production';

alter table public.orders add constraint orders_origin_reason_present check (
  origin = 'production'
  or (origin_reason is not null and ... and origin_classified_at is not null)
);
```

`production` es el **valor por defecto y está exento de justificar nada**. Lo
único que reclasifica a `qa` es un trigger sobre `order_items`: si el producto es
un **fixture de QA** (`product_is_qa_fixture`), el pedido pasa a `qa` con razón
`qa_fixture_product`.

Es decir: **`origin='production'` significa «no se detectó un producto de fixture
de QA», no «lo pidió un cliente real».** Es una prueba negativa.

Lo confirma el dato: **`origin_reason` es NULL en los 42 de 42** pedidos
`production`. El clasificador nunca tuvo nada que decir sobre ninguno, porque
todos usaron productos reales del catálogo.

**No es un bug.** Funciona como fue diseñado. Lo que no existe es un mecanismo que
distinga un ensayo humano de una compra real, y eso sí hace falta antes de abrir.

---

## 7 · El patrón completo de los 42

| | |
|---|---|
| rango | LT-0005 (01-ago) → LT-0142 (11-ago), **11 días** |
| clientes distintos | 26, todos anónimos |
| **$3.726 repetido** | **24 veces — el 57 %** |
| $17.100 | 6 veces · $3.075: 4 · $10.650: 2 |
| sin rider asignado | 16 |
| asignados a `f2f45193` (rider) | 10 |
| asignados a `aab5bc54` (rider-map-qa) | **7** |
| `origin_reason` presente | **0 de 42** |

Un total que se repite en más de la mitad de los pedidos, con 26 clientes
anónimos distintos, es la firma de un banco de ensayos, no de un comercio.

---

## 8 · Veredicto

**Ensayo humano.** Confianza alta, no absoluta.

A favor, y es lo que más pesa: **está asignado a la cuenta de QA del rider**. Un
pedido de un cliente real no se le asigna al rider de pruebas. Sumado a que lo
condujo el owner por el Panel en 72 segundos, a que el cliente es un perfil
anónimo con 6 pedidos mayormente cancelados, y a que su total es el que se repite
en 24 de 42 pedidos.

En contra, y por eso no digo «seguro»: los datos del cliente tienen forma real y
la dirección fue confirmada por GPS con 4,58 m dos días antes. Si esa dirección
es la de una persona de verdad, alguien podría estar esperando algo.

**El dato que lo cerraría, y que sólo vos tenés:** si esa dirección y ese teléfono
son de una persona real esperando una entrega, o del perfil que usás para
ensayar. No lo puedo determinar sin exponer datos personales, y no lo voy a hacer.

---

## 9 · Qué NO se hizo

No se modificó, canceló, reasignó ni completó. No se tocó su stock ni su rider.
No se imprimió ni un nombre, teléfono, dirección ni coordenada. Ninguna escritura
sobre la base.

**La decisión de qué hacer con él es tuya.** Si es un ensayo, cancelarlo desde el
Panel libera al Rider QA y cierra la alerta `RIDER_SIGNAL_STALE(ae213326)`.
