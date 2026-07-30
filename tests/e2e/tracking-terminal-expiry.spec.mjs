import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-tracking-terminal-e2e.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const TERMINAL_ORDER_ID = '70000000-0000-4000-8000-000000000001';
const ACTIVE_ORDER_ID = '70000000-0000-4000-8000-000000000002';
const PRODUCT_ID = '30000000-0000-4000-8000-000000000001';
const TERMINAL_PUBLIC_CODE = 'LT-TERMINAL-A';
const ACTIVE_PUBLIC_CODE = 'LT-ACTIVE-B';
const TRACKING_TOKEN = 'terminal_tracking_token_e2e_1234567890ABCDE';
const ACCESS_KEY = `taba-order-access-v1:${BUSINESS_ID}:last`;
const FIXED_TIME = Date.parse('2026-07-30T02:30:00.000Z');

test('tracking terminal vence, limpia sólo Pedido A y no cae en Pedido B', async ({ page }) => {
  const terminalVisibleUntil = new Date(FIXED_TIME + 30_000).toISOString();
  await page.clock.install({ time: FIXED_TIME });
  const fixture = await installTerminalTrackingFixture(page, { terminalVisibleUntil });
  await installTerminalTrackingRuntime(page);

  await page.goto('/#tracking');
  await expect.poll(() => fixture.requestCount()).toBe(1);
  console.log('terminal-expiry-diagnostic', JSON.stringify({
    browserNow: await page.evaluate(() => new Date().toISOString()),
    accessRemovals: await page.evaluate(() => globalThis.__terminalAccessRemovals || []),
    requests: fixture.requests(),
    snapshot: await browserSnapshot(page),
  }));
  await expectTerminalOrder(page);
  expect(fixture.requestTokens()).toEqual([TRACKING_TOKEN]);

  fixture.makeUnavailable();
  const revalidationRequest = page.waitForRequest(isPublicTrackingRequest);
  await page.clock.fastForward(31_000);
  await revalidationRequest;

  await expectFailClosedCleanup(page);
  expect(fixture.requestCount()).toBe(2);

  const settledRequestCount = fixture.requestCount();
  await page.clock.fastForward(60_000);
  expect(fixture.requestCount()).toBe(settledRequestCount);
});

test('tracking terminal revocado coalesce lifecycle y limpia sin fallback', async ({ page }) => {
  const terminalVisibleUntil = new Date(FIXED_TIME + (30 * 60_000)).toISOString();
  await page.clock.install({ time: FIXED_TIME });
  const fixture = await installTerminalTrackingFixture(page, { terminalVisibleUntil });
  await installTerminalTrackingRuntime(page);

  await page.goto('/#tracking');
  await expectTerminalOrder(page);
  await expect.poll(() => fixture.requestCount()).toBe(1);
  expect(fixture.requestTokens()).toEqual([TRACKING_TOKEN]);

  fixture.makeUnavailable();
  const revalidationRequest = page.waitForRequest(isPublicTrackingRequest);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await revalidationRequest;

  await expectFailClosedCleanup(page);
  expect(fixture.requestCount()).toBe(2);

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(60_000);
  expect(fixture.requestCount()).toBe(2);
});

async function installTerminalTrackingFixture(page, { terminalVisibleUntil }) {
  let available = true;
  const trackingRequests = [];

  await page.routeWebSocket(
    SUPABASE_URL.replace('https://', 'wss://') + '/**',
    (socket) => socket.close({ code: 1000, reason: 'Playwright terminal tracking fixture' }),
  );
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith('/rest/v1/rpc/get_public_order_tracking')) {
      trackingRequests.push({
        publicId: JSON.parse(request.postData() || '{}').p_public_id || '',
        token: request.headers()['x-order-token'] || '',
      });
      await json(route, available ? terminalTrackingDto(terminalVisibleUntil) : null);
      return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/get_public_business_contact')) {
      await json(route, {
        whatsapp_phone: null,
        whatsapp_verified: false,
      });
      return;
    }

    if (url.pathname.includes('/rest/v1/businesses')) {
      await json(route, businessFixture());
      return;
    }

    if (url.pathname.includes('/rest/v1/products')) {
      await json(route, [productFixture()], { 'content-range': '0-0/1' });
      return;
    }

    if (url.pathname.includes('/rest/v1/orders')) {
      await json(route, [activeOrderFixture()], { 'content-range': '0-0/1' });
      return;
    }

    if (url.pathname.includes('/auth/v1/')) {
      await json(route, {});
      return;
    }

    await json(route, []);
  });

  return {
    makeUnavailable() {
      available = false;
    },
    requestCount() {
      return trackingRequests.length;
    },
    requestTokens() {
      return trackingRequests.map(({ token }) => token);
    },
    requests() {
      return structuredClone(trackingRequests);
    },
  };
}

async function installTerminalTrackingRuntime(page) {
  await page.addInitScript(({
    accessKey,
    businessId,
    orderId,
    publicCode,
    supabaseUrl,
    token,
    tokenExpiresAt,
  }) => {
    localStorage.clear();
    sessionStorage.clear();
    globalThis.__terminalAccessRemovals = [];
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function removeItem(key) {
      if (key === accessKey) {
        globalThis.__terminalAccessRemovals.push(new Error('tracking access removed').stack);
      }
      return originalRemoveItem.call(this, key);
    };
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl,
        publishableKey: 'sb_publishable_terminal_tracking_e2e',
        businessId,
        pollMs: 5_000,
      },
    };
    sessionStorage.setItem(accessKey, JSON.stringify({
      orderId,
      publicCode,
      trackingToken: token,
      tokenExpiresAt,
      transferredAt: new Date().toISOString(),
    }));
  }, {
    accessKey: ACCESS_KEY,
    businessId: BUSINESS_ID,
    orderId: TERMINAL_ORDER_ID,
    publicCode: TERMINAL_PUBLIC_CODE,
    supabaseUrl: SUPABASE_URL,
    token: TRACKING_TOKEN,
    tokenExpiresAt: new Date(FIXED_TIME + (60 * 60_000)).toISOString(),
  });
}

async function expectTerminalOrder(page) {
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('[data-tracking-title]')).toHaveText('Pedido entregado');
  await expect(tracking.locator('[data-tracking-status="delivered"]')).toBeVisible();
  await expect(tracking.locator('[data-map-shell="tracking"]')).toHaveCount(0);
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('[data-delivery-code]')).toHaveCount(0);

  const snapshot = await browserSnapshot(page);
  expect(snapshot.access).not.toBeNull();
  expect(snapshot.lastOrderId).toBe(TERMINAL_PUBLIC_CODE);
  expect(snapshot.activeOrderId).toBe(TERMINAL_PUBLIC_CODE);
  expect(snapshot.poll).toMatchObject({
    active: false,
    terminal: true,
    inFlight: false,
    orderId: TERMINAL_ORDER_ID,
    status: 'delivered',
  });
  expect(snapshot.orders).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: TERMINAL_PUBLIC_CODE,
      status: 'delivered',
      publicTrackingOnly: true,
      hasDeliveryCode: false,
      hasTracking: false,
    }),
    expect.objectContaining({
      id: ACTIVE_PUBLIC_CODE,
      status: 'preparing',
      publicTrackingOnly: false,
    }),
  ]));
}

async function expectFailClosedCleanup(page) {
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.getByRole('heading', {
    name: 'Todavía no hay un pedido en curso',
  })).toBeVisible();
  await expect(tracking.locator('[data-tracking-status="empty"]')).toBeVisible();
  await expect(tracking.locator('[data-map-shell="tracking"]')).toHaveCount(0);
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('[data-delivery-code]')).toHaveCount(0);

  const snapshot = await browserSnapshot(page);
  expect(snapshot.access).toBeNull();
  expect(snapshot.lastOrderId).toBeNull();
  expect(snapshot.activeOrderId).toBeNull();
  expect(snapshot.poll).toEqual({
    active: false,
    terminal: false,
    inFlight: false,
    orderId: '',
    status: '',
  });
  expect(snapshot.orders).toEqual([
    expect.objectContaining({
      id: ACTIVE_PUBLIC_CODE,
      status: 'preparing',
      publicTrackingOnly: false,
      hasDeliveryCode: false,
      hasTracking: false,
    }),
  ]);
}

async function browserSnapshot(page) {
  return page.evaluate(async ({ accessKey }) => {
    const [{ getState }, { getActiveOrder }, { getOrderRepository }] = await Promise.all([
      import(new URL('js/state.js', location.href).href),
      import(new URL('js/orders.js', location.href).href),
      import(new URL('js/repositories/repository_factory.js', location.href).href),
    ]);
    const state = getState();
    return {
      access: sessionStorage.getItem(accessKey),
      lastOrderId: state.lastOrderId,
      activeOrderId: getActiveOrder()?.id || null,
      poll: getOrderRepository().getCustomerTrackingPollState(),
      orders: state.orders.map((order) => ({
        id: order.id,
        status: order.status,
        publicTrackingOnly: order.publicTrackingOnly === true,
        hasDeliveryCode: Boolean(order.deliveryCode?.code),
        hasTracking: Boolean(order.tracking?.lastLocation),
      })),
    };
  }, { accessKey: ACCESS_KEY });
}

function isPublicTrackingRequest(request) {
  return new URL(request.url()).pathname.endsWith('/rest/v1/rpc/get_public_order_tracking');
}

async function json(route, body, headers = {}) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });
}

function terminalTrackingDto(terminalVisibleUntil) {
  return {
    public_code: TERMINAL_PUBLIC_CODE,
    status: 'delivered',
    delivery_mode: 'delivery',
    created_at: '2026-07-30T02:00:00.000Z',
    accepted_at: '2026-07-30T02:05:00.000Z',
    preparing_at: '2026-07-30T02:10:00.000Z',
    ready_at: '2026-07-30T02:15:00.000Z',
    dispatched_at: '2026-07-30T02:20:00.000Z',
    arrived_at: '2026-07-30T02:25:00.000Z',
    delivered_at: '2026-07-30T02:29:00.000Z',
    updated_at: '2026-07-30T02:29:00.000Z',
    terminal_visible_until: terminalVisibleUntil,
  };
}

function businessFixture() {
  return {
    id: BUSINESS_ID,
    name: 'TABA Tracking E2E',
    address: 'Neuquén',
    currency_code: 'ARS',
    ordering_enabled: true,
    ordering_verified: true,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_fee: 0,
    minimum_delivery_subtotal: 0,
    is_active: true,
    status: 'open',
  };
}

function productFixture() {
  return {
    id: PRODUCT_ID,
    business_id: BUSINESS_ID,
    external_id: 'tracking-terminal-e2e-product',
    sku: 'TRACKING-TERMINAL-E2E',
    name: 'Agua mineral E2E',
    brand: 'TABA',
    description: 'Producto aislado para tracking terminal.',
    category: 'Aguas',
    subcategory: 'Agua sin gas',
    variant: 'Botella 500 ml',
    presentation: 'Botella 500 ml',
    capacity_value: 500,
    capacity_unit: 'ml',
    capacity: '500 ml',
    packaging_type: 'botella',
    units_per_pack: 1,
    price: 1200,
    stock: 10,
    available: true,
    chilled: false,
    is_alcoholic: false,
    minimum_age: null,
    image_url: '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/product.webp',
    image_thumbnail_url: '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/thumbnail.webp',
    image_sha256: '',
    image_thumbnail_sha256: '',
    source_image_sha256: '',
    tags: [],
    sort_order: 1,
    is_active: true,
    is_verified: true,
  };
}

function activeOrderFixture() {
  return {
    id: ACTIVE_ORDER_ID,
    public_code: ACTIVE_PUBLIC_CODE,
    business_id: BUSINESS_ID,
    status: 'preparing',
    delivery_mode: 'delivery',
    customer_name: 'Cliente activo',
    customer_phone: '2995550000',
    delivery_street: 'Roca',
    delivery_street_number: '500',
    delivery_city: 'Neuquén',
    delivery_address_formatted: 'Roca 500, Neuquén',
    payment_method: 'cash',
    created_at: '2026-07-30T02:15:00.000Z',
    updated_at: '2026-07-30T02:20:00.000Z',
    accepted_at: '2026-07-30T02:18:00.000Z',
    preparing_at: '2026-07-30T02:20:00.000Z',
    subtotal: 1200,
    delivery_fee: 0,
    total: 1200,
    currency_code: 'ARS',
    order_items: [{
      product_uuid: PRODUCT_ID,
      product_name: 'Agua mineral E2E',
      quantity: 1,
      unit_price: 1200,
      presentation: 'Botella 500 ml',
    }],
  };
}
