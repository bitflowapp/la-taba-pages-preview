# Arquitectura

La fuente de verdad es PostgreSQL. El navegador sólo envía IDs de productos, cantidades, modalidad, dirección, contacto y `client_request_id`; nunca precio, descuento, total, moneda, stock, `preference_id` ni estado de pago.

```text
Carrito
  -> Edge: mercadopago-create-checkout-session
  -> PostgreSQL: validación + checkout_session + reserva
  -> Edge: mercadopago-create-preference
  -> API Mercado Pago: preferencia Checkout Pro
  -> Redirect seguro Mercado Pago
  -> Webhook firmado -> receipt + payment_outbox
  -> worker durable -> GET /v1/payments/{id}
  -> PostgreSQL: validación de importe/referencia/colector/app
  -> transacción única: order + items + event + reserva convertida
  -> panel del negocio / tracking / retorno verificado
```

## Límites de confianza

- `checkout_sessions` y `checkout_session_items` son snapshots del servidor, previos al pago.
- `inventory_reservations` descuenta stock disponible una vez y lo libera o convierte una vez.
- `payment_intents` conserva estado crudo del proveedor por separado del estado interno monotónico.
- `payment_webhook_receipts` deduplica eventos; `payment_outbox` usa lease, backoff y `FOR UPDATE SKIP LOCKED`.
- Sólo un snapshot verificado como `approved`, con ARS e importe esperados, puede llamar a `finalize_paid_checkout_session`.
- Si un pago aprobado llega luego de vencer la reserva, se guarda y pasa a `manual_review_required`; no se inventa stock ni se reembolsa automáticamente.

## Estados

Estados de checkout: `created`, `validating`, `ready_for_payment`, `redirected`, `payment_pending`, `payment_approved`, `finalizing_order`, `completed`, `expired`, `cancelled`, `manual_review_required`.

Estados internos de pago: `created`, `preference_creating`, `preference_created`, `redirected`, `pending`, `in_process`, `approved`, `approved_order_pending`, `completed`, `rejected`, `cancelled`, `expired`, `refunded`, `partially_refunded`, `charged_back`, `ambiguous`, `security_review_required`, `failed`.

La función de ranking evita regresiones: un evento tardío no cambia `completed` a `pending`, ni `refunded` a `approved`.
