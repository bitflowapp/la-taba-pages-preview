// El Panel del negocio, en los anchos donde se usa.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// El rediseño móvil del Panel se puede deshacer sin que nadie se entere: basta
// con que alguien agregue un destino a `BUSINESS_VIEW_ORDER`, una columna a la
// tarjeta de pedido o un ancho fijo a un formulario. Nada de eso rompe una
// prueba unitaria y todo eso vuelve a poner la navegación en seis renglones o
// devuelve el desplazamiento horizontal.
//
// Estas pruebas fijan las propiedades, no el diseño:
//
//   · no hay desborde horizontal donde no se pidió uno
//   · en teléfono la navegación es alcanzable y no es la fila de escritorio
//   · en escritorio sigue siendo la fila de escritorio, no la barra de teléfono
//   · la acción principal del pedido se ve sin scrollear el ancho
//   · nada interactivo mide menos de 44px
//   · la hoja de «Más» cabe en la pantalla y se cierra
//   · el foco se ve y recorre la navegación con teclado
//   · con el texto al 200% sigue sin haber desborde
//
// Los datos vienen de `scripts/lib/business-panel-fixtures.mjs`, el mismo
// módulo que usan las capturas: si las capturas y el gate hablaran de tableros
// distintos, la evidencia dejaría de significar algo.
import { expect, test } from '@playwright/test';

import { instalarDatosDePrueba } from '../../scripts/lib/business-panel-fixtures.mjs';

const TELEFONOS = [
  // 320px es el ancho más angosto que todavía se usa: un iPhone SE de primera
  // generación, y cualquier teléfono con el zoom del sistema al máximo. No
  // estaba en esta lista, así que el Panel nunca se había probado ahí.
  { nombre: '320x568', width: 320, height: 568 },
  { nombre: '360x740', width: 360, height: 740 },
  { nombre: '390x844', width: 390, height: 844 },
  { nombre: '412x915', width: 412, height: 915 },
  { nombre: '430x932', width: 430, height: 932 },
];

const ESCRITORIOS = [
  { nombre: '1366x768', width: 1366, height: 768 },
  { nombre: '1440x900', width: 1440, height: 900 },
];

/** Abre el Panel en modo producción con la sesión ya sembrada. */
async function abrirPanel(browser, viewport, { conSesion = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.width <= 500,
    isMobile: viewport.width <= 500,
  });
  const page = await context.newPage();
  await instalarDatosDePrueba(page, { conSesion });
  await page.goto('/#business');
  if (conSesion) {
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  } else {
    await page.locator('[data-production-auth-card="business"]').waitFor({ state: 'visible', timeout: 20_000 });
  }
  return { context, page };
}

/**
 * ¿La página desborda a lo ancho, y por culpa de quién?
 *
 * Un carril que se desplaza a propósito no cuenta: lo que se busca es el
 * elemento que empuja el DOCUMENTO, que es el que obliga a arrastrar la
 * pantalla para leer.
 */
async function desborde(page) {
  return page.evaluate(() => {
    const ancho = window.innerWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (scrollWidth <= ancho + 1) return { hay: false, scrollWidth, ancho, culpables: [] };
    const culpables = [];
    const raiz = document.querySelector('[data-view="business"]') || document.body;
    for (const nodo of raiz.querySelectorAll('*')) {
      const r = nodo.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= ancho + 1) continue;
      const propio = getComputedStyle(nodo).overflowX;
      if (propio === 'auto' || propio === 'scroll') continue;
      let padre = nodo.parentElement;
      let enCarril = false;
      while (padre && padre !== raiz) {
        const e = getComputedStyle(padre).overflowX;
        if (e === 'auto' || e === 'scroll') { enCarril = true; break; }
        padre = padre.parentElement;
      }
      if (enCarril) continue;
      const clase = typeof nodo.className === 'string' ? nodo.className.trim().split(/\s+/)[0] : '';
      culpables.push(`${nodo.tagName.toLowerCase()}${clase ? `.${clase}` : ''}@${Math.round(r.right)}`);
      if (culpables.length >= 5) break;
    }
    return { hay: true, scrollWidth, ancho, culpables };
  });
}

/** Todo lo que se puede tocar y mide menos de 44px en alguno de sus lados. */
async function tactilesChicos(page) {
  return page.evaluate(() => {
    const raiz = document.querySelector('[data-view="business"]') || document.body;
    const chicos = [];
    const sel = 'button, a[href], select, input:not([type="hidden"]), textarea, [role="button"]';
    for (const nodo of raiz.querySelectorAll(sel)) {
      if (nodo.disabled || nodo.type === 'checkbox' || nodo.type === 'radio') continue;
      const r = nodo.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(nodo).visibility === 'hidden') continue;
      if (r.height >= 44 && r.width >= 44) continue;
      const etiqueta = (nodo.textContent || nodo.getAttribute('aria-label') || nodo.tagName).trim().slice(0, 30);
      chicos.push(`${etiqueta} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return chicos;
  });
}

for (const viewport of TELEFONOS) {
  test(`Panel en ${viewport.nombre}: sin desborde, con navegación abajo y acción a mano`, async ({ browser }) => {
    const { context, page } = await abrirPanel(browser, viewport);
    try {
      // 1 · la navegación de teléfono existe y la de escritorio no.
      const barra = page.locator('[data-panel-bottom-nav]');
      await expect(barra).toBeVisible();
      await expect(page.locator('.production-operations-shortcuts')).toBeHidden();

      // No más de cinco destinos abajo: con nueve deja de ser una barra.
      const destinos = barra.locator('.panel-nav-item');
      expect(await destinos.count()).toBeLessThanOrEqual(5);

      // 2 · sin desborde horizontal en la vista por defecto.
      const inicial = await desborde(page);
      expect(inicial.hay, `desborda: ${inicial.scrollWidth}px sobre ${inicial.ancho}px por ${inicial.culpables.join(', ')}`).toBe(false);

      // 3 · el tablero de pedidos: la acción principal se ve entera.
      await page.locator('[data-panel-bottom-nav] [data-production-orders-view]').click();
      await expect(page.locator('.production-order-list')).toBeVisible();

      const enPedidos = await desborde(page);
      expect(enPedidos.hay, `pedidos desborda por ${enPedidos.culpables.join(', ')}`).toBe(false);

      const accion = page.locator('.production-order-card .primary-button').first();
      await expect(accion).toBeVisible();
      const caja = await accion.boundingBox();
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(viewport.width + 1);
      // La acción siguiente es lo que se viene a hacer: se toca con el pulgar.
      expect(caja.height).toBeGreaterThanOrEqual(44);

      // 4 · nada interactivo por debajo del mínimo táctil.
      const chicos = await tactilesChicos(page);
      expect(chicos, `áreas táctiles chicas: ${chicos.join(' · ')}`).toEqual([]);

      // 5 · la barra no tapa la última tarjeta.
      await page.evaluate(() => globalThis.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(150);
      const tapada = await page.evaluate(() => {
        const tarjetas = [...document.querySelectorAll('.production-order-card')];
        const ultima = tarjetas.at(-1);
        const nav = document.querySelector('[data-panel-bottom-nav]');
        if (!ultima || !nav) return null;
        return ultima.getBoundingClientRect().bottom - nav.getBoundingClientRect().top;
      });
      expect(tapada, 'la barra inferior tapa la última tarjeta de la cola').toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });
}

test('la hoja de «Más» abre, cabe en la pantalla, navega y se cierra', async ({ browser }) => {
  const { context, page } = await abrirPanel(browser, { width: 390, height: 844 });
  try {
    const hoja = page.locator('[data-panel-more-sheet]');
    await expect(hoja).toBeHidden();

    await page.locator('[data-panel-more-toggle]').click();
    await expect(hoja).toBeVisible();

    // Cabe: una hoja más alta que la pantalla deja el último destino sin tocar.
    const caja = await hoja.boundingBox();
    expect(caja.height).toBeLessThanOrEqual(844);
    expect(caja.y).toBeGreaterThanOrEqual(0);
    expect(caja.width).toBeLessThanOrEqual(390 + 1);

    const chicos = await tactilesChicos(page);
    expect(chicos, `áreas táctiles chicas con la hoja abierta: ${chicos.join(' · ')}`).toEqual([]);

    // Elegir un destino lleva a la pantalla Y cierra la hoja: dejarla abierta
    // encima de lo que se acaba de pedir obliga a un segundo gesto.
    await hoja.locator('[data-business-ops-view="day-close"]').click();
    await expect(page.locator('[data-business-ops-center="day-close"]')).toBeVisible();
    await expect(hoja).toBeHidden();

    // Y se puede cerrar sin elegir nada.
    await page.locator('[data-panel-more-toggle]').click();
    await expect(hoja).toBeVisible();
    await page.locator('[data-panel-more-sheet] [data-panel-more-close]').click();
    await expect(hoja).toBeHidden();
  } finally {
    await context.close();
  }
});

test('la hoja de «Más» sobrevive a que entre un pedido', async ({ browser }) => {
  // El workspace se repinta cuando llega trabajo. Si el estado de la hoja
  // viviera en el marcado, se cerraría sola en la mano de quien la abrió (B19).
  const { context, page } = await abrirPanel(browser, { width: 390, height: 844 });
  try {
    await page.locator('[data-panel-more-toggle]').click();
    await expect(page.locator('[data-panel-more-sheet]')).toBeVisible();

    await page.evaluate(() => {
      globalThis.dispatchEvent(new Event('online'));
      globalThis.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(600);

    await expect(page.locator('[data-panel-more-sheet]')).toBeVisible();
  } finally {
    await context.close();
  }
});

for (const viewport of ESCRITORIOS) {
  test(`Panel en ${viewport.nombre}: sigue siendo escritorio, no un teléfono grande`, async ({ browser }) => {
    const { context, page } = await abrirPanel(browser, viewport);
    try {
      // La fila de destinos es la de escritorio; la barra inferior no aparece.
      await expect(page.locator('.production-operations-shortcuts')).toBeVisible();
      await expect(page.locator('[data-panel-bottom-nav]')).toBeHidden();

      const inicial = await desborde(page);
      expect(inicial.hay, `desborda: ${inicial.culpables.join(', ')}`).toBe(false);

      await page.locator('.production-operations-shortcuts [data-production-orders-view]').click();
      await expect(page.locator('.production-order-list')).toBeVisible();

      const enPedidos = await desborde(page);
      expect(enPedidos.hay, `pedidos desborda por ${enPedidos.culpables.join(', ')}`).toBe(false);

      // El ancho se aprovecha: la tarjeta no se estira hasta el borde de un
      // monitor y los metadatos siguen en columnas, no en una fila apretada.
      const ancho = await page.locator('.production-order-card').first().evaluate((n) => n.getBoundingClientRect().width);
      expect(ancho).toBeLessThanOrEqual(1180);
    } finally {
      await context.close();
    }
  });
}

test('el ingreso al Panel cabe y se puede completar en 360px', async ({ browser }) => {
  const { context, page } = await abrirPanel(browser, { width: 360, height: 740 }, { conSesion: false });
  try {
    const inicial = await desborde(page);
    expect(inicial.hay, `el ingreso desborda por ${inicial.culpables.join(', ')}`).toBe(false);

    const email = page.locator('[data-production-auth-form="business"] input[name="email"]');
    const clave = page.locator('[data-production-auth-form="business"] input[name="password"]');
    await expect(email).toBeVisible();

    // 16px o más: por debajo de eso iOS hace zoom al enfocar y la pantalla se
    // desplaza sola. No es estética, es que el formulario se mueve solo.
    for (const campo of [email, clave]) {
      const tamano = await campo.evaluate((n) => Number.parseFloat(getComputedStyle(n).fontSize));
      expect(tamano).toBeGreaterThanOrEqual(16);
      const alto = (await campo.boundingBox()).height;
      expect(alto).toBeGreaterThanOrEqual(44);
    }

    // Con el teclado abierto -que en un navegador de escritorio se simula
    // achicando la ventana- el botón de ingresar sigue alcanzable.
    await page.setViewportSize({ width: 360, height: 380 });
    await email.focus();
    const enviar = page.locator('[data-production-auth-form="business"] button[type="submit"]');
    await expect(enviar).toBeVisible();
    await enviar.scrollIntoViewIfNeeded();
    const caja = await enviar.boundingBox();
    expect(caja.y + caja.height).toBeLessThanOrEqual(380 + 1);

    const chicos = await tactilesChicos(page);
    expect(chicos, `áreas táctiles chicas en el ingreso: ${chicos.join(' · ')}`).toEqual([]);
  } finally {
    await context.close();
  }
});

test('el foco se ve y recorre la navegación con teclado', async ({ browser }) => {
  const { context, page } = await abrirPanel(browser, { width: 1440, height: 900 });
  try {
    const primero = page.locator('.production-operations-shortcuts .business-ops-nav-button').first();

    /*
     * DOS COSAS QUE HACÍAN INTERMITENTE ESTA MEDICIÓN.
     *
     * 1 · El anillo lo pinta `:focus-visible` (`styles/business.css`), que
     *     aparece sólo cuando el navegador cree que la persona vino por teclado.
     *     Un `focus()` a secas depende de esa heurística. Una pulsación real la
     *     fija, y además es lo que el título de esta prueba dice que se prueba.
     *
     * 2 · El workspace se repinta SOLO —lleva la marca de la última
     *     sincronización— y puede desconectar el botón entre que se resuelve el
     *     localizador y se lo mide. `getComputedStyle` sobre un nodo
     *     desconectado no falla: devuelve cadenas VACÍAS. `outlineWidth` sale ''
     *     y `parseFloat('')` es NaN —el rojo que aparecía en CI—, pero
     *     `outlineStyle` también sale '' y '' NO es 'none', así que la
     *     comprobación del estilo pasaba sin haber mirado nada. Por eso se
     *     informa la desconexión y se vuelve a medir sobre el nodo nuevo, en vez
     *     de aceptar una medición que miente en las dos direcciones.
     */
    await page.keyboard.press('Tab');
    await primero.focus();
    await expect(primero).toBeFocused();

    let contorno = null;
    await expect.poll(async () => {
      contorno = await primero.evaluate((n) => {
        if (!n.isConnected) return null;
        const e = getComputedStyle(n);
        return { ancho: Number.parseFloat(e.outlineWidth), estilo: e.outlineStyle };
      });
      return contorno !== null;
    }, { message: 'el botón nunca quedó conectado el tiempo suficiente para medir el anillo de foco' }).toBe(true);

    expect(contorno.estilo).not.toBe('none');
    expect(contorno.ancho).toBeGreaterThan(0);

    // Tab avanza dentro de la misma navegación, no salta afuera.
    await page.keyboard.press('Tab');
    const sigueEnLaNav = await page.evaluate(() => Boolean(
      document.activeElement?.closest('.production-operations-shortcuts'),
    ));
    expect(sigueEnLaNav).toBe(true);

    // Y sobrevive al repintado. Esta prueba se puso intermitente antes de que
    // existiera esta comprobación: pasaba sola y fallaba dentro de la suite,
    // porque el markup del workspace incluye la marca de la última
    // sincronización y cambia por su cuenta. Cuando cambiaba entre el `focus()`
    // y el `Tab`, el foco se había ido al `body`.
    //
    // El flake era el sintoma: quien recorre el Panel con teclado perdía el
    // lugar cada vez que el reloj avanzaba. Acá se fuerza el repintado en vez
    // de esperar a que ocurra solo.
    const destino = page.locator('.production-operations-shortcuts [data-business-ops-view="payments"]');
    await destino.focus();
    await page.evaluate(() => {
      globalThis.dispatchEvent(new Event('online'));
      globalThis.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(400);
    await expect(destino).toBeFocused();

    // Y el destino se puede elegir con el teclado, sin puntero.
    await page.locator('.production-operations-shortcuts [data-production-orders-view]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.production-order-list')).toBeVisible();
  } finally {
    await context.close();
  }
});

for (const zoom of [1.5, 2]) {
  test(`con el texto al ${zoom * 100}% el Panel sigue sin desbordar`, async ({ browser }) => {
    // Se sube el tamaño de fuente raíz, que es lo que hace el ajuste de texto
    // del sistema. Es distinto del zoom de página: acá el layout tiene que
    // reacomodarse, no escalarse entero.
    const { context, page } = await abrirPanel(browser, { width: 390, height: 844 });
    try {
      await page.addStyleTag({ content: `html { font-size: ${16 * zoom}px; }` });
      await page.locator('[data-panel-bottom-nav] [data-production-orders-view]').click();
      await expect(page.locator('.production-order-list')).toBeVisible();
      await page.waitForTimeout(200);

      const medido = await desborde(page);
      expect(medido.hay, `al ${zoom * 100}% desborda por ${medido.culpables.join(', ')}`).toBe(false);

      // La barra inferior no puede comerse la pantalla al agrandar el texto.
      const alto = await page.locator('[data-panel-bottom-nav]').evaluate((n) => n.getBoundingClientRect().height);
      expect(alto).toBeLessThanOrEqual(844 * 0.2);
    } finally {
      await context.close();
    }
  });
}
