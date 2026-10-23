import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectBackup, inspectPublicTarget, publicRuntimeTarget } from '../scripts/audit-la-taba-recovery.mjs';

test('a catalog and order summary are never reported as a full recoverable backup', () => {
  const result = inspectBackup(Buffer.from(JSON.stringify({
    timestamp: '2026-09-18T00:00:00Z', project_ref: 'wwcpogltfgzgkrlilbcd',
    data: { products: [{ name: 'private', price: '100', stock: 9 }], orders_summary: [{ count: 3 }] },
    schema: { functions: [{ definition: 'private-definition' }] },
  })));
  assert.equal(result.fullRecoveryVerified, false);
  assert.equal(result.dataEntries.products, 1);
  assert.ok(result.missingOperationalTables.includes('orders'));
  assert.equal(result.historicalStockMustBeReconciled, true);
  assert.doesNotMatch(JSON.stringify(result), /private|definition/);
});

test('runtime discovery reads only the public project URL without executing JavaScript', () => {
  assert.equal(publicRuntimeTarget('throw new Error(); {"supabaseUrl":"https://wwcpogltfgzgkrlilbcd.supabase.co","publishableKey":"private"}'),
    'https://wwcpogltfgzgkrlilbcd.supabase.co');
  assert.equal(publicRuntimeTarget('supabaseUrl: "https://attacker.invalid"'), null);
});

test('incident probe uses only public GETs, reports DNS failure, and omits credentials and arbitrary version data', async () => {
  const requests = [];
  const result = await inspectPublicTarget({ environment: 'production', ref: 'wwcpogltfgzgkrlilbcd', origin: 'https://la-taba.pages.dev' }, {
    request: async (url, options) => {
      requests.push({ url, method: options.method || 'GET' });
      return url.endsWith('version.json')
        ? Response.json({ commit: 'a'.repeat(40), runtime: 'fixture', secret: 'must-stay-private' })
        : new Response('{ supabaseUrl: "https://wwcpogltfgzgkrlilbcd.supabase.co", publishableKey: "must-stay-private" }');
    },
    resolve: () => { throw Object.assign(new Error('fixture'), { code: 'ENOTFOUND' }); },
  });
  assert.deepEqual(requests.map(r => r.method), ['GET', 'GET']);
  assert.equal(result.supabaseDns, 'ENOTFOUND');
  assert.equal(result.version.commit, 'a'.repeat(40));
  assert.doesNotMatch(JSON.stringify(result), /private|publishableKey/);
});
