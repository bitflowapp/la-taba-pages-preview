import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionFreeProject } from '../scripts/recovery/provision-free-project.mjs';

const receipt = { organizationId: 'tpdpuvnasszkcpdanxpk', name: 'La Taba', plan: 'free', paidProjectAuthorized: false };
const metadata = { id: receipt.organizationId, name: 'La Taba', plan: 'free' };
const existingProject = { id: 'abcdefghijklmnopqrst', name: 'la-taba-recovery-test', organization_id: receipt.organizationId };

test('free-only provisioner rejects Pro and existing unrelated organizations before network access', async () => {
  let requests = 0;
  for (const patch of [{ plan: 'pro' }, { organizationId: 'qdhfqytbvgpvhxbbcomv' },
    { organizationId: 'hliypylbqsgkdqvyzbvz' }, { organizationId: 'wtkbslopsldgvylukaem' },
    { paidProjectAuthorized: true }]) {
    await assert.rejects(() => provisionFreeProject({ receipt: { ...receipt, ...patch },
      request: async () => { requests++; }, savePassword: () => {} }));
  }
  assert.equal(requests, 0);
});

test('a live plan change to Pro blocks creation even with a previously Free receipt', async () => {
  const calls = [];
  await assert.rejects(() => provisionFreeProject({ receipt,
    request: async (url, init) => { calls.push(init.method); return { status: 200, body: { ...metadata, plan: 'pro' } }; },
    savePassword: () => {} }));
  assert.deepEqual(calls, ['GET']);
});

test('an existing recovery project is reused without a second creation request', async () => {
  const calls = [];
  const result = await provisionFreeProject({ receipt, request: async (url, init) => {
    calls.push(init.method);
    return { status: 200, body: url.endsWith('/projects') ? [existingProject] : metadata };
  }, savePassword: () => { throw new Error('not needed'); } });
  assert.equal(result.status, 'already_exists'); assert.deepEqual(calls, ['GET', 'GET']);
});

test('quota rejection never triggers pause, delete, upgrade, transfer, retry or a paid fallback', async () => {
  const calls = [];
  const result = await provisionFreeProject({ receipt, request: async (url, init) => {
    calls.push({ url, method: init.method });
    if (init.method === 'POST') {
      assert.equal(init.body.organization_slug, receipt.organizationId);
      assert.equal(init.body.desired_instance_size, undefined);
      assert.equal(init.body.high_availability, undefined);
      assert.equal(init.body.plan, undefined, 'deprecated plan field cannot be used as a billing guard');
      return { status: 400, body: { message: 'Maximum active free projects reached (2 project limit).' } };
    }
    return { status: 200, body: url.endsWith('/projects') ? [] : metadata };
  }, savePassword: () => { throw new Error('No project was created'); } });
  assert.equal(result.projectCreated, false); assert.equal(result.freeQuotaRejected, true);
  assert.equal(result.additionalCostUSD, 0);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'POST']);
  assert.equal(calls.at(-1).url, '/v1/projects');
});

test('project identity must match the dedicated organization before its password is stored', async () => {
  let stores = 0;
  await assert.rejects(() => provisionFreeProject({ receipt, request: async (url, init) => {
    if (init.method === 'POST') return { status: 201, body: { ...existingProject, organization_id: 'qdhfqytbvgpvhxbbcomv' } };
    return { status: 200, body: url.endsWith('/projects') ? [] : metadata };
  }, savePassword: () => { stores++; } }));
  assert.equal(stores, 0);
});

test('successful Free creation passes the generated password only to the private credential store', async () => {
  let secret, stored = false;
  const result = await provisionFreeProject({ receipt, request: async (url, init) => {
    if (init.method === 'POST') { secret = init.body.db_pass; return { status: 201, body: existingProject }; }
    return { status: 200, body: url.endsWith('/projects') ? [] : metadata };
  }, savePassword: (ref, password) => { assert.equal(ref, existingProject.id); assert.equal(password, secret); stored = true; } });
  assert.equal(stored, true); assert.equal(result.additionalCostUSD, 0);
  assert.ok(secret.length >= 36); assert.equal(JSON.stringify(result).includes(secret), false);
});
