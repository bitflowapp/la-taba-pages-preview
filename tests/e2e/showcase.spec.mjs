import { expect, test } from '@playwright/test';
import { products as catalogProducts } from '../../js/approved-beverage-demo-data.js';
import {
  applyRetailCatalogModel,
  getCustomerCatalogProducts,
  normalizeCatalogProduct,
} from '../../js/core/catalog-store.js';

// La góndola sale del funnel real: el pack de abastecimiento no se muestra y
// la unidad que representa sí. Contar sobre el archivo crudo volvería a medir
// el catálogo de proveedor, no el del cliente.
const retailCatalogSize = getCustomerCatalogProducts(
  applyRetailCatalogModel(catalogProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean)),
).length;
import { gotoDemoReset, installPageGuards } from './helpers.mjs';
import {
  buildCheckoutAddresses,
  seedCheckoutProfile,
  selectCheckoutAddress,
} from './helpers.mjs';

const SHOWCASE_PATH = '/?showcase=1#home';
const LIVE_EXTERNAL_LINKS = [
  'a[href^="tel:"]',
  'a[href*="wa.me"]',
  'a[href*="google.com/maps"]',
].join(',');
const SHOWCASE_STEP_IDS = [
  'catalog',
  'pending-price',
  'cart',
  'checkout',
  'delivery-pickup',
  'profile',
  'addresses',
  'business',
  'order-management',
  'rider',
  'tracking-map',
  'delivered',
  'session-recovery',
  'privacy-security',
];

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
];

test('showcase is explicit, isolated from Supabase and hides the technical sandbox', async ({ browser }) => {
  const ordinaryContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ordinary = await ordinaryContext.newPage();
  const ordinaryGuards = installPageGuards(ordinary);

  await ordinary.goto('/');
  await expect(ordinary.locator('body')).toHaveAttribute('data-app-mode', 'public');
  await expect(ordinary.locator('[data-showcase-root]')).toHaveCount(0);

  await ordinary.goto('/?demo=1#home');
  await expect(ordinary.locator('body')).toHaveAttribute('data-app-mode', 'demo');
  await expect(ordinary.locator('[data-showcase-root]')).toHaveCount(0);

  await ordinary.goto('/?showcase=0#home');
  await expect(ordinary.locator('[data-showcase-root]')).toHaveCount(0);
  await ordinaryGuards.assertClean();
  await ordinaryContext.close();

  const safeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const safe = await safeContext.newPage();
  const safeGuards = installPageGuards(safe);
  const supabaseRequests = [];
  const relayRequests = [];
  safe.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith('.supabase.co')) supabaseRequests.push(request.url());
    if (url.hostname === 'relay.invalid') relayRequests.push(request.url());
  });
  await safe.addInitScript(() => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://taba-showcase-test.supabase.co',
        publishableKey: 'sb_publishable_test_key',
        businessId: '00000000-0000-4000-8000-000000000001',
      },
    };
  });

  await safe.goto('/?showcase=1&tools=1&relay=https%3A%2F%2Frelay.invalid#home');
  await expect(safe.locator('[data-showcase-root]')).toHaveCount(1);
  await expect(safe.getByRole('button', { name: 'Volver al recorrido' })).toBeVisible();
  await expect(safe.locator('[data-sandbox-tools]')).toHaveCount(0);
  await expect(safe.locator('body')).toHaveAttribute('data-app-mode', 'demo');

  const repository = await safe.evaluate(async () => {
    const { getDataMode, getOrderRepository } = await import('/js/repositories/repository_factory.js');
    const selected = getOrderRepository();
    return {
      dataMode: getDataMode(),
      mode: selected.mode,
      namespace: selected.sandboxNamespace,
    };
  });
  expect(repository).toEqual({
    dataMode: 'showcase',
    mode: 'sandbox',
    namespace: 'showcase',
  });

  await safe.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  expect(supabaseRequests).toEqual([]);
  expect(relayRequests).toEqual([]);
  await safeGuards.assertClean();
  await safeContext.close();
});

test('showcase reset completes locally without contacting a crafted relay', async ({ page }) => {
  const guards = installPageGuards(page);
  const relayRequests = [];
  await page.addInitScript(() => {
    if (new URL(location.href).searchParams.has('reset')) {
      localStorage.setItem('la_taba_showcase_cashbox_closures_v1', '[{"synthetic":true}]');
    }
  });
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'relay.invalid') relayRequests.push(request.url());
  });

  await gotoDemoReset(
    page,
    '/?showcase=1&reset=1&relay=https%3A%2F%2Frelay.invalid#home',
  );

  const finalUrl = new URL(page.url());
  expect(finalUrl.searchParams.get('showcase')).toBe('1');
  expect(finalUrl.searchParams.has('reset')).toBe(false);
  expect(finalUrl.searchParams.get('relay')).toBe('https://relay.invalid');
  expect(await page.evaluate(() => (
    localStorage.getItem('la_taba_showcase_cashbox_closures_v1')
  ))).toBeNull();
  await expect(page.locator('[data-showcase-root]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Volver al recorrido' })).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  expect(relayRequests).toEqual([]);
  await guards.assertClean();
});

test('guided shell exposes 14 stops, return navigation and honest release status', async ({ page }) => {
  const guards = installPageGuards(page);
  await gotoShowcase(page);

  await expect(page.locator('.showcase-mode-badge')).toHaveText('Modo demostración local');
  const launcher = page.getByRole('button', { name: 'Volver al recorrido' });
  await expect(launcher).toBeVisible();

  const dialog = page.locator('[data-showcase-dialog]');
  await expect(dialog).toBeVisible();
  const steps = dialog.locator('[data-showcase-step]');
  await expect(steps).toHaveCount(14);
  expect(await steps.evaluateAll((nodes) => nodes.map((node) => node.dataset.showcaseStep)))
    .toEqual(SHOWCASE_STEP_IDS);

  await expect(dialog).toContainText(/Todos los datos y la persistencia .* locales y sintéticos/i);
  await expect(dialog).toContainText(/MapLibre.*mosaicos cartográficos públicos.*Internet/i);
  await expect(dialog).toContainText('No usa Supabase remoto ni datos reales.');
  await expect(dialog.getByRole('heading', { name: 'Qué mejoró en TABA' })).toBeVisible();
  await expect(dialog.locator('[data-release-status="integrated"]')).toContainText('Integrado en esta base');
  await expect(dialog.locator('[data-release-status="certified-pending"]'))
    .toContainText('Certificado, pendiente de integración');
  await expect(dialog.locator('[data-release-status="rejected"]')).toContainText('Rechazado o excluido');
  await expect(dialog.locator('.showcase-limitations')).toContainText('Mercado Pago');
  await expect(dialog.locator('.showcase-limitations')).toContainText('producción');
  await expect(dialog.locator('.showcase-limitations')).toContainText('prueba física');

  await page.getByRole('button', { name: 'Cerrar recorrido' }).click();
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox?.width || 0).toBeGreaterThanOrEqual(44);
  expect(launcherBox?.height || 0).toBeGreaterThanOrEqual(44);

  await launcher.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Comenzar recorrido' }).click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(dialog).toBeHidden();
  await launcher.click();
  await expect(dialog.locator('[data-showcase-progress]')).toHaveText('Parada 1 de 14');
  await guards.assertClean();
});

test('customer showcase stops use the real catalog, cart, checkout, profile and addresses', async ({ page }) => {
  const guards = installPageGuards(page);
  await gotoShowcase(page);

  await selectShowcaseStep(page, 'catalog');
  await expectActiveView(page, 'catalog');
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(retailCatalogSize);

  await selectShowcaseStep(page, 'pending-price');
  await expectActiveView(page, 'catalog');
  const pendingModal = page.locator('[data-modal-product-id="coca-cola-original-pet-1500ml"]');
  await expect(pendingModal).toBeVisible();
  await expect(pendingModal.locator('[data-price-pending-message]')).toContainText('Precio próximamente');
  // Sin precio publicado la ficha ya no renderiza un "Agregar" deshabilitado:
  // un control que existe y no hace nada obliga a tocarlo para descubrirlo. El
  // pie dice el estado con todas las letras y el favorito pasa a ser la acción
  // principal, que es la única que hoy hace algo con ese producto.
  await expect(pendingModal.locator('[data-add-product]')).toHaveCount(0);
  await expect(pendingModal.locator('.modal-pending-note')).toContainText('Todavía no se puede comprar');
  await pendingModal.locator('[data-close-modal]').click();

  await selectShowcaseStep(page, 'cart');
  await expectActiveView(page, 'cart');
  await expect(page.locator('[data-cart-list] .cart-item')).toHaveCount(1);
  await expect(page.locator('[data-clear-cart]')).toBeVisible();

  await page.locator('[data-clear-cart]').click();
  const clearDialog = page.locator('[data-clear-cart-modal]');
  await expect(clearDialog).toBeVisible();
  await expect(clearDialog).toHaveAttribute('aria-describedby', 'clear-cart-description');
  await clearDialog.locator('[data-clear-cart-dismiss]').click();
  await expect(page.locator('[data-cart-list] .cart-item')).toHaveCount(1);
  await page.locator('[data-clear-cart]').click();
  await clearDialog.locator('[data-clear-cart-confirm]').click();
  await expect(page.locator('[data-cart-list] .cart-item')).toHaveCount(0);

  await selectShowcaseStep(page, 'checkout');
  await expectActiveView(page, 'cart');
  await expect(page.locator('[data-checkout-form]')).toBeVisible();
  await expect(page.locator('[data-cart-list] .cart-item')).toHaveCount(1);
  await expect(page.locator('[data-checkout-submit]')).toBeEnabled();

  await selectShowcaseStep(page, 'delivery-pickup');
  await expectActiveView(page, 'cart');
  await expect(page.getByLabel('Delivery')).toBeChecked();
  await page.getByLabel('Retiro en local').check();
  await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  await expect(page.locator('[data-checkout-form] .profile-address-list')).toHaveCount(0);
  await page.getByLabel('Delivery').check();
  await expect(page.locator('[data-profile-pickup]')).toBeHidden();
  await expect(page.locator('[data-checkout-form] .profile-address-list')).toBeVisible();

  await selectShowcaseStep(page, 'profile');
  await expectActiveView(page, 'profile');
  await expect(page.locator('[data-customer-profile] .customer-profile-grid')).toBeVisible();
  await expect(page.locator('[data-customer-profile]')).toContainText(/Camila/i);

  await selectShowcaseStep(page, 'addresses');
  await expectActiveView(page, 'profile');
  const addresses = page.locator('.addresses-card');
  await expect(addresses).toBeVisible();
  await expect(addresses.locator('[data-profile-address-id]')).toHaveCount(4);
  await expect(addresses).toContainText('Predeterminada');
  await expect(addresses.locator('[data-profile-action="add-address"]')).toBeVisible();
  await guards.assertClean();
});

test('showcase covers profile variants, delivery/pickup and preserves cart on profile return', async ({ page }) => {
  const guards = installPageGuards(page);
  const cartItems = page.locator('[data-cart-list] .cart-item');
  const checkout = page.locator('[data-checkout-form]');
  const addressList = checkout.locator('.profile-address-list');
  const addressToggle = page.locator('[data-profile-checkout-action="toggle-addresses"]');
  const selectDeliveryMode = page.getByLabel('Delivery');
  const selectPickupMode = page.getByLabel('Retiro en local');

  await gotoShowcase(page);
  await selectShowcaseStep(page, 'catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await selectShowcaseStep(page, 'checkout');
  await expect(checkout).toBeVisible();
  await expect(cartItems).toHaveCount(1);

  const oneAddress = buildCheckoutAddresses(1, 'showcase-1');
  await seedCheckoutProfile(page, {
    name: 'Cliente con 1',
    phone: '2991110001',
    addresses: oneAddress,
    namespace: 'showcase',
  });
  await expect(addressList).toHaveAttribute('data-address-total', '1');
  await expect(addressList.locator('.profile-address-card')).toHaveCount(1);
  await expect(addressToggle).toHaveCount(0);
  await expect(checkout).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  await expect(checkout.locator('[data-checkout-submit]')).toBeEnabled();

  const fourAddresses = buildCheckoutAddresses(4, 'showcase-4');
  await seedCheckoutProfile(page, {
    name: 'Cliente con 4',
    phone: '2991110004',
    addresses: fourAddresses,
    namespace: 'showcase',
  });
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(addressList).toHaveAttribute('data-address-total', '4');
  await expect(addressList.locator('.profile-address-card')).toHaveCount(3);
  await expect(addressToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(addressToggle).toContainText(/Ver las 4 direcciones/);
  await addressToggle.click();
  await expect(addressToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(addressList.locator('.profile-address-card')).toHaveCount(4);
  await selectCheckoutAddress(page, { id: fourAddresses[3].id });
  await expect(addressList.locator(`.profile-address-card[data-customer-address-id="${fourAddresses[3].id}"]`))
    .toHaveClass(/is-selected/);
  await expect(addressList.locator(`.profile-address-card[data-customer-address-id="${fourAddresses[0].id}"]`))
    .toContainText('Principal');
  await expect(addressList.locator(`.profile-address-card[data-customer-address-id="${fourAddresses[0].id}"]`))
    .not.toHaveClass(/is-selected/);

  const tenAddresses = buildCheckoutAddresses(10, 'showcase-10');
  await seedCheckoutProfile(page, {
    name: 'Cliente con 10',
    phone: '2991110010',
    addresses: tenAddresses,
    namespace: 'showcase',
  });
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(addressList).toHaveAttribute('data-address-total', '10');
  await expect(addressToggle).toHaveAttribute('aria-expanded', 'true');
  await addressToggle.click();
  await expect(addressList.locator('.profile-address-card')).toHaveCount(3);
  await expect(addressToggle).toContainText(/Ver las 10 direcciones/);
  await expect(addressToggle).toContainText(/7/);
  await addressToggle.click();
  await expect(addressToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(addressList.locator('.profile-address-card')).toHaveCount(10);
  await selectCheckoutAddress(page, { id: tenAddresses[9].id });
  await expect(addressList.locator(`.profile-address-card[data-customer-address-id="${tenAddresses[9].id}"]`))
    .toHaveClass(/is-selected/);
  const checkoutBox = await checkout.boundingBox();
  const addressListBox = await addressList.boundingBox();
  expect(addressListBox?.x + addressListBox?.width).toBeLessThanOrEqual((checkoutBox?.x || 0) + (checkoutBox?.width || 0) + 1);

  await seedCheckoutProfile(page, {
    name: 'Cliente sin direcciones',
    phone: '2991110011',
    addresses: [],
    namespace: 'showcase',
  });
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
  await expect(cartItems).toHaveCount(1);
  await checkout.locator('[data-checkout-submit]').click();
  await expect(checkout.locator('[data-checkout-warning]')).toBeVisible();
  await expect(checkout.locator('[data-checkout-warning]')).toContainText(/direcci[oó]n|calle|n[uú]mero/i);
  await expectActiveView(page, 'cart');
  const noAddressAction = page.locator('[data-profile-block="no-address"] [data-profile-checkout-action="add-address"]');
  await expect(noAddressAction).toBeVisible();
  await noAddressAction.click();
  await expect(page.locator('[data-customer-profile]')).toBeVisible();
  await page.locator('[data-profile-action="return-to-checkout"]').click();
  await expectActiveView(page, 'cart');
  await expect(cartItems).toHaveCount(1);
  await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();

  await seedCheckoutProfile(page, {
    name: '',
    phone: '',
    addresses: buildCheckoutAddresses(1, 'showcase-incomplete'),
    namespace: 'showcase',
  });
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  await checkout.locator('[data-checkout-submit]').click();
  await expect(checkout.locator('[data-checkout-warning]')).toBeVisible();
  await expect(checkout.locator('[data-checkout-warning]')).toContainText(/perfil|nombre|tel[eé]fono/i);
  await expectActiveView(page, 'cart');
  const incompleteEdit = page.locator('[data-profile-block="incomplete"] [data-profile-checkout-action="edit-profile"]');
  await expect(incompleteEdit).toBeVisible();
  await incompleteEdit.click();
  await expect(page.locator('[data-customer-profile]')).toBeVisible();
  await page.locator('[data-profile-action="return-to-checkout"]').click();
  await expectActiveView(page, 'cart');
  await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  await expect(cartItems).toHaveCount(1);

  const completeAddresses = buildCheckoutAddresses(4, 'showcase-complete');
  const savedAddressId = completeAddresses[2].id;
  await seedCheckoutProfile(page, {
    name: 'Cliente complete',
    phone: '2991111111',
    addresses: completeAddresses,
    namespace: 'showcase',
  });
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await selectCheckoutAddress(page, { id: savedAddressId });
  await expect(addressList.locator(`.profile-address-card[data-customer-address-id="${savedAddressId}"]`))
    .toHaveClass(/is-selected/);
  await checkout.locator('[data-profile-checkout-action="edit-profile"]').click();
  await expect(page.locator('[data-customer-profile]')).toBeVisible();
  await page.locator('[data-profile-action="return-to-checkout"]').click();
  await expectActiveView(page, 'cart');
  await expect(cartItems).toHaveCount(1);
  await expect(selectDeliveryMode).toBeChecked();
  await expect(addressList.locator(`.profile-address-card[data-customer-address-id="${savedAddressId}"]`))
    .toHaveClass(/is-selected/);

  await selectPickupMode.check();
  await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  await expect(addressList).toHaveCount(0);
  await selectDeliveryMode.check();
  await expect(addressList).toBeVisible();
  await expect(page.locator('[data-profile-pickup]')).toBeHidden();
  await expect(checkout).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  await guards.assertClean();
});


test('operational showcase stops use real business, rider, tracking, terminal and recovery surfaces', async ({ page }) => {
  const guards = installPageGuards(page);
  await gotoShowcase(page);

  await selectShowcaseStep(page, 'business');
  await expectActiveView(page, 'business');
  const business = page.locator('[data-business-dashboard]');
  await expect(business).toBeVisible();
  await expect(business.locator('[data-inbox-order]')).toHaveCount(1);
  await expect(business).toContainText(/Cliente de demostración/i);
  await expect(business.locator(LIVE_EXTERNAL_LINKS)).toHaveCount(0);
  expect(await activeFixtureStatus(page)).toBe('received');

  await selectShowcaseStep(page, 'order-management');
  await expectActiveView(page, 'business');
  await expect(business.locator('[data-inbox-order]')).toHaveCount(1);
  await expect(business).toContainText(/preparación/i);
  expect(await activeFixtureStatus(page)).toBe('preparing');

  await selectShowcaseStep(page, 'rider');
  await expectActiveView(page, 'rider');
  const riderPanel = page.locator('[data-delivery-panel]');
  await expect(riderPanel.locator('[data-rider-assignment-preview]')).toBeVisible();
  await expect(riderPanel.locator('[data-sim-gps]')).toHaveCount(0);
  await expect(riderPanel.locator(LIVE_EXTERNAL_LINKS)).toHaveCount(0);
  await expect(riderPanel.locator('[data-showcase-gps-disabled]'))
    .toContainText(/GPS real desactivado/i);
  const gpsAttempt = await page.evaluate(async () => {
    const geolocation = navigator.geolocation;
    const originalDescriptor = Object.getOwnPropertyDescriptor(geolocation, 'watchPosition');
    let watchCalls = 0;
    Object.defineProperty(geolocation, 'watchPosition', {
      configurable: true,
      value: () => {
        watchCalls += 1;
        return 1;
      },
    });
    try {
      const { enableGpsTracking } = await import('/js/simulation.js');
      return { result: enableGpsTracking(), watchCalls };
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(geolocation, 'watchPosition', originalDescriptor);
      } else {
        delete geolocation.watchPosition;
      }
    }
  });
  expect(gpsAttempt.result.ok).toBe(false);
  expect(gpsAttempt.result.message).toMatch(/GPS real.*desactivado/i);
  expect(gpsAttempt.watchCalls).toBe(0);
  expect(await activeFixtureStatus(page)).toBe('ready');

  await page.setViewportSize({ width: 320, height: 568 });
  await selectShowcaseStep(page, 'tracking-map');
  await expectActiveView(page, 'tracking');
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('[data-tracking-status="on_the_way"]')).toBeVisible();
  await expect(tracking.locator(
    '[data-real-map][data-map-source="sandbox"][data-map-engine="maplibre"][data-route-source="simulation"]',
  )).toHaveCount(1);
  await expect(tracking.locator('.lt-rider-marker')).toHaveCount(1);
  await expect(tracking.locator(LIVE_EXTERNAL_LINKS)).toHaveCount(0);
  expect(await activeFixtureStatus(page)).toBe('on_the_way');

  const narrowTracking = await page.evaluate(() => {
    const control = document.querySelector(
      '[data-tracking-panel] [data-showcase-contact-disabled]',
    );
    const rect = control?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      controlRight: rect?.right || 0,
      viewportRight: document.documentElement.clientWidth,
      mapChain: [
        '.maplibregl-canvas',
        '[data-real-map]',
        '.tracking-map-stage',
        '.tracking-sheet',
        '.tracking-premium',
        '[data-view="tracking"]',
      ].map((selector) => {
        const node = document.querySelector(`[data-view="tracking"] ${selector}`)
          || document.querySelector(selector);
        const box = node?.getBoundingClientRect();
        const style = node ? getComputedStyle(node) : null;
        return {
          selector,
          left: Math.round(box?.left || 0),
          right: Math.round(box?.right || 0),
          width: Math.round(box?.width || 0),
          cssWidth: style?.width || '',
          minWidth: style?.minWidth || '',
          overflow: style?.overflow || '',
        };
      }),
      offenders: [...document.querySelectorAll('[data-view="tracking"] *')]
        .map((node) => {
          const box = node.getBoundingClientRect();
          return {
            selector: [
              node.tagName.toLowerCase(),
              node.id ? `#${node.id}` : '',
              [...node.classList].slice(0, 2).map((name) => `.${name}`).join(''),
            ].join(''),
            left: Math.round(box.left),
            right: Math.round(box.right),
            width: Math.round(box.width),
          };
        })
        .filter((item) => item.right > document.documentElement.clientWidth + 1)
        .sort((left, right) => right.right - left.right)
        .slice(0, 8),
    };
  });
  expect(
    narrowTracking.overflow,
    JSON.stringify({
      mapChain: narrowTracking.mapChain,
      offenders: narrowTracking.offenders,
    }),
  ).toBeLessThanOrEqual(1);
  expect(narrowTracking.controlRight).toBeLessThanOrEqual(narrowTracking.viewportRight);
  await page.setViewportSize({ width: 1280, height: 900 });

  await selectShowcaseStep(page, 'delivered');
  await expectActiveView(page, 'tracking');
  await expect(tracking.locator('[data-tracking-status="delivered"]')).toBeVisible();
  await expect(tracking.locator('[data-tracking-title]')).toHaveText('Pedido entregado');
  await expect(tracking.locator('[data-real-map], [data-delivery-code-card]')).toHaveCount(0);
  expect(await activeFixtureStatus(page)).toBe('delivered');

  await openShowcaseTour(page);
  const reloaded = page.waitForEvent('load');
  await page.locator('[data-showcase-step="session-recovery"]').click();
  await reloaded;
  await expectActiveView(page, 'tracking');
  expect(await activeFixtureStatus(page)).toBe('preparing');
  await openShowcaseTour(page);
  await expect(page.locator('[data-showcase-message]')).toContainText(/Sesi.n recuperada/i);

  await page.locator('[data-showcase-step="privacy-security"]').click();
  await expectActiveView(page, 'profile');
  const privacy = page.locator('.profile-privacy-card');
  await expect(privacy).toBeVisible();
  await expect(privacy).toContainText('TABA no necesita tu DNI');
  await guards.assertClean();
});

test('showcase has no horizontal overflow and keeps every control touch-safe in all required viewports', async ({ page }) => {
  const guards = installPageGuards(page);
  await gotoShowcase(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.locator('[data-showcase-dialog]')).toBeVisible();
    // Medir inmediatamente después del resize lee una caja a mitad del
    // relayout: el mismo botón daba 43,34 px contra su `min-height: 44px` en
    // una de cada tres corridas. Esperar dos frames deja que el navegador
    // aplique el viewport nuevo antes de medir. La afirmación no se afloja
    // —sigue exigiendo 44 px— ; lo que se corrige es cuándo se mira.
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));

    const layout = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const undersized = [...document.querySelectorAll('[data-showcase-root] button')]
        .filter((button) => {
          const style = getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0
            && (rect.width < 43.5 || rect.height < 43.5);
        })
        .map((button) => ({
          action: button.dataset.showcaseAction || '',
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        }));
      return { overflow, undersized };
    });

    expect(layout.overflow, `${viewport.width}x${viewport.height} overflow`).toBeLessThanOrEqual(1);
    expect(layout.undersized, `${viewport.width}x${viewport.height} touch targets`).toEqual([]);
  }

  await guards.assertClean();
});

async function gotoShowcase(page) {
  await page.goto(SHOWCASE_PATH);
  await expect(page.locator('[data-showcase-root]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Volver al recorrido' })).toBeVisible();
  await expect(page.locator('[data-showcase-dialog]')).toBeVisible();
}

async function openShowcaseTour(page) {
  const dialog = page.locator('[data-showcase-dialog]');
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: 'Volver al recorrido' }).click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectShowcaseStep(page, stepId) {
  const dialog = await openShowcaseTour(page);
  const step = dialog.locator(`[data-showcase-step="${stepId}"]`);
  await expect(step).toBeEnabled();
  await step.click();
  await expect(dialog).toBeHidden();
}

async function expectActiveView(page, view) {
  await expect(page.locator('body')).toHaveAttribute('data-active-view', view);
  await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
}

async function activeFixtureStatus(page) {
  return page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().orders.find((order) => !order.internalSeed)?.status || null;
  });
}
