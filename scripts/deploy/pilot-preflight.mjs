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

// catalogMode "none" is the CONTROLLED_PRODUCTION technical deployment before
// the merchant approves a catalog: the exact public allowlist is EMPTY, so the
// smoke fails if any product is visible. It never enables an import; catalog
// import still requires the approved 5-10 SKU allowlist.
export const CATALOG_MODES = Object.freeze(['approved', 'none']);

export const ONLINE_PAYMENTS_RUNBOOK = 'docs/MERCADOPAGO_PRODUCCION_CP.md';

// La aprobación de cobros online que viaja en la configuración del piloto:
// quién, cuándo y con qué procedimiento. Sin las cuatro cosas, sólo manual.
export function assertOnlinePaymentsApproval(approval) {
  assert.equal(approval?.provider, 'mercadopago-oauth', 'PILOT_ONLINE_PAYMENTS_PROVIDER_REQUIRED');
  assert.equal(approval?.runbook, ONLINE_PAYMENTS_RUNBOOK, 'PILOT_ONLINE_PAYMENTS_RUNBOOK_REQUIRED');
  assert.match(String(approval?.approvedBy ?? ''), /^\S.{1,78}\S$/, 'PILOT_ONLINE_PAYMENTS_APPROVER_REQUIRED');
  assert.match(String(approval?.approvedAt ?? ''), /^\d{4}-\d{2}-\d{2}$/, 'PILOT_ONLINE_PAYMENTS_DATE_REQUIRED');
}

// Sondas públicas, sin credenciales. Con el conector configurado, el webhook
// rechaza lo que no viene firmado (401) en vez de declararse no disponible
// (503), y el checkout acepta el origen exacto del piloto. Medido contra
// Staging (configurado: 401 y 204 con ese origen) y contra CONTROLLED_PRODUCTION
// sin configurar (503 y 403).
export async function probeOnlinePaymentsBackend({ projectRef, customerOrigin, request = fetch }) {
  assert.match(projectRef || '', /^[a-z0-9]{20}$/, 'PILOT_ONLINE_PAYMENTS_PROBE_REF_REQUIRED');
  const base = `https://${projectRef}.supabase.co/functions/v1`;
  const webhook = await request(`${base}/mercadopago-webhook?data.id=0&type=payment`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'payment', data: { id: '0' } }), signal: AbortSignal.timeout(20_000),
  });
  await webhook.arrayBuffer().catch(() => {});
  const preflight = await request(`${base}/mercadopago-create-checkout-session`, {
    method: 'OPTIONS', headers: { Origin: customerOrigin, 'Access-Control-Request-Method': 'POST' },
    signal: AbortSignal.timeout(20_000),
  });
  await preflight.arrayBuffer().catch(() => {});
  const webhookRejectsUnsigned = webhook.status === 401;
  const originAllowed = preflight.status === 204
    && preflight.headers.get('access-control-allow-origin') === customerOrigin;
  return { webhookStatus: webhook.status, preflightStatus: preflight.status,
    webhookRejectsUnsigned, originAllowed, ready: webhookRejectsUnsigned && originAllowed };
}

export function validatePilotPreflight(config, plan, { phase = 'catalog',
  ownerCredentials, cloudflare = {}, buildReceipt } = {}) {
  assert.ok(['catalog', 'deploy', 'e2e'].includes(phase), 'PILOT_PREFLIGHT_PHASE_INVALID');
  assert.equal(config?.schemaVersion, 1, 'PILOT_CONFIG_SCHEMA_INVALID');
  assert.equal(config.deploymentEnvironment, 'pilot', 'PILOT_ENVIRONMENT_REQUIRED');
  // Cobro manual por defecto. Mercado Pago en línea es una decisión explícita y
  // nominal; que el backend tenga el conector configurado lo comprueban las
  // sondas públicas de prepare-commercial-pilot antes de empaquetar.
  assert.equal(typeof config.manualPaymentOnly, 'boolean', 'PILOT_PAYMENT_MODE_REQUIRED');
  if (!config.manualPaymentOnly) assertOnlinePaymentsApproval(config.onlinePayments);
  else assert.ok(config.onlinePayments == null, 'PILOT_ONLINE_PAYMENTS_APPROVAL_WITHOUT_ONLINE_PAYMENTS');
  const catalogMode = config.catalogMode ?? 'approved';
  assert.ok(CATALOG_MODES.includes(catalogMode), 'PILOT_CATALOG_MODE_INVALID');
  assertPilotIdentity(config.supabaseProjectRef, config.businessId);
  assert.equal(config.supabaseProjectRef, plan?.projectRef, 'PILOT_BACKEND_REF_MISMATCH');
  assert.equal(config.businessId, plan?.businessId, 'PILOT_BUSINESS_ID_MISMATCH');
  if (catalogMode === 'none') {
    assert.notEqual(phase, 'catalog', 'PILOT_CATALOG_IMPORT_REQUIRES_OWNER_APPROVAL');
    assert.ok(config.catalogApprovalFile == null, 'TECH_READY_MODE_HAS_NO_APPROVAL_FILE');
    assert.ok(Array.isArray(plan?.approvedSkus) && plan.approvedSkus.length === 0,
      'TECH_READY_MODE_MUST_PUBLISH_NOTHING');
  } else {
    assert.ok(Array.isArray(plan?.approvedSkus)
      && plan.approvedSkus.length >= 5 && plan.approvedSkus.length <= 10,
    'PILOT_APPROVED_SKU_ALLOWLIST_REQUIRED');
  }
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
  return { status: 'PASS', phase, catalogMode, onlinePayments: config.manualPaymentOnly === false, projectRef: plan.projectRef,
    businessId: plan.businessId, approvedSkus: [...plan.approvedSkus],
    cloudflareProject: config.cloudflareProject, customerUrl: customer.origin,
    businessPanelUrl: panel.href, secretsPrinted: false };
}

// Public key source: Credential Manager locally; in CI the PILOT_PUBLISHABLE_KEY
// variable (it is served to every browser anyway). Catalog import stays local.
function publishableCredentials(config, phase, environment) {
  if (environment.PILOT_PUBLISHABLE_KEY) {
    assert.notEqual(phase, 'catalog', 'PILOT_CATALOG_IMPORT_IS_LOCAL_ONLY');
    return { publishableKey: environment.PILOT_PUBLISHABLE_KEY, accessToken: null };
  }
  return readPilotOwnerCredentials(config.supabaseProjectRef, { requireOwnerToken: phase === 'catalog' });
}

function loadRiderReceipt(config, phase, environment) {
  const receiptFile = config.rider?.buildReceiptFile;
  if (phase === 'catalog' || !receiptFile || !existsSync(path.resolve(ROOT, receiptFile))) return null;
  const buildReceipt = JSON.parse(readFileSync(path.resolve(ROOT, receiptFile), 'utf8'));
  // On the machine that built and signed the APK its bytes must match the
  // receipt. CI deploys only the web and carries the committed receipt.
  if (environment.CI !== 'true') {
    const apkFile = path.join(ROOT, 'apps', 'rider-android', 'app', 'build', 'outputs',
      'apk', 'release', 'app-release.apk');
    assert.ok(existsSync(apkFile), 'RIDER_V4_APK_MISSING');
    assert.equal(createHash('sha256').update(readFileSync(apkFile)).digest('hex'),
      buildReceipt.apkSha256, 'RIDER_V4_APK_HASH_MISMATCH');
  }
  return buildReceipt;
}

export function loadPilotPreflight({ configFile, approvalFile, phase = 'catalog',
  environment = process.env } = {}) {
  assert.ok(configFile, 'PILOT_CONFIG_FILE_REQUIRED');
  const cloudflare = { accountId: environment.CLOUDFLARE_ACCOUNT_ID,
    apiToken: environment.CLOUDFLARE_API_TOKEN };
  const technical = JSON.parse(readFileSync(path.resolve(configFile), 'utf8'));
  if (technical.catalogMode === 'none') {
    assert.ok(!approvalFile, 'TECH_READY_MODE_TAKES_NO_APPROVAL_FILE');
    assertPilotIdentity(technical.supabaseProjectRef, technical.businessId);
    const plan = { projectRef: technical.supabaseProjectRef, businessId: technical.businessId,
      approvedSkus: [], entries: [] };
    const ownerCredentials = publishableCredentials(technical, phase, environment);
    const buildReceipt = loadRiderReceipt(technical, phase, environment);
    return { report: validatePilotPreflight(technical, plan, { phase, ownerCredentials,
      cloudflare, buildReceipt }), plan, ownerCredentials };
  }
  assert.ok(approvalFile, 'PILOT_CONFIG_AND_APPROVAL_FILES_REQUIRED');
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
  const ownerCredentials = publishableCredentials(config, phase, environment);
  const buildReceipt = loadRiderReceipt(config, phase, environment);
  return { report: validatePilotPreflight(config, plan, { phase, ownerCredentials,
    cloudflare, buildReceipt }), plan, ownerCredentials };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const at = (flag) => { const i = process.argv.indexOf(flag); return i < 0 ? '' : process.argv[i + 1]; };
    const { report } = loadPilotPreflight({ configFile: at('--config'),
      approvalFile: at('--approval') || undefined, phase: at('--phase') || 'catalog' });
    console.log(JSON.stringify({ pilotPreflight: report.status, ...report }));
  } catch (error) {
    console.error(`PILOT_PREFLIGHT_BLOCKED:${error.message}`);
    process.exitCode = 1;
  }
}
