import { chromium } from 'file:///C:/1212/la-taba-commerce-v3/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
await page.addInitScript(()=>localStorage.setItem('TABA_INSTALL_PROMPT_V1',JSON.stringify({v:1,decision:'declined'})));
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:18210/?demo=1#home',{waitUntil:'domcontentloaded'});
await page.locator('html[data-taba-startup="ready"]').waitFor({timeout:60000});
await page.screenshot({path:'C:/1212/artifacts/taba-commerce-v3/baseline/home-390.png',fullPage:true});
console.log(await page.locator('body').innerText());
console.log(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,products:document.querySelectorAll('.home-best-card').length})));
await browser.close();


