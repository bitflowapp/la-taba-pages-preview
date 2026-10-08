import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const directory=path.resolve('artifacts/la-taba-final-integration-20261007/network-cache');
const jobs=new Map();
export async function cacheMapResources(context){
  fs.mkdirSync(directory,{recursive:true});
  await context.route(/^https:\/\/(?:unpkg\.com|tiles\.openfreemap\.org)\//,async route=>{
    const url=route.request().url(),key=crypto.createHash('sha256').update(url).digest('hex');
    const bodyFile=path.join(directory,key+'.bin'),metaFile=path.join(directory,key+'.json');
    try{
      if(!fs.existsSync(bodyFile)||!fs.existsSync(metaFile)){
        if(!jobs.has(key))jobs.set(key,(async()=>{
          const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
          if(!response.ok)throw new Error(`Map resource HTTP ${response.status}: ${url}`);
          const body=Buffer.from(await response.arrayBuffer());
          const metadata={url,status:response.status,contentType:response.headers.get('content-type')||'application/octet-stream',
            bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex'),fetchedAt:new Date().toISOString()};
          fs.writeFileSync(bodyFile,body);fs.writeFileSync(metaFile,JSON.stringify(metadata,null,2)+'\n');
        })().finally(()=>jobs.delete(key)));
        await jobs.get(key);
      }
      const metadata=JSON.parse(fs.readFileSync(metaFile,'utf8'));
      await route.fulfill({status:metadata.status,contentType:metadata.contentType,headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(bodyFile)});
    }catch(error){console.warn(String(error));await route.abort();}
  });
}
