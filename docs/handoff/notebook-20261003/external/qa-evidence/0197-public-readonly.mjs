import vm from 'node:vm';
import fs from 'node:fs';
const output = {};
for(const origin of ['https://la-taba.pages.dev','https://taba2-staging.pages.dev']) {
 try {
  const text=await (await fetch(origin+'/runtime-config.js',{signal:AbortSignal.timeout(15000)})).text();
  const context={}; vm.runInNewContext(text,context,{timeout:1000});
  const config=context.__LA_TABA_RUNTIME_CONFIG__; const repo=config?.repository;
  if(!repo) {output[origin]={runtime:'no-config'};continue;}
  const res=await fetch(repo.supabaseUrl+'/rest/v1/products?select=category,available,price,stock,is_verified,is_active&business_id=eq.'+repo.businessId,{headers:{apikey:repo.publishableKey},signal:AbortSignal.timeout(15000)});
  const data=await res.json();
  output[origin]={http:res.status,mode:config.mode,host:new URL(repo.supabaseUrl).hostname,businessId:repo.businessId,categories:Array.isArray(data)?Object.fromEntries([...new Set(data.map(p=>p.category))].map(c=>[c,{visible:data.filter(p=>p.category===c).length,purchasable:data.filter(p=>p.category===c&&p.available&&p.stock>0&&p.price>0).length}])):null};
 } catch(e){output[origin]={error:e.message};}
}
fs.writeFileSync('C:/1212/artifacts/taba-commerce-v3/baseline/public-catalog-audit.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
