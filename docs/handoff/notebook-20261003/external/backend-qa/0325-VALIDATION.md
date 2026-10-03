# Gate 1 — Validación

Worktree `C:\1212\la-taba-real-orders-staging` · rama `staging/real-orders-walter` ·
HEAD `23e57ad447e31a82b3d3bfdbc5992582ae88d98b`.

## Comandos ejecutados

| Comando | Resultado |
|---|---|
| `npm run check` | ✅ pasa |
| `npm test` | ⚠️ **635/636** — 1 falla **preexistente**, ver abajo |
| `npm run migrations:validate` | ✅ 20 migraciones, revisión estática aprobada |
| `npm run catalog:images:verify` | ✅ 22 productos y 44 WebP verificados |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilidades |
| `git diff --check` | ✅ exit 0 |
| **E2E focal del gate `gate1-order-revision.spec.mjs`** | ✅ **8/8** |
| E2E `realtime.spec.mjs` | ✅ 2/2 |
| E2E `demo-realtime-reliability.spec.mjs` | ✅ 7/7 |
| E2E `operational-hardening.spec.mjs` | ✅ 2/2 |

## Focales E2E propias del Gate 1 — `tests/e2e/gate1-order-revision.spec.mjs`

8 focales que ejercitan el reconciliador **realmente servido al navegador**
(`js/core/realtime-sync.js` importado como módulo ES dentro de la página), no una copia ni un
mock en Node. Es el mismo código que corre en el celular del cliente, del negocio y del rider.

| Focal | Qué certifica |
|---|---|
| El reconciliador expone la versión por revisión | El bundle servido incluye el cambio |
| Con `created_at` idéntico gana la revisión mayor | **El fallo medido en staging**: antes ambas direcciones daban `false` y el avance legítimo quedaba bloqueado |
| Un evento atrasado no pisa el estado vigente | Aunque llegue con timestamp posterior (mensaje reordenado) |
| Una entrega duplicada no altera el pedido | Reentrega del mismo mensaje Realtime |
| Una cancelación legítima se aplica | El estado visible retrocede pero la revisión avanza |
| Un pedido versionado gana a una copia local sin versión | Recuperación tras reconexión |
| Los pedidos sin respaldo Supabase siguen por timestamp | Compatibilidad demo/relay/sandbox intacta |
| Una revisión inválida no se toma por buena | `0`, negativos, decimales y ausentes → `null` |

### La falla de `npm test` es anterior a este gate

`tests/promotions.test.mjs:152` — *"free delivery and the centralized cart total use the active
promotion state"*. **No la introdujo este trabajo.** Verificado sin usar `stash` (prohibido por
el gate): se exportó HEAD limpio con `git archive HEAD` a un directorio temporal y se corrió
allí el test aislado — falla igual, 9/10.

```
$ git archive HEAD | tar -x -C <tmp> && cd <tmp> && node --test tests/promotions.test.mjs
✖ free delivery and the centralized cart total use the active promotion state
ℹ pass 9   ℹ fail 1
```

Es un fallo de promociones/carrito, sin relación con pedidos, revisión ni Realtime. Queda
registrado como pendiente heredado, no se tocó: arreglarlo excedía el alcance de este gate y
habría mezclado un cambio de lógica comercial con la ingeniería de pedidos.

## Suite nueva: `tests/order-revision-gate1.test.mjs` — 31/31 ✅

### Reconciliación por revisión (Gate §4)

| Escenario | Cubre |
|---|---|
| Revisión gana sobre timestamp con `created_at` idéntico | El caso real medido en staging |
| Revisión atrasada con timestamp posterior se descarta | Evento Realtime reordenado |
| Revisión repetida no reemplaza | Entrega duplicada del mismo mensaje |
| Sin revisión en ambos lados → criterio por timestamp | Compatibilidad demo/relay/sandbox |
| Versionado por servidor gana a copia local sin versión | Recuperación tras reconexión |
| `orderRevision` rechaza `0`, negativos, decimales, `null` | No asumir versiones falsas |
| `mergeOrders` no retrocede a revisión anterior | Evento antiguo |
| `mergeOrders` adopta revisión posterior aunque el estado retroceda | Cancelación legítima |

### Migración e invariantes de backend (Gate §3)

Revisión monótona; incremento por trigger y no por RPC; el trigger ignora revisiones enviadas
por el cliente (se verifica que la normalización **precede** a la comparación); orden de trigger
alfabético correcto; UPDATE sin cambios no consume versión; `sequence` por `nextval` y no por
timestamp; unicidad y backfill determinista; índice de reproducción de historia;
`replica identity full`.

### `transition_order` (Gate §3)

Exige auth y revisión esperada; **bloquea la fila antes de comparar** la revisión (se verifica
el orden relativo de `for update` y la comparación); rechaza revisión desactualizada con
`40001`; doble toque idempotente sin evento; **delega** rol/transición en `change_order_status`
en vez de reimplementarlos; `SECURITY DEFINER` con `search_path` fijo; ejecutable sólo por
`authenticated`.

### Contratos preexistentes que este gate no debe romper

`customer_user_id` derivado de `auth.uid()` y ausente de la whitelist del payload; ítems sólo
`product_id` + `quantity`; precio y stock leídos del servidor con la fila bloqueada;
idempotencia por `client_request_id` + huella del intent; producto inexistente aborta la
transacción entera.

## Cobertura de los 12 escenarios pedidos por el Gate §6

| # | Escenario | Estado | Dónde |
|---|---|---|---|
| 1 | Doble confirmación | ✅ | `transition_order` no-op idempotente + revisión repetida no reemplaza |
| 2 | Misma `idempotency_key` | ✅ | Test de idempotencia + rama `if found then return` de la RPC |
| 3 | `idempotency_key` distinta | ✅ | Huella del intent; key reutilizada con payload distinto → `23505` |
| 4 | Fallo intermedio | ✅ | Transacción única: cualquier `raise` revierte pedido, ítems, evento y stock |
| 5 | Producto inexistente | ✅ | Test dedicado (`23503`) |
| 6 | Precio manipulado | ✅ | Test: los ítems sólo aceptan `product_id`/`quantity`; precio del servidor |
| 7 | Stock insuficiente | ✅ | Test: `v_product.stock < v_item.quantity` → `23514` |
| 8 | Transición inválida | ✅ | Delegada a `change_order_status` (`23514`) + CAS de revisión (`40001`) |
| 9 | Concurrencia | ✅ | CAS por revisión con `for update` previo; test de orden bloqueo→comparación |
| 10 | Negocio abierto después | ✅ | Validación de negocio en creación (`55000`) — preexistente, cubierta |
| 11 | Desconexión y recuperación | ✅ | E2E `demo-realtime-reliability` (7/7): snapshot tardío, caída temporal, `pageshow`/foco |
| 12 | Evento antiguo | ✅ | Revisión atrasada descartada + `mergeOrders` no retrocede |
| 13 | Aislamiento RLS entre clientes | ⚠️ **parcial** | Verificado **estáticamente** contra el esquema desplegado: `orders`/`order_items`/`order_events` tienen **sólo** policy SELECT vía `can_access_order`, sin ninguna policy de escritura. La prueba en vivo con dos usuarios reales está escrita (paso 8 de `gate1-live-verification.sql`) pero **no ejecutada** |

Los escenarios 1, 11 y 12 quedaron además cubiertos por focales E2E propias del gate corriendo
en navegador real, no sólo por tests unitarios.

## Limitación explícita: la migración NO está aplicada en staging

`npx supabase db push --linked` fue **denegado por el clasificador de permisos** de la sesión.
Consecuencias, declaradas sin adorno:

- La migración `20260801020000` está **escrita y aprobada por la validación estática**, pero
  **no aplicada** en `ukxqbgswjlibmnjemrzd`. Local y remoto quedan con **drift de 1 migración**.
- Los 31 tests nuevos verifican el **contenido** de la migración y la **lógica del cliente**,
  no el comportamiento del trigger corriendo en PostgreSQL.
- Por lo tanto **no está certificado en vivo**: que el trigger incremente en el orden esperado
  frente a los otros `before update`; que el backfill de `sequence` corra sin colisión sobre
  los 19 eventos reales; que `transition_order` rechace efectivamente una revisión vieja
  contra la base.
- El escenario 13 (aislamiento RLS con dos clientes reales) tampoco pudo ejercitarse en vivo.

El gate pide "usar staging real cuando corresponda" y "no certificar seguridad sólo con mocks".
Ese requisito **no está cumplido** para la parte nueva. Esto no se presenta como aprobado.

## Suite de verificación en vivo — escrita y lista, pendiente de ejecución

`supabase/gate1-live-verification.sql` queda preparada para correr apenas se aplique la
migración. Cubre exactamente lo que la validación estática **no** puede certificar:

| # | Comprobación en vivo |
|---|---|
| 0 | Preflight: migración realmente aplicada (columna, secuencia, función y trigger presentes) |
| 1 | El trigger incrementa la revisión en un UPDATE efectivo |
| 2 | Un UPDATE sin cambios reales **no** consume revisión |
| 3 | Una revisión forjada por el cliente se ignora |
| 4 | Dos eventos de la **misma transacción** reciben `sequence` distinta y creciente… |
| 4b | …y se confirma que `created_at` sí empata entre ambos: la razón de existir de `sequence` |
| 5 | El backfill no dejó `sequence` nulas ni duplicadas |
| 6 | `transition_order` rechaza una revisión desactualizada con `40001` |
| 7 | `orders` tiene RLS habilitado y **cero** policies de escritura |
| 8 | Un cliente distinto no ve el pedido ajeno (aislamiento RLS real) |

Propiedades deliberadas del script: corre dentro de `begin … rollback`, así que **no deja
pedidos, eventos ni cambios de stock** en staging; cada comprobación falla con
`raise exception` en vez de devolver una fila que alguien podría pasar por alto; y distingue
`OK` de `PARCIAL` sin inflar el resultado — el paso 6 informa honestamente si la sesión no
tiene JWT (el chequeo de auth precede al de revisión), y el 8 informa si staging no tiene dos
clientes con pedidos distintos, en vez de darse por aprobado.

## Cómo cerrar el gate

Dos comandos, desde `C:\1212\la-taba-real-orders-staging`:

```
npx supabase db push --linked
npx supabase db query --linked --file supabase/gate1-live-verification.sql
```

El primero está **denegado por el clasificador de permisos** de la sesión del agente, por
tratarse de una modificación de esquema sobre una base remota. No se intentó eludir el bloqueo
ejecutando el mismo DDL vía `db query`: además de contradecir la intención del bloqueo, dejaría
la migración sin registrar en el historial de Supabase, un estado peor que el drift limpio
actual.
