# Respuesta a incidentes

1. Contener: deshabilitar `business_payment_settings.enabled` mediante el procedimiento autorizado si existe riesgo operativo; no borrar pagos, pedidos ni receipts.
2. Preservar: guardar IDs de checkout, intent, payment, preference, order, receipt y hashes de respuesta; no guardar payloads sensibles.
3. Clasificar: firma inválida, importe/referencia divergente, duplicado, worker fallido, aprobación tardía, refund ambiguo o contracargo.
4. Reconciliar: consultar la API de Mercado Pago desde backend, procesar el outbox y llevar inconsistencias a revisión manual.
5. Comunicar: informar al negocio qué pedidos no deben prepararse y qué evidencia necesita.
6. Recuperar: rotar Access Token/webhook secret si corresponde, actualizar sólo el secret manager, validar webhook con pruebas y monitorear dead letters.
7. Cerrar: documentar causa, impacto, IDs afectados, decisión de stock/refund/fiscal y follow-up.

Un incidente fiscal es independiente: pago aprobado no equivale a factura autorizada ni a CAE. Mantener la outbox fiscal y documentos asociados sin mezclar secretos fiscales con Mercado Pago.
