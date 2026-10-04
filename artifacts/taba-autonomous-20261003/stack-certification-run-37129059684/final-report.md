# Certificación e-commerce en el STACK efímero (no es Staging) — ecom-cert-stack-20261003-141842

- target: supabase-ephemeral-stack
- Entorno: **supabase-ephemeral-stack** (`stack`), negocio propio de la corrida `taba-ecommerce-stack-20261003-141842` («TABA_ECOMMERCE_STACK_20261003_141842»).
- Destino STACK: el stack de `supabase start` en loopback, con GoTrue, la puerta de entrada, pg_cron y el runtime de Edge reales. Sin Cloudflare y sin despliegue alojado: lo que depende de eso figura como SKIPPED_NOT_AVAILABLE_ON_TARGET.
- Inicio: 2026-10-03T14:18:42.631Z · Fin: 2026-10-03T14:21:47.884Z · Invocaciones: 1.
- Checks: 455 (PASS 450, FAIL 0, SKIPPED_NOT_DEPLOYED 1, SKIPPED_NOT_AVAILABLE_LOCALLY 0, SKIPPED_NOT_AVAILABLE_ON_TARGET 4).
- Código de salida: 0.
- Requests: 4908 (carga: 2310 de 12000). Ingresos anónimos: 1.
- Usos de service_role: 583; intervenciones directas en la base: 8. Detalle en `service-role-uses.json`.

## Fases

| Fase | Veredicto | Checks | PASS | FAIL | NO DESPLEGADO | NO EN ESTE DESTINO |
|---|---|---:|---:|---:|---:|---:|
| preflight | PASS | 14 | 13 | 0 | 0 | 1 |
| tenant | PASS | 15 | 15 | 0 | 0 | 0 |
| catalog | PASS | 19 | 19 | 0 | 0 | 0 |
| pricing | PASS | 33 | 33 | 0 | 0 | 0 |
| snapshot | PASS | 17 | 17 | 0 | 0 | 0 |
| delivery | PASS | 26 | 26 | 0 | 0 | 0 |
| hours | PASS | 43 | 43 | 0 | 0 | 0 |
| status | PASS | 21 | 21 | 0 | 0 | 0 |
| inventory | PASS | 12 | 12 | 0 | 0 | 0 |
| idempotency | PASS | 27 | 27 | 0 | 0 | 0 |
| lifecycle | PASS | 33 | 33 | 0 | 0 | 0 |
| cancellation | PASS | 17 | 17 | 0 | 0 | 0 |
| customer-cancel | PASS | 15 | 15 | 0 | 0 | 0 |
| rider | PASS | 34 | 34 | 0 | 0 | 0 |
| privacy | PASS | 25 | 24 | 0 | 0 | 1 |
| rls | PASS | 19 | 19 | 0 | 0 | 0 |
| trace | PASS | 12 | 12 | 0 | 0 | 0 |
| health | PASS | 7 | 7 | 0 | 0 | 0 |
| abuse | PASS | 13 | 12 | 0 | 0 | 1 |
| payments | PASS | 12 | 12 | 0 | 0 | 0 |
| lost-ack | PASS | 11 | 11 | 0 | 0 | 0 |
| edge-functions | PASS | 5 | 4 | 0 | 0 | 1 |
| expiry | PASS | 4 | 4 | 0 | 0 | 0 |
| performance | PASS | 3 | 2 | 0 | 1 | 0 |
| teardown | PASS | 18 | 18 | 0 | 0 | 0 |

## Contratos detectados

- order_intake_guard: desplegado
- service_status: desplegado
- customer_cancel: desplegado
- order_expiry: desplegado
- cancel_republish: desplegado
- order_trace: desplegado
- ecommerce_health: desplegado
- catalog_stock_authority: desplegado
- enforcement_lock: desplegado
- delivery_coverage_gate: desplegado
- opening_rules_gate: desplegado
- checkout_payments: desplegado
- payment_refunds: desplegado
- business_self_delivery: desplegado
- operational_alerts: desplegado
- tracking_revocation: desplegado

## Checks que fallaron (0)

Ninguno.

## Checks que no se probaron, con su motivo (5)

- preflight:STACK_GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY: SKIPPED_NOT_AVAILABLE_ON_TARGET — el gateway del stack local no exige la clave del proyecto (observado: HTTP 200 en /rest/v1/ sin apikey); en la plataforma alojada sí la exige
- privacy:GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY: SKIPPED_NOT_AVAILABLE_ON_TARGET — el gateway del stack local no exige la clave del proyecto (observado: HTTP 200 sin apikey, con [] en la tabla y null en la RPC: nada se filtró); en la plataforma alojada sí la exige
- abuse:A_CLIENT_SUPPLIED_CF_CONNECTING_IP_IS_REFUSED_AT_THE_EDGE: SKIPPED_NOT_AVAILABLE_ON_TARGET — el stack no tiene Cloudflare delante: nadie rechaza un cf-connecting-ip escrito por el cliente, y el origen de red es el que declara el transporte de esta herramienta
- edge-functions:WEBHOOK_WITHOUT_A_VALID_SIGNATURE_IS_ANSWERED_401: SKIPPED_NOT_AVAILABLE_ON_TARGET — el stack no es un despliegue alojado: sirve HTTP plano en loopback y las funciones de pago no lo reconocen como proyecto, así que se niegan antes de mirar la firma del aviso (contestó 400 HTTPS_REQUIRED)
- performance:PERFORMANCE_IS_WITHIN_THE_COMMITTED_THRESHOLDS: SKIPPED_NOT_DEPLOYED — contrato no desplegado: performance_thresholds — MEASURED_NO_GATE: docs/ecommerce-hardening/performance-thresholds.json no tiene umbrales para «stack»; el bloque propuesto (regla: p95 × 3, redondeado a 50 ms, piso 250 ms, tope el statement_timeout del rol) está en performance.json

## Latencia por tipo de llamada (toda la corrida, ms)

| Operación | n | p50 | p95 | p99 | máx | media |
|---|---:|---:|---:|---:|---:|---:|
| rpc identity_register_session | 7 | 2.1 | 11.3 | 11.3 | 11.3 | 4.6 |
| rpc request_business_access | 5 | 9.2 | 12.2 | 12.2 | 12.2 | 10 |
| rpc identity_list_access_requests | 5 | 1.9 | 2.9 | 2.9 | 2.9 | 2.2 |
| rpc identity_review_access_request | 5 | 2.5 | 3.7 | 3.7 | 3.7 | 2.8 |
| rpc set_delivery_pricing | 1 | 3.6 | 3.6 | 3.6 | 3.6 | 3.6 |
| rpc set_business_service_hours | 14 | 2.7 | 3.8 | 3.8 | 3.8 | 3 |
| rpc upsert_delivery_zone | 2 | 2 | 3 | 3 | 3 | 2.5 |
| rpc set_service_enforcement | 4 | 2.5 | 73.2 | 73.2 | 73.2 | 37.2 |
| rpc set_business_fulfillment | 10 | 2.6 | 3.7 | 3.7 | 3.7 | 2.9 |
| rpc apply_commercial_catalog_batch | 8 | 4.7 | 9.6 | 9.6 | 9.6 | 5.7 |
| rpc set_commercial_product_publication | 11 | 3.3 | 5.3 | 5.3 | 5.3 | 3.1 |
| rpc open_qa_window | 2 | 2.3 | 3.3 | 3.3 | 3.3 | 2.8 |
| rpc upsert_current_customer_profile | 34 | 10.4 | 12.1 | 13.3 | 13.3 | 10.7 |
| rpc create_order_with_items | 372 | 32.4 | 429.5 | 476.2 | 485.1 | 102.1 |
| rpc cancel_order | 500 | 11.5 | 31.2 | 62.1 | 87.6 | 14.4 |
| rpc classify_order_as_qa | 504 | 2.4 | 4.8 | 7.1 | 61.2 | 2.9 |
| GET products | 232 | 28.3 | 104.2 | 114.9 | 115.2 | 37.7 |
| GET businesses | 1 | 1.4 | 1.4 | 1.4 | 1.4 | 1.4 |
| PATCH products | 11 | 1.7 | 2 | 2 | 2 | 1.8 |
| POST products | 4 | 1.4 | 1.6 | 1.6 | 1.6 | 1.5 |
| DELETE products | 2 | 1.4 | 1.6 | 1.6 | 1.6 | 1.5 |
| rpc apply_inventory_movement | 17 | 3.2 | 13.8 | 13.8 | 13.8 | 3.7 |
| rpc upsert_current_customer_address | 12 | 3.3 | 5.3 | 5.3 | 5.3 | 3.6 |
| rpc complete_scanned_product | 2 | 6.4 | 6.5 | 6.5 | 6.5 | 6.5 |
| rpc get_public_order_tracking | 234 | 11.6 | 52.1 | 54.7 | 55.1 | 17.8 |
| GET orders | 447 | 177.7 | 1505.9 | 1832 | 1859.2 | 390.1 |
| rpc list_operational_pipeline | 1 | 3.6 | 3.6 | 3.6 | 3.6 | 3.6 |
| rpc set_delivery_zone_active | 6 | 2.4 | 3.9 | 3.9 | 3.9 | 2.7 |
| rpc commerce_availability | 19 | 2.9 | 5.2 | 5.2 | 5.2 | 3.1 |
| PATCH businesses | 6 | 2.4 | 70.3 | 70.3 | 70.3 | 15.5 |
| rpc get_business_service_status | 46 | 2.5 | 4.7 | 5.1 | 5.1 | 2.6 |
| rpc set_business_service_exception | 3 | 2.5 | 3 | 3 | 3 | 2.6 |
| rpc delete_business_service_exception | 3 | 2.4 | 2.6 | 2.6 | 2.6 | 2.3 |
| rpc set_business_open_state | 6 | 2.4 | 3.3 | 3.3 | 3.3 | 2.3 |
| rpc acknowledge_order | 5 | 2.3 | 3.7 | 3.7 | 3.7 | 2.6 |
| rpc transition_order | 36 | 3.6 | 4.5 | 4.9 | 4.9 | 3.5 |
| rpc offer_order_to_rider | 9 | 3.1 | 3.8 | 3.8 | 3.8 | 2.9 |
| rpc accept_rider_order_offer | 8 | 3.1 | 6.2 | 6.2 | 6.2 | 4 |
| rpc mark_delivery_picked_up | 6 | 2.3 | 5.1 | 5.1 | 5.1 | 3.5 |
| rpc start_rider_delivery | 5 | 3.8 | 4.5 | 4.5 | 4.5 | 3.4 |
| rpc mark_rider_arrived | 6 | 2.4 | 4.6 | 4.6 | 4.6 | 3.3 |
| rpc issue_order_delivery_code | 9 | 2 | 2.6 | 2.6 | 2.6 | 2 |
| rpc confirm_delivery_code | 10 | 3.5 | 49 | 49 | 49 | 24.6 |
| rpc get_rider_delivery_board | 10 | 2.9 | 4.6 | 4.6 | 4.6 | 3.2 |
| rpc set_rider_availability | 6 | 2.7 | 3.5 | 3.5 | 3.5 | 2.8 |
| rpc heartbeat_rider_availability | 19 | 11.8 | 1013.1 | 1013.1 | 1013.1 | 81.5 |
| rpc list_business_rider_availability | 1 | 2.2 | 2.2 | 2.2 | 2.2 | 2.2 |
| rpc publish_rider_location_fanout | 2 | 3.6 | 4.1 | 4.1 | 4.1 | 3.9 |
| rpc confirm_manual_order_payment | 5 | 2.5 | 3.5 | 3.5 | 3.5 | 2.5 |
| rpc reverse_manual_order_payment | 3 | 3.3 | 3.9 | 3.9 | 3.9 | 3.3 |
| rpc cancel_own_order | 19 | 2.4 | 9.7 | 9.7 | 9.7 | 2.9 |
| rpc create_checkout_session | 245 | 45.9 | 386.6 | 700.7 | 738.3 | 103.9 |
| rpc prepare_mercadopago_preference_v2 | 220 | 23.9 | 348.1 | 561.5 | 657.5 | 87.9 |
| rpc get_mercadopago_payment_authority_v2 | 220 | 26.1 | 283.5 | 519.6 | 730.7 | 67.6 |
| rpc record_mercadopago_preference_created_v2 | 220 | 36 | 340.7 | 513.6 | 670.4 | 78.6 |
| rpc record_mercadopago_payment_snapshot | 224 | 16.5 | 250 | 383.4 | 418.5 | 53.2 |
| rpc finalize_paid_checkout_session | 221 | 24.5 | 168.1 | 358.9 | 514.9 | 49.6 |
| rpc prepare_payment_refund_v2 | 224 | 3.5 | 7.2 | 30.5 | 31 | 4.4 |
| rpc record_payment_refund_identity | 220 | 2.7 | 6.2 | 30.5 | 30.9 | 3.6 |
| rpc record_payment_refund_response_v2 | 220 | 3.6 | 5.7 | 7.3 | 7.5 | 3.8 |
| rpc reject_rider_order_offer | 3 | 2.3 | 3.2 | 3.2 | 3.2 | 2.4 |
| rpc withdraw_rider_order_offer | 2 | 1.8 | 2.3 | 2.3 | 2.3 | 2.1 |
| rpc confirm_business_delivery_code | 6 | 2.7 | 45.8 | 45.8 | 45.8 | 23.8 |
| rpc set_business_address | 1 | 2.8 | 2.8 | 2.8 | 2.8 | 2.8 |
| GET order_items | 13 | 1.6 | 1.8 | 1.8 | 1.8 | 1.6 |
| GET order_events | 2 | 1.5 | 5 | 5 | 5 | 3.3 |
| GET inventory_movements | 12 | 1.5 | 1.7 | 1.7 | 1.7 | 1.5 |
| GET business_members | 2 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 |
| GET customer_addresses | 12 | 1.2 | 1.4 | 1.4 | 1.4 | 1.3 |
| GET customers | 1 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 |
| rpc get_order_trace | 36 | 6.8 | 13.9 | 14.1 | 14.1 | 6.9 |
| rpc revoke_public_tracking | 4 | 1.8 | 2.1 | 2.1 | 2.1 | 1.8 |
| rpc recover_order_tracking_access | 2 | 2 | 43.3 | 43.3 | 43.3 | 22.7 |
| GET /rest/v1/orders | 1 | 1.7 | 1.7 | 1.7 | 1.7 | 1.7 |
| POST /rest/v1/rpc/get_public_order_tracking | 1 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 |
| rpc identity_set_member_active | 1 | 3.7 | 3.7 | 3.7 | 3.7 | 3.7 |
| GET payment_intents | 10 | 1.2 | 1.6 | 1.6 | 1.6 | 1.3 |
| GET payment_refunds | 10 | 1.4 | 1.6 | 1.6 | 1.6 | 1.4 |
| GET order_public_tokens | 10 | 1.5 | 3.2 | 3.2 | 3.2 | 1.7 |
| GET pos_sales | 10 | 1.3 | 1.7 | 1.7 | 1.7 | 1.4 |
| POST orders | 1 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 |
| DELETE order_items | 1 | 1.2 | 1.2 | 1.2 | 1.2 | 1.2 |
| PATCH orders | 7 | 1.6 | 2.5 | 2.5 | 2.5 | 1.7 |
| DELETE orders | 1 | 1.2 | 1.2 | 1.2 | 1.2 | 1.2 |
| POST order_items | 1 | 1.4 | 1.4 | 1.4 | 1.4 | 1.4 |
| PATCH customer_addresses | 1 | 1.4 | 1.4 | 1.4 | 1.4 | 1.4 |
| DELETE inventory_movements | 1 | 1.2 | 1.2 | 1.2 | 1.2 | 1.2 |
| POST inventory_movements | 1 | 1.3 | 1.3 | 1.3 | 1.3 | 1.3 |
| PATCH payment_intents | 1 | 1.4 | 1.4 | 1.4 | 1.4 | 1.4 |
| POST payment_refunds | 1 | 1.4 | 1.4 | 1.4 | 1.4 | 1.4 |
| rpc mp_record_seller_webhook | 1 | 3.3 | 3.3 | 3.3 | 3.3 | 3.3 |
| rpc get_ecommerce_health | 6 | 1.7 | 8.4 | 8.4 | 8.4 | 4.8 |
| rpc sweep_expired_checkout_sessions | 2 | 2.9 | 4.3 | 4.3 | 4.3 | 3.6 |
| rpc refresh_operational_alerts | 3 | 9 | 9.3 | 9.3 | 9.3 | 9 |
| edge catalog-image-manager | 1 | 1317 | 1317 | 1317 | 1317 | 1317 |
| edge fiscal-artifact-access | 1 | 353.5 | 353.5 | 353.5 | 353.5 | 353.5 |
| edge mercadopago-cancel-payment | 1 | 92.2 | 92.2 | 92.2 | 92.2 | 92.2 |
| edge mercadopago-checkout-status | 1 | 88.1 | 88.1 | 88.1 | 88.1 | 88.1 |
| edge mercadopago-connect | 1 | 94.4 | 94.4 | 94.4 | 94.4 | 94.4 |
| edge mercadopago-create-checkout-session | 3 | 32.1 | 39.3 | 39.3 | 39.3 | 27.7 |
| edge mercadopago-create-preference | 1 | 91.9 | 91.9 | 91.9 | 91.9 | 91.9 |
| edge mercadopago-oauth-callback | 1 | 88.4 | 88.4 | 88.4 | 88.4 | 88.4 |
| edge mercadopago-payment-worker | 1 | 91.8 | 91.8 | 91.8 | 91.8 | 91.8 |
| edge mercadopago-refund | 1 | 93 | 93 | 93 | 93 | 93 |
| edge mercadopago-webhook | 2 | 3 | 347.8 | 347.8 | 347.8 | 175.4 |
| edge print-agent-gateway | 1 | 156 | 156 | 156 | 156 | 156 |
| edge team-invitation | 1 | 158.7 | 158.7 | 158.7 | 158.7 | 158.7 |
| rpc close_qa_window | 2 | 2.4 | 2.7 | 2.7 | 2.7 | 2.6 |
| rpc identity_close_own_session | 6 | 2.6 | 2.8 | 2.8 | 2.8 | 2.7 |

## Rendimiento medido (ms) — compuerta: MEASURED_NO_GATE

| Operación | Paso | n | ok | errores | p50 | p95 | p99 | máx | req/s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| catalog_read | baseline | 30 | 30 | 0 | 3 | 11.1 | 11.1 | 11.1 | 223.9 |
| order_creation_cash | baseline | 30 | 30 | 0 | 14.1 | 28.8 | 29 | 29 | 53.8 |
| order_query | baseline | 30 | 30 | 0 | 8 | 8.9 | 11.6 | 11.6 | 121.5 |
| tracking_query | baseline | 30 | 30 | 0 | 1.5 | 2.3 | 2.6 | 2.6 | 563.5 |
| panel_query | baseline | 30 | 30 | 0 | 5.9 | 7.8 | 8.5 | 8.5 | 156.8 |
| checkout_creation | baseline | 30 | 30 | 0 | 5.2 | 11.3 | 11.8 | 11.8 | 32 |
| payment_intent | baseline | 30 | 30 | 0 | 2.4 | 4.7 | 4.8 | 4.8 | 32 |
| stock_commit_paid | baseline | 30 | 30 | 0 | 4.8 | 7.2 | 8.3 | 8.3 | 32 |
| catalog_read | c10 | 40 | 40 | 0 | 10.4 | 20.8 | 22.9 | 22.9 | 822.2 |
| order_creation_cash | c10 | 40 | 40 | 0 | 27.2 | 98 | 111.7 | 111.7 | 228 |
| order_query | c10 | 40 | 40 | 0 | 47 | 58.2 | 58.8 | 58.8 | 210.2 |
| tracking_query | c10 | 40 | 40 | 0 | 4.6 | 7.7 | 10 | 10 | 1868.6 |
| panel_query | c10 | 40 | 40 | 0 | 65.4 | 91.2 | 102.7 | 102.7 | 145.7 |
| checkout_creation | c10 | 40 | 40 | 0 | 26.3 | 63.9 | 92 | 92 | 105.8 |
| payment_intent | c10 | 40 | 40 | 0 | 6 | 11.6 | 15.2 | 15.2 | 105.8 |
| stock_commit_paid | c10 | 40 | 40 | 0 | 17.3 | 33 | 47.7 | 47.7 | 105.8 |
| catalog_read | c30 | 40 | 40 | 0 | 29 | 58.9 | 59.8 | 59.8 | 650 |
| order_creation_cash | c30 | 40 | 40 | 0 | 68.5 | 124.2 | 133 | 133 | 298.3 |
| order_query | c30 | 40 | 40 | 0 | 128.9 | 260.4 | 265.8 | 265.8 | 150.2 |
| tracking_query | c30 | 40 | 40 | 0 | 12.3 | 14.9 | 15.3 | 15.3 | 1934.5 |
| panel_query | c30 | 40 | 40 | 0 | 200 | 412.3 | 415.1 | 415.1 | 96.1 |
| checkout_creation | c30 | 40 | 40 | 0 | 49.4 | 131.8 | 152 | 152 | 101.6 |
| payment_intent | c30 | 40 | 40 | 0 | 31.3 | 116.8 | 141.7 | 141.7 | 101.6 |
| stock_commit_paid | c30 | 40 | 40 | 0 | 24.7 | 47.7 | 89.1 | 89.1 | 101.6 |
| catalog_read | c100 | 100 | 100 | 0 | 68.6 | 112.1 | 115.2 | 115.2 | 850.1 |
| order_creation_cash | c100 | 100 | 100 | 0 | 332.9 | 468 | 479.7 | 485.1 | 205.6 |
| order_query | c100 | 100 | 100 | 0 | 544.8 | 976 | 988.9 | 993 | 100.6 |
| tracking_query | c100 | 100 | 100 | 0 | 31.3 | 53.2 | 54.8 | 55.1 | 1769.8 |
| panel_query | c100 | 100 | 100 | 0 | 992.5 | 1823.8 | 1853 | 1859.2 | 53.7 |
| checkout_creation | c100 | 100 | 100 | 0 | 168.4 | 607.7 | 707.7 | 738.3 | 95.7 |
| payment_intent | c100 | 100 | 100 | 0 | 133.8 | 445.1 | 626.8 | 657.5 | 95.7 |
| stock_commit_paid | c100 | 100 | 100 | 0 | 61.4 | 218.5 | 424.6 | 514.9 | 95.7 |

## Notas del tenant

- DISTANCE_CAP_NOT_EXERCISED: no existe un camino (RPC o tabla expuesta) para que service_role escriba private.rider_map_business_locations; set_delivery_pricing rechaza un tope de distancia sin punto verificado.

## Lo que queda en el stack (hasta que se apaga) a propósito

- businesses row of the QA tenant «TABA_ECOMMERCE_STACK_20261003_141842» (closed, ordering disabled, qa_fixture) with its hours, zones and fixture products
- businesses row of the second business «TABA_ECOMMERCE_STACK_20261003_141842_B» (closed, ordering disabled, qa_fixture): its order retains it
- persistent identities of the tenant (109: operators, paying customers, the owner of the second business), suspended and with the password discarded: command receipts, config audit, inventory movements, rider offers and checkout sessions reference them with ON DELETE RESTRICT
- orders of the tenant (origin=qa, terminal) with order_items / order_events / order_public_tokens / order_delivery_handoffs: append-only audit
- inventory_movements of the tenant (manual_adjustment qa_ecom_cert_reset): append-only ledger
- business_command_receipts, business_config_audit, rider_delivery_operations, delivery_confirmation_attempts, identity_sessions (revoked) and identity_audit_events of the tenant
- notification_outbox rows of the tenant: processed and suppressed when the order is classified QA
- checkout_sessions, payment_intents, payment_attempts, payment_events and payment_refunds of the tenant (all refunded or never charged; provider ids are invented, no provider was called)
- business_payment_settings (disabled) and mp_seller_connections (disconnected, no credentials) of the tenant

## Evidencia

`checks.json`, `summary.json`, `performance.json`, `non-2xx-answers.json`, `created-resources.json`, `service-role-uses.json`, `environment.json`, `tenant.json`, `cleanup-result.json` y un `phase-<id>.json` por fase.
