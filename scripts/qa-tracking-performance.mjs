import {chromium,webkit,devices} from '@playwright/test';
import fs from 'node:fs';
import {openPremiumTracking,changeTracking,START,TRACKING_MAP} from '../tests/e2e/tracking-premium-fixture.mjs';
const output='artifacts/tracking-premium-20261007/performance.json',report=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  for(const viewport of [{width:390,height:844},{width:430,height:932},{width:1440,height:900}]){
    for(const phase of ['before','after']){
      const browser=await type.launch();
      try{
        const context=await browser.newContext({...(viewport.width<600?devices[engine==='webkit'?'iPhone 13':'Pixel 7']:{}),
          viewport,deviceScaleFactor:1,baseURL:`http://127.0.0.1:${phase==='before'?18250:18251}`,serviceWorkers:'block'});
        const page=await context.newPage();await openPremiumTracking(page,{status:'on_the_way'});
        await page.waitForFunction(()=>window.__qaMaps.at(-1)?.areTilesLoaded(),{},{timeout:15000}).catch(()=>{});
        await page.evaluate(selector=>{
          const shell=document.querySelector(selector),canvas=shell.querySelector('canvas');
          window.__perf={frames:[],longTasks:[],cls:0,removed:0,renders:0};
          window.__qaMaps.at(-1).on('render',()=>window.__perf.renders++);
          new MutationObserver(records=>records.forEach(r=>r.removedNodes.forEach(n=>{
            if(n===shell||n===canvas||n.contains?.(shell)||n.contains?.(canvas))window.__perf.removed++;
          }))).observe(document.querySelector('[data-tracking-panel]'),{childList:true,subtree:true});
          try{new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)window.__perf.cls+=e.value;})).observe({type:'layout-shift'});}catch{}
          try{new PerformanceObserver(list=>list.getEntries().forEach(e=>window.__perf.longTasks.push(e.duration))).observe({type:'longtask'});}catch{}
        },TRACKING_MAP);
        const samples=[];
        for(let n=0;n<3;n++){
          const frames=await page.evaluate(async()=>{
            const frames=[];let last;
            await new Promise(resolve=>{const start=performance.now();function frame(now){if(last)frames.push(now-last);last=now;if(now-start<1200)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
            frames.sort((a,b)=>a-b);return{p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1),frames:frames.length};
          });samples.push(frames);
        }
        const gpsSamples=[];
        for(let update=1;update<=3;update++){
          const activePromise=page.evaluate(async()=>{
            const frames=[];let last;
            await new Promise(resolve=>{const start=performance.now();function frame(now){if(last)frames.push(now-last);last=now;if(now-start<1200)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
            frames.sort((a,b)=>a-b);return{p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1),frames:frames.length};
          });
          await changeTracking(page,{lat:START.lat+update*.0003,lng:START.lng+update*.0003});
          gpsSamples.push(await activePromise);
        }
        const activeSorted=gpsSamples.map(s=>s.p95).sort((a,b)=>a-b);
        const gpsSample={p95:activeSorted[1],samples:gpsSamples};
        const rendersAtRest=await page.evaluate(()=>window.__perf.renders);
        await page.waitForTimeout(700);
        const metrics=await page.evaluate(selector=>({
          ...window.__perf,
          infiniteMapAnimations:document.querySelector(selector).getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length,
          maps:window.__qaMaps.length,
          tilesLoaded:window.__qaMaps.at(-1).areTilesLoaded(),
          mapHeight:document.querySelector(selector).getBoundingClientRect().height,
        }),TRACKING_MAP);
        metrics.idleCanvasRenders=metrics.renders-rendersAtRest;
        const sorted=samples.map(s=>s.p95).sort((a,b)=>a-b);
        report.push({engine,viewport,phase,samples,gpsSample,medianP95:sorted[1],metrics,
          method:'Single browser, 3 idle rAF samples of 1.2s, 3 active rAF samples during GPS updates, 3 updates total. Renderer/tiles real; order/fixes QA.'});
        fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(`${engine} ${viewport.width} ${phase}: ${sorted[1].toFixed(1)}ms, removed canvas ${metrics.removed}, infinite map ${metrics.infiniteMapAnimations}`);
        await context.close();
      }finally{await browser.close();}
    }
  }
}
