// Read-only incident inventory. Never creates projects, retrieves API keys,
// executes SQL, loads payment credentials, or attempts a restoration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';

export const TARGETS = Object.freeze([
  { environment: 'production', ref: 'wwcpogltfgzgkrlilbcd', origin: 'https://la-taba.pages.dev' },
  { environment: 'staging', ref: 'ucbtjcurawxjwjdvvcvj', origin: 'https://taba2-staging.pages.dev' },
  { environment: 'pilot', ref: 'tkanbadcglszlcyfjvpv', origin: 'https://la-taba-commercial-pilot.pages.dev' },
]);

export function inspectBackup(bytes) {
  const document = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const data = document.data || {};
  const fullTablesRequired = ['orders', 'order_items', 'payment_intents', 'payment_attempts',
    'inventory_reservations', 'business_memberships', 'mp_seller_connections'];
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    recordedAt: Number.isFinite(Date.parse(document.timestamp)) ? document.timestamp : null,
    projectRef: /^[a-z]{20}$/.test(document.project_ref || '') ? document.project_ref : null,
    migrations: Array.isArray(document.migrations) ? document.migrations.length : 0,
    schemaEntries: Object.fromEntries(Object.entries(document.schema || {})
      .map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : null])),
    dataEntries: Object.fromEntries(Object.entries(data)
      .map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : null])),
    missingOperationalTables: fullTablesRequired.filter(name => !Array.isArray(data[name])),
    // Mere presence of some rows cannot establish referential completeness,
    // restoreability, Auth coverage, Storage bytes, or the freshness of stock.
    fullRecoveryVerified: false,
    historicalStockMustBeReconciled: true,
  };
}

export function publicRuntimeTarget(source) {
  const match = /["']?supabaseUrl["']?\s*:\s*["'](https:\/\/[a-z]{20}\.supabase\.co)["']/.exec(source);
  return match ? match[1] : null;
}

export async function inspectPublicTarget(target, { request = fetch, resolve = lookup } = {}) {
  const result = { environment: target.environment, expectedRef: target.ref, origin: target.origin };
  for (const resource of ['version.json', 'runtime-config.js']) {
    try {
      const response = await request(`${target.origin}/${resource}`, { signal: AbortSignal.timeout(10000) });
      const source = await response.text();
      if (resource === 'runtime-config.js') {
        result.runtime = { httpStatus: response.status, supabaseUrl: publicRuntimeTarget(source) };
      } else {
        let version = {};
        try { version = JSON.parse(source); } catch { /* HTML/404 is not release evidence. */ }
        result.version = { httpStatus: response.status,
          commit: /^[a-f0-9]{40}$/.test(version.commit || '') ? version.commit : null,
          runtime: /^[\w-]{1,120}$/.test(version.runtime || '') ? version.runtime : null };
      }
    } catch { result[resource === 'version.json' ? 'version' : 'runtime'] = { unavailable: true }; }
  }
  try { await resolve(`${target.ref}.supabase.co`); result.supabaseDns = 'resolved'; }
  catch (error) { result.supabaseDns = ['ENOTFOUND', 'EAI_AGAIN'].includes(error.code) ? error.code : 'lookup_failed'; }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const evidence = {
    capturedAt: new Date().toISOString(),
    repository: 'bitflowapp/la-taba-pages-preview',
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    mutations: false,
    targets: await Promise.all(TARGETS.map(target => inspectPublicTarget(target))),
    local: {
      migrationFiles: fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).length,
      edgeFunctions: fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('_')).map(entry => entry.name).sort(),
    },
  };
  if (value('--backup')) evidence.backup = inspectBackup(fs.readFileSync(value('--backup')));
  if (args.includes('--management')) {
    const { conToken } = await import('./lib/supabase-cli-token.mjs');
    await conToken(async token => {
      for (const target of evidence.targets) {
        const response = await fetch(`https://api.supabase.com/v1/projects/${target.expectedRef}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
        });
        // No response body is persisted: project settings may contain secrets.
        target.management = { httpStatus: response.status,
          originalProjectAccessible: response.ok };
      }
    });
  }
  const output = JSON.stringify(evidence, null, 2) + '\n';
  if (value('--output')) fs.writeFileSync(value('--output'), output, { flag: 'wx' });
  else process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Recovery inventory failed; no remote changes were attempted.'); process.exitCode = 1; });
}
