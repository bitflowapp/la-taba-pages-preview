# Contracargos y reclamos

Configurar los tópicos oficiales de chargebacks y claims junto con payments. Al recibirlos, TABA2 persiste el receipt, consulta la API oficial, asocia la disputa al payment intent y registra `payment_disputes` sin borrar pedido ni tocar stock automáticamente.

Un contracargo abierto marca el pago como `charged_back`, bloquea refunds incompatibles y aparece en Pagos como `Contracargo abierto` o `Requiere documentación`. Owner/admin puede consultar y reintentar reconciliación; staff no recibe acceso financiero por defecto.

Preservar evidencia operativa: pedido, eventos, comprobantes de entrega, conversación autorizada, documento fiscal y respuestas del proveedor. No tratar un contracargo como fallo técnico ni cancelar silenciosamente la trazabilidad.
