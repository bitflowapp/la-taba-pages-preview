# Las cinco alertas preexistentes de QA: qué eran y qué requería corrección

24/10/2026. QA `ixewllzzuzpqrkxzmfzx`, comercio «QA Pagos de prueba, no público». Evidencia en [`despliegue-qa/`](despliegue-qa/): `alertas-antes.json`, `alertas-despues.json`, capturas del teléfono y `telefono-verificacion-*.json`.

## 1. Qué había abierto (23/10, ya presente en la copia previa al despliegue del 23/10)

| # | Alerta | Gravedad | Sujeto | Qué era de verdad |
|---|---|---|---|---|
| 1–4 | `CHECKOUT_PROVIDER_UNVERIFIED` | CRÍTICA | 4 checkouts (05:09, 17:52, 18:11, 18:53 UTC) | Compras que llegaron a Mercado Pago y vencieron **sin pago**: los intentos del período «algo anduvo mal» (integradora de cuenta real con usuarios de prueba, causa ya corregida en #149). La verificación con el proveedor funcionaba: 21 a 35 consultas cada una, todas vacías, la última de hace menos de una hora |
| 5 | `ORDER_NOT_ACCEPTED` | ACCIÓN | pedido `LT-0087` | El pedido de la compra APRO cuyo pago se devolvió desde la cuenta del vendedor. La base ya impedía avanzarlo (55000), pero la alerta pedía «aceptalo o cancelalo» — aceptar falla — y nada pedía cerrarlo |

## 2. Diagnóstico

**1–4 eran verdaderas pero estaban mal calibradas, y en producción eran un defecto comercial.** Desde la corrección forense F08 (`20261022110000`) la alerta queda abierta hasta cerrarse con evidencia (vencimiento + 24 h + tres consultas vacías posteriores). Esa regla es correcta y se conserva. El problema era la gravedad: **toda compra abandonada en Mercado Pago —lo más común de una tienda— quedaba CRÍTICA durante ~26 h**, y el Panel decía «Hay N cosas para frenar y resolver — Resolvelas antes de seguir cobrando o entregando». Con clientes reales, el comercio habría tenido falsas emergencias todos los días y una de verdad se habría perdido entre ellas; además «Buscar el pago por la referencia externa» no es una tarea que Walter pueda hacer.

**5 era verdadera y apuntaba a un hueco real**: devolver el dinero (desde la cuenta del vendedor o desde el Panel) no cierra el pedido, y ninguna alerta lo decía. Además, el Panel juzgaba «pago devuelto» por la *etiqueta* del pago mientras la base lo juzga por *importes*: una devolución sobre un pago en revisión conservaba su etiqueta y la tarjeta quedaba trabada (sin «Cancelar», con un «Avanzar» que la base rechaza).

## 3. Qué se corrigió (código, pruebas y QA)

| Cambio | Dónde | Prueba |
|---|---|---|
| La gravedad de `CHECKOUT_PROVIDER_UNVERIFIED` dice si la verificación funciona: **CRÍTICA** si nunca se pudo consultar al proveedor o la última respuesta tiene más de 3 h; **INFO** («Alguien empezó a pagar en Mercado Pago y no terminó… no hace falta hacer nada») mientras el proveedor contesta que no hay pago. La regla de cierre F08 no cambia | migración `20261024010000` + `private.checkout_provider_watch_state` | `tests/db/commercial-alerts.test.mjs` (4 casos que fallan sin la migración) |
| Alerta nueva `ORDER_PAYMENT_REVERSED_OPEN` (ACCIÓN): pedido abierto con el pago devuelto → «cancelalo con el motivo; si no salió, el stock vuelve solo». Esos pedidos salen de `ORDER_NOT_ACCEPTED` y `ORDER_STALLED` | misma migración | 5 casos (con controles: pedido sin devolución, devolución parcial, pedido entregado y reclamado, cancelación que repone stock una vez y cierra la alerta) |
| Las tarjetas «Pedidos nuevos» y «Pedidos demorados» dejan de contar esos pedidos | migración `20261024020000` | 1 caso que falla sin la migración |
| El Panel juzga «pago devuelto» por importes; la bandeja no pide aceptar ni mover un pedido reembolsado; textos propios para la alerta nueva, la variante INFO y tres alertas de dinero que caían en el texto genérico (`PAYMENT_DISCREPANCY_OPEN`, `PAYMENT_PIPELINE_STALLED`, `MERCADOPAGO_SELLER_CANNOT_CHARGE`) | `js/business/business-order-tray.js`, `js/business/business-operation-language.js` | 47 pruebas del Panel, incluida una que exige texto propio para cada alerta que emite el servidor |

Ambas migraciones tienen reversa en `docs/migrations/rollback/`, verificada: aplicar migración + reversa deja la función con el mismo md5 que antes.

## 4. Resultado medido en QA (24/10, dinero ficticio)

1. Respaldo cifrado → ensayo con rollback y pgTAP sobre los datos reales (6/6 y 3/3) → aplicación (libro 171 → 173) → los cinco cron activos reactivados exactamente.
2. Tras el barrido real: las 4 alertas pasaron a **INFO «en vigilancia»**; `LT-0087` pasó a **`ORDER_PAYMENT_REVERSED_OPEN`**; ninguna crítica.
3. En el preview (v161, 390×844, sesión de la dueña de QA): «**Hay 1 cosa esperando una acción — Podés seguir vendiendo mientras las resolvés**»; las tarjetas ya no cuentan a `LT-0087` como nuevo ni demorado.
4. Se hizo lo que haría el encargado: **Pedidos → `LT-0087` → motivo → «Cancelar con motivo»**. El pedido quedó `cancelled`, la unidad volvió al stock **una sola vez** (QA-REC-001: 19 → 20) y la alerta se resolvió en el barrido siguiente (00:39:11 → 00:40:00 UTC).
5. Estado final: «**La operación está al día**», todas las métricas en 0, sin errores de consola. Las 4 compras abandonadas siguen como información hasta su cierre con evidencia (~26 h después de vencer).

## 5. ¿Cuáles requerían corrección antes del lanzamiento?

| Alerta | ¿Bloqueaba el lanzamiento? | Estado |
|---|---|---|
| 1–4 `CHECKOUT_PROVIDER_UNVERIFIED` | **Sí, como defecto de producto**: falsas emergencias diarias con clientes reales y una instrucción imposible para el comercio | Corregida, aplicada y verificada en QA |
| 5 `ORDER_NOT_ACCEPTED` sobre un pedido reembolsado | **Sí**: un pedido pagado y devuelto podía quedar abierto sin que nadie lo cerrara, con una instrucción que la base rechaza | Corregida (alerta nueva, Panel por importes, métricas), aplicada y verificada; `LT-0087` cerrado |

Queda como mejora no bloqueante: el centro de operación muestra la resolución en la reconciliación siguiente (hasta ~1 min, o al tocar «Actualizar»).
