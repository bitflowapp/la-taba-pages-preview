// Auditoría: ¿todas las entradas del precache del worker VIVO responden bien?
// cache.addAll es todo-o-nada: una sola que falle deja al worker sin instalar.
const ORIGIN = 'https://la-taba.pages.dev/';
const sw = await (await fetch(ORIGIN + 'sw.js')).text();
const start = sw.indexOf('const ASSETS');
const end = sw.indexOf('];', start);
const list = [...sw.slice(start, end).matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1].slice(2));
console.log('CACHE_NAME vivo:', /const CACHE_NAME = '([^']+)'/.exec(sw)[1]);
console.log('entradas de precache:', list.length);

let bytes = 0;
const malos = [];
const limite = 8;
let i = 0;
async function worker() {
  while (i < list.length) {
    const rel = list[i++];
    const url = new URL(rel, ORIGIN).href;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const buf = await r.arrayBuffer();
      bytes += buf.byteLength;
      const ruta = rel.split('?')[0].toLowerCase();
      const esperado = ruta.endsWith('.css') ? 'text/css'
        : (ruta.endsWith('.js') || ruta.endsWith('.mjs')) ? 'javascript' : null;
      const cuerpo = new TextDecoder().decode(new Uint8Array(buf).subarray(0, 96)).trimStart().toLowerCase();
      const pareceHtml = cuerpo.startsWith('<!doctype html') || cuerpo.startsWith('<html');
      if (!r.ok) malos.push([rel, 'HTTP ' + r.status]);
      else if (esperado && !ct.includes(esperado)) malos.push([rel, 'content-type ' + ct]);
      else if (esperado && pareceHtml) malos.push([rel, 'cuerpo HTML']);
    } catch (e) { malos.push([rel, 'fetch: ' + e.message]); }
  }
}
await Promise.all(Array.from({ length: limite }, worker));
console.log('peso total del precache:', (bytes / 1024).toFixed(0), 'KB');
console.log('entradas problematicas:', malos.length);
malos.forEach(([a, b]) => console.log('  ·', a, '->', b));
