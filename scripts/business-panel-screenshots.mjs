// Capturas del panel del negocio con datos de prueba servidos localmente.
// No toca Supabase, Mercado Pago ni ARCA: intercepta las llamadas y responde con fixtures.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number.parseInt(process.env.TABA_PANEL_SHOT_PORT || '8151', 10);
const BASE = `http://127.0.0.1:${PORT}`;
// Se puede redirigir la salida cuando el disco del repositorio está justo.
const OUT = path.resolve(process.env.TABA_PANEL_SHOT_DIR || 'artifacts/business-operations-panel');
const SUPABASE_URL = 'https://taba-panel-screenshots.supabase.co';
const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';

const SCREENS = [
  ['operation-center', 'centro-de-operacion'],
  ['day-open', 'abrir-el-negocio'],
  ['payments', 'pagos-del-dia'],
  ['payments-setup', 'conectar-mercado-pago'],
  ['fiscal-setup', 'facturacion-arca'],
  ['devices', 'probar-dispositivos'],
  ['product-create', 'alta-de-producto'],
  ['day-close', 'cerrar-el-dia'],
];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const captured = [];
const browser = await chromium.launch();

try {
  await waitForServer();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await installFixtures(page);
  await page.goto(`${BASE}/#business`);
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });

  for (const [view, name] of SCREENS) {
    await page.locator(`[data-business-ops-view="${view}"]`).first().click();
    await page.locator(`[data-business-ops-center="${view}"]`).waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(400);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    captured.push(`${name}.png — pantalla ${view}`);
  }
  await context.close();
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(
  path.join(OUT, 'CAPTURAS.md'),
  `# Capturas del panel del negocio\n\nDatos de prueba locales. Ninguna captura contiene datos reales de clientes, pagos ni comprobantes.\n\n${captured.map((line) => `- ${line}`).join('\n')}\n`,
);
console.log(`Capturas generadas: ${captured.length} en ${path.relative(process.cwd(), OUT)}`);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch (_) { /* el servidor todavía no aceptó conexiones */ }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  throw new Error('El servidor local no respondió a tiempo.');
}

async function installFixtures(page) {
  const session = ownerSession();
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path_ = url.pathname;
    if (path_.endsWith('/auth/v1/user')) return json(route, session.user);
    if (path_.includes('/auth/v1/token')) return json(route, session);
    if (path_.includes('/rest/v1/business_members')) {
      return json(route, { business_id: BUSINESS_ID, user_id: OWNER_ID, role: 'owner', is_active: true });
    }
    if (path_.includes('/rest/v1/businesses')) return json(route, businessFixture());
    if (path_.includes('/rpc/get_production_operation_center')) return json(route, operationCenterFixture());
    if (path_.includes('/rpc/get_mercadopago_activation_status')) return json(route, mercadoPagoFixture());
    if (path_.includes('/rpc/list_business_payments')) return json(route, paymentsFixture());
    if (path_.includes('/rpc/get_arca_activation_status')) return json(route, arcaFixture());
    if (path_.includes('/rpc/get_business_opening_status')) return json(route, openingFixture());
    if (path_.includes('/rest/v1/fiscal_profiles')) return json(route, fiscalProfileFixture());
    if (path_.includes('/rest/v1/fiscal_documents')) return json(route, []);
    if (path_.includes('/rpc/list_fiscal_document_artifacts')) return json(route, []);
    if (path_.includes('/rest/v1/orders')) return json(route, []);
    if (path_.includes('/rest/v1/products')) return json(route, []);
    return json(route, []);
  });
  await page.addInitScript(({ businessId, persistedSession, supabaseUrl }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_panel_screenshots', businessId, pollMs: 60_000,
      },
    };
    localStorage.setItem('sb-taba-panel-screenshots-auth-token', JSON.stringify(persistedSession));
    globalThis.__TAURI__ = { core: { invoke: async (command) => {
      if (command === 'initialize_business_runtime') return true;
      if (command === 'outbox_list') return [];
      if (command === 'outbox_get' || command === 'outbox_find_by_idempotency_key') return null;
      if (command === 'outbox_put') return true;
      if (command === 'list_printers') return [{ name: 'EPSON TM-T20 (mostrador)', isDefault: true }, { name: 'HP LaserJet (oficina)', isDefault: false }];
      if (command === 'probe_printer') return { name: 'EPSON TM-T20 (mostrador)', reachable: true, outOfPaper: false, error: false, queuedJobs: 0 };
      if (command === 'check_for_signed_update') return { configured: false, available: false, currentVersion: '0.1.0', version: null };
      return true;
    } } };
  }, { businessId: BUSINESS_ID, persistedSession: session, supabaseUrl: SUPABASE_URL });
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
    refresh_token: 'panel-screenshots-refresh',
    user: { id: OWNER_ID, aud: 'authenticated', role: 'authenticated', email: 'walter@la-taba.test', is_anonymous: false, user_metadata: { taba_actor: 'owner' } },
  };
}

function businessFixture() {
  return {
    id: BUSINESS_ID, name: 'La Taba', slug: 'la-taba', status: 'open', is_active: true,
    ordering_enabled: true, ordering_verified: true, whatsapp_phone: '+5492995550000',
  };
}

function operationCenterFixture() {
  return {
    generated_at: new Date().toISOString(),
    business_id: BUSINESS_ID,
    metrics: {
      new_orders: 3, delayed_orders: 1, pending_payments: 2, payments_in_review: 1,
      orders_without_stock: 0, packing_incomplete: 2, active_deliveries: 1,
      riders_without_signal: 0, fiscal_documents_pending: 1, failed_prints: 1,
      pending_credit_notes: 0, blocked_outboxes: 0, reconciliations_required: 1,
    },
    alerts: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', severity: 'CRITICAL', status: 'open',
        code: 'PAYMENT_APPROVED_WITHOUT_ORDER', correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        last_seen_at: new Date().toISOString(), occurrence_count: 1,
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', severity: 'ACTION_REQUIRED', status: 'open',
        code: 'PRINT_JOB_FAILED', correlation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        last_seen_at: new Date().toISOString(), occurrence_count: 2,
      },
    ],
    recent_closures: [],
  };
}

function mercadoPagoFixture() {
  return {
    settings_present: true, enabled: true, environment: 'test', currency: 'ARS', reserve_stock: true,
    collector_configured: true, application_configured: true,
    collector_id_short: '8877', application_id_short: '2233',
    configured_at: new Date().toISOString(), credentials_loaded: true,
    signed_notice_at: new Date().toISOString(), rejected_notices_recent: 0,
    test_payment_at: new Date().toISOString(), test_payment_order_created: true,
    test_payment_stock_applied: true, storefront_ready: true, production_review_status: 'not_requested',
  };
}

function paymentsFixture() {
  const now = new Date().toISOString();
  return [
    { payment_intent_id: 'p-1', internal_status: 'approved_order_pending', amount: 8400, currency: 'ARS', method: 'Tarjeta de crédito', created_at: now, can_reconcile: true, payment_id_short: '445566' },
    { payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-2043', amount: 12600, currency: 'ARS', method: 'Tarjeta de débito', approved_at: now, can_refund: true, can_reconcile: true, payment_id_short: '778899' },
    { payment_intent_id: 'p-3', internal_status: 'in_process', order_public_code: 'LT-2044', amount: 5300, currency: 'ARS', method: 'Efectivo en sucursal', created_at: now, can_cancel: true },
    { payment_intent_id: 'p-4', internal_status: 'rejected', amount: 4100, currency: 'ARS', method: 'Tarjeta de crédito', created_at: now },
  ];
}

function arcaFixture() {
  return {
    legal_name: 'La Taba SRL', cuit: '30712345678', cuit_valid: true,
    tax_condition: 'Responsable Inscripto', business_address: 'Roca 123, Neuquén',
    accountant_review_status: 'approved', environment: 'homologation', point_of_sale: 4,
    certificate_loaded: true,
    certificate_expires_at: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    certificate_cuit_mismatch: false, delegation_status: 'verified',
    connection_ok_at: new Date().toISOString(), homologation_authorized_at: new Date().toISOString(),
    homologated_invoices: 1, homologated_credit_notes: 0,
    pending_documents: 1, stalled_documents: 0,
    last_document_label: 'FA 4 00000001', last_document_at: new Date().toISOString(),
    last_document_failed: false, last_error_code: null, last_error_at: null,
    artifact_verified_at: null, print_verified_at: null,
  };
}

function openingFixture() {
  return {
    generated_at: new Date().toISOString(), business_status: 'open',
    backend: { status: 'ok', detail: 'El sistema del negocio respondió.' },
    payments: { status: 'ok', detail: 'Los cobros por la web están activos.' },
    fiscal: { status: 'ok', detail: 'La facturación está activa.' },
    riders: { status: 'ok', detail: '2 repartidor(es) disponible(s).' },
    queues: { status: 'ok', detail: 'No quedó nada trabado de antes.' },
    open_orders: 4,
  };
}

function fiscalProfileFixture() {
  return {
    business_id: BUSINESS_ID, legal_name: 'La Taba SRL', cuit: '30712345678',
    tax_condition: 'Responsable Inscripto', business_address: 'Roca 123, Neuquén',
    environment: 'homologation', point_of_sale: 4, is_enabled: true,
    accountant_review_status: 'approved', production_gate_status: 'blocked',
  };
}
