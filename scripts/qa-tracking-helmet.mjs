import { chromium, webkit, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { openPremiumTracking, TRACKING_MAP } from '../tests/e2e/tracking-premium-fixture.mjs';

const phase=process.argv[2]||'before';
const root=path.resolve('artifacts/tracking-helmet-20261007',phase);
fs.mkdirSync(root,{recursive:true});
const results=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await type.launch();
  try {
    for(const viewport of [{width:390,height:844},{width:430,height:932}]) {
      const context=await browser.newContext({ ...devices[engine==='webkit'?'iPhone 13':'Pixel 7'],viewport,
        deviceScaleFactor:1,baseURL:'http://127.0.0.1:18251',serviceWorkers:'block' });
      const page=await context.newPage();
      if(phase==='before') {
        for(const file of ['js/map/rider_marker.js','styles/tracking-premium.css']) {
          const body=execFileSync('git',['show',`f85ca90f:${file}`],{encoding:'utf8'});
          await page.route(`**/${file}*`,route=>route.fulfill({body,contentType:file.endsWith('.css')?'text/css':'application/javascript'}));
        }
      }
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await openPremiumTracking(page,{status:'on_the_way',capturePixels:true});
      await page.waitForFunction(()=>window.__qaMaps.at(-1).areTilesLoaded(),null,{timeout:15000});
      // A fixed QA camera makes the icon comparison independent of async tile
      // loading/resize timing. No tracking or camera code is changed.
      await page.evaluate(()=>window.__qaMaps.at(-1).jumpTo({center:[-68.0512,-38.9451],zoom:14,
        bearing:0,pitch:0,padding:{top:0,bottom:0,left:0,right:0}}));
      await page.waitForFunction(()=>window.__qaMaps.at(-1).areTilesLoaded(),null,{timeout:15000});
      await page.waitForTimeout(400);
      const directory=path.join(root,engine);
      fs.mkdirSync(directory,{recursive:true});
      const name=`${viewport.width}x${viewport.height}-on-the-way`;
      const full=await page.screenshot();
      await sharp(full).webp({lossless:true}).toFile(path.join(directory,`${name}.webp`));
      const marker=await page.locator(`${TRACKING_MAP} .lt-rider-marker`).screenshot();
      await sharp(marker).resize(250,250,{kernel:'nearest'}).png().toFile(path.join(directory,`${name}-marker-5x.png`));
      const card=await page.locator('[data-tracking-rider-card]').screenshot();
      await sharp(card).webp({lossless:true}).toFile(path.join(directory,`${name}-card.webp`));
      const report=await page.evaluate(()=>{
        const marker=document.querySelector('[data-tracking-panel] .lt-rider-marker');
        const map=marker.closest('[data-real-map]');
        const icon=document.querySelector('[data-tracking-rider-card] .tracking-rider-icon');
        const avatar=icon.querySelector('svg');
        const box=n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,left:r.left,top:r.top};};
        return {marker:box(marker),map:box(map),cardIcon:box(icon),avatar:box(avatar),
          helmetMarkers:map.querySelectorAll('[data-map-rider-helmet]').length,
          scooterMarkers:map.querySelectorAll('[data-map-rider-scooter]').length,
          overflow:document.documentElement.scrollWidth>innerWidth,
          forever:map.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity).length};
      });
      results.push({phase,engine,viewport,errors,...report});
      await context.close();
      fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(results,null,2));
      console.log(`${phase} ${engine} ${viewport.width}: captured map + card`);
    }
  } finally { await browser.close(); }
}
