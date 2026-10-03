# Resultados de firma Webhook y worker

Fecha: 2026-08-03

## Local

- Firma Mercado Pago Deno: 4/4 PASS.
- Firma HMAC del worker Deno: 4/4 PASS.
- Contratos Node Webhook + scheduler: 8/8 PASS.
- Suite `test:webhook`: PASS.

Casos cubiertos: firma válida; firma inválida; secret incorrecto; request ID incorrecto; `data.id` incorrecto; payload alterado; sin firma; timestamp vencido; HMAC worker válido; firma/nonce/timestamp worker inválidos; replay vencido y fecha futura fuera de tolerancia.

El worker usa timestamp de 10 dígitos, nonce UUID, HMAC-SHA256 y ventana máxima de 120 s (30 s de tolerancia futura). `pg_net` no recibe el secreto compartido.

## Remoto

Recepción HTTPS, simulador oficial, HTTP, receipt, outbox, consulta API y duplicación: **PENDIENTES**. No se declara éxito remoto.
