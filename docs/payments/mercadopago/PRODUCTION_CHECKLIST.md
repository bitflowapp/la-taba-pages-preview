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
- [ ] `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` ausente: es la variable vieja de la prueba de humo, ya no abre nada y su presencia es un error de configuración.
- [ ] El interruptor de dinero real, último y sólo con la decisión escrita del dueño: `MERCADOPAGO_REAL_MONEY_ENABLED=enabled`.

## El interruptor de dinero real

En producción un cobro se crea sólo si se cumplen las tres llaves: la revisión del proyecto aprobada, el comercio con Mercado Pago encendido y su vendedor productivo conectado, y el secreto de backend `MERCADOPAGO_REAL_MONEY_ENABLED` con el valor exacto `enabled`. Ausente, vacío, `true`, `ENABLED` o cualquier otra cosa: cerrado, y la sesión de checkout responde `409 PAYMENTS_NOT_ENABLED` antes de reservar stock, sin preferencia y sin llamar a Mercado Pago.

- **Quién lo pone:** quien opera la plataforma, con la decisión escrita del dueño. Va en el gestor de secretos de las Edge Functions; nunca en la web, en la base ni en el código.
- **Cuándo:** para la ventana del pago real de control, y para vender cuando `docs/ecommerce-hardening/payment-certification.json` registre Mercado Pago certificado en producción y la decisión de apertura lo incluya.
- **Cómo se apaga, en un paso:** borrar el secreto `MERCADOPAGO_REAL_MONEY_ENABLED` (o darle cualquier otro valor). Los reembolsos, las cancelaciones de cobros existentes, el webhook, el worker, la conciliación y la pantalla de estado siguen funcionando: cerrar el dinero real no traba la devolución de nadie.
- **Cómo se verifica:** `node scripts/mercadopago/verificar-configuracion.mjs --ref=<proyecto>` (interruptor y «dinero real en el proyecto») y la compuerta de release `REAL_MONEY_GATE` (`MONEY_MOVEMENT_POSSIBLE`).

Un pago real de control requiere, además, la confirmación humana explícita de ese pago. Antes de empezar informar producto real, importe, negocio receptor, cuenta vendedora, ambiente y política posterior. Confirmar API, webhook, pedido, panel y stock. No reembolsar sin autorización explícita. Si el interruptor se abrió sólo para esa ventana, cerrarlo al terminar.
