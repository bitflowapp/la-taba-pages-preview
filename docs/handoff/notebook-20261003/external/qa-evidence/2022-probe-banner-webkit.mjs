import { webkit, devices } from 'playwright';
const U = 'https://taba2-staging.pages.dev/';
const b = await webkit.launch({ headless: true });
const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
await p.goto(U, { waitUntil: 'load', timeout: 60000 });
const leer = () => p.evaluate(() => {
  const el = document.querySelector('[data-app-update-banner]');
  const vis = el && !el.hidden && el.getBoundingClientRect().height > 0;
  return { vis, hidden: el ? el.hidden : null };
});
let aparecio = null;
for (let i = 0; i < 24; i++) {
  const r = await leer();
  if (r.vis && !aparecio) { aparecio = seg(); console.log(`${seg()}  APARECE el aviso`); break; }
  await p.waitForTimeout(2500);
}
if (!aparecio) { console.log('no aparecio en 60 s'); await b.close(); process.exit(0); }
console.log('acepto «Actualizar ahora»...');
await p.locator('[data-app-update-now]').click();
await p.waitForTimeout(6000);
for (let i = 0; i < 16; i++) {
  const r = await leer();
  console.log(`${seg()}  visible=${r.vis}`);
  if (r.vis) { console.log('  >>> VOLVIO a aparecer despues de aceptar'); break; }
  await p.waitForTimeout(2500);
}
const sw = await p.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { waiting: Boolean(reg?.waiting), active: Boolean(reg?.active), controlando: Boolean(navigator.serviceWorker.controller) };
});
console.log('estado SW:', JSON.stringify(sw));
await b.close();
