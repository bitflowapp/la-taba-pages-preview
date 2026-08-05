import { expect, test } from '@playwright/test';
import { installQaPanelFixtures } from '../synthetic/panel-browser-fixtures.mjs';

// Anchos reales de los teléfonos del mostrador, del más angosto al más ancho.
const WIDTHS = [320, 360, 390, 412, 432];
const SCREENS = [
  ['day-open', 'Abrir el negocio'],
  ['devices', 'Probar dispositivos'],
];

// Títulos que la certificación anterior encontró partidos al medio.
const TITLES_THAT_MUST_NOT_BREAK = ['Impresoras', 'Facturación'];

for (const width of WIDTHS) {
  test(`panel a ${width} px: encabezados sin cortes arbitrarios, sin overflow y con targets usables`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await installQaPanelFixtures(page);
    await page.goto('/#business');
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });

    for (const [view, heading] of SCREENS) {
      await page.locator(`[data-business-ops-view="${view}"]`).first().click();
      await page.locator(`[data-business-ops-center="${view}"]`).waitFor({ state: 'visible', timeout: 15_000 });
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();

      const report = await page.evaluate(() => {
        const headers = [...document.querySelectorAll('.device-row header, .opening-check header')];
        const brokenWords = [];
        const titles = [];
        const statuses = [];

        for (const header of headers) {
          const strong = header.querySelector('strong');
          const status = header.querySelector('span');
          if (!strong) continue;
          titles.push(strong.textContent.trim());
          if (status) {
            statuses.push({
              text: status.textContent.trim(),
              width: status.getBoundingClientRect().width,
              clipped: status.scrollWidth > status.clientWidth + 1,
            });
          }
          // Una palabra que ocupa más de un rectángulo de línea se partió al medio.
          for (const node of strong.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            let offset = 0;
            for (const piece of node.textContent.split(/(\s+)/)) {
              if (piece.trim()) {
                const range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + piece.length);
                if (range.getClientRects().length > 1) brokenWords.push(piece);
              }
              offset += piece.length;
            }
          }
        }

        const smallTargets = [...document.querySelectorAll('[data-business-ops-center] button')]
          .filter((button) => !button.disabled && button.offsetParent !== null)
          .map((button) => ({ text: button.textContent.trim().slice(0, 40), height: Math.round(button.getBoundingClientRect().height) }))
          .filter((entry) => entry.height < 44);

        return {
          headerCount: headers.length,
          brokenWords,
          titles,
          statuses,
          smallTargets,
          flexWrap: headers.length ? getComputedStyle(headers[0]).flexWrap : '',
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          confirmButtons: [...document.querySelectorAll('[data-device-confirm]')].map((button) => button.textContent.trim()),
        };
      });

      expect(report.headerCount, `${view} debería renderizar tarjetas con encabezado`).toBeGreaterThan(0);
      expect(report.brokenWords, `${view} a ${width} px partió palabras al medio`).toEqual([]);
      expect(report.flexWrap, 'el encabezado tiene que poder envolver').toBe('wrap');

      // Cada etiqueta de estado se lee entera, no recortada.
      for (const status of report.statuses) {
        expect(status.text.length, 'la etiqueta de estado no puede quedar vacía').toBeGreaterThan(0);
        expect(status.width, `la etiqueta "${status.text}" quedó sin ancho`).toBeGreaterThan(0);
        expect(status.clipped, `la etiqueta "${status.text}" quedó recortada`).toBe(false);
      }

      expect(report.documentWidth, `${view} a ${width} px desborda horizontalmente`)
        .toBeLessThanOrEqual(report.viewportWidth);
      expect(report.smallTargets, `${view} a ${width} px tiene controles por debajo de 44 px`).toEqual([]);

      if (view === 'day-open') {
        for (const title of TITLES_THAT_MUST_NOT_BREAK) {
          if (report.titles.includes(title)) {
            expect(report.brokenWords).not.toContain(title.slice(0, -1));
          }
        }
        expect(report.titles).toContain('Impresoras');
        expect(report.titles).toContain('Facturación');
      }

      if (view === 'devices') {
        expect(report.confirmButtons).toEqual([
          'Salió el papel de la térmica',
          'Salió el papel de la A4',
        ]);
      }
    }

    await context.close();
  });
}
