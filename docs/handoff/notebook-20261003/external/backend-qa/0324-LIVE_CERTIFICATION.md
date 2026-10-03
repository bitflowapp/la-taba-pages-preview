# Gate 1 — Certificación EN VIVO contra Supabase staging

Proyecto: `la-taba-staging` (`ukxqbgswjlibmnjemrzd`) · PostgreSQL 17.6
Migración `20260801020000` aplicada manualmente por el usuario y registrada
(`20260801020000 | 20260801020000`). **No se reaplicó.**

## 1. Objetos verificados remotamente

| Objeto | Estado en staging |
|---|---|
| `orders.revision` | ✅ `bigint`, `NOT NULL` |
| `order_events.sequence` | ✅ `NOT NULL` |
| `order_events_sequence_seq` | ✅ existe |
| `transition_order(uuid, bigint, text)` | ✅ existe |
| `bump_order_revision()` | ✅ existe |
| `normalize_order_status_vocabulary(text)` | ✅ existe |
| Trigger `orders_zz_bump_revision` | ✅ 1, no interno |
| `orders` replica identity | ✅ `f` (full) |
| `order_events` replica identity | ✅ `f` (full) |
| Índice `order_events_sequence_key` | ✅ único |
| Índice `order_events_order_sequence_idx` | ✅ presente |
| Backfill | ✅ 19 eventos, 0 nulos, 19 `sequence` distintas |

## 2. Suite en vivo — `supabase/gate1-live-verification.sql`

Salida literal de la corrida contra staging real:

```
GATE1_ALL_CHECKS_PASSED
OK 0. Preflight: migración aplicada y replica identity full.
OK 1. Backfill: 19 eventos, sin nulos ni duplicados.
OK 2. Revisión monótona: 1 -> 2.
OK 2b. UPDATE sin cambios no consume revisión (sigue en 2).
OK 2c. Revisión forjada ignorada: quedó en 3.
OK 3. Sequence única y creciente en la misma transacción: 26 < 27.
OK 4. created_at IDÉNTICO (2026-08-01 05:47:05.210872+00) con sequence mayor:
      confirma en vivo la causa raíz.
OK 5. Revisión desactualizada rechazada con 40001.
OK 6. CAS correcto: on_the_way -> arrived (vocabulario arriving), revisión 3 -> 4.
OK 7. Doble toque idempotente: sin evento y sin consumir revisión (sigue en 4).
OK 8. Transición inválida arrived -> preparing rechazada con 23514.
OK 9. Actor no autorizado rechazado con 42501.
OK 10. RLS: sin policies de escritura; cliente ajeno no ve el pedido y el dueño sí.
```

### Cobertura punto por punto

| Pedido | Certificado en vivo |
|---|---|
| Backfill | OK 1 — 19 eventos, sin nulos ni duplicados |
| Revisión monótona | OK 2 — el trigger llevó la revisión de 1 a 2 en un UPDATE efectivo |
| Sequence única | OK 3 — dos eventos de la **misma transacción**: 26 y 27, distintas y crecientes |
| `created_at` idéntico con revisión mayor | **OK 4** — ambos eventos comparten `created_at` al microsegundo (`05:47:05.210872+00`) y sólo `sequence` los desempata. **La causa raíz de la auditoría queda confirmada contra la base real, no inferida** |
| Rechazo de revisión vieja | OK 5 — `40001` |
| CAS | OK 6 — con la revisión correcta aplicó `on_the_way → arrived`, revisión 3 → 4, `idempotent_no_op=false`. Además valida el vocabulario Gate 1: se envió `arriving` y se almacenó `arrived` |
| Doble toque idempotente | OK 7 — `idempotent_no_op=true`, sin evento nuevo y sin consumir revisión |
| Transición inválida | OK 8 — `arrived → preparing` rechazada con `23514` |
| RLS con dos clientes | OK 10 — el cliente ajeno ve 0 filas; **y el dueño legítimo ve 1**, así que la policy no es inútilmente cerrada |
| Actor no autorizado | OK 9 — usuario sin relación con el pedido ni membresía: `42501` |
| Rollback completo | ✅ ver abajo |

Actores reales usados (simulados con `request.jwt.claims`, que es lo que lee `auth.uid()`):
rider asignado, dos clientes distintos y un usuario ajeno sin membresía.

### Extras verificados sin que el gate los pidiera

- **OK 2b** — un `UPDATE` sin cambios reales **no** consume revisión.
- **OK 2c** — una revisión **forjada** por el cliente (`revision = 999999`) se ignora: quedó
  en 3, el valor legítimo. La normalización previa a la comparación funciona en vivo.

## 3. Rollback completo

La suite termina con `raise exception 'GATE1_ALL_CHECKS_PASSED...'` **a propósito**: emite el
reporte y garantiza el rollback por construcción, sin depender de que alguien lea una fila.

Estado de staging después de la corrida:

| Métrica | Valor | Esperado |
|---|---|---|
| Pedidos | 2 | 2 ✅ |
| Eventos | 19 | 19 ✅ |
| Eventos sintéticos (`gate1.probe.*`) | 0 | 0 ✅ |
| `sequence` nulas | 0 | 0 ✅ |
| Notas contaminadas (`g1`, `!`) | 0 | 0 ✅ |
| Stock alterado | 0 | 0 ✅ |
| Estado | `LT-0001=delivered r1 \| LT-0002=on_the_way r1` | idéntico al inicial ✅ |

**Salvedad honesta:** los valores 26 y 27 de la secuencia quedaron consumidos. Las secuencias
de PostgreSQL son deliberadamente no transaccionales — `nextval()` no se revierte, y es
justamente esa propiedad la que hace que `sequence` desempate dentro de una transacción. El
hueco es esperado, inocuo y no afecta unicidad ni orden. Ningún dato de negocio quedó alterado.

## 4. Validación completa (segunda corrida, post-migración)

| Comando | Resultado |
|---|---|
| `npm run check` | ✅ |
| `npm test` | ⚠️ 635/636 — la única falla es **preexistente** (ver `VALIDATION.md`) |
| `npm run migrations:validate` | ✅ 20 migraciones |
| `npm run catalog:images:verify` | ✅ 22 productos, 44 WebP |
| `npm audit --audit-level=high` | ✅ 0 vulnerabilidades |
| `git diff --check` | ✅ exit 0 |
| 31 unitarios del gate | ✅ 31/31 |
| 8 E2E focales Gate 1 | ✅ 8/8 |
| 11 E2E preexistentes | ✅ 11/11 |
| **Total E2E** | **✅ 19/19** |

La falla de `npm test` (`tests/promotions.test.mjs:152`) es anterior a este gate y ajena a
pedidos, revisión y Realtime. Se comprobó exportando HEAD limpio con `git archive` y corriendo
el test allí: falla igual, 9/10. No se tocó.

## 5. Git

- Rama `staging/real-orders-walter`, HEAD `23e57ad447e31a82b3d3bfdbc5992582ae88d98b`
- **Sin commits.** 3 archivos modificados, 4 nuevos, todo en working tree
- Sin `push`, `merge`, `deploy`, `reset`, `restore`, `stash`, `clean` ni `rebase`
- Sin cambios en `main`, en producción ni en `C:\1212\la-taba-mostador-patagonico`
