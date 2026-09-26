import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const origin='https://la-taba.pages.dev',project='wwcpogltfgzgkrlilbcd';
const runtime=await fetch(`${origin}/runtime-config.js`,{signal:AbortSignal.timeout(10000)});
if(!runtime.ok)throw Error('PRODUCTION_RUNTIME_UNAVAILABLE');
const text=await runtime.text();
if(!text.includes(`${project}.supabase.co`))throw Error('PRODUCTION_REF_MISMATCH');
const publishable=text.match(/publishableKey:\s*['"](sb_publishable_[A-Za-z0-9_-]+)['"]/)?.[1];
if(!publishable)throw Error('PUBLIC_KEY_UNAVAILABLE');
const client=createClient(`https://${project}.supabase.co`,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
const listed=await client.from('products').select('id,image_url,image_thumbnail_url')
 .eq('is_active',true).eq('available',true).eq('is_verified',true);
if(listed.error)throw Error(`PUBLIC_CATALOG_UNAVAILABLE:${listed.error.code}`);
const products=listed.data||[];
const results=[];
for(const product of products){
 for(const [kind,path] of [['main',product.image_url],['thumbnail',product.image_thumbnail_url]]){
  if(typeof path!=='string'||!/^assets\/[A-Za-z0-9._/-]+$/.test(path)||path.split('/').includes('..')){
   results.push({kind,path:null,validPath:false,ok:false});continue;
  }
  try{
   const response=await fetch(`${origin}/${path}`,{method:'HEAD',signal:AbortSignal.timeout(10000)});
   results.push({kind,path,validPath:true,ok:response.ok&&/^image\/(webp|png|jpeg)/i.test(response.headers.get('content-type')||''),status:response.status});
  }catch{results.push({kind,path,validPath:true,ok:false,status:'NETWORK_ERROR'})}
 }
}
const report={timestamp:new Date().toISOString(),origin,project,readOnly:true,products:products.length,
 images:results.length,mainPassed:results.filter(r=>r.kind==='main'&&r.ok).length,
 thumbnailsPassed:results.filter(r=>r.kind==='thumbnail'&&r.ok).length,
 failed:results.filter(r=>!r.ok).reduce((acc,r)=>{const k=String(r.status||'INVALID_PATH');acc[k]=(acc[k]||0)+1;return acc},{}),
 failedAssets:results.filter(r=>!r.ok).map(r=>({kind:r.kind,path:r.path,status:r.status||'INVALID_PATH'}))};
writeFileSync('artifacts/pilot-catalog-image-smoke.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!products.length||results.some(r=>!r.ok))process.exitCode=1;
