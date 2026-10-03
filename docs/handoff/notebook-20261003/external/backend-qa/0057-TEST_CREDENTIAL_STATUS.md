# Estado de credenciales de prueba

Fecha de consulta: 2026-08-03

Estado: **FALTAN CREDENCIALES MERCADO PAGO TEST**.

## Supabase staging

- Project ref verificado: `ukxqbgswjlibmnjemrzd`.
- `supabase secrets list` no devolvió secretos custom configurados.
- El proyecto dispone de claves Supabase legacy y nuevas (publishable/secret); sólo se comprobó su existencia, nunca se registraron valores.
- Una consulta REST con la publishable key en memoria confirmó que RLS expone un comercio y nueve productos públicos; la key no se escribió en archivos ni salida.
- Un uso backend efímero de service role permitió contar membresías sin exponer identidades ni el valor de la key; no se usó en browser.

## Auditoría de este turno

No se configuraron secrets remotos. Los nombres requeridos siguen siendo sólo los documentados abajo; ningún valor fue leído ni escrito.

## Secretos requeridos y estado

| Nombre | Destino | Estado |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Edge secrets staging | ausente; debe ser test |
| `MERCADOPAGO_WEBHOOK_SECRET` | Edge secrets staging | ausente; debe ser test |
| `MERCADOPAGO_ENVIRONMENT` | Edge secrets staging | ausente; valor obligatorio futuro `test` |
| `PAYMENT_WORKER_SECRET` | Edge secrets staging | ausente |
| `PAYMENT_LOG_HASH_SALT` | Edge secrets staging | ausente |
| `TABA_ALLOWED_ORIGINS` | Edge secrets staging | ausente; depende del dominio HTTPS |
| `TABA_CHECKOUT_BASE_URL` | Edge secrets staging | ausente; depende del dominio HTTPS |
| `taba_payment_worker_hmac_secret` | Supabase Vault cifrado | ausente; mismo valor independiente del worker |
| `taba_payment_worker_url` | Supabase Vault cifrado | ausente; debe apuntar al ref staging |

La integración Checkout Pro redirige usando el `init_point` devuelto por backend y no integra el SDK de Mercado Pago en browser; por este contrato la Public Key de Mercado Pago no es necesaria para el flujo actual y no se expondrá salvo que la aplicación oficial lo requiera posteriormente.

No se buscaron, configuraron ni validaron credenciales productivas.
