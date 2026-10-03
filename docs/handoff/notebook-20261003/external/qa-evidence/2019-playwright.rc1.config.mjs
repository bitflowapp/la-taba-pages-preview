import { defineConfig, devices } from '@playwright/test';

/**
 * Certificacion de la RC1 contra la URL PUBLICA de staging.
 * No levanta servidor: mide lo que el cliente recibe de verdad.
 * El Service Worker queda ACTIVO a proposito: es parte de lo que se certifica.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: 'D:/1212/_claude-tmp/rc1/resultados-rc1',
  use: {
    baseURL: 'https://taba2-staging.pages.dev',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
