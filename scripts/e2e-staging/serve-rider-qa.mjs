import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {leerSecreto} from '../e2e-production-sale/secretos-windows.mjs';
const key=leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
if(key?.usuario!=='ucbtjcurawxjwjdvvcvj'||!key?.secreto?.startsWith('sb_publishable_'))throw Error('STAGING_PUBLIC_KEY_REQUIRED');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const config={mode:'production',repository:{provider:'supabase',deploymentEnvironment:'staging',supabaseUrl:'https://ucbtjcurawxjwjdvvcvj.supabase.co',publishableKey:key.secreto,businessId:'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0',pollMs:1000}};
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
 try{
  if(req.method!=='GET')throw Error();
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  res.setHeader('Cache-Control','no-store');
  if(pathname==='/runtime-config.js'){res.setHeader('Content-Type','text/javascript');res.end(`globalThis.__LA_TABA_RUNTIME_CONFIG__=${JSON.stringify(config)};`);return}
  const relative=pathname==='/'?'index.html':pathname.slice(1);
  if(!/^(index\.html|(?:js|css|assets|images|icons|fonts)\/[^?]+|[^/]+\.(?:js|css|svg|ico|webmanifest))$/.test(relative))throw Error();
  const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep))throw Error();
  res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');res.end(await readFile(target));
 }catch{res.writeHead(404);res.end('Not found')}
}).listen(39092,'127.0.0.1',()=>console.log('Rider QA web on http://127.0.0.1:39092 — Staging only'));
