import { expect, test } from '@playwright/test';
import { installPageGuards } from './helpers.mjs';

test('showcase mounts only the active MapLibre view and cleans it on terminal or hidden views', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.goto('/?showcase=1#home');
  await expect(page.locator('[data-showcase-root]')).toHaveCount(1);
  await expect(page.locator('[data-showcase-dialog]')).toBeVisible();

  const instrumented = await page.evaluate(() => {
    if (!window.maplibregl?.Map) return false;
    const OriginalMap = window.maplibregl.Map;
    const originalRemove = OriginalMap.prototype.remove;
    window.__showcaseMapLifecycle = {
      constructs: 0,
      removes: 0,
      shell: null,
      canvas: null,
    };
    OriginalMap.prototype.remove = function auditedRemove(...args) {
      if (!this.__showcaseRemoved) {
        this.__showcaseRemoved = true;
        window.__showcaseMapLifecycle.removes += 1;
      }
      return originalRemove.apply(this, args);
    };
    window.maplibregl.Map = new Proxy(OriginalMap, {
      construct(target, args, newTarget) {
        window.__showcaseMapLifecycle.constructs += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
    return true;
  });
  expect(instrumented).toBe(true);

  await selectShowcaseStep(page, 'tracking-map');
  const trackingMap = page.locator(
    '[data-tracking-panel] [data-real-map][data-map-engine="maplibre"][data-map-status="ready"]',
  );
  await expect(trackingMap).toHaveCount(1, { timeout: 15_000 });
  await expect(trackingMap).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  await expect(page.locator(
    '[data-delivery-panel] [data-map-engine="maplibre"], '
      + '[data-delivery-panel] .maplibregl-canvas',
  )).toHaveCount(0);
  expect(await mapLifecycle(page)).toEqual({ constructs: 1, removes: 0 });

  const initialProgress = await page.evaluate(async () => {
    const { getState, setState } = await import('/js/state.js');
    window.__showcaseMapLifecycle.shell = document.querySelector(
      '[data-tracking-panel] [data-real-map]',
    );
    window.__showcaseMapLifecycle.canvas = document.querySelector(
      '[data-tracking-panel] .maplibregl-canvas',
    );
    const progress = getState().simulation?.progress;
    setState({ searchQuery: 'map-lifecycle-render' });
    setState({ searchQuery: '' });
    return progress;
  });

  await expect.poll(
    () => page.evaluate(async () => (await import('/js/state.js')).getState().simulation?.progress),
    { message: 'the real simulation timer should advance without remounting MapLibre' },
  ).not.toBe(initialProgress);
  expect(await page.evaluate(() => ({
    sameShell: window.__showcaseMapLifecycle.shell
      === document.querySelector('[data-tracking-panel] [data-real-map]'),
    sameCanvas: window.__showcaseMapLifecycle.canvas
      === document.querySelector('[data-tracking-panel] .maplibregl-canvas'),
  }))).toEqual({ sameShell: true, sameCanvas: true });
  expect(await mapLifecycle(page)).toEqual({ constructs: 1, removes: 0 });
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);

  await selectShowcaseStep(page, 'delivered');
  await expect(page.locator('[data-real-map], .maplibregl-canvas')).toHaveCount(0);
  expect(await mapLifecycle(page)).toEqual({ constructs: 1, removes: 1 });

  await selectShowcaseStep(page, 'tracking-map');
  await expect(trackingMap).toHaveCount(1, { timeout: 15_000 });
  await expect(trackingMap).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  expect(await mapLifecycle(page)).toEqual({ constructs: 2, removes: 1 });

  await page.locator('.brand[data-nav-view="home"]').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);
  await expect(page.locator(
    '[data-tracking-panel] [data-map-engine="maplibre"], '
      + '[data-delivery-panel] [data-map-engine="maplibre"]',
  )).toHaveCount(0);
  expect(await mapLifecycle(page)).toEqual({ constructs: 2, removes: 2 });

  const progressAfterHide = await page.evaluate(async () => (
    (await import('/js/state.js')).getState().simulation?.progress
  ));
  await expect.poll(
    () => page.evaluate(async () => (await import('/js/state.js')).getState().simulation?.progress),
    { message: 'hidden-view renders must not recreate either map' },
  ).not.toBe(progressAfterHide);
  expect(await mapLifecycle(page)).toEqual({ constructs: 2, removes: 2 });
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);
  await guards.assertClean();
});

async function selectShowcaseStep(page, stepId) {
  const dialog = page.locator('[data-showcase-dialog]');
  if (!(await dialog.isVisible())) {
    await page.locator('[data-showcase-action="return"]').click();
  }
  await expect(dialog).toBeVisible();
  const step = dialog.locator(`[data-showcase-step="${stepId}"]`);
  await expect(step).toBeEnabled();
  await step.click();
  await expect(dialog).toBeHidden();
}

async function mapLifecycle(page) {
  return page.evaluate(() => ({
    constructs: window.__showcaseMapLifecycle.constructs,
    removes: window.__showcaseMapLifecycle.removes,
  }));
}
