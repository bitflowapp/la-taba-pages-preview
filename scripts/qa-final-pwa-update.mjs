import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium, webkit, devices, expect } from '@playwright/test';
import sharp from 'sharp';
import { skipInstallInvitation } from '../tests/e2e/helpers.mjs';

const candidate=process.cwd();
const baseline=path.resolve(process.argv[2]||'../la-taba-final-baseline-20261007');
const root=path.resolve('artifacts/la-taba-final-integration-20261007/pwa');fs.mkdirSync(root,{recursive:true});
const oldIdentity=JSON.parse(fs.readFileSync(path.join(baseline,'release-identity.json'),'utf8'));
const newIdentity=JSON.parse(fs.readFileSync('release-identity.json','utf8'));
const stylesheet=fs.readFileSync('index.html','utf8').match(/href="(styles\.css\?v=\d+)"/)[1];
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
const bounded=(promise,label,ms=45000)=>{
  let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`QA timeout: ${label}`)),ms);})]).finally(()=>clearTimeout(timer));
};
async function snapshot(page,engine,name){await sharp(await page.screenshot()).webp({quality:88}).toFile(path.join(root,`${engine}-${name}.webp`));}
async function inventory(page){return page.evaluate(async()=>{
  const names=await caches.keys(),inventories=[];
  for(const name of names){const cache=await caches.open(name);inventories.push({name,assets:(await cache.keys()).map(r=>new URL(r.url).pathname+new URL(r.url).search)});}
  const registration=await navigator.serviceWorker.getRegistration();
  return {caches:inventories,controlled:!!navigator.serviceWorker.controller,waiting:!!registration?.waiting,
    scope:registration?.scope,scriptURL:registration?.active?.scriptURL,activeState:registration?.active?.state,
    installingState:registration?.installing?.state,waitingState:registration?.waiting?.state,
    updateViaCache:registration?.updateViaCache,qaUpdateResult:window.__qaUpdateResult};
});}
try{
  for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
    phase='baseline';let context;
    const report={engine,from:oldIdentity.cacheName,to:newIdentity.cacheName,status:'RUNNING'};
    const progress=stage=>{report.stage=stage;console.log(`${engine}: ${stage}`);fs.writeFileSync(path.join(root,'update.json'),JSON.stringify({results:[...results,report],requests},null,2)+'\n');};
    try{
      progress('context');
      const profile=fs.mkdtempSync(path.join(os.tmpdir(),'taba-final-pwa-'+engine+'-'));
      context=await bounded(type.launchPersistentContext(profile,{...devices[engine==='webkit'?'iPhone 13':'Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1,serviceWorkers:'allow'}),'persistent context',60000);
      // Keep the real SW update pipeline free of routing interception.
      // The repository runtime file is empty and the explicit demo uses local data.
      report.nonlocalWrites=[];
      context.on('request',request=>{
        if(request.method()!=='GET'&&!request.url().startsWith(url+'/'))report.nonlocalWrites.push({method:request.method(),url:request.url()});
      });
      const page=context.pages()[0]||await bounded(context.newPage(),'new page',60000);page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(30000);await skipInstallInvitation(page);
      await page.bringToFront();
      progress('baseline startup');
      await page.goto(`${url}/?demo=1#catalog`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      report.mode=await page.evaluate(async()=> (await import('/js/core/app-mode.js')).getAppMode());expect(report.mode).toBe('demo');
      await expect.poll(async()=>{
        const current=await inventory(page);
        return current.controlled&&current.activeState==='activated'&&current.caches.some(cache=>cache.name===oldIdentity.cacheName&&cache.assets.length>=oldIdentity.assetCount);
      },{timeout:40000}).toBe(true);
      // Warm navigation belongs to the installed old worker before switching
      // the server tree. First-install controllerchange may reload the page.
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready'&&!!navigator.serviceWorker.controller,null,{timeout:40000});
      report.before=await inventory(page);await snapshot(page,engine,'before');
      expect(report.before.controlled).toBe(true);expect(report.before.activeState).toBe('activated');
      progress('baseline installed');
      phase='candidate';
      progress('request update');
      await bounded(page.evaluate(async()=>{
        const registration=await navigator.serviceWorker.getRegistration();
        window.__qaUpdateResult='pending';
        registration.update().then(()=>window.__qaUpdateResult='resolved',error=>window.__qaUpdateResult=String(error));
      }),'schedule registration.update');
      progress('wait for update banner');
      await expect(page.locator('[data-app-update-banner]')).toBeVisible({timeout:40000});
      report.waiting=await inventory(page);
      expect(report.waiting.waiting).toBe(true);
      expect(report.waiting.caches.some(c=>c.name===oldIdentity.cacheName)).toBe(true);
      await snapshot(page,engine,'waiting');
      progress('activate update');
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('[data-app-update-now]').click()]);
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      await expect.poll(async()=>{
        const current=await inventory(page);
        return current.controlled&&current.activeState==='activated'&&current.caches.some(cache=>cache.name===newIdentity.cacheName&&cache.assets.length>=newIdentity.assetCount)&&!current.caches.some(cache=>cache.name===oldIdentity.cacheName);
      },{timeout:30000}).toBe(true);
      report.after=await inventory(page);
      const cache=report.after.caches.find(c=>c.name===newIdentity.cacheName);
      expect(expectedAssets.filter(asset=>asset!=='./')).toHaveLength(newIdentity.assetCount);
      for(const asset of expectedAssets){const u=new URL(asset,url+'/');expect(cache.assets).toContain(u.pathname+u.search);}
      report.precache={expected:newIdentity.assetCount,verified:expectedAssets.filter(asset=>asset!=='./').length,shellRootVerified:true,runtimeEntries:cache.assets.length};
      for(const asset of ['/js/category-glass.js','/js/map/touch_intent.js'])expect(cache.assets).toContain(asset);
      const css=await page.evaluate(async stylesheet=>{const r=await caches.match(new URL('/'+stylesheet,location.href));return r.text();},stylesheet);
      expect(css).toMatch(/premium-storefront\.css\?v=\d+/);expect(css).toMatch(/tracking-premium\.css\?v=\d+/);
      await snapshot(page,engine,'updated');
      progress('offline reload');
      await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      await expect(page.locator('[data-view="catalog"] .product-card').first()).toBeVisible();
      const glass=await page.evaluate(()=>window.TABA2_MOTION?.getDiagnostics?.().categoryGlass);
      expect(glass).toBeTruthy();report.offline={catalog:true,glass:true};
      await snapshot(page,engine,'offline');expect(report.nonlocalWrites).toEqual([]);report.status='PASS';
    }catch(error){report.status='FAIL';report.error=String(error.stack||error);process.exitCode=1;
      try{report.failureInventory=await bounded(inventory(context.pages()[0]),'failure inventory',10000);}catch{}
    }
    finally{
      if(context)try{await bounded(context.close(),'context cleanup',20000);}catch(error){report.cleanupError=String(error);process.exitCode=1;}
      results.push(report);fs.writeFileSync(path.join(root,'update.json'),JSON.stringify({results,requests},null,2)+'\n');
    }
    console.log(`${engine}: ${report.status} ${report.from} -> ${report.to}`);
  }
}finally{server.closeAllConnections();await bounded(new Promise(resolve=>server.close(resolve)),'QA server cleanup',10000);}
// A failed persistent-context launch may leave the browser driver pending.
// End this standalone QA process once its report is safely persisted.
process.exit(process.exitCode||0);
