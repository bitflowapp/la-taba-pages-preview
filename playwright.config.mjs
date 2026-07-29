import { defineConfig } from '@playwright/test';

const httpPort = readPort('TABA_E2E_HTTP_PORT', 8080);
const relayPort = readPort('TABA_E2E_RELAY_PORT', 18787);
process.env.TABA_E2E_RELAY_PORT = String(relayPort);

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
    baseURL: `http://127.0.0.1:${httpPort}`,
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      // Reuse the native Node server to avoid the cold module-graph failures
      // observed with the Python development server under parallel workers.
      command: `node scripts/realtime-relay.mjs ${httpPort}`,
      url: `http://127.0.0.1:${httpPort}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Relay realtime para el test cliente/rider entre dos contextos (dos "celulares").
      // Los puertos configurables permiten validar worktrees concurrentes sin reutilizar
      // por accidente un servidor de otra rama.
      command: `node scripts/realtime-relay.mjs ${relayPort}`,
      url: `http://127.0.0.1:${relayPort}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

function readPort(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${name} debe ser un puerto entre 1024 y 65535.`);
  }
  return value;
}
