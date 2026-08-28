/*
 * EL PANEL DEL NEGOCIO EN LAS DOS SITUACIONES QUE ROMPEN UNA JORNADA.
 * ===========================================================================
 *
 * 1. ARRANCAR SIN RED. `production-operations.js` estaba en el precache, pero
 *    sus imports ESTÁTICOS no: sin red, el navegador no puede resolver un
 *    import estático que no está en la caché y el grafo entero se cae. No
 *    degrada —no abre—. Esta prueba enciende el worker de verdad, tira los
 *    módulos del borde y exige que el Panel siga entrando.
 *
 * 2. QUE UN PEDIDO CAMBIE NO PUEDE LLEVARSE PUESTO EL TRABAJO DE UNA PERSONA.
 *    Con la bandeja llena, el repintado reemplazaba el tablero entero: el
 *    scroll saltaba, el motivo de cancelación a medio escribir desaparecía y el
 *    foco se iba al `body`. Esta prueba pone a alguien a trabajar en una
 *    tarjeta, cambia OTRA en el servidor, y mide qué sobrevivió y cuántas
 *    tarjetas hubo que tocar.
 *
 * Los `fetch` del worker NO pasan por `page.route()`: por eso el borde se
 * degrada del lado del servidor, con `/__edge-fault` del relay de pruebas.
 */
import { expect, test } from '@playwright/test';

import { SUPABASE_URL, instalarDatosDePrueba, pedidos } from '../../scripts/lib/business-panel-fixtures.mjs';

test.describe.configure({ timeout: 180_000 });

const CUANTOS = 300;

/** N pedidos derivados de los seis de la biblioteca, con identidad propia. */
function muchosPedidos(cuantos) {
  const base = pedidos();
  return Array.from({ length: cuantos }, (_, i) => {
    const molde = base[i % base.length];
    const n = String(i + 1).padStart(4, '0');
    return {
      ...molde,
      // UUID válido: con el último grupo corto, el adaptador descarta el
      // `backendId` y el pedido nunca vuelve a actualizarse.
      id: `00000000-0000-4000-8000-${n.padStart(12, '0')}`,
      public_code: `LT-7${n}`,
      revision: (i % 7) + 1,
      order_items: molde.order_items.map((item, j) => ({ ...item, id: `${n}-${j}` })),
    };
  });
}

test.describe('el Panel arranca con los módulos caídos', () => {
  test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });

  test.afterEach(async ({ request }) => {
    await request.get('/__edge-fault?mode=off').catch(() => undefined);
  });

  /*
   * EL ESCENARIO ES EL DE DESPUÉS DE UNA PUBLICACIÓN, Y ESO IMPORTA.
   *
   * El worker cachea al pasar: cualquier módulo que se pida CON red queda
   * guardado. Así que un teléfono que ya abrió el Panel con señal lo tiene en
   * la caché aunque no esté precacheado, y una prueba que abra el Panel primero
   * pasa aunque el precache esté incompleto. No prueba nada.
   *
   * El caso real es el otro, y es rutina: `precargar()` hace
   * `caches.delete(CACHE_NAME)` y vuelve a llenar la caché en cada publicación.
   * Después de cada versión nueva, lo único que hay guardado es lo que está en
   * la lista. Si el comercio abre el Panel por primera vez tras la
   * actualización y justo ahí la señal está mal, sin precache no abre.
   *
   * Por eso acá se visita la TIENDA —que no carga el Panel—, se espera a que el
   * worker termine de instalar, recién entonces se tira el borde, y sólo
   * después se va al Panel.
   */
  test('recién publicada la versión y sin red, el Panel entra igual', async ({ page, request }) => {
    // Sin sesión: lo que se prueba es que el MÓDULO entra, no que alguien opere.
    // La configuración productiva es lo que hace que `#business` sea el Panel
    // del comercio y no el panel de demostración.
    await instalarDatosDePrueba(page, { conSesion: false });
    await page.goto('/', { waitUntil: 'load' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
    // La instalación terminó cuando el precache tiene lo del arranque del
    // cliente. Recién ahí tiene sentido preguntar por lo del Panel.
    await page.waitForFunction(async () => (
      Boolean(await caches.match(new URL('js/state.js', location.href).href))
    ), null, { timeout: 60_000 });

    // El grafo del Panel tiene que estar guardado SIN haberlo visitado: eso es
    // lo que significa estar en el precache.
    const guardados = await page.evaluate(async (rutas) => {
      const resultado = {};
      for (const ruta of rutas) {
        resultado[ruta] = Boolean(await caches.match(new URL(ruta, location.href).href));
      }
      return resultado;
    }, [
      'js/production-operations.js',
      'js/business/business-operations-center.js',
      'js/business/business-panel-render.js',
      'js/business/business-tray-patch.js',
      'js/business/business-command-outbox.js',
      'js/platform/indexeddb-command-storage.js',
    ]);
    expect(
      Object.entries(guardados).filter(([, presente]) => !presente).map(([ruta]) => ruta),
      'el grafo estático del Panel tiene que estar precacheado, no cacheado al pasar',
    ).toEqual([]);

    // Ahora el borde tira TODOS los módulos, y recién ahí se va al Panel.
    const respuesta = await request.get('/__edge-fault?mode=js-503');
    expect(respuesta.ok()).toBe(true);
    await page.goto('/#business', { waitUntil: 'commit' });

    /*
     * QUÉ SE MIRA, Y POR QUÉ NO ALCANZA CON QUE SE VEA LA TARJETA DE ACCESO.
     *
     * `app.js` muestra y esconde todo lo que lleva `data-production-only`
     * -la tarjeta de acceso incluida- por MODO DE APLICACIÓN, y `app.js` es
     * parte del arranque del cliente: está precacheado desde siempre y entra
     * aunque el Panel no. O sea que la tarjeta se ve igual con el grafo del
     * Panel caído, y una prueba que mire eso pasa siempre. (Se comprobó: pasa
     * en `cf793a6`, donde el Panel NO está precacheado.)
     *
     * La región de alta autogestionada, en cambio, la escribe
     * `renderAccessRegistrationRegion()`, que vive DENTRO de
     * `production-operations.js` y arma su marcado con
     * `business-access-registration.js`. En el documento arranca vacía y
     * `hidden`. Que tenga contenido sólo puede querer decir una cosa: el grafo
     * entero del Panel resolvió desde la caché.
     */
    const alta = page.locator('[data-panel-access-registration]');
    await expect(alta).toBeVisible({ timeout: 60_000 });
    await expect(alta.locator('button, a, input').first())
      .toBeVisible({ timeout: 60_000 });
  });
});

test.describe('la bandeja no se lleva puesto el trabajo del operador', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('un pedido que cambia conserva scroll, borrador y foco, y toca una sola tarjeta', async ({ page }) => {
    await instalarDatosDePrueba(page, { conSesion: true });
    const estado = { lista: muchosPedidos(CUANTOS) };
    await page.route(`${SUPABASE_URL}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/rest/v1/orders')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(estado.lista) });
      }
      return route.fallback();
    });
    await page.addInitScript(() => {
      const config = globalThis.__LA_TABA_RUNTIME_CONFIG__;
      if (config?.repository) config.repository.pollMs = 1200;
      try { delete globalThis.__TAURI__; } catch (_) { globalThis.__TAURI__ = undefined; }
    });

    await page.goto('/#business', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('[data-production-orders-view]:visible').first().click();
    await page.locator('.production-order-card').nth(CUANTOS - 1).waitFor({ state: 'attached', timeout: 120_000 });

    // Alguien está trabajando: scrolleado, escribiendo un motivo, con el cursor
    // donde lo dejó.
    const objetivo = 'LT-70003';
    const hijosAntes = await page.evaluate(() => (
      document.querySelector('[data-production-workspace="business"]').childNodes.length
    ));
    const trabajo = await page.evaluate((excluido) => {
      const codigo = (tarjeta) => tarjeta.querySelector('.production-order-code')?.textContent?.trim() || '';
      const tarjeta = [...document.querySelectorAll('.production-order-card')]
        .find((item) => codigo(item) !== excluido && item.querySelector('[data-production-cancel-reason]'));
      tarjeta.scrollIntoView({ block: 'center' });
      const entrada = tarjeta.querySelector('[data-production-cancel-reason]');
      entrada.value = 'el cliente pidio esperar';
      entrada.focus();
      entrada.setSelectionRange(entrada.value.length, entrada.value.length);
      return { codigo: codigo(tarjeta), scroll: globalThis.scrollY, texto: entrada.value };
    }, objetivo);

    // Se cuentan las tarjetas que entran y salen del DOM, no las mutaciones:
    // reemplazar el tablero es UNA mutación y trescientas tarjetas.
    await page.evaluate(() => {
      const raiz = document.querySelector('[data-production-workspace="business"]');
      globalThis.__tocadas = 0;
      globalThis.__observador = new MutationObserver((mutaciones) => {
        for (const mutacion of mutaciones) {
          for (const nodo of [...mutacion.addedNodes, ...mutacion.removedNodes]) {
            if (nodo.nodeType !== 1) continue;
            globalThis.__tocadas += nodo.classList?.contains('production-order-card')
              ? 1
              : (nodo.querySelectorAll?.('.production-order-card').length || 0);
          }
        }
      });
      globalThis.__observador.observe(raiz, { childList: true, subtree: true });
    });

    // El servidor mueve OTRO pedido.
    estado.lista = estado.lista.map((pedido) => (
      pedido.public_code === objetivo
        ? { ...pedido, status: 'ready', revision: pedido.revision + 1 }
        : pedido
    ));
    await page.waitForFunction((codigo) => {
      const tarjeta = [...document.querySelectorAll('.production-order-card')].find((item) => (
        item.querySelector('.production-order-code')?.textContent?.trim() === codigo
      ));
      return Boolean(tarjeta?.querySelector('.status-pill.ready'));
    }, objetivo, { timeout: 60_000 });
    await page.waitForTimeout(400);

    const despues = await page.evaluate((ref) => {
      globalThis.__observador.disconnect();
      const tarjeta = [...document.querySelectorAll('.production-order-card')].find((item) => (
        item.querySelector('.production-order-code')?.textContent?.trim() === ref.codigo
      ));
      const entrada = tarjeta?.querySelector('[data-production-cancel-reason]');
      return {
        tocadas: globalThis.__tocadas,
        scroll: globalThis.scrollY,
        texto: entrada?.value ?? null,
        cursor: entrada?.selectionStart ?? null,
        tieneFoco: document.activeElement === entrada,
        tarjetas: document.querySelectorAll('.production-order-card').length,
        // Los hijos DIRECTOS del workspace, contando nodos de texto. Un parche
        // por región que no recorta el marcado deja un nodo de texto suelto
        // cada vez, y eso no se ve contando elementos.
        hijosDelWorkspace: document.querySelector('[data-production-workspace="business"]').childNodes.length,
      };
    }, trabajo);

    expect(despues.texto, 'el motivo a medio escribir sobrevive').toBe(trabajo.texto);
    expect(despues.tieneFoco, 'el foco no se va al body').toBe(true);
    expect(despues.cursor, 'el cursor queda donde estaba').toBe(trabajo.texto.length);
    expect(Math.abs(despues.scroll - trabajo.scroll), 'el scroll no salta').toBeLessThanOrEqual(8);
    expect(despues.tarjetas, 'la bandeja sigue completa').toBe(CUANTOS);
    /*
     * El número que este trabajo existe para bajar. Antes de reconciliar por
     * tarjeta eran 1.800 con 300 pedidos —el tablero se rearmaba entero, varias
     * veces por cambio—. Ahora es la tarjeta que cambió (sale y entra) más, a lo
     * sumo, la que se movió de sección. El umbral deja aire para el sondeo sin
     * dejar pasar un rearme: uno solo ya serían 300.
     */
    expect(despues.tocadas, 'un pedido que cambia no puede rearmar la bandeja').toBeLessThanOrEqual(12);
    expect(despues.hijosDelWorkspace, 'el parche por región no deja nodos sueltos').toBe(hijosAntes);
  });
});
