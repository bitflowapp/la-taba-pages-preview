/* Segunda parte: qué exige el checkout. NO confirma nada. */
import { chromium, webkit } from '@playwright/test';
const BASE = process.env.TABA_BASE || 'https://la-taba.pages.dev';
const OUT = process.env.TABA_OUT || 'artifacts/weekend-launch';
const MOTOR = process.env.TABA_MOTOR || 'chromium';
const { mkdirSync } = await import('node:fs'); mkdirSync(OUT, { recursive: true });
const motor = MOTOR === 'webkit' ? webkit : chromium;
const browser = await motor.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'allow', locale: 'es-AR',
  userAgent: MOTOR === 'chromium' ? 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' : undefined });
const page = await ctx.newPage();
const errores = []; page.on('pageerror', e=>errores.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errores.push('console: '+m.text().slice(0,200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state:'attached', timeout: 90_000 });
await page.waitForTimeout(2500);
await page.locator('[data-add-product] >> visible=true').first().click();
await page.waitForTimeout(1000);
await page.locator('[data-open-cart] >> visible=true').first().click();
await page.waitForTimeout(1800);

// Volcado completo del carrito/checkout: campos, estado del submit, resumen
const volcado = await page.evaluate(() => {
  const vis = (el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
  const y=(el)=>Math.round(el.getBoundingClientRect().top+window.scrollY);
  const campos = [...document.querySelectorAll('input, select, textarea')].filter(vis).map(e=>({
    tipo:e.tagName.toLowerCase()+':'+(e.type||''), name:e.name||e.getAttribute('data-field')||'', required:e.required,
    label:(e.closest('label')?.textContent||e.getAttribute('aria-label')||e.placeholder||'').trim().replace(/\s+/g,' ').slice(0,60),
    valor: e.type==='checkbox'||e.type==='radio' ? String(e.checked) : String(e.value).slice(0,40), y:y(e),
  }));
  const submit = document.querySelector('[data-checkout-submit]');
  const resumen = document.querySelector('[data-order-summary]');
  const aviso = document.querySelector('[data-checkout-warning]');
  const bloques = [...document.querySelectorAll('h1,h2,h3,h4,strong')].filter(vis).map(h=>({t:h.tagName,txt:(h.textContent||'').trim().replace(/\s+/g,' ').slice(0,70),y:y(h)}));
  // hueco vertical grande en el carrito
  return {
    campos, bloques,
    submit: submit ? { txt:(submit.textContent||'').trim(), disabled: submit.disabled, visible: vis(submit), y: y(submit) } : null,
    resumen: resumen ? (resumen.textContent||'').trim().replace(/\s+/g,' ') : null,
    aviso: aviso && vis(aviso) ? (aviso.textContent||'').trim() : null,
    alturaDoc: document.documentElement.scrollHeight,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth+1,
  };
});
console.log(JSON.stringify(volcado, null, 1));
await page.screenshot({ path: `${OUT}/carrito-completo-${MOTOR}.png`, fullPage: true });
console.error('ERRORES: '+JSON.stringify([...new Set(errores)].slice(0,6)));
await browser.close();
