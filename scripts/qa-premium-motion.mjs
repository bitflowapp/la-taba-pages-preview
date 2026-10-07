import { chromium, devices, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openRuntimeCatalog, clickCatalogCategory, GRID } from '../tests/e2e/catalog-runtime-fixture.mjs';
const root=path.resolve('artifacts/frontend-premium-20261007/motion');
fs.mkdirSync(root,{recursive:true});
const live=JSON.parse(fs.readFileSync('tests/fixtures/catalog-live.json','utf8'));
const browser=await chromium.launch();
const manifest=[];
try {
  for(const mobile of [false,true]) {
    const size=mobile?{width:390,height:844}:{width:1366,height:768};
    const context=await browser.newContext({...(mobile?devices['Pixel 7']:{}),viewport:size,
      deviceScaleFactor:1,baseURL:'http://127.0.0.1:18241',serviceWorkers:'block',
      recordVideo:{dir:root,size}});
    const page=await context.newPage();
    await openRuntimeCatalog(page,{catalogRows:live.products,waitForCatalog:false});
    await page.addStyleTag({content:'.qa-motion-label{position:fixed;z-index:10000;right:12px;bottom:100px;padding:8px 13px;border-radius:999px;background:#101319ee;color:white;font:600 13px system-ui;pointer-events:none;box-shadow:0 3px 16px #0005}'});
    await page.evaluate(()=>{const label=document.createElement('div');label.className='qa-motion-label';document.body.append(label);});
    const label=async text=>page.locator('.qa-motion-label').evaluate((n,t)=>n.textContent=t,text);
    const rail=page.locator('[data-view="catalog"] [data-category-strip]');
    const box=await rail.boundingBox();
    const y=box.y+box.height*.5;
    await label(mobile?'Arrastre táctil lento':'Categorías · arrastre lento');
    if(mobile) {
      const cdp=await context.newCDPSession(page);
      const touch=async (from,to,steps,delay)=>{
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from,y}]});
        for(let i=1;i<=steps;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from+(to-from)*i/steps,y}]});await page.waitForTimeout(delay);}
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      await touch(box.x+box.width-35,box.x+35,30,28);
      await page.waitForTimeout(750);
      await label('Arrastre rápido · inercia nativa');
      await touch(box.x+35,box.x+box.width-35,5,12);
      await page.waitForTimeout(900);
      await cdp.detach();
    } else {
      await page.mouse.move(box.x+box.width-30,y);
      await page.mouse.down();
      for(let i=1;i<=32;i++){await page.mouse.move(box.x+box.width-30-i*9,y);await page.waitForTimeout(26);}
      await page.mouse.up();
      await page.waitForTimeout(850);
      await label('Arrastre rápido · settle');
      await page.mouse.move(box.x+50,y);
      await page.mouse.down();
      await page.mouse.move(box.x+400,y,{steps:5});
      await page.mouse.up();
      await page.waitForTimeout(850);
      await label('Hover · reflejo y elevación');
      const gas=page.locator('[data-view="catalog"] [data-category-id="gaseosas"]');
      await gas.hover();await page.waitForTimeout(850);
    }
    await label('Seleccionar · respuesta inmediata');
    await clickCatalogCategory(page,'isotonicas');await page.waitForTimeout(850);
    await clickCatalogCategory(page,'energizantes');await page.waitForTimeout(850);
    await label('Agregar · press y feedback del carrito');
    const add=page.locator(`${GRID} [data-add-product]:not(:disabled)`).first();
    if(mobile) await add.tap(); else {await add.hover();await page.waitForTimeout(450);await add.click();}
    await expect(page.locator('[data-cart-count]').first()).toHaveText('1');
    await page.waitForTimeout(1300);
    await label('Carrito');
    await page.locator('[data-nav-view="cart"]:visible').first().click();
    await page.waitForTimeout(1300);
    const video=page.video();
    await context.close();
    const destination=path.join(root,mobile?'mobile-touch.webm':'desktop-categories.webm');
    await video.saveAs(destination);
    fs.unlinkSync(await video.path());
    manifest.push({file:path.basename(destination),viewport:size,
      input:mobile?'Native Chromium CDP touch gestures + trusted Playwright taps':'Mouse drag, hover, click',
      catalogSource:live.source,backend:'In-memory fixture; no orders or payments created'});
    console.log(destination);
  }
} finally {await browser.close();}
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
