# Primer pago real con Mercado Pago (canary)

> **Estado: NO EJECUTADO.** Mover dinero real requiere autorización explícita de Walter (dueño comercial y vendedor) y del operador. La autorización fija:
>
> - el importe máximo;
> - quién paga;
> - si se devuelve.
>
> Nada de este documento se hace «para probar» sin esa autorización.

## Qué tiene que estar listo antes

1. La Taba abierta con pago manual funcionando (canary de [`STORE-OPENING-RUNBOOK.md`](STORE-OPENING-RUNBOOK.md) §11) y `npm run opening:check` con `CAN_OPEN: YES`.
2. Walter conectó **su** cuenta desde Panel › Conectar Mercado Pago (H3). El Panel dice «Bloqueado», es decir, conectada pero sin habilitar.
3. Consentimiento de Walter para habilitar el cobro, por escrito, con fecha.
4. La plataforma habilita el cobro sólo para este comercio (H4 de [`MERCADOPAGO_PRODUCCION_CP.md`](MERCADOPAGO_PRODUCCION_CP.md)):

   ```
   node scripts/mercadopago/cobro-negocio.mjs estado   --target=controlled-production --business=e7850ad2-a447-402c-8375-3fd74e9466ba
   node scripts/mercadopago/cobro-negocio.mjs encender --target=controlled-production --business=e7850ad2-a447-402c-8375-3fd74e9466ba --confirmar=la-taba-cp --revision-aprobada
   ```

   El Panel pasa a «Conectado» y la tienda empieza a ofrecer Mercado Pago. Antes de este paso no lo ofrece: la RPC de disponibilidad exige vendedor conectado y habilitado.

## El pago (una sola vez)

1. Un producto real, sin alcohol, publicado, con precio real y chico. Retiro, así no hay costo de envío.
2. La persona autorizada compra en `https://la-taba-commercial-pilot.pages.dev/` y elige **Mercado Pago**.
3. Paga en Mercado Pago y vuelve a la tienda.

Verificar en este orden y guardar la evidencia (sin datos personales):

| # | Qué | Dónde |
| --- | --- | --- |
| 1 | Pago **aprobado**, y el cobrador es la cuenta de Walter | Cuenta de Mercado Pago de Walter |
| 2 | Notificación recibida con firma válida | Pulso operativo, sección `mercadopago` (`webhookValid` +1, `webhookRejected` 0) |
| 3 | Un solo pedido y un solo descuento de stock | Panel › Pedidos (el pedido entra con el timbre) y Catálogo (stock −1) |
| 4 | Panel y cliente muestran el mismo estado | Panel › Pagos y el seguimiento del cliente |
| 5 | Nada trabado en la cola | Pulso operativo: `outboxDue` 0, `outboxDead` 0, `paidWithoutOrder` 0 |

```
node scripts/controlled-production/ops-pulse.mjs --target controlled-production --business-id e7850ad2-a447-402c-8375-3fd74e9466ba --hours 2
```

**Si falla antes de crear el pago** (no hay pago en la cuenta), no se reintenta: se junta la evidencia y se analiza. **Si el pago existe pero falta el pedido**:

1. Panel › Pagos → «Consultar a Mercado Pago» → «Armar el pedido de este cobro».
2. Nunca cobrar de nuevo.

## Devolución (opcional, sólo si la autorización la incluye)

1. Panel › Pagos → el pago → «Devolver el dinero». Escribir la frase de confirmación.
   - Lo hace el dueño o el encargado. La devolución usa una clave de idempotencia: tocar dos veces no devuelve dos veces.
2. Verificar:
   - la devolución en la cuenta de Walter;
   - el estado del pago y del pedido en el Panel;
   - que el stock no se movió dos veces.

**Devolver en Mercado Pago no es una nota de crédito de ARCA.**

- La devolución mueve el dinero.
- La nota de crédito anula un comprobante fiscal emitido.

Si el pedido tuvo factura electrónica, que hoy no se emite, la nota de crédito es un paso aparte en Panel › Comprobantes. La devolución no la genera sola, y la nota de crédito no devuelve dinero.

## Si algo sale mal

Apagar Mercado Pago del comercio en el acto. El cobro manual sigue funcionando:

```
node scripts/mercadopago/cobro-negocio.mjs apagar --target=controlled-production --business=e7850ad2-a447-402c-8375-3fd74e9466ba --confirmar=la-taba-cp
```

Criterios para apagar (P0):

- pago al vendedor equivocado;
- pago sin pedido que no se puede rearmar;
- pedido pagado sin pago;
- cobro o devolución duplicados;
- firma inválida aceptada;
- stock corrupto;
- credencial expuesta.

## Qué ya está probado sin dinero

- Conexión OAuth, reconexión y desconexión: Staging, 34/34 y 16/16.
- La tienda no ofrece Mercado Pago sin vendedor conectado: pgTAP.
- Interruptor por comercio: pgTAP 16.
- Webhook con firma y worker firmado.
- Devoluciones: idempotencia, correlación y «sin adivinar»: pruebas Deno y pgTAP del release.
- Pago manual end-to-end en CP.

Evidencia en [`MERCADOPAGO_PRODUCCION_CP.md`](MERCADOPAGO_PRODUCCION_CP.md) §6–§8.
