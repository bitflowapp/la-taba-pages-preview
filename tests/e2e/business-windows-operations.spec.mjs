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

test('panel fiscal usa artefactos privados, descarga, reimpresiÃ³n y nota de crÃ©dito fixture', async ({ page }) => {
  const invoiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const creditId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const pendingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const regenerateId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const invoiceArtifactId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const creditArtifactId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const session = staffSession();
  await installRuntime(page, session, {
    desktop: true,
    profile: { environment: 'homologation', accountant_review_status: 'approved', production_gate_status: 'blocked', is_enabled: true },
    documents: [
      fiscalFixture({ id: invoiceId, document_intent: 'invoice', document_type: 11, document_number: 42, state: 'authorized', artifact_state: 'artifact_ready', cae: '12345678901234', fiscal_document_items: [{ id: 'f1111111-1111-4111-8111-111111111111', description: 'Producto fiscal fixture', quantity: 2, unit_price: 50, net_amount: 100, tax_amount: 21, tax_code: '5', exempt_amount: 0, non_taxed_amount: 0, other_taxes_amount: 0 }] }),
      fiscalFixture({ id: creditId, document_intent: 'credit_note', document_type: 13, document_number: 43, state: 'authorized', artifact_state: 'artifact_ready', cae: '43210987654321', associated_document_id: invoiceId, credit_kind: 'partial' }),
      fiscalFixture({ id: pendingId, document_intent: 'invoice', document_type: 11, document_number: 44, state: 'ambiguous', artifact_state: 'artifact_failed', artifact_error_code: 'ARTIFACT_SOURCE_INCOMPLETE', artifact_error_message: 'El snapshot autorizado no estÃ¡ completo.' }),
      fiscalFixture({ id: regenerateId, document_intent: 'invoice', document_type: 11, document_number: 45, state: 'authorized', artifact_state: 'artifact_pending', cae: '98765432101234' }),
    ],
    artifacts: [
      { artifact_id: invoiceArtifactId, fiscal_document_id: invoiceId, artifact_type: 'authorized_pdf', mime_type: 'application/pdf', size_bytes: 42, sha256: 'a'.repeat(64), document_number: 42, generation_version: 'fixture-v1', generated_at: '2026-08-02T12:00:00Z', is_current: true },
      { artifact_id: creditArtifactId, fiscal_document_id: creditId, artifact_type: 'authorized_pdf', mime_type: 'application/pdf', size_bytes: 42, sha256: 'b'.repeat(64), document_number: 43, generation_version: 'fixture-v1', generated_at: '2026-08-02T12:00:00Z', is_current: true },
    ],
    regenerationFailure: 'owner/admin requerido para regenerar',
  });
  await page.goto('/#business');
  const workspace = page.locator('[data-production-workspace="business"]');
  await workspace.locator('[data-business-ops-view="fiscal-status"]').first().click();
  const invoice = workspace.locator(`article[data-fiscal-document="${invoiceId}"]`);
  await expect(invoice).toContainText('PDF disponible');
  await expect(invoice).toContainText('SHA-256 aaaaaaaa');
  await expect(workspace.locator(`article[data-fiscal-document="${creditId}"]`)).toContainText(/Nota de cr.dito/);
  await expect(workspace.locator(`article[data-fiscal-document="${pendingId}"]`)).toContainText('PDF fallido');

  await invoice.locator(`[data-fiscal-preview="${invoiceArtifactId}"]`).click();
  await expect(workspace.locator('[data-fiscal-preview-surface]')).toBeVisible();
  await expect(workspace.locator('[data-fiscal-preview-surface] iframe')).toHaveAttribute('src', 'https://signed.example.invalid/document.pdf');

  const downloadPromise = page.waitForEvent('download');
  await invoice.locator(`[data-fiscal-download="${invoiceArtifactId}"]`).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  page.once('dialog', (dialog) => dialog.accept());
  await invoice.locator('[name="fiscalPrinter"]').selectOption('Printer Fixture');
  await invoice.locator('[data-fiscal-print]').click();
  await expect(workspace.locator('.business-ops-feedback')).toContainText('spooler');

  await invoice.locator('summary').click();
  await invoice.locator('[name="creditReason"]').fill('DevoluciÃ³n parcial sintÃ©tica');
  await invoice.locator('[name="creditKind"]').selectOption('partial');
  await invoice.locator('[data-credit-line] [name="creditQuantity"]').fill('1');
  await invoice.locator('[data-fiscal-credit-note]').click();
  await expect(workspace.locator('.business-ops-feedback')).toContainText(/Nota de cr.dito solicitada/);

  await workspace.locator(`[data-fiscal-regenerate="${regenerateId}"]`).click();
  await expect(workspace.locator('.business-ops-feedback')).toContainText('owner/admin requerido');
});

async function installRuntime(page, session, fiscal = null) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/v1/user')) return json(route, session.user);
    if (url.pathname.includes('/auth/v1/token')) return json(route, session);
    if (url.pathname.includes('/rest/v1/business_members')) return json(route, { business_id: BUSINESS_ID, user_id: STAFF_ID, role: 'staff', is_active: true });
    if (url.pathname.includes('/rest/v1/businesses')) return json(route, businessFixture());
    if (url.pathname.includes('/rest/v1/product_barcodes')) return json(route, barcodeFixture(url.searchParams.get('gtin') || ''));
    if (url.pathname.includes('/functions/v1/fiscal-artifact-access')) return json(route, fiscal?.artifactAccess || { signedUrl: 'https://signed.example.invalid/document.pdf', expiresAt: '2026-08-02T12:01:00Z', sha256: 'a'.repeat(64) });
    if (url.pathname.includes('/rest/v1/fiscal_profiles')) return json(route, fiscal?.profile || { environment: 'disabled', accountant_review_status: 'pending', production_gate_status: 'blocked', is_enabled: false });
    if (url.pathname.includes('/rest/v1/rpc/list_fiscal_document_artifacts')) return json(route, fiscal?.artifacts || []);
    if (url.pathname.includes('/rest/v1/rpc/request_credit_note')) return fiscal?.creditResponse ? json(route, fiscal.creditResponse) : json(route, { fiscal_document_id: 'credit-queued', state: 'queued' });
    if (url.pathname.includes('/rest/v1/rpc/request_fiscal_print_job')) return json(route, fiscal?.printResponse || { print_job_id: '99999999-9999-4999-8999-999999999999', status: 'queued' });
    if (url.pathname.includes('/rest/v1/rpc/update_fiscal_print_job')) return json(route, { print_job_id: '99999999-9999-4999-8999-999999999999', status: 'sent_to_spooler' });
    if (url.pathname.includes('/rest/v1/rpc/request_fiscal_artifact_regeneration')) return fiscal?.regenerationFailure
      ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: fiscal.regenerationFailure }) })
      : json(route, { fiscal_document_id: 'fixture', artifact_state: 'artifact_pending' });
    if (url.pathname.includes('/rest/v1/fiscal_documents')) return json(route, fiscal?.documents || []);
    if (url.pathname.includes('/rest/v1/rpc/checkout_pos_sale')) return json(route, { sale_id: '77777777-7777-4777-8777-777777777777', state: 'completed', total: 600 });
    if (url.pathname.includes('/rest/v1/rpc/request_fiscal_document')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'fiscalizacion deshabilitada' }) });
    if (url.pathname.includes('/rest/v1/rpc/list_active_business_riders')) return json(route, []);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) return json(route, []);
    if (url.pathname.includes('/rest/v1/orders')) return json(route, []);
    if (url.pathname.includes('/rest/v1/products')) return json(route, []);
    return json(route, []);
  });
  await page.route('https://signed.example.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="fixture.pdf"' }, body: '%PDF-1.4\nfixture\n%%EOF' }));
  await page.addInitScript(({ businessId, persistedSession, supabaseUrl, desktop }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_business_windows_e2e', businessId, pollMs: 60_000,
      },
    };
    localStorage.setItem('sb-taba-business-windows-e2e-auth-token', JSON.stringify(persistedSession));
    if (desktop) {
      globalThis.__TAURI__ = { core: { invoke: async (command) => {
        if (command === 'initialize_business_runtime') return true;
        if (command === 'outbox_list') return [];
        if (command === 'outbox_get' || command === 'outbox_find_by_idempotency_key') return null;
        if (command === 'outbox_put') return true;
        if (command === 'list_printers') return [{ name: 'Printer Fixture', isDefault: true }];
        if (command === 'queue_fiscal_print') return { status: 'sent_to_spooler', errorCode: null };
        if (command === 'open_fiscal_cache_folder') return true;
        throw new Error(`Unexpected Tauri command: ${command}`);
      } } };
    }
  }, { businessId: BUSINESS_ID, persistedSession: session, supabaseUrl: SUPABASE_URL, desktop: Boolean(fiscal?.desktop) });
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

function fiscalFixture(overrides = {}) {
  return {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', business_id: BUSINESS_ID, source_type: 'pos_sale', source_id: '99999999-9999-4999-8999-999999999999',
    document_intent: 'invoice', environment: 'homologation', point_of_sale: 1, document_type: 11, document_number: 1,
    issue_date: '2026-08-02', currency: 'PES', total_amount: 121, net_amount: 100, tax_amount: 21, exempt_amount: 0, non_taxed_amount: 0, other_taxes_amount: 0,
    state: 'authorized', result: 'A', cae: '12345678901234', cae_expiration: '20260812', artifact_state: 'artifact_ready', artifact_error_code: null, artifact_error_message: null,
    observations: [], errors: [], associated_document_id: null, credit_kind: null, credit_reason: null, created_at: '2026-08-02T12:00:00Z', authorized_at: '2026-08-02T12:00:01Z', fiscal_document_items: [],
    ...overrides,
  };
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
