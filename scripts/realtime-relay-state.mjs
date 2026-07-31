import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  mergeRealtimeSnapshots,
  normalizeRealtimeSnapshot,
} from '../js/core/realtime-sync.js';

export const RELAY_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const KEY_PATTERN = /^(?:[a-fA-F0-9]{64,128}|[a-zA-Z0-9_-]{43,128})$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function normalizeRelayRoom(value) {
  const room = String(value || '').trim();
  return ROOM_PATTERN.test(room) ? room : '';
}

export function isValidRelayKey(value) {
  return KEY_PATTERN.test(String(value || '').trim());
}

export function hashRelayKey(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function createRelayAuthority({
  stateDir = '',
  ttlMs = RELAY_ROOM_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const rooms = new Map();
  const persistenceDir = String(stateDir || '').trim()
    ? path.resolve(String(stateDir).trim())
    : '';

  async function load() {
    if (!persistenceDir) return { loaded: 0 };
    await mkdir(persistenceDir, { recursive: true });
    let entries = [];
    try {
      entries = await readdir(persistenceDir, { withFileTypes: true });
    } catch (_) {
      return { loaded: 0 };
    }

    let loaded = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(persistenceDir, entry.name);
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        const record = normalizePersistedRecord(parsed);
        if (!record || isExpired(record)) {
          await rm(file, { force: true });
          continue;
        }
        rooms.set(record.room, record);
        loaded += 1;
      } catch (_) {
        await rm(file, { force: true }).catch(() => undefined);
      }
    }
    return { loaded };
  }

  async function reset(roomValue, keyValue, publisher = 'reset') {
    const auth = authorize(roomValue, keyValue, { allowCreate: true });
    if (!auth.ok) return auth;
    const record = auth.record;
    record.revision += 1;
    record.snapshot = normalizeRealtimeSnapshot();
    record.updatedAt = now();
    record.lastPublisher = sanitizePublisher(publisher);
    await persist(record);
    return { ok: true, accepted: true, record: cloneRecord(record) };
  }

  async function publish(roomValue, keyValue, incoming, publisher = '') {
    const auth = authorize(roomValue, keyValue);
    if (!auth.ok) return auth;
    const record = auth.record;
    const { snapshot, changed } = mergeRealtimeSnapshots(record.snapshot, incoming);
    if (!changed) {
      return { ok: true, accepted: false, record: cloneRecord(record) };
    }

    record.snapshot = snapshot;
    record.revision += 1;
    record.updatedAt = now();
    record.lastPublisher = sanitizePublisher(publisher);
    await persist(record);
    return { ok: true, accepted: true, record: cloneRecord(record) };
  }

  function snapshot(roomValue, keyValue) {
    const auth = authorize(roomValue, keyValue);
    if (!auth.ok) return auth;
    return { ok: true, record: cloneRecord(auth.record) };
  }

  async function cleanupExpired() {
    const expired = [];
    for (const [room, record] of rooms) {
      if (!isExpired(record)) continue;
      rooms.delete(room);
      expired.push(room);
      if (persistenceDir) {
        await rm(roomFile(room), { force: true }).catch(() => undefined);
      }
    }
    return { expired };
  }

  function authorize(roomValue, keyValue, { allowCreate = false } = {}) {
    const room = normalizeRelayRoom(roomValue);
    if (!room) return authError(400, 'invalid_room');
    const key = String(keyValue || '').trim();
    if (!isValidRelayKey(key)) return authError(401, 'missing_or_invalid_key');

    const keyHash = hashRelayKey(key);
    let record = rooms.get(room);
    if (!record) {
      if (!allowCreate) return authError(404, 'room_not_found');
      record = {
        room,
        keyHash,
        revision: 0,
        snapshot: normalizeRealtimeSnapshot(),
        updatedAt: now(),
        lastPublisher: '',
      };
      rooms.set(room, record);
      return { ok: true, record, created: true };
    }

    if (!safeHashEqual(record.keyHash, keyHash)) {
      return authError(403, 'invalid_key');
    }
    if (isExpired(record)) return authError(410, 'room_expired');
    return { ok: true, record, created: false };
  }

  async function persist(record) {
    if (!persistenceDir) return;
    await mkdir(persistenceDir, { recursive: true });
    const target = roomFile(record.room);
    const temporary = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    const serializable = {
      version: 1,
      room: record.room,
      keyHash: record.keyHash,
      revision: record.revision,
      snapshot: record.snapshot,
      updatedAt: record.updatedAt,
      lastPublisher: record.lastPublisher,
    };
    await writeFile(temporary, `${JSON.stringify(serializable)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, target);
  }

  function roomFile(room) {
    return path.join(persistenceDir, `${room}.json`);
  }

  function isExpired(record) {
    const age = now() - Number(record.updatedAt || 0);
    return Number.isFinite(age) && age > Math.max(1, Number(ttlMs) || RELAY_ROOM_TTL_MS);
  }

  return {
    cleanupExpired,
    load,
    publish,
    reset,
    roomCount: () => rooms.size,
    snapshot,
  };
}

function normalizePersistedRecord(value) {
  const room = normalizeRelayRoom(value?.room);
  const keyHash = String(value?.keyHash || '').toLowerCase();
  const revision = Number(value?.revision);
  const updatedAt = Number(value?.updatedAt);
  if (!room || !HASH_PATTERN.test(keyHash)) return null;
  if (!Number.isInteger(revision) || revision < 1) return null;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return {
    room,
    keyHash,
    revision,
    snapshot: normalizeRealtimeSnapshot(value?.snapshot),
    updatedAt,
    lastPublisher: sanitizePublisher(value?.lastPublisher),
  };
}

function safeHashEqual(left, right) {
  try {
    const a = Buffer.from(String(left || ''), 'hex');
    const b = Buffer.from(String(right || ''), 'hex');
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function sanitizePublisher(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function authError(status, code) {
  return { ok: false, status, code };
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}
