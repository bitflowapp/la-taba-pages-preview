import { defineConfig, devices } from '@playwright/test';

// CONTROLLED_PRODUCTION UI end-to-end on the QA control business. The same
// commit's static files are served locally; the runtime is injected per test.
export default defineConfig({
  testDir: './tests/controlled-production', testMatch: '*.spec.mjs',
  workers: 1, retries: 0, reporter: [['list']], timeout: 420_000,
  expect: { timeout: 30_000 },
  outputDir: process.env.TABA_CP_E2E_OUTPUT || './test-results-cp-e2e',
  use: { baseURL: 'http://127.0.0.1:39095', trace: 'off', video: 'off', screenshot: 'off' },
  projects: [
    { name: 'chrome-android', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: { command: 'node scripts/realtime-relay.mjs 39095', url: 'http://127.0.0.1:39095/',
    reuseExistingServer: true, timeout: 120_000 },
});
