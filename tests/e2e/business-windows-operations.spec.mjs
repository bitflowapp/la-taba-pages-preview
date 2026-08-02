import { expect, test } from '@playwright/test';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
const SUPABASE_URL = 'https://taba-business-windows-e2e.supabase.co';

test('panel Windows recorre las nueve herramientas, detecta GTIN y conserva la venta si falla fiscal', async ({ page }) => {
  const session = staffSession();
  await installRuntime(page, session);
  await page.goto('/#business');

  const workspace = page.locator('[data-production-workspace="business"]');
  await expect(workspace).toBeVisible();

  await workspace.locator('[data-business-ops-view="scanner"]').first().click();
  await expect(workspace.locator('[data-business-ops-center="scanner"]')).toBeVisible();
  await workspace.locator('[data-barcode-input]').fill('4006381333931');
  await workspace.locator('[data-business-scan-test]').click();
  await expect(workspace.locator('.business-scan-result')).toContainText('Producto E2E');
  await expect(workspace.locator('.business-scan-result')).toContainText('EAN-13');
  await expect(workspace.locator('.business-scan-result')).toContainText('Pack de 6');

  const views = [
    ['product-create', 'Alta de producto'],
    ['inventory-receive', 'Recepción de mercadería'],
    ['inventory-adjust', 'Ajuste de stock'],
    ['stock-count', 'Conteo físico'],
    ['packing', 'Preparación de pedido'],
    ['fiscal-status', 'Estado fiscal'],
    ['fiscal-config', 'Configuración fiscal'],
  ];
  for (const [view, heading] of views) {
    await workspace.locator(`[data-business-ops-view="${view}"]`).first().click();
    await expect(workspace.locator(`[data-business-ops-center="${view}"]`)).toBeVisible();
    await expect(workspace.getByRole('heading', { name: heading })).toBeVisible();
  }

  await workspace.locator('[data-business-ops-view="pos"]').first().click();
  await expect(workspace.locator('[data-business-ops-center="pos"]')).toBeVisible();
  await workspace.locator('[data-barcode-input]').fill('7894900011517');
  await workspace.locator('[data-business-scan-test]').click();
  await expect(workspace.locator('.business-ops-cart')).toContainText('Producto E2E');
  await workspace.locator('[name="requestFiscal"]').check();
  await workspace.locator('[data-pos-checkout]').click();
  await expect(workspace.locator('.business-ops-feedback')).toContainText('Venta confirmada; la solicitud fiscal requiere revisión.');
});

async function installRuntime(page, session) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/v1/user')) return json(route, session.user);
    if (url.pathname.includes('/auth/v1/token')) return json(route, session);
    if (url.pathname.includes('/rest/v1/business_members')) return json(route, { business_id: BUSINESS_ID, user_id: STAFF_ID, role: 'staff', is_active: true });
    if (url.pathname.includes('/rest/v1/businesses')) return json(route, businessFixture());
    if (url.pathname.includes('/rest/v1/product_barcodes')) return json(route, barcodeFixture(url.searchParams.get('gtin') || ''));
    if (url.pathname.includes('/rest/v1/fiscal_profiles')) return json(route, { environment: 'disabled', accountant_review_status: 'pending', production_gate_status: 'blocked', is_enabled: false });
    if (url.pathname.includes('/rest/v1/fiscal_documents')) return json(route, []);
    if (url.pathname.includes('/rest/v1/rpc/checkout_pos_sale')) return json(route, { sale_id: '77777777-7777-4777-8777-777777777777', state: 'completed', total: 600 });
    if (url.pathname.includes('/rest/v1/rpc/request_fiscal_document')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'fiscalizacion deshabilitada' }) });
    if (url.pathname.includes('/rest/v1/rpc/list_active_business_riders')) return json(route, []);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) return json(route, []);
    if (url.pathname.includes('/rest/v1/orders')) return json(route, []);
    if (url.pathname.includes('/rest/v1/products')) return json(route, []);
    return json(route, []);
  });
  await page.addInitScript(({ businessId, persistedSession, supabaseUrl }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_business_windows_e2e', businessId, pollMs: 60_000,
      },
    };
    localStorage.setItem('sb-taba-business-windows-e2e-auth-token', JSON.stringify(persistedSession));
  }, { businessId: BUSINESS_ID, persistedSession: session, supabaseUrl: SUPABASE_URL });
}

function barcodeFixture(gtinFilter) {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    business_id: BUSINESS_ID,
    product_id: PRODUCT_ID,
    gtin: String(gtinFilter).replace(/^eq[.]/, ''),
    barcode_type: 'ean13',
    package_type: 'pack',
    unit_factor: 6,
    is_primary: true,
    is_active: true,
    products: { id: PRODUCT_ID, name: 'Producto E2E', brand: null, presentation: 'Pack de 6', stock: 24, available: true, is_active: true, is_verified: true },
  };
}

function businessFixture() {
  return { id: BUSINESS_ID, name: 'TABA E2E', address: 'Neuquén', currency_code: 'ARS', ordering_enabled: true, ordering_verified: true, delivery_enabled: true, pickup_enabled: true, delivery_fee: 0, minimum_delivery_subtotal: 0, is_active: true, status: 'active' };
}

function staffSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: STAFF_ID, exp: expiresAt, role: 'authenticated' })}.signature`;
  return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, refresh_token: 'business-windows-e2e-refresh', user: { id: STAFF_ID, aud: 'authenticated', role: 'authenticated', is_anonymous: false, user_metadata: { taba_actor: 'staff' } } };
}

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}
