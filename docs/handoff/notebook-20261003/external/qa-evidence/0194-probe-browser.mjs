import {chromium,webkit} from 'file:///D:/1212/la-taba-commerce-v3/node_modules/playwright/index.mjs';
const deadline=setTimeout(()=>process.exit(3),55000);
const engine=process.argv[2]||'chromium';let browser;const start=Date.now();
try {
 browser=await (engine==='webkit'?webkit:chromium).launch({timeout:20000,...(engine==='full'?{channel:'chromium'}:{})});console.log('LAUNCH',engine,Date.now()-start);
 const page=await Promise.race([browser.newPage(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('context stalled')),20000))]);console.log('CONTEXT',Date.now()-start);
 await page.goto('data:text/html,<h1>Browser ready</h1>');console.log(await page.locator('h1').innerText());
}catch(error){console.log('ERROR',engine,error.message)}finally{await Promise.race([browser?.close(),new Promise(r=>setTimeout(r,3000))]);clearTimeout(deadline);process.exit(0);}
