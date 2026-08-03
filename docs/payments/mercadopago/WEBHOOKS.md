# Webhooks y reconciliación

Configurar URLs distintas de test y producción en el Dashboard. La URL de TABA2 es la función HTTPS `mercadopago-webhook`; no usar localhost, `webhook.site` ni dominios temporales para producción.

## Validación

De acuerdo con la receta oficial, la función toma:

- `x-signature`;
- `x-request-id`;
- `data.id` literal de la query URL.

La firma se valida con `WebhookSignatureValidator` del SDK oficial y el secret backend. También se rechaza timestamp viejo/futuro, body cuyo `data.id` no coincide, método que no es POST y cuerpos mayores al límite. Un webhook inválido deja un receipt minimizado, no toca pagos/stock/pedidos y recibe 401.

## Procesamiento

Un webhook válido responde 201 después de persistir `payment_webhook_receipts` y encolar `payment_outbox`. El worker consulta la API oficial por recurso; no confía sólo en el body. Para payments valida ID, `external_reference`, preferencia, collector, aplicación, `live_mode`, ARS, importe, estado y refunds. Desajustes llevan a `security_review_required`.

El worker debe invocarse de forma autenticada y recurrente por un scheduler interno de staging/producción. Las tareas recuperan leases vencidos, tienen backoff y terminan en dead letter. Configurar ese scheduler antes de habilitar el ambiente.
