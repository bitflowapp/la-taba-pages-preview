import assert from 'node:assert/strict';
import original from './playwright.config.mjs';

const base = new URL(process.env.TABA_PUBLIC_TEST_URL || 'https://taba2-staging.pages.dev');
assert.equal(base.origin, 'https://taba2-staging.pages.dev');
const selected = /(?:commerce-v3|address-flow|customer-delivery|business-setup)\.spec\.mjs$/;

// These specs explicitly select demo fixtures on the published application.
// Live catalogue/address checks remain in smoke-commerce-v3-public.mjs.
export default {
  ...original,
  webServer: undefined,
  reporter: 'list',
  retries: 0,
  outputDir: './artifacts/commerce-v3/public/ui-regressions',
  testMatch: selected,
  projects: original.projects.map(project => ({ ...project, testMatch: selected })),
  use: {
    ...original.use,
    baseURL: base.origin,
    storageState: {
      cookies: [],
      origins: original.use.storageState.origins.map(origin => ({ ...origin, origin: base.origin })),
    },
  },
};
