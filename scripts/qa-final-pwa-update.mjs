import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices, expect } from '@playwright/test';
import sharp from 'sharp';
import { skipInstallInvitation } from '../tests/e2e/helpers.mjs';

const candidate=process.cwd();
const baseline=path.resolve(process.argv[2]||'../la-taba-final-baseline-20261007');
const root=path.resolve('artifacts/la-taba-final-integration-20261007/pwa');fs.mkdirSync(root,{recursive:true});
const oldIdentity=JSON.parse(fs.readFileSync(path.join(baseline,'release-identity.json'),'utf8'));
const newIdentity=JSON.parse(fs.readFileSync('release-identity.json','utf8'));
const assetBlock=fs.readFileSync('sw.js','utf8').match(/const ASSETS = \[([\s\S]*?)\];/)[1];
const expectedAssets=[...assetBlock.matchAll(/['"](\.\/[^'"]*)['"]/g)].map(match=>match[1]);
const port=Number(process.env.TABA_FINAL_PWA_PORT||18267),url=`http://127.0.0.1:${port}`;
let phase='baseline';const requests=[];
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,url).pathname);
  const tree=phase==='baseline'?baseline:candidate;
  const file=path.resolve(tree,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(tree+path.sep)){res.writeHead(403);res.end();return;}
  requests.push({phase,path:req.url});
  try{const body=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}
  catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const results=[];
async function snapshot(page,engine,name){await sharp(await page.screenshot()).webp({quality:88}).toFile(path.join(root,`${engine}-${name}.webp`));}
async function inventory(page){return page.evaluate(async()=>{
  const names=await caches.keys(),inventories=[];
  for(const name of names){const cache=await caches.open(name);inventories.push({name,assets:(await cache.keys()).map(r=>new URL(r.url).pathname+new URL(r.url).search)});}
  const registration=await navigator.serviceWorker.getRegistration();
  return {caches:inventories,controlled:!!navigator.serviceWorker.controller,waiting:!!registration?.waiting};
});}
try{
  for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
    phase='baseline';const browser=await type.launch();let context;
    const report={engine,from:oldIdentity.cacheName,to:newIdentity.cacheName,status:'RUNNING'};
    try{
      context=await browser.newContext({...devices[engine==='webkit'?'iPhone 13':'Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1,serviceWorkers:'allow'});
      // The scenario is local demo only; external requests never reach an account.
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
      const page=await context.newPage();await skipInstallInvitation(page);
      await page.goto(`${url}/?demo=1#catalog`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      await page.waitForFunction(async name=>navigator.serviceWorker.controller&&(await caches.keys()).includes(name),oldIdentity.cacheName,{timeout:40000});
      report.before=await inventory(page);await snapshot(page,engine,'before');
      phase='candidate';
      await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
      await expect(page.locator('[data-app-update-banner]')).toBeVisible({timeout:40000});
      report.waiting=await inventory(page);
      expect(report.waiting.waiting).toBe(true);
      expect(report.waiting.caches.some(c=>c.name===oldIdentity.cacheName)).toBe(true);
      await snapshot(page,engine,'waiting');
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('[data-app-update-now]').click()]);
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      await page.waitForFunction(async names=>{const keys=await caches.keys();return keys.includes(names.next)&&!keys.includes(names.old);},{next:newIdentity.cacheName,old:oldIdentity.cacheName},{timeout:30000});
      report.after=await inventory(page);
      const cache=report.after.caches.find(c=>c.name===newIdentity.cacheName);
      expect(expectedAssets).toHaveLength(newIdentity.assetCount);
      for(const asset of expectedAssets){const u=new URL(asset,url+'/');expect(cache.assets).toContain(u.pathname+u.search);}
      report.precache={expected:newIdentity.assetCount,verified:expectedAssets.length,runtimeEntries:cache.assets.length};
      for(const asset of ['/styles/premium-storefront.css?v=77','/styles/tracking-premium.css?v=77','/js/category-glass.js','/js/map/touch_intent.js'])expect(cache.assets).toContain(asset);
      const css=await page.evaluate(async()=>{const r=await caches.match(new URL('/styles.css?v=77',location.href));return r.text();});
      expect(css).toContain('premium-storefront.css?v=77');expect(css).toContain('tracking-premium.css?v=77');
      await snapshot(page,engine,'updated');
      await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      await expect(page.locator('[data-view="catalog"] .product-card').first()).toBeVisible();
      const glass=await page.evaluate(()=>window.TABA2_MOTION?.getDiagnostics?.().categoryGlass);
      expect(glass).toBeTruthy();report.offline={catalog:true,glass:true};
      await snapshot(page,engine,'offline');report.status='PASS';
    }catch(error){report.status='FAIL';report.error=String(error.stack||error);process.exitCode=1;}
    finally{await context?.close();await browser.close();results.push(report);fs.writeFileSync(path.join(root,'update.json'),JSON.stringify({results,requests},null,2)+'\n');}
    console.log(`${engine}: ${report.status} ${report.from} -> ${report.to}`);
  }
}finally{await new Promise(resolve=>server.close(resolve));}
