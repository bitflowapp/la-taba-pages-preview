// Lo que ve un cliente cuando la tienda no arranca.
//
// El panel de recuperación era la única pantalla que podía quedar entre una
// persona y el negocio, y era la peor de todas: nacía VISIBLE en el shell
// servido —así que en un teléfono lento la primera pantalla de la tienda era un
// cartel de error que después desaparecía solo—, mostraba el código interno
// `TABA2-BOOT-01`, hablaba de "tus datos de prueba" a clientes reales y estaba
// pintado con la tinta clara del shell sobre una tarjeta casi blanca.
//
// Estas pruebas fijan las cuatro cosas.
import { expect, test } from '@playwright/test';

const CODIGO_TECNICO = /TABA2?-BOOT-\d+|BOOT-\d+/;

async function romperElModulo(page, { status = 503 } = {}) {
  await page.route('**/js/app.js*', (route) => route.fulfill({
    status,
    contentType: 'text/javascript',
    body: '/* no disponible */',
  }));
}

test('en una carga normal el cartel de error nunca aparece', async ({ page }) => {
  const recovery = page.locator('[data-app-recovery]');
  const vistoAlgunaVez = [];
  page.on('domcontentloaded', async () => {
    vistoAlgunaVez.push(await recovery.isVisible().catch(() => false));
  });

  await page.goto('/?demo=1#home');
  // El panel arranca oculto en el HTML servido, así que no hay un instante —por
  // lento que sea el teléfono— en el que la tienda se presente como rota.
  await expect(recovery).toBeHidden();
  await expect(page.locator('[data-view="home"] .home-best-card').first()).toBeVisible();
  await expect(recovery).toBeHidden();
  expect(vistoAlgunaVez.every((visible) => visible === false)).toBe(true);
});

test('con el módulo caído el cliente lee qué hacer, no un código interno', async ({ page }) => {
  const errores = [];
  page.on('console', (message) => { if (message.type() === 'error') errores.push(message.text()); });
  await romperElModulo(page);
  await page.goto('/#home');

  const recovery = page.locator('[data-app-recovery]');
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('No pudimos abrir la tienda');
  await expect(recovery).toContainText('Probá de nuevo');
  await expect(recovery).not.toContainText(CODIGO_TECNICO);
  // Sin ?demo=1 no hay "prueba" de la que hablar: es un cliente real. Se mira
  // lo que se PINTA, no el DOM: el botón de reiniciar la demo existe oculto.
  expect(await recovery.innerText()).not.toMatch(/prueba/i);
  await expect(page.locator('[data-app-recovery-reset]')).toBeHidden();
  await expect(page.locator('[data-app-recovery-retry]')).toBeVisible();

  // El diagnóstico sigue existiendo, en el atributo.
  await expect(recovery).toHaveAttribute('data-app-recovery-code', 'TABA2-BOOT-01');
});

test('nada del shell caído deja HTML crudo ni superficie en blanco', async ({ page }) => {
  await romperElModulo(page);
  await page.goto('/?demo=1#home');
  await expect(page.locator('[data-app-recovery]')).toBeVisible();

  const texto = await page.locator('body').innerText();
  expect(texto).not.toMatch(/<[a-z/][^>]*>/i);
  expect(texto).not.toMatch(CODIGO_TECNICO);
  expect(texto).not.toMatch(/undefined|\[object Object\]|NaN/);
  expect(texto.trim().length).toBeGreaterThan(20);
});

test('el panel de recuperación se lee: contraste AA sobre su propia superficie', async ({ page }) => {
  await romperElModulo(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1#home');
  await expect(page.locator('[data-app-recovery]')).toBeVisible();

  const hallazgos = await page.evaluate(() => {
    const parse = (value) => {
      const parts = String(value).match(/[\d.]+/g);
      if (!parts) return null;
      const [r, g, b, a = '1'] = parts.map(Number);
      return { r, g, b, a: Number(a) };
    };
    const lum = ({ r, g, b }) => {
      const ch = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (a, b) => {
      const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
      return (hi + 0.05) / (lo + 0.05);
    };
    const bgOf = (node) => {
      for (let cursor = node; cursor; cursor = cursor.parentElement) {
        const value = parse(getComputedStyle(cursor).backgroundColor);
        if (value && value.a >= 0.92) return value;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const panel = document.querySelector('[data-app-recovery]');
    const malos = [];
    panel.querySelectorAll('*').forEach((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 1 || rect.height < 1) return;
      const tieneTexto = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      if (!tieneTexto) return;
      const size = parseFloat(style.fontSize);
      const grande = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const minimo = grande ? 3 : 4.5;
      const obtenido = ratio(parse(style.color), bgOf(element));
      if (obtenido < minimo) {
        malos.push(`${element.tagName.toLowerCase()} "${element.textContent.trim().slice(0, 28)}" ${obtenido.toFixed(2)}:1 < ${minimo}`);
      }
    });
    return malos;
  });

  expect(hallazgos).toEqual([]);

  // Los dos botones son alcanzables con el pulgar.
  for (const selector of ['[data-app-recovery-retry]', '[data-app-recovery-reset]']) {
    const caja = await page.locator(selector).boundingBox();
    expect(caja.height, selector).toBeGreaterThanOrEqual(44);
  }
});
