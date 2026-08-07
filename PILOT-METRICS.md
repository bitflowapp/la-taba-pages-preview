# PILOT-METRICS — qué mide cada número y qué no

Este documento define, una por una, las métricas de la superficie operativa del
piloto. Está escrito para que dos personas mirando el mismo número entiendan lo
mismo, y para que nadie tenga que abrir la consola para saber de dónde salió.

Regla general: **si el servidor no lo midió, el Panel no lo muestra**. Un dato
que falta se dice "todavía no hay", nunca cero.

---

## 0. El alcance comercial: qué entra y qué no

Todo número comercial se calcula **sólo sobre `orders.origin = 'production'`**.

Un pedido con `origin = 'qa'` es un fixture de prueba deliberado (lo clasifica
`classify_order_qa_origin` a partir del catálogo, migración `20260806160000`).
Se conserva íntegro como evidencia —pedido, items y eventos— y queda fuera de:

- pedidos y ventas del día;
- ticket promedio;
- pedidos por estado;
- pagos aprobados, pendientes y rechazados;
- pagos aprobados sin pedido;
- todas las excepciones operativas;
- el reporte comercial completo;
- la bandeja de alertas.

Para que "no aparece" nunca se confunda con "se perdió", el propio payload
declara el alcance y **cuántos pedidos QA excluyó**:

```json
"commercial_scope": { "includes": "production", "excludes": "qa" },
"today": { "qa_orders_excluded": 1 }
```

Los pagos no llevan marca de origen: se filtran por el origen de su sesión de
checkout (`payment_intents → checkout_sessions.origin`).

---

## 1. Umbrales: de dónde sale cada comparación

Los umbrales son configuración del negocio, no constantes escondidas en una
consulta. Cada uno viaja con su **procedencia**, así que el tablero puede decir
si el número es una decisión de Walter o el default del producto.

| Umbral | Columna en `businesses` | Default | Qué decide |
|---|---|---|---|
| `low_stock_units` | `low_stock_threshold` | 6 | Desde cuántas unidades un producto publicado se considera a reponer |
| `order_acceptance_minutes` | `order_acceptance_sla_minutes` | 10 | Cuánto puede esperar un pedido sin que el negocio lo acepte |
| `rider_assignment_minutes` | `rider_assignment_sla_minutes` | 10 | Cuánto puede estar listo sin rider |
| `delivery_minutes` | `delivery_sla_minutes` | 45 | Desde que está listo, cuándo la entrega es demorada |
| `rider_signal_stale_minutes` | `rider_signal_stale_minutes` | 5 | Cuánto sin GPS durante una entrega activa |

Se cambian con `configure_pilot_ops_thresholds(business_id, {...})`, que exige
rol `owner` o `admin` y rechaza cualquier clave o valor fuera del contrato.

```json
"low_stock_units": { "value": 6, "source": "default" }
```

`source` es `"business"` cuando alguien lo decidió y `"default"` cuando todavía
no. Los defaults son del producto y están declarados acá; no son mediciones.

---

## 2. El día comercial

El día es el del negocio, no el del servidor: arranca a las 00:00 en la zona
horaria que recibe la consulta (por defecto `America/Argentina/Buenos_Aires`).
Un pedido de las 21:30 en Buenos Aires pertenece a ese día aunque en UTC ya sea
el siguiente.

| Métrica | Definición exacta |
|---|---|
| `today.orders` | Pedidos de producción creados en el día |
| `today.billable_orders` | Los anteriores sin los cancelados ni rechazados |
| `today.revenue_booked` | Suma de `total` de los pedidos facturables |
| `today.revenue_delivered` | Suma de `total` de los pedidos entregados |
| `today.ticket_average` | `revenue_booked / billable_orders`, redondeado a 2 decimales |
| `today.delivered` / `cancelled` / `rejected` | Conteo por estado canónico |
| `today.counter_sales` | Ventas de mostrador (`pos_sales` completadas). **Caja aparte** |
| `today.qa_orders_excluded` | Pedidos QA del día que no entraron en ninguno de los anteriores |

**`ticket_average` es `null` cuando no hubo pedidos facturables**, no cero.
Dividir por cero devuelve un número; no dividir devuelve la verdad. El Panel lo
muestra como "sin pedidos".

**`counter_sales` nunca se suma a `revenue_booked`.** Son dos cajas distintas:
la web y el mostrador. Sumarlas sin decirlo produce un número que no coincide
con ninguna de las dos.

---

## 3. Pedidos por estado

El vocabulario es el canónico de `order_pipeline_state` (migración
`20260806190000`): `received`, `accepted`, `preparing`, `ready`, `assigned`,
`picked_up`, `on_the_way`, `arrived`, `delivered`, `cancelled`, `rejected`.

- `orders.open_by_state`: pedidos **abiertos ahora**, sin importar el día.
- `orders.today_by_state`: pedidos **creados hoy**, en cualquier estado.
- `orders.checkouts_open`: sesiones de checkout de las últimas 24 h que todavía
  no son pedido, en el mismo vocabulario (`pending`, `paid`, `expired`,
  `cancelled`, `received`).

Los checkouts están acá porque un checkout **pago** que no llegó a pedido es
dinero cobrado sin operación, y no aparecería en ninguna cuenta de pedidos.

---

## 4. Pagos

| Métrica | Definición exacta |
|---|---|
| `approved_today.count` / `.amount` | Intentos con `approved_at` dentro del día; el importe suma `paid_amount` |
| `pending.count` | Estado interno en `created`, `preference_creating`, `preference_created`, `redirected`, `pending`, `in_process`. **No está acotado al día**: un pago en curso de ayer sigue en curso |
| `pending.oldest_minutes` | Antigüedad del más viejo de los anteriores |
| `failed_today.count` | `rejected`, `failed`, `cancelled`, `expired` o `charged_back` con fecha dentro del día |
| `in_review.count` | `ambiguous` o `security_review_required` |
| `approved_without_order` | Aprobados sin `order_id`, con más de 5 minutos de antigüedad |
| `paid_checkouts_without_order` | Sesiones en `payment_approved` o `finalizing_order` sin pedido, con más de 3 minutos |
| `amount_mismatch.count` | Aprobados donde `paid_amount <> expected_amount` |

### Lo que no hay que sumar

`approved_without_order` y `paid_checkouts_without_order` son **dos vistas del
mismo dinero**: una desde el intento de pago, otra desde la sesión de checkout.
Un mismo incidente puede aparecer en las dos. El Panel las muestra sumadas en
una sola tarjeta ("Cobrado sin pedido") justamente para que nadie las lea como
dos problemas distintos ni las sume dos veces en un informe.

Los márgenes de 5 y 3 minutos no son arbitrarios: son el tiempo que el worker
tiene para finalizar el pedido por su cuenta. Antes de eso no es una excepción,
es un reintento en curso.

---

## 5. Qué necesita una persona

| Métrica | Condición exacta |
|---|---|
| `unaccepted_orders` | Producción, estado `received`, creado hace más de `order_acceptance_minutes` |
| `ready_without_rider` | Producción, `delivery`, estado `ready`, sin rider, listo hace más de `rider_assignment_minutes` |
| `delayed_deliveries` | Producción, en `assigned`/`picked_up`/`on_the_way`/`arrived`, desde `ready_at` hace más de `delivery_minutes` |
| `riders_without_signal` | Los mismos estados, con la última señal GPS (o el último cambio del pedido) hace más de `rider_signal_stale_minutes` |
| `manual_review_checkouts` | Sesiones de producción en `manual_review_required` |

Cada bloque devuelve también `threshold_minutes`, así que el tablero puede
explicar contra qué comparó sin que nadie tenga que recordarlo.

`riders_without_signal` usa `coalesce(última señal, última actualización del
pedido)`. Un pedido recién asignado no está "sin señal" aunque todavía no haya
GPS: hace un segundo pasó algo. Uno asignado hace dos horas sin nada en el medio
sí lo está.

---

## 6. Colas: reintentos y trabajo abandonado

Seis colas, con el mismo vocabulario:

- **`payments`** (`payment_outbox`): `pending`, `retrying`, `overdue`
  (vencido hace más de 10 min), `expired_leases`, `failed`, `dead_letter`,
  `max_attempts`.
- **`fiscal`** (`fiscal_outbox`), **`fiscal_artifacts`**, **`notifications`**,
  **`deliveries`** (`delivery_outbox` sin despachar).
- **`webhooks`** (`payment_webhook_receipts`, últimas 24 h): `received_24h`,
  `duplicate_24h`, `rejected_signature_24h`, `failed_24h`, `retrying`.

`dead_letter` no es "un número más": es **trabajo que nadie va a reintentar**.
Igual `failed` y `rejected_signature`. El Panel pinta esas colas en rojo y las
que sólo reintentan en ámbar.

`received_24h` y `duplicate_24h` son tráfico normal y **no cambian el color** de
la fila: un pico de avisos recibidos no es un problema.

---

## 7. Stock

La población es **lo publicado**: `is_active and is_verified`. Un borrador sin
publicar no le falta a ningún cliente.

| Métrica | Definición |
|---|---|
| `low.count` | Publicados con `0 < stock <= low_stock_units` |
| `out_of_stock.count` | Publicados con `stock <= 0`: se ven en la web y no se pueden comprar |
| `unknown_stock` | Publicados con `stock` nulo |
| `published_total` | Total de la población |
| `expired_reservations` | Reservas `active` vencidas hace más de 5 min, con `units` y `oldest_minutes` |

`unknown_stock` **debería ser siempre 0**: el invariante
`products_verified_master_data` exige `stock is not null` para publicar. Si
aparece mayor que cero, se rompió un invariante del catálogo y hay que mirarlo.
Se informa justamente para poder detectarlo.

`expired_reservations` mide stock comprometido que nadie compró. Si crece, el
barrido `taba-checkout-expiry-sweep` no está corriendo y el catálogo se drena
sin vender.

---

## 8. Salud de servicios

Cuatro estados y **ningún default optimista**:

| Estado | Significa |
|---|---|
| `healthy` | Hay evidencia positiva y reciente de que funciona |
| `degraded` | Funciona con problemas, o su última señal está vieja |
| `down` | Hay evidencia de que no funciona |
| `unknown` | **Nunca se lo vio funcionar.** No hay con qué afirmar nada |

La regla está en una sola función (`pilot_health_verdict`) y el orden importa:
`down` gana sobre todo; sin evidencia el veredicto es `unknown`; `healthy` es el
último recurso, nunca el punto de partida.

`unknown` no degrada el estado general a `down`: **no saber no es lo mismo que
estar caído**, y confundirlos entrena a ignorar el tablero.

| Servicio | Con qué se mide |
|---|---|
| `database` | La propia consulta respondió; `pg_is_in_recovery()` y uptime |
| `supabase` | Esquema `auth` presente, extensiones instaladas, RLS activo en 9 tablas operativas |
| `functions` | Rastro real de invocación: última preferencia creada, último aviso recibido, último trabajo completado |
| `webhook` | Avisos de 24 h por estado, firmas rechazadas en 1 h, y **pagos esperando aviso hace más de 30 min** |
| `scheduler` | `cron.job` y `cron.job_run_details`: las dos tareas del piloto existen, están activas y su última corrida terminó bien |
| `worker` | `payment_outbox`: backlog vencido, leases vencidos, fallados, abandonados y última finalización |
| `panel` | `business_command_receipts`: el Panel escribe un receipt por comando |
| `rider_contracts` | Matriz de privilegios: 10 RPC existen y sólo las ejecuta quien inició sesión; 5 no pueden quedar abiertas a anónimos |

Cada servicio devuelve su `evidence`, y el Panel la muestra bajo "Con qué se
midió". Un veredicto que no se puede discutir no sirve.

`rider_contracts` verifica el **contrato**, no el código de la app Android. Si
una RPC desaparece o vuelve a quedar ejecutable por `anon`, es un incidente
aunque el Rider siga compilando.

---

## 9. Alertas

18 detectores reconciliados contra la bandeja durable en cada lectura del
tablero. La huella dedupe por `(negocio, código, sujeto)`.

**Anti-spam por construcción:**

1. Repetir la detección **actualiza** la alerta existente; no crea otra.
2. Las condiciones que afectan a muchas filas —stock bajo, reservas vencidas,
   avisos con firma inválida— emiten **una alerta agregada** con la lista
   adentro (máximo 10 items), no una por fila. Cuarenta productos bajo mínimo
   son una alerta, no cuarenta.
3. Una alerta **reconocida sigue reconocida** mientras la condición persista.
   El "Ya la vi" no se pierde en la siguiente reconciliación.
4. El evento de auditoría se escribe al **cambiar de estado** o tras 15 minutos,
   no en cada lectura del Panel.
5. `occurrence_count` sube como máximo una vez por minuto.

**El "Ya la vi" es idempotente y auditado**: la primera vez registra quién y
cuándo y escribe un evento; repetirlo devuelve `idempotent_replay: true`, **no
reatribuye el reconocimiento a otro operador** y **no escribe un segundo
evento**. La auditoría dice quién la vio primero, una sola vez.

Resolver exige una nota de entre 5 y 500 caracteres. Cuando la condición
desaparece sola, la alerta se resuelve con motivo `Condición ausente en la
reconciliación automática.`

---

## 10. Última actividad

Nueve marcas de tiempo: último pedido, checkout, pago aprobado, aviso del
proveedor, comando del Panel, señal de rider, entrega y venta de mostrador.

Existe para una pregunta concreta: **¿está pasando algo o el silencio es una
falla?** Un tablero en cero con actividad de hace un minuto es un día flojo; en
cero con actividad de hace seis horas es un incidente. El Panel lo dice con esas
palabras y marca en ámbar todo lo que pasa de seis horas.

---

## 11. Reporte comercial

`get_pilot_commercial_report(business_id, desde, hasta, zona_horaria)`. Rango
máximo 366 días. Sólo producción.

### Muestra insuficiente

**No se declara un "más vendido" con cuatro pedidos.** Con muestras chicas el
ranking es ruido: el producto que encabeza cambia con una sola compra.

El guard es doble y ambas condiciones tienen que cumplirse:

- al menos **20 pedidos** en el período, y
- al menos **10 unidades** del producto que encabeza.

Cuando no se cumple:

```json
"products": {
  "sufficient_sample": false,
  "best_seller": null,
  "note": "Muestra insuficiente: se informan las cantidades, no un más vendido.",
  "ranking": [ … ]
}
```

El ranking **se publica igual** —las cantidades son ciertas— pero nadie recibe
la palabra "más vendido". Lo mismo aplica a combos.

### Tiempos

Cuatro tramos, todos con **percentiles p50 y p90 y su tamaño de muestra**:
aceptación (creado → aceptado), preparación (aceptado → listo), entrega
(listo → entregado) y punta a punta (creado → entregado).

Son percentiles y no promedios a propósito: un pedido que tardó tres horas
porque el negocio cerró no puede mover la medida de los otros veinte. Un tramo
sin muestra devuelve `null`, no cero.

### Cancelaciones

Se informa el conteo, la tasa, cuántas ocurrieron antes de aceptar, cuántas
después de estar listo, cuántas llevan motivo documentado y el reparto por rol
del actor.

**El motivo no se transcribe.** Lo escribe una persona en texto libre y un
reporte comercial no es lugar para eso. Se cuenta cuántas lo tienen.

### Stock crítico

Es una **foto del instante de la consulta, no del período**, y el payload lo
dice (`note` y `measured_at`). El stock no tiene historia en el modelo actual;
presentarlo como si la tuviera sería inventar.

### Errores del período

Pagos rechazados, aprobados sin pedido, checkouts vencidos, avisos con firma
rechazada, avisos fallados, comprobantes fiscales fallados y alertas levantadas
(totales y críticas).

---

## 12. Traza de incidentes

`trace_pilot_order(business_id, referencia)` contesta "¿dónde se rompió
LT-XXXX?". Acepta código público, `correlation_id`, id de pedido o id de sesión
de checkout.

Ocho etapas en orden: **storefront → checkout → pago → aviso del proveedor →
pedido → Panel → rider → entrega**, cada una con estado, instante y evidencia.

El `break_point` es **la primera etapa fallada o trabada**; si ninguna lo está,
es `null`. Decir "no encontré dónde" es mejor que señalar cualquier cosa.

Una etapa que está "esperando" pasado su umbral se reporta como **trabada**, con
los mismos umbrales que usan el tablero y las alertas: las tres superficies
coinciden.

### Qué no devuelve

Nombre, teléfono, WhatsApp, dirección, coordenadas, hash del correo del pagador,
token de seguimiento, código de entrega, id del rider ni el texto libre de los
eventos. La cronología publica **tipo de evento, rol del actor e instante**.

El `provider_payment_id` **sí** se devuelve: no es un dato personal, es la
referencia que hace falta para conciliar el cobro con Mercado Pago, y sin ella
el runbook de "pago cobrado sin pedido" no se puede ejecutar.

El payload lo declara:

```json
"privacy": { "pii_included": false }
```

---

## 13. Cómo se verifica todo esto

`npm run pilot:ops:drill` levanta dos clústeres efímeros, reconstruye el esquema
desde las 60 migraciones, carga un escenario sintético con números conocidos y
comprueba **72 aserciones** sobre estas definiciones —antes de hacer el backup y
otra vez sobre el proyecto recuperado.

Si un número de este documento deja de coincidir con lo que el servidor
devuelve, el simulacro aborta.
