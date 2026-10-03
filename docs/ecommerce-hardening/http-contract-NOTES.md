# wpH · Contrato HTTP de los rechazos — notas de trabajo

Rama `feat/taba-http-contract` (desde `4ba385b7`, 206 migraciones). Estas notas alcanzan para retomar
desde los commits si la sesión se corta. Base local: PG17 + shims (no es un stack Supabase).

## Estado

| Paso | Estado |
|---|---|
| 1. Mecanismo verificado sobre un PostgREST 14.5 propio | HECHO (ver «Verificado») |
| 2. Generador `scripts/db/wrap-api-boundary.mjs` + prueba unitaria | HECHO |
| 3. Migración `20261002090000` + reversión con guardas | HECHO (canónica verde, simulacro de reversión) |
| 4. pgTAP `http_error_contract_test.sql` + registro en el runner | pendiente |
| 5. Prueba HTTP + `REFUSAL_STATUS` del certificador | pendiente |
| 6. Política `http-contract.{json,md}`, impacto en clientes, `20261002091000` | json hecho (exclusiones y estados); md pendiente |

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

## Decisiones

- La guarda de la migración (no sólo la de la reversión) compara el md5 del cuerpo vivo con el del que se generó
  (o con el envuelto): si otra rama redefinió una función, la migración se niega en vez de pisarla con un cuerpo viejo.
- Los cuerpos se copian letra por letra, retornos de carro incluidos (16 funciones vivas tienen CRLF); las guardas
  comparan `md5(replace(prosrc, E'\r', ''))`, como las demás reversiones de la rama.
- Encabezados con `search_path = pg_catalog` en la sesión del generador: tipos y nombres calificados, la migración
  no depende del search_path con que se aplique.
- Entradas: los permisos de la base tipo CI (lo que las migraciones otorgan explícitamente). En Staging/CP
  service_role tiene EXECUTE por privilegios por defecto sobre más funciones; esas funciones auxiliares no son
  superficie de la API y no se envuelven (seguirían contestando 500 si alguien las llamara directo con la clave de servicio).

## Próximo

Ver la tabla de estado.
