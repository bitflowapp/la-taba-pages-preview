# TABA — Gate 1: Reliable Order Engine

## Veredicto

`TABA_GATE1_RELIABLE_ORDER_ENGINE_CERTIFIED_AND_COMMITTED`

## 1. Alcance y HEAD

- Repositorio exclusivo: `C:\1212\la-taba-real-orders-staging`
- Rama: `staging/real-orders-walter`
- HEAD inicial completo: `23e57ad447e31a82b3d3bfdbc5992582ae88d98b`
- HEAD final completo: `c6270589756214eac617515248e93a8e8819190b`
- No se tocó `main`, producción ni `C:\1212\la-taba-mostador-patagonico`.
- `supabase/config.toml` y `supabase/.gitignore` ya eran archivos trackeados; quedaron fuera de Gate 1 por ser configuración preexistente ajena al cambio. No se añadieron secretos, contraseñas, `supabase/.temp`, artefactos externos, datos sintéticos persistentes ni logs con credenciales.

## 2. Commits y archivos

1. `743f3f8` — `feat(db): add monotonic order revisions and event sequence`
   - `supabase/gate1-live-verification.sql`
   - `supabase/migrations/20260801020000_order_revision_and_event_sequence.sql`
2. `8f64620` — `fix(sync): reconcile order updates by monotonic revision`
   - `js/core/domain.js`
   - `js/core/realtime-sync.js`
   - `js/repositories/supabase_order_repository.js`
3. `c627058` — `test(order-engine): cover idempotency, CAS and realtime ordering`
   - `tests/order-revision-gate1.test.mjs`
   - `tests/e2e/gate1-order-revision.spec.mjs`

Antes de cada commit se verificaron `git diff --cached --name-status`, `git diff --cached --check` y el diff staged completo. No se mezclaron rutas ajenas al propósito de cada commit.

## 3. Migración remota

- Proyecto Supabase staging: `ukxqbgswjlibmnjemrzd`.
- La migración `20260801020000` ya estaba aplicada y verificada antes de la certificación.
- No se ejecutó `db push` ni se reaplicó el DDL.
- `npm run migrations:validate` aprobó la revisión estática de 20 migraciones; el mensaje sobre aplicación local/staging es informativo del validador estático y fue cubierto por la verificación viva.

## 4. Verificación viva

Se ejecutó `npx supabase db query --linked --file supabase/gate1-live-verification.sql` contra staging. El script usa una excepción-sentinela `GATE1_ALL_CHECKS_PASSED` dentro de una transacción de prueba; por eso el CLI devuelve estado 1 aunque todos los checks imprimieron `OK`. La prueba cubrió:

- migración aplicada y `REPLICA IDENTITY FULL`;
- 19 eventos existentes sin `sequence` nula ni duplicada;
- revisión monótona, no-op sin incremento y revisión enviada por cliente ignorada;
- `sequence` distinta y creciente para eventos con `created_at` idéntico;
- CAS viejo rechazado con `40001`;
- CAS correcto `on_the_way -> arrived` usando el vocabulario público `arriving`;
- doble toque idempotente sin evento ni incremento;
- transición inválida rechazada;
- actor no autorizado rechazado con `42501`;
- RLS con aislamiento entre cliente ajeno y dueño, sin policies de escritura.

El chequeo posterior de sólo lectura confirmó: `orders_total=2`, `events_total=19`, `synthetic_events_left=0`, `null_sequences=0`, `revision_not_null=true`, `sequence_not_null=true`, `orders_replica_identity_full=true`, `events_replica_identity_full=true` y `orders_write_policies=0`.

## 5. Auditoría técnica

- `orders.revision`: `bigint NOT NULL DEFAULT 1`, incrementada por `orders_zz_bump_revision` en cada UPDATE efectivo.
- El trigger copia primero `old.revision`, por lo que una revisión enviada por el cliente no puede falsificar, congelar ni saltear la versión real.
- Un UPDATE no-op no consume revisión (`new IS DISTINCT FROM old`).
- `order_events.sequence`: `NOT NULL`, alimentada por `nextval()` y protegida por índice único. La secuencia admite huecos propios de `nextval()` y rollback, pero nunca duplicados.
- `normalize_order_status_vocabulary` se ejecuta antes de la llamada que dispara el bump y traduce canónicamente `arriving -> arrived`.
- `transition_order` bloquea la fila, compara `p_expected_revision` con CAS, rechaza revisiones atrasadas con `40001`, es idempotente y delega autorización/reglas de transición en `change_order_status`.
- `REPLICA IDENTITY FULL` se configuró sólo para transportar la fila versionada de `orders` y `order_events`; los secretos de tracking se mantienen fuera de esas tablas, en almacenamiento protegido y sin plaintext persistido. No se publican secretos mediante el cambio de Realtime.
- La UI no tiene policies de escritura directa sobre `orders`; las mutaciones persistentes pasan por RPC y la verificación viva confirmó cero policies `INSERT/UPDATE/DELETE/ALL` en `orders`.

## 6. Pruebas

- `npm run check`: PASS.
- `npm run migrations:validate`: PASS.
- `npm run catalog:images:verify`: PASS — 22 productos y 44 WebP demo verificados; 0 imágenes con fuente pendientes.
- `npm audit --audit-level=high`: PASS — 0 vulnerabilidades.
- `git diff --check`: PASS, incluido `23e57ad...c627058`.
- Unitarios Gate 1: **31/31 PASS**.
- E2E focales Gate 1: **8/8 PASS**.
- E2E preexistentes: **11/11 PASS** (`demo-realtime-reliability`, `demo-realtime-profile`, `realtime`).
- E2E focales + preexistentes en verificación commiteada: **19/19 PASS**.

## 7. Falla preexistente

`npm test` produjo **635/636**, con una única falla exacta y repetible:

- `tests/promotions.test.mjs`, test definido alrededor de la línea 152;
- aserción fallida en la línea 168;
- `free delivery and the centralized cart total use the active promotion state`;
- `0 !== 800`.

La misma falla se reprodujo en un worktree limpio exacto del HEAD inicial `23e57ad447e31a82b3d3bfdbc5992582ae88d98b`, antes de retirar el worktree temporal. Por ello se acepta como preexistente y no causada por Gate 1.

## 8. Estado Git final

`git status --short` quedó limpio después de los commits. No se ejecutaron `reset`, `restore`, `stash`, `clean`, `rebase`, `merge`, `push` ni `deploy`. Tampoco se ejecutó `db push`.

## 9. Backup

- Bundle: `C:\1212\backups\taba-gate1-order-engine-certified-c627058.bundle`
- `git bundle verify`: PASS — bundle completo y válido.
- SHA-256: `3C3D7B2E3478D1D5E04DCB8B7A68220897EDDE07A847F7B438DC4FE9B9FBCC84`

## 10. Certificación

Gate 1 queda certificado y commiteado con el veredicto:

`TABA_GATE1_RELIABLE_ORDER_ENGINE_CERTIFIED_AND_COMMITTED`
