import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * El aviso «Hay una actualización disponible» contra el ciclo de vida REAL de un
 * Service Worker.
 *
 * Por qué existe un servidor propio acá dentro: para que exista un `waiting`
 * worker hace falta publicar DOS versiones distintas del mismo `sw.js` en la
 * misma URL. El servidor estático del gate sirve el árbol tal cual, así que no
 * hay forma de mover la publicación en medio de una prueba. Este arnés sirve el
 * `js/pwa-update.js` REAL —byte a byte, sin dobles— y el `sw.js` REAL con dos
 * únicos ajustes mecánicos: el nombre de la caché lleva el número de versión y
 * la lista de precache se reduce a la raíz (precachear 100 archivos que este
 * servidor no tiene haría fallar el install y no probaríamos nada).
 *
 * Los handlers que deciden el ciclo de vida —sin `skipWaiting` en install,
 * `clients.claim()` en activate, `skip-waiting` por mensaje— son los del
 * repositorio, que es justamente lo que hay que probar.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const updateScript = fs.readFileSync(path.join(root, 'js', 'pwa-update.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

// El aviso, con el mismo marcado que sirve index.html.
const BANNER_MARKUP = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .match(/<div class="pwa-banner pwa-banner-update"[\s\S]*?<\/div>/)?.[0];

function workerForVersion(version) {
  return workerSource
    .replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'la-taba-runtime-harness-v${version}';`)
    .replace(/const ASSETS = \[[\s\S]*?\n\];/, "const ASSETS = ['./'];")
    .concat(`\nself.__HARNESS_VERSION = ${version};\n`);
}

const PAGE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Arnés del aviso de actualización</title>
<style>
  [hidden], .hidden { display: none !important; }
  body { margin: 0; min-height: 200vh; }
  .pwa-banner { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 8px;
    align-items: center; padding: 12px 16px; background: white; border: 1px solid #ccc; }
  .pwa-banner-update { bottom: 84px; }
  .target { position: fixed; right: 24px; bottom: 110px; width: 140px; height: 44px; }
</style>
</head>
<body>
  <button class="target" type="button" data-agregar>Agregar</button>
  __BANNER__
  <script>
    // Cuenta las cargas del documento para probar que no hay bucle de recargas.
    const loads = Number(sessionStorage.getItem('harness:loads') || '0') + 1;
    sessionStorage.setItem('harness:loads', String(loads));
    window.__harnessLoads = loads;
  </script>
  <script src="/js/pwa-update.js"></script>
</body>
</html>`;

let server;
let origin;
let publishedVersion = 1;

test.use({ serviceWorkers: 'allow' });

test.beforeAll(async () => {
  expect(BANNER_MARKUP, 'index.html debería seguir teniendo el aviso de actualización').toBeTruthy();
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const noStore = { 'cache-control': 'no-store, must-revalidate' };
    if (url.pathname === '/' || url.pathname === '/index.html') {
      response.writeHead(200, { ...noStore, 'content-type': 'text/html; charset=utf-8' });
      response.end(PAGE_HTML.replace('__BANNER__', BANNER_MARKUP));
      return;
    }
    if (url.pathname === '/js/pwa-update.js') {
      response.writeHead(200, { ...noStore, 'content-type': 'application/javascript; charset=utf-8' });
      response.end(updateScript);
      return;
    }
    if (url.pathname === '/sw.js') {
      response.writeHead(200, { ...noStore, 'content-type': 'application/javascript; charset=utf-8' });
      response.end(workerForVersion(publishedVersion));
      return;
    }
    response.writeHead(404, noStore);
    response.end('no');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  publishedVersion = 1;
});

/** Espera a que la página quede controlada por un worker activo (activate -> claim). */
async function openControlledPage(context) {
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20_000 });
  return page;
}

/** Publica una versión nueva y espera a que quede un worker EN ESPERA de verdad. */
async function publishAndWaitForWaiting(page, version) {
  publishedVersion = version;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.waiting);
  }, null, { timeout: 20_000 });
}

/** Dispara la revisión que el módulo ya escucha, sin tocar su estado interno. */
async function nudge(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function banner(page) {
  return page.locator('[data-app-update-banner]');
}

test.describe('el aviso de actualización sigue el ciclo de vida real del worker', () => {
  test('otra pestaña actualiza: el aviso de esta NO queda huérfano', async ({ context }) => {
    const first = await openControlledPage(context);
    const second = await openControlledPage(context);

    await publishAndWaitForWaiting(first, 2);
    await nudge(first);
    await nudge(second);

    await expect(await banner(first)).toBeVisible();
    await expect(await banner(second)).toBeVisible();

    // La primera pestaña actualiza. El worker nuevo activa y reclama TODOS los
    // clientes: para la segunda, la actualización ya ocurrió y `waiting` es null.
    await first.locator('[data-app-update-now]').click();
    await second.waitForFunction(() => navigator.serviceWorker.controller
      && navigator.serviceWorker.controller.scriptURL.length > 0, null, { timeout: 20_000 });

    // Contrato: el aviso no puede quedar pegado en una pantalla donde ya no hay
    // nada que actualizar. Ocupa 115 px fijos sobre el contenido y se come el
    // toque de cualquier control que caiga en esa banda.
    await expect(await banner(second)).toBeHidden({ timeout: 15_000 });
    await expect(await banner(first)).toBeHidden({ timeout: 15_000 });
  });

  test('el worker en espera activa solo: el aviso se retira y el botón no queda muerto', async ({ context }) => {
    const page = await openControlledPage(context);
    await publishAndWaitForWaiting(page, 2);
    await nudge(page);
    await expect(await banner(page)).toBeVisible();

    // Activación por su cuenta: exactamente el escenario del P1. Nadie tocó
    // «Actualizar ahora»; cuando la persona lo toque, `registration.waiting` ya
    // no existe.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration.waiting.postMessage('skip-waiting');
    });
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return !registration?.waiting;
    }, null, { timeout: 20_000 });

    await expect(await banner(page)).toBeHidden({ timeout: 15_000 });
  });

  test('«Actualizar ahora» actualiza de verdad y recarga una sola vez', async ({ context }) => {
    const page = await openControlledPage(context);
    await publishAndWaitForWaiting(page, 2);
    await nudge(page);
    await expect(await banner(page)).toBeVisible();

    await page.locator('[data-app-update-now]').click();
    await expect(await banner(page)).toBeHidden({ timeout: 15_000 });

    // La actualización llegó: la página quedó controlada por el worker nuevo.
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active) && !registration.waiting;
    }, null, { timeout: 20_000 });

    // Una sola recarga: si el `controllerchange` recargara sin condición, o si
    // el aviso volviera a aparecer y disparara otra, esto crecería sin freno.
    await page.waitForTimeout(2000);
    const loads = await page.evaluate(() => Number(sessionStorage.getItem('harness:loads') || '0'));
    expect(loads, 'la actualización recarga la página exactamente una vez').toBe(2);
    await expect(await banner(page)).toBeHidden();
  });

  test('en un iPhone el aviso se puede cerrar y devuelve el toque a «Agregar»', async ({ browser }) => {
    // 390×664 es el viewport útil de un iPhone 13 con la barra de Safari. El
    // aviso mide 115 px y va fijo a 84 px del borde: cae justo sobre la banda
    // donde vive el control de compra.
    const context = await browser.newContext({
      viewport: { width: 390, height: 664 },
      serviceWorkers: 'allow',
      hasTouch: true,
      isMobile: true,
    });
    const page = await openControlledPage(context);
    await publishAndWaitForWaiting(page, 2);
    await nudge(page);
    await expect(await banner(page)).toBeVisible();

    // Con el aviso a la vista, el toque sobre esa banda es del aviso: eso es lo
    // que le pasó a una persona de verdad intentando agregar un producto.
    const covered = await page.evaluate(() => {
      const target = document.querySelector('[data-agregar]').getBoundingClientRect();
      const top = document.elementFromPoint(target.left + target.width / 2, target.top + target.height / 2);
      return top?.closest('[data-app-update-banner]') ? 'aviso' : 'control';
    });
    expect(covered, 'el aviso se superpone al control: por eso tiene que poder cerrarse').toBe('aviso');

    await page.locator('[data-app-update-dismiss]').click();
    await expect(await banner(page)).toBeHidden();

    let tapped = false;
    await page.exposeFunction('__harnessTapped', () => { tapped = true; });
    await page.evaluate(() => {
      document.querySelector('[data-agregar]').addEventListener('click', () => window.__harnessTapped());
    });
    await page.locator('[data-agregar]').tap();
    expect(tapped, 'con el aviso cerrado el toque tiene que llegar al control').toBe(true);

    // Cerrarlo no borra la actualización: sigue disponible y el ciclo de vida
    // la retira sola cuando de verdad ya no hay nada en espera.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration.waiting.postMessage('skip-waiting');
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20_000 });
    await expect(await banner(page)).toBeHidden();
    await context.close();
  });

  test('sin nada que actualizar el aviso no aparece, y no se apilan escuchas', async ({ context }) => {
    const page = await openControlledPage(context);
    for (let i = 0; i < 6; i += 1) await nudge(page);
    await page.waitForTimeout(1000);
    await expect(await banner(page)).toBeHidden();

    // Con el aviso a la vista, el control que queda debajo tiene que seguir
    // siendo tocable después de que la actualización termina.
    await publishAndWaitForWaiting(page, 2);
    for (let i = 0; i < 6; i += 1) await nudge(page);
    await expect(await banner(page)).toBeVisible();

    await page.locator('[data-app-update-now]').click();
    await expect(await banner(page)).toBeHidden({ timeout: 15_000 });
    const loads = await page.evaluate(() => Number(sessionStorage.getItem('harness:loads') || '0'));
    expect(loads, 'seis revisiones no pueden multiplicar las recargas').toBe(2);
  });
});
