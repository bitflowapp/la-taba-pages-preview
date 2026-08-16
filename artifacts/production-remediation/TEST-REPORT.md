# TABA2 · PRODUCTION BACKEND REMEDIATION · TEST REPORT

Destino de las pruebas: **base local aislada, reconstruida desde cero**.
Nunca contra staging. Contra produccion, solo lectura.

## Stack shadow

Aislado a proposito, para no tocar ninguno de los 23 containers historicos
de la maquina:

| | |
|---|---|
| project_id | `taba2-prod-remediation-shadow` |
| puertos | API 55321 · DB 55322 · shadow 55320 |
| containers | `supabase_{db,kong,auth,rest,storage}_taba2-prod-remediation-shadow` |
| bootstrap | `supabase db reset --local` → **0 → 103 desde cero**, no "100 y despues parches" |

## Baseline sobre la migration 100

```
Files=20, Tests=332, Failed: 0
```

**332/332**, identico al baseline certificado por el provisioning.

Los 9 archivos `*.local.sql` / `*.remote.sql` del directorio de tests no son
pgTAP: son guiones de drill manual sin plan TAP. No forman parte de los 332 y su
"Parse errors: No plan found in TAP output" es preexistente, no una regresion.

## Control negativo (FASE 21)

El archivo nuevo `production_least_privilege_test.sql` corrido **contra la
migration 100**, es decir contra el estado que hay que remediar:

```
# Looks like you failed 15 tests of 44
Failed tests:  1-3, 15-16, 21, 27-34, 36
```

Las 15 que fallan son exactamente las condiciones remediadas:

| # | Contrato que todavia no se cumplia |
|---|---|
| 1-2 | `import_qa_fixture_catalog` / `publish_qa_fixture_product` existian |
| 3 | quedaban 2 funciones comentadas `STAGING ONLY` |
| 15-16 | `anon` y `authenticated` podian `TRUNCATE fiscal_profile_events` |
| 21 | `anon` conservaba `REFERENCES` sobre `fiscal_profile_events` |
| 27 | habia tablas con INSERT/UPDATE/DELETE/TRUNCATE para roles de cliente |
| 28-29 | los SECURITY DEFINER ejecutables por anon eran 18, no 8 |
| 30-34 | `anon` podia ejecutar las 5 RPC fiscales del Panel |
| 36 | las 5 funciones de trigger eran ejecutables por anon/authenticated |

Las otras 29 pasan ya en la 100: son las que fijan lo que **no** se puede
romper, y estaban verdes antes y despues.

## Suite completa sobre el shadow reconstruido 0 → 103

```
Files=12, Tests=376
All tests successful.
Result: PASS
```

**376/376.** 332 de baseline + 44 nuevas.

| Suite | Resultado |
|---|---|
| `production_least_privilege_test` (nueva) | 44/44 |
| `rider_multi_order_capacity_test` | PASS |
| `rider_multi_order_isolation_test` | PASS |
| `rider_multi_order_offer_test` | PASS |
| `rider_multi_order_security_test` (BOLA) | PASS |
| `back_office_role_isolation_test` | PASS |
| `business_timezone_windows_test` | PASS |
| `business_windows_scanner_fiscal_test` | PASS |
| `durable_offline_packing_test` | PASS |
| `fiscal_document_closure_test` | PASS |
| `production_operations_control_plane_test` | PASS |
| `public_tracking_gps_quality_test` | PASS |

La suite multi-pedido (FASE 43) sigue verde: offer, accept, reject, claim,
release y reassign no se vieron afectados por los cambios de grants.

## Roles usados (FASE 42)

Las pruebas preguntan por los roles **reales** con
`has_function_privilege` / `has_table_privilege` / `has_column_privilege` sobre
`anon` y `authenticated`, no desde `postgres`, que responderia que si a todo.
Las suites heredadas ademas simulan negocio/rider/staff con
`business_members` + `identity_sessions` y claims reales.

Ademas se probaron capacidades ejecutando de verdad como el rol:

- `set local role anon; truncate table public.fiscal_profile_events;` sobre una
  base con los grants exactos de produccion → **la tabla quedaba vacia**, con
  RLS activa y sin que anon pudiera leerla. Es la medicion que prueba que RLS no
  cubre TRUNCATE.
- `set local role anon; select public.assert_order_payment_modality();` →
  `trigger functions can only be called as triggers`.
- `set local role service_role; select ... import_qa_fixture_catalog(...)` →
  `Only an active owner/admin can import staging QA fixtures.`, que es lo que
  demuestra que ningun rol de servidor podia usar esas RPC.

## Verificacion contra produccion (FASE 29/30/31)

Solo lectura, via Management API. **No se creo ningun usuario, ni se escribio
ninguna fila.** Por eso no hizo falta transaccion + rollback: no hubo escritura
que revertir.

```
anon puede invocar la RPC de fixtures QA            = NO (la funcion no existe)
authenticated puede invocar la RPC de fixtures QA   = NO (la funcion no existe)
runtime normal puede crear UNAPPROVED_QA            = NO (no hay via de escritura)
SECURITY DEFINER ejecutables por anon               = 8, los 8 del contrato escrito
SECURITY DEFINER sin search_path                    = 0
tablas sin RLS                                      = 0 de 85
grants de escritura a anon/authenticated            = 0
vault accesible por anon/authenticated              = NO
CREATE sobre schema public para anon/authenticated  = denegado
```

## Limitacion honesta

El diff automatizado final shadow-vs-produccion **no llego a ejecutarse**: el
daemon de Docker de esta maquina quedo colgado por un error de E/S de disco en su
almacen de imagenes (`failed commit on ref ...: input/output error`, visto al
intentar `supabase db dump`), y despues de eso `docker info` deja de responder.

No afecta a produccion ni a las migraciones: es un fallo del entorno local,
posterior a que la suite completa corriera y pasara. La comparacion shadow ↔
produccion se documenta en `PRODUCTION-SECURITY-AFTER.md` con los valores
medidos en el shadow mientras estuvo vivo, que coinciden en todos los ejes
comparables.
