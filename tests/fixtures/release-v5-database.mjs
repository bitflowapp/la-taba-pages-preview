// Actual node-postgres protocol over docker exec stdin/stdout. The PostgreSQL
// listener is inside a network=none container; there is no published host port.
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { spawn, execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { Session } from '../../scripts/release-v5/session.mjs';

export function assertLocalContainer(container) {
  assert.equal(process.env.TABA_LOCAL_PAYMENT_DB, '1');
  assert.match(container || '', /^taba-a1-a4-local-[\w-]+$/);
  const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
  assert.equal(info.HostConfig.NetworkMode, 'none');
  assert.equal(info.Mounts.some(m => m.Type === 'bind'), false);
  assert.ok(!info.HostConfig.PortBindings || Object.keys(info.HostConfig.PortBindings).length === 0);
}
class DockerSocket extends Duplex {
  constructor(container) { super(); this.container = container; }
  setNoDelay() {} setKeepAlive() {}
  connect() {
    this.child = spawn('docker', ['exec', '-i', this.container, 'busybox', 'nc', '127.0.0.1', '5432'], { windowsHide: true });
    this.child.stdout.on('data', c => this.push(c));
    this.child.stderr.resume();
    this.child.on('error', e => this.destroy(e));
    this.child.on('close', () => this.push(null));
    this.child.once('spawn', () => this.emit('connect'));
  }
  _read() {}
  _write(chunk, _encoding, callback) { this.child.stdin.write(chunk, callback); }
  _final(callback) { this.child.stdin.end(); callback(); }
  _destroy(error, callback) { this.child?.stdin.end(); this.child?.kill(); callback(error); }
}
export async function localClient(container, applicationName = `taba-v5-test:${randomUUID()}`) {
  assertLocalContainer(container);
  const client = new Client({ host: '127.0.0.1', user: 'postgres', database: 'postgres',
    ssl: false, stream: new DockerSocket(container), application_name: applicationName,
    connectionTimeoutMillis: 5000, statement_timeout: 30_000, lock_timeout: 5000, query_timeout: 35_000,
  });
  client.on('error', () => {});
  await client.connect();
  return client;
}
export async function localSession(container, platform) {
  const applicationName = `taba-v5:${randomUUID()}`;
  const client = await localClient(container, applicationName);
  const session = new Session(client, platform, applicationName);
  session.pid = (await client.query('select pg_backend_pid() as pid')).rows[0].pid;
  return session;
}
