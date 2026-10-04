# wpH · Contrato HTTP de los rechazos — notas de trabajo

Rama `feat/taba-http-contract` (desde `4ba385b7`, 206 migraciones). Estas notas alcanzan para retomar
desde los commits si la sesión se corta. Base local: PG17 + shims (no es un stack Supabase).

## Estado

| Paso | Estado |
|---|---|
| 1. Mecanismo verificado sobre un PostgREST 14.5 propio | HECHO (ver «Verificado») |
| 2. Generador `scripts/db/wrap-api-boundary.mjs` + prueba unitaria | HECHO |
| 3. Migración `20261002090000` + reversión con guardas | HECHO (canónica verde, simulacro de reversión) |
| 4. pgTAP `http_error_contract_test.sql` (42) + registro en el runner (5938) + prueba Node | HECHO |
| 5. Prueba HTTP + `REFUSAL_STATUS` del certificador | HECHO (11 casos antes/después por PostgREST 14.5; costo medido) |
| 6. Política `http-contract.{json,md}`, impacto en clientes | HECHO |
| 7. `20261002091000` (RAISE sin errcode en funciones de cliente) | HECHO (commit aparte: se puede soltar sin tocar 090000) |

## Verificado (comandos y conteos exactos)

Herramientas en el scratch de la sesión (no versionadas): copia de `localdb.mjs` y de `repo-run.mjs`
apuntadas a ESTE worktree; bases sólo `taba_wph_*`; PostgREST propio en `127.0.0.1:55590`.

1. Mecanismo (base `taba_wph_probe` = base + `integrate/http-probe.sql` del lead), por HTTP:
   - función envuelta: `zz_probe_entry missing` → **404** `{"code":"P0002","details":null,"hint":null,"message":"pedido inexistente"}`;
     `closed` → **409** `{"code":"55000","details":"BUSINESS_CLOSED","hint":"opens_at=...","message":"el comercio esta cerrado"}`.
   - sin envolver (`zz_probe_inner`): 500 con el mismo cuerpo.
   - llamador PL/pgSQL con su propio manejador de 55000 (`zz_probe_outer closed`): 200 `{"caught_by_outer":"55000"}`.
   - por SQL sin `request.method`: 55000 / P0002 originales (mensaje, detalle y hint iguales).
   - llamador en lenguaje SQL: **inlineable** (sin SECURITY DEFINER ni SET) → 409 (la función envuelta queda como
     marco más externo); **SECURITY DEFINER o con SET** (no se inlinea) → 500 (el contexto tiene dos líneas).
2. Selección (`node scripts/db/wrap-api-boundary.mjs --database postgres://postgres@127.0.0.1:55521/taba_wph_base --report r.json`,
   base recién armada con las 206 migraciones, `CI_LIKE_DEFAULTS=1 CI_FISCAL_LEGACY=1`):
   516 funciones leídas, 276 entradas, 150 entradas que llegan a 55000/P0002; **109 elegidas** (68 de cliente,
   40 sólo service_role, 1 trigger `guard_business_currency_code`); 40 excluidas por dueño (caja_pos 6, fiscal 17,
   print_agent 12, legacy_payment_retired 5); 2 entradas SQL que llegan (`mp_consume_oauth`, `mp_claim_refresh`:
   sólo service_role, con SET → contestan 500 para estos códigos); 0 rechazos del generador; 0 usos por fila
   (ninguna función elegida aparece en una política ni en una vista).
3. Migración aplicada sobre una copia (`taba_wph_m`): 109 cuerpos con el marcador; **0 diferencias** de ACL, dueño,
   SET, SECURITY, volatilidad, STRICT, leakproof, parallel, costo, filas, retorno ni comentario en las 516 funciones
   (`acl-diff.mjs`); reaplicarla funciona (la guarda acepta el cuerpo envuelto); el generador sobre esa base:
   `already_wrapped 109, to_wrap 0` (idempotente).
4. Simulacro de reversión (`taba_wph_rb`): migración → reversión → **idéntica** a la base (0 diferencias de cuerpo
   ni de metadatos en 516 funciones); la reversión se puede repetir; después de redefinir
   `withdraw_rider_order_offer` la reversión se niega (`ROLLBACK_BLOCKED`) y la migración también (`ROLLOUT_BLOCKED`).
5. `node --import ./tests/test-bootstrap.mjs --test tests/wrap-api-boundary.test.mjs`: 10/10.
6. Corrida canónica sobre base NUEVA con la migración (`TABA_DB=taba_wph_canon RETIRE_LEGACY=1 node repo-run.mjs`, copia del
   script del lead apuntada a este worktree): `MIGRATIONS_APPLIED=207/207`, `LEGACY_RETIRED=6`,
   `FILES=77 PASS=77 NOT_PASS=0 PLANNED_SUM=5896 RUNNER_ASSERTS=5896 TOTAL_CONSISTENT`, sin tocar ninguna aserción.
7. `npm run check`: PASS (ENCODING_CHECK 314 archivos).
8. pgTAP nuevo: `TABA_DB=taba_wph_m node localdb.mjs test supabase/tests/http_error_contract_test.sql` → PASS 42/42 con la
   migración; sobre la base SIN la migración fallan justo los 3 estructurales (conteo 109, regla directa, trigger) y
   pasan los 39 de comportamiento (anidado y sin request.method no cambian: nada cambia adentro de la base).
9. Corrida canónica con el pgTAP registrado: `FILES=78 PASS=78 NOT_PASS=0 PLANNED_SUM=5938 RUNNER_ASSERTS=5938 TOTAL_CONSISTENT`.
10. Node: `tests/http-error-contract.test.mjs` 4/4, `tests/wrap-api-boundary.test.mjs` 10/10,
    `tests/ecommerce-certifier-cli.test.mjs` 10/10, `tests/ecommerce-certifier-load.test.mjs` 8/8,
    `tests/mercadopago-edge-hardening.test.mjs` 13/13 (suma del total canónico y del mensaje).

11. Corridas finales sobre HEAD (base nueva, 208 migraciones): limpia y con residuo, las dos
    `FILES=78 PASS=78 NOT_PASS=0 PLANNED_SUM=5938 TOTAL_CONSISTENT`.
    Antes, corrida canónica con residuo comprometido (`DIRTY=1`: intake-race + stock-race antes de la lista):
    `FILES=78 PASS=78 NOT_PASS=0 PLANNED_SUM=5938 TOTAL_CONSISTENT`.
12. Usos de funciones envueltas dentro de otras funciones (scratch `callers.mjs`): 22 lugares; ninguno evalúa una
    envuelta por fila (los 3 marcados son una llamada en FROM que corre una vez y dos textos de comandos de cron).

### Lo que pgTAP NO puede ver (medido)

pgTAP llama todo desde una función PL/pgSQL (`throws_ok` hace EXECUTE). Con `request.method` puesto,
`throws_ok($select public.cancel_own_order(<inexistente>, ...)$, 'PGRST')` FALLA: «caught: P0002» — la función
envuelta no es el marco más externo y re-lanza el original (es el comportamiento pedido para un llamador anidado).
Por eso el pgTAP afirma: estructura (marcador, manejador exacto, regla directa, exclusiones, uso por fila),
comportamiento anidado y sin request.method (original letra por letra, con detalle y pista) y los manejadores
internos. La conversión a PGRST → 409/404 se prueba por HTTP (sección siguiente), la prueba el certificador en CI y
la comprueba `scripts/db/check-api-boundary.mjs` (versionado): cada llamada como sentencia de primer nivel dentro de
un savepoint, con y sin request.method y desde un bloque DO, sobre el fixture del pgTAP en una transacción que se
deshace. `node scripts/db/check-api-boundary.mjs --database postgres://postgres@127.0.0.1:55521/taba_wph_canon` →
`API_BOUNDARY_CHECK: PASS 11/11` (PGRST con el cuerpo original y 409/404; sin request.method y desde DO, el original);
sobre `taba_wph_base` (sin la migración) → `FAIL 1/11` (sólo el camino feliz), como debe.

### Prueba HTTP (PostgREST 14.5 real, antes y después, mismo pedido)

Dos PostgREST propios: `55591` sobre `taba_wph_before` (base sin la migración) y `55590` sobre `taba_wph_http`
(con la migración), los dos con el mismo fixture comprometido (el de la sección 2 del pgTAP). Scripts del scratch:
`http-proof.mjs` y `http-proof-2.mjs`. Resultado (cuerpo idéntico byte a byte en todos):

| Llamada | Antes | Después |
|---|---:|---:|
| `create_order_with_items` producto no disponible | 500 | **409** |
| `create_order_with_items` OUT_OF_DELIVERY_ZONE (con details y hint) | 500 | **409** |
| `create_order_with_items` ALCOHOL_WINDOW_CLOSED | 500 | **409** |
| `create_order_with_items` BUSINESS_CLOSED (con hint) | 500 | **409** |
| `cancel_own_order` pedido inexistente | 500 | **404** |
| `transition_order` pedido inexistente | 500 | **404** |
| `set_service_enforcement` ENFORCEMENT_LOCKED (con details y hint) | 500 | **409** |
| `platform_verify_business_ordering` comercio inexistente (service_role) | 500 | **404** |
| `platform_verify_business_ordering` OPENING_NOT_READY (lista en details) | 500 | **409** |
| PATCH `businesses.currency_code` como service_role (trigger) | 500 | **409** |
| PATCH `businesses.currency_code` como dueño (trigger) | 500 | **409** |
| control: `create_order_with_items` feliz | 200 | 200 |
| control: `platform_verify...` con verificador inexistente (22023) | 400 | 400 |
| control: `pos_get_store_overview` excluida (42501) | 403 | 403 |

### Costo en la puerta del pedido

`perf.mjs` (scratch): `create_order_with_items` ×200 por base, como la API (`request.method` puesto, rol
authenticated), rondas alternadas antes/después después de calentar: antes p50 6,84 ms · p95 9,73 · media 7,61;
después p50 7,48 · p95 11,72 · media 8,55. **+0,64 ms p50, +0,94 ms media** (dos capas envueltas en ese camino).

### Clientes y Edge Functions (grep de js/, apps/, supabase/functions, scripts/)

- `js/repositories/supabase-business-repository.js:173` `classifyRpcError`: `status >= 500` → reintentable. Probado
  con node: 409+55000 → `{retryable:false, code:'55000'}` (antes 500 → `SERVER_UNAVAILABLE` reintentable);
  404+P0002 → `NOT_FOUND` (igual que antes: decide por código). Sus pruebas
  (`tests/business-repositories.test.mjs:25-28`) no cubren 55000 y no cambian.
- `js/production-operations.js:1827` y `:1839`: `retryable` = estado 0 o ≥ 500 → con 409 la negativa queda final.
- `supabase/functions`: deciden por `code` (`_shared/checkout-refusal.ts`); los únicos predicados por estado
  (`_shared/mercadopago.ts:442`, `_shared/seller-oauth.ts:382`) son de respuestas de Mercado Pago, no de PostgREST.
  Los mocks Deno de RPC con 55000 usan estado 400 y deciden por código: no dependen del 500.
- `scripts/payments/reconciliation/sources.mjs:534`: respuestas del proveedor, no de PostgREST.
  `scripts/e2e-staging/ecommerce/local-target.mjs:367`: 500 · 57014 del OpenAPI, no cambia.
- `apps/rider-android`: sin dependencias del estado 500 ni de estos códigos (grep sin resultados).
- No se cambió código de cliente.

### 20261002091000 · RAISE sin errcode en funciones de cliente

- Inventario (scratch `noerrcode.mjs`, base con las 206): 46 RAISE EXCEPTION sin errcode en 5 funciones de cliente
  (`apply_commercial_catalog_batch` 25, `import_catalog_batch` 8, `set_commercial_product_publication` 7,
  `publish_catalog_product` 3, `set_business_whatsapp_contact` 3). wp19 había dejado éstas como P0001 a propósito
  («son validaciones y 400 es su respuesta»); la política nueva dice que P0001 no llega a un cliente.
- Decisión por mensaje (tabla completa en el encabezado de la migración): 24 · 22023 (lote/fila/teléfono mal formado),
  3 · P0002 (SKU desconocido para el comercio, producto del alta inexistente, comercio inexistente), 19 · 55000 (no se
  publica: precio, stock, imagen, licencia de alcohol, datos incompletos, conflicto de stock, origen, verificación).
  Las 4 funciones con P0002/55000 ya están envueltas (salen 404/409); `import_catalog_batch` sólo recibe 22023.
- Generada de la definición viva (base + 090000) por `gen-091000.mjs` (scratch): sólo inserta ` using errcode = 'X'`
  antes del `;` de cada RAISE; falla si un mensaje no tiene regla o si queda uno sin código.
- Verificado: aplicada sobre una copia de `taba_wph_m`: 0 diferencias de metadatos, 5 cuerpos; reaplicable; la
  reversión deja la base idéntica (0/0) y se niega tras redefinir `set_business_whatsapp_contact`; la reversión de
  090000 se niega mientras 091000 está aplicada (`ROLLBACK_BLOCKED apply_commercial_catalog_batch`). Canónica con las
  208 migraciones: `FILES=78 PASS=78 NOT_PASS=0 PLANNED_SUM=5938 TOTAL_CONSISTENT`. Inventario después: 0.
- HTTP (PostgREST propio, antes = base, después = 090000 + 091000): lote vacío 400 P0001 → 400 22023; SKU inexistente
  400 P0001 → **404 P0002**; expected_stock no entero 400 P0001 → 400 22023; WhatsApp de 3 dígitos 400 P0001 → 400 22023;
  `publish_catalog_product` inexistente 400 P0001 → **404 P0002**. Mismo mensaje en todos.
- Aserciones existentes que fijaban P0001 y cambian SÓLO el SQLSTATE esperado (15, en 6 archivos):
  `alta_propuesta_comercial_test.sql` (3: SKU inexistente en el plan → P0002, fila inexistente en el lote → P0002,
  publicar sin precio confirmado → 55000), `catalog_stock_authority_test.sql` (1 → 22023),
  `catalog_change_rollback_test.sql` (1 → P0002), `authorization_refusals_answer_42501_test.sql` (5 → 22023/P0002,
  más el comentario de su sección 3 y una línea del encabezado), `authorization_matrix_test.sql` (2 filas de la matriz,
  4 aserciones: `ALLOW P0001` → `ALLOW 22023` para el alta vacía y `ALLOW 55000` para publicar sin foto aprobada),
  y la mía (`http_error_contract_test.sql`: el trinquete pasa a «ninguna»).

## Cambios en pruebas existentes por 090000 (codificaban el estado viejo como contrato)

- `tests/ecommerce-certifier-cli.test.mjs`: `REFUSAL_STATUS[55000]` 500→409, `REFUSAL_STATUS.P0002` 500→404 y la
  etiqueta `refusal(CODES.STATE, ...)` «HTTP 500 · 55000» → «HTTP 409 · 55000». Nada más.

## Para el lead al integrar (NO lo toqué: fuera de mi alcance)

- `scripts/e2e-staging/ecommerce/phases/pricing.mjs`: el check `KNOWN_API_01_BUSINESS_REFUSAL_55000_ANSWERS_HTTP_500`
  afirma `unsellable.http === 500` sin condición: con esta rama va a FALLAR (contesta 409). Hay que retirarlo o
  invertirlo (p. ej. `API_01_BUSINESS_REFUSAL_55000_ANSWERS_HTTP_409`). El comentario de `phases/inventory.mjs`
  (línea ~58) que lo menciona también queda viejo.
- Registro API-01 (no lo edité). Propuesta: `status: fixed`, `fixed_by: "20261002090000"`, y en `notes`:
  «Cerrado del lado del servidor (decisión del dueño). 20261002090000 envuelve el cuerpo vigente de 109 funciones de
  entrada en un manejador de frontera: sólo por la API (request.method) y sólo en el marco PL/pgSQL más externo,
  55000 sale como HTTP 409 y P0002 como HTTP 404, con el mismo cuerpo (code, message, details, hint). Llamadas sin
  request.method y llamadores PL/pgSQL anidados ven el SQLSTATE original. Política: docs/ecommerce-hardening/
  http-contract.md. Medido por un PostgREST 14.5 real: 11 negativas antes 500 / después 409-404, cuerpo idéntico.
  Quedan en 500, por dueño: Caja/POS, fiscal, agente de impresión y los seis cobros heredados (40 entradas), y las dos
  entradas SQL mp_consume_oauth / mp_claim_refresh. El cliente (classifyRpcError y la cola del Panel) ya trata un 409
  como definitivo: no hace falta tocar js/.» C-2 (P0002 → 500) queda cerrado por la misma migración.
- Orden de reversión: primero 20261002091000 y después 20261002090000 (la guarda de 090000 se niega mientras 091000
  está aplicada; medido). Sumarlas a la cadena de reversiones de CP.
- `docs/migrations/checks/20261002_ecommerce_hardening_preflight.sql` cubre hasta 20261002063000: no lo toqué.
- Despliegue: la guarda de 090000 (y la de 091000) compara el cuerpo vivo con el del que se generó. Si Staging/CP
  tiene una de las 109 funciones parchada a mano, la migración se niega con `ROLLOUT_BLOCKED: <firma>` en vez de
  pisarla: regenerar con el script contra una base con esa definición (o borrar el bloque `$guard$` si se prefiere la
  convención del resto de la rama, que no guarda la ida). En CI los cuerpos son los mismos que acá: el bootstrap y
  el ciclo A1-A4 aplican los mismos archivos de migración y `supabase/contracts/a1_a4_contract_v5.sql` no redefine
  funciones de public (revisado); la corrida canónica local con `RETIRE_LEGACY=1` aplica 090000 sin bloqueo.
- 20261002091000 es un commit aparte (`fix(api): ...`): se puede soltar sin tocar 090000; si se suelta, el trinquete
  del pgTAP (aserción 9) vuelve a la versión de bfd4cd36 (las cinco funciones conocidas).

## Decisiones

- Selección = `integrate/api-reach.mjs` del lead con cuatro agujeros cerrados: P0002 implícito de `select ... into
  strict` (8 funciones vivas), los nombres de condición `no_data_found` / `object_not_in_prerequisite_state` (4),
  `merge into` y tablas entre comillas en el paso de triggers; y las exclusiones del spec (el regex OTHER_LINES del
  lead excluía por prefijo fiscal_/caja_/print_ y no cubría agent_*, service_request_*, operator_*local_device*...).
  Resultado: 150 entradas que llegan (el script del lead: 142) y 109 envueltas tras exclusiones.

- La guarda de la migración (no sólo la de la reversión) compara el md5 del cuerpo vivo con el del que se generó
  (o con el envuelto): si otra rama redefinió una función, la migración se niega en vez de pisarla con un cuerpo viejo.
- Los cuerpos se copian letra por letra, retornos de carro incluidos (16 funciones vivas tienen CRLF); las guardas
  comparan `md5(replace(prosrc, E'\r', ''))`, como las demás reversiones de la rama.
- Encabezados con `search_path = pg_catalog` en la sesión del generador: tipos y nombres calificados, la migración
  no depende del search_path con que se aplique.
- Entradas: los permisos de la base tipo CI (lo que las migraciones otorgan explícitamente). En Staging/CP
  service_role tiene EXECUTE por privilegios por defecto sobre más funciones; esas funciones auxiliares no son
  superficie de la API y no se envuelven (seguirían contestando 500 si alguien las llamara directo con la clave de servicio).

## Otras verificaciones

- Las 76 RPC que llaman js/, apps/ y supabase/functions (`.rpc('...')`): todas son entradas en la base tipo CI;
  41 están envueltas; 4 llegan a 55000/P0002 y están excluidas por dueño (`authorize_fiscal_artifact_access`,
  `checkout_pos_sale`, `request_fiscal_document`, `request_order_invoice`: siguen en 500); 2 son SQL
  (`mp_claim_refresh`, `mp_consume_oauth`); el resto no llega a esos códigos.
- Generador sobre la base con las 208 migraciones (`taba_wph_canon`): `selected 109, already_wrapped 109, to_wrap 0,
  refusals 0, per_row 0` (excluidas que llegan: 41, porque `RETIRE_LEGACY` deja el stub retirado de
  `get_mercadopago_payment_authority` levantando 55000).
- Node: las 56 pruebas que leen `supabase/migrations` (719 tests) y las 7 que leen pgTAP/docs/runner/certificador
  (115 tests): todas pasan. No corrí el `npm test` completo (25 min, máquina compartida).

## Cómo retomar

Herramientas (no versionadas) en el scratch de esta sesión (`.../a47683f6-.../scratchpad/wph/`): `localdb.mjs` y
`repo-run.mjs` son copias de las del lead (`<scratch del lead>/local/localdb.mjs`, `integrate/repo-run.mjs`) con el
`createRequire` y `REPO` apuntando a este worktree y las salidas en el scratch propio; `rest-up.mjs` levanta
`postgrest.exe` (14.5) con el PATH de PG17; `http-proof*.mjs`, `perf.mjs`, `gen-091000.mjs`, `noerrcode.mjs`,
`callers.mjs`, `acl-diff.mjs`. Para rehacer la canónica: `TABA_DB=taba_wph_canon RETIRE_LEGACY=1 node repo-run.mjs`
(mi copia). Bases propias: `taba_wph_*` (base, m, rb, r2, canon, dirty, http, http2, before, probe). Nada quedó
corriendo (PostgREST detenidos).

Pendiente: nada de lo pedido. Opcional: extender el preflight a 090000/091000 y retirar el check
`KNOWN_API_01_...` del certificador (ambos del lead).
