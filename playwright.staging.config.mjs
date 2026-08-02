import { defineConfig } from '@playwright/test';

const httpPort = readPort('TABA_STAGING_SMOKE_HTTP_PORT', 39089);

export default defineConfig({
  testDir: './tests/staging',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  outputDir: process.env.TABA_STAGING_SMOKE_OUTPUT_DIR
    || './test-results-staging-business-intake-ephemeral',
  use: {
    baseURL: `http://127.0.0.1:${httpPort}`,
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    // Un trace de navegador puede conservar inputs y cuerpos Auth. El smoke
    // maneja credenciales sólo en memoria y genera evidencia propia saneada.
    trace: 'off',
  },
  webServer: {
    // Este proceso sólo sirve los archivos locales. La autoridad de datos del
    // test es siempre el PostgreSQL del project ref de staging.
    command: `node scripts/realtime-relay.mjs ${httpPort}`,
    url: `http://127.0.0.1:${httpPort}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

function readPort(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${name} debe ser un puerto entre 1024 y 65535.`);
  }
  return value;
}
