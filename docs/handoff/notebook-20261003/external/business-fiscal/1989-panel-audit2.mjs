import { chromium } from '@playwright/test';
import { asegurarSesionPanel, guardarEstado } from '../../scripts/e2e-production-sale/sesiones.mjs';
const OUT='artifacts/weekend-launch'; const raiz=process.cwd();
const nav = await chromium.launch();
const { contexto } = await asegurarSesionPanel({ navegador: nav, raiz, anotar: ()=>{} });
const page = await contexto.newPage();
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto('https://la-taba.pages.dev/', { waitUntil:'domcontentloaded' });
await page.locator('html[data-taba-startup="ready"]').waitFor({state:'attached',timeout:90_000});
await page.evaluate(()=>{location.hash='#business';});
await page.waitForTimeout(7000);
console.log(await page.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n')));
// abrir Horarios y cobertura
const tab = page.locator('button:has-text("Horarios y cobertura")').first();
if (await tab.count()) { await tab.click(); await page.waitForTimeout(3500);
  console.log('\n\n===== HORARIOS Y COBERTURA =====\n');
  console.log(await page.evaluate(()=>document.body.innerText.replace(/\n{2,}/g,'\n').slice(0,4000)));
  await page.screenshot({ path:`${OUT}/panel-horarios-cobertura.png`, fullPage:true });
}
await guardarEstado(contexto, `${raiz}/.local/e2e-auth/business.json`);
await nav.close();
