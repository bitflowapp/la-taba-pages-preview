# Contrato HTTP de los rechazos de la API e-commerce

Decisión del dueño: **el contrato HTTP se cierra del lado del servidor**. Una negativa de negocio
(SQLSTATE 55000) y un «no existe» (P0002) no contestan HTTP 500: un comercio cerrado, una dirección
fuera de zona, un producto que no está a la venta o la ventana de alcohol cerrada no son fallas internas
y ningún cliente las tiene que reintentar.

Versión legible por máquina: [`http-contract.json`](http-contract.json). Migración:
`20261002090000_api_boundary_answers_refusals_as_4xx`. Generador: `scripts/db/wrap-api-boundary.mjs`.

## La tabla

| SQLSTATE | HTTP | Qué significa | ¿Se reintenta? |
|---|---:|---|---|
| 22023 · 23502 · 23514 | 400 | entrada inválida o una regla que el pedido viola | no: corregir el pedido |
| 22007 | 400 | un texto que no es un instante (lo rechaza el tipo antes que la función) | no |
| 42501 | 401 | sin sesión | no: iniciar sesión |
| 42501 | 403 | con sesión, sin permiso | no |
| P0002 | **404** | no existe (o no es visible para quien llama: un pedido ajeno contesta igual que uno inexistente) | no |
| 23503 · 23505 | 409 | referencia inexistente o clave repetida | no |
| PT409 | 409 | conflicto de revisión: otro cambió el objeto | releer y decidir; no reenviar a ciegas |
| 55000 | **409** | rechazo por el estado actual, definitivo para ese pedido. El token de `details` (o el `message`) dice cuál: `BUSINESS_CLOSED`, `OUT_OF_DELIVERY_ZONE`, `ALCOHOL_WINDOW_CLOSED`, «producto no disponible», `ENFORCEMENT_LOCKED`, `OPENING_NOT_READY`, `ORDER_CLOSED`... | no |
| PT429 | 429 + `Retry-After` | frenado por el guardián de admisión | sí, después de `Retry-After` |
| 54000 | 429 | frenado del canal de checkout (lo recibe la Edge Function y contesta 429) | sí, después de `Retry-After` |
| cualquier otro, incluidos 40P01 y 57014 | 500 | falla interna: interbloqueo, tiempo agotado, error no previsto | **sí: es la única clase reintentable**, junto con una falla de red |

Reglas:

- **El cuerpo es el contrato y no cambió.** `code`, `message`, `details` y `hint` son los mismos que antes,
  letra por letra (medido por HTTP, abajo). Sólo cambió el estado. Un cliente decide qué mostrar por `code`
  y por el token de `details`; decide si reintenta por el estado.
- **422 no se usa**: el contrato existente de una violación de regla (23514) es 400 y no se cambia.
- **P0001 no debe llegar a un cliente.** Un `RAISE EXCEPTION` sin `errcode` sale como 400 · P0001, lo mismo
  que un dato mal escrito: es un defecto. Quedaban 46 en cinco funciones de cliente (el catálogo comercial,
  el alta por lote y el contacto de WhatsApp; `20261002051000` ya les había dado 42501 a sus negativas de
  permiso). `20261002091000_client_refusals_carry_their_sqlstate` les da el SQLSTATE de lo que significan
  (24 · 22023 entrada inválida, 3 · P0002 no existe, 19 · 55000 el producto no está en condiciones de
  publicarse), con el mismo mensaje. El pgTAP `http_error_contract_test.sql` impide que aparezca uno nuevo.

## Cómo funciona

PostgREST deja que una función elija estado y cuerpo: `raise sqlstate 'PGRST' using message = '<json con
code, message, details, hint>', detail = '<json con status y headers>'`. La conversión ocurre **sólo en la
frontera de la API**; adentro de la base nada cambia:

1. El cuerpo vigente de cada función elegida queda, letra por letra, como bloque anidado dentro de un
   bloque con **un** manejador para `55000` y `P0002` (marcador `la-taba:api-boundary v1`).
2. El manejador convierte **sólo si** la llamada entra por la API (`request.method` puesto por PostgREST)
   **y** la función es el marco PL/pgSQL más externo (el contexto tiene una sola línea; no se lee su texto,
   que está traducido).
3. En cualquier otro caso re-lanza el error original sin tocarlo.

Lo que ve cada llamador:

| Quién llama | Qué recibe |
|---|---|
| un cliente por PostgREST (navegador, Panel, app) | 409 / 404 con el cuerpo de siempre |
| una Edge Function por supabase-js con la clave de servicio | 409 / 404 con el cuerpo de siempre (las Edge Functions deciden por `code`, no por el estado) |
| una función PL/pgSQL que llama a otra y atrapa 55000 / P0002 | el original: la de adentro no es el marco más externo |
| SQL sin `request.method` (pgTAP, cron, migraciones, arneses) | el original, como antes |
| una función en lenguaje SQL que llama a una envuelta | si el planificador la expande (sin SECURITY DEFINER ni SET), 409 / 404; si no, 500 |

Costo: una subtransacción por llamada a una función envuelta. Medido en `create_order_with_items`
(atraviesa dos capas envueltas), 200 pedidos antes y después en la misma base local: p50 6,84 → 7,48 ms
(+0,64 ms), media +0,94 ms. Ninguna función envuelta se evalúa por fila en una política o una vista.

## Qué funciones

Una **entrada** es una función de `public`, no de trigger, que `anon`, `authenticated` o `service_role`
pueden ejecutar. Se envuelve toda entrada PL/pgSQL que puede llegar a un RAISE de 55000 o de P0002: en su
cuerpo (incluido `select ... into strict` y los nombres de condición), en una función que llama
(transitivamente, por nombre) o en un trigger de una tabla que escribe. Más el trigger
`guard_business_currency_code`, porque los clientes escriben `businesses` por PATCH directo.

Resultado sobre la rama (206 migraciones): **109 funciones** (68 que ejecuta un cliente, 40 sólo
`service_role`, el trigger). La lista está en la migración y la reproduce el generador.

### Excluidas por dueño (siguen contestando 500 para estos códigos)

| Grupo | Patrones | Por qué |
|---|---|---|
| Caja/POS | `pos_*`, `checkout_pos_sale`, `prepare_daily_reconciliation`, `close_daily_reconciliation`, `daily_reconciliation_snapshot_internal`, `identity_register_session` | otro equipo las redefine en ramas paralelas |
| Fiscal | `authorize_arca_homologation`, `authorize_fiscal_artifact_access`, `begin_fiscal_resend`, `claim_fiscal_*`, `complete_fiscal_*`, `fail_fiscal_artifact`, `get_order_fiscal_states`, `request_credit_note`, `request_full_credit_note`, `request_fiscal_*`, `request_order_invoice`, `reserve_fiscal_document_number`, `service_request_*` | contrato y tren de cambios propios |
| Agente de impresión | `agent_*`, `cancel_print_job`, `create_local_device_pairing`, `operator_*local_device*`, `get_local_print_status`, `request_order_print_job`, `request_print_job_reprint`, `resolve_print_job_review`, `revoke_local_device` | otro equipo las redefine en paralelo |
| Cobros heredados | `claim_payment_outbox`, `get_mercadopago_payment_authority`, `prepare_mercadopago_preference`, `prepare_payment_refund`, `record_mercadopago_preference_created`, `record_payment_refund_response` | el contrato A1-A4 las retira en CI: regenerarlas resucitaría un cuerpo retirado (retiradas contestan 55000 «retired; use V2» como 500) |

De esos grupos, 40 entradas llegan hoy a 55000 o P0002 (caja_pos 6, fiscal 17, impresión 12, heredados 5).

### Entradas en lenguaje SQL

Una función SQL no puede llevar el manejador. Las dos entradas SQL que llegan a estos códigos,
`mp_consume_oauth` y `mp_claim_refresh` (sólo `service_role`), tienen cláusulas SET: el planificador no las
expande y siguen contestando 500 si su función interna levanta 55000 / P0002. No se convirtieron a PL/pgSQL.

## Clientes

- Panel (`js/repositories/supabase-business-repository.js`, `classifyRpcError`): un 409 con `55000` cae en
  «definitivo, no reintentable» (`retryable: false`, el código queda como `55000`); antes, con 500, era
  `SERVER_UNAVAILABLE` reintentable. Un 404 con `P0002` sigue siendo `NOT_FOUND` (ya se clasificaba por
  código). Los dos armadores de resultado de la cola del Panel (`js/production-operations.js`) reintentan
  sólo con estado 0 o ≥ 500: con 409 la negativa queda definitiva. No se cambió código del cliente.
- Catálogo y contacto (`20261002091000`): el Panel llama esas RPC por `classifyRpcError`; 22023 cae en la
  misma rama que P0001 (definitivo, se muestra el mensaje), P0002 en `NOT_FOUND` y 55000 con 409 en
  definitivo; el mensaje es el mismo en los tres casos.
- Edge Functions: deciden por `code` (`_shared/checkout-refusal.ts` mapea 55000 + mensaje a su código
  público); ninguna mira el estado HTTP de una RPC.
- Certificador (`scripts/e2e-staging/ecommerce/http.mjs`, `REFUSAL_STATUS`): 55000 → 409, P0002 → 404.

## Mantenerlo

- Una migración que redefine una función envuelta tiene que conservar el envoltorio: correr
  `node scripts/db/wrap-api-boundary.mjs --database <base local con la migración nueva>`; reconoce lo ya
  envuelto por el marcador y envuelve lo que falte. Si no, el pgTAP `http_error_contract_test.sql` falla.
- Una función nueva que levanta 55000 o P0002 y que la API expone entra por la misma regla.
- Reversión: `docs/migrations/rollback/20261002090000_api_boundary_answers_refusals_as_4xx.rollback.sql`
  (devuelve los 109 cuerpos anteriores exactos; se niega si otra migración redefinió una función envuelta).
