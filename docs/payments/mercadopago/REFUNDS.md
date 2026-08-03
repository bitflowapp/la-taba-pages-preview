# Refunds y cancelaciones

Sólo owner/admin puede solicitar una operación. El panel pide una confirmación literal antes de llamar a Mercado Pago:

```text
I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND
I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION
```

Cada solicitud tiene una clave idempotente persistida. Ante timeout o resultado ambiguo no se genera una nueva operación: se reconcilia primero. El backend valida rol, pago/pedido asociado, importe restante, contracargo abierto y estado compatible.

Un refund se audita en `payment_refunds`; una cancelación en `payment_cancellations`. Ninguno borra el pedido ni altera stock físico automáticamente. Una devolución de dinero puede requerir devolución física y/o nota de crédito fiscal por separado.
