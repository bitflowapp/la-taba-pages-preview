import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { chromium, webkit, devices, expect } from '@playwright/test';
import sharp from 'sharp';
import { skipInstallInvitation } from '../tests/e2e/helpers.mjs';
import { cacheMapResources } from './qa-final-network-cache.mjs';

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
  if(phase==='offline'){requests.push({phase,path:req.url,fault:'origin-connection-closed'});res.destroy();return;}
  const pathname=decodeURIComponent(new URL(req.url,url).pathname);
  const tree=phase==='baseline'?baseline:candidate;
  const file=path.resolve(tree,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(tree+path.sep)){res.writeHead(403);res.end();return;}
  const record={phase,path:req.url,httpVersion:req.httpVersion};requests.push(record);
  try{
    let body=fs.readFileSync(file);
    if(pathname==='/sw.js'){
      record.originalSHA256=crypto.createHash('sha256').update(body).digest('hex');
      // Bootstrap an already-installed historical cache without repeating its
      // demonstrated unread-stream deadlock. Only v144's installer is adapted;
      // its assets and runtime handlers remain unchanged. The candidate worker
      // is always served byte-for-byte, with no diagnostic patch.
      if(phase==='baseline')body=Buffer.from(body.toString('utf8').replace('const response = await fetch(request);',
        'const downloaded = await fetch(request); const bytes = await downloaded.arrayBuffer(); const headers = new Headers(downloaded.headers); headers.delete("content-encoding"); headers.delete("content-length"); const response = new Response(bytes, { status: downloaded.status, statusText: downloaded.statusText, headers });'));
      record.servedSHA256=crypto.createHash('sha256').update(body).digest('hex');
      record.legacyInstallerBootstrap=phase==='baseline';
    }
    record.status=200;record.bytes=body.length;record.contentType=mime[path.extname(file)]||'application/octet-stream';
    // Production's edge compresses text; keep its original bytes and worker
    // source while avoiding HTTP/1 connection starvation in the old installer.
    const compressed=/html|javascript|css|json|svg/.test(record.contentType)&&req.headers['accept-encoding']?.includes('gzip');
    if(compressed)body=gzipSync(body);
    res.writeHead(200,{'Content-Type':record.contentType,'Content-Length':body.length,'Cache-Control':'no-store',...(compressed?{'Content-Encoding':'gzip'}:{})});res.end(body);
  }
  catch(error){record.status=404;record.error=String(error.code||error);res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const results=[];
const bounded=(promise,label,ms=45000)=>{
  let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`QA timeout: ${label}`)),ms);})]).finally(()=>clearTimeout(timer));
};
async function snapshot(page,engine,name){await sharp(await page.screenshot()).webp({quality:88}).toFile(path.join(root,`${engine}-${name}.webp`));}
async function documentReload(page){
  // Exercise the document's reload path, as the app's update button does.
  // WebKit's automation-protocol reload has a reported CacheStorage race:
  // https://github.com/microsoft/playwright/issues/42273
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded'}),
    page.evaluate(()=>{window.setTimeout(()=>window.location.reload(),0);}),
  ]);
}
async function controllerRelease(page){return page.evaluate(()=>new Promise(resolve=>{
  const controller=navigator.serviceWorker.controller;
  if(!controller){resolve(null);return;}
  const channel=new MessageChannel();
  const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
  const timer=setTimeout(()=>finish(null),5000);
  channel.port1.onmessage=event=>finish(event.data);
  controller.postMessage('release-status',[channel.port2]);
}));}
async function inventory(page){return page.evaluate(async expectedCache=>{
  const registration=await navigator.serviceWorker.getRegistration();
  const names=await caches.keys(),inventories=[];
  // Inspect only the namespace that must remain. Opening the predecessor
  // during activation could recreate a cache the worker just deleted.
  for(const name of names){
    let assets=null;
    if(name===expectedCache&&await caches.has(name)){
      const cache=await caches.open(name);assets=(await cache.keys()).map(r=>new URL(r.url).pathname+new URL(r.url).search);
    }
    inventories.push({name,assets});
  }
  return {caches:inventories,controlled:!!navigator.serviceWorker.controller,waiting:!!registration?.waiting,
    scope:registration?.scope,scriptURL:registration?.active?.scriptURL,activeState:registration?.active?.state,
    installingState:registration?.installing?.state,waitingState:registration?.waiting?.state,
    controllerState:navigator.serviceWorker.controller?.state,
    sameActiveController:registration?.active===navigator.serviceWorker.controller,
    updateViaCache:registration?.updateViaCache,qaUpdateResult:window.__qaUpdateResult};
},phase==='baseline'?oldIdentity.cacheName:newIdentity.cacheName);}
try{
  for(const [engine,type] of [['chromium',chromium],['webkit',webkit]].filter(([engine])=>!process.env.TABA_FINAL_ENGINE||engine===process.env.TABA_FINAL_ENGINE)){
    phase='baseline';let context,browser;
    const report={engine,from:oldIdentity.cacheName,to:newIdentity.cacheName,status:'RUNNING',workerErrors:[],console:[],
      method:'Local HTTP/1. Historical v144 assets/cache are seeded with an installer-only stream-drain workaround for its demonstrated bootstrap deadlock. All old runtime handlers remain unchanged. Candidate worker is byte-for-byte source, installed and activated natively.'};
    const progress=stage=>{report.stage=stage;console.log(`${engine}: ${stage}`);fs.writeFileSync(path.join(root,'update.json'),JSON.stringify({results:[...results,report],requests},null,2)+'\n');};
    try{
      progress('context');
      const profile=fs.mkdtempSync(path.join(os.tmpdir(),'taba-final-pwa-'+engine+'-'));
      const options={...devices[engine==='webkit'?'iPhone 13':'Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1,serviceWorkers:'allow'};
      if(engine==='webkit'){
        browser=await type.launch();context=await bounded(browser.newContext(options),'WebKit context',60000);
      }else context=await bounded(type.launchPersistentContext(profile,options),'persistent context',60000);
      // Only external MapLibre/OpenFreeMap resources use cached real bytes;
      // localhost worker and app resources retain the native update pipeline.
      await cacheMapResources(context);
      if(process.env.TABA_FINAL_WORKER_TRACE==='1')context.on('serviceworker',worker=>worker.evaluate(()=>{
        self.__qaWorkerTrace=[];
        for(const [prototype,name] of [[Response.prototype,'text'],[CacheStorage.prototype,'open'],[CacheStorage.prototype,'delete'],[Cache.prototype,'put']]){
          const original=prototype[name];prototype[name]=function(...args){
            const label=name+':'+(this.url||args[0]?.url||args[0]||'');self.__qaWorkerTrace.push({label,event:'start'});
            return original.apply(this,args).then(value=>{self.__qaWorkerTrace.push({label,event:'done'});return value;},error=>{self.__qaWorkerTrace.push({label,event:'error',error:String(error)});throw error;});
          };
        }
      }).catch(error=>report.workerErrors.push(String(error))));
      // Keep the real SW update pipeline free of routing interception.
      // The repository runtime file is empty and the explicit demo uses local data.
      report.nonlocalWrites=[];
      context.on('request',request=>{
        if(request.method()!=='GET'&&!request.url().startsWith(url+'/'))report.nonlocalWrites.push({method:request.method(),url:request.url()});
      });
      const page=context.pages()[0]||await bounded(context.newPage(),'new page',60000);page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(30000);await skipInstallInvitation(page);
      page.on('console',message=>{if(['error','warning'].includes(message.type()))report.console.push(message.text());});
      if(engine==='chromium'){
        const cdp=await context.newCDPSession(page);await cdp.send('ServiceWorker.enable');
        cdp.on('ServiceWorker.workerErrorReported',error=>{report.workerErrors.push(error);console.log('Worker error',JSON.stringify(error));});
      }
      await page.bringToFront();
      progress('baseline startup');
      await page.goto(`${url}/?demo=1#catalog`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      report.mode=await page.evaluate(async()=> (await import('/js/core/app-mode.js')).getAppMode());expect(report.mode).toBe('demo');
      await expect.poll(async()=>{
        const current=await inventory(page);
        return current.controlled&&!current.waiting&&!current.installingState&&current.caches.some(cache=>cache.name===oldIdentity.cacheName&&cache.assets?.length>=oldIdentity.assetCount);
      },{timeout:40000}).toBe(true);
      // Warm navigation belongs to the installed old worker before switching
      // the server tree. First-install controllerchange may reload the page.
      await documentReload(page);
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready'&&!!navigator.serviceWorker.controller,null,{timeout:40000});
      report.before=await inventory(page);await snapshot(page,engine,'before');
      expect(report.before.controlled).toBe(true);expect(report.before.waiting).toBe(false);
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
        return current.controlled&&!current.waiting&&!current.installingState&&current.caches.some(cache=>cache.name===newIdentity.cacheName&&cache.assets?.length>=newIdentity.assetCount)&&!current.caches.some(cache=>cache.name===oldIdentity.cacheName);
      },{timeout:30000}).toBe(true);
      // Linux WebKit reproduced page-side "activating" while the worker itself
      // was "activated". Require the actual controller's identity AND state;
      // preserve the wrapper's reported value as diagnostic evidence.
      await expect.poll(()=>controllerRelease(page),{timeout:30000}).toMatchObject({cacheName:newIdentity.cacheName,state:'activated'});
      report.controllerRelease=await controllerRelease(page);
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
      if(engine==='webkit'){phase='offline';report.offlineMethod='Origin TCP connections closed; distinct from browser/OS offline emulation (which failed internally in Windows WebKit during the audit).';}
      else{await context.setOffline(true);report.offlineMethod='Browser network offline';}
      await documentReload(page);
      await page.waitForFunction(()=>document.documentElement.dataset.tabaStartup==='ready',null,{timeout:30000});
      await expect(page.locator('[data-view="catalog"] .product-card').first()).toBeVisible();
      const glass=await page.evaluate(()=>window.TABA2_MOTION?.getDiagnostics?.().categoryGlass);
      const ambient=await page.evaluate(()=>getComputedStyle(document.querySelector('.app-shell')).backgroundImage);
      expect(glass).toBeTruthy();expect(ambient).toContain('ambient-grain.png');report.offline={catalog:true,glass:true,premiumCSS:true};
      await snapshot(page,engine,'offline');expect(report.nonlocalWrites).toEqual([]);report.status='PASS';
    }catch(error){report.status='FAIL';report.error=String(error.stack||error);process.exitCode=1;
      try{report.failureInventory=await bounded(inventory(context.pages()[0]),'failure inventory',10000);}catch{}
      if(process.env.TABA_FINAL_WORKER_TRACE==='1')try{report.workerTrace=await bounded(context.serviceWorkers()[0].evaluate(()=>self.__qaWorkerTrace||[]),'worker trace',10000);}catch{}
    }
    finally{
      phase='candidate';
      if(context)try{
        await context.setOffline(false);
        const page=context.pages()[0];
        if(page&&!page.isClosed()){
          await bounded(page.evaluate(async()=>{for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();}),'QA worker cleanup',10000);
          await page.goto('about:blank',{waitUntil:'domcontentloaded'});
        }
      }catch(error){report.cleanupPreparationError=String(error);}
      try{if(browser)await bounded(browser.close(),'browser cleanup',20000);else if(context)await bounded(context.close(),'context cleanup',20000);}catch(error){report.cleanupError=String(error);process.exitCode=1;}
      results.push(report);fs.writeFileSync(path.join(root,'update.json'),JSON.stringify({results,requests},null,2)+'\n');
    }
    console.log(`${engine}: ${report.status} ${report.from} -> ${report.to}`);
  }
}finally{server.closeAllConnections();await bounded(new Promise(resolve=>server.close(resolve)),'QA server cleanup',10000);}
// A failed persistent-context launch may leave the browser driver pending.
// End this standalone QA process once its report is safely persisted.
process.exit(process.exitCode||0);
