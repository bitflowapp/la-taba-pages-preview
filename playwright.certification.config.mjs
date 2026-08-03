import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.mjs';

export default defineConfig({
  ...baseConfig,
  outputDir: process.env.TABA_E2E_ARTIFACT_DIR || 'test-results-certification',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...baseConfig.use,
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
