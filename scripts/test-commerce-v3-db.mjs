import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

assert.equal(process.env.TABA_LOCAL_COMMERCE_DB, '1', 'Only an explicitly isolated local run is supported');
const root = path.resolve(import.meta.dirname, '..');
const container = `taba-commerce-v3-test-${randomUUID().slice(0, 8)}`;
const image = 'public.ecr.aws/supabase/postgres:17.6.1.166';
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const sql = (text) => docker(['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], text);
let started = false;
try {
  docker(['run', '-d', '--name', container, '--network', 'none', '--user', 'postgres',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=256m,uid=100,gid=101', '--tmpfs', '/tmp:rw,size=64m',
    '--entrypoint', '/bin/sh', image, '-c',
    'initdb -D /var/lib/postgresql/data/db -U postgres -A trust >/tmp/init.log && postgres -D /var/lib/postgresql/data/db -k /tmp -c listen_addresses=127.0.0.1']);
  started = true;
  for (let attempt = 0; ; attempt++) {
    try { docker(['exec', container, 'pg_isready', '-h', '/tmp', '-U', 'postgres']); break; }
    catch (error) { if (attempt >= 60) throw error; await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  sql(fs.readFileSync(path.join(root, 'tests/fixtures/commerce-v3-database.sql'), 'utf8'));
  const historical = fs.readFileSync(path.join(root, 'supabase/migrations/20260802160000_business_windows_scanner_fiscal.sql'), 'utf8');
  const gtin = historical.match(/create or replace function public\.gtin_check_digit_valid[\s\S]*?\$gtin\$;/)?.[0];
  assert.ok(gtin, 'use the real historical GTIN validator');
  sql(gtin);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260913011340_commerce_v3_product_draft_details.sql'), 'utf8'));
  const output = sql(fs.readFileSync(path.join(root, 'supabase/tests/commerce_v3_drafts_test.sql'), 'utf8'));
  console.log(output);
  assert.doesNotMatch(output, /^not ok\b/m);
  assert.match(output, /^1\.\.16$/m);
  assert.equal((output.match(/^ok \d+ /gm) || []).length, 16);
  console.log('COMMERCE_V3_DATABASE: 16/16 PASS; no provider I/O; no production data');
} finally {
  if (started) {
    const inspected = JSON.parse(docker(['inspect', container]))[0];
    assert.equal(inspected.Name, `/${container}`);
    assert.equal(inspected.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', container]);
  }
}
