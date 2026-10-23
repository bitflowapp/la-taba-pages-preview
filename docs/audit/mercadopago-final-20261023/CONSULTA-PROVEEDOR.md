# Consulta preparada para soporte de Mercado Pago — no enviada

Checkout Pro de Argentina, exclusivamente usuarios oficiales de prueba.

- Aplicación integradora: `2691240967769590`.
- Vendedor de prueba: `3594962708`; `/users/me` confirma `test_user`, MLA y cuenta activa.
- Comprador de prueba: `3594962710`; nickname recuperado de `/users/3594962710`, coincide con el registro seguro de su creación. Inicio de sesión exitoso con contraseña almacenada en Windows, sin desafío pendiente.
- Credencial OAuth del vendedor `APP_USR`; no se solicitó `test_token`. No se incluyen tokens en este paquete.
- Preferencia: `3594962708-171128df-3092-4de2-96ee-f1f6383efe3d`.
- Referencia: `taba2:checkout:418a456b-d119-4518-9478-8c286c39d85d`.
- Flujo al enviar el pago: `f134432b-3420-4d6c-b14f-e3d7b1cb72f9`.
- Envío único: **23/10/2026 15:16:19 Argentina**, `2026-10-23T18:16:19.121Z`.
- Importe: ARS 100, una cuota. Mastercard oficial de prueba terminada en 0604, titular APRO, documento oficial de prueba.
- Host del checkout: `www.mercadopago.com.ar`; sin navegación a sandbox.

La asociación de la tarjeta y la elección de una cuota llegaron a la revisión. Tras pulsar Pagar una sola vez, el flujo terminó en `/error/` con «Oh, no, algo anduvo mal». No se pulsó Reintentar.

`GET /checkout/preferences/{id}` confirma el collector, client_id, MLA, ARS 100, referencia y URLs de QA esperados. `GET /v1/payments/search` con el OAuth del vendedor y la referencia devuelve `paging.total=0`.

Se solicita identificar el fallo de este flujo y confirmar si existe una restricción de la aplicación o de las cuentas de prueba, o una incidencia en Checkout Pro. No se afirma una causa raíz que el proveedor no haya confirmado.

Adjuntos disponibles en este directorio: `apro-checkout.json`, `apro-provider.json`, `apro-error-proveedor.png`, `browser-summary.json` y evidencia financiera. **No se capturó el request ID HTTP del envío fallido**; el flow ID y la hora son los identificadores disponibles. La instrumentación se amplió después del fallo, sin repetir la compra.

El diagnóstico oficial de notificaciones devuelve dos fallos históricos HTTP 502, de temas `mp-connect` y `merchant_order`, anteriores a este intento. No son evidencia de una notificación de pago de esta referencia.
