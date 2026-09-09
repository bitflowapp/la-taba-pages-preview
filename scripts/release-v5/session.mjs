import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PROJECT, LOCK } from './model.mjs';

export function databaseConfiguration(raw, caFile) {
  assert.ok(raw, 'TABA_A1_A4_DATABASE_URL required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('invalid database URL'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert.equal(url.search, '', 'database URL overrides are forbidden');
  assert.equal(url.hash, '', 'database URL fragment is forbidden');
  assert.equal(url.pathname, '/postgres', 'production database required');
  assert.ok(!url.port || url.port === '5432', 'direct/session connection on port 5432 required');
  const direct = url.hostname === `db.${PROJECT}.supabase.co`;
  const pooler = /^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/.test(url.hostname);
  assert.ok(direct || pooler, 'untrusted production DB host');
  assert.equal(decodeURIComponent(url.username), direct ? 'postgres' : `postgres.${PROJECT}`, 'production database user mismatch');
  assert.ok(url.password, 'database password required');
  return {
    host: url.hostname, port: 5432, database: 'postgres', user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: true, ...(caFile ? { ca: fs.readFileSync(caFile, 'utf8') } : {}) },
    connectionTimeoutMillis: 15_000, statement_timeout: 30_000, lock_timeout: 5000,
    query_timeout: 35_000, keepAlive: true, keepAliveInitialDelayMillis: 5000,
    options: '-c default_transaction_read_only=off -c search_path=pg_catalog,public,extensions',
  };
}

export class Session {
  constructor(client, platform, applicationName) {
    this.client = client;
    this.platform = platform;
    this.applicationName = applicationName;
    this.locked = false;
    this.lost = false;
    client.on?.('error', () => { this.lost = true; this.onLost?.(); });
    client.on?.('end', () => { this.lost = true; this.onLost?.(); });
  }
  static async connect(platform, raw, caFile, { readOnly = false } = {}) {
    const applicationName = `taba-v5:${randomUUID()}`;
    const config = databaseConfiguration(raw, caFile);
    if (readOnly) config.options = '-c default_transaction_read_only=on -c search_path=pg_catalog,public,extensions';
    const client = new Client({ ...config, application_name: applicationName });
    const session = new Session(client, platform, applicationName);
    await client.connect();
    try {
      const row = await session.one('select pg_backend_pid() as pid,current_database() as database,current_user as db_user');
      assert.equal(row.database, 'postgres'); assert.equal(row.db_user, 'postgres');
      session.pid = row.pid;
      await platform.bindSession(session, false);
      return session;
    } catch (error) { await session.close(); throw error; }
  }
  async query(sql, values = []) {
    assert.equal(this.lost, false, 'release DB session lost');
    return this.client.query(sql, values);
  }
  async one(sql, values = []) {
    const result = await this.query(sql, values);
    assert.equal(result.rows.length, 1, 'unexpected DB result cardinality');
    return result.rows[0];
  }
  async value(sql, values = []) { const row = await this.one(sql, values); assert.equal(Object.keys(row).length, 1); return Object.values(row)[0]; }
  async acquire(timeoutMs = 30_000, signal) {
    assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 120_000);
    const deadline = Date.now() + timeoutMs;
    do {
      signal?.throwIfAborted();
      const acquisition = await this.one('select pg_backend_pid() as pid,pg_try_advisory_lock($1::integer,$2::integer) as acquired', LOCK);
      if (acquisition.acquired === true) { this.locked = true; this.lockPid = acquisition.pid; await this.ownership(); return; }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() <= deadline);
    throw new Error('release lock timeout; another runner owns production');
  }
  async ownership() {
    assert.equal(this.locked, true, 'release lock not acquired');
    const row = await this.one(`select pg_backend_pid() as pid, exists(select 1 from pg_locks
      where locktype='advisory' and pid=pg_backend_pid() and classid=$1::oid and objid=$2::oid
      and objsubid=2 and mode='ExclusiveLock' and granted) as owned`, LOCK);
    assert.equal(row.pid, this.pid, 'DB session switched (transaction pooler forbidden)');
    assert.equal(row.owned, true, 'release lock ownership lost');
    await this.platform.bindSession(this, true);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.onLost = undefined;
    if (this.locked && !this.lost) {
      try {
        await this.query(`select case when pg_backend_pid()=$3 and current_setting('application_name')=$4
          then pg_advisory_unlock($1::integer,$2::integer) else false end`, [...LOCK,this.lockPid,this.applicationName]);
      } catch { /* disconnect also releases this session's lock */ }
    }
    await this.client.end().catch(() => {});
    this.locked = false;
  }
}
