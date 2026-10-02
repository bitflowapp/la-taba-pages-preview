import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { openRuntimeCatalog } from '../tests/e2e/catalog-runtime-fixture.mjs';
import { useQaCampaigns } from '../tests/e2e/campaigns-fixture.mjs';

const out='artifacts/product-discovery-real-campaigns';
const axePath=process.env.TABA_DISCOVERY_AXE_PATH;
if(!axePath||!fs.existsSync(axePath))throw Error('Pass TABA_DISCOVERY_AXE_PATH pointing to a local axe.min.js.');
const products=JSON.parse(fs.readFileSync('scripts/campaign-lab/approved-products.json'));
const assets=new Map(products.flatMap(p=>[[p.imageSha256,p.image.slice(1)],[p.imageThumbnailSha256,p.imageThumbnail.slice(1)]]));
const report={};fs.mkdirSync(out+'/videos',{recursive:true});
for(const [engine,launcher]of Object.entries({chromium,webkit})){
  const browser=await launcher.launch();report[engine]={};
  try{
    for(const enabled of [false,true]){
      const context=await browser.newContext({baseURL:'http://127.0.0.1:8196',viewport:{width:390,height:844},
        hasTouch:true,serviceWorkers:'block',recordVideo:enabled?{dir:out+'/videos',size:{width:390,height:844}}:undefined});
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(enabled)await useQaCampaigns(page);
      await openRuntimeCatalog(page,{view:'home',beforeGoto:async()=>{
        await page.route('**/storage/v1/object/public/catalog-images/**',async route=>{
          const file=route.request().url().match(/(?:thumb-)?([a-f0-9]{64})\.webp$/)?.[1];
          const local=assets.get(file);
          if(local)return route.fulfill({path:path.resolve(local),contentType:'image/webp'});
          return route.fallback();
        });
      }});
      let cdp=null;
      if(engine==='chromium'){cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');}
      const before=cdp?await cdp.send('Performance.getMetrics'):null;
      const metrics=await page.evaluate(async()=>{
        const frames=[],tasks=[],shifts=[];let last;
        const support=PerformanceObserver.supportedEntryTypes||[];
        if(support.includes('longtask'))new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
        if(support.includes('layout-shift'))new PerformanceObserver(list=>shifts.push(...list.getEntries().filter(e=>!e.hadRecentInput).map(e=>e.value))).observe({type:'layout-shift'});
        const root=document.querySelector('[data-home-hero-promo] [data-campaign]');
        if(root){window.TABA2_CAMPAIGNS.destroy();delete root.dataset.motionCampaign;delete root.dataset.motionCampaignLive;
          root.dataset.motionCampaign='on';root.dataset.motionCampaignLive='true';}
        await new Promise(resolve=>{
          const start=performance.now();function frame(now){if(last)frames.push(now-last);last=now;if(now-start<8000)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);
        });
        const sorted=[...frames].sort((a,b)=>a-b);
        return {durationMs:frames.reduce((a,b)=>a+b,0),fps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length),
          frameP95:sorted[Math.floor(sorted.length*.95)],longTasks:support.includes('longtask')?tasks:null,
          layoutShifts:support.includes('layout-shift')?shifts.reduce((a,b)=>a+b,0):null};
      });
      const after=cdp?await cdp.send('Performance.getMetrics'):null;
      const value=(set,name)=>set?.metrics.find(m=>m.name===name)?.value??null;
      await page.addScriptTag({path:axePath});
      const axe=await page.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))})));
      report[engine][enabled?'on':'off']={...metrics,jsHeapBefore:value(before,'JSHeapUsedSize'),jsHeapAfter:value(after,'JSHeapUsedSize'),
        scriptSeconds:before?value(after,'ScriptDuration')-value(before,'ScriptDuration'):null,errors,axe};
      const scan=()=>page.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))));
      await page.locator('[data-nav-view="catalog"]:visible').first().click();
      await page.locator('[data-view="catalog"] .product-card').first().waitFor();
      const catalogAxe=await scan();
      await page.locator('[data-view="catalog"] [data-search-input]').fill('heineken');
      const searchAxe=await scan();
      await page.locator('[data-view="catalog"] .product-media').first().click();
      const detailAxe=await scan();
      report[engine][enabled?'on':'off'].axeViews={catalog:catalogAxe,search:searchAxe,detail:detailAxe};
      console.log(engine,enabled?'on':'off',JSON.stringify(report[engine][enabled?'on':'off']));
      const video=page.video();await context.close();if(video)await video.saveAs(`${out}/videos/${engine}-real-campaign.webm`);
    }
  }finally{await browser.close();}
}
fs.writeFileSync(out+'/campaign-performance.json',JSON.stringify(report,null,2));
for(const values of Object.values(report))for(const state of Object.values(values)){
  if(state.errors.length||[...state.axe.violations,...Object.values(state.axeViews).flat()].some(v=>v.impact==='critical'))process.exitCode=1;
}
