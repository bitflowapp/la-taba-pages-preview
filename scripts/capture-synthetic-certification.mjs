// Capturas de la jornada sintética, con datos QA inequívocos en pantalla.
// Intercepta todas las llamadas al backend: no toca Supabase, Mercado Pago ni ARCA.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  QA_BUSINESS_ID, QA_FISCAL_FIXTURES, QA_MARKERS, QA_PAYMENT_FIXTURES, QA_PRODUCTS,
} from '../tests/synthetic/qa-fixtures.mjs';

const PORT = Number.parseInt(process.env.TABA_CERT_SHOT_PORT || '8163', 10);
const BASE = `http://127.0.0.1:${PORT}`;
// Ruta relativa al repositorio por defecto: una ruta de disco local no puede vivir en el árbol.
const OUT = path.resolve(process.env.TABA_CERT_SHOT_DIR || 'artifacts/la-taba-business-synthetic-certification/capturas');
const SUPABASE_URL = 'https://taba-synthetic-certification.supabase.co';
const OWNER_ID = '00000000-0000-4000-8000-0000000000b1';

const SCREENS = [
  ['day-open', '01-apertura'],
  ['operation-center', '02-centro-de-operacion'],
  ['payments', '03-pagos-fixtures'],
  ['payments-setup', '04-conectar-mercado-pago'],
  ['fiscal-setup', '05-facturacion-homologacion'],
  ['devices', '06-dispositivos'],
  ['product-create', '07-alta-de-producto'],
  ['day-close', '08-cierre-diario'],
];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
const captured = [];

try {
  await waitForServer();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await installQaFixtures(page);
  await page.goto(`${BASE}/#business`);
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });

  for (const [view, name] of SCREENS) {
    await page.locator(`[data-business-ops-view="${view}"]`).first().click();
    await page.locator(`[data-business-ops-center="${view}"]`).waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    captured.push(`${name}.png — ${view}`);
  }
  await context.close();
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(path.join(OUT, 'CAPTURAS.md'), `# Capturas de la jornada sintética

Todos los datos en pantalla están etiquetados como QA (${Object.values(QA_MARKERS).join(', ')}).
Ninguna captura contiene datos reales de clientes, cobros ni comprobantes.

${captured.map((line) => `- ${line}`).join('\n')}
`);
console.log(`Capturas de certificación: ${captured.length} en ${OUT}`);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch (_) { /* todavía no acepta conexiones */ }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  throw new Error('El servidor local no respondió a tiempo.');
}

async function installQaFixtures(page) {
  const session = ownerSession();
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const route_ = url.pathname;
    if (route_.endsWith('/auth/v1/user')) return json(route, session.user);
    if (route_.includes('/auth/v1/token')) return json(route, session);
    if (route_.includes('/rest/v1/business_members')) {
      return json(route, { business_id: QA_BUSINESS_ID, user_id: OWNER_ID, role: 'owner', is_active: true });
    }
    if (route_.includes('/rest/v1/businesses')) {
      return json(route, {
        id: QA_BUSINESS_ID, name: QA_MARKERS.business, slug: 'negocio-qa', status: 'open',
        is_active: true, ordering_enabled: true, ordering_verified: true,
      });
    }
    if (route_.includes('/rpc/get_production_operation_center')) return json(route, operationCenter());
    if (route_.includes('/rpc/get_mercadopago_activation_status')) return json(route, paymentActivation());
    if (route_.includes('/rpc/list_business_payments')) return json(route, payments());
    if (route_.includes('/rpc/get_arca_activation_status')) return json(route, QA_FISCAL_FIXTURES.available.profile);
    if (route_.includes('/rpc/get_business_opening_status')) return json(route, opening());
    if (route_.includes('/rest/v1/fiscal_profiles')) return json(route, QA_FISCAL_FIXTURES.available.profile);
    if (route_.includes('/rest/v1/fiscal_documents')) return json(route, []);
    if (route_.includes('/rpc/list_fiscal_document_artifacts')) return json(route, []);
    if (route_.includes('/rest/v1/product_barcodes')) {
      const gtin = url.searchParams.get('gtin')?.replace('eq.', '') || '';
      const product = QA_PRODUCTS.find((candidate) => candidate.barcodes.some((barcode) => barcode.gtin === gtin));
      return json(route, product
        ? {
          product_id: product.id, gtin, unit_factor: product.unitsPerPack, package_type: product.packageType,
          is_active: true, products: [{ id: product.id, name: product.name, brand: product.brand, presentation: product.variant, stock: product.stock }],
        }
        : null);
    }
    if (route_.includes('/rest/v1/orders')) return json(route, []);
    if (route_.includes('/rest/v1/products')) return json(route, []);
    return json(route, []);
  });
  await page.addInitScript(({ businessId, persistedSession, supabaseUrl }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_synthetic_certification', businessId, pollMs: 60_000,
      },
    };
    localStorage.setItem('sb-taba-synthetic-certification-auth-token', JSON.stringify(persistedSession));
    globalThis.__TAURI__ = { core: { invoke: async (command) => {
      if (command === 'initialize_business_runtime') return true;
      if (command === 'outbox_list') return [];
      if (command === 'outbox_get' || command === 'outbox_find_by_idempotency_key') return null;
      if (command === 'outbox_put') return true;
      if (command === 'list_printers') return [{ name: 'Impresora virtual QA', isDefault: true }];
      if (command === 'probe_printer') return { name: 'Impresora virtual QA', reachable: true, outOfPaper: false, error: false, queuedJobs: 0 };
      if (command === 'check_for_signed_update') return { configured: false, available: false, currentVersion: '0.1.0', version: null };
      return true;
    } } };
  }, { businessId: QA_BUSINESS_ID, persistedSession: session, supabaseUrl: SUPABASE_URL });
}

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function ownerSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.signature`;
  return {
    access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    refresh_token: 'synthetic-certification-refresh',
    user: { id: OWNER_ID, aud: 'authenticated', role: 'authenticated', email: 'walter.qa@negocio-qa.test', is_anonymous: false, user_metadata: { taba_actor: 'owner' } },
  };
}

function operationCenter() {
  return {
    generated_at: new Date().toISOString(),
    business_id: QA_BUSINESS_ID,
    metrics: {
      new_orders: 1, delayed_orders: 0, pending_payments: 1, payments_in_review: 2,
      orders_without_stock: 0, packing_incomplete: 1, active_deliveries: 1,
      riders_without_signal: 1, fiscal_documents_pending: 2, failed_prints: 1,
      pending_credit_notes: 0, blocked_outboxes: 1, reconciliations_required: 2,
    },
    alerts: [
      {
        id: 'qa-alert-critical', severity: 'CRITICAL', status: 'open',
        code: 'PAYMENT_APPROVED_WITHOUT_ORDER', correlation_id: '22222222-2222-4222-8222-222222222222',
        last_seen_at: new Date().toISOString(), occurrence_count: 1,
      },
      {
        id: 'qa-alert-rider', severity: 'WARNING', status: 'open',
        code: 'RIDER_SIGNAL_STALE', correlation_id: '11111111-1111-4111-8111-111111111111',
        last_seen_at: new Date().toISOString(), occurrence_count: 1,
      },
    ],
    recent_closures: [],
  };
}

function paymentActivation() {
  return {
    settings_present: true, enabled: true, environment: 'test', currency: 'ARS', reserve_stock: true,
    collector_configured: true, application_configured: true,
    collector_id_short: '0001', application_id_short: '0002',
    credentials_loaded: true, signed_notice_at: new Date().toISOString(), rejected_notices_recent: 0,
    test_payment_at: new Date().toISOString(), test_payment_order_created: true,
    test_payment_stock_applied: true, storefront_ready: true, production_review_status: 'not_requested',
  };
}

function payments() {
  return QA_PAYMENT_FIXTURES.map((fixture) => ({
    payment_intent_id: fixture.id,
    internal_status: fixture.internal_status,
    order_public_code: fixture.orderCode || null,
    amount: fixture.amount,
    currency: 'ARS',
    method: fixture.label,
    latest_refund_status: fixture.latest_refund_status || null,
    refunded_amount: 0,
    created_at: new Date().toISOString(),
    can_reconcile: !['completed'].includes(fixture.internal_status),
    can_refund: fixture.internal_status === 'completed' && Boolean(fixture.orderCode),
    payment_id_short: fixture.id.slice(-6),
  }));
}

function opening() {
  return {
    generated_at: new Date().toISOString(), business_status: 'open',
    backend: { status: 'ok', detail: 'El sistema del negocio respondió.' },
    payments: { status: 'ok', detail: 'Los cobros por la web están activos.' },
    fiscal: { status: 'degraded', detail: 'La facturación está en pruebas.' },
    riders: { status: 'ok', detail: `1 repartidor(es) disponible(s) · ${QA_MARKERS.rider}.` },
    queues: { status: 'ok', detail: 'No quedó nada trabado de antes.' },
    open_orders: 1,
  };
}
