import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createRelayAuthority,
  hashRelayKey,
  isValidRelayKey,
} from '../scripts/realtime-relay-state.mjs';

const KEY = '24a2c7a8bf474cdfcaf4ab6449a4f6e3c07f813c84fabf09156cf0ffc2251e58';
const OTHER_KEY = 'c267641305dc671a408406524240db43303c9b7aa53b2c84bef25c22874f4418';

test('relay exige una key de alta entropía y no revela salas ajenas', async () => {
  const authority = createRelayAuthority();
  assert.equal(isValidRelayKey('short'), false);
  assert.equal(isValidRelayKey(KEY), true);
  assert.equal(authority.snapshot('room-auth', KEY).status, 404);

  await authority.reset('room-auth', KEY, 'tester');
  assert.equal(authority.snapshot('room-auth', '').status, 401);
  assert.equal(authority.snapshot('room-auth', OTHER_KEY).status, 403);
  assert.equal(authority.snapshot('room-auth', KEY).ok, true);
});

test('relay versiona sólo cambios aceptados y un cliente stale no borra el estado', async () => {
  let clock = Date.parse('2026-07-30T20:00:00.000Z');
  const authority = createRelayAuthority({ now: () => clock });
  const reset = await authority.reset('room-merge', KEY, 'resetter');
  assert.equal(reset.record.revision, 1);

  clock += 1000;
  const first = await authority.publish('room-merge', KEY, {
    orders: [{ id: 'LT-NEW', status: 'ready', updatedAt: '2026-07-30T20:00:01.000Z' }],
    lastOrderId: 'LT-NEW',
  }, 'business');
  assert.equal(first.accepted, true);
  assert.equal(first.record.revision, 2);

  const stale = await authority.publish('room-merge', KEY, {
    orders: [],
    lastOrderId: null,
  }, 'stale-client');
  assert.equal(stale.accepted, false);
  assert.equal(stale.record.revision, 2);
  assert.equal(stale.record.snapshot.orders[0].id, 'LT-NEW');

  const duplicate = await authority.publish('room-merge', KEY, first.record.snapshot, 'duplicate');
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.record.revision, 2);
});

test('persistencia opt-in recupera snapshot y guarda sólo el hash de la key', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'taba-relay-state-'));
  try {
    const first = createRelayAuthority({ stateDir: directory });
    await first.load();
    await first.reset('room-persist', KEY, 'resetter');
    await first.publish('room-persist', KEY, {
      orders: [{ id: 'LT-PERSIST', status: 'received', updatedAt: new Date().toISOString() }],
      lastOrderId: 'LT-PERSIST',
    }, 'client');

    const persistedText = await readFile(path.join(directory, 'room-persist.json'), 'utf8');
    assert.equal(persistedText.includes(KEY), false);
    assert.equal(persistedText.includes(hashRelayKey(KEY)), true);

    const second = createRelayAuthority({ stateDir: directory });
    assert.deepEqual(await second.load(), { loaded: 1 });
    const recovered = second.snapshot('room-persist', KEY);
    assert.equal(recovered.record.snapshot.orders[0].id, 'LT-PERSIST');
    assert.equal(recovered.record.revision, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
