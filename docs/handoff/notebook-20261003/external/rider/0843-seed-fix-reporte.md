# TABA2_RIDER_QA_ORDER_SEED_READY_FOR_CONTROLLED_RUN

Diagnóstico read-only y corrección. **Cero mutaciones nuevas en staging.**
2026-08-05 · agente PID 7116.

---

## 1. Seguridad de LT-0031

Apto para inspección, demostrado antes de leer nada suyo:

| Indicador | Resultado |
|---|---|
| `client_request_id` con marca de corrida QA | `RIDER_MAP_DEVICE_SMOKE_*` |
| `payment_method` sin cobro real | `qa_no_charge` |
| nombre de cliente con marca QA | sí |
| ciudad y provincia sintéticas | sí ("Ciudad QA" / "QA") |
| cliente marcado QA | sí |

No se copió ningún valor personal al fixture: LT-0031 se usó **sólo como
referencia estructural**. LT-0030 se consultó únicamente para confirmar que
sigue intacto: `arrived`, revisión 10.

## 2. Contrato real de la cola

De `20260802100000_rider_delivery_server_contracts.sql:231`.

Cuatro condiciones, más `rider_require_active_membership`:

1. `o.business_id = p_business_id`
2. `o.delivery_mode = 'delivery'`
3. `o.status = 'ready'`
4. `o.assigned_rider_user_id is null`

**Mi hipótesis principal queda refutada por el SQL.** El join a `order_items`
es un **`left join`**, y `item_count` es
`greatest(1, coalesce(sum(oi.quantity), 0)::integer)`: el caso sin líneas está
contemplado a propósito. Que los 31 pedidos tuvieran ítems era correlación.

Detalle completo: `qa-order-queue-contract.md`.

## 3. Comparación estructural

| Requisito | LT-0031 | `QA-SMOKE-c1daae11` | Resultado |
|---|---|---|---|
| `business_id` | sí | sí | ambos |
| `delivery_mode='delivery'` | sí | sí | ambos |
| `status='ready'` | no (hoy `cancelled`) | **sí** | el sembrado cumplía |
| `assigned_rider_user_id is null` | — | **sí** | cumplía |
| membership rider activa | — | sí | cumplía |
| `order_items >= 1` | 1 | **0** | **no es requisito** |

El pedido sembrado **era elegible**.

## 4. Causa primaria

**`C. RIDER_QUEUE_REFRESH_MISSING`**

La fase 1 leyó una cola cacheada:

- `durationMs=6517` y `launchApp()` ya duerme 6000 ms — la búsqueda ocurrió
  ~500 ms después, sin sincronizar;
- `launchApp()` usa `FLAG_ACTIVITY_CLEAR_TOP`, que **reanuda** la Activity; la
  app estaba abierta desde la verificación de precondiciones con la cola vacía;
- la fase nunca accionaba `Actualizar pedidos` ni el `RefreshIndicator`;
- desajuste de negocio descartado: `rider_require_active_membership` habría
  lanzado `42501` y la app mostró "Lista sincronizada", que sólo aparece tras
  una llamada autenticada exitosa.

No es A (probado por el `left join`), no es B (las cuatro condiciones se
cumplían), no es D (un solo defecto) y no es E (se demostró sin mutar).

## 5. Archivos modificados

| Archivo | Qué cambió |
|---|---|
| `RiderSmokePhaseTest.kt` | refresh real + tres clasificaciones distinguidas |
| `QaSmokePhase.kt` | `QA_ORDER_REFRESH_TIMEOUT`, `QA_ORDER_NOT_FOUND_AFTER_REFRESH`, `QA_ORDER_NOT_ELIGIBLE` |
| `SmokeBackend.ps1` | siembra con línea + rollback; postcondición de elegibilidad; cleanup cuenta líneas |
| `run-rider-staging-smoke-25.ps1` | postcondiciones antes de dejar entrar al smoke |
| `Test-SmokeGuards.ps1` | 14 pruebas nuevas |

## 6. Seed corregido

Order y línea son **una sola operación lógica**. PostgREST no da transacción
entre dos requests, así que si la línea falla el pedido se borra en el acto,
acotado al run-id: nunca queda un pedido sin líneas.

Postcondiciones exigidas antes de arrancar el smoke:
`order_count_for_run=1`, `order_item_count_for_run>=1`,
`queue_eligibility_contract=PASS`, `payment_count=0`,
`fiscal_document_count=0`.

Producto QA exclusivo, cliente y dirección sintéticos, `qa_no_charge`, cero
Mercado Pago, cero ARCA, cero comprobante. De LT-0031 no se copió ningún id
personal, dirección, cliente, nota ni código.

## 7. Refresh

La fase acciona `Actualizar pedidos` y espera a que **el control vuelva a estar
accionable** —queda deshabilitado mientras carga—, que es el fin observable de
la sincronización. El tope de tiempo sólo acota; no es el criterio. Sin polling
infinito. `openQaOrder` sincroniza también si el código no está, así que la
corrección beneficia a todas las fases.

## 8. Cleanup

Borra líneas antes del pedido, respetando la foreign key, y las cuenta.
Idempotente: pedido inexistente, sin líneas, con líneas, o fallo parcial. Nunca
borra por código visible: exige run-id, y aborta si el run-id resuelve a un
pedido protegido.

## 9. Pruebas

**Guards host: 46 verdes** (32 previas + 14 nuevas), exit 0. Sin staging, sin
red, sin dispositivo. Las nuevas cubren: order + línea válida, rechazo y
rollback si la línea no se crea, contrato de cola satisfecho y sus dos formas
de fallar, `payment_count=0`, `fiscal_document_count=0`, cleanup de líneas y
orden de borrado respecto de la FK.

`git diff --check`: sin errores. Secret scan sobre el diff: sin coincidencias.

## 10. Commit y HEAD

`366a0b5` — *fix(rider-smoke): seed queue-eligible QA orders*, 5 archivos,
+220/−22. Sin `git add .`, sin amend, **sin push**.

| | |
|---|---|
| app | `95294d9`, sin cambios, limpio |
| automatización | `366a0b5`, limpio |

## 11. Hashes

| | |
|---|---|
| target | `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` — sin tocar |
| androidTest anterior | `6c28a572eb0760a62682225695657fec9697d151de2990b392a9bb54cd5772ca` |
| androidTest **nuevo** | `ecd8bca303c0ed48414f55b10e7095677e01b6e4c1b551b0bedefbec16259800` |

**El nuevo NO está instalado en el Moto.** El dispositivo sigue con
`6c28a572`. La próxima corrida tiene que instalar `ecd8bca3` y verificarlo
antes de empezar, o correría sin el arreglo de refresh.

## 12. Staging antes y después

Idéntico. No se ejecutó ninguna mutación.

| | |
|---|---|
| Pedidos | **31** |
| `QA-SMOKE-*` | **0** |
| Activos | **1** — `LT-0030` `arrived` |
| Stock QA | **19** |
| `order_items` totales | 34 |

## 13. LT-0030

Intacto: `arrived`, revisión 10. Sólo se consultó para confirmarlo.

## 14. Secretos

Sin coincidencias en el diff. La service key vivió sólo en memoria del proceso:
no pasó por argv, `.env`, Git, logcat ni artefactos. Este reporte no contiene
nombres, direcciones, teléfonos, coordenadas, códigos ni UUID de personas.

## 15. Declaración

**TABA2_RIDER_QA_ORDER_SEED_READY_FOR_CONTROLLED_RUN**

- contrato de la cola demostrado desde el SQL;
- causa clasificada como C, con las otras cuatro descartadas por evidencia;
- la siembra crea order + línea válidos, con rollback;
- refresh resuelto con señal observable y tres desenlaces distinguidos;
- cleanup cubre líneas y respeta la FK;
- 46 pruebas locales verdes;
- cero mutaciones nuevas: 31 pedidos, stock QA 19, LT-0030 intacto;
- Git limpio.

**No se declara el smoke certificado. No se inició una quinta corrida.**

La siguiente corrida necesita autorización nueva y explícita, e instalar
`ecd8bca3` en el dispositivo antes de empezar.
