import {chromium,webkit,devices} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {openPremiumTracking,changeTracking,TRACKING_MAP} from '../tests/e2e/tracking-premium-fixture.mjs';
const phase=process.argv[2]||'before';
const root=path.resolve('artifacts/tracking-premium-20261007',phase);
fs.mkdirSync(root,{recursive:true});
const reports=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch();
  try{
    for(const size of [{width:390,height:844},{width:430,height:932},{width:1440,height:900}]){
      const context=await browser.newContext({...(size.width<600?devices[engine==='webkit'?'iPhone 13':'Pixel 7']:{}),
        viewport:size,deviceScaleFactor:1,baseURL:`http://127.0.0.1:${phase==='before'?18250:18251}`,serviceWorkers:'block'});
      const page=await context.newPage();
      await openPremiumTracking(page,{status:'received',capturePixels:true});
      for(const [status,name] of [['received','confirmed'],['preparing','preparing'],['assigned','rider-assigned'],['on_the_way','on-the-way'],['delivered','delivered']]){
        if(status!=='received')await changeTracking(page,{status});
        await page.waitForTimeout(800);
        // Ready marks style load, not completion of the camera's new tiles.
        // Capture a painted basemap, never an in-flight blank transition.
        await page.waitForFunction(()=>{
          const map=window.__qaMaps?.at(-1);
          return map && !map.isMoving() && map.areTilesLoaded() && map.queryRenderedFeatures().length>5;
        },null,{timeout:20000});
        await page.evaluate(()=>scrollTo(0,0));
        const directory=path.join(root,engine);fs.mkdirSync(directory,{recursive:true});
        await page.screenshot({path:path.join(directory,`${size.width}x${size.height}-${name}.png`)});
        const report=await page.locator(TRACKING_MAP).evaluate(n=>({mapHeight:n.getBoundingClientRect().height,
          mapWidth:n.getBoundingClientRect().width,mapState:n.dataset.mapStatus,camera:n.dataset.mapCamera,
          overflow:document.documentElement.scrollWidth>innerWidth}));
        reports.push({engine,viewport:size,status,...report,captureContext:'QA only: preserveDrawingBuffer=true for WebGL screenshot pixels; tests and performance use the default false.'});
      }
      await context.close();
      fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(reports,null,2));
      console.log(`${phase} ${engine} ${size.width}: 5 states captured`);
    }
  }finally{await browser.close();}
}
