import { expect, test } from '@playwright/test';

const PRODUCTION_RUNTIME = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    supabaseUrl: 'https://fixture.supabase.co',
    publishableKey: 'sb_publishable_testonly12345678',
    businessId: '00000000-0000-4000-8000-000000000001',
    deploymentEnvironment: 'production',
    pollMs: 5000,
  },
};

test.describe('frontera Rider web / Android', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((runtime) => {
      globalThis.__LA_TABA_RUNTIME_CONFIG__ = runtime;
    }, PRODUCTION_RUNTIME);
  });

  for (const path of ['/#rider', '/?demo=1#rider']) {
    test(`producción rechaza la ruta Rider ${path}`, async ({ page }) => {
      await page.goto(path);

      await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
      await expect(page).toHaveURL(/#home$/);
      await expect(page.locator('[data-view="home"]')).toBeVisible();
      await expect(page.locator('[data-view="rider"]')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Vista rider' })).toBeHidden();
      await expect(page.locator('[data-production-auth-card="rider"]')).toHaveCount(0);
      await expect(page.locator('[data-production-workspace="rider"]')).toHaveCount(0);
    });
  }
});

test.describe('frontera Rider web / PILOTO', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((runtime) => {
      globalThis.__LA_TABA_RUNTIME_CONFIG__ = runtime;
    }, { ...PRODUCTION_RUNTIME, repository: {
      ...PRODUCTION_RUNTIME.repository,
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      businessId: '11111111-1111-4111-8111-111111111111',
      deploymentEnvironment: 'pilot',
    } });
  });

  for (const path of ['/#rider', '/?demo=1#rider']) {
    test(`PILOTO rechaza la ruta Rider ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
      await expect(page).toHaveURL(/#home$/);
      await expect(page.locator('[data-view="rider"]')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Vista rider' })).toBeHidden();
      await expect(page.locator('[data-production-auth-card="rider"]')).toHaveCount(0);
      await expect(page.locator('[data-production-workspace="rider"]')).toHaveCount(0);
    });
  }
});
