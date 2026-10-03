# Gate 1 — Diseño final, migración y contratos

## Punto de partida

La auditoría (`ARCHITECTURE_AUDIT.md`) encontró un motor **ya maduro**: creación idempotente
real, precios de servidor, atomicidad, CAS por estado, validación de rol, RLS fail-closed sin
escritura directa sobre `orders`, y Realtime usado como señal y no como autoridad. Los dos
pedidos de staging ya recorrieron el ciclo completo hasta `delivered`.

Por eso este gate **no reescribe** lo que ya funciona. Reescribir
`create_order_with_items_core` o `change_order_status` habría sido reintroducir riesgo en
código ya ejercitado de punta a punta, sin ganancia. El trabajo se concentra en el único gap
sustantivo y medido: **no existía una versión monótona de pedido**.

## El problema, con evidencia

`now()` es constante durante toda una transacción de PostgreSQL. Varias RPC escriben más de un
evento por transacción. Resultado medido sobre los 19 eventos reales de staging: **3 colisiones
exactas de `created_at`** (~16 %), dos de ellas al mismo microsegundo dentro del mismo pedido.

```
2026-08-01 01:25:51.070103+00  order.status_changed
2026-08-01 01:25:51.070103+00  order.rider_claimed
2026-08-01 01:25:53.076168+00  order.status_changed
2026-08-01 01:25:53.076168+00  order.delivery_handoff_confirmed
```

El reconciliador del cliente (`js/core/realtime-sync.js`) comparaba versiones con
`orderTimestamp(incoming) > orderTimestamp(local)` — comparación **estricta**. Ante un empate
devuelve `false` y **descarta el cambio entrante en silencio**. Un cliente que reconecta y
recibe el estado del servidor con el mismo timestamp que su copia local se queda pegado al
estado viejo. Es exactamente el fallo que el Gate §4 pide evitar ("ignorar revisiones
antiguas") — sólo que el sistema no tenía con qué distinguir "antigua" de "igual".

Ninguna precisión adicional de reloj lo arregla: el empate es estructural, no de resolución.

## Diseño

### 1. `orders.revision` — versión monótona por pedido

`bigint not null default 1`, incrementada por un **trigger**, no por cada RPC:

```sql
create trigger orders_zz_bump_revision
before update on public.orders
for each row execute function public.bump_order_revision();
```

Tres decisiones deliberadas:

- **Trigger y no RPC**: toda ruta de escritura —las de hoy y las que agreguen gates futuros—
  queda versionada por construcción. Ninguna puede olvidarse de incrementar. Poner el
  incremento dentro de `change_order_status` habría dejado sin versionar a
  `claim_available_rider_order`, `assign_order_rider`, `confirm_order_delivery` y
  `recover_order_tracking_access`, que también hacen `update public.orders`.
- **Prefijo `zz` en el nombre**: PostgreSQL dispara los triggers de la misma fase en orden
  alfabético. `orders_zz_bump_revision` corre después de `orders_set_updated_at` y
  `orders_set_status_timestamps`, así que observa la fila ya final. Sin esto podría versionar
  un estado intermedio.
- **Normaliza antes de comparar**: `new.revision := old.revision;` **precede** a
  `if new is distinct from old`. Una revisión falsificada por el cliente no puede saltear ni
  congelar la versión real; y un UPDATE sin cambios efectivos no consume versión.

### 2. `order_events.sequence` — orden total de eventos

`nextval()` **no** es constante dentro de una transacción, a diferencia de `now()`. Dos eventos
escritos por la misma RPC reciben valores distintos y crecientes: exactamente lo que
`created_at` no puede dar.

- Backfill determinista de los 19 eventos existentes por `row_number() over (order by created_at, id)`.
- `setval` para continuar sin colisiones, luego `set default nextval(...)` y `set not null`.
- Índice único sobre `sequence` e índice `(order_id, sequence desc)` para reproducir historia
  de forma reproducible (el índice por `created_at` daba orden no determinista ante empates).

### 3. `transition_order` — CAS por revisión

`change_order_status` hace CAS por **estado esperado**. Eso protege el doble toque, pero no
distingue dos actores que leyeron el mismo estado desde lecturas distintas de la fila: ambos
pasan la comparación. El CAS por **revisión** es estrictamente más fuerte, porque la revisión
cambia con *cualquier* escritura efectiva, no sólo con un cambio de estado.

`transition_order(p_order_id, p_expected_revision, p_new_status)`:

1. Exige `auth.uid()`.
2. Traduce el vocabulario del contrato al almacenado.
3. `select ... for update` **antes** de comparar la revisión (sin el bloqueo, dos llamadas
   concurrentes podrían leer la misma revisión y ambas considerarse válidas).
4. Revisión distinta → `40001`, sin aplicar nada.
5. Ya en el estado destino → **no-op idempotente exitoso**, sin evento y sin consumir revisión,
   así que reintentar nunca ensucia el historial.
6. Delega en `change_order_status`, que ya valida estado previo, rol, negocio y rider.

**No reimplementa la autorización** — hay un test que lo verifica (`assert.doesNotMatch(...
has_business_role)`). Una segunda copia de las reglas de rol sería una fuente de divergencia.

### 4. Vocabulario de estados

`normalize_order_status_vocabulary(text)`, `immutable`, centraliza la traducción:

| Contrato Gate 1 | Almacenado |
|---|---|
| `submitted` | `received` |
| `ready_for_pickup` | `ready` |
| `arriving` | `arrived` |
| `cancelled` | `cancelled` (acepta `canceled`) |

Cierra el hallazgo **R2**: `received↔submitted` y `arriving↔arrived` ya existían dentro de
`change_order_status`, pero `ready_for_pickup` no estaba mapeado y un cliente que hablara el
vocabulario del contrato recibía `estado destino invalido`.

### 5. Realtime transporta la revisión

`replica identity full` en `orders` y `order_events`. Sin esto un UPDATE publica sólo la PK y
las columnas cambiadas, el suscriptor no vería `revision` y no podría descartar mensajes
atrasados — la corrección quedaría inerte en el transporte.

### 6. Cliente: la revisión manda sobre el timestamp

`shouldReplaceOrder()` en `js/core/realtime-sync.js`:

- Ambos lados con revisión → compara revisiones.
- Sólo el entrante con revisión → gana (viene del servidor, es la autoridad).
- Sólo el local con revisión → no lo pisa una copia sin versión.
- Ninguno con revisión → **conserva el criterio por marca de tiempo**, porque los pedidos de
  demo/relay/sandbox no tienen versión de servidor y deben seguir reconciliándose como antes.

Compatibilidad hacia atrás preservada a propósito: `revision` viaja como `null` cuando no hay
respaldo Supabase, y `normalizeOrderRevision` rechaza `0`, negativos, decimales y no-enteros
en vez de asumir una versión falsa.

## Política de stock — documentada, no modificada

La política vigente es **descuento inmediato** al crear el pedido, con reposición **única**
(protegida por `inventory_released_at`) sólo en cancelación/rechazo **anteriores al despacho**.
Después de `picked_up` el stock no se repone automáticamente: la mercadería ya no está en el
local y su reingreso exige un ajuste humano de inventario. `available` se recalcula fail-closed
en ambos sentidos.

Es la política más segura compatible con el esquema actual y **se conserva sin cambios**. El
Gate pedía definirla y documentarla, no reemplazarla; cambiarla habría sido inventar política
comercial.

## Migración

`supabase/migrations/20260801020000_order_revision_and_event_sequence.sql` — 100 % aditiva:
agrega columnas, una secuencia, dos funciones nuevas, un trigger y dos índices. **No** altera
ni elimina ninguna función, policy, tabla o columna existente.

## Contratos preparados para gates futuros (no implementados)

- `transition_order` ya devuelve el snapshot con `revision`: el mapa del rider y el GPS final
  podrán suscribirse y descartar posiciones atrasadas con el mismo criterio.
- `order_events.sequence` da el orden total que necesitará una reproducción auditable del
  ciclo de vida (código de entrega final, prueba de entrega).
- `idempotent_no_op` en la respuesta permite a la UI distinguir "no pasó nada porque ya estaba"
  de "se aplicó", sin inventar un estado intermedio.
