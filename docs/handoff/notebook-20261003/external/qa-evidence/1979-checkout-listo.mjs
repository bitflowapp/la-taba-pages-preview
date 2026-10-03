/* El checkout con un perfil COMPLETO. Llega hasta el borde y NO confirma. */
import { chromium, webkit } from '@playwright/test';
import { contextoCliente, guardarEstado } from '../../scripts/e2e-production-sale/sesiones.mjs';
const OUT='artifacts/weekend-launch'; const raiz=process.cwd();
const MOTOR = process.env.TABA_MOTOR || 'chromium';
const motor = MOTOR==='webkit' ? webkit : chromium;
const nav = await motor.launch();
const ctx = await contextoCliente(nav, { estado: `${raiz}/.local/e2e-auth/customer.json` });
await ctx.addInitScript(()=>{});
const page = await ctx.newPage();
await page.setViewportSize({ width: 390, height: 844 });
const errores=[]; page.on('pageerror',e=>errores.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')errores.push('console: '+m.text().slice(0,180));});
const red=[]; page.on('response',r=>{if(r.status()>=400) red.push(`${r.status()} ${r.request().method()} ${r.url().split('/').slice(-2).join('/').slice(0,80)}`);});

await page.goto('https://la-taba.pages.dev/', { waitUntil:'domcontentloaded' });
await page.locator('html[data-taba-startup="ready"]').waitFor({state:'attached',timeout:90_000});
await page.waitForTimeout(3000);
await page.locator('[data-add-product] >> visible=true').first().click();
await page.waitForTimeout(1200);
await page.locator('[data-open-cart] >> visible=true').first().click();
await page.waitForTimeout(3000);

// elegir la dirección si hace falta
const dir = page.locator('[data-customer-address-id] >> visible=true').first();
if (await dir.count()) { await dir.click(); await page.waitForTimeout(1800); }

const estado = await page.evaluate(()=>{
  const vis=(el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
  const submit=document.querySelector('[data-checkout-submit]');
  const aviso=document.querySelector('[data-checkout-warning]');
  return {
    resumen:(document.querySelector('[data-order-summary]')?.textContent||'').replace(/\s+/g,' ').trim(),
    submit: submit?{txt:submit.textContent.trim(),disabled:submit.disabled,visible:vis(submit)}:null,
    aviso: aviso&&vis(aviso)?aviso.textContent.trim():null,
    bloqueosVisibles: [...document.querySelectorAll('[data-profile-checkout-action]')].filter(vis).map(e=>e.textContent.trim()),
    texto: document.body.innerText.replace(/\n{2,}/g,'\n'),
  };
});
console.log(JSON.stringify({ resumen: estado.resumen, submit: estado.submit, aviso: estado.aviso, bloqueos: estado.bloqueosVisibles }, null, 1));
console.log('\n===== TEXTO DEL CHECKOUT =====\n' + estado.texto);
await page.screenshot({ path:`${OUT}/checkout-listo-${MOTOR}.png`, fullPage:true });
console.error('ERRORES: '+JSON.stringify([...new Set(errores)].slice(0,6)));
console.error('RED>=400: '+JSON.stringify([...new Set(red)].slice(0,6)));
await guardarEstado(ctx, `${raiz}/.local/e2e-auth/customer.json`);
await nav.close();
