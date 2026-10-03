# Exactly-once — resultados

Estado: **CONTRATO LOCAL VERDE / EJECUCIÓN POSTGRESQL REMOTA PENDIENTE**.

- Auditoría local de este turno: los tests focales de pagos pasaron 17/17. La consulta remota de migraciones no fue concluyente por el enlace/configuración incorrectos y timeout; no se ejecutó ningún worker remoto.
- `claim_payment_outbox` contiene `FOR UPDATE SKIP LOCKED`, owner y lease.
- El scheduler dispara tras insert y cada 30 s; el cron recupera leases vencidos.
- Backoff exponencial y dead letter a partir del octavo intento.
- `finalize_paid_checkout_session` bloquea sesión/pago/reserva y vincula `completed_order_id`.
- Los tests estáticos validan un fixture SQL que exige un pedido, un descuento de stock, un evento y deduplicación de Webhook.

La suite PostgreSQL ejecutable `supabase/tests/mercadopago_checkout_pro.local.sql` existe, pero no se ejecutó en esta fase porque Docker no respondió. Tampoco se aplicó en staging. Por eso no se certifica todavía concurrencia real de dos workers ni exactly-once remoto.
