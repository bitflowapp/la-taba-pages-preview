// Certificación final de los contratos observables en la URL PÚBLICA, por el
// camino que recorre una persona. No confirma ningún pedido.
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = process.env.TABA_REPO;
const requireDelRepo = createRequire(path.join(REPO, 'package.json'));
const { chromium, devices } = requireDelRepo('@playwright/test');
const SITIO = process.env.TABA_SITIO || 'https://taba2-staging.pages.dev';
const SALIDA = process.env.TABA_SALIDA;

const r = [];
const check = (n, ok, d = '') => { r.push({ n, ok, d }); console.log(`${ok ? 'OK  ' : 'FALLA'} ${n}${d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'allow' });
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e)));

await page.goto(`${SITIO}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(10000);

// ── la góndola tal como la ve una persona ────────────────────────────────────
const gondola = await page.evaluate(() => {
  const texto = (document.body.innerText || '').replace(/\s+/g, ' ');
  // Cada tarjeta: nombre, si dice precio pendiente, y si ofrece agregar.
  const tarjetas = [...document.querySelectorAll('article, .product-card, [data-product-id]')].map((c) => {
    const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      pendiente: /Precio próximamente/i.test(t),
      tieneAgregar: Boolean([...c.querySelectorAll('button')].find((b) => /agregar|^\+$/i.test((b.textContent || '').trim()))),
      diceCero: /\$\s*0(?!\d)/.test(t),
      nombre: t.slice(0, 46),
    };
  }).filter((c) => c.nombre);
  return { texto: texto.slice(0, 1500), tarjetas };
});

const pendientes = gondola.tarjetas.filter((t) => t.pendiente);
const conPrecio = gondola.tarjetas.filter((t) => !t.pendiente);

check('1 · hay productos con precio pendiente en la góndola REAL',
  pendientes.length > 0, `${pendientes.length} pendientes de ${gondola.tarjetas.length} tarjetas`);
check('1b · y ninguno se escribe como «$ 0»',
  gondola.tarjetas.every((t) => !t.diceCero) && !/\$\s*0(?!\d)/.test(gondola.texto),
  'dicen «Precio próximamente»');
check('2/3 · ningún producto pendiente ofrece agregar al carrito',
  pendientes.every((t) => !t.tieneAgregar),
  pendientes.map((t) => t.nombre.slice(0, 24)).join(' · ') || '—');
check('2b · y los que sí tienen precio sí lo ofrecen',
  conPrecio.some((t) => t.tieneAgregar), `${conPrecio.filter((t) => t.tieneAgregar).length} comprables`);

// ── 4 · el orden no pone los pendientes primero ──────────────────────────────
const orden = gondola.tarjetas.map((t) => (t.pendiente ? 'P' : 'c')).join('');
const primerPendiente = orden.indexOf('P');
const ultimoConPrecio = orden.lastIndexOf('c');
check('4 · los pendientes no encabezan la góndola',
  primerPendiente === -1 || primerPendiente > 0, `orden: ${orden}`);

// ── 5 · combos ───────────────────────────────────────────────────────────────
const combo = await page.evaluate(() => {
  const t = (document.body.innerText || '').replace(/\s+/g, ' ');
  return { anunciaAhorro: /Ahorrás\s*\$\s*[\d.]+/.test(t), ahorroCero: /Ahorrás\s*\$\s*0(?!\d)/.test(t) };
});
check('5 · si un combo anuncia ahorro, es un número real', combo.anunciaAhorro && !combo.ahorroCero);

// ── 6 · nada de QA ───────────────────────────────────────────────────────────
check('6 · ningún producto de prueba en la góndola pública',
  !/QA[- ]?TEST|Bebida QA|STAGING[- ]ONLY/i.test(gondola.texto));

// ── el carrito y el pedido ───────────────────────────────────────────────────
await page.evaluate(() => {
  const bs = [...document.querySelectorAll('button')].filter((b) => /agregar/i.test(b.textContent || ''));
  if (bs[0]) bs[0].click();
});
await page.waitForTimeout(3000);
const pedido = await page.evaluate(() => {
  const t = (document.body.innerText || '').replace(/\s+/g, ' ');
  const m = t.match(/Mi pedido\s*\$\s*([\d.]+)/i);
  return { total: m ? m[1] : null, cero: /Mi pedido\s*\$\s*0(?!\d)/.test(t) };
});
check('10 · el carrito suma un producto real y muestra un total',
  pedido.total !== null && !pedido.cero, `Mi pedido $ ${pedido.total}`);

// abrir el pedido por el CTA que realmente existe
const abrio = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button, a')].find((x) => /Mi pedido/i.test(x.textContent || ''));
  if (!b) return false; b.click(); return true;
});
await page.waitForTimeout(7000);
const panel = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
check('10b · el pedido abre su pantalla', abrio && /pedido|entrega|retiro|env[ií]o/i.test(panel));
check('8 · y esa pantalla exige dónde entregar',
  /direcci[oó]n|ubicaci[oó]n|Elegí tu dirección|retiro/i.test(panel));
check('7 · en ningún momento se pidió ciudad ni provincia',
  !/\bCiudad\b\s*\*?\s*$|Provincia|C[oó]digo postal/i.test(panel),
  'sin campos de ciudad/provincia/CP');
await page.screenshot({ path: path.join(SALIDA, 'pedido-publico-v55.png') });

// ── 9 · la ubicación elegida sobrevive a la recarga ──────────────────────────
const antes = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const m = t.match(/ENVIAR A\s*([^\n›]{0,60})/i);
  return m ? m[1].trim() : null;
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);
const despues = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const m = t.match(/ENVIAR A\s*([^\n›]{0,60})/i);
  return m ? m[1].trim() : null;
});
check('9 · el chip «Enviar a» dice lo mismo después de recargar',
  antes !== null && antes === despues, `«${antes}» → «${despues}»`);

check('sin errores de página en todo el recorrido',
  errores.length === 0, errores.slice(0, 2).join(' | ') || 'ninguno');

await context.close();
await browser.close();

console.log('');
const malos = r.filter((x) => !x.ok);
console.log(`${r.length - malos.length}/${r.length} OK`);
if (malos.length) { for (const m of malos) console.log(`  - ${m.n}: ${m.d}`); process.exitCode = 1; }
