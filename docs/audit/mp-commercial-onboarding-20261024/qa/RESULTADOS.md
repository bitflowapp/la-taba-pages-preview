# Resultados medidos (24/10/2026)

## Local

| Suite | Resultado |
|---|---|
| `npm test` (Node) | 3196 / 3196 |
| `npm run test:webhook` (Deno) | 54 + 243 + 12, sin fallas (la base `7d473aa3` daba 54 + 238 + 12: +5 regresiones) |
| `npm run check` (sintaxis, higiene, identidad, codificación, escáner de secretos) | PASS |
| E2E `business-windows-operations.spec.mjs -g "Mercado Pago OAuth"` | 2 / 2 |
| pgTAP en PostgreSQL local descartable (`taba_local_mpc_release`, todas las migraciones) | `mercadopago_release_unused_seller` 14/14 · `mercadopago_clean_business` 15/15 · `mercadopago_seller_oauth` 15/15 · `mercadopago_safe_disconnect` 18/18 |
| pgTAP canónico completo | 960 planificadas (946 + 14). El shim local no implementa `has_table`, `bag_eq`, `function_privs_are`, etc.; esas suites (y dos que fallan igual en la base `7d473aa3`) sólo se validan en CI |
| `node scripts/production/rehearse-mp-onboarding.mjs` | 2 / 2: el binding de un ref ficticio vincula un comercio sin la llave final y rechaza la cuenta de La Taba |

## Mutaciones (sobre copias, nunca sobre el árbol)

| Mutación | Fallas que la detectan |
|---|---|
| Quitar del callback la guarda de la cuenta de La Taba y el mapeo `23505` + quitar `seller_is_integrator` de la verificación | 3 pruebas Deno |
| Quitar de `mp_release_unused_seller_binding` el control de historial de pagos | 2 aserciones pgTAP (6 y 14) |

## QA alojado (`ixewllzzuzpqrkxzmfzx`, dinero ficticio)

| Paso | Evidencia | Resultado |
|---|---|---|
| Migración `20261024120000` (libro 173 → 174, SHA `eebf8e5f…`) | `despliegue-qa.jsonl` | aplicada; los 5 jobs que estaban activos se reactivaron (`taba-security-retention-sweep` ya estaba apagado y quedó así) |
| Privilegios de la función nueva | `despliegue-qa.jsonl` | anon ✗ · authenticated ✗ · service_role ✓ · SECURITY INVOKER |
| 8 funciones de Mercado Pago desplegadas | `despliegue-qa.jsonl` | ACTIVE (cancel 14, connect 15, checkout-session 11, preference 14, callback 14, worker 15, refund 14, webhook 17) |
| Compuertas sin autenticación | `verify-functions-gates.jsonl` | PASS |
| 6 webhooks falsificados | `forged-webhooks.json` | 6 / 6 rechazados (401) |
| Verificación real del comercio A | `verify-tenant-a.json` | identidad, permisos e integradora OK; `seller_is_integrator: false`; `payments_not_enabled` |
| **OAuth real**: comercio B pide el enlace; el vendedor de prueba que ya cobra para A consiente en Mercado Pago | `01-tenant-b-seller-in-use.json` | callback 303 → `seller_in_use` |
| Estado después | `02-…`, `03-…` | B sin vínculo; A conectado con el mismo vendedor desde el 23/10, verificado |

El sitio de QA no se republicó (la sesión de UX lo comparte): el panel nuevo está probado en Node y E2E local.

## No ejecutado

Pago marketplace con integrador ≠ vendedor (R-MKT-1, necesita G1), segundo vendedor de prueba, reembolso por API,
disputas, todo lo de producción.
