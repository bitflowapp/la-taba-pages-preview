import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePilotPreflight, loadPilotPreflight, probeOnlinePaymentsBackend } from '../scripts/deploy/pilot-preflight.mjs';

const ref = 'abcdefghijklmnopqrst';
const businessId = '116d8f37-29f5-40f1-a692-81b86b69a72c';
const plan = { projectRef: ref, businessId,
  approvedSkus: ['one-sku', 'two-sku', 'three-sku', 'four-sku', 'five-sku'] };
const config = {
  schemaVersion: 1, deploymentEnvironment: 'pilot', manualPaymentOnly: true,
  supabaseProjectRef: ref, businessId, cloudflareProject: 'la-taba-commercial-pilot',
  customerUrl: 'https://la-taba-commercial-pilot.pages.dev/',
  businessPanelUrl: 'https://la-taba-commercial-pilot.pages.dev/#business',
  rider: { targetMode: 'pilot', backendRef: ref,
    packageId: 'com.lataba.rider.pilot', versionName: '0.1.3-canonical-pilot', versionCode: 4 },
};
const ownerCredentials = { publishableKey: 'sb_publishable_TEST_ONLY', accessToken: 'TEST_ONLY' };
const receipt = { target: 'pilot', backend: ref, packageId: 'com.lataba.rider.pilot',
  versionName: '0.1.3-canonical-pilot', versionCode: 4,
  certificateSha256: '2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa',
  apkFile: 'apps/rider-android/app/build/outputs/apk/release/app-release.apk',
  apkSha256: 'a'.repeat(64) };

test('PILOT_PREFLIGHT validates isolated config, allowlist, Rider and secret presence', () => {
  assert.equal(validatePilotPreflight(config, plan, { ownerCredentials }).status, 'PASS');
  assert.throws(() => validatePilotPreflight(config, { ...plan, approvedSkus: [] },
    { ownerCredentials }), /PILOT_APPROVED_SKU_ALLOWLIST_REQUIRED/);
  assert.throws(() => validatePilotPreflight(config, plan, {}), /PILOT_OWNER_SECRETS_REQUIRED/);
  assert.throws(() => validatePilotPreflight({ ...config, supabaseProjectRef: 'wwcpogltfgzgkrlilbcd' },
    plan, { ownerCredentials }), /PILOT_BACKEND_MUST_BE_NEW_AND_ISOLATED/);
  assert.throws(() => validatePilotPreflight({ ...config, supabaseProjectRef: 'ucbtjcurawxjwjdvvcvj' },
    { ...plan, projectRef: 'ucbtjcurawxjwjdvvcvj' }, { ownerCredentials }),
  /PILOT_BACKEND_MUST_BE_NEW_AND_ISOLATED/);
  assert.throws(() => validatePilotPreflight({ ...config,
    rider: { ...config.rider, backendRef: 'ucbtjcurawxjwjdvvcvj' } },
  plan, { ownerCredentials }), /RIDER_BACKEND_REF_MISMATCH/);
  assert.throws(() => validatePilotPreflight({ ...config, customerUrl: 'https://la-taba.pages.dev' },
    plan, { ownerCredentials }), /PILOT_WEB_HOST_MUST_BE_ISOLATED/);
  assert.throws(() => validatePilotPreflight({ ...config, customerUrl: 'https://unrelated.pages.dev' },
    plan, { ownerCredentials }), /PILOT_MUST_USE_DEDICATED_PAGES_HOST/);
});

test('deployment phase requires Cloudflare secrets and matching signed Rider receipt', () => {
  assert.throws(() => validatePilotPreflight(config, plan,
    { phase: 'deploy', ownerCredentials, buildReceipt: receipt }),
  /PILOT_CLOUDFLARE_SECRETS_REQUIRED/);
  const cloudflare = { accountId: 'a'.repeat(32), apiToken: 'TEST_ONLY_TOKEN_AT_LEAST_20_CHARS' };
  assert.throws(() => validatePilotPreflight(config, plan, { phase: 'deploy', ownerCredentials,
    cloudflare, buildReceipt: { ...receipt, backend: 'wwcpogltfgzgkrlilbcd' } }),
  /RIDER_BUILD_BACKEND_MISMATCH/);
  assert.equal(validatePilotPreflight(config, plan,
    { phase: 'deploy', ownerCredentials, cloudflare, buildReceipt: receipt }).status, 'PASS');
  assert.equal(validatePilotPreflight(config, plan,
    { phase: 'e2e', ownerCredentials: { publishableKey: ownerCredentials.publishableKey },
      buildReceipt: receipt }).status, 'PASS');
});

test('committed template cannot satisfy live preflight', () => {
  assert.throws(() => loadPilotPreflight({
    configFile: 'deploy/pilot-environment.template.json',
    approvalFile: 'catalog/pilot-approved-template.json',
  }), /APPROVAL_FILE_MUST_BE_OUTSIDE_REPO/);
});

test('tech-ready mode deploys with an EMPTY public allowlist and never imports', () => {
  const technical = { ...config, catalogMode: 'none', catalogApprovalFile: null };
  const empty = { projectRef: ref, businessId, approvedSkus: [] };
  const cloudflare = { accountId: 'a'.repeat(32), apiToken: 'TEST_ONLY_TOKEN_AT_LEAST_20_CHARS' };
  const publicOnly = { publishableKey: ownerCredentials.publishableKey };
  const report = validatePilotPreflight(technical, empty,
    { phase: 'deploy', ownerCredentials: publicOnly, cloudflare, buildReceipt: receipt });
  assert.equal(report.status, 'PASS');
  assert.equal(report.catalogMode, 'none');
  assert.deepEqual(report.approvedSkus, []);
  assert.throws(() => validatePilotPreflight(technical, empty, { phase: 'catalog', ownerCredentials }),
    /PILOT_CATALOG_IMPORT_REQUIRES_OWNER_APPROVAL/);
  assert.throws(() => validatePilotPreflight(technical, plan,
    { phase: 'deploy', ownerCredentials: publicOnly, cloudflare, buildReceipt: receipt }),
  /TECH_READY_MODE_MUST_PUBLISH_NOTHING/);
  assert.throws(() => validatePilotPreflight({ ...technical, catalogApprovalFile: 'x.json' }, empty,
    { phase: 'deploy', ownerCredentials: publicOnly, cloudflare, buildReceipt: receipt }),
  /TECH_READY_MODE_HAS_NO_APPROVAL_FILE/);
  assert.throws(() => validatePilotPreflight({ ...technical, catalogMode: 'historical' }, empty,
    { phase: 'deploy', ownerCredentials: publicOnly, cloudflare, buildReceipt: receipt }),
  /PILOT_CATALOG_MODE_INVALID/);
  assert.throws(() => validatePilotPreflight({ ...technical, supabaseProjectRef: 'wwcpogltfgzgkrlilbcd' },
    { ...empty, projectRef: 'wwcpogltfgzgkrlilbcd' },
    { phase: 'deploy', ownerCredentials: publicOnly, cloudflare, buildReceipt: receipt }),
  /PILOT_BACKEND_MUST_BE_NEW_AND_ISOLATED/);
});

test('PILOT_PREFLIGHT keeps manual payments unless online payments carry a named approval', () => {
  assert.equal(validatePilotPreflight(config, plan, { ownerCredentials }).onlinePayments, false);
  const online = { ...config, manualPaymentOnly: false };
  assert.throws(() => validatePilotPreflight(online, plan, { ownerCredentials }), /PILOT_ONLINE_PAYMENTS_PROVIDER_REQUIRED/);
  const approval = { provider: 'mercadopago-oauth', runbook: 'docs/MERCADOPAGO_PRODUCCION_CP.md',
    approvedBy: 'Walter, dueño de La Taba', approvedAt: '2026-10-01' };
  assert.equal(validatePilotPreflight({ ...online, onlinePayments: approval }, plan, { ownerCredentials }).onlinePayments, true);
  assert.throws(() => validatePilotPreflight({ ...online, onlinePayments: { ...approval, approvedBy: ' ' } }, plan, { ownerCredentials }),
    /PILOT_ONLINE_PAYMENTS_APPROVER_REQUIRED/);
  assert.throws(() => validatePilotPreflight({ ...online, onlinePayments: { ...approval, approvedAt: 'mañana' } }, plan, { ownerCredentials }),
    /PILOT_ONLINE_PAYMENTS_DATE_REQUIRED/);
  assert.throws(() => validatePilotPreflight({ ...online, onlinePayments: { ...approval, runbook: 'README.md' } }, plan, { ownerCredentials }),
    /PILOT_ONLINE_PAYMENTS_RUNBOOK_REQUIRED/);
  assert.throws(() => validatePilotPreflight({ ...config, onlinePayments: approval }, plan, { ownerCredentials }),
    /PILOT_ONLINE_PAYMENTS_APPROVAL_WITHOUT_ONLINE_PAYMENTS/);
  assert.throws(() => validatePilotPreflight({ ...config, manualPaymentOnly: 'no' }, plan, { ownerCredentials }),
    /PILOT_PAYMENT_MODE_REQUIRED/);
});

test('online payments backend probe: ready only when the webhook rejects unsigned calls and the pilot origin is allowed', async () => {
  const origin = 'https://la-taba-commercial-pilot.pages.dev';
  const fake = (webhookStatus, preflightStatus, allowOrigin) => async (url) => {
    if (String(url).includes('mercadopago-webhook')) return new Response(null, { status: webhookStatus });
    return new Response(null, { status: preflightStatus, headers: allowOrigin ? { 'access-control-allow-origin': allowOrigin } : {} });
  };
  const probe = (request) => probeOnlinePaymentsBackend({ projectRef: ref, customerOrigin: origin, request });
  assert.equal((await probe(fake(401, 204, origin))).ready, true);
  // CONTROLLED_PRODUCTION on 2026-09-25: functions deployed, connector not configured.
  assert.deepEqual(await probe(fake(503, 403, null)), { webhookStatus: 503, preflightStatus: 403,
    webhookRejectsUnsigned: false, originAllowed: false, ready: false });
  assert.equal((await probe(fake(401, 204, 'https://evil.example'))).ready, false);
  assert.equal((await probe(fake(200, 204, origin))).ready, false, 'a webhook that accepts unsigned calls is never ready');
  await assert.rejects(() => probeOnlinePaymentsBackend({ projectRef: 'not a ref', customerOrigin: origin, request: fake(401, 204, origin) }),
    /PILOT_ONLINE_PAYMENTS_PROBE_REF_REQUIRED/);
});
