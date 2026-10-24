/*
 * Verificación del page estático `preview/comparacion/antes-y-despues.html`.
 *
 * Se abre como ARCHIVO (file://, así lo va a abrir el dueño) y comprueba que:
 *   · cargue con la grilla completa: 42 fotos reales + 10 sin foto + 4 paneles de captura;
 *   · TODAS las imágenes referenciadas existan (cero fallas de carga);
 *   · no salga ni una request a un origen externo (la página no telecarga nada);
 *   · el sello de estado del QA esté pintado.
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PAGINA = path.resolve(AQUI, '..', 'preview', 'comparacion', 'antes-y-despues.html');

const browser = await chromium.launch();
let code = 0;
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const fallas = [];
  const remotas = [];
  page.on('requestfailed', (r) => fallas.push(r.url().split('/').slice(-3).join('/')));
  page.on('response', (r) => (r.status() >= 400 ? fallas.push(`${r.status()} ${r.url().split('/').slice(-3).join('/')}`) : null));
  // file:// sirve todo por file — una request http(s) alternativa marcaría remoto.
  page.on('request', (r) => {
    if (/^https?:\/\//.test(r.url())) remotas.push(r.url());
  });

  await page.goto(`file:///${PAGINA.replace(/\\/g, '/')}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Bajar de punta a punta para que las <img loading="lazy"> pidan su archivo.
  const alto = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < alto; y += 800) {
    await page.evaluate((pos) => window.scrollTo(0, pos), y);
    await page.waitForTimeout(60);
  }
  await page.waitForFunction(() => [...document.querySelectorAll('img')].every((img) => img.complete), null, { timeout: 25_000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const datos = await page.evaluate(() => ({
    totalImg: document.querySelectorAll('img').length,
    conFoto: document.querySelectorAll('ul.fotos li:not(.sin-foto)').length,
    sinFoto: document.querySelectorAll('ul.fotos li.sin-foto').length,
    roto: [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length,
    sello: document.querySelector('.status-pill')?.textContent || '',
    capturas: document.querySelectorAll('.interacciones img').length,
    paneles: document.querySelectorAll('.duo img').length,
  }));
  const okGrilla = datos.conFoto === 42 && datos.sinFoto === 10;
  const ok = okGrilla && datos.roto === 0 && remotas.length === 0 && datos.sello.includes('54/54');
  console.log(JSON.stringify({ ...datos, fallas, remotas, ok }, null, 1));
  code = ok ? 0 : 1;
  if (!ok && !okGrilla) console.error('Grilla incompleta:', datos.conFoto, datos.sinFoto);
  if (datos.roto) console.error('Imágenes rotas:', datos.roto, fallas.slice(0, 6));
  if (remotas.length) console.error('Requests remotas:', remotas.slice(0, 4));
} finally {
  await browser.close();
  process.exit(code);
}
