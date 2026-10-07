import {chromium,webkit,devices} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {skipInstallInvitation,seedCartAboveMinimum} from '../tests/e2e/helpers.mjs';
for(const phase of ['before','after'])for(const [engine,type]of[['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch();
  try{for(const viewport of [{width:390,height:844},{width:430,height:932},{width:1440,height:900}]){
    const context=await browser.newContext({...(viewport.width<600?devices[engine==='webkit'?'iPhone 13':'Pixel 7']:{}),
      viewport,deviceScaleFactor:1,serviceWorkers:'block',baseURL:`http://127.0.0.1:${phase==='before'?18250:18251}`});
    const page=await context.newPage();await skipInstallInvitation(page);await page.goto('/?demo=1#catalog',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('html[data-taba-startup="ready"]');
    await seedCartAboveMinimum(page);
    await page.locator('[data-nav-view="cart"]:visible').first().click();
    await page.waitForTimeout(600);
    await page.locator('.checkout-form').scrollIntoViewIfNeeded();
    const directory=path.resolve('artifacts/tracking-premium-20261007',phase,engine);fs.mkdirSync(directory,{recursive:true});
    await page.screenshot({path:path.join(directory,`${viewport.width}x${viewport.height}-checkout.png`)});await context.close();
  }}finally{await browser.close();}
}
