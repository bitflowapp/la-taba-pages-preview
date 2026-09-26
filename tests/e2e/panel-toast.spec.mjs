/*
 * EL AVISO DEL PANEL SE LEE Y NO TAPA LA NAVEGACIÓN.
 *
 * Medido el 2026-09-25 en el Panel productivo a 390x844 (Chromium y WebKit):
 * el aviso efímero era texto blanco sobre gris claro —la tinta del tema oscuro
 * usada como fondo— y se apoyaba encima de la barra inferior (Pedidos · Qué
 * pasa · Pagos · Mostrador · Más). Se prueba con el nodo real del aviso y el
 * mismo `showToast` que usa la aplicación.
 */
import { expect, test } from '@playwright/test';

import { instalarDatosDePrueba } from '../../scripts/lib/business-panel-fixtures.mjs';

function luminancia([r, g, b]) {
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const rgb = (valor) => (String(valor).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1366, height: 768 }]) {
  test(`el aviso del Panel a ${viewport.width}px se lee y no tapa la barra de abajo`, async ({ browser }) => {
    const telefono = viewport.width <= 500;
    const context = await browser.newContext({ viewport, hasTouch: telefono, isMobile: telefono });
    const page = await context.newPage();
    await instalarDatosDePrueba(page);
    await page.goto('/#business');
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });

    await page.evaluate(async () => {
      const { showToast } = await import('/js/ui.js');
      showToast('Pedido LT-2044 aceptado. El cliente ya fue avisado por WhatsApp.');
    });
    const aviso = page.locator('[data-toast]');
    await expect(aviso).toBeVisible();

    const medida = await page.evaluate(() => {
      const toast = document.querySelector('[data-toast]');
      const estilo = getComputedStyle(toast);
      const caja = toast.getBoundingClientRect();
      const barra = document.querySelector('[data-panel-bottom-nav]');
      const cajaBarra = barra && getComputedStyle(barra).display !== 'none' ? barra.getBoundingClientRect() : null;
      return {
        fondo: estilo.backgroundColor,
        tinta: estilo.color,
        abajo: caja.bottom,
        barraArriba: cajaBarra ? cajaBarra.top : null,
        alto: window.innerHeight,
      };
    });

    expect(contraste(rgb(medida.tinta), rgb(medida.fondo)), `tinta ${medida.tinta} sobre ${medida.fondo}`)
      .toBeGreaterThanOrEqual(4.5);
    expect(medida.abajo).toBeLessThanOrEqual(medida.alto);
    if (telefono) {
      expect(medida.barraArriba, 'en teléfono el Panel tiene barra inferior').not.toBeNull();
      expect(medida.abajo, 'el aviso cae encima de la barra inferior').toBeLessThanOrEqual(medida.barraArriba);
    }
    await context.close();
  });
}
