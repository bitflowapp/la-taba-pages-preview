/*
 * Auditoría del salto de caché, sobre un MISMO origen.
 *
 * Un service worker vive atado al origen, así que simular una actualización
 * pidiéndole al navegador dos puertos distintos no prueba nada: serían dos
 * PWAs. Este arnés levanta UN servidor y le cambia la raíz de documentos a
 * mitad de la corrida, que es exactamente lo que le pasa a un cliente cuando
 * se publica.
 *
 *   ANTES   = 73fdb4c, lo que staging sirve HOY (v56 · CSS ?v=46 con @imports en 45)
 *   DESPUES = la candidata integrada        (v57 · CSS ?v=47 · app ?v=40)
 *
 * Lo que se quiere demostrar no es que "actualiza": es que NO MEZCLA. Que
 * después del salto no quede ni una hoja ni un módulo de la versión anterior
 * sirviendo debajo del HTML nuevo.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.join(process.env.TABA_REPO, 'package.json'));
const { chromium, devices } = req('@playwright/test');

const RAIZ_ANTES = process.env.TABA_RAIZ_ANTES || 'D:/1212/worktrees/taba2-live-tracking-ux';
const RAIZ_DESPUES = 'D:/1212/worktrees/taba2-customer-experience';
const PUERTO = 8752;

let raiz = RAIZ_ANTES;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const pedidos = [];
const servidor = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PUERTO}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
  // `path.join` normaliza a barras INVERTIDAS en Windows, así que comparar el
  // resultado contra una raíz escrita con barras normales da falso siempre y
  // el servidor devuelve 404 a todo. Se resuelven las dos puntas.
  const raizAbs = path.resolve(raiz);
  const archivo = path.resolve(path.join(raizAbs, rel));
  pedidos.push({ raiz: raiz === RAIZ_ANTES ? 'antes' : 'despues', url: request.url });
  if (!archivo.startsWith(raizAbs) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    response.writeHead(404).end('no');
    return;
  }
  /*
   * La cabecera NO es un detalle del arnés: decide el resultado. Medidas de
   * los destinos reales el 2026-08-10:
   *   GitHub Pages (bitflowapp.github.io/la-taba-pages-preview) → max-age=600
   *   staging      (taba2-staging.pages.dev, Cloudflare)        → max-age=0, must-revalidate
   * Con la primera el navegador PUEDE servir un módulo viejo sin preguntar;
   * con la segunda está obligado a revalidar. Se corre con las dos.
   */
  response.writeHead(200, {
    'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
    'Cache-Control': process.env.TABA_CACHE_HEADER || 'max-age=600',
    ETag: `"${fs.statSync(archivo).mtimeMs}-${fs.statSync(archivo).size}"`,
  });
  fs.createReadStream(archivo).pipe(response);
});
await new Promise((r) => servidor.listen(PUERTO, '127.0.0.1', r));

const estado = async (page) => page.evaluate(async () => {
  const claves = await caches.keys();
  const hojas = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href'));
  // Las hojas importadas son las que el `?v` del shell NO protege: se miran una
  // por una, y se comprueba que el navegador pudo leer sus reglas (si una no
  // cargó, `cssRules` da 0 y el estilo simplemente no está).
  const importadas = [...document.styleSheets]
    .flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
    .filter((r) => r.constructor.name === 'CSSImportRule')
    .map((r) => { let n = 0; try { n = r.styleSheet.cssRules.length; } catch { n = -1; } return { href: r.href.split('/').slice(-1)[0], reglas: n }; });
  const recursos = performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname + new URL(r.name).search);
  return {
    claves,
    controlado: !!navigator.serviceWorker.controller,
    hojas,
    importadas,
    recursos,
    reglasTotales: [...document.styleSheets].reduce((a, s) => { try { return a + s.cssRules.length; } catch { return a; } }, 0),
  };
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-AR' });
const errores = [];
const page = await context.newPage();
page.on('pageerror', (e) => errores.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

/*
 * Esperar `serviceWorker.ready` a secas es una trampa: si `install` rechaza
 * —un solo asset del manifiesto que no responde alcanza— la promesa no se
 * cumple NUNCA y el arnés se cuelga sin decir por qué. Acá se espera con
 * límite y, si no llega, se cuenta el estado real del registro.
 */
async function esperarControl(page, etiqueta) {
  try {
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
    return true;
  } catch {
    const diag = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return {
        hayRegistro: !!reg,
        installing: reg?.installing?.state ?? null,
        waiting: reg?.waiting?.state ?? null,
        active: reg?.active?.state ?? null,
        claves: await caches.keys(),
      };
    }).catch((e) => ({ error: String(e) }));
    console.log(`   [${etiqueta}] el worker no tomó control:`, JSON.stringify(diag));
    return false;
  }
}

console.log('── 1. cliente instala la versión que sirve staging hoy (v56)');
await page.goto(`http://127.0.0.1:${PUERTO}/?demo=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
if (!await esperarControl(page, 'instalación')) {
  console.log('   se sigue igual: lo que importa después es qué queda en caché.');
}
await page.waitForTimeout(3000);
const viejo = await estado(page);
console.log('   caché:', viejo.claves.join(', '));
console.log('   shell:', viejo.hojas.join(', '));
console.log('   @imports:', viejo.importadas.map((i) => i.href).slice(0, 3).join(', '), '…');

/*
 * Arranque REAL de la tienda, no "la página respondió 200". El módulo del
 * cliente marca `data-taba-startup="ready"` cuando terminó de montar; si el
 * grafo de imports no linkea, ese atributo no llega nunca y lo que el cliente
 * ve es una pantalla muerta.
 */
const arranque = async () => page.evaluate(() => ({
  listo: document.documentElement.getAttribute('data-taba-startup'),
  productos: document.querySelectorAll('[data-add-product]').length,
  texto: (document.body.innerText || '').trim().length,
}));

const erroresAntesDePublicar = errores.length;
console.log('   arranque:', JSON.stringify(await arranque()));

console.log('\n── 2. se publica la candidata: misma URL, contenido nuevo');
raiz = RAIZ_DESPUES;
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
const arranquePrimerVisita = await arranque();
const erroresPrimerVisita = errores.slice(erroresAntesDePublicar);
console.log('   arranque en la PRIMERA visita tras publicar:', JSON.stringify(arranquePrimerVisita));
console.log('   errores en esa visita:', erroresPrimerVisita.length ? erroresPrimerVisita : 'ninguno');
const esperando = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { waiting: !!reg?.waiting, installing: !!reg?.installing, active: reg?.active?.state };
});
console.log('   worker nuevo esperando confirmación del cliente:', esperando.waiting || esperando.installing);

console.log('\n── 3. el cliente toca «Actualizar ahora»');
await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  (reg?.waiting || reg?.installing)?.postMessage('skip-waiting');
});
await page.waitForTimeout(2000);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await esperarControl(page, 'tras actualizar');
await page.waitForTimeout(4000);
const nuevo = await estado(page);
console.log('   caché:', nuevo.claves.join(', '));
console.log('   shell:', nuevo.hojas.join(', '));
console.log('   arranque tras actualizar:', JSON.stringify(await arranque()));

console.log('\n── 4. ¿quedó algo de la versión anterior debajo del HTML nuevo?');
const viejas = nuevo.recursos.filter((r) => /\?v=(45|46|38|39)\b/.test(r));
const importadasViejas = nuevo.importadas.filter((i) => !/\?v=47$/.test(i.href));
const importadasVacias = nuevo.importadas.filter((i) => i.reglas <= 0);
console.log('   recursos con ?v anterior:', viejas.length ? viejas.join(', ') : 'NINGUNO');
console.log('   @imports fuera de v47   :', importadasViejas.length ? importadasViejas.map((i) => i.href).join(', ') : 'NINGUNO');
console.log('   @imports sin reglas     :', importadasVacias.length ? importadasVacias.map((i) => i.href).join(', ') : 'NINGUNO');
console.log('   cachés simultáneas      :', nuevo.claves.length);

console.log('\n── 5. sin red, con la caché nueva ya asentada');
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('   reload offline falló:', e.message));
await page.waitForTimeout(3000);
const offline = await estado(page);
const homeVisible = await page.locator('[data-active-view], .app-shell').first().isVisible().catch(() => false);
console.log('   hojas con reglas:', offline.importadas.filter((i) => i.reglas > 0).length, 'de', offline.importadas.length);
console.log('   reglas CSS totales:', offline.reglasTotales);
console.log('   shell visible:', homeVisible);
await context.setOffline(false);

const veredicto = {
  cacheUnica: nuevo.claves.length === 1 && nuevo.claves[0] === 'la-taba-runtime-v57-vidriera-y-seguimiento',
  sinRecursosViejos: viejas.length === 0,
  importsCoherentes: importadasViejas.length === 0 && importadasVacias.length === 0,
  offlineConEstilos: offline.importadas.length > 0 && offline.importadas.every((i) => i.reglas > 0) && homeVisible,
  errores,
};
console.log('\n── VEREDICTO');
for (const [k, v] of Object.entries(veredicto)) {
  if (k === 'errores') continue;
  console.log(`   ${v ? 'PASS' : 'FALLA'}  ${k}`);
}
console.log('   errores de consola/página:', errores.length ? errores.slice(0, 5) : 'ninguno');
fs.writeFileSync('upgrade-sw.json', JSON.stringify({ viejo, nuevo, offline, veredicto }, null, 2));

await context.close();
await browser.close();
servidor.close();
