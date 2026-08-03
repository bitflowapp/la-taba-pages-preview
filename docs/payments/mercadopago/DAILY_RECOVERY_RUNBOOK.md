# TABA2 · Recuperación diaria de pagos P0

Este runbook es para owner y admin. Staff puede consultar estados y preparar contexto, pero no puede reintentar, revisar stock ni solicitar una devolución.

## Principios

- Un pago aprobado no se cobra ni se crea de nuevo. Se consulta el pago existente y se usa la reconciliación persistida.
- El pedido se finaliza en backend con lock de checkout, lock de pago y reservas autoritativas. El navegador nunca inserta pedidos, stock ni pagos.
- Un doble clic, dos operadores o un worker recuperado deben producir como máximo un pedido, un descuento de stock, un evento de pedido y una notificación.
- Un resultado incierto de devolución queda en **Reembolso en proceso**. No se envía otra solicitud hasta conocer el resultado de la anterior.
- Una diferencia de importe, moneda o referencia queda en **Pago en revisión de seguridad**. No se crea pedido, no se confirma stock y no se oculta la alerta.

## Secuencia operativa

1. Abrí **Pagos y pedidos** y buscá por importe, hora, cliente minimizado o últimos seis caracteres del pago.
2. Leé el estado humano y la última actualización. Usá **Actualizar ahora** si el worker está normal o el pago sigue pendiente.
3. En **Pago aprobado, pedido pendiente**, elegí **Reintentar ahora** una sola vez. La pantalla bloquea el doble clic y el backend evita una segunda tarea activa.
4. Esperá el resultado visible: **Pago confirmado. Estamos creando el pedido.**, **Pedido creado correctamente.**, **El pedido ya había sido creado.**, **El pago todavía está pendiente.**, **No pudimos completar el pedido automáticamente.** o **Se necesita revisión del responsable.**
5. En **Pago recibido, stock por revisar**, elegí **Revisar stock**. No inventes stock ni confirmes un pedido sin disponibilidad real. **Preparar devolución** requiere importe y confirmación explícita; no es automática.
6. En una alerta de seguridad, no intentes crear pedido, tocar stock ni repetir el pago. Prepará el diagnóstico y escalá al responsable.
7. En **Requiere atención** o **Sin progreso**, usá **Reactivar procesamiento**. Esta acción sólo comprueba el estado real y encola una reconciliación idempotente; no reinicia un estado terminal.

## Diagnóstico para soporte

Usá **Preparar diagnóstico para soporte**. El paquete contiene únicamente:

- versión del contrato;
- `payment_intent_id`, `checkout_session_id` y `order_id` si existe;
- estados interno y del proveedor;
- fechas, cantidad de intentos y última actualización;
- estado del procesamiento, correlación y errores sanitizados.

No contiene tarjetas, tokens, secretos, credenciales, payloads completos, email, teléfono ni datos completos del cliente.

## Escalamiento

Escalá cuando exista revisión de seguridad, reserva vencida con pago aprobado, devolución ambigua, error de importe o tres ciclos sin progreso. Conservá el diagnóstico y no ejecutes acciones fuera de los botones autorizados de la superficie.
