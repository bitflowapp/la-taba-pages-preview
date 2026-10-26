# R-MKT-1 con un segundo vendedor de prueba: procedimiento listo para ejecutar — 26/10/2026

Estado: **preparado, no ejecutado**. Falta una sola autorización del titular (§1). Todo ocurre en el QA alojado
(`ixewllzzuzpqrkxzmfzx`, `environment: test`), con usuarios de prueba y dinero ficticio. Sin producción, sin la cuenta de
Walter, sin aplicaciones nuevas. Complementa [`MARKETPLACE-SEGUNDO-VENDEDOR.md`](../commercial-readiness-20261023/MARKETPLACE-SEGUNDO-VENDEDOR.md).

## 0. Qué se quiere demostrar

Topología de producción en pequeño: integradora (TestApp `4861627125869370`, dueño = usuario de prueba `3594962708`) ≠
vendedor B (usuario de prueba nuevo) ≠ comprador de prueba. Mercado Pago marca la preferencia `marketplace:
MP-MKT-4861627125869370`, el `user_id` del aviso puede ser el dueño de la integradora (R-MKT-1) y el pago tiene que
acreditarse igual **al comercio B**, sin tocar pedidos, stock ni intentos de pago del comercio A.

## 1. La única autorización pendiente (del titular)

**Autorizar el plugin oficial de Mercado Pago con la cuenta que creó los usuarios de prueba `3594962708` y `3594962710`**
(no la de Walter). Claude regenera el enlace en el momento (el anterior caducó: está atado a un `state` de una sola sesión).

- Alcance real de la autorización: `read write offline_access` sobre **esa cuenta**; el plugin no se puede limitar a
  pruebas, la restricción la fija este procedimiento.
- Herramientas que se usan: `create_test_user` (una vez, `seller`, `MLA`) y lecturas de pagos de prueba
  (`search_payments`, `get_payment`, `notifications_history`).
- Herramientas que **no** se usan: `get_credentials`, `create_application`, `save_webhook`, `add_money_test_user` (el
  comprador de QA ya existe), y nada de producción.
- Efecto irreversible: una cuenta de prueba nueva (límite 15, no se borran).
- Alternativa sin plugin: crear el vendedor B a mano en TestApp → *Cuentas de prueba* (misma consecuencia).

## 2. Pasos

| # | Quién | Comando / acción | Resultado esperado |
|---|---|---|---|
| 0 | Claude | `node scripts/recovery/qa-mp-marketplace.mjs preflight` | sin `blockers`; `seller_b: false` hasta el paso 1 |
| 1 | Claude (tras §1) | `create_test_user` (`seller`, `MLA`, descripción «R-MKT-1 vendedor B»); guardar `id`, `nickname`, `password`, `siteId`, `profile` con `guardarSecreto('RECOVERY MP TEST SELLER B', …)` (Credential Manager; nunca en archivos ni en el chat) | `preflight --seller <id B>`: `differs_from_integrator_owner: true`, `differs_from_seller_a: true` |
| 2 | Claude | `node scripts/recovery/qa-mp-marketplace.mjs snapshot --out <archivo nuevo>` | línea base: pedidos, intentos y stock de A y B |
| 3 | **Persona** (ventana aislada, usuario de prueba B) | `node scripts/recovery/qa-mp-e2e.mjs connect-url --tenant b` y consentir; luego `… verify --tenant b` | `integrator_environment_matches: true`; comercio B `connected` con vendedor B |
| 4 | Claude | `qa-mp-e2e.mjs window-open --tenant b` | comercio B abierto sólo para la ventana |
| 5 | **Persona** (comprador de prueba) | `qa-mp-e2e.mjs checkout --tenant b --sku QA-MKT-001 --scenario APRO` y pagar con la tarjeta APRO oficial | pago aprobado de ARS 100 |
| 6 | Claude | `qa-mp-e2e.mjs worker` (dos pasadas); `qa-mp-e2e.mjs inspect --session <id>` | pedido único en B |
| 7 | Claude | `node scripts/recovery/qa-mp-marketplace.mjs verify --session <id> --seller <id B> --baseline <archivo del paso 2>` | `all_pass: true` (criterios en §3) |
| 8 | **Persona** (sesión del vendedor B) | «Devolver dinero» en la actividad de B; luego Claude concilia | devolución `external` en B; A sin movimientos |
| 9 | Claude | `qa-mp-e2e.mjs window-close --tenant b`; guardar el JSON de `verify` en `evidencia/rmkt1-<fecha>.json` y completar `QA-REAL` | comercio B vuelve a `closed` |

## 3. Criterios (`verify`)

Pasa si **todos** son verdaderos:

| Criterio | Qué demuestra |
|---|---|
| `preference_is_marketplace`, `preference_client_is_testapp`, `preference_collector_is_seller_b` | integrador ≠ vendedor de verdad; el cobrador es B |
| `payment_collector_is_seller_b`, `payment_approved` | el dinero entra a B |
| `webhook_valid_and_routed_to_b` | **R-MKT-1**: aviso firmado, ruteado al comercio B aunque el `user_id` sea el dueño de la integradora |
| `seller_a_cannot_search_it`, `seller_a_cannot_read_it` | **R-MKT-3**: el token de A no ve el pago de B |
| `order_in_b_only` | el pedido está en B y no en A |
| `tenant_a_unchanged` (con línea base) | pedidos, intentos de pago y stock de A, idénticos |
| `tenant_b_one_order`, `tenant_b_one_intent`, `tenant_b_stock_down_by_purchase` | exactamente un pedido, un intento y stock descontado sólo en B |

**Se aborta y se informa** (sin reintentar a ciegas) si: el consentimiento devuelve `integrator_account` o
`seller_in_use`; Mercado Pago responde 2034 (se mezcló una cuenta real); el webhook responde 503 (el barrido de verdad
del proveedor igual crea el pedido, pero R-MKT-1 queda **no cerrada** y se corrige la ruta antes de abrir ventas).

## 4. Lo ya demostrado sin Mercado Pago (se ejecutó el 26/10 y no hace falta repetirlo)

| Qué | Dónde | Resultado |
|---|---|---|
| Pago cobrado por el vendedor de A entregado al checkout de B → `collector_mismatch`: intención en revisión de seguridad, ni pedido ni cierre, stock de A intacto | `tests/db/marketplace-isolation.test.mjs` (Postgres local, funciones SQL reales) | ✅ |
| Pago legítimo de B → un pedido, sólo en B; stock de B −1 y el de A intacto | ídem | ✅ |
| Devolución: el dueño de A contra el pago de B → `42501` y ninguna fila; el dueño de B → permitido | ídem | ✅ |
| Con el rol `authenticated` y RLS, el dueño de A no ve pedidos, intentos, checkouts, devoluciones ni reservas de B; el listado de pagos del Panel de B le devuelve 0 filas (y a B, las suyas) | ídem | ✅ |
| Ruteo del webhook sin confiar en el cuerpo (pista de otro vendedor, dueño de la integradora, sin pista) | 13 pruebas Deno de ruteo + 8 del receptor | ✅ |
| Aviso de B con la pista del vendedor A: el token de A recibe 404, el recibo y el pedido son de B | banco `isolation` (CI) | ✅ |
| Mutación: si el cobrador coincidiera, fallan las pruebas de acreditación | ídem | ✅ |

`TABA_PG_BIN=<carpeta con psql> TABA_LOCAL_DB=taba_local_base node --test tests/db/marketplace-isolation.test.mjs`
(clúster descartable de `scripts/local-db`; la prueba termina siempre en rollback).
