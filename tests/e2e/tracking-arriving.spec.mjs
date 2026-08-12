import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, seedCartAboveMinimum, waitForToast } from './helpers.mjs';

const ARRIVING_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
];

test('tracking público arriving reproduce la composición y conserva datos reales', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await seedCartAboveMinimum(page);
  await page.locator('[data-floating-cart]').click();
  const increment = page.locator('[data-view="cart"].is-active [data-cart-inc]').first();
  for (let count = 1; count < 5; count += 1) {
    await increment.click();
  }

  await fillCheckout(page, {
    name: 'Cliente Arriving',
    phone: '2995551212',
    street: 'Roca 222',
    neighborhood: 'Neuquén Capital',
    reference: 'Portón negro',
    notes: '',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado');

  const orderId = await page.evaluate(async () => {
    const { getActiveOrder } = await import(new URL('js/orders.js', location.href).href);
    return getActiveOrder()?.id || '';
  });
  expect(orderId).not.toBe('');

  await page.goto('/?demo=1#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator(`[data-inbox-order="${orderId}"] [data-prep-minutes]`).selectOption('20');
  await page.locator(`[data-order-advance="${orderId}"]`).click();
  await page.locator(`[data-order-advance="${orderId}"]`).click();

  await page.goto('/?demo=1#rider');
  await page.locator(`[data-rider-accept="${orderId}"]`).click();
  await page.locator(`[data-delivery-leave="${orderId}"]`).click();
  await page.locator('[data-sim-start]').click();
  await expect(page.locator('[data-sandbox-route]')).toContainText('Seguimiento activo');

  await page.goto('/?demo=1#tracking');
  const onTheWayMap = page.locator(
    '[data-tracking-panel] .status-on_the_way [data-real-map]',
  );
  await expect(onTheWayMap).toHaveAttribute('data-route-source', 'simulation');
  const onTheWayMarker = onTheWayMap.locator('.lt-rider-helmet-icon.taba-map-helmet');
  await expect(onTheWayMarker).toBeVisible();
  await expect(onTheWayMarker).toHaveAttribute('data-map-rider-scooter', '');
  await expect(onTheWayMap.locator('.taba-delivery-helmet')).toHaveCount(0);
  if (process.env.TABA_CAPTURE_ON_THE_WAY === '1') {
    await expect(onTheWayMap).toHaveAttribute('data-map-status', 'ready', { timeout: 15_000 });
    const capturePath = path.resolve(
      process.env.TABA_CAPTURE_ON_THE_WAY_PATH || 'artifacts/tracking-rider-marker/on-the-way-390x844.png',
    );
    mkdirSync(path.dirname(capturePath), { recursive: true });
    await page.screenshot({
      path: capturePath,
      fullPage: false,
      animations: 'disabled',
    });
  }

  await page.goto('/?demo=1#rider');
  await page.locator(`[data-delivery-arrive="${orderId}"]`).click();

  await page.goto('/?demo=1#tracking');
  await page.evaluate(async () => {
    const { updateBusinessConfig } = await import(new URL('js/state.js', location.href).href);
    updateBusinessConfig({
      whatsappNumber: '5492995551234',
      whatsappVerified: true,
    });
  });
  const tracking = page.locator('[data-tracking-panel]');
  const arriving = tracking.locator('.tracking-premium.status-arriving');
  await expect(arriving).toBeVisible();
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido llegó');
  await expect(tracking.locator('.tracking-subtitle')).toHaveText('El repartidor está en tu domicilio');
  await expect(tracking.locator('.tracking-updated')).toHaveText(/^Última actualización hace (?:\d+ s|\d+ min)$/);

  const timeline = tracking.getByRole('list', { name: 'Progreso del pedido' });
  await expect(timeline.getByRole('listitem')).toHaveCount(4);
  await expect(timeline.locator('.track-step.done, .track-step.current')).toHaveCount(3);
  await expect(timeline.locator('.track-step.current')).toHaveText('En camino');
  await expect(timeline.locator('.track-step.pending')).toHaveText('Entregado');

  const map = tracking.locator('[data-map-shell="tracking"]');
  await expect(map).toBeVisible();
  const realMap = map.locator('[data-real-map]');
  await expect(realMap).toHaveAttribute('data-map-engine', 'maplibre');
  await expect(realMap).not.toHaveAttribute('data-route-source');
  await expect(realMap.locator('.lt-rider-helmet-icon.taba-map-helmet')).toBeVisible();
  await expect(realMap.locator('.taba-delivery-helmet')).toHaveCount(0);
  await expect(map.locator('[data-map-meta-text]')).toHaveText(
    /^Última ubicación · hace (?:\d+ s|\d+ min)$/,
  );
  await expect(map.locator('[data-map-recenter]')).toHaveAttribute(
    'aria-label',
    'Recentrar en la ubicación del repartidor',
  );

  const mapTouchActions = await page.evaluate(() => {
    const mapShell = document.querySelector(
      '[data-tracking-panel] .status-arriving [data-real-map]',
    );
    const mapCanvas = mapShell?.querySelector('.maplibre-gl-canvas, .maplibregl-canvas');
    const mapCanvasContainer = mapShell?.querySelector('.real-map-canvas');
    const recenter = document.querySelector(
      '[data-tracking-panel] .status-arriving [data-map-recenter]',
    );
    return {
      mapShellAction: mapShell ? getComputedStyle(mapShell).touchAction : null,
      mapCanvasAction: mapCanvas ? getComputedStyle(mapCanvas).touchAction : null,
      mapCanvasContainerAction: mapCanvasContainer
        ? getComputedStyle(mapCanvasContainer).touchAction
        : null,
      recenterAction: recenter ? getComputedStyle(recenter).touchAction : null,
    };
  });
  expect(mapTouchActions.mapShellAction).not.toBe('manipulation');
  expect(mapTouchActions.mapCanvasAction).not.toBe('manipulation');
  expect(mapTouchActions.mapCanvasAction).not.toBe('none');
  expect(mapTouchActions.mapCanvasContainerAction).not.toBe('manipulation');
  expect(mapTouchActions.mapCanvasContainerAction).not.toBe('none');
  expect(mapTouchActions.recenterAction).not.toBe('none');

  const riderCard = tracking.locator('[data-tracking-rider-card]');
  await expect(riderCard.locator('[data-rider-status]')).toHaveText('En la puerta');
  await expect(riderCard.locator('[data-rider-message]')).toHaveText(
    'Prepará el código de entrega',
  );
  const contact = riderCard.getByRole('link', { name: 'Contactar al local por este pedido' });
  await expect(contact).toHaveText('Contactar');
  await expect(contact).toHaveAttribute('data-contact-authority', 'verified-business');
  await expect(contact).toHaveAttribute('href', /^https:\/\/wa\.me\/\d{8,15}$/);

  const orderData = await page.evaluate(async () => {
    const [{ getActiveOrder }, { money }] = await Promise.all([
      import(new URL('js/orders.js', location.href).href),
      import(new URL('js/state.js', location.href).href),
    ]);
    const order = getActiveOrder();
    const productCount = order.items.reduce(
      (total, item) => total + (Number(item.quantity) || 0),
      0,
    );
    return {
      id: order.id,
      productCount,
      total: money(order.total).replace(/\$\s+/, '$'),
      deliveryCode: order.deliveryCode.code,
    };
  });

  const code = tracking.locator('[data-delivery-code]');
  await expect(code).toHaveAttribute('data-delivery-code', orderData.deliveryCode);
  await expect(code).toHaveText(
    `${orderData.deliveryCode.slice(0, 2)} ${orderData.deliveryCode.slice(2)}`,
  );
  await expect(code).toHaveAttribute(
    'aria-label',
    `Código de entrega: ${orderData.deliveryCode.split('').join(' ')}`,
  );

  const summary = tracking.locator('[data-order-summary-details]');
  await expect(summary.locator('.tracking-summary-copy > strong')).toHaveText(
    `Pedido ${orderData.id}`,
  );
  await expect(summary.locator('.tracking-summary-copy > small')).toHaveText(
    `${orderData.productCount} productos · Total ${orderData.total}`,
  );
  await expect(summary.locator('[data-order-summary-thumbnail]')).toHaveCount(0);
  await expect(summary.getByText('Ver detalles', { exact: true })).toBeVisible();
  await summary.locator('summary').click();
  await expect(summary.locator('.order-detail-body .order-line').first()).toBeVisible();
  await summary.locator('summary').click();

  await expect(
    tracking.getByRole('link', { name: 'Contactar al local', exact: true }),
  ).toBeVisible();

  for (const viewport of ARRIVING_VIEWPORTS) {
    await page.setViewportSize(viewport);
    // Firefox can expose the prior viewport's vw-based map height for one
    // paint after resize. Wait for layout to settle before measuring it.
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await page.evaluate(() => window.scrollTo(0, 0));
    const measurements = await page.evaluate(() => {
      const mapNode = document.querySelector(
        '[data-tracking-panel] .status-arriving [data-map-shell="tracking"]',
      );
      const labels = [...document.querySelectorAll(
        '[data-tracking-panel] .status-arriving .customer-progress .track-step small',
      )].map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      const help = document.querySelector(
        '[data-tracking-panel] .status-arriving .tracking-help-card',
      )?.getBoundingClientRect();
      const mapRect = mapNode?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        mapHeight: mapRect?.height || 0,
        labels,
        helpBottom: help?.bottom || 0,
        contactHeight: document.querySelector(
          '[data-tracking-panel] .status-arriving .tracking-rider-contact a',
        )?.getBoundingClientRect().height || 0,
      };
    });
    const expectedMapHeight = Math.max(260, Math.min(viewport.width * 0.718, 300));
    expect(Math.abs(measurements.mapHeight - expectedMapHeight)).toBeLessThanOrEqual(2);
    expect(Math.max(measurements.documentWidth, measurements.bodyWidth))
      .toBeLessThanOrEqual(measurements.viewportWidth + 1);
    expect(measurements.contactHeight).toBeGreaterThanOrEqual(44);
    measurements.labels.forEach((label, index) => {
      expect(label.left, `timeline ${viewport.width}px, etiqueta ${index}`).toBeGreaterThanOrEqual(0);
      expect(label.right, `timeline ${viewport.width}px, etiqueta ${index}`)
        .toBeLessThanOrEqual(measurements.viewportWidth);
      if (index > 0) {
        expect(label.left, `timeline ${viewport.width}px, separación ${index}`)
          .toBeGreaterThanOrEqual(measurements.labels[index - 1].right);
      }
    });
    if (viewport.width === 390 && viewport.height === 844) {
      // El pie tiene que entrar en pantalla en el dispositivo de referencia. La
      // tolerancia absorbe la variación tipográfica del host: `--font-sans`
      // declara `Inter` primero, pero la aplicación no la sirve, así que cada
      // sistema resuelve un fallback distinto y el ritmo vertical acumulado
      // cambia unos 7px entre uno y otro. Medido: 841,5px con Segoe UI y
      // 848,1px con la sans-serif genérica de ubuntu-latest. La holgura deja
      // pasar esa dispersión y sigue detectando una regresión real de layout.
      expect(measurements.helpBottom).toBeLessThanOrEqual(viewport.height + 10);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.TABA_CAPTURE_ARRIVING === '1') {
    await expect(realMap).toHaveAttribute('data-map-status', 'ready', { timeout: 15_000 });
    await expect(page.locator('[data-toast]')).toHaveClass(/hidden/, { timeout: 5_000 });
    await map.locator('[data-map-recenter]').click();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    const capturePath = path.resolve(
      process.env.TABA_CAPTURE_PATH || 'artifacts/tracking-arriving-final-390x844.png',
    );
    mkdirSync(path.dirname(capturePath), { recursive: true });
    await page.screenshot({
      path: capturePath,
      fullPage: false,
      animations: 'disabled',
    });
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const mapBounds = await map.boundingBox();
  expect(mapBounds).not.toBeNull();
  // Scroll from the page gutter: the map intentionally owns wheel gestures
  // over its surface, so centering the pointer there does not test page scroll.
  await page.setViewportSize({ width: 390, height: 620 });
  await page.mouse.move(8, 540);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await guards.assertClean();
  await context.close();
});
