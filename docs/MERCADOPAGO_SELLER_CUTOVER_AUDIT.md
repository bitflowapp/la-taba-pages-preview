# Seller cutover: auditoría de clasificación, 2026-09-05

Este documento conserva la auditoría histórica. La decisión posterior es preservar este negocio y autorizar Walter sobre un negocio nuevo: [estado del onboarding limpio](MERCADOPAGO_WALTER_CLEAN_BUSINESS.md). No se reinterpreta ninguna clasificación de esta auditoría.

**Cutover detenido por la regla explícita de la fase 1: hay registros UNKNOWN.** No se cambiaron conexiones, configuración remota, funciones, negocio ni historial. No se ejecutó una migración ni se preparó otro negocio para eludir esta condición.

## Universo y evidencia

Proyecto verificado: `ukxqbgswjlibmnjemrzd`. Negocio único: `00000000-0000-4000-8000-000000000001`, `La Taba`, creado en staging el 2026-07-30. El UUID proviene del seed de `20260531030000_la_taba_phase1_orders.sql`; sin embargo el negocio actual tiene uso mixto: 68 pedidos clasificados QA y 56 con origen `production`. No se concluye que sea un fixture puramente de pruebas a partir de su UUID o nombre. `origin=production` en un pedido tampoco prueba una transacción monetaria real.

Se leyeron los 94 intents y sus 184 eventos. Todos tienen `environment=test`, pero ese campo solo no basta para certificar ausencia de dinero real. Desglose de snapshots locales:

| Registros | Estado | live_mode | payment_id |
| --- | --- | --- | --- |
| 59 | expired | false | ausente |
| 10 | cancelled | false | ausente |
| 21 | completed / approved | true | numérico |
| 4 | completed / approved | false | identificador de simulación |

La API oficial autenticada con la credencial de pruebas obtenida por MCP confirmó `/users/me`: collector `3594962708`, sitio MLA y etiqueta `test_user`. El token es de tipo **APP_USR de usuario automático de prueba**, no TEST-. Su valor no se mostró ni guardó. No se puede reconstruir por cada intent el token concreto usado históricamente: el esquema no guarda esa asociación.

Se consultaron los 21 payment IDs numéricos, las 71 preferences y la búsqueda de pagos por cada una de las 94 referencias. Todos los pagos recuperados tienen ese collector de prueba. Se encontraron **22 pagos approved**: los 21 conocidos y el pago `171490389029`, por 1000 ARS, asociado por external_reference al intent `25957615-49f3-4b5b-904a-2e91e6bce47d`, que TABA conserva como expired y sin payment_id. No se corrigió automáticamente esa discrepancia.

Los pagos del proveedor pueden informar `live_mode=true`, `money_release_status=released` e importe neto aun perteneciendo al collector `test_user`. Esos campos no se presentaron como liquidación bancaria real. La [documentación oficial de cuentas de prueba](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/test/accounts) describe fondos ficticios para esas cuentas. No se ha confirmado ninguna transacción productiva real; tampoco se afirma que todo el universo esté libre de incertidumbre.

## Clasificación conservadora por intento

| Clasificación | Cantidad | Evidencia |
| --- | --- | --- |
| TEST | 53 | Recurso payment/preference recuperado y referencia coincidente, con collector autenticado test_user |
| TEST | 19 | Intent local test sin preference, payment ni importe pagado; búsqueda del proveedor sin pagos |
| TEST | 1 | Snapshot test/no-live y clasificación persistente QA/qa_fixture_product, sin recurso de pago del proveedor |
| UNKNOWN | 18 | Preference devuelve 404; no hay payment ni merchant order recuperable que confirme el collector histórico |
| UNKNOWN | 3 | ID no numérico de simulación, snapshot test/no-live, pero pedido marcado production sin evidencia de auditoría que resuelva esa discrepancia |
| PRODUCTION confirmado | 0 | No se encontró evidencia suficiente para afirmar pagos reales |

**Total: 73 TEST, 0 PRODUCTION confirmado, 21 UNKNOWN.** UNKNOWN no significa dinero real; significa que no se satisface la evidencia exigida para autorizar el cutover. No se usó el prefijo del preference_id ni un nombre de usuario como prueba de identidad.

De 71 preferences, 49 respondieron 200 y 22 respondieron 404. Cuatro de esas 22 tienen pago recuperable que permitió clasificarlas TEST; las otras 18 no. Las búsquedas de merchant orders para las 22 referencias respondieron 200 sin resultados. La consulta inicial con limit=100 fue rechazada porque el máximo es 50; se corrigió a 50. No se contabilizó el HTTP 400 como ausencia de órdenes.

Las tres simulaciones ambiguas son los intents `5321237c-bd47-4510-9810-accd7162b685`, `cd7e78d1-44b8-4799-8ccd-1244d530f429` y `9e26c322-a412-47f6-9cfa-46e7ceeeea13`. Tienen eventos de creación y finalización del pedido, pero no un evento que certifique su procedencia sintética. No se reinterpretó ni sobrescribió su auditoría.

## Causa exacta de la guarda

`supabase/migrations/20260905063914_mercadopago_seller_oauth.sql`, función `mp_finish_oauth`, líneas 70–72: si `business_payment_settings.collector_id` difiere del seller recibido y existe cualquier `payment_intents` del negocio, lanza `seller_change_requires_migration`. La condición no filtra el entorno de esos intents ni distingue al seller activo productivo del seller histórico de pruebas.

El callback obtiene el seller de Mercado Pago y llama a ese RPC; los tokens solo se guardan después de pasar la guarda. `mp_seller_connections` sí tiene clave `(business_id, environment)`, mientras la configuración operativa es única por `(business_id, provider)`. `payment_intents` conserva `environment` y referencias del proveedor, pero no una columna de seller histórico o FK a la conexión originaria. Por ello relajar únicamente el WHERE no resuelve la trazabilidad ni garantiza que la lectura de pagos antiguos utilice su conexión original.

La protección sigue habilitada. La solución futura debe separar conexión productiva y vínculo histórico verificado; las identidades UNKNOWN deben mantenerse bloqueadas, sin inferirlas desde el collector actual. El negocio de Walter no se ha seleccionado ni creado bajo esta auditoría.

## Preservación y alcance de validación

Una segunda lectura de las mismas columnas de los 94 intents fue idéntica al snapshot inicial (SHA-256 `b62bd58c55bb70fdf7cf19b56ff7cdcb97b414851ad7f7c3a6cc05654a456d3d`). No hubo escrituras remotas. No se modificaron preference_id, payment_id, external_reference, entorno, estados ni montos.

Detalle completo por intent — clasificación, motivo, campos originales, importes, timestamps, collector verificado cuando corresponde y resultados del proveedor — en los archivos locales fuera de Git:

- `la-taba-mp-cutover-classification.csv`
- `la-taba-mp-cutover-classification.json`
- `la-taba-mp-cutover-audit.json`
- `la-taba-mp-cutover-provider.json`
- `la-taba-mp-cutover-orders.json`

Las pruebas anteriores siguen siendo 67 pagos + 53 webhook + 2 UI OAuth = **122/122 PASS**; no se presentan como pruebas de un cutover implementado. Las migraciones, nuevos casos de cutover, redeploy y simulación de seller B no se ejecutaron porque la fase 1 los bloquea. Staging permanece en https://taba2-staging.pages.dev.

Para levantar el bloqueo hacen falta evidencia histórica del proveedor para las 18 preferencias no recuperables y evidencia de la simulación que explique los tres pedidos inconsistentes. Se puede continuar con investigación de solo lectura. No corresponde pedir a Walter que autorice mientras este requisito explícito esté pendiente.
