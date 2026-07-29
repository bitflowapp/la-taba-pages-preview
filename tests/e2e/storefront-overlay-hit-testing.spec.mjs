import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

const MOBILE_VIEWPORTS = [
  { width: 320, height: 812 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
];

async function centerHitState(locator) {
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate((control) => control.scrollIntoView({
    block: 'center',
    inline: 'nearest',
    behavior: 'instant',
  }));
  let hit = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const box = await locator.boundingBox();
    expect(box, 'el control debe tener boundingBox').not.toBeNull();
    const center = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    hit = await locator.evaluate((control, geometry) => {
      const { center, width, height } = geometry;
      const stack = document.elementsFromPoint(center.x, center.y);
      const topInteractive = stack.find((node) => (
        node.matches?.('button, a, input, select, textarea, [role="button"]')
        || node.closest?.('button, a, input, select, textarea, [role="button"]')
      ));
      const topControl = topInteractive?.matches?.('button, a, input, select, textarea, [role="button"]')
        ? topInteractive
        : topInteractive?.closest?.('button, a, input, select, textarea, [role="button"]');
      return {
        width,
        height,
        center,
        pass: topControl === control || control.contains(topControl),
        topTag: topControl?.tagName || stack[0]?.tagName || '',
        topClass: topControl?.className || stack[0]?.className || '',
        topLabel: topControl?.getAttribute?.('aria-label') || '',
      };
    }, { center, width: box.width, height: box.height });
    if (hit.pass) return hit;
    await locator.evaluate(() => new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    )));
  }
  return hit;
}

async function expectPhysicalCenterClick(locator, label) {
  const hit = await centerHitState(locator);
  expect(hit.width, `${label}: ancho`).toBeGreaterThanOrEqual(44);
  expect(hit.height, `${label}: alto`).toBeGreaterThanOrEqual(44);
  expect(hit.pass, `${label}: centro interceptado por ${hit.topTag}.${hit.topClass} ${hit.topLabel}`).toBeTruthy();
  await locator.click();
}

async function cartCount(page) {
  return page.locator('[data-cart-count]').first().evaluate((node) => Number(node.textContent || 0));
}

async function gotoClean(page, hash = 'home') {
  await page.goto(`/?reset=1&demo=1&preview=v39-overlay#${hash}`);
  await expect.poll(() => new URL(page.url()).searchParams.has('reset')).toBeFalsy();
  await expect(page.locator(`[data-view="${hash}"]`)).toBeVisible();
}

test('los controles principales reciben hit-testing físico en Home, catálogo, modal y navegación', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoClean(page, 'home');

  const promoAdd = page.locator('[data-home-promotions] [data-add-product]').first();
  await expectPhysicalCenterClick(promoAdd, 'Promociones +');
  await expect.poll(() => cartCount(page)).toBe(1);

  await gotoClean(page, 'home');
  const bestAdd = page.locator('[data-home-best-sellers] [data-add-product]').first();
  await expectPhysicalCenterClick(bestAdd, 'Más vendidos +');
  await expect.poll(() => cartCount(page)).toBe(1);

  await gotoClean(page, 'catalog');
  const catalogAdd = page.locator('[data-product-grid] [data-add-product]').first();
  const productId = await catalogAdd.getAttribute('data-add-product');
  await expectPhysicalCenterClick(catalogAdd, 'Catálogo +');
  await expect.poll(() => cartCount(page)).toBe(1);
  await expect(page.locator(`[data-product-grid] [data-cart-dec="${productId}"]`)).toBeVisible();

  const favorite = page.locator('[data-product-grid] [data-favorite-toggle]').first();
  const favoriteId = await favorite.getAttribute('data-favorite-toggle');
  await expectPhysicalCenterClick(favorite, 'Favorito');
  await expect(page.locator(`[data-product-grid] [data-favorite-toggle="${favoriteId}"]`)).toHaveAttribute('aria-pressed', 'true');

  await page.locator(`[data-product-grid] [data-product-detail="${productId}"]`).click();
  const productModal = page.locator('[data-product-modal]');
  await expect(productModal).toBeVisible();
  await expectPhysicalCenterClick(
    productModal.locator('[data-favorite-toggle]'),
    'Favorito con modal abierto',
  );
  await expect(productModal).toBeVisible();
  await expect(page.locator('[data-toast]')).toBeVisible();
  await expect.poll(() => page.locator('[data-toast]').evaluate(
    (toast) => toast.parentElement?.matches('[data-product-modal]'),
  )).toBeTruthy();
  await expectPhysicalCenterClick(productModal.locator('[data-close-modal]'), 'Cerrar modal');
  await expect(productModal).toBeHidden();
  await expect(page.locator('[data-toast]')).toBeVisible();
  await expect.poll(() => page.locator('[data-toast]').evaluate(
    (toast) => toast.parentElement?.matches('[data-product-modal]'),
  )).toBeFalsy();

  await expectPhysicalCenterClick(page.locator('.mobile-nav [data-nav-view="home"]'), 'Navegación inferior');
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await guards.assertClean();
});

test('CTA, toast y última tarjeta reservan una pila inferior segura en todos los viewports', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  for (const viewport of MOBILE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await gotoClean(page, 'catalog');
    await page.locator('[data-view="catalog"] [data-category-id="all"]').click();

    const ginAdd = page.locator('[data-product-grid] [data-add-product="qa-gin"]');
    await expectPhysicalCenterClick(ginAdd, `${viewport.width}: Gin +`);
    await expect.poll(() => cartCount(page)).toBe(1);
    await expect(page.locator('[data-toast]')).toBeVisible();

    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    }));
    const minus = page.locator('[data-product-grid] [data-cart-dec="qa-gin"]');
    const minusHit = await centerHitState(minus);
    expect(minusHit.pass, `${viewport.width}: − interceptado por ${minusHit.topClass}`).toBeTruthy();

    const overlayGeometry = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? {
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
          width: box.width,
          height: box.height,
        } : null;
      };
      const productControls = [...document.querySelectorAll(
        '[data-product-grid] [data-add-product], [data-product-grid] [data-cart-dec], [data-product-grid] [data-cart-inc], [data-product-grid] [data-favorite-toggle]',
      )].filter((control) => {
        const box = control.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      }).map((control) => ({ control, box: control.getBoundingClientRect() }));
      const toast = rect('[data-toast]:not(.hidden)');
      const cta = rect('[data-floating-cart]:not(.hidden)');
      const nav = rect('.mobile-nav');
      const intersects = (a, b) => Boolean(a && b && !(
        a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom
      ));
      return {
        toast,
        cta,
        nav,
        toastCoveredControls: productControls.filter(({ box }) => intersects(box, toast)).length,
        ctaCoveredControls: productControls.filter(({ box }) => intersects(box, cta)).length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(overlayGeometry.toastCoveredControls, `${viewport.width}: toast cubre controles`).toBe(0);
    expect(overlayGeometry.ctaCoveredControls, `${viewport.width}: CTA cubre controles`).toBe(0);
    expect(overlayGeometry.cta.bottom, `${viewport.width}: CTA/nav`).toBeLessThanOrEqual(overlayGeometry.nav.top);
    expect(overlayGeometry.toast.bottom, `${viewport.width}: toast/CTA`).toBeLessThanOrEqual(overlayGeometry.cta.top);
    expect(overlayGeometry.horizontalOverflow, `${viewport.width}: overflow`).toBeFalsy();

    await minus.click();
    await expect.poll(() => cartCount(page)).toBe(0);

    await page.locator('[data-product-grid] [data-add-product]').first().click();
    await page.locator('[data-product-grid] [data-add-product="qa-gin"]').click();
    await expect.poll(() => cartCount(page)).toBe(2);
    await expectPhysicalCenterClick(page.locator('[data-floating-cart]'), `${viewport.width}: Ver pedido`);
    await expect(page.locator('[data-view="cart"]')).toBeVisible();
  }
  await guards.assertClean();
});

test('responsive conserva texto esencial y metadatos legibles entre 320 y 430 px', async ({ page }) => {
  await installBrowserStubs(page);

  for (const viewport of MOBILE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await gotoClean(page, 'home');

    const homeMetrics = await page.evaluate(() => {
      const fontSize = (selector) => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      const address = document.querySelector('[data-home-address-label]');
      const addressStyle = getComputedStyle(address);
      const image = document.querySelector('[data-home-best-sellers] .home-best-image');
      const media = image.closest('.home-best-media');
      const imageRect = image.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      return {
        previewFont: fontSize('.home-preview-label'),
        promoBadgeFont: fontSize('.home-promo-badge'),
        addressLines: Math.round(address.getBoundingClientRect().height / Number.parseFloat(addressStyle.lineHeight)),
        addressTruncated: address.scrollHeight > address.clientHeight + 1 || address.scrollWidth > address.clientWidth + 1,
        imageInsideMedia: (
          imageRect.top >= mediaRect.top - 1
          && imageRect.right <= mediaRect.right + 1
          && imageRect.bottom <= mediaRect.bottom + 1
          && imageRect.left >= mediaRect.left - 1
        ),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(homeMetrics.previewFont, `${viewport.width}: PREVIEW INTERNA`).toBeGreaterThanOrEqual(10);
    expect(homeMetrics.promoBadgeFont, `${viewport.width}: badge`).toBeGreaterThanOrEqual(11);
    expect(homeMetrics.addressLines, `${viewport.width}: Enviar a`).toBeLessThanOrEqual(2);
    expect(homeMetrics.addressTruncated, `${viewport.width}: Enviar a truncado`).toBeFalsy();
    expect(homeMetrics.imageInsideMedia, `${viewport.width}: imagen de Más vendidos`).toBeTruthy();
    expect(homeMetrics.horizontalOverflow, `${viewport.width}: Home overflow`).toBeFalsy();

    await gotoClean(page, 'catalog');
    await page.locator('[data-view="catalog"] [data-category-id="all"]').click();
    const catalogMetrics = await page.evaluate(() => {
      const monster = [...document.querySelectorAll('[data-product-grid] .product-card')]
        .find((card) => card.textContent.includes('Monster Energy Original Green'));
      const title = monster.querySelector('.product-body h3');
      const style = getComputedStyle(title);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const metadata = [...document.querySelectorAll('.product-body p, .product-availability')]
        .map((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      return {
        title: title.textContent.trim(),
        titleLines: Math.round(title.getBoundingClientRect().height / lineHeight),
        titleTruncated: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1,
        minimumMetadataFont: Math.min(...metadata),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(catalogMetrics.title).toContain('473 ml');
    expect(catalogMetrics.titleLines, `${viewport.width}: líneas Monster`).toBeLessThanOrEqual(3);
    expect(catalogMetrics.titleTruncated, `${viewport.width}: Monster truncado`).toBeFalsy();
    expect(catalogMetrics.minimumMetadataFont, `${viewport.width}: metadatos`).toBeGreaterThanOrEqual(12);
    expect(catalogMetrics.horizontalOverflow, `${viewport.width}: Catálogo overflow`).toBeFalsy();
  }
});
