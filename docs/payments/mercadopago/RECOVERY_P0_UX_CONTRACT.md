# TABA2 · Contrato UX de recuperación P0

La integración visual de la superficie de retorno puede adoptar estos textos y estados sin conocer los nombres internos del pago.

## Estados humanos

| Estado | Título | Acción principal |
| --- | --- | --- |
| Verificando el pago | Verificando el pago | Actualizar estado |
| Pago aprobado | Pago aprobado, pedido pendiente | Reintentar ahora |
| Confirmando tu pedido | Confirmando tu pedido | Actualizar estado |
| Pedido confirmado | Pedido confirmado | Ver seguimiento |
| Pago rechazado | Pago rechazado | Volver al carrito |
| Pago pendiente | Pago pendiente | Actualizar estado |
| Necesitamos revisar este pago | Pago en revisión de seguridad | Preparar diagnóstico para soporte |
| Reembolso en proceso | Reembolso en proceso | Actualizar estado |
| Reembolso confirmado | Reembolso confirmado | Ver comprobante |
| Se necesita intervención del responsable | Se necesita intervención del responsable | Preparar diagnóstico para soporte |

## Contrato de superficie

Cuando exista la superficie visual correspondiente, debe ofrecer estos selectores opcionales:

- `[data-payment-return-title]` para el título humano;
- `[data-payment-return-detail]` para el mensaje cotidiano;
- `[data-payment-return-status]` con `role="status"` y actualización no intrusiva;
- `[data-payment-recovery-retry]` para la reconciliación autorizada;
- `[data-payment-recovery-refresh]` para actualizar sin recargar manualmente;
- `[data-payment-recovery-support]` para preparar diagnóstico saneado.

La superficie customer-facing sólo consulta el estado propio. Las acciones de reconciliación, revisión de stock y devolución están restringidas al backend y a owner/admin.
