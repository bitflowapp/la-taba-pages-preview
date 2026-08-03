# Mercado Pago Checkout Pro para TABA2

Esta integración usa únicamente Mercado Pago Checkout Pro para un único comercio vendedor argentino. TABA2 calcula el carrito, precio, envío, moneda y stock en PostgreSQL; la persona compradora es redirigida al entorno seguro de Mercado Pago. No hay formulario propio de tarjeta, Checkout Bricks, split payments, OAuth de marketplace ni datos de tarjeta en TABA2.

El código está preparado para `test` y `production`, pero no habilita producción por defecto. Al momento de esta documentación no se configuraron secretos, una aplicación, un webhook público ni staging autorizado.

## Fuentes oficiales consultadas

Consulta realizada el 2026-08-02. Las páginas mostraban copyright © 2026 MercadoLibre S.R.L. y no exponían una versión semántica; esa es la versión/fecha visible registrada.

| URL | Título | Decisión derivada |
| --- | --- | --- |
| [Checkout Pro: crear preferencias](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/preferences/create-preference/post) | Crear preferencia | La preferencia se crea sólo desde la Edge Function con Access Token backend e `external_reference` estable. |
| [Checkout Pro: URLs de retorno](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/configure-back-urls) | Configurar URLs de retorno | Se usan `/pago/resultado`, `/pago/pendiente` y `/pago/error`; el redirect no autoriza un pedido. |
| [Webhooks](https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks) | Webhooks | Se valida `x-signature` con `x-request-id` y el `data.id` literal de la query; se persiste y se consulta la API antes de finalizar. |
| [Credenciales de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/credentials) | Credenciales | Access Token y secret de webhook sólo viven en secretos backend, separados por ambiente. |
| [Salida a producción](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/go-to-production) | Salir a producción | Producción exige cuenta, SSL, URLs y credenciales verificadas, además de los gates propios de TABA2. |
| [Pruebas de compra](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/integration-test/test-purchases) | Probar compras | Se usan cuentas de prueba vendedora y compradora distintas, tarjetas y estados oficiales. |
| [Métodos de pago](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-settings/payment-methods) | Métodos de pago | Los tickets/offline quedan deshabilitados por defecto para no sostener reservas cortas indefinidamente. |
| [Buscar preferencias](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/preferences/search-preferences/get) | Buscar preferencias | Ante timeout se busca por `external_reference` antes de volver a crear una preferencia. |
| [Crear refund](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api-payments/create-refund/post) | Crear reembolso | Refund backend con `X-Idempotency-Key`, tope por importe pagado y auditoría. |
| [Refunds y cancelaciones](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-settings/refunds-and-cancellations) | Reembolsos y cancelaciones | Cancelación sólo para estados compatibles; no altera stock físico automáticamente. |
| [Cancelar pago](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api-payments/create-cancellation/put) | Cancelar pago | La solicitud usa el endpoint oficial de actualización con estado `cancelled`. |

## Estado de entrega

La implementación local y las pruebas sin credenciales están disponibles. La certificación end-to-end contra Mercado Pago requiere una aplicación autorizada, cuentas de prueba separadas, secrets en Supabase, un dominio HTTPS y staging autorizado. Consultá [Testing](TESTING.md) y [Production checklist](PRODUCTION_CHECKLIST.md).
