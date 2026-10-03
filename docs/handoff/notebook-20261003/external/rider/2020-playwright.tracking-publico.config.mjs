import { defineConfig, devices } from '@playwright/test';

/**
 * Los specs de seguimiento DEL PROPIO REPO, corridos contra el bundle
 * PUBLICADO. Mismo contrato que se verifica en local, pero sobre lo que el
 * cliente recibe de staging. `?demo=1` usa datos locales y nunca el backend,
 * asi que no se escribe una sola fila.
 */
export default defineConfig({
  testDir: '../../../tests/e2e',
  testMatch: /tracking-(follow-mode|arriving)\.spec\.mjs/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: 'D:/1212/_claude-tmp/rc1/resultados-tracking',
  use: {
    baseURL: 'https://taba2-staging.pages.dev',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
