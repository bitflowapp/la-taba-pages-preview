import {chromium,devices} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {openPremiumTracking,changeTracking,touchPan,TRACKING_MAP,START} from '../tests/e2e/tracking-premium-fixture.mjs';
const root=path.resolve('artifacts/tracking-premium-20261007/motion');fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch();
try{
  for(const mobile of [true,false]){
    const size=mobile?{width:390,height:844}:{width:1440,height:900};
    const context=await browser.newContext({...(mobile?devices['Pixel 7']:{}),viewport:size,deviceScaleFactor:1,
      baseURL:'http://127.0.0.1:18251',serviceWorkers:'block',recordVideo:{dir:root,size}});
    const page=await context.newPage();await openPremiumTracking(page,{status:'preparing'});
    await page.addStyleTag({content:'.qa-caption{position:fixed;z-index:10000;left:18px;right:18px;bottom:90px;max-width:600px;margin:auto;padding:9px 12px;border-radius:14px;background:#0c1015f5;color:#fff;border:1px solid #555;font:600 12px system-ui;pointer-events:none}'});
    await page.evaluate(()=>{const n=document.createElement('div');n.className='qa-caption';document.body.append(n);});
    const label=async text=>page.locator('.qa-caption').evaluate((n,t)=>n.textContent=t,text);
    await label('Preparando · comercio y destino');await page.waitForTimeout(1000);
    await changeTracking(page,{status:'assigned'});await label('Repartidor asignado');await page.waitForTimeout(1000);
    await changeTracking(page,{status:'on_the_way'});await label('En camino · foco automático');await page.waitForTimeout(1300);
    await changeTracking(page,{lat:START.lat+.0003,lng:START.lng+.0003});await label('GPS nuevo · marker y cámara suaves');await page.waitForTimeout(1300);
    const box=await page.locator(`${TRACKING_MAP} canvas`).boundingBox();
    await label(mobile?'Pan con UN dedo · se pausa el seguimiento':'Pan manual · se pausa el seguimiento');
    if(mobile)await touchPan(page,{from:{x:box.x+box.width*.72,y:box.y+box.height*.55},to:{x:box.x+box.width*.28,y:box.y+box.height*.55},steps:18,delay:28});
    else{await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.5,{steps:20});await page.mouse.up();}
    await page.waitForTimeout(900);
    await changeTracking(page,{lat:START.lat+.0006,lng:START.lng+.0006});await label('GPS nuevo · la cámara respeta tu encuadre');await page.waitForTimeout(1200);
    await label('Seguir repartidor · retomar');
    const follow=page.locator('[data-map-follow-cta]');if(mobile)await follow.tap();else await follow.click();
    await page.waitForTimeout(1400);
    await label('Scroll vertical desde el mapa · detalles accesibles');
    if(mobile)await touchPan(page,{from:{x:box.x+box.width*.5,y:box.y+box.height*.8},to:{x:box.x+box.width*.5,y:box.y+box.height*.25}});
    else await page.mouse.wheel(0,300);
    await page.waitForTimeout(1000);
    const video=page.video();await context.close();
    const file=path.join(root,mobile?'tracking-one-finger.webm':'tracking-camera-desktop.webm');await video.saveAs(file);fs.unlinkSync(await video.path());console.log(file);
  }
}finally{await browser.close();}
