import vm from 'node:vm';
const c={};vm.runInNewContext(await(await fetch('https://taba2-staging.pages.dev/runtime-config.js')).text(),c);const r=c.__LA_TABA_RUNTIME_CONFIG__.repository;
const resp=await fetch(r.supabaseUrl+'/rest/v1/products?select=sku,name,brand,category,capacity_value,capacity_unit,image_url&business_id=eq.'+r.businessId,{headers:{apikey:r.publishableKey}});console.log(await resp.text());
