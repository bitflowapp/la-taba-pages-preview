// A project can be created ONLY in the dedicated La Taba Free organization.
// There are no subscription, transfer, pause, delete or addon API calls here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { FREE_RECOVERY_ORGANIZATION_ID } from './plan.mjs';

const FORBIDDEN_ORGS = new Set(['qdhfqytbvgpvhxbbcomv', 'hliypylbqsgkdqvyzbvz', 'wtkbslopsldgvylukaem']);
export async function provisionFreeProject({ receipt, request, savePassword }) {
  if (receipt.organizationId !== FREE_RECOVERY_ORGANIZATION_ID || FORBIDDEN_ORGS.has(receipt.organizationId) ||
    receipt.name !== 'La Taba' || receipt.plan !== 'free' || receipt.paidProjectAuthorized !== false) {
    throw new Error('Dedicated La Taba Free organization required');
  }
  const metadata = await request(`/v1/organizations/${receipt.organizationId}`, { method: 'GET' });
  if (metadata.status !== 200 || metadata.body.id !== receipt.organizationId ||
    metadata.body.name !== 'La Taba' || metadata.body.plan !== 'free') {
    throw new Error('Live organization identity/plan mismatch; project creation refused');
  }
  const listing = await request('/v1/projects', { method: 'GET' });
  if (listing.status !== 200 || !Array.isArray(listing.body)) throw new Error('Unable to verify existing projects');
  const children = listing.body.filter(project => project.organization_id === receipt.organizationId);
  const existing = children.find(project => project.name === 'la-taba-recovery-test');
  if (existing) return { status: 'already_exists', projectRef: existing.id, additionalCostUSD: 0 };
  if (children.length) throw new Error('Dedicated organization contains an unexpected project');

  const password = randomBytes(36).toString('base64url');
  const result = await request('/v1/projects', { method: 'POST', body: {
    organization_slug: receipt.organizationId, name: 'la-taba-recovery-test',
    db_pass: password, region: 'sa-east-1',
    // Default smallest Free compute. No instance-size override or paid addon.
  } });
  if (result.status !== 201 && result.status !== 200) {
    const raw = String(result.body?.message || 'Provider refused project creation');
    const message = raw.replaceAll(password, '[redacted]').replace(/(?:sbp_|sb_secret_|APP_USR-|TEST-)[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1200);
    return { status: 'blocked', httpStatus: result.status, message, projectCreated: false,
      additionalCostUSD: 0, freeQuotaRejected: /(?:free.*project|project.*free).*(?:limit|maximum)|(?:limit|maximum).*(?:free.*project|project.*free)/i.test(message) };
  }
  const project = result.body;
  if (!/^[a-z]{20}$/.test(project.id || '') || project.name !== 'la-taba-recovery-test' ||
    project.organization_id !== receipt.organizationId) throw new Error('Unexpected project provisioning identity');
  await savePassword(project.id, password);
  return { status: 'created', httpStatus: result.status, projectCreated: true,
    additionalCostUSD: 0, project: { id: project.id, name: project.name, organization_id: project.organization_id,
      region: project.region, status: project.status, created_at: project.created_at } };
}

async function main() {
  if (!process.argv.includes('--create-project')) {
    console.log('No writes. --create-project explicitly requests a project in the dedicated verified Free organization.');
    return;
  }
  const receipt = JSON.parse(fs.readFileSync('deploy/recovery-free-organization.json', 'utf8'));
  const { conToken } = await import('../lib/supabase-cli-token.mjs');
  const { guardarSecreto } = await import('../e2e-production-sale/secretos-windows.mjs');
  await conToken(async token => {
    const request = async (url, init) => {
      const response = await fetch('https://api.supabase.com' + url, {
        method: init.method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(30000),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const result = await provisionFreeProject({ receipt, request,
      savePassword: (ref, password) => guardarSecreto('RECOVERY FREE DB PASSWORD', ref, password) });
    const evidence = { capturedAt: new Date().toISOString(), organizationId: receipt.organizationId,
      organizationPlan: 'free', requestedPaidResources: false, ...result };
    fs.writeFileSync('docs/audit/2026-10-20-free-provisioning-attempt.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Free-only provisioning stopped; no subscription changes attempted.'); process.exitCode = 1; });
}
