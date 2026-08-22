/*
 * READ-ONLY: qué secciones dibuja la home, en qué orden, cuáles quedan vacías
 * y qué producto abre cada una. Sin login, sin carrito, sin escrituras.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const HOST = process.env.TABA_HOST || 'https://la-taba.pages.dev';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle', timeout: 90000 });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60000 });
await page.waitForTimeout(3500);

const secciones = await page.evaluate(() => {
  const salida = [];
  for (const seccion of document.querySelectorAll('[data-view="home"] section')) {
    const titulo = seccion.querySelector('h2, h3, .section-head strong')?.textContent?.trim() || '(sin título)';
    const caja = seccion.getBoundingClientRect();
    const visible = !seccion.hidden && caja.height > 0 && getComputedStyle(seccion).display !== 'none';
    const tarjetas = [...seccion.querySelectorAll('article, .thumb-card, [data-product-detail]')].length;
    const nombres = [...seccion.querySelectorAll('h3, h4, .card-title, .thumb-title')]
      .map((n) => n.textContent.trim())
      .filter((x) => x && x !== titulo)
      .slice(0, 8);
    salida.push({ titulo, visible, alto: Math.round(caja.height), top: Math.round(caja.top + window.scrollY), tarjetas, nombres });
  }
  return salida;
});

// Qué entra en el primer pliegue (844 px) y en la primera pantalla larga.
const pliegue = secciones.filter((s) => s.visible && s.top < 844).map((s) => s.titulo);
writeFileSync('artifacts/taba2-go-live-audit/sonda-home-secciones.json', `${JSON.stringify({ host: HOST, secciones, pliegue }, null, 2)}\n`);
for (const s of secciones) {
  console.log(`${s.visible ? 'VISIBLE' : 'OCULTA '} top=${String(s.top).padStart(5)} h=${String(s.alto).padStart(4)} tarjetas=${String(s.tarjetas).padStart(2)}  ${s.titulo}${s.nombres.length ? `  ->  ${s.nombres.join(' / ')}` : ''}`);
}
console.log(`\nsobre el pliegue (844px): ${pliegue.join(' · ') || 'ninguna sección completa'}`);
await browser.close();
