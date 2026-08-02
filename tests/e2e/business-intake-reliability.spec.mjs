import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const HARNESS_PATH = '/tests/fixtures/business-intake-harness.html';
const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const SUPABASE_URL = 'https://taba-business-intake-e2e.supabase.co';

test('cliente/negocio separados recuperan antes, durante, offline/online y tras recarga completa', async ({ browser }) => {
  const backend = createIntakeBackend();
  const clientContext = await browser.newContext();
  const businessContext = await browser.newContext();
  await backend.install(clientContext);
  await backend.install(businessContext);
  const client = await clientContext.newPage();
  const business = await businessContext.newPage();

  await client.goto(`${HARNESS_PATH}?client=1`);
  await confirmClientOrder(client);

  await business.goto(HARNESS_PATH);
  await business.evaluate(() => globalThis.__intakeReady);
  await expect(business.locator('[data-order]')).toHaveCount(1);
  await expect(business.locator('[data-phase]')).toHaveText('Conectado');
  await expect(business.locator('[data-last-sync]')).toContainText('Última sincronización:');

  await confirmClientOrder(client, { resetRequest: true });
  await business.evaluate(() => globalThis.__emitRealtime({ new: { id: 'payload-parcial' } }));
  await expect(business.locator('[data-order]')).toHaveCount(2);
  await expect(business.locator('[data-alert-count]')).toHaveText('Alertas: 1');

  await businessContext.setOffline(true);
  backend.addOrder();
  await business.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    globalThis.__emitRealtime({ new: { id: 'offline-partial' } });
  });
  await expect(business.locator('[data-phase]')).toHaveText('Sin conexión');
  await expect(business.locator('[data-order]')).toHaveCount(2);

  await businessContext.setOffline(false);
  await business.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(business.locator('[data-order]')).toHaveCount(3);
  await expect(business.locator('[data-phase]')).toHaveText('Conectado');

  backend.addOrder();
  backend.failNextSnapshot();
  await business.evaluate(() => globalThis.__emitRealtimeStatus('CHANNEL_ERROR'));
  await expect(business.locator('[data-phase]')).toHaveText('Error recuperable');
  await expect(business.locator('[data-order]')).toHaveCount(3);
  await captureEvidence(business, 'business-intake-recoverable-error.png');
  await business.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(business.locator('[data-order]')).toHaveCount(4);
  await expect(business.locator('[data-phase]')).toHaveText('Conectado');

  await business.reload();
  await business.evaluate(() => globalThis.__intakeReady);
  await expect(business.locator('[data-order]')).toHaveCount(4);
  await expect(business.locator('[data-phase]')).toHaveText('Conectado');
  await captureEvidence(business, 'business-intake-recovered-after-reload.png');

  await clientContext.close();
  await businessContext.close();
});

test('tres pestañas convergen, alertan una vez y siguen tras cerrar la primera', async ({ browser }) => {
  const backend = createIntakeBackend();
  const clientContext = await browser.newContext();
  const businessContext = await browser.newContext();
  await backend.install(clientContext);
  await backend.install(businessContext);
  const client = await clientContext.newPage();
  const tabs = await Promise.all([0, 1, 2].map(() => businessContext.newPage()));

  await client.goto(`${HARNESS_PATH}?client=1`);
  await Promise.all(tabs.map(async (page) => {
    await page.goto(HARNESS_PATH);
    await page.evaluate(() => globalThis.__intakeReady);
  }));
  await confirmClientOrder(client);
  await tabs[0].evaluate(() => globalThis.__emitRealtime({ new: { id: 'partial' } }));

  await Promise.all(tabs.map((page) => expect(page.locator('[data-order]')).toHaveCount(1)));
  await expect.poll(async () => sumAlertCounts(tabs)).toBe(1);
  await captureEvidence(tabs[1], 'business-intake-three-tabs.png');

  await tabs[0].close();
  const survivingAlertBaseline = await sumAlertCounts(tabs.slice(1));
  await confirmClientOrder(client, { resetRequest: true });
  await tabs[1].evaluate(() => globalThis.__emitRealtime({ new: { id: 'after-close' } }));
  await expect(tabs[1].locator('[data-order]')).toHaveCount(2);
  await expect(tabs[2].locator('[data-order]')).toHaveCount(2);
  await expect.poll(async () => sumAlertCounts(tabs.slice(1))).toBe(survivingAlertBaseline + 1);

  await clientContext.close();
  await businessContext.close();
});

test('el panel Negocio real muestra estado honesto y conserva tarjetas ante falla Realtime', async ({ page }) => {
  const rows = [syntheticDatabaseOrder(1)];
  const session = staffSession();
  await page.routeWebSocket('wss://taba-business-intake-e2e.supabase.co/**', (socket) => {
    socket.close({ code: 1011, reason: 'Realtime fault injected by intake E2E' });
  });
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/auth/v1/token')) {
      await json(route, session);
      return;
    }
    if (url.pathname.endsWith('/auth/v1/user')) {
      await json(route, session.user);
      return;
    }
    if (url.pathname.includes('/rest/v1/business_members')) {
      await json(route, {
        business_id: BUSINESS_ID,
        user_id: STAFF_ID,
        role: 'staff',
        is_active: true,
      });
      return;
    }
    if (url.pathname.includes('/rest/v1/orders')) {
      await json(route, rows, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
      return;
    }
    if (url.pathname.includes('/rest/v1/businesses')) {
      await json(route, businessFixture());
      return;
    }
    if (url.pathname.includes('/rest/v1/rpc/list_active_business_riders')) {
      await json(route, []);
      return;
    }
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) {
      await json(route, []);
      return;
    }
    if (url.pathname.includes('/rest/v1/products')) {
      await json(route, [], { 'content-range': '0-0/0' });
      return;
    }
    await json(route, []);
  });
  await page.addInitScript(({ businessId, session: persistedSession, supabaseUrl }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        deploymentEnvironment: 'staging',
        supabaseUrl,
        publishableKey: 'sb_publishable_business_intake_e2e',
        businessId,
        pollMs: 60_000,
      },
    };
    localStorage.setItem('sb-taba-business-intake-e2e-auth-token', JSON.stringify(persistedSession));
  }, { businessId: BUSINESS_ID, session, supabaseUrl: SUPABASE_URL });

  await page.goto('/#business');
  const workspace = page.locator('[data-production-workspace="business"]');
  await expect(workspace).toBeVisible();
  await expect(workspace.locator('.production-order-card')).toHaveCount(1);
  await expect(workspace).toContainText('Cliente sintético 1');
  await expect(workspace.locator('[data-business-intake-status] strong')).toHaveText('Conectado');
  await expect(workspace.locator('[data-business-intake-status]')).toContainText('Última sincronización:');

  rows.push(syntheticDatabaseOrder(2));
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(workspace.locator('.production-order-card')).toHaveCount(2);
  await expect(workspace).toContainText('Cliente sintético 2');
  await captureEvidence(page, 'business-panel-connected.png');
});

async function confirmClientOrder(page, { resetRequest = false } = {}) {
  if (resetRequest) {
    await page.locator('[data-create-order]').evaluate((button) => {
      delete button.dataset.requestId;
    });
  }
  await page.locator('[data-create-order]').click();
  await expect(page.locator('[data-client-result]')).toContainText('Pedido confirmado:');
}

async function sumAlertCounts(pages) {
  const counts = await Promise.all(pages.filter((page) => !page.isClosed()).map(async (page) => {
    const text = await page.locator('[data-alert-count]').textContent();
    return Number(text?.match(/\d+/)?.[0] || 0);
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

function createIntakeBackend() {
  const orders = [];
  const requests = new Map();
  let sequence = 0;
  let failSnapshot = false;

  function addOrder(clientRequestId = `synthetic-${sequence + 1}`) {
    if (requests.has(clientRequestId)) return requests.get(clientRequestId);
    sequence += 1;
    const order = syntheticOrder(sequence);
    requests.set(clientRequestId, order);
    orders.push(order);
    return order;
  }

  return {
    addOrder,
    failNextSnapshot() {
      failSnapshot = true;
    },
    async install(context) {
      await context.route('**/__intake/snapshot', async (route) => {
        if (failSnapshot) {
          failSnapshot = false;
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            orders,
            syncedAt: new Date().toISOString(),
          }),
        });
      });
      await context.route('**/__intake/create', async (route) => {
        const payload = JSON.parse(route.request().postData() || '{}');
        const order = addOrder(String(payload.clientRequestId || ''));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, order }),
        });
      });
    },
  };
}

function syntheticOrder(index) {
  const suffix = String(index).padStart(12, '0');
  const createdAt = new Date(Date.UTC(2026, 7, 2, 12, 0, index)).toISOString();
  return {
    id: `LT-SYN-${String(index).padStart(3, '0')}`,
    backendId: `33333333-3333-4333-8333-${suffix}`,
    code: `LT-SYN-${String(index).padStart(3, '0')}`,
    revision: 1,
    workflowStatus: 'submitted',
    status: 'received',
    createdAt,
    updatedAt: createdAt,
    customerName: `Cliente sintético ${index}`,
    customerPhone: '2990000000',
    deliveryMode: 'pickup',
    items: [{ productId: 'product-1', name: 'Agua', quantity: 1, unitPrice: 100 }],
    total: 100,
    currencyCode: 'ARS',
  };
}

function syntheticDatabaseOrder(index) {
  const suffix = String(index).padStart(12, '0');
  const createdAt = new Date(Date.UTC(2026, 7, 2, 12, 0, index)).toISOString();
  return {
    id: `33333333-3333-4333-8333-${suffix}`,
    business_id: BUSINESS_ID,
    public_code: `LT-SYN-${String(index).padStart(3, '0')}`,
    code: `LT-SYN-${String(index).padStart(3, '0')}`,
    revision: 1,
    status: 'submitted',
    delivery_mode: 'pickup',
    fulfillment_type: 'pickup',
    customer_name: `Cliente sintético ${index}`,
    customer_phone: '2990000000',
    customer_notes: '',
    address_label: 'Retiro en local',
    payment_method: 'cash',
    subtotal: 100,
    delivery_fee: 0,
    total: 100,
    currency_code: 'ARS',
    created_at: createdAt,
    updated_at: createdAt,
    order_events: [{
      id: `66666666-6666-4666-8666-${suffix}`,
      order_id: `33333333-3333-4333-8333-${suffix}`,
      sequence: index,
      event_type: 'order.received',
      metadata: { source: 'e2e' },
      payload: { source: 'e2e' },
      created_at: createdAt,
    }],
    order_items: [{
      id: `44444444-4444-4444-8444-${suffix}`,
      order_id: `33333333-3333-4333-8333-${suffix}`,
      product_uuid: '55555555-5555-4555-8555-555555555555',
      product_id: '55555555-5555-4555-8555-555555555555',
      name: 'Agua mineral',
      quantity: 1,
      unit: 'botella',
      unit_price: 100,
      subtotal: 100,
    }],
  };
}

function businessFixture() {
  return {
    id: BUSINESS_ID,
    name: 'La Taba sintética',
    address: 'Neuquén',
    currency_code: 'ARS',
    ordering_enabled: true,
    ordering_verified: true,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_fee: 0,
    minimum_delivery_subtotal: 0,
    is_active: true,
    status: 'active',
  };
}

function staffSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = fakeJwt({ sub: STAFF_ID, exp: expiresAt, role: 'authenticated' });
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'business-intake-e2e-refresh',
    user: {
      id: STAFF_ID,
      aud: 'authenticated',
      role: 'authenticated',
      is_anonymous: false,
      user_metadata: { taba_actor: 'staff' },
    },
  };
}

function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
}

async function json(route, body, headers = {}) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });
}

async function captureEvidence(page, filename) {
  const evidenceDirectory = String(process.env.TABA_INTAKE_EVIDENCE_DIR || '').trim();
  if (!evidenceDirectory) return;
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage: true,
  });
}
