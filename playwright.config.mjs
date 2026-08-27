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
  /*
   * REINTENTAR EN CI, NUNCA EN LOCAL.
   *
   * Medido sobre el historial reciente, no supuesto. Tres corridas de `main`
   * murieron por el gate de navegador; ninguna era una regresión:
   *
   *   109d78a  business-windows-operations:144  el formulario pedía la frase de
   *            confirmación que la prueba ACABABA de escribir: el click llegó
   *            antes que el `fill`.
   *   109d78a  launch-ux-checkout-reorder:559   una de las dos muestras de alto
   *            midió 0: se midió antes de que el navegador maquetara.
   *   956fa74  catalog-card-glow:68 [webkit]    «WebKit encountered an internal
   *            error» dentro de `waitForURL`. Falla del motor, no del producto.
   *
   * El primer par corrió sobre un ÁRBOL IDÉNTICO —mismo hash de árbol— al de
   * `d313980`, que había pasado 462/462 minutos antes. Los mismos bytes, dos
   * veredictos opuestos: eso no es una regresión, es ruido, y costaba 28 a 33
   * minutos y un `main` en rojo cada vez.
   *
   * Por qué global y no sólo WebKit: dos de las tres fueron de Chromium.
   * Reintentar sólo WebKit habría dejado pasar la mayoría.
   *
   * En LOCAL sigue en 0: quien escribe una prueba tiene que ver su carrera la
   * primera vez, no ganarla por reintento.
   *
   * El reintento NO tapa nada: `tests/e2e-infra/reporter-inestables.mjs` nombra
   * cada prueba que pasó al reintentar y pone la corrida en rojo si son
   * demasiadas. Ver docs/operacion/ci-inestables.md.
   */
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['./tests/e2e-infra/reporter-inestables.mjs']],
  timeout: 45_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${httpPort}`,
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    /*
     * TODA prueba corre como quien YA respondió a la invitación de instalar.
     *
     * Desde que la tienda se ofrece a instalarse, un teléfono sin decidir recibe
     * una hoja MODAL a los pocos segundos de arrancar. Para `pwa-install.spec`
     * eso es el objeto de estudio; para cualquier otra suite es una variable
     * ajena que roba toques: en `mobile-webkit` —que corre con user agent de
     * iPhone— apareció encima de "Confirmar ubicación" y se comió un tap del
     * "+" de la góndola, y el segundo caso fue INTERMITENTE, que es peor.
     *
     * Se siembra acá y no spec por spec justamente por eso: los diez archivos
     * de WebKit son candidatos y el que se olvide va a fallar una vez cada
     * tantas corridas. `TABA_INSTALL_PROMPT_V1` no es un interruptor de prueba:
     * es el estado exacto que deja alguien que tocó "Ahora no", y con él la
     * entrada del Perfil sigue visible igual que para esa persona.
     *
     * `tests/e2e/pwa-install.spec.mjs` lo desactiva con un `storageState` vacío,
     * y `installBrowserStubs` —que limpia el almacenamiento en cada navegación—
     * lo vuelve a sembrar con `skipInstallInvitation`.
     */
    storageState: {
      cookies: [],
      origins: [{
        origin: `http://127.0.0.1:${httpPort}`,
        localStorage: [{
          name: 'TABA_INSTALL_PROMPT_V1',
          value: JSON.stringify({ v: 1, decision: 'declined', at: '2026-01-01T00:00:00.000Z', platform: 'e2e' }),
        }],
      }],
    },
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
      // `catalog-card-glow` se suma porque el brillo depende de dos cosas que
      // decide el MOTOR: si `calc()` dentro de la barra de alfa de `rgb()` está
      // soportado —si no lo estuviera, el token tendría el número correcto y la
      // tarjeta no tendría brillo— y cómo se comporta el scroll del documento
      // en iOS, que es donde se modula.
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
      // `pwa-install` se suma por el motivo más directo de todos: la mitad de lo
      // que prueba ES iOS —la guía de "Agregar a pantalla de inicio",
      // `navigator.standalone`, el `<dialog>` modal— y WebKit es el motor de
      // Safari. Declararlo cerrado sólo en Chromium sería cerrarlo en el
      // navegador donde ese camino no existe. Sus tres bloques declaran su
      // propio user agent, así que "Android" y "Escritorio" siguen siendo eso
      // aunque el proyecto traiga un iPhone por defecto.
      // `address-flow` se suma por dos cosas que decide el MOTOR y no el
      // producto: el zoom automático al enfocar un campo por debajo de 16px es
      // un comportamiento de Safari en iPhone —y esa suite lo mide en 320, 390 y
      // 430—, y la hoja de direcciones es un `<dialog>` modal, cuyo atrapado de
      // foco, cierre con Escape y bloqueo del fondo WebKit implementa aparte.
      testMatch: /(delivery-location-confirmation|address-flow|panel-order-recovery|arranque-sin-jerga|production-cart-persistence|mp-back-navigation-ui|checkout-payment-handoff|service-worker-degraded-recovery|storefront-stress-responsive|launch-ux-checkout-reorder|catalog-card-glow|pwa-install)\.spec\.mjs/,
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
