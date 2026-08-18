import { expect, test } from '@playwright/test';
import {
  DEFAULT_CHECKOUT_ADDRESSES,
  gotoDemoReset,
  installBrowserStubs,
  seedCartAboveMinimum,
  seedCheckoutProfile,
  selectCheckoutAddress,
  skipInstallInvitation,
  waitForToast,
} from './helpers.mjs';

// El primer pedido humano se creó con modalidad delivery, dirección escrita a
// mano y latitud/longitud NULL. Estas pruebas recorren, en el navegador, el paso
// que cierra ese hueco: confirmar dónde te entregamos, y que ese punto llegue
// entero al pedido, al Panel y al Rider.
//
// Corre en Chromium y en WebKit móvil. Safari es donde una parte real de los
// clientes va a apretar «Usar mi ubicación», y su permiso de geolocalización no
// se comporta igual.

// Teléfono, que es donde ocurre: la navegación inferior y el paso de ubicación
// se usan con el pulgar. El proyecto WebKit ya trae este tamaño; en Chromium se
// declara acá para medir lo mismo en los dos.
test.use({ viewport: { width: 390, height: 844 } });

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const SUPABASE_HOST = 'https://taba-location-confirmation.supabase.co';
const PUNTO_GPS = { latitude: -38.9539, longitude: -68.0596 };

test.describe('Perfil · confirmación del punto de entrega', () => {
  test('con permiso concedido: el GPS propone, la persona confirma y recién ahí se guarda', async ({ page, context }) => {
    const remote = createRemoteProfile();
    await installRuntime(page);
    await routeSupabase(page, remote);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ ...PUNTO_GPS, accuracy: 12 });

    await page.goto('/#profile');
    const profile = page.locator('[data-customer-profile]');
    await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');

    await profile.locator('[data-profile-action="add-address"]').click();
    await llenarDireccion(profile, { street: 'Antártida Argentina', number: '1450' });

    // El paso está a la vista y anuncia lo que hay que hacer.
    const paso = profile.locator('[data-location-step]');
    await expect(paso).toHaveAttribute('data-location-status', 'empty');
    await expect(paso).toContainText('Confirmá dónde te entregamos');

    // Guardar sin confirmar no guarda nada: ni una llamada a la base.
    await profile.locator('[data-profile-action="save-address"]').click();
    await expect(profile.locator('.profile-status')).toContainText('Confirmá en el mapa dónde te entregamos');
    expect(remote.calls.filter((call) => call.rpc === 'upsert_current_customer_address')).toHaveLength(0);

    // El permiso se pide recién ahora, después de la acción explícita.
    await paso.locator('[data-profile-action="use-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'pending');
    await expect(paso.locator('[data-location-coords]').first()).toContainText('-38.953900, -68.059600');

    // Recibir la ubicación no la confirma: hace falta el acto explícito.
    expect(remote.calls.filter((call) => call.rpc === 'upsert_current_customer_address')).toHaveLength(0);
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');
    await expect(paso).toContainText('Ubicación confirmada');

    await profile.locator('[data-profile-action="save-address"]').click();
    await expect(profile.locator('.profile-status')).toContainText('Dirección guardada');

    const guardado = remote.calls.find((call) => call.rpc === 'upsert_current_customer_address');
    expect(guardado, 'la dirección tiene que haberse guardado').toBeTruthy();
    expect(guardado.payload.p_address.latitude).toBeCloseTo(PUNTO_GPS.latitude, 4);
    expect(guardado.payload.p_address.longitude).toBeCloseTo(PUNTO_GPS.longitude, 4);
    expect(guardado.payload.p_address.locationSource).toBe('gps');
    expect(guardado.payload.p_address.locationConfirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(guardado.payload.p_address.geolocationAccuracy).toBeGreaterThan(0);
    // La huella del texto viaja sellada junto a la confirmación.
    expect(guardado.payload.p_address.locationConfirmedAddress).toContain('antartida argentina 1450');

    // Y la tarjeta lo declara.
    await expect(profile.locator('[data-address-location="confirmed"]').first()).toContainText('Ubicación confirmada');
  });

  test('con permiso rechazado: el pin en el mapa alcanza, sin compartir GPS', async ({ page, context }) => {
    const remote = createRemoteProfile();
    await installRuntime(page);
    await routeSupabase(page, remote);
    // Sin `grantPermissions` el navegador rechaza: es el caso real de quien no
    // quiere compartir su ubicación.
    await context.clearPermissions();

    await page.goto('/#profile');
    const profile = page.locator('[data-customer-profile]');
    await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
    await profile.locator('[data-profile-action="add-address"]').click();
    await llenarDireccion(profile, { street: 'Río Limay', number: '64' });

    const paso = profile.locator('[data-location-step]');
    await paso.locator('[data-profile-action="use-location"]').click();
    await expect(paso.locator('[data-location-error]')).toBeVisible();

    // El camino del mapa sigue abierto y no pide permisos.
    await paso.locator('[data-profile-action="open-location-map"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'pending');
    const antes = await paso.locator('[data-location-coords]').first().innerText();

    // Y el pin se puede mover a mano.
    await paso.locator('[data-location-nudge="norte"]').click();
    await expect(paso.locator('[data-location-coords]').first()).not.toHaveText(antes);

    await paso.locator('[data-profile-action="confirm-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');
    await profile.locator('[data-profile-action="save-address"]').click();
    await expect(profile.locator('.profile-status')).toContainText('Dirección guardada');

    const guardado = remote.calls.find((call) => call.rpc === 'upsert_current_customer_address');
    expect(guardado.payload.p_address.locationSource).toBe('map_pin');
    // Un pin marcado a mano no puede declarar la precisión de una medición GPS.
    expect(guardado.payload.p_address.geolocationAccuracy ?? null).toBeNull();
  });

  test('si MapLibre no inicia, explica el fallback y no confirma el punto del local por accidente', async ({ page }) => {
    const remote = createRemoteProfile();
    await page.route('https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js', (route) => route.abort());
    await installRuntime(page);
    await routeSupabase(page, remote);

    await page.goto('/#profile');
    const profile = page.locator('[data-customer-profile]');
    await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
    await profile.locator('[data-profile-action="add-address"]').click();
    await llenarDireccion(profile, { street: 'Río Limay', number: '64' });

    const paso = profile.locator('[data-location-step]');
    await paso.locator('[data-profile-action="open-location-map"]').click();
    await expect(paso.locator('[data-location-nomap]')).toContainText('Ajustá el punto');
    await expect(paso.locator('[data-profile-action="confirm-location"]')).toBeDisabled();

    await paso.locator('[data-location-nudge="norte"]').click();
    await expect(paso.locator('[data-profile-action="confirm-location"]')).toBeEnabled();
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');
  });

  // REGRESIÓN DEL FALLO HUMANO. La primera compra quedó bloqueada acá: el paso
  // de ubicación está debajo de los campos, la persona marcó el pin y después
  // terminó de escribir la dirección, y cada tecla posterior tiraba abajo la
  // confirmación. No podía guardar nunca, y dos de los tres órdenes fallaban en
  // silencio porque el re-render se comía el toque sobre «Guardar dirección».
  test('confirmar el pin ANTES de terminar de escribir la dirección igual guarda', async ({ page, context }) => {
    const remote = createRemoteProfile();
    await installRuntime(page);
    await routeSupabase(page, remote);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ ...PUNTO_GPS, accuracy: 12 });

    await page.goto('/#profile');
    const profile = page.locator('[data-customer-profile]');
    await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
    await profile.locator('[data-profile-action="add-address"]').click();
    await expect(profile.locator('[data-profile-address-form]')).toBeVisible();

    // Primero el pin, con el formulario todavía vacío.
    const paso = profile.locator('[data-location-step]');
    await paso.locator('[data-profile-action="use-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'pending');
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');

    // Y recién ahora la dirección, campo por campo, saliendo de cada uno.
    for (const [campo, valor] of [
      ['profileAddressStreet', 'Antártida Argentina'],
      ['profileAddressNumber', '1450'],
      ['profileAddressFloor', '2'],
      ['profileAddressReference', 'Portón negro'],
    ]) {
      await profile.locator(`[name="${campo}"]`).fill(valor);
      await profile.locator(`[name="${campo}"]`).blur();
      await expect(
        paso,
        `escribir ${campo} no puede tirar abajo un pin recién confirmado`,
      ).toHaveAttribute('data-location-status', 'confirmed');
    }

    await profile.locator('[data-profile-action="save-address"]').click();
    await expect(profile.locator('.profile-status')).toContainText('Dirección guardada');

    const guardado = remote.calls.find((call) => call.rpc === 'upsert_current_customer_address');
    expect(guardado.payload.p_address.locationSource).toBe('gps');
    expect(guardado.payload.p_address.locationConfirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // La huella es la del texto FINAL, no la del formulario vacío. Incluye la
    // localidad y la provincia que completa el área de operación: la pregunta
    // se quitó de la pantalla, el dato sigue formando parte de la dirección y
    // por lo tanto de su huella.
    expect(guardado.payload.p_address.locationConfirmedAddress)
      .toBe('antartida argentina 1450 neuquen capital neuquen');

    // Y el eslabón que la certificación anterior nunca probó: recargar. Si la
    // relectura descartara la confirmación, la persona volvería a quedar
    // trabada sin entender por qué.
    await page.reload();
    await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
    await expect(profile.locator('[data-address-location="confirmed"]').first())
      .toContainText('Ubicación confirmada');
  });

  test('cambiar la calle invalida la confirmación hasta volver a confirmar el pin', async ({ page, context }) => {
    const remote = createRemoteProfile({ conDireccionConfirmada: true });
    await installRuntime(page);
    await routeSupabase(page, remote);
    await context.clearPermissions();

    await page.goto('/#profile');
    const profile = page.locator('[data-customer-profile]');
    await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
    await expect(profile.locator('[data-address-location="confirmed"]').first()).toBeVisible();

    await profile.locator('.profile-address').first().locator('[data-profile-action="edit-address"]').click();
    const paso = profile.locator('[data-location-step]');
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');

    // Cambiar el número de la calle mueve la puerta: la confirmación vence.
    await profile.locator('[name="profileAddressNumber"]').fill('2600');
    await profile.locator('[name="profileAddressNumber"]').blur();
    await expect(paso).toHaveAttribute('data-location-status', 'pending');
    await expect(paso.locator('[data-location-notice]')).toContainText('volvé a confirmar');

    // Y guardar así no pasa.
    await profile.locator('[data-profile-action="save-address"]').click();
    await expect(profile.locator('.profile-status')).toContainText('Confirmá en el mapa dónde te entregamos');
    expect(remote.calls.filter((call) => call.rpc === 'upsert_current_customer_address')).toHaveLength(0);

    // Reconfirmar el mismo pin sobre el texto nuevo sí.
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await profile.locator('[data-profile-action="save-address"]').click();
    await expect(profile.locator('.profile-status')).toContainText('Dirección guardada');
    const guardado = remote.calls.find((call) => call.rpc === 'upsert_current_customer_address');
    expect(guardado.payload.p_address.locationConfirmedAddress).toContain('2600');
  });
});

test.describe('Checkout · una dirección sin punto no sostiene un delivery', () => {
  test('sin ninguna dirección confirmada el checkout bloquea y manda a Perfil', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
    await seedCartAboveMinimum(page);
    await page.locator('[data-floating-cart]').click();
    await seedCheckoutProfile(page, {
      addresses: DEFAULT_CHECKOUT_ADDRESSES.slice(0, 1),
      confirmedLocation: false,
    });
    await page.getByLabel('Delivery').check();

    const bloqueo = page.locator('[data-profile-block="no-confirmed-location"]');
    await expect(bloqueo).toBeVisible();
    await expect(bloqueo).toContainText('Confirmá dónde te entregamos');
    await expect(page.locator('.profile-address-card')).toHaveCount(0);
  });

  test('con una dirección confirmada el checkout la declara y la deja elegir', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
    await seedCartAboveMinimum(page);
    await page.locator('[data-floating-cart]').click();
    const seeded = await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES.slice(0, 2) });
    await page.getByLabel('Delivery').check();

    await expect(page.locator('[data-profile-block="no-confirmed-location"]')).toHaveCount(0);
    const tarjeta = await selectCheckoutAddress(page, { id: seeded[0].id });
    await expect(tarjeta.locator('.profile-address-location.is-confirmed')).toContainText('Ubicación confirmada');
  });
});

test('el punto confirmado llega al pedido, al Panel y al Rider, y Maps abre por coordenadas', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await seedCartAboveMinimum(page);
  await page.locator('[data-floating-cart]').click();
  const seeded = await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES.slice(0, 1) });
  await page.getByLabel('Delivery').check();
  await selectCheckoutAddress(page, { id: seeded[0].id });
  const pago = page.getByLabel('Forma de pago');
  if (await pago.count()) await pago.selectOption('cash');

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado');

  const pedido = await page.evaluate(async () => {
    const { getActiveOrder } = await import(new URL('js/orders.js', location.href).href);
    const order = getActiveOrder();
    return {
      id: order?.id || '',
      latitude: order?.addressDetails?.latitude ?? null,
      longitude: order?.addressDetails?.longitude ?? null,
      locationSource: order?.addressDetails?.locationSource ?? '',
      locationConfirmedAt: order?.addressDetails?.locationConfirmedAt ?? '',
    };
  });
  expect(pedido.id).not.toBe('');
  expect(pedido.latitude).not.toBeNull();
  expect(pedido.longitude).not.toBeNull();
  expect(pedido.locationSource).toBe('map_pin');
  expect(pedido.locationConfirmedAt).not.toBe('');

  // ── Panel ──────────────────────────────────────────────────────────────────
  await page.goto('/?demo=1#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  const tarjeta = page.locator(`[data-inbox-order="${pedido.id}"]`);
  await expect(tarjeta).toBeVisible();
  const detalle = tarjeta.locator('details.inbox-card-details');
  if (await detalle.count() && !(await detalle.evaluate((node) => node.open))) {
    await detalle.locator('summary').click();
  }

  const punto = tarjeta.locator('[data-delivery-point="confirmed"]');
  await expect(punto).toBeVisible();
  await expect(punto).toContainText(pedido.latitude.toFixed(6));
  const enlacePanel = await punto.locator('[data-delivery-point-map]').getAttribute('href');
  expect(enlacePanel).toContain(encodeURIComponent(`${pedido.latitude.toFixed(7)},${pedido.longitude.toFixed(7)}`));
  expect(enlacePanel, 'Maps tiene que abrir por coordenadas, no por texto').not.toContain('Avenida');

  // ── Rider ──────────────────────────────────────────────────────────────────
  await page.locator(`[data-order-advance="${pedido.id}"]`).click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await page.locator(`[data-order-advance="${pedido.id}"]`).click();
  await waitForToast(page, 'Estado del pedido actualizado.');

  await page.goto('/?demo=1#rider');
  // Antes de tomar la entrega el Rider no ve el punto exacto.
  const previa = page.locator(`[data-rider-assignment-preview="${pedido.id}"]`);
  await expect(previa).toBeVisible();
  await expect(previa).not.toContainText(pedido.latitude.toFixed(6));

  await page.locator(`[data-rider-accept="${pedido.id}"]`).click();
  await waitForToast(page, 'Entrega aceptada. Ya podés ver los datos del pedido.');
  const puntoRider = page.locator('[data-rider-delivery-point]');
  await expect(puntoRider).toBeVisible();
  await expect(puntoRider).toContainText(pedido.latitude.toFixed(6));

  const rutaRider = await page.locator('.rider-quick-actions a').first().getAttribute('href');
  expect(rutaRider).toContain(encodeURIComponent(`${pedido.latitude.toFixed(7)},${pedido.longitude.toFixed(7)}`));
  expect(rutaRider, 'la ruta no puede depender de que Maps adivine el texto').not.toContain('Avenida');
});

// ── arnés ────────────────────────────────────────────────────────────────────

// Calle y número es TODO lo que pide el formulario. La localidad y la provincia
// las completa el área de operación, así que llenarlas acá probaría un
// formulario que ya no existe.
async function llenarDireccion(profile, { street, number }) {
  await expect(profile.locator('[data-profile-address-form]')).toBeVisible();
  await profile.locator('[name="profileAddressStreet"]').fill(street);
  await profile.locator('[name="profileAddressNumber"]').fill(number);
}

function createRemoteProfile({ conDireccionConfirmada = false } = {}) {
  return {
    calls: [],
    profile: { id: CUSTOMER_ID, name: 'Cliente Ubicación', phone: '2996209136' },
    addresses: conDireccionConfirmada
      ? [{
        id: '20000000-0000-4000-8000-000000000001',
        label: 'Casa',
        formattedAddress: 'Antártida Argentina 1450, Neuquén',
        street: 'Antártida Argentina',
        streetNumber: '1450',
        floor: '',
        apartment: '',
        city: 'Neuquén',
        province: 'Neuquén',
        postalCode: '',
        reference: '',
        isDefault: true,
        latitude: PUNTO_GPS.latitude,
        longitude: PUNTO_GPS.longitude,
        geolocationAccuracy: 12,
        source: 'gps',
        locationSource: 'gps',
        locationConfirmedAt: '2026-08-08T18:00:00.000Z',
        locationConfirmedAddress: 'antartida argentina 1450 neuquen neuquen',
      }]
      : [],
  };
}

async function routeSupabase(page, remote) {
  await page.route(`${SUPABASE_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([^/]+)/)?.[1] || '';
    if (url.pathname.includes('/auth/v1/token')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authSession()) });
      return;
    }
    if (rpc === 'get_current_customer_profile') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: remote.profile, addresses: remote.addresses }),
      });
      return;
    }
    if (rpc === 'upsert_current_customer_address') {
      const payload = route.request().postDataJSON();
      remote.calls.push({ rpc, payload });
      const saved = {
        ...payload.p_address,
        id: payload.p_address.id || '20000000-0000-4000-8000-000000000009',
        formattedAddress: `${payload.p_address.street} ${payload.p_address.streetNumber}, ${payload.p_address.city}`,
      };
      remote.addresses = [saved, ...remote.addresses.filter((entry) => entry.id !== saved.id)];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, address: saved }) });
      return;
    }
    if (rpc === 'upsert_current_customer_profile') {
      const payload = route.request().postDataJSON();
      remote.calls.push({ rpc, payload });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote.profile) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: '[]',
    });
  });
}

async function installRuntime(page) {
  // Este arnés no pasa por `installBrowserStubs`, así que la invitación a
  // instalar se calla acá: el archivo corre en WebKit móvil, o sea con user
  // agent de iPhone, y sin esto la hoja modal aparecía sobre "Confirmar
  // ubicación" y se quedaba con el toque.
  await skipInstallInvitation(page);
  const session = authSession();
  await page.addInitScript(({ businessId, persistedSession, host }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: host,
        publishableKey: 'sb_publishable_test_key',
        businessId,
      },
    };
    localStorage.setItem('sb-taba-location-confirmation-auth-token', JSON.stringify(persistedSession));
  }, { businessId: BUSINESS_ID, persistedSession: session, host: SUPABASE_HOST });
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
