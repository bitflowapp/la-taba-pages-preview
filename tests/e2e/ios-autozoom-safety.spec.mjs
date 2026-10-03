import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards, openBusinessSection } from './helpers.mjs';

// Safari en iOS hace zoom automático al enfocar un campo de texto/select con
// `font-size` computado menor a 16px. La regla no es de diseño: es un piso
// técnico que hay que sostener en TODA superficie editable, incluidos los
// estados focus/disabled/compact/anidados, sin recurrir a
// `user-scalable=no`, `maximum-scale` ni `transform: scale`.
//
// Esta suite no depende del motor (corre en Chromium, como el resto del
// e2e del repo): mide el contrato CSS que previene el zoom, no el zoom en sí.

const VIEWPORT = { width: 390, height: 844 };
const MIN_FONT_SIZE = 16;

function seedBusinessOrder() {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [{
      id: 'LT-9001',
      customerName: 'Cliente iOS',
      customerPhone: '2990000009',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo al recibir',
      paymentMethodCode: 'cash',
      notes: '',
      createdAt: at(10),
      status: 'received',
      items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 1, unitPrice: 3576, unit: 'unidad' }],
      subtotal: 3576,
      deliveryFee: 0,
      total: 3576,
      statusHistory: [{ status: 'received', at: at(10) }],
    }],
    lastOrderId: 'LT-9001',
    cart: [],
  };
}

async function seedBusinessAdmin(page, state) {
  await page.addInitScript((payload) => {
    try {
      localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(payload));
      sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
    } catch (_) { /* ignore */ }
  }, state);
}

// Recorre cada control editable visible dentro de `scope` (o todo el
// documento) y devuelve font-size computado + info para el reporte de falla.
async function collectEditableControls(page, scope = 'body') {
  return page.evaluate((scopeSelector) => {
    const root = document.querySelector(scopeSelector) || document.body;
    const isVisible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    return [...root.querySelectorAll('input, select, textarea')]
      .filter((n) => n.type !== 'hidden')
      .filter(isVisible)
      .map((n, index) => {
        const cs = getComputedStyle(n);
        n.setAttribute('data-ios-audit-index', String(index));
        return {
          index,
          tag: n.tagName.toLowerCase(),
          type: n.type || '',
          name: n.name || '',
          disabled: n.disabled,
          fontSizePx: Number.parseFloat(cs.fontSize),
          fontSize: cs.fontSize,
        };
      });
  }, scope);
}

function assertAllAtLeast16(controls, context) {
  const offenders = controls.filter((c) => c.fontSizePx < MIN_FONT_SIZE);
  expect(
    offenders,
    `Controles con font-size < 16px en ${context}: ${JSON.stringify(offenders)}`,
  ).toEqual([]);
}

// Enfoca cada control por su índice marcado y verifica que no dispare zoom
// (font-size sigue ≥16, `visualViewport.scale` no cambia) ni desborde
// horizontal, y que el layout quede estable al perder el foco (cerrar
// teclado). No se toca el zoom manual del usuario en ningún momento.
async function assertFocusIsSafe(page, controls, context) {
  for (const control of controls) {
    if (control.disabled) continue;
    const handle = page.locator(`[data-ios-audit-index="${control.index}"]`);
    if (!(await handle.isVisible().catch(() => false))) continue;

    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    await handle.focus();
    const afterFocus = await page.evaluate(() => ({
      fontSizePx: Number.parseFloat(getComputedStyle(document.activeElement).fontSize),
      scale: window.visualViewport?.scale ?? 1,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    expect(
      afterFocus.fontSizePx,
      `${context} · ${control.tag}[${control.type || control.name}] cae bajo 16px al enfocar`,
    ).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
    expect(
      afterFocus.scale,
      `${context} · ${control.tag}[${control.type || control.name}] cambia visualViewport.scale al enfocar (autozoom)`,
    ).toBeCloseTo(scaleBefore, 2);
    expect(
      afterFocus.overflow,
      `${context} · ${control.tag}[${control.type || control.name}] genera overflow horizontal al enfocar`,
    ).toBeLessThanOrEqual(1);

    await handle.blur();
    const afterBlur = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(
      afterBlur,
      `${context} · ${control.tag}[${control.type || control.name}] deja overflow horizontal al cerrar el teclado`,
    ).toBeLessThanOrEqual(1);
  }
}

test.describe('iOS Safari · ningún control editable dispara autozoom', () => {
  test('Home y búsqueda', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.waitForSelector('[data-view="home"] .home-best-card');

    const controls = await collectEditableControls(page, '[data-view="home"]');
    assertAllAtLeast16(controls, 'home');
    await assertFocusIsSafe(page, controls, 'home');

    await guards.assertClean();
    await context.close();
  });

  test('Catálogo: búsqueda, orden y detalle del producto', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
    await page.waitForSelector('[data-product-grid] .product-card');

    const controls = await collectEditableControls(page, '[data-view="catalog"]');
    assertAllAtLeast16(controls, 'catálogo');
    await assertFocusIsSafe(page, controls, 'catálogo');

    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await expect(page.locator('[data-product-modal]')).toBeVisible();
    const sheetControls = await collectEditableControls(page, '[data-product-modal]');
    assertAllAtLeast16(sheetControls, 'detalle del producto (hoja)');

    await guards.assertClean();
    await context.close();
  });

  test('Checkout: pago, indicaciones y confirmación', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
    await page.waitForSelector('[data-product-grid] .product-card');
    await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
    await page.locator('[data-floating-cart]').click();
    await expect(page.locator('[data-checkout-form]')).toBeVisible();
    await page.locator('.checkout-instructions summary').click();

    const controls = await collectEditableControls(page, '[data-checkout-form]');
    assertAllAtLeast16(controls, 'checkout');
    await assertFocusIsSafe(page, controls, 'checkout');

    await guards.assertClean();
    await context.close();
  });

  test('Perfil: editar datos personales y agregar dirección', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#profile');
    await page.waitForSelector('[data-customer-profile]');

    const editButton = page.locator('[data-customer-profile] button', { hasText: 'Editar' }).first();
    await editButton.click();
    const personalControls = await collectEditableControls(page, '[data-customer-profile]');
    assertAllAtLeast16(personalControls, 'Perfil · datos personales');
    await assertFocusIsSafe(page, personalControls, 'Perfil · datos personales');

    const addAddress = page.getByRole('button', { name: /Agregar dirección/i });
    if (await addAddress.count()) {
      await addAddress.first().click();
      const addressControls = await collectEditableControls(page, '[data-customer-profile]');
      assertAllAtLeast16(addressControls, 'Perfil · nueva dirección');
      await assertFocusIsSafe(page, addressControls, 'Perfil · nueva dirección');
    }

    await guards.assertClean();
    await context.close();
  });

  test('Acceso del equipo (PIN): negocio y rider', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1#business');
    await page.locator('[data-open-pin][data-admin-target="business"]').click();
    await expect(page.locator('[data-pin-modal]')).toBeVisible();

    const controls = await collectEditableControls(page, '[data-pin-modal]');
    assertAllAtLeast16(controls, 'PIN del negocio');
    await assertFocusIsSafe(page, controls, 'PIN del negocio');

    await guards.assertClean();
    await context.close();
  });

  test('Negocio: cola, catálogo editable y configuración', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await seedBusinessAdmin(page, seedBusinessOrder());
    await gotoDemoReset(page, '/?reset=1&demo=1#business');
    await page.waitForSelector('[data-order-inbox]');

    const inboxControls = await collectEditableControls(page, '[data-order-inbox]');
    assertAllAtLeast16(inboxControls, 'negocio · cola de pedidos');
    await assertFocusIsSafe(page, inboxControls, 'negocio · cola de pedidos');

    await openBusinessSection(page, '[data-scroll-catalog]');
    await page.waitForTimeout(200);
    const catalogAdminControls = await collectEditableControls(page, '[data-business-workspace]');
    assertAllAtLeast16(catalogAdminControls, 'negocio · catálogo editable');

    await openBusinessSection(page, '[data-scroll-business-setup]');
    await page.waitForTimeout(200);
    const setupControls = await collectEditableControls(page, '[data-business-workspace]');
    assertAllAtLeast16(setupControls, 'negocio · configuración');
    await assertFocusIsSafe(page, setupControls, 'negocio · configuración');

    await guards.assertClean();
    await context.close();
  });
});
