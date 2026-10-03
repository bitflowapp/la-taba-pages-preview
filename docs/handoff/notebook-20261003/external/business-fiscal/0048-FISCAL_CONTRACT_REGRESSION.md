# Regresión de contrato fiscal

Estado: **SIN ARCA / REMOTO PENDIENTE**.

Las tres migraciones fiscales del RC productivo fueron excluidas deliberadamente porque no pertenecen a las 26 remotas de staging. No se emitió CAE, factura, nota de crédito ni llamada ARCA.

Contrato a verificar después del pago test: pago aprobado → pedido confirmado → fiscal outbox según política → documento `pending`. Una falla fiscal no cambia el pago aprobado a rechazado. Un refund genera evento financiero y revisión fiscal, no nota de crédito automática.
