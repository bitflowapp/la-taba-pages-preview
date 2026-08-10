import { defineConfig, devices } from '@playwright/test';

const httpPort = readPort('TABA_E2E_HTTP_PORT', 8080);
const relayPort = readPort('TABA_E2E_RELAY_PORT', 18787);
process.env.TABA_E2E_RELAY_PORT = String(relayPort);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Los specs de concurrencia crean sus propios navegadores/tabs. Ejecutar
  // archivos distintos en paralelo compite por el relay y el servidor estÃ¡tico,
  // convirtiendo saturaciÃ³n del host en timeouts no deterministas del gate.
  workers: 1,
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
  // El grueso del gate corre en Chromium, como siempre. El paso de confirmación
  // de ubicación corre ADEMÁS en WebKit móvil: los permisos de geolocalización y
  // el mapa se comportan distinto en Safari, y ese es el navegador con el que
  // una parte real de los clientes va a confirmar dónde vive.
  //
  // El Panel de recuperación se suma a WebKit por la misma razón, invertida: el
  // negocio atiende desde el teléfono que tiene, y buena parte son iPhone. La
  // salida de rearmado decide si una persona recibe lo que pagó o si le
  // devuelven el dinero; que el botón se dibuje y despache igual en los dos
  // motores no es un detalle estético. No se amplió el resto del gate a WebKit:
  // esa sigue siendo una decisión tomada, y ampliarla a ciegas cambia el costo y
  // la estabilidad del gate sin que nadie lo haya medido.
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'mobile-webkit',
      testMatch: /(delivery-location-confirmation|panel-order-recovery)\.spec\.mjs/,
      use: { ...devices['iPhone 13'] },
    },
  ],
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
