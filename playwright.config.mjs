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
      // `arranque-sin-jerga` y `production-cart-persistence` se suman a WebKit
      // por el mismo criterio, aplicado al cliente: el panel de recuperación es
      // la defensa contra la pantalla en blanco de iOS —el motor donde apareció
      // ese defecto— y el carrito que sobrevive a la recarga depende de un
      // localStorage que Safari desaloja con reglas propias. Las dos cosas se
      // rompen distinto en WebKit, así que se miden en WebKit.
      // `mp-back-navigation-ui` se suma por el mismo criterio, en su forma más
      // literal: el defecto se vio en un iPhone real y es el motor el que decide
      // el ciclo de vida del retorno —WebKit no guarda esta página en el
      // back-forward cache, así que la rearma entera y vuelve a pedir todo—.
      // Declararlo cerrado con Chromium sería declararlo sobre el navegador
      // donde no ocurrió.
      // `launch-ux-checkout-reorder` se suma porque lo que mide es TÁCTIL y de
      // formulario: el acuse del toque, el sello que descubre el "+" y el
      // resumen que reemplaza al checkout completo. WebKit decide `:active`, el
      // orden de los eventos de puntero y cómo se comporta un control plegado
      // por CSS, y iPhone es además el motor SIN háptica: es donde hay que
      // demostrar que la degradación no rompe nada.
      // `checkout-payment-handoff` y `service-worker-degraded-recovery` se
      // suman por el mismo criterio: el handoff a Mercado Pago y el ciclo de
      // vida del worker los decide el MOTOR —cuánto vive el documento después de
      // pedir la navegación, si la página entra al back-forward cache, cuándo
      // llega `pageshow`—, y el defecto que cierran se vio en un iPhone.
      name: 'mobile-webkit',
      testMatch: /(delivery-location-confirmation|panel-order-recovery|arranque-sin-jerga|production-cart-persistence|mp-back-navigation-ui|checkout-payment-handoff|service-worker-degraded-recovery|storefront-stress-responsive|launch-ux-checkout-reorder)\.spec\.mjs/,
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
