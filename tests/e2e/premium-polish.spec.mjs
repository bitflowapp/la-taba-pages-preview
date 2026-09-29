/*
 * PULIDO PREMIUM — los cambios de estado se marcan UNA vez y sólo cuando son reales.
 *
 * El DOM se repinta entero, así que estas pruebas no miran píxeles: montan el
 * marcado real de cada superficie (etapa del pedido, tarjeta de la bandeja,
 * total, vacío) sobre la app viva, lo mutan como lo haría un repintado y
 * afirman los atributos/animaciones que produce `js/motion.js`.
 */
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs } from './helpers.mjs';

const frames = (page, n = 3) => page.evaluate(async (count) => {
  for (let i = 0; i < count; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
}, n);

const timelineHtml = (current) => ['Confirmado', 'Preparando', 'En camino', 'Entregado']
  .map((label, i) => `<div class="track-step ${i < current ? 'done' : i === current ? 'current' : 'pending'}" role="listitem"><span class="track-dot"></span><small>${label}</small></div>`)
  .join('');

async function abrir(page, { reducido = false } = {}) {
  if (reducido) await page.emulateMedia({ reducedMotion: 'reduce' });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#home');
  await expect(page.locator('body')).toHaveClass(/motion-ready/);
}

test.describe('premium polish', () => {
  test('la etapa que avanza se marca; la primera lectura y un repintado igual no', async ({ page }) => {
    await abrir(page);
    await page.evaluate((html) => {
      const host = document.createElement('div');
      host.id = 'fx-track';
      host.innerHTML = `<div class="track-steps customer-progress public" role="list">${html}</div>`;
      document.body.append(host);
    }, timelineHtml(1));
    await frames(page);
    await expect(page.locator('#fx-track .track-steps')).not.toHaveAttribute('data-motion-advanced', 'true');

    // Repintado idéntico: no anima.
    await page.evaluate((html) => { document.querySelector('#fx-track').innerHTML = `<div class="track-steps customer-progress public" role="list">${html}</div>`; }, timelineHtml(1));
    await frames(page);
    await expect(page.locator('#fx-track .track-steps')).not.toHaveAttribute('data-motion-advanced', 'true');

    // Avance real: marca y anima el tramo y el punto de la etapa nueva.
    await page.evaluate((html) => { document.querySelector('#fx-track').innerHTML = `<div class="track-steps customer-progress public" role="list">${html}</div>`; }, timelineHtml(2));
    await frames(page);
    const steps = page.locator('#fx-track .track-steps');
    await expect(steps).toHaveAttribute('data-motion-advanced', 'true');
    const nombres = await page.evaluate(() => {
      const actual = document.querySelector('#fx-track .track-step.current');
      return {
        dot: getComputedStyle(actual.querySelector('.track-dot')).animationName,
        tramo: getComputedStyle(actual, '::before').animationName,
      };
    });
    expect(nombres.dot).toBe('taba-track-dot');
    expect(nombres.tramo).toBe('taba-track-connector');
    // Se retira solo, sin loop.
    await expect(steps).not.toHaveAttribute('data-motion-advanced', 'true', { timeout: 3_000 });
  });

  test('un total que cambia se anima una vez; el mismo valor no', async ({ page }) => {
    await abrir(page);
    await page.evaluate(() => {
      const total = document.createElement('strong');
      total.dataset.floatingCartSummary = '';
      total.id = 'fx-total';
      total.textContent = '$1.000';
      total.style.display = 'block';
      document.body.append(total);
    });
    await frames(page);
    const animaciones = () => page.evaluate(() => document.querySelector('#fx-total').getAnimations().length);
    expect(await animaciones()).toBe(0);
    await page.evaluate(() => { document.querySelector('#fx-total').textContent = '$1.000'; });
    await frames(page);
    expect(await animaciones()).toBe(0);
    await page.evaluate(() => { document.querySelector('#fx-total').textContent = '$2.500'; });
    await frames(page, 2);
    expect(await animaciones()).toBeGreaterThan(0);
  });

  test('pedido nuevo: sólo lo reciente y sólo después de la línea de base, y se apaga solo', async ({ page }) => {
    await abrir(page);
    const tarjeta = (id, edadMs) => `<article class="production-order-card" data-order-card="${id}"><time data-elapsed-from="${new Date(Date.now() - edadMs).toISOString()}">hace un rato</time><span class="status-pill submitted" data-order-state="submitted">Nuevo</span></article>`;
    await page.evaluate((html) => {
      const host = document.createElement('div');
      host.id = 'fx-orders';
      host.innerHTML = html;
      document.body.append(host);
    }, tarjeta('base', 5_000));
    await frames(page);
    await expect(page.locator('[data-order-card="base"]')).not.toHaveAttribute('data-motion-arrived', 'true');

    await page.evaluate((html) => {
      document.querySelector('#fx-orders').insertAdjacentHTML('beforeend', html);
    }, tarjeta('viejo', 60 * 60_000) + tarjeta('nuevo', 4_000));
    await frames(page);
    await expect(page.locator('[data-order-card="nuevo"]')).toHaveAttribute('data-motion-arrived', 'true');
    await expect(page.locator('[data-order-card="viejo"]')).not.toHaveAttribute('data-motion-arrived', 'true');
    const animacion = await page.locator('[data-order-card="nuevo"]').evaluate((n) => getComputedStyle(n).animationName);
    expect(animacion).toBe('taba-order-arrival');
    await expect(page.locator('[data-order-card="nuevo"]')).not.toHaveAttribute('data-motion-arrived', 'true', { timeout: 4_000 });
  });

  test('un estado vacío entra una vez y no se repite en cada refresco', async ({ page }) => {
    await abrir(page);
    const vacio = '<div class="empty-state" id="fx-empty"><strong>Sin actividad</strong><p>Nada por acá.</p></div>';
    await page.evaluate((html) => {
      const host = document.createElement('div');
      host.id = 'fx-empty-host';
      host.innerHTML = html;
      document.body.append(host);
    }, vacio);
    await frames(page);
    await expect(page.locator('#fx-empty')).toHaveClass(/motion-empty-enter/);
    await page.evaluate((html) => { document.querySelector('#fx-empty-host').innerHTML = html; }, vacio);
    await frames(page);
    await expect(page.locator('#fx-empty')).not.toHaveClass(/motion-empty-enter/);
  });

  test('el aviso sale en corto y recién después deja el árbol', async ({ page }) => {
    await abrir(page);
    await page.evaluate(async () => {
      const toast = document.querySelector('[data-toast]');
      window.__toastClases = [];
      new MutationObserver(() => window.__toastClases.push(toast.className)).observe(toast, { attributes: true, attributeFilter: ['class'] });
      const { showToast } = await import('/js/ui.js');
      showToast('Listo');
    });
    const toast = page.locator('[data-toast]');
    await expect(toast).toHaveClass(/hidden/, { timeout: 5_000 });
    await expect(toast).not.toHaveClass(/is-leaving/);
    const clases = await page.evaluate(() => window.__toastClases);
    const salida = clases.findIndex((c) => c.includes('is-leaving'));
    const oculto = clases.findIndex((c) => c.includes('hidden') && !c.includes('is-leaving'));
    expect(salida, 'el aviso pasa por is-leaving antes de ocultarse').toBeGreaterThan(-1);
    expect(oculto).toBeGreaterThan(salida);
  });

  test('con movimiento reducido no hay animaciones nuevas y el pedido nuevo queda con borde fijo', async ({ page }) => {
    await abrir(page, { reducido: true });
    await page.evaluate((html) => {
      const host = document.createElement('div');
      host.id = 'fx-mixed';
      host.innerHTML = html;
      document.body.append(host);
    }, `<strong data-floating-cart-summary id="fx-t" style="display:block">$1</strong><article class="production-order-card" data-order-card="a"><time data-elapsed-from="${new Date().toISOString()}">ahora</time></article><div class="track-steps customer-progress" role="list">${timelineHtml(0)}</div>`);
    await frames(page);
    await page.evaluate((html) => {
      document.querySelector('#fx-t').textContent = '$2';
      const track = document.querySelector('#fx-mixed .track-steps');
      track.innerHTML = html;
      document.querySelector('#fx-mixed').insertAdjacentHTML('beforeend', `<article class="production-order-card" data-order-card="b"><time data-elapsed-from="${new Date().toISOString()}">ahora</time></article>`);
    }, timelineHtml(1));
    await frames(page);
    expect(await page.evaluate(() => document.querySelector('#fx-t').getAnimations().length)).toBe(0);
    await expect(page.locator('#fx-mixed .track-steps')).not.toHaveAttribute('data-motion-advanced', 'true');
    const card = page.locator('[data-order-card="b"]');
    await expect(card).toHaveAttribute('data-motion-arrived', 'true');
    const estilo = await card.evaluate((n) => ({ animacion: getComputedStyle(n).animationName, sombra: getComputedStyle(n).boxShadow }));
    expect(estilo.animacion).toBe('none');
    expect(estilo.sombra).not.toBe('none');
    const infinitas = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity).length);
    expect(infinitas).toBe(0);
  });
});
