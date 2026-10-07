/* Paired isolated browser measurement. Run after all other browser tests.
 * Reuses the identical public catalog snapshot; never contacts production. */
import { chromium, webkit, devices } from '@playwright/test';
import fs from 'node:fs';
import { openRuntimeCatalog } from '../tests/e2e/catalog-runtime-fixture.mjs';
const live=JSON.parse(fs.readFileSync('tests/fixtures/catalog-live.json','utf8'));
const output='artifacts/frontend-premium-20261007/technical/performance-paired.json';
fs.mkdirSync('artifacts/frontend-premium-20261007/technical',{recursive:true});
const report=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
  for(const width of [390,430,1366,1440,1536,1920,2560]) {
    for(const phase of ['before','after']) {
      const browser=await type.launch();
      try {
        const context=await browser.newContext({...(width<600?devices[engine==='webkit'?'iPhone 13':'Pixel 7']:{}),
          viewport:{width,height:width===2560?1440:900},deviceScaleFactor:1,
          baseURL:`http://127.0.0.1:${phase==='before'?18240:18241}`,serviceWorkers:'block'});
        const page=await context.newPage();
        await openRuntimeCatalog(page,{catalogRows:live.products,waitForCatalog:false});
        await page.waitForTimeout(500);
        const cdp=engine==='chromium'?await context.newCDPSession(page):null;
        if(cdp)await cdp.send('Performance.enable');
        const initialMetrics=cdp?await cdp.send('Performance.getMetrics'):null;
        const samples=[];
        for(let sample=0;sample<3;sample++) {
          await page.bringToFront();
          const result=await page.evaluate(async ()=>{
            let cls=0;const tasks=[];
            let po,lo;
            try{po=new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)cls+=e.value;}));po.observe({type:'layout-shift'});}catch{}
            try{lo=new PerformanceObserver(list=>list.getEntries().forEach(e=>tasks.push(e.duration)));lo.observe({type:'longtask'});}catch{}
            const deltas=[];
            let last;
            await new Promise(resolve=>{
              const start=performance.now();
              const frame=now=>{
                if(last)deltas.push(now-last);
                last=now;
                const elapsed=now-start;
                scrollTo(0,Math.sin(elapsed/1200*Math.PI)**2*Math.min(1400,document.documentElement.scrollHeight-innerHeight));
                if(elapsed<1200)requestAnimationFrame(frame);else resolve();
              };
              requestAnimationFrame(frame);
            });
            scrollTo(0,0);po?.disconnect();lo?.disconnect();
            deltas.sort((a,b)=>a-b);
            return{p95:deltas[Math.floor(deltas.length*.95)],max:deltas.at(-1),frames:deltas.length,
              over50:deltas.filter(n=>n>50).length,cls,longTasks:tasks};
          });
          samples.push(result);
          await page.waitForTimeout(180);
        }
        const sorted=samples.map(s=>s.p95).sort((a,b)=>a-b);
        const horizontal=await page.evaluate(async()=>{
          const rail=document.querySelector('[data-view="catalog"] [data-category-strip]');
          let cls=0,observer;
          try{observer=new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)cls+=e.value;}));observer.observe({type:'layout-shift'});}catch{}
          const deltas=[];let last;
          await new Promise(resolve=>{
            const start=performance.now();
            const tick=now=>{
              if(last)deltas.push(now-last);last=now;
              const t=now-start;
              rail.scrollLeft=Math.sin(t/1200*Math.PI)**2*Math.min(650,rail.scrollWidth-rail.clientWidth);
              if(t<1200)requestAnimationFrame(tick);else resolve();
            };
            requestAnimationFrame(tick);
          });
          observer?.disconnect();deltas.sort((a,b)=>a-b);
          return{p95:deltas[Math.floor(deltas.length*.95)],max:deltas.at(-1),frames:deltas.length,cls,
            glass:window.TABA2_MOTION?.getDiagnostics().categoryGlass??null};
        });
        const finalMetrics=cdp?await cdp.send('Performance.getMetrics'):null;
        const value=(result,key)=>result?.metrics.find(m=>m.name===key)?.value;
        const browserMetrics=cdp?{
          layouts:value(finalMetrics,'LayoutCount')-value(initialMetrics,'LayoutCount'),
          styleRecalculations:value(finalMetrics,'RecalcStyleCount')-value(initialMetrics,'RecalcStyleCount'),
          jsHeapBytes:value(finalMetrics,'JSHeapUsedSize'),
        }:null;
        await cdp?.detach();
        const entry={engine,width,phase,medianP95:sorted[1],samples,horizontal,browserMetrics,
          method:'three 1.2s vertical-scroll samples + one 1.2s category scroll; single browser, fresh context'};
        report.push(entry);
        fs.writeFileSync(output,JSON.stringify(report,null,2));
        console.log(`${engine} ${width} ${phase}: ${entry.medianP95.toFixed(1)}ms p95 (median of 3)`);
        await context.close();
      }finally{await browser.close();}
    }
  }
}
