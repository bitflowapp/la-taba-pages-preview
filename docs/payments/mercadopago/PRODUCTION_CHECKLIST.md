# Checklist de producción

No activar producción hasta que staging esté completamente verde.

- [ ] Cuenta vendedora argentina correcta y verificada.
- [ ] Aplicación TABA2 correcta, sin duplicados, con collector y application ID verificados.
- [ ] Access Token y webhook secret productivos cargados sólo como secretos Edge.
- [ ] Webhook y back URLs HTTPS finales configurados en Mercado Pago.
- [ ] `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`.
- [ ] Configuración del negocio habilitada con `production_review_status=approved`.
- [ ] Precios confirmados, stock real y productos pending excluidos del cobro.
- [ ] Política de refunds, contacto, alertas, backups y scheduler del worker verificados.
- [ ] Staging aprobó el flujo completo y las suites de navegadores.

Un smoke de pago real requiere una segunda confirmación humana exacta antes de empezar:

```text
I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE
```

Durante esa ventana la Edge Function debe recibir exactamente `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION=I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE`; sin esa variable, crear preferencias productivas falla cerrado. Quitarla al finalizar.

Antes del smoke informar producto real, importe, negocio receptor, cuenta vendedora, ambiente y política posterior. Confirmar API, webhook, pedido, panel y stock. No reembolsar sin autorización explícita.
