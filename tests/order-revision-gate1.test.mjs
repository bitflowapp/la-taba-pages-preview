import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mergeOrders, orderRevision, shouldReplaceOrder } from '../js/core/realtime-sync.js';

const revisionSql = readFileSync(
  new URL('../supabase/migrations/20260801020000_order_revision_and_event_sequence.sql', import.meta.url),
  'utf8',
);
const orderSql = readFileSync(
  new URL('../supabase/migrations/20260725030000_taba_production_orders.sql', import.meta.url),
  'utf8',
);

// ===== Reconciliación por revisión (Gate 1 §4: ignorar revisiones antiguas) =====

test('la revisión gana sobre la marca de tiempo cuando ambas existen', () => {
  // Mismo timestamp exacto: el caso real medido en staging, donde dos escrituras
  // de la misma transacción comparten created_at al microsegundo.
  const sameInstant = '2026-08-01T01:25:51.070Z';
  const local = { id: 'LT-0001', createdAt: sameInstant, revision: 4 };
  const incoming = { id: 'LT-0001', createdAt: sameInstant, revision: 5 };

  assert.equal(shouldReplaceOrder(local, incoming), true);
  assert.equal(shouldReplaceOrder(incoming, local), false);
});

test('una revisión atrasada se descarta aunque traiga una marca de tiempo posterior', () => {
  // Un mensaje Realtime reordenado puede llegar con un timestamp mayor y una
  // revisión menor. La revisión manda: el estado viejo no debe pisar al nuevo.
  const local = { id: 'LT-0001', createdAt: '2026-08-01T01:00:00.000Z', revision: 9 };
  const stale = { id: 'LT-0001', createdAt: '2026-08-01T02:00:00.000Z', revision: 8 };

  assert.equal(shouldReplaceOrder(local, stale), false);
});

test('una revisión repetida no reemplaza (doble entrega del mismo mensaje)', () => {
  const local = { id: 'LT-0001', createdAt: '2026-08-01T01:00:00.000Z', revision: 7 };
  const duplicate = { id: 'LT-0001', createdAt: '2026-08-01T01:00:00.000Z', revision: 7 };

  assert.equal(shouldReplaceOrder(local, duplicate), false);
});

test('sin revisión en ambos lados se conserva el criterio por marca de tiempo', () => {
  // Pedidos de demo/relay/sandbox no tienen versión de servidor.
  const local = { id: 'demo-1', createdAt: '2026-08-01T01:00:00.000Z' };
  const newer = { id: 'demo-1', createdAt: '2026-08-01T02:00:00.000Z' };
  const older = { id: 'demo-1', createdAt: '2026-08-01T00:00:00.000Z' };

  assert.equal(shouldReplaceOrder(local, newer), true);
  assert.equal(shouldReplaceOrder(local, older), false);
});

test('un pedido versionado por el servidor gana sobre una copia local sin versión', () => {
  const localUnversioned = { id: 'LT-0001', createdAt: '2026-08-01T05:00:00.000Z' };
  const serverVersioned = { id: 'LT-0001', createdAt: '2026-08-01T01:00:00.000Z', revision: 1 };

  assert.equal(shouldReplaceOrder(localUnversioned, serverVersioned), true);
  assert.equal(shouldReplaceOrder(serverVersioned, localUnversioned), false);
});

test('orderRevision sólo acepta enteros positivos seguros', () => {
  assert.equal(orderRevision({ revision: 3 }), 3);
  assert.equal(orderRevision({ revision: '4' }), 4);
  assert.equal(orderRevision({ revision: 0 }), null);
  assert.equal(orderRevision({ revision: -1 }), null);
  assert.equal(orderRevision({ revision: 1.5 }), null);
  assert.equal(orderRevision({ revision: null }), null);
  assert.equal(orderRevision({}), null);
  assert.equal(orderRevision(null), null);
});

test('mergeOrders no retrocede un pedido a una revisión anterior', () => {
  const local = [{ id: 'LT-0001', status: 'on_the_way', revision: 6 }];
  const stale = [{ id: 'LT-0001', status: 'preparing', revision: 3 }];

  const merged = mergeOrders(local, stale);
  assert.equal(merged.orders[0].status, 'on_the_way');
  assert.equal(merged.orders[0].revision, 6);
  assert.equal(merged.changed, false);
});

test('mergeOrders adopta una revisión posterior aunque el estado retroceda', () => {
  // Una cancelación legítima retrocede el estado visible pero avanza la
  // revisión. Debe aplicarse.
  const local = [{ id: 'LT-0001', status: 'on_the_way', revision: 6 }];
  const cancelled = [{ id: 'LT-0001', status: 'cancelled', revision: 7 }];

  const merged = mergeOrders(local, cancelled);
  assert.equal(merged.orders[0].status, 'cancelled');
  assert.equal(merged.changed, true);
});

// ===== Migración: revisión monótona (Gate 1 §3) =====

test('orders.revision existe, arranca en 1 y no es nullable', () => {
  assert.match(revisionSql, /add column if not exists revision bigint not null default 1/i);
});

test('la revisión la incrementa un trigger, no cada RPC', () => {
  assert.match(revisionSql, /create trigger orders_zz_bump_revision\s+before update on public\.orders/i);
  assert.match(revisionSql, /new\.revision := old\.revision \+ 1/i);
});

test('el trigger ignora cualquier revisión enviada por el cliente', () => {
  // Normaliza al valor almacenado ANTES de comparar: una revisión falsificada
  // no puede saltear ni congelar la versión real.
  const body = revisionSql.match(/create or replace function public\.bump_order_revision\(\)([\s\S]*?)\$bump\$;/i)?.[1] || '';
  assert.match(body, /new\.revision := old\.revision;/);
  const assignIndex = body.indexOf('new.revision := old.revision;');
  const compareIndex = body.indexOf('new is distinct from old');
  assert.ok(assignIndex >= 0 && compareIndex > assignIndex, 'la normalización debe preceder a la comparación');
});

test('el trigger corre después de los que modifican la fila', () => {
  // PostgreSQL dispara triggers de la misma fase en orden alfabético. El
  // prefijo zz garantiza que observe la fila ya final (updated_at, sellos).
  assert.match(revisionSql, /orders_zz_bump_revision/);
  assert.ok(
    'orders_zz_bump_revision' > 'orders_set_updated_at',
    'debe ordenarse después de orders_set_updated_at',
  );
  assert.ok(
    'orders_zz_bump_revision' > 'orders_set_status_timestamps',
    'debe ordenarse después de orders_set_status_timestamps',
  );
});

test('un UPDATE sin cambios reales no incrementa la revisión', () => {
  assert.match(revisionSql, /if new is distinct from old then/i);
});

// ===== Migración: orden total de eventos =====

test('order_events.sequence usa una secuencia, no una marca de tiempo', () => {
  // nextval() no es constante dentro de una transacción; now() sí lo es.
  assert.match(revisionSql, /create sequence if not exists public\.order_events_sequence_seq/i);
  assert.match(revisionSql, /alter column sequence set default nextval\('public\.order_events_sequence_seq'\)/i);
  assert.match(revisionSql, /alter column sequence set not null/i);
});

test('la secuencia es única y el backfill es determinista', () => {
  assert.match(revisionSql, /create unique index if not exists order_events_sequence_key/i);
  assert.match(revisionSql, /row_number\(\) over \(order by created_at, id\)/i);
  assert.match(revisionSql, /setval\(/i);
});

test('existe un índice de reproducción de historia por secuencia', () => {
  assert.match(revisionSql, /order_events_order_sequence_idx\s*\n?\s*on public\.order_events \(order_id, sequence desc\)/i);
});

test('Realtime publica la fila completa para poder transportar la revisión', () => {
  assert.match(revisionSql, /alter table public\.orders replica identity full/i);
  assert.match(revisionSql, /alter table public\.order_events replica identity full/i);
});

// ===== transition_order: CAS por revisión (Gate 1 §3) =====

test('transition_order exige autenticación y revisión esperada', () => {
  assert.match(revisionSql, /if auth\.uid\(\) is null then\s*\n\s*raise exception 'autenticacion requerida' using errcode = '42501'/i);
  assert.match(revisionSql, /p_expected_revision is null or p_expected_revision < 1/i);
});

test('transition_order bloquea la fila antes de comparar la revisión', () => {
  const body = revisionSql.match(/create or replace function public\.transition_order\(([\s\S]*?)\$transition\$;/i)?.[1] || '';
  const lockIndex = body.indexOf('for update');
  const compareIndex = body.indexOf('v_order.revision <> p_expected_revision');
  assert.ok(lockIndex >= 0, 'debe bloquear la fila');
  assert.ok(compareIndex > lockIndex, 'el bloqueo debe preceder a la comparación de revisión');
});

test('transition_order rechaza una revisión desactualizada con conflicto de serialización', () => {
  assert.match(revisionSql, /revision desactualizada: esperada %, actual %/i);
  assert.match(revisionSql, /using errcode = '40001'/i);
});

test('el doble toque es un no-op idempotente sin evento ni incremento', () => {
  assert.match(revisionSql, /if v_current_public = v_target then/i);
  assert.match(revisionSql, /'idempotent_no_op', true/i);
});

test('transition_order delega las reglas de rol y transición, no las reimplementa', () => {
  assert.match(revisionSql, /v_result := public\.change_order_status\(/i);
  // No debe reimplementar la autorización por su cuenta.
  assert.doesNotMatch(revisionSql, /has_business_role\(/i);
});

test('transition_order sólo es ejecutable por usuarios autenticados', () => {
  assert.match(
    revisionSql,
    /revoke all on function public\.transition_order\(uuid, bigint, text\)\s*\n?from public, anon, authenticated;/i,
  );
  assert.match(
    revisionSql,
    /grant execute on function public\.transition_order\(uuid, bigint, text\)\s*\n?to authenticated;/i,
  );
});

test('transition_order es SECURITY DEFINER con search_path fijo', () => {
  const header = revisionSql.match(/create or replace function public\.transition_order\([\s\S]*?as \$transition\$/i)?.[0] || '';
  assert.match(header, /security definer/i);
  assert.match(header, /set search_path = pg_catalog, public, extensions, pg_temp/i);
});

// ===== Vocabulario de estados (Gate 1 §3) =====

test('el vocabulario del contrato se traduce al vocabulario almacenado', () => {
  const norm = revisionSql.match(/create or replace function public\.normalize_order_status_vocabulary\(([\s\S]*?)\$norm\$;/i)?.[1] || '';
  assert.match(norm, /when 'received' then 'submitted'/i);
  assert.match(norm, /when 'ready_for_pickup' then 'ready'/i);
  assert.match(norm, /when 'arriving' then 'arrived'/i);
  assert.match(norm, /when 'canceled' then 'cancelled'/i);
});

test('normalize_order_status_vocabulary es immutable y no accesible a anon', () => {
  assert.match(revisionSql, /returns text\s*\n\s*language sql\s*\n\s*immutable/i);
  assert.match(revisionSql, /revoke all on function public\.normalize_order_status_vocabulary\(text\)\s*\n?from public, anon;/i);
});

// ===== Contratos preexistentes que este gate NO debe romper =====

test('la creación de pedidos sigue derivando el cliente de auth.uid()', () => {
  assert.match(orderSql, /v_customer_user_id uuid := auth\.uid\(\)/i);
  // customer_user_id no puede venir en el payload del cliente.
  const whitelist = orderSql.match(/where key not in \(([\s\S]*?)\)\s*\n\s*limit 1;/i)?.[1] || '';
  assert.ok(whitelist.length > 0, 'debe existir una whitelist de claves');
  assert.doesNotMatch(whitelist, /'customer_user_id'/i);
});

test('los ítems sólo aceptan product_id y quantity, nunca precios', () => {
  assert.match(orderSql, /where item_keys\.key not in \('product_id', 'quantity'\)/i);
  assert.match(orderSql, /cada item acepta solo product_id UUID y quantity entero/i);
});

test('el precio y el stock se leen del servidor con la fila bloqueada', () => {
  assert.match(orderSql, /select p\.\*[\s\S]{0,200}?for update/i);
  assert.match(orderSql, /v_line_subtotal := v_product\.price \* v_item\.quantity/i);
  assert.match(orderSql, /v_product\.stock < v_item\.quantity/i);
});

test('la idempotencia usa client_request_id más huella del intent normalizado', () => {
  assert.match(orderSql, /client_request_fingerprint/i);
  assert.match(orderSql, /pg_advisory_xact_lock\(/i);
  assert.match(orderSql, /client_request_id reutilizado con un payload diferente/i);
});

test('un producto inexistente para el negocio aborta la transacción entera', () => {
  assert.match(orderSql, /producto inexistente para el negocio: %/i);
  assert.match(orderSql, /using errcode = '23503'/i);
});
