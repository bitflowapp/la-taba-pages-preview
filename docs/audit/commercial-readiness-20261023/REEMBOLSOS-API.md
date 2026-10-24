# Reembolso por API en el entorno de prueba: alternativas oficiales

24/10/2026. Adenda de [`REEMBOLSO-401.md`](../mercadopago-final-20261023/lanzamiento/REEMBOLSO-401.md). No se hizo ningún reembolso nuevo ni otra sonda contra Mercado Pago: el diagnóstico del 23/10 ya es concluyente (el `401 Unauthorized use of live credentials`, cause 7, aparece incluso sobre un pago **rechazado**, o sea en la capa de autorización y antes de mirar el pago).

## Lo que dice la documentación oficial

| Fuente | Qué dice | Qué aporta |
|---|---|---|
| [Checkout Pro — Configurar reembolsos y cancelaciones](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-settings/refunds-and-cancellations) | `POST /payments/{id}/refunds`; total = cuerpo vacío; parcial con monto; 180 días; saldo suficiente; con dos medios, un reembolso por pago | Coincide con lo que hace La Taba. No menciona qué credencial usar ni restricciones del entorno de prueba |
| [Checkout API (orders) — Reembolsos y cancelaciones](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/refunds-cancellations.md) | Los reembolsos se prueban con las credenciales de prueba de la integración (`APP_USR-`, *Pruebas → Credenciales de prueba*) | Es lo que se usó el 25/09 (token directo de la TestApp): también 401 |
| [Checkout Pro con Orders API](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/refunds-cancellations) | `POST /v1/orders/{id}/refund` | Es otra integración (órdenes en vez de preferencias); migrar para probar un reembolso no se justifica |
| [Integrar Checkout Pro en marketplace](https://www.mercadopago.com.br/developers/en/docs/checkout-pro/how-tos/integrate-marketplace) y [OAuth](https://www.mercadopago.com.br/developers/en/docs/security/oauth/management) | El token del vendedor se obtiene por OAuth y se usa en el backend; el token deja de valer si el vendedor revoca, cambia la contraseña o vence | Coincide con el diseño (`MP_SELLER_TOKEN_EXPIRING`, reconexión) |

## Conclusión

No existe una vía oficial que no se haya probado: reembolso por API con el token OAuth del vendedor (401 en prueba), con el token directo de la integradora de prueba (401) y desde la cuenta del vendedor (**funciona y La Taba lo concilia una sola vez**, probado). Lo que queda es de Mercado Pago:

1. Consulta a soporte, texto listo en `REEMBOLSO-401.md` §6 (envío: decisión del titular de la cuenta).
2. Certificar la API con el **primer reembolso real de control** (`LANZAMIENTO.md` §6), con la devolución desde la cuenta del vendedor como respaldo inmediato si respondiera `REFUND_REJECTED`.

Después de una devolución, sea cual sea el camino, el pedido abierto ahora queda señalado por `ORDER_PAYMENT_REVERSED_OPEN` hasta que el encargado lo cancela (`ALERTAS-PREEXISTENTES.md`).
