import { test, expect } from '@playwright/test';

const ANCHOS = [320, 360, 390, 432];

/**
 * Selectores tomados del DOM PUBLICADO, no supuestos:
 *  · el unico [data-product-grid] vive en la vista `catalog`, oculta desde home;
 *    home pinta sus productos en otro contenedor, asi que se filtra por visible.
 *  · [data-cart-count] se oculta cuando esta en cero, asi que se lee el texto
 *    del nodo aunque no sea visible.
 */

function vigilar(page) {
  const errores = [];
  const malas = [];
  page.on('pageerror', (e) => errores.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon/i.test(t)) return;
    errores.push(t.slice(0, 300));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) malas.push(`${r.status()} ${r.url()}`);
  });
  return { errores, malas };
}

async function esperarCatalogo(page) {
  await page.waitForFunction(() => {
    const g = document.querySelector('[data-production-catalog-gate]');
    return g && g.hidden === true;
  }, null, { timeout: 60_000 });
  await expect
    .poll(async () => page.locator('[data-add-product]:visible').count(), { timeout: 60_000 })
    .toBeGreaterThan(0);
}

/**
 * El aviso de actualizacion de la PWA es `fixed` a 76 px del piso y NO tiene
 * boton de descarte: su unica salida es «Actualizar ahora». Mientras esta,
 * puede quedar encima de un boton del contenido. Se hace lo que haria una
 * persona: aceptarlo. Devuelve si estaba, para poder reportarlo.
 */
async function resolverAvisoDeActualizacion(page, esperaMs = 25_000) {
  const boton = page.locator('[data-app-update-now]');
  // El aviso no aparece al instante: depende de que el worker nuevo quede en
  // espera. Se le da tiempo a propósito, porque si aparece DESPUES tapa un
  // boton del contenido y ya no hay forma de sacarlo del medio.
  try {
    await boton.waitFor({ state: 'visible', timeout: esperaMs });
  } catch {
    return false;
  }
  await boton.click();
  await page.waitForTimeout(5000);
  await page.waitForLoadState('load').catch(() => undefined);
  await esperarCatalogo(page);
  return true;
}

/**
 * Centra el objetivo antes de tocarlo.
 *
 * No es cosmetica: el aviso de actualizacion de la PWA ocupa una banda fija de
 * ~115 px justo encima de la navegacion, y un `scrollIntoViewIfNeeded` deja al
 * boton JUSTO ahi debajo, donde el toque no le llega. Centrar es la maniobra
 * que hace la persona para poder tocarlo. Queda documentado como defecto:
 * ver DEFECTO-AVISO-PWA en el manifest.
 */
async function tocar(locator, page) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(600);
  await locator.click();
}

const contarCarrito = (page) => page.evaluate(() => {
  const n = [...document.querySelectorAll('[data-cart-count]')]
    .map((e) => Number((e.textContent || '').replace(/\D/g, '') || 0));
  return n.length ? Math.max(...n) : 0;
});

async function sinDesborde(page, donde) {
  const d = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    cliente: document.documentElement.clientWidth,
  }));
  expect(d.scroll, `desborde horizontal en ${donde}: ${d.scroll} > ${d.cliente}`).toBeLessThanOrEqual(d.cliente + 1);
}

/*
 * La navegacion que se ejercita es la INFERIOR (`.mobile-nav`), que es la que
 * usa el cliente en el telefono. No se usa `.first()` sobre [data-nav-view]:
 * el primero del arbol es el CTA «Ver catalogo completo» que vive dentro del
 * contenido, y al scrollearlo a la vista queda debajo del aviso de
 * actualizacion de la PWA —fixed, z-index 700, bottom 76px—, que le come el
 * toque. Medido en los dos motores. El aviso NO tapa la navegacion inferior.
 */
test.describe('CLIENTE · la tienda publicada', () => {
  test('home -> busqueda -> categoria -> producto -> carrito -> reload', async ({ page }) => {
    const { errores, malas } = vigilar(page);

    // 1 · HOME
    await page.goto('/', { waitUntil: 'load' });
    await esperarCatalogo(page);
    const huboAviso = await resolverAvisoDeActualizacion(page);
    const enHome = await page.locator('[data-add-product]:visible').count();
    expect(enHome, 'la home tiene que ofrecer productos').toBeGreaterThan(0);

    // 2 · BUSQUEDA
    const buscador = page.locator('[data-search-input]:visible').first();
    await buscador.click();
    await buscador.fill('heineken');
    await page.waitForTimeout(1500);
    const texto = (await page.locator('body').innerText()).toLowerCase();
    expect(texto, 'la busqueda tiene que encontrar Heineken').toContain('heineken');
    await buscador.fill('');
    await page.waitForTimeout(800);

    // 3 · CATEGORIA (en la vista de catalogo, que es donde vive la grilla)
    await page.locator('.mobile-nav [data-nav-view="catalog"]').first().click();
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-product-grid]')).toBeVisible({ timeout: 20_000 });
    const chip = page.locator('[data-category-id]:visible').filter({ hasText: /cerveza/i }).first();
    await chip.click();
    await page.waitForTimeout(1500);
    await expect
      .poll(async () => page.locator('[data-product-grid] [data-add-product]:visible').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    // 4 · PRODUCTO
    const detalle = page.locator('[data-product-detail]:visible').first();
    await tocar(detalle, page);
    await expect(page.locator('[data-product-modal]')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // 5 · CARRITO
    const antes = await contarCarrito(page);
    const agregar = page.locator('[data-add-product]:visible:not([disabled])').first();
    await tocar(agregar, page);
    await expect.poll(() => contarCarrito(page), { timeout: 20_000 }).toBeGreaterThan(antes);
    const conProducto = await contarCarrito(page);

    // El carrito ANTES de recargar tiene que listar lo agregado.
    await page.locator('.mobile-nav [data-nav-view="cart"]').first().click();
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-cart-list]')).toBeVisible({ timeout: 20_000 });
    const items = await page.locator('[data-cart-list] .cart-item').count();
    expect(items, 'el carrito tiene que listar lo agregado').toBeGreaterThan(0);

    // 6 · RELOAD: la app se recupera limpia.
    //
    // NO se afirma que el carrito sobreviva: NO sobrevive, y no es una
    // regresion de esta RC. `js/cart.js` no escribe en localStorage ni en
    // sessionStorage —ni en la version que servia staging (5941279) ni en
    // esta—, asi que el carrito es memoria del documento y una recarga lo
    // vacia. Queda anotado como deuda del producto en el manifest, con esta
    // medicion como evidencia. Lo que si se exige acá es que recargar no
    // rompa nada: catalogo de vuelta, sin errores y sin 4xx.
    await page.reload({ waitUntil: 'load' });
    // La recarga cae en la vista donde estabamos (el carrito): se vuelve a la
    // tienda, que es donde se comprueba que el catalogo volvio entero.
    await page.locator('.mobile-nav [data-nav-view="home"]').first().click();
    await esperarCatalogo(page);
    const trasRecarga = await contarCarrito(page);
    expect(conProducto, 'antes de recargar habia carrito').toBeGreaterThan(0);
    expect(trasRecarga, 'comportamiento medido: la recarga vacia el carrito').toBe(0);

    expect(errores, `errores de JS: ${errores.join(' | ')}`).toEqual([]);
    expect(malas, `respuestas >=400: ${malas.join(' | ')}`).toEqual([]);
    console.log(`aviso de actualizacion presente al entrar: ${huboAviso}`);
  });

  for (const ancho of ANCHOS) {
    test(`a ${ancho} px se lee sin desborde en home, catalogo y carrito`, async ({ page }) => {
      const { errores, malas } = vigilar(page);
      await page.setViewportSize({ width: ancho, height: 844 });
      await page.goto('/', { waitUntil: 'load' });
      await esperarCatalogo(page);
      await sinDesborde(page, 'home');

      await page.locator('.mobile-nav [data-nav-view="catalog"]').first().click();
      await page.waitForTimeout(1200);
      await sinDesborde(page, 'catalogo');

      await page.locator('.mobile-nav [data-nav-view="cart"]').first().click();
      await page.waitForTimeout(1200);
      await sinDesborde(page, 'carrito');

      expect(errores, `errores de JS a ${ancho}: ${errores.join(' | ')}`).toEqual([]);
      expect(malas, `respuestas >=400 a ${ancho}: ${malas.join(' | ')}`).toEqual([]);
    });
  }
});
