import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',testMatch:'tracking-premium.spec.mjs',workers:1,retries:0,timeout:60000,
  reporter:[['list']],outputDir:'test-results-tracking-premium',
  use:{baseURL:'http://127.0.0.1:18252',serviceWorkers:'block',trace:'retain-on-failure'},
  projects:[{name:'android-chromium',use:{...devices['Pixel 7'],viewport:{width:390,height:844}}},
    {name:'iphone-webkit',use:{...devices['iPhone 13'],viewport:{width:390,height:844}}},
    {name:'desktop-chromium',use:{browserName:'chromium',viewport:{width:1440,height:900}}},
    {name:'desktop-webkit',use:{browserName:'webkit',viewport:{width:1440,height:900}}}],
  webServer:{command:'node scripts/realtime-relay.mjs 18252',url:'http://127.0.0.1:18252',reuseExistingServer:false}});
