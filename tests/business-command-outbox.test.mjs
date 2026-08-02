import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessCommand, createCommandOutbox, createMemoryCommandStorage } from '../js/business/business-command-outbox.js';

const commandInput = (overrides = {}) => ({ businessId: 'business-1', orderId: 'order-1', commandType: 'transition_order', expectedRevision: 2, idempotencyKey: 'idem-1', payload: { newStatus: 'preparing' }, ...overrides });

test('outbox minimiza datos sensibles y conserva contrato durable', () => {
  const command = createBusinessCommand(commandInput({ payload: { newStatus: 'preparing', password: 'blocked', deliveryCode: 'blocked', reason: 'ok' } }), { now: () => new Date('2026-08-02T10:00:00Z'), randomId: () => 'cmd-1' });
  assert.equal(command.commandId, 'cmd-1');
  assert.deepEqual(command.payload, { newStatus: 'preparing', reason: 'ok' });
  assert.equal(command.state, 'pending');
  assert.equal(command.attemptCount, 0);
});

test('enqueue es idempotente por idempotency_key', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage(), now: () => new Date('2026-08-02T10:00:00Z') });
  const first = await outbox.enqueue(commandInput());
  const second = await outbox.enqueue(commandInput());
  assert.equal(first.commandId, second.commandId);
  assert.equal((await outbox.list()).length, 1);
});

test('drain reconcilia antes de enviar y confirma exactly-once local', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage(), now: () => new Date('2026-08-02T10:00:00Z') });
  await outbox.enqueue(commandInput());
  const calls = [];
  const [result] = await outbox.drain({ reconcile: async () => { calls.push('reconcile'); return { revision: 2 }; }, send: async () => { calls.push('send'); return { ok: true, revision: 3 }; } });
  assert.deepEqual(calls, ['reconcile', 'send']);
  assert.equal(result.state, 'confirmed');
  assert.equal(result.serverRevision, 3);
});

test('reconciliaci\u00f3n evita reenv\u00edo si el servidor ya aplic\u00f3 el comando', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage(), now: () => new Date('2026-08-02T10:00:00Z') });
  await outbox.enqueue(commandInput());
  let sends = 0;
  const [result] = await outbox.drain({ reconcile: async () => ({ alreadyApplied: true, revision: 4 }), send: async () => { sends += 1; } });
  assert.equal(sends, 0);
  assert.equal(result.state, 'confirmed');
});

test('conflicto de revisi\u00f3n no se reintenta', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage(), now: () => new Date('2026-08-02T10:00:00Z') });
  await outbox.enqueue(commandInput());
  const [result] = await outbox.drain({ reconcile: async () => ({ conflict: true, revision: 5, code: 'REVISION_CONFLICT' }), send: async () => ({ ok: true }) });
  assert.equal(result.state, 'conflicted');
  assert.equal(result.serverRevision, 5);
});

test('error transitorio usa backoff y el permanente falla cerrado', async () => {
  let clock = new Date('2026-08-02T10:00:00Z');
  const storage = createMemoryCommandStorage();
  const outbox = createCommandOutbox({ storage, now: () => clock, random: () => 0.5, baseBackoffMs: 1000 });
  await outbox.enqueue(commandInput());
  const [retry] = await outbox.drain({ reconcile: async () => ({}), send: async () => ({ code: 'TIMEOUT', message: 'timeout' }) });
  assert.equal(retry.state, 'pending');
  assert.equal(retry.nextAttemptAt, '2026-08-02T10:00:01.000Z');
  clock = new Date('2026-08-02T10:00:02Z');
  const [failed] = await outbox.drain({ reconcile: async () => ({}), send: async () => ({ code: 'FORBIDDEN', message: 'denegado' }) });
  assert.equal(failed.state, 'failed');
});

test('reinicio recupera comandos abandonados en sending', async () => {
  const seed = createBusinessCommand(commandInput(), { now: () => new Date('2026-08-02T09:00:00Z'), randomId: () => 'cmd-old' });
  const storage = createMemoryCommandStorage([{ ...seed, state: 'sending', sendingStartedAt: '2026-08-02T09:00:00Z' }]);
  const outbox = createCommandOutbox({ storage, now: () => new Date('2026-08-02T10:00:00Z'), sendingLeaseMs: 60_000 });
  const recovered = await outbox.recoverAbandoned();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].state, 'pending');
  assert.equal(recovered[0].lastErrorCode, 'LEASE_EXPIRED');
});
