import fs from 'node:fs';
import crypto from 'node:crypto';
const BASE = 'https://taba2-staging.pages.dev';
const DIR = 'D:/1212/_claude-tmp/rc1/deploy';
const lista = fs.readFileSync('D:/1212/_claude-tmp/rc1/set-rc1.txt','utf8').trim().split('\n');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const esperado = (f) => { switch (f.split('.').pop()) {
  case 'js': return 'javascript'; case 'css': return 'css'; case 'html': return 'html';
  case 'json': return 'json'; case 'webmanifest': return 'manifest'; case 'webp': return 'webp';
  case 'svg': return 'svg'; case 'png': return 'png'; default: return null; } };
const malos = [], tipos = [];
let ok = 0;
const cola = [...lista];
async function worker() {
  while (cola.length) {
    const f = cola.shift();
    let r;
    try { r = await fetch(`${BASE}/${f}`, { redirect: 'follow' }); }
    catch (e) { malos.push(`RED ${f}: ${e.message}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const local = fs.readFileSync(`${DIR}/${f}`);
    const ct = (r.headers.get('content-type')||'').toLowerCase();
    const quiero = esperado(f);
    if (r.status !== 200) { malos.push(`${r.status} ${f}`); continue; }
    if (sha(buf) !== sha(local)) { malos.push(`BYTES ${f} (live ${buf.length} vs local ${local.length})`); continue; }
    if (quiero && !ct.includes(quiero)) { tipos.push(`${f} -> ${ct}`); continue; }
    ok++;
  }
}
await Promise.all(Array.from({length:12}, worker));
console.log(`OK (200 + bytes identicos + content-type correcto): ${ok}/${lista.length}`);
if (malos.length) { console.log('FALLAS:'); malos.slice(0,20).forEach(m=>console.log('  '+m)); }
if (tipos.length) { console.log('CONTENT-TYPE inesperado:'); tipos.slice(0,20).forEach(m=>console.log('  '+m)); }
if (!malos.length && !tipos.length) console.log('CERO fallas, CERO fallback HTML.');
