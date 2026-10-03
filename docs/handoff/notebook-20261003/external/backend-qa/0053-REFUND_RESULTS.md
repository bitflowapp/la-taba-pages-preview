# Reembolsos — resultados

Estado: **CONTRATO LOCAL VERDE / TEST REMOTO PENDIENTE**.

Implementado: owner/admin, idempotency key persistida, tope por importe, relación payment/order, auditoría, resultado ambiguo y reconciliación. El refund no modifica inventario automáticamente.

Auditoría local de este turno: los contratos de refund están cubiertos por la suite focal de pagos. No se ejecutó refund test remoto ni refund real.

Pendiente en ambiente test: total, parcial si la cuenta/API lo soporta, duplicación, máximo, timeout ambiguo, consulta posterior, evento y panel. No se ejecutó ningún refund real ni test remoto.
