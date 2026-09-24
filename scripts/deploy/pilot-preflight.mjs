// Mandatory fail-closed gate before catalog import or any PILOT deployment.
// No resource creation, upload or deployment occurs in this script.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPilotIdentity, buildPilotCatalogPlan, readPilotOwnerCredentials } from '../import-pilot-catalog.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BLOCKED_HOSTS = new Set(['la-taba.pages.dev', 'taba2-staging.pages.dev']);
const CERT_SHA256 = '2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa';

export function validatePilotPreflight(config, plan, { phase = 'catalog',
  ownerCredentials, cloudflare = {}, buildReceipt } = {}) {
  assert.ok(['catalog', 'deploy', 'e2e'].includes(phase), 'PILOT_PREFLIGHT_PHASE_INVALID');
  assert.equal(config?.schemaVersion, 1, 'PILOT_CONFIG_SCHEMA_INVALID');
  assert.equal(config.deploymentEnvironment, 'pilot', 'PILOT_ENVIRONMENT_REQUIRED');
  assert.equal(config.manualPaymentOnly, true, 'PILOT_MUST_USE_MANUAL_PAYMENT_ONLY');
  assertPilotIdentity(config.supabaseProjectRef, config.businessId);
  assert.equal(config.supabaseProjectRef, plan?.projectRef, 'PILOT_BACKEND_REF_MISMATCH');
  assert.equal(config.businessId, plan?.businessId, 'PILOT_BUSINESS_ID_MISMATCH');
  assert.ok(Array.isArray(plan?.approvedSkus)
    && plan.approvedSkus.length >= 5 && plan.approvedSkus.length <= 10,
  'PILOT_APPROVED_SKU_ALLOWLIST_REQUIRED');
  assert.ok(config.cloudflareProject === 'la-taba-commercial-pilot',
    'PILOT_CLOUDFLARE_PROJECT_MUST_BE_DEDICATED');
  const customer = new URL(config.customerUrl);
  const panel = new URL(config.businessPanelUrl);
  assert.equal(customer.protocol, 'https:', 'PILOT_CUSTOMER_HTTPS_REQUIRED');
  assert.ok(!BLOCKED_HOSTS.has(customer.hostname) && !BLOCKED_HOSTS.has(panel.hostname),
    'PILOT_WEB_HOST_MUST_BE_ISOLATED');
  assert.equal(customer.hostname, `${config.cloudflareProject}.pages.dev`,
    'PILOT_MUST_USE_DEDICATED_PAGES_HOST');
  assert.equal(customer.pathname, '/', 'PILOT_CUSTOMER_ORIGIN_REQUIRED');
  assert.ok(!customer.username && !customer.password && !panel.username && !panel.password,
    'PILOT_URL_CREDENTIALS_FORBIDDEN');
  assert.equal(panel.origin, customer.origin, 'PILOT_PANEL_MUST_SHARE_PILOT_HOST');
  assert.equal(panel.hash, '#business', 'PILOT_PANEL_ROUTE_REQUIRED');
  assert.ok(!customer.search && !panel.search, 'PILOT_URL_QUERY_FORBIDDEN');
  assert.equal(config.rider?.targetMode, 'pilot', 'RIDER_MUST_TARGET_PILOT');
  assert.equal(config.rider?.backendRef, plan.projectRef, 'RIDER_BACKEND_REF_MISMATCH');
  assert.equal(config.rider?.packageId, 'com.lataba.rider.pilot', 'RIDER_PACKAGE_MISMATCH');
  assert.equal(config.rider?.versionName, '0.1.3-canonical-pilot', 'RIDER_V4_NAME_REQUIRED');
  assert.equal(config.rider?.versionCode, 4, 'RIDER_V4_CODE_REQUIRED');
  assert.ok(ownerCredentials?.publishableKey?.startsWith('sb_publishable_')
    && (phase !== 'catalog' || ownerCredentials?.accessToken),
  'PILOT_OWNER_SECRETS_REQUIRED');
  if (phase === 'deploy' || phase === 'e2e') {
    if (phase === 'deploy') {
      assert.ok(/^[a-f0-9]{32}$/i.test(cloudflare.accountId || '')
        && typeof cloudflare.apiToken === 'string' && cloudflare.apiToken.length >= 20,
      'PILOT_CLOUDFLARE_SECRETS_REQUIRED');
    }
    assert.equal(buildReceipt?.target, 'pilot', 'RIDER_BUILD_RECEIPT_MUST_BE_PILOT');
    assert.equal(buildReceipt?.backend, plan.projectRef, 'RIDER_BUILD_BACKEND_MISMATCH');
    assert.equal(buildReceipt?.packageId, config.rider.packageId, 'RIDER_BUILD_PACKAGE_MISMATCH');
    assert.equal(buildReceipt?.versionName, config.rider.versionName, 'RIDER_BUILD_VERSION_NAME_MISMATCH');
    assert.equal(buildReceipt?.versionCode, config.rider.versionCode, 'RIDER_BUILD_VERSION_CODE_MISMATCH');
    assert.equal(buildReceipt?.certificateSha256?.toLowerCase(), CERT_SHA256,
      'RIDER_SIGNING_CERTIFICATE_MISMATCH');
    assert.equal(buildReceipt?.apkFile,
      'apps/rider-android/app/build/outputs/apk/release/app-release.apk',
    'RIDER_APK_PATH_MISMATCH');
    assert.match(buildReceipt?.apkSha256 || '', /^[a-f0-9]{64}$/i, 'RIDER_APK_HASH_REQUIRED');
  }
  return { status: 'PASS', phase, projectRef: plan.projectRef,
    businessId: plan.businessId, approvedSkus: [...plan.approvedSkus],
    cloudflareProject: config.cloudflareProject, customerUrl: customer.origin,
    businessPanelUrl: panel.href, secretsPrinted: false };
}

export function loadPilotPreflight({ configFile, approvalFile, phase = 'catalog',
  environment = process.env } = {}) {
  assert.ok(configFile && approvalFile, 'PILOT_CONFIG_AND_APPROVAL_FILES_REQUIRED');
  const configPath = path.resolve(configFile);
  const approvedPath = realpathSync(path.resolve(approvalFile));
  // Commercial decisions belong in a restricted local store, never Git.
  assert.ok(!approvedPath.toLowerCase().startsWith((ROOT + path.sep).toLowerCase()),
    'APPROVAL_FILE_MUST_BE_OUTSIDE_REPO');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const approval = JSON.parse(readFileSync(approvedPath, 'utf8'));
  assert.equal(path.resolve(config.catalogApprovalFile || '').toLowerCase(), approvedPath.toLowerCase(),
    'PILOT_CONFIG_APPROVAL_FILE_MISMATCH');
  const snapshot = JSON.parse(readFileSync(path.join(ROOT, 'catalog', 'production-catalog-snapshot.json')));
  const imageManifest = JSON.parse(readFileSync(path.join(ROOT, 'docs', 'catalog', 'image-manifest.json')));
  const plan = buildPilotCatalogPlan(approval, {
    projectRef: config.supabaseProjectRef, businessId: config.businessId,
    snapshot, imageManifest,
  });
  const ownerCredentials = readPilotOwnerCredentials(config.supabaseProjectRef,
    { requireOwnerToken: phase === 'catalog' });
  const buildReceipt = phase !== 'catalog' && config.rider.buildReceiptFile
    && existsSync(path.resolve(config.rider.buildReceiptFile))
    ? JSON.parse(readFileSync(path.resolve(config.rider.buildReceiptFile), 'utf8')) : null;
  if (phase !== 'catalog' && buildReceipt) {
    const apkFile = path.join(ROOT, 'apps', 'rider-android', 'app', 'build', 'outputs',
      'apk', 'release', 'app-release.apk');
    assert.ok(existsSync(apkFile), 'RIDER_V4_APK_MISSING');
    assert.equal(createHash('sha256').update(readFileSync(apkFile)).digest('hex'),
      buildReceipt.apkSha256, 'RIDER_V4_APK_HASH_MISMATCH');
  }
  return { report: validatePilotPreflight(config, plan, { phase, ownerCredentials,
    cloudflare: { accountId: environment.CLOUDFLARE_ACCOUNT_ID,
      apiToken: environment.CLOUDFLARE_API_TOKEN }, buildReceipt }),
  plan, ownerCredentials };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const at = (flag) => { const i = process.argv.indexOf(flag); return i < 0 ? '' : process.argv[i + 1]; };
    const { report } = loadPilotPreflight({ configFile: at('--config'),
      approvalFile: at('--approval'), phase: at('--phase') || 'catalog' });
    console.log(JSON.stringify({ pilotPreflight: report.status, ...report }));
  } catch (error) {
    console.error(`PILOT_PREFLIGHT_BLOCKED:${error.message}`);
    process.exitCode = 1;
  }
}
