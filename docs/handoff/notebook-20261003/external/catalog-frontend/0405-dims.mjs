const urls = [
 'https://la-taba.pages.dev/assets/products/sprite-botella-pet-500-ml-pack-x12-07620ef3d3aa792c-09a508b8102bd8a5.webp',
 'https://la-taba.pages.dev/assets/products/sprite-botella-pet-500-ml-pack-x12-07620ef3d3aa792c-thumb-49fb5075276d3ebb.webp',
];
function webpSize(buf){const tag=buf.toString('ascii',12,16);
 if(tag==='VP8X')return {w:(buf.readUIntLE(24,3)&0xFFFFFF)+1,h:(buf.readUIntLE(27,3)&0xFFFFFF)+1};
 if(tag==='VP8 ')return {w:buf.readUInt16LE(26)&0x3FFF,h:buf.readUInt16LE(28)&0x3FFF};
 if(tag==='VP8L'){const b=buf.readUInt32LE(21);return {w:(b&0x3FFF)+1,h:((b>>14)&0x3FFF)+1};}
 return {tag};}
for(const u of urls){const r=await fetch(u);const b=Buffer.from(await r.arrayBuffer());console.log(r.status,(b.length/1024).toFixed(1)+'KB',JSON.stringify(webpSize(b)),r.headers.get('content-type'),u.split('/').pop().slice(0,40));}
