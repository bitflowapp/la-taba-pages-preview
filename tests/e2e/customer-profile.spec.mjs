import { expect, test } from '@playwright/test';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';

test('Perfil permite editar datos y direcciones propias sin overflow ni PII en consola', async ({ page }) => {
  const consoleMessages = [];
  const rpcCalls = [];
  page.on('console', (message) => consoleMessages.push(message.text()));

  const remote = {
    profile: { id: CUSTOMER_ID, name: 'Cliente Demo', phone: '2990000000' },
    addresses: [
      address({
        id: '20000000-0000-4000-8000-000000000001',
        label: 'Casa',
        street: 'Calle Demo',
        streetNumber: '100',
        city: 'Ciudad Demo',
        province: 'Provincia Demo',
        reference: 'Referencia de prueba',
        isDefault: true,
      }),
      address({
        id: '20000000-0000-4000-8000-000000000002',
        label: 'Trabajo',
        street: 'Avenida Ficticia',
        streetNumber: '200',
        floor: '2',
        apartment: 'B',
        city: 'Ciudad Demo',
        province: 'Provincia Demo',
        reference: 'Referencia de prueba',
      }),
    ],
  };

  await installRuntime(page);
  await page.route('https://taba-customer-profile-screen.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([^/]+)/)?.[1] || '';
    if (url.pathname.includes('/auth/v1/token')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authSession()) });
      return;
    }
    if (rpc === 'get_current_customer_profile') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote) });
      return;
    }
    if (rpc === 'upsert_current_customer_profile') {
      const payload = route.request().postDataJSON();
      rpcCalls.push({ rpc, payload });
      remote.profile = { ...remote.profile, name: payload.p_name, phone: payload.p_phone };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote.profile) });
      return;
    }
    if (rpc === 'upsert_current_customer_address') {
      const payload = route.request().postDataJSON();
      rpcCalls.push({ rpc, payload });
      const saved = address({
        ...payload.p_address,
        id: payload.p_address.id || '20000000-0000-4000-8000-000000000003',
      });
      remote.addresses = [saved, ...remote.addresses.filter((entry) => entry.id !== saved.id)];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, address: saved }),
      });
      return;
    }
    if (rpc === 'set_current_customer_default_address') {
      const payload = route.request().postDataJSON();
      rpcCalls.push({ rpc, payload });
      remote.addresses = remote.addresses.map((entry) => ({
        ...entry,
        isDefault: entry.id === payload.p_address_id,
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (rpc === 'archive_current_customer_address') {
      const payload = route.request().postDataJSON();
      rpcCalls.push({ rpc, payload });
      remote.addresses = remote.addresses.filter((entry) => entry.id !== payload.p_address_id);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: payload.p_address_id, archived: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: '[]',
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#profile');
  const profile = page.locator('[data-customer-profile]');
  await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
  await expect(profile).toContainText('Cliente Demo');
  await expect(profile).toContainText('299 000 0000');
  await expect(profile).toContainText('Calle Demo 100');
  await expect(profile).toContainText('Referencia de prueba');
  await expect(page.locator('.mobile-nav [data-nav-view="profile"]')).toHaveClass(/active/);

  await profile.locator('[data-profile-action="edit-personal"]').click();
  await profile.locator('[name="profileFullName"]').fill('  Cliente   Demo Editado  ');
  await profile.locator('[name="profilePhone"]').fill('(299) 000-0001');
  await profile.locator('[data-profile-action="save-personal"]').click();
  await expect(profile).toContainText('Cliente Demo Editado');
  await expect(profile).toContainText('299 000 0001');
  expect(rpcCalls.find((call) => call.rpc === 'upsert_current_customer_profile')?.payload).toEqual({
    p_name: 'Cliente Demo Editado',
    p_phone: '2990000001',
  });

  await profile.locator('[data-profile-action="add-address"]').click();
  await expect(profile.locator('[data-profile-address-form]')).toBeVisible();
  await expect(profile.locator('[name="profileAddressNumber"]')).toHaveAttribute('inputmode', 'text');
  await profile.locator('[name="profileAddressLabel"]').selectOption('Otra');
  await profile.locator('[name="profileAddressStreet"]').fill('San Martín');
  await profile.locator('[name="profileAddressNumber"]').fill('S/N');
  await profile.locator('[name="profileAddressCity"]').fill('Neuquén');
  await profile.locator('[name="profileAddressProvince"]').fill('Neuquén');
  await profile.locator('[name="profileAddressReference"]').fill('Puerta lateral');
  await profile.locator('[data-profile-action="save-address"]').click();
  await expect(profile).toContainText('San Martín S/N');
  const addressSave = rpcCalls.find((call) => call.rpc === 'upsert_current_customer_address');
  expect(addressSave.payload.p_address).not.toHaveProperty('customer_id');
  expect(addressSave.payload.p_address).not.toHaveProperty('user_id');
  expect(addressSave.payload.p_address.streetNumber).toBe('S/N');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const addressActionBoxes = await profile.locator('.profile-address-actions .text-button').evaluateAll(
    (buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, left: rect.left, right: rect.right };
    }),
  );
  expect(addressActionBoxes.length).toBeGreaterThan(0);
  expect(addressActionBoxes.every(({ height }) => height >= 44)).toBe(true);
  expect(addressActionBoxes.every(({ left, right }) => left >= 0 && right <= 320)).toBe(true);
  // La reserva inferior se declara UNA vez, en `main`, y Perfil ya no la
  // duplica. Se mide el efecto real —que la navegación no tape contenido al
  // final del scroll— en vez del valor duplicado.
  const layout = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: root.scrollHeight - root.clientHeight, behavior: 'instant' });
    const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
    const profile = document.querySelector('[data-view="profile"]').getBoundingClientRect();
    return {
      mainPaddingBottom: parseFloat(
        getComputedStyle(document.querySelector('main[data-app-main]')).paddingBottom,
      ),
      navBottom: getComputedStyle(document.querySelector('.mobile-nav')).bottom,
      gapOverNav: nav.top - profile.bottom,
    };
  });
  expect(layout.mainPaddingBottom).toBeGreaterThanOrEqual(56);
  expect(layout.gapOverNav).toBeGreaterThanOrEqual(0);
  expect(parseFloat(layout.navBottom)).toBeGreaterThanOrEqual(0);
  expect(consoleMessages.join('\n')).not.toContain('Cliente Demo');
  expect(consoleMessages.join('\n')).not.toContain('299000');
});

test('Perfil muestra una recuperación clara cuando la sesión venció', async ({ page }) => {
  await installRuntime(page);
  await page.route('https://taba-customer-profile-screen.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/rest/v1/rpc/get_current_customer_profile')) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/#profile');
  await expect(page.locator('[data-customer-profile]')).toContainText('Tu sesión venció');
});

async function installRuntime(page) {
  const session = authSession();
  await page.addInitScript(({ businessId, persistedSession }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://taba-customer-profile-screen.supabase.co',
        publishableKey: 'sb_publishable_test_key',
        businessId,
      },
    };
    localStorage.setItem('sb-taba-customer-profile-screen-auth-token', JSON.stringify(persistedSession));
  }, { businessId: BUSINESS_ID, persistedSession: session });
}

function address(overrides = {}) {
  const street = overrides.street || '';
  const streetNumber = overrides.streetNumber || '';
  const city = overrides.city || 'Neuquén';
  return {
    id: overrides.id || '',
    label: overrides.label || 'Casa',
    formattedAddress: overrides.formattedAddress || `${street} ${streetNumber}, ${city}`.trim(),
    street,
    streetNumber,
    floor: overrides.floor || '',
    apartment: overrides.apartment || '',
    city,
    province: overrides.province || 'Neuquén',
    postalCode: overrides.postalCode || '',
    reference: overrides.reference || '',
    isDefault: overrides.isDefault === true,
    source: 'manual',
  };
}

function authSession() {
  const token = fakeJwt({ sub: CUSTOMER_ID, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' });
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-token-for-e2e-only',
    user: { id: CUSTOMER_ID, aud: 'authenticated', role: 'authenticated', is_anonymous: true, user_metadata: { taba_actor: 'customer' } },
  };
}

function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
}
