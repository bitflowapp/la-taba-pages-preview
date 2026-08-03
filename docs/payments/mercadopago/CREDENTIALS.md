# Credenciales y aplicación

## Aplicación

Antes de configurar secrets, revisar en el Dashboard de Mercado Pago si ya existe una aplicación autorizada para TABA2 bajo la cuenta vendedora argentina correcta. No crear duplicados. Si no existe y la persona operadora tiene sesión autorizada, crear:

- Nombre: `TABA2`
- Tipo: Pagos online
- Modelo: Tienda con desarrollo propio

Detenerse ante MFA, CAPTCHA, verificación de identidad o aprobación humana. Nunca crearla bajo una cuenta personal que no recibirá el dinero.

## Secrets por ambiente

Configurar en el gestor de secretos de Supabase Edge Functions, nunca en PostgreSQL, `runtime-config.js`, navegador, localStorage, Tauri, logs o commits:

| Nombre | Uso |
| --- | --- |
| `MERCADOPAGO_ACCESS_TOKEN` | Sólo Edge Functions, API de Mercado Pago. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Sólo Edge Function del webhook. |
| `MERCADOPAGO_ENVIRONMENT` | `test` o `production`. |
| `PAYMENT_LOG_HASH_SALT` | Hashes no reversibles de campos sensibles para observabilidad. |
| `PAYMENT_WORKER_SECRET` | Autentica la ejecución interna del worker. |
| `TABA_ALLOWED_ORIGINS` | Allowlist HTTPS separada por comas. |
| `TABA_CHECKOUT_BASE_URL` | Dominio HTTPS controlado de TABA2. |

Para producción además son obligatorios:

```text
MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved
MERCADOPAGO_PRODUCTION_ENABLE_CONFIRMATION=I_UNDERSTAND_THIS_ENABLES_REAL_MERCADO_PAGO_PAYMENTS
```

La Public Key no se usa en Checkout Pro por redirect y no debe exponerse salvo que una integración futura oficial realmente la requiera.

## Configuración no secreta

`business_payment_settings` guarda únicamente `business_id`, provider, environment, modo Checkout Pro, ARS, cuotas, política de offline, expiración, reserva, política de refunds, review productivo y los IDs no secretos de collector/aplicación. Producción exige `production_review_status = approved`.
