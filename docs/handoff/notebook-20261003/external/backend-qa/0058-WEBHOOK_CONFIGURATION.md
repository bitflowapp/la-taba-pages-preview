# Configuración del Webhook

Estado: **PENDIENTE / NO CONFIGURADO EN MERCADO PAGO**.

- Auditoría local de este turno: `npm run test:webhook` pasó 8/8. No se configuró un webhook remoto porque faltan sesión autorizada, dominio HTTPS estable y secret test.
- Endpoint local implementado: `mercadopago-webhook`.
- Endpoint remoto: no desplegado.
- URL HTTPS staging: no disponible todavía.
- Eventos previstos: pagos, chargebacks y claims; merchant order sólo si el contrato final lo necesita.
- Secret test: ausente.
- Simulador oficial: no ejecutado.

El endpoint limita método/tamaño, exige HTTPS, valida `x-signature`, `x-request-id`, timestamp y `data.id`, minimiza el receipt, deduplica, encola y responde antes de consultar la API. El procesamiento durable consulta el recurso oficial; esta descripción es evidencia de código/pruebas locales, no certificación remota.
