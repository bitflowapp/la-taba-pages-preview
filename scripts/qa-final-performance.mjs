import { chromium, webkit, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openRuntimeCatalog } from '../tests/e2e/catalog-runtime-fixture.mjs';
import { openPremiumTracking, changeTracking, START, TRACKING_MAP } from '../tests/e2e/tracking-premium-fixture.mjs';
const root=path.resolve('artifacts/la-taba-final-integration-20261007');
const live=JSON.parse(fs.readFileSync('tests/fixtures/catalog-live.json','utf8'));
const results=[];fs.mkdirSync(root,{recursive:true});
async function frames(page,scroll=false){return page.evaluate(async scroll=>{
  const deltas=[],tasks=[];let last,cls=0,layoutSupported=false,lo,po;
  try{po=new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)cls+=e.value;}));po.observe({type:'layout-shift'});layoutSupported=true;}catch{}
  try{lo=new PerformanceObserver(list=>list.getEntries().forEach(e=>tasks.push(e.duration)));lo.observe({type:'longtask'});}catch{}
  await new Promise(resolve=>{const start=performance.now();const tick=now=>{
    if(last)deltas.push(now-last);last=now;const t=now-start;
    if(scroll)scrollTo(0,Math.sin(t/1200*Math.PI)**2*Math.min(1400,document.documentElement.scrollHeight-innerHeight));
    if(t<1200)requestAnimationFrame(tick);else resolve();
  };requestAnimationFrame(tick);});
  if(scroll)scrollTo(0,0);po?.disconnect();lo?.disconnect();deltas.sort((a,b)=>a-b);
  return{p95:deltas[Math.floor(deltas.length*.95)],max:deltas.at(-1),frames:deltas.length,over50:deltas.filter(n=>n>50).length,cls:layoutSupported?cls:null,longTasks:tasks};
},scroll);}
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]])for(const viewport of [{width:390,height:844},{width:1440,height:900}])for(const phase of ['before','final']){
  const browser=await type.launch();let context;
  try{
    const options={...(viewport.width<600?devices[engine==='webkit'?'iPhone 13':'Pixel 7']:{}),viewport,deviceScaleFactor:1,serviceWorkers:'block',baseURL:`http://127.0.0.1:${phase==='before'?18266:18265}`};
    context=await browser.newContext(options);let page=await context.newPage();
    const start=Date.now();await openRuntimeCatalog(page,{catalogRows:live.products,waitForCatalog:false});
    const bootstrapMs=Date.now()-start;await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
    const scrollSamples=[];for(let n=0;n<3;n++)scrollSamples.push(await frames(page,true));
    const glass=await page.evaluate(()=>window.TABA2_MOTION?.getDiagnostics?.().categoryGlass??null);
    await context.close();context=await browser.newContext(options);page=await context.newPage();
    await openPremiumTracking(page,{status:'on_the_way'});
    await page.waitForFunction(()=>window.__qaMaps.at(-1).areTilesLoaded(),null,{timeout:20000});
    await page.evaluate(selector=>{
      const shell=document.querySelector(selector);window.__perfCanvas=shell.querySelector('canvas');
      window.__perfMarker=shell.querySelector('.lt-rider-marker');window.__perfRemoved=0;
      new MutationObserver(records=>records.forEach(r=>r.removedNodes.forEach(n=>{if(n===window.__perfCanvas||n.contains?.(window.__perfCanvas))window.__perfRemoved++;}))).observe(document.querySelector('[data-tracking-panel]'),{childList:true,subtree:true});
    },TRACKING_MAP);
    const idleSamples=[];for(let n=0;n<3;n++)idleSamples.push(await frames(page));
    const gpsSamples=[];for(let n=1;n<=3;n++){
      const sample=frames(page);await changeTracking(page,{lat:START.lat+n*.0003,lng:START.lng+n*.0003});gpsSamples.push(await sample);
    }
    const cdp=engine==='chromium'?await context.newCDPSession(page):null;
    const heap=[];
    if(cdp)await cdp.send('Performance.enable');
    for(let batch=0;batch<3;batch++){
      for(let n=0;n<5;n++)await changeTracking(page,{lat:START.lat+.0009+(batch*5+n)*.00003,lng:START.lng+.0009+(batch*5+n)*.00003});
      await page.waitForTimeout(650);
      if(cdp){await cdp.send('HeapProfiler.collectGarbage');const metrics=await cdp.send('Performance.getMetrics');heap.push({heapBytes:metrics.metrics.find(m=>m.name==='JSHeapUsedSize')?.value,nodes:metrics.metrics.find(m=>m.name==='Nodes')?.value});}
    }
    const tracking=await page.evaluate(selector=>{const map=document.querySelector(selector);return{canvasSame:map.querySelector('canvas')===window.__perfCanvas,markerSame:map.querySelector('.lt-rider-marker')===window.__perfMarker,canvasRemovals:window.__perfRemoved,mapsCreated:window.__qaMaps.length,infiniteMapAnimations:map.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length};},TRACKING_MAP);
    await cdp?.detach();
    const median=samples=>samples.map(s=>s.p95).sort((a,b)=>a-b)[1];
    const report={engine,viewport,phase,bootstrapMs,scrollSamples,idleSamples,gpsSamples,medianScrollP95:median(scrollSamples),medianGpsP95:median(gpsSamples),glass,heap,tracking,
      method:'Single active browser; 3 x 1.2s rAF samples per workload; same mocked catalog/order and real MapLibre. 15 additional GPS renders; heap measured only in Chromium after explicit GC. Bounded observation, not a claim of constant 60 FPS or a proof of no leaks.'};
    results.push(report);fs.writeFileSync(path.join(root,'performance.json'),JSON.stringify(results,null,2)+'\n');
    console.log(`${engine} ${viewport.width} ${phase}: scroll p95 ${report.medianScrollP95.toFixed(1)}ms; GPS p95 ${report.medianGpsP95.toFixed(1)}ms; canvas removed ${tracking.canvasRemovals}`);
  }finally{await context?.close();await browser.close();}
}
