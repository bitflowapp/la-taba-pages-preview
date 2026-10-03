# Certificación e-commerce en el STACK efímero (no es Staging) — ecom-cert-stack-20261003-131208

- target: supabase-ephemeral-stack
- Entorno: **supabase-ephemeral-stack** (`stack`), negocio propio de la corrida `taba-ecommerce-stack-20261003-131208` («TABA_ECOMMERCE_STACK_20261003_131208»).
- Destino STACK: el stack de `supabase start` en loopback, con GoTrue, la puerta de entrada, pg_cron y el runtime de Edge reales. Sin Cloudflare y sin despliegue alojado: lo que depende de eso figura como SKIPPED_NOT_AVAILABLE_ON_TARGET.
- Inicio: 2026-10-03T13:12:08.109Z · Fin: 2026-10-03T13:15:16.849Z · Invocaciones: 1.
- Checks: 455 (PASS 448, FAIL 2, SKIPPED_NOT_DEPLOYED 1, SKIPPED_NOT_AVAILABLE_LOCALLY 0, SKIPPED_NOT_AVAILABLE_ON_TARGET 4).
- Código de salida: 1.
- Requests: 4906 (carga: 2310 de 12000). Ingresos anónimos: 1.
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
| inventory | FAIL | 12 | 11 | 1 | 0 | 0 |
| idempotency | PASS | 27 | 27 | 0 | 0 | 0 |
| lifecycle | PASS | 33 | 33 | 0 | 0 | 0 |
| cancellation | FAIL | 17 | 16 | 1 | 0 | 0 |
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

## Checks que fallaron (2)

### inventory · LAST_UNIT_LOSER_GETS_A_CLEAN_REFUSAL

- esperado: `HTTP 4xx con 23514 (stock insuficiente) o 55000 (producto no disponible)`
- observado: `[{"http":500,"ok":false,"code":"55000","message":"producto no disponible: c6f1326d-f468-40f4-9651-2d648fb1c888","details":null,"ms":14.1},{"http":500,"ok":false,"code":"55000","message":"producto no disponible: c6f1326d-f468-40f4-9651-2d648fb1c888","details":null,"ms":13.2},{"http":500,"ok":false,"code":"55000","message":"producto no disponible: c6f1326d-f468-40f4-9651-2d648fb1c888","details":null…`
- hora: 2026-10-03T13:12:18.656Z

### cancellation · ORDER_NOT_FOUND_IS_ANSWERED_AS_A_CLIENT_ERROR

- esperado: `HTTP 4xx · P0002`
- observado: `{"http":500,"ok":false,"code":"P0002","message":"pedido inexistente","details":null,"ms":2.9}`
- hora: 2026-10-03T13:12:21.783Z


## Checks que no se probaron, con su motivo (5)

- preflight:STACK_GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY: SKIPPED_NOT_AVAILABLE_ON_TARGET — el gateway del stack local no exige la clave del proyecto (observado: HTTP 200 en /rest/v1/ sin apikey); en la plataforma alojada sí la exige
- privacy:GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY: SKIPPED_NOT_AVAILABLE_ON_TARGET — el gateway del stack local no exige la clave del proyecto (observado: HTTP 200 sin apikey, con [] en la tabla y null en la RPC: nada se filtró); en la plataforma alojada sí la exige
- abuse:A_CLIENT_SUPPLIED_CF_CONNECTING_IP_IS_REFUSED_AT_THE_EDGE: SKIPPED_NOT_AVAILABLE_ON_TARGET — el stack no tiene Cloudflare delante: nadie rechaza un cf-connecting-ip escrito por el cliente, y el origen de red es el que declara el transporte de esta herramienta
- edge-functions:WEBHOOK_WITHOUT_A_VALID_SIGNATURE_IS_ANSWERED_401: SKIPPED_NOT_AVAILABLE_ON_TARGET — el stack no es un despliegue alojado: sirve HTTP plano en loopback y las funciones de pago no lo reconocen como proyecto, así que se niegan antes de mirar la firma del aviso (contestó 400 HTTPS_REQUIRED)
- performance:PERFORMANCE_IS_WITHIN_THE_COMMITTED_THRESHOLDS: SKIPPED_NOT_DEPLOYED — contrato no desplegado: performance_thresholds — MEASURED_NO_GATE: docs/ecommerce-hardening/performance-thresholds.json no tiene umbrales para «stack»; el bloque propuesto (regla: p95 × 3, redondeado a 50 ms, piso 250 ms, tope el statement_timeout del rol) está en performance.json

## Latencia por tipo de llamada (toda la corrida, ms)

| Operación | n | p50 | p95 | p99 | máx | media |
|---|---:|---:|---:|---:|---:|---:|
| rpc identity_register_session | 7 | 3 | 19.8 | 19.8 | 19.8 | 7.4 |
| rpc request_business_access | 5 | 17.1 | 23.2 | 23.2 | 23.2 | 18.4 |
| rpc identity_list_access_requests | 5 | 2.9 | 4.5 | 4.5 | 4.5 | 3.3 |
| rpc identity_review_access_request | 5 | 4.1 | 5.4 | 5.4 | 5.4 | 4.3 |
| rpc set_delivery_pricing | 1 | 5.3 | 5.3 | 5.3 | 5.3 | 5.3 |
| rpc set_business_service_hours | 14 | 4.3 | 6.2 | 6.2 | 6.2 | 4.7 |
| rpc upsert_delivery_zone | 2 | 3 | 4.7 | 4.7 | 4.7 | 3.9 |
| rpc set_service_enforcement | 4 | 3.2 | 123.3 | 123.3 | 123.3 | 58.9 |
| rpc set_business_fulfillment | 10 | 4.1 | 5.2 | 5.2 | 5.2 | 4.2 |
| rpc apply_commercial_catalog_batch | 8 | 6.8 | 21.1 | 21.1 | 21.1 | 8.7 |
| rpc set_commercial_product_publication | 11 | 4.4 | 11.4 | 11.4 | 11.4 | 5 |
| rpc open_qa_window | 2 | 3.8 | 4.1 | 4.1 | 4.1 | 4 |
| rpc upsert_current_customer_profile | 34 | 17.6 | 19.2 | 19.6 | 19.6 | 17.6 |
| rpc create_order_with_items | 372 | 59.6 | 713.2 | 789.2 | 800.1 | 162.2 |
| rpc cancel_order | 500 | 17.9 | 53.4 | 93 | 111 | 23.6 |
| rpc classify_order_as_qa | 504 | 3.6 | 7.2 | 10 | 21.8 | 4.1 |
| GET products | 232 | 42.8 | 198.4 | 215.4 | 219.1 | 68.7 |
| GET businesses | 1 | 2.1 | 2.1 | 2.1 | 2.1 | 2.1 |
| PATCH products | 11 | 2.5 | 2.8 | 2.8 | 2.8 | 2.5 |
| POST products | 4 | 2.2 | 2.4 | 2.4 | 2.4 | 2.2 |
| DELETE products | 2 | 2.1 | 2.3 | 2.3 | 2.3 | 2.2 |
| rpc apply_inventory_movement | 17 | 4.6 | 10.9 | 10.9 | 10.9 | 4.8 |
| rpc upsert_current_customer_address | 12 | 5.5 | 7.9 | 7.9 | 7.9 | 5.1 |
| rpc complete_scanned_product | 2 | 8.5 | 9 | 9 | 9 | 8.8 |
| rpc get_public_order_tracking | 234 | 23.4 | 94.3 | 101.9 | 103.3 | 41.3 |
| GET orders | 447 | 490.6 | 3643.8 | 4438.1 | 4478.3 | 1014.3 |
| rpc list_operational_pipeline | 1 | 3.3 | 3.3 | 3.3 | 3.3 | 3.3 |
| rpc set_delivery_zone_active | 6 | 3.2 | 4.4 | 4.4 | 4.4 | 3.6 |
| rpc commerce_availability | 19 | 4.5 | 7.9 | 7.9 | 7.9 | 4.7 |
| PATCH businesses | 6 | 3.6 | 105.3 | 105.3 | 105.3 | 23.2 |
| rpc get_business_service_status | 46 | 3.6 | 7.4 | 8.7 | 8.7 | 4 |
| rpc set_business_service_exception | 3 | 3.7 | 4.1 | 4.1 | 4.1 | 3.6 |
| rpc delete_business_service_exception | 3 | 3 | 3.5 | 3.5 | 3.5 | 3.1 |
| rpc set_business_open_state | 6 | 2.9 | 4.5 | 4.5 | 4.5 | 3.1 |
| rpc acknowledge_order | 5 | 3.1 | 5 | 5 | 5 | 3.6 |
| rpc transition_order | 36 | 5.8 | 7.5 | 8.8 | 8.8 | 5.5 |
| rpc offer_order_to_rider | 9 | 4.5 | 6.1 | 6.1 | 6.1 | 4.7 |
| rpc accept_rider_order_offer | 8 | 5.9 | 10.2 | 10.2 | 10.2 | 7.1 |
| rpc mark_delivery_picked_up | 6 | 3.5 | 7.3 | 7.3 | 7.3 | 5.2 |
| rpc start_rider_delivery | 5 | 5.9 | 7.2 | 7.2 | 7.2 | 5.2 |
| rpc mark_rider_arrived | 6 | 3.9 | 7.5 | 7.5 | 7.5 | 5.3 |
| rpc issue_order_delivery_code | 9 | 2.8 | 3.6 | 3.6 | 3.6 | 2.9 |
| rpc confirm_delivery_code | 10 | 5.2 | 67.4 | 67.4 | 67.4 | 34.1 |
| rpc get_rider_delivery_board | 10 | 4.3 | 5.7 | 5.7 | 5.7 | 4.5 |
| rpc set_rider_availability | 6 | 4.2 | 6.1 | 6.1 | 6.1 | 4.3 |
| rpc heartbeat_rider_availability | 17 | 18.3 | 31.8 | 31.8 | 31.8 | 15.6 |
| rpc list_business_rider_availability | 1 | 3.1 | 3.1 | 3.1 | 3.1 | 3.1 |
| rpc publish_rider_location_fanout | 2 | 5.9 | 6.1 | 6.1 | 6.1 | 6 |
| rpc confirm_manual_order_payment | 5 | 4.4 | 4.7 | 4.7 | 4.7 | 3.6 |
| rpc reverse_manual_order_payment | 3 | 5 | 5.3 | 5.3 | 5.3 | 5.1 |
| rpc cancel_own_order | 19 | 3 | 16.8 | 16.8 | 16.8 | 4.1 |
| rpc create_checkout_session | 245 | 76.7 | 639.7 | 1113.4 | 1280.8 | 167.8 |
| rpc prepare_mercadopago_preference_v2 | 220 | 30.5 | 502.6 | 725.2 | 901.8 | 120 |
| rpc get_mercadopago_payment_authority_v2 | 220 | 39.8 | 404.6 | 712.3 | 716 | 103.3 |
| rpc record_mercadopago_preference_created_v2 | 220 | 53 | 330.5 | 669.9 | 807.3 | 101 |
| rpc record_mercadopago_payment_snapshot | 224 | 23.9 | 277.4 | 549.2 | 679.8 | 73.9 |
| rpc finalize_paid_checkout_session | 221 | 38.1 | 244.7 | 494.3 | 576.7 | 74.8 |
| rpc prepare_payment_refund_v2 | 224 | 5.1 | 10.3 | 48.1 | 48.3 | 6.6 |
| rpc record_payment_refund_identity | 220 | 4.3 | 8.6 | 40.6 | 41.3 | 5.4 |
| rpc record_payment_refund_response_v2 | 220 | 6.1 | 10 | 12.4 | 13.1 | 6.3 |
| rpc reject_rider_order_offer | 3 | 4.2 | 5.6 | 5.6 | 5.6 | 4.7 |
| rpc withdraw_rider_order_offer | 2 | 2.8 | 3.4 | 3.4 | 3.4 | 3.1 |
| rpc confirm_business_delivery_code | 6 | 3.6 | 64.9 | 64.9 | 64.9 | 33.5 |
| rpc set_business_address | 1 | 3.5 | 3.5 | 3.5 | 3.5 | 3.5 |
| GET order_items | 13 | 2.5 | 2.7 | 2.7 | 2.7 | 2.5 |
| GET order_events | 2 | 2.3 | 11.5 | 11.5 | 11.5 | 6.9 |
| GET inventory_movements | 12 | 2.4 | 2.9 | 2.9 | 2.9 | 2.4 |
| GET business_members | 2 | 2.4 | 2.4 | 2.4 | 2.4 | 2.4 |
| GET customer_addresses | 12 | 1.9 | 2.2 | 2.2 | 2.2 | 1.9 |
| GET customers | 1 | 2 | 2 | 2 | 2 | 2 |
| rpc get_order_trace | 36 | 11.4 | 22.5 | 22.7 | 22.7 | 11.3 |
| rpc revoke_public_tracking | 4 | 2.5 | 3.1 | 3.1 | 3.1 | 2.6 |
| rpc recover_order_tracking_access | 2 | 2.7 | 61.8 | 61.8 | 61.8 | 32.3 |
| GET /rest/v1/orders | 1 | 2.7 | 2.7 | 2.7 | 2.7 | 2.7 |
| POST /rest/v1/rpc/get_public_order_tracking | 1 | 1.9 | 1.9 | 1.9 | 1.9 | 1.9 |
| rpc identity_set_member_active | 1 | 6.7 | 6.7 | 6.7 | 6.7 | 6.7 |
| GET payment_intents | 10 | 1.8 | 2.2 | 2.2 | 2.2 | 1.9 |
| GET payment_refunds | 10 | 2.1 | 2.4 | 2.4 | 2.4 | 2.1 |
| GET order_public_tokens | 10 | 1.7 | 1.9 | 1.9 | 1.9 | 1.8 |
| GET pos_sales | 10 | 2 | 2.2 | 2.2 | 2.2 | 2 |
| POST orders | 1 | 2.1 | 2.1 | 2.1 | 2.1 | 2.1 |
| DELETE order_items | 1 | 1.8 | 1.8 | 1.8 | 1.8 | 1.8 |
| PATCH orders | 7 | 2 | 2.2 | 2.2 | 2.2 | 2.1 |
| DELETE orders | 1 | 1.8 | 1.8 | 1.8 | 1.8 | 1.8 |
| POST order_items | 1 | 2 | 2 | 2 | 2 | 2 |
| PATCH customer_addresses | 1 | 2.1 | 2.1 | 2.1 | 2.1 | 2.1 |
| DELETE inventory_movements | 1 | 1.7 | 1.7 | 1.7 | 1.7 | 1.7 |
| POST inventory_movements | 1 | 2.4 | 2.4 | 2.4 | 2.4 | 2.4 |
| PATCH payment_intents | 1 | 2.2 | 2.2 | 2.2 | 2.2 | 2.2 |
| POST payment_refunds | 1 | 2.2 | 2.2 | 2.2 | 2.2 | 2.2 |
| rpc mp_record_seller_webhook | 1 | 4.9 | 4.9 | 4.9 | 4.9 | 4.9 |
| rpc get_ecommerce_health | 6 | 2.1 | 14 | 14 | 14 | 7.8 |
| rpc sweep_expired_checkout_sessions | 2 | 4.7 | 7.2 | 7.2 | 7.2 | 6 |
| rpc refresh_operational_alerts | 3 | 15.4 | 15.7 | 15.7 | 15.7 | 15.2 |
| edge catalog-image-manager | 1 | 1529.8 | 1529.8 | 1529.8 | 1529.8 | 1529.8 |
| edge fiscal-artifact-access | 1 | 505.3 | 505.3 | 505.3 | 505.3 | 505.3 |
| edge mercadopago-cancel-payment | 1 | 149.8 | 149.8 | 149.8 | 149.8 | 149.8 |
| edge mercadopago-checkout-status | 1 | 139.5 | 139.5 | 139.5 | 139.5 | 139.5 |
| edge mercadopago-connect | 1 | 148.2 | 148.2 | 148.2 | 148.2 | 148.2 |
| edge mercadopago-create-checkout-session | 3 | 47.2 | 60.3 | 60.3 | 60.3 | 41.7 |
| edge mercadopago-create-preference | 1 | 138.6 | 138.6 | 138.6 | 138.6 | 138.6 |
| edge mercadopago-oauth-callback | 1 | 144.5 | 144.5 | 144.5 | 144.5 | 144.5 |
| edge mercadopago-payment-worker | 1 | 140.5 | 140.5 | 140.5 | 140.5 | 140.5 |
| edge mercadopago-refund | 1 | 141.4 | 141.4 | 141.4 | 141.4 | 141.4 |
| edge mercadopago-webhook | 2 | 4.3 | 467.6 | 467.6 | 467.6 | 236 |
| edge print-agent-gateway | 1 | 140.9 | 140.9 | 140.9 | 140.9 | 140.9 |
| edge team-invitation | 1 | 229.1 | 229.1 | 229.1 | 229.1 | 229.1 |
| rpc close_qa_window | 2 | 3.5 | 3.9 | 3.9 | 3.9 | 3.7 |
| rpc identity_close_own_session | 6 | 4 | 4.2 | 4.2 | 4.2 | 4 |

## Rendimiento medido (ms) — compuerta: MEASURED_NO_GATE

| Operación | Paso | n | ok | errores | p50 | p95 | p99 | máx | req/s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| catalog_read | baseline | 30 | 30 | 0 | 5.8 | 17 | 18.4 | 18.4 | 128.3 |
| order_creation_cash | baseline | 30 | 30 | 0 | 25.4 | 49.3 | 50.5 | 50.5 | 30.1 |
| order_query | baseline | 30 | 30 | 0 | 21.5 | 23.1 | 23.2 | 23.2 | 45.8 |
| tracking_query | baseline | 30 | 30 | 0 | 2.3 | 3.8 | 3.8 | 3.8 | 372.5 |
| panel_query | baseline | 30 | 30 | 0 | 13.8 | 17.6 | 18.3 | 18.3 | 69.9 |
| checkout_creation | baseline | 30 | 30 | 0 | 8.4 | 21.7 | 25 | 25 | 18 |
| payment_intent | baseline | 30 | 30 | 0 | 3.7 | 7.5 | 8.5 | 8.5 | 18 |
| stock_commit_paid | baseline | 30 | 30 | 0 | 7.9 | 26.4 | 43.8 | 43.8 | 18 |
| catalog_read | c10 | 40 | 40 | 0 | 18.2 | 33.6 | 37.4 | 37.4 | 471.1 |
| order_creation_cash | c10 | 40 | 40 | 0 | 50.7 | 186.6 | 247.8 | 247.8 | 136.6 |
| order_query | c10 | 40 | 40 | 0 | 132.5 | 153.5 | 156 | 156 | 76.8 |
| tracking_query | c10 | 40 | 40 | 0 | 8.8 | 12.9 | 13.3 | 13.3 | 1092.1 |
| panel_query | c10 | 40 | 40 | 0 | 148 | 226.9 | 259.4 | 259.4 | 62.1 |
| checkout_creation | c10 | 40 | 40 | 0 | 38.1 | 88.3 | 130.1 | 130.1 | 64.6 |
| payment_intent | c10 | 40 | 40 | 0 | 9.6 | 17.1 | 23.1 | 23.1 | 64.6 |
| stock_commit_paid | c10 | 40 | 40 | 0 | 25.5 | 63.5 | 72.9 | 72.9 | 64.6 |
| catalog_read | c30 | 40 | 40 | 0 | 39.7 | 85.3 | 86.5 | 86.5 | 444.7 |
| order_creation_cash | c30 | 40 | 40 | 0 | 114.3 | 214.7 | 222.4 | 222.4 | 176.5 |
| order_query | c30 | 40 | 40 | 0 | 398.7 | 688.5 | 714.9 | 714.9 | 54.4 |
| tracking_query | c30 | 40 | 40 | 0 | 22.7 | 26.6 | 27 | 27 | 1102.4 |
| panel_query | c30 | 40 | 40 | 0 | 581.9 | 981.6 | 1061.5 | 1061.5 | 37.7 |
| checkout_creation | c30 | 40 | 40 | 0 | 85.1 | 197.2 | 251 | 251 | 64.3 |
| payment_intent | c30 | 40 | 40 | 0 | 63 | 119.8 | 142.1 | 142.1 | 64.3 |
| stock_commit_paid | c30 | 40 | 40 | 0 | 42.8 | 125 | 239.9 | 239.9 | 64.3 |
| catalog_read | c100 | 100 | 100 | 0 | 126.2 | 213.2 | 216.6 | 219.1 | 439.8 |
| order_creation_cash | c100 | 100 | 100 | 0 | 493.6 | 781 | 795.3 | 800.1 | 122.7 |
| order_query | c100 | 100 | 100 | 0 | 1507.4 | 2775.4 | 2814.4 | 2831.1 | 35.2 |
| tracking_query | c100 | 100 | 100 | 0 | 86.5 | 98 | 102.3 | 103.3 | 948.6 |
| panel_query | c100 | 100 | 100 | 0 | 2489.1 | 4374.4 | 4471.2 | 4478.3 | 22.3 |
| checkout_creation | c100 | 100 | 100 | 0 | 284.6 | 780.3 | 1232.3 | 1280.8 | 63.7 |
| payment_intent | c100 | 100 | 100 | 0 | 158.7 | 579.5 | 795.5 | 901.8 | 63.7 |
| stock_commit_paid | c100 | 100 | 100 | 0 | 96.6 | 308.7 | 562.7 | 576.7 | 63.7 |

## Notas del tenant

- DISTANCE_CAP_NOT_EXERCISED: no existe un camino (RPC o tabla expuesta) para que service_role escriba private.rider_map_business_locations; set_delivery_pricing rechaza un tope de distancia sin punto verificado.

## Lo que queda en el stack (hasta que se apaga) a propósito

- businesses row of the QA tenant «TABA_ECOMMERCE_STACK_20261003_131208» (closed, ordering disabled, qa_fixture) with its hours, zones and fixture products
- businesses row of the second business «TABA_ECOMMERCE_STACK_20261003_131208_B» (closed, ordering disabled, qa_fixture): its order retains it
- persistent identities of the tenant (109: operators, paying customers, the owner of the second business), suspended and with the password discarded: command receipts, config audit, inventory movements, rider offers and checkout sessions reference them with ON DELETE RESTRICT
- orders of the tenant (origin=qa, terminal) with order_items / order_events / order_public_tokens / order_delivery_handoffs: append-only audit
- inventory_movements of the tenant (manual_adjustment qa_ecom_cert_reset): append-only ledger
- business_command_receipts, business_config_audit, rider_delivery_operations, delivery_confirmation_attempts, identity_sessions (revoked) and identity_audit_events of the tenant
- notification_outbox rows of the tenant: processed and suppressed when the order is classified QA
- checkout_sessions, payment_intents, payment_attempts, payment_events and payment_refunds of the tenant (all refunded or never charged; provider ids are invented, no provider was called)
- business_payment_settings (disabled) and mp_seller_connections (disconnected, no credentials) of the tenant

## Evidencia

`checks.json`, `summary.json`, `performance.json`, `non-2xx-answers.json`, `created-resources.json`, `service-role-uses.json`, `environment.json`, `tenant.json`, `cleanup-result.json` y un `phase-<id>.json` por fase.
