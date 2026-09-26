import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/staging', testMatch: 'manual-payment-pilot.spec.mjs',
  workers: 1, retries: 0, reporter: [['list']], timeout: 240_000,
  expect: { timeout: 30_000 },
  outputDir: process.env.TABA_MANUAL_QA_OUTPUT || './test-results-manual-payment-ephemeral',
  use: { baseURL: 'http://127.0.0.1:39093', serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'node scripts/realtime-relay.mjs 39093', url: 'http://127.0.0.1:39093/',
    reuseExistingServer: true, timeout: 120_000 },
});
