import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.TABA_FINAL_HTTP_PORT || 18264);
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(?:premium-storefront|tracking-premium)\.spec\.mjs/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 60000,
  outputDir: 'test-results-final-integration',
  reporter: [['list'], ['json', { outputFile: 'artifacts/la-taba-final-integration-20261007/feature-matrix.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'android-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-webkit', use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: `node scripts/realtime-relay.mjs ${port}`, cwd: process.env.TABA_FINAL_TREE_ROOT || process.cwd(), url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
