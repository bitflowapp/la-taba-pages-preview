import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'premium-storefront.spec.mjs',
  workers: 1, fullyParallel: false, retries: 0, timeout: 45000,
  reporter: [['list'], ['json', { outputFile: 'artifacts/frontend-premium-20261007/technical/category-tests.json' }]],
  outputDir: 'test-results-premium',
  use: { baseURL: 'http://127.0.0.1:18242', serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: {width:1440,height:900} } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'], viewport: {width:390,height:844} } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], viewport: {width:390,height:844} } },
    { name: 'desktop-webkit', use: { browserName: 'webkit', viewport: {width:1440,height:900} } },
  ],
  webServer: { command: 'node scripts/realtime-relay.mjs 18242', url: 'http://127.0.0.1:18242', reuseExistingServer: false },
});
