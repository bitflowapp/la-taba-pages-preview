# Runbook: el circuito de pedidos

Para la persona que atiende el negocio. Ninguna acción de acá pide abrir la base
de datos. Si algo exige SQL, es un defecto y está anotado como tal al final.

---

## El camino que recorre un pedido

```
Cliente arma el carrito
      │
      ▼
create_checkout_session ─────► RESERVA el stock (15 minutos)
      │                        el stock se descuenta ACÁ, antes de pagar
      ▼
prepare_mercadopago_preference ─────► el cliente se va a Mercado Pago
      │
      ├── (1) vuelve a la pantalla de estado ──┐
      ├── (2) llega la notificación firmada ───┤──► se verifica el pago
      └── (3) el barrido pregunta cada minuto ─┘    contra Mercado Pago
                                                          │
                                          ┌───────────────┴───────────────┐
                                          ▼                               ▼
                                 la reserva vive                 la reserva venció
                                          │                               │
                                          ▼                               ▼
                            finalize_paid_checkout_session      REVISIÓN MANUAL
                            crea el pedido, convierte la        el dinero entró y
                            reserva, emite el evento            no hay pedido
                                          │
                                          ▼
                                  PANEL DEL NEGOCIO
                        (tiempo real + consulta de respaldo cada 5 s)
                                          │
                            aceptar → preparar → listo
                                          │
                                          ▼
                                     COLA DEL RIDER
                                          │
                                    claim (gana uno solo)
                                          │
                            retirado → en camino → llegó
                                          │
                                 código del cliente
                                          ▼
                                       ENTREGADO
```

Las tres vías por las que nos enteramos de un pago son redundantes a propósito.
La (2) es la única que Mercado Pago garantiza en producción; la (3) es la que
hace que el sistema no dependa de que el comprador vuelva.

---

## Qué mirar, todos los días

**Centro de operación del Panel.** Se refresca solo cada vez que se abre. Ahí
están las métricas (pedidos nuevos, demorados, pagos pendientes, entregas
activas, colas trabadas) y las alertas con su acción concreta.

Cada alerta se **resuelve sola** cuando la condición desaparece. Si sigue
abierta, el problema sigue ahí.

---

## Las alertas, y qué hacer con cada una

### 🔴 PAGO APROBADO SIN PEDIDO — `PAYMENT_APPROVED_WITHOUT_ORDER`
El cobro está confirmado y el pedido no se creó.
1. Abrir el pago en el Panel.
2. Tocar **Reconciliar**. En la mayoría de los casos el pedido se materializa.
3. Si vuelve a fallar, **Reembolsar** y avisar al cliente.

Nunca cobrar de nuevo. El botón de reconciliar es idempotente: tocarlo dos veces
no duplica nada.

### 🔴 CHECKOUT SIN CONFIRMAR CONTRA EL PROVEEDOR — `CHECKOUT_PROVIDER_UNVERIFIED`
Alguien llegó a la pantalla de pago de Mercado Pago, la sesión venció y nunca
supimos si pagó. **No dice que haya un cobro: dice que no lo sabemos.**
1. Buscar en Mercado Pago por la referencia externa que muestra la alerta.
2. Si **no hay pago**: no hay nada que hacer, la alerta se cierra sola.
3. Si **hay un pago aprobado**: tocar **Reconciliar** en ese pago desde el Panel.
   Si la reserva ya venció, el pedido no se va a crear solo — decidir entre
   **Reembolsar** o preparar el pedido a mano y avisar al cliente.

Si esta alerta aparece seguido, el barrido automático no está corriendo: ver
*Cuando algo de fondo se cae*.

### 🔴 COBRADO Y EN REVISIÓN — `PAYMENT_RECONCILIATION_REQUIRED`
El pago se aprobó pero la finalización quedó bloqueada, casi siempre porque la
reserva venció antes de que llegara el aviso. El dinero está adentro.
1. Verificar en el Panel el importe y el detalle.
2. Tocar **Armar el pedido de este cobro**. Vuelve a tomar el stock y crea el
   pedido; a partir de ahí sigue el circuito normal.
3. Si avisa que **no hay stock**, dice exactamente qué falta y cuánto. Ahí la
   salida es **Reembolsar** y avisarle a la persona.

No prepares el pedido por afuera del sistema: si no queda registrado, el Rider
no lo ve y el cliente no tiene seguimiento.

### 🟠 STOCK RESERVADO Y TRABADO — `STOCK_RESERVATION_STUCK`
Hay stock retenido por un checkout que ya venció. Ese stock **no se puede
vender**. Si aparece, el barrido de expiración no está corriendo: ver
*Cuando algo de fondo se cae*. Se resuelve solo en cuanto el barrido vuelve.

### 🟠 LISTO Y SIN RIDER — `ORDER_READY_WITHOUT_RIDER`
El pedido está listo hace más de 15 minutos y ningún Rider lo tomó.
1. Asignar un Rider desde el Panel, o
2. Avisar al cliente que la entrega se demora.

Se cierra sola cuando alguien lo toma.

### 🟠 LA COLA DE PAGOS NO PROGRESA — `PAYMENT_OUTBOX_STALLED`
Ver *Cuando algo de fondo se cae*. No requiere acción sobre el pedido: el
trabajo no se pierde, se retoma solo cuando el worker vuelve.

### 🟡 RIDER SIN SEÑAL — `RIDER_SIGNAL_STALE`
Más de 5 minutos sin ubicación durante una entrega activa.
1. Llamar al Rider.
2. Confirmar dónde está. **No inventar una ubicación en el sistema.**

---

## Cuando algo de fondo se cae

Tres tareas automáticas sostienen el circuito. Todas se recuperan solas cuando
el servicio vuelve; ninguna pierde trabajo.

| Tarea | Cada | Si se cae |
|---|---|---|
| `taba-payment-outbox-worker` | 30 s | los pagos verificados no se finalizan |
| `taba-checkout-expiry-sweep` | 1 min | el stock reservado no vuelve al catálogo |
| `taba-checkout-provider-truth-sweep` | 1 min | un pago del que nadie avisó queda sin descubrir |

Señales de que alguna no corre: `STOCK_RESERVATION_STUCK` acumulándose,
`CHECKOUT_PROVIDER_UNVERIFIED` repetido, o `PAYMENT_OUTBOX_STALLED`.

**Esto es trabajo técnico, no del negocio.** Requiere revisar pg_cron, el Vault
(`taba_payment_worker_url` y `taba_payment_worker_hmac_secret`) y la salud de
las Edge Functions.

Si las notificaciones de Mercado Pago llegan pero la firma nunca valida, la vía
principal de cobro está muerta aunque todo lo demás parezca sano: se consulta
con `list_webhook_signature_alerts()` y se arregla verificando
`MERCADOPAGO_WEBHOOK_SECRET` contra el panel del proveedor.

---

## Lo que el sistema NO deja pasar

No hace falta vigilarlo; está impuesto por la base de datos:

- Un pedido de delivery **no se crea** sin latitud, longitud, origen del punto y
  el momento en que la persona lo confirmó (`DELIVERY_LOCATION_REQUIRED`).
  Por eso «delivery sin ubicación» no es una alerta: es un estado imposible.
- Dos Riders no pueden quedarse con el mismo pedido.
- Un pago aprobado no puede producir dos pedidos, ni descontar el stock dos
  veces, aunque el aviso llegue repetido o el cliente toque «Confirmar» dos veces.
- Un aviso viejo no hace retroceder el estado de un pago.
- El stock no queda negativo, ni siquiera con cien personas sobre la última unidad.

---

## Lo que todavía pide una persona técnica

Honestidad sobre los bordes:

1. **La salud de las tareas de fondo** (pg_cron, Vault, Edge Functions) no se ve
   en el Panel. Se infiere de las alertas, que es peor que verla.
2. `list_webhook_signature_alerts()`, `list_stock_reservation_alerts()` y
   `list_unfinalized_paid_checkouts()` son consultas de servicio: no tienen
   superficie en la UI.
