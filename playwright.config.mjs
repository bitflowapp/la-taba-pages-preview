import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:8080',
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'python -m http.server 8080',
      url: 'http://127.0.0.1:8080/',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Relay realtime para el test cliente/rider entre dos contextos (dos "celulares").
      command: 'node scripts/realtime-relay.mjs 8787',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
