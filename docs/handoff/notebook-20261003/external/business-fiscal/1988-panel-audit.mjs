/* Abre el Panel del negocio como lo abre el comercio y describe lo que ve.
 * Sólo lectura: no acepta, no cancela, no cambia estados. */
import { chromium } from '@playwright/test';
import { asegurarSesionPanel, guardarEstado } from '../../scripts/e2e-production-sale/sesiones.mjs';

const OUT = 'artifacts/weekend-launch';
const { mkdirSync } = await import('node:fs'); mkdirSync(OUT, { recursive: true });
const raiz = process.cwd();
const navegador = await chromium.launch();
const anotar = (t) => console.error('· ' + t);

const { contexto } = await asegurarSesionPanel({ navegador, raiz, anotar });
const page = await contexto.newPage();
const errores = [];
page.on('pageerror', e=>errores.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errores.push('console: '+m.text().slice(0,200)); });

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto('https://la-taba.pages.dev/', { waitUntil: 'domcontentloaded' });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state:'attached', timeout: 90_000 });
await page.evaluate(()=>{ location.hash = '#business'; });
await page.waitForTimeout(7000);

const vista = await page.evaluate(() => {
  const vis = (el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
  const secciones = [...document.querySelectorAll('h1,h2,h3')].filter(vis).map(h=>(h.textContent||'').trim().replace(/\s+/g,' ').slice(0,70));
  const pedidos = [...document.querySelectorAll('[data-production-business-next], [data-business-order], .order-card')].filter(vis)
    .map(e=>(e.textContent||'').trim().replace(/\s+/g,' ').slice(0,200));
  const tabs = [...document.querySelectorAll('[role=tab], nav button, [data-business-tab], [data-panel-tab]')].filter(vis).map(e=>(e.textContent||'').trim().slice(0,30));
  const alertas = [...document.querySelectorAll('[data-operational-alert], .alert-card, [data-alert]')].filter(vis).map(e=>(e.textContent||'').trim().replace(/\s+/g,' ').slice(0,160));
  return { secciones, pedidos, tabs: [...new Set(tabs)], alertas, hash: location.hash,
    texto: document.body.innerText.replace(/\s+/g,' ').slice(0, 3000) };
});
console.log(JSON.stringify(vista, null, 1));
await page.screenshot({ path: `${OUT}/panel-negocio.png`, fullPage: true });
console.error('ERRORES: '+JSON.stringify([...new Set(errores)].slice(0,8)));
await guardarEstado(contexto, `${raiz}/.local/e2e-auth/business.json`);
await navegador.close();
