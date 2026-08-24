/*
 * Qué imagen muestra CADA producto en la tienda publicada, mirada con un
 * navegador de verdad.
 *
 * QUÉ CONTESTA, Y POR QUÉ NO ALCANZA CON MIRAR LA BASE
 * ----------------------------------------------------
 * Que `products.image_url` diga lo correcto no significa que el cliente vea lo
 * correcto: entre la fila y la tarjeta hay una compuerta de derechos, una
 * cadena de hashes, un respaldo por imagen rota y una hoja de estilos que puede
 * recortar el envase. Esto recorre la tienda publicada como una persona —home,
 * Recomendados del local, Gaseosas, ficha y carrito— y mide lo que quedó
 * pintado en la pantalla.
 *
 * Por cada producto comprado del catálogo audita cuatro cosas:
 *   1. qué archivo cargó realmente la tarjeta;
 *   2. que ese archivo sea el que la auditoría dice que le toca —el packshot
 *      de ESE SKU, o el recurso propio de TABA, y nunca el de otro producto—;
 *   3. que el envase entre entero: cuadrado, contenido, sin deformar;
 *   4. que un asset que no existe caiga al respaldo en vez de dejar el ícono
 *      roto.
 *
 * SOLO LEE. No inicia sesión, no agrega nada al pedido de nadie y no escribe.
 *
 *   node scripts/verificar-imagenes-en-vivo.mjs
 *   node scripts/verificar-imagenes-en-vivo.mjs --host https://otra.pages.dev
 *
 * En un sandbox cuyo borde termina la TLS hace falta confiar en su CA para que
 * el navegador pueda salir. `TABA_BROWSER_SPKI` recibe los hashes SPKI
 * separados por coma y `TABA_BROWSER_BIN` el ejecutable, cuando no es el que
 * Playwright trae. Sin esas variables no se toca nada de la verificación.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const argumento = (nombre, porDefecto) => {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice >= 0 ? process.argv[indice + 1] : porDefecto;
};
const HOST = argumento('host', 'https://la-taba.pages.dev').replace(/\/$/, '');
const SALIDA = argumento('salida', path.join(ROOT, 'artifacts/taba2-imagenes-en-vivo'));
const PLACEHOLDER = 'beverage-placeholder.svg';

let rojo = 0;
const medir = (nombre, ok, detalle = '') => {
  if (!ok) rojo += 1;
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  return ok;
};

const auditoria = JSON.parse(
  await fs.readFile(path.join(ROOT, 'docs/catalog/gondola-publica-imagenes.json'), 'utf8'),
);
/*
 * La tarjeta no dice el SKU: dice nombre, capacidad y, si es pack, la cantidad.
 * Es exactamente con eso que el cliente distingue una Coca de 1,5 L de una de
 * 2,25 L, así que es con eso que se reconoce.
 *
 * Gana el nombre MÁS LARGO que calce: «Sprite Zero 2,25 L» también contiene
 * «Sprite», y quedarse con el primero le adjudicaba a Sprite la tarjeta del
 * Zero. Y la cantidad es eliminatoria en los dos sentidos —una unidad no puede
 * reconocerse en una tarjeta que dice «Pack x12», ni al revés—, que es la misma
 * confusión que esta misión existe para no cometer.
 */
function esperadoParaTarjeta(texto) {
  return auditoria.filas
    .filter((fila) => {
      if (!texto.includes(fila.nombre)) return false;
      if (!texto.includes(fila.capacidad)) return false;
      const esPack = /Pack x\d+/.test(texto);
      return fila.unitsPerPack > 1
        ? texto.includes(`Pack x${fila.unitsPerPack}`)
        : !esPack;
    })
    .sort((a, b) => b.nombre.length - a.nombre.length)[0] || null;
}

await fs.mkdir(SALIDA, { recursive: true });

const args = ['--no-sandbox', '--disable-quic'];
if (process.env.TABA_BROWSER_SPKI) {
  args.push('--no-proxy-server');
  args.push('--disable-features=EncryptedClientHello,UseDnsHttpsSvcb,UseDnsHttpsSvcbAlpn');
  args.push(`--ignore-certificate-errors-spki-list=${process.env.TABA_BROWSER_SPKI}`);
}
const browser = await chromium.launch({
  args,
  ...(process.env.TABA_BROWSER_BIN ? { executablePath: process.env.TABA_BROWSER_BIN } : {}),
  ...(process.env.TABA_BROWSER_SPKI
    ? { env: { ...process.env, HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '' } }
    : {}),
});

// Sesión limpia: contexto nuevo, sin storage y sin service worker previo. Es
// exactamente la primera visita de alguien que nunca entró.
const context = await browser.newContext({
  serviceWorkers: 'allow',
  viewport: { width: 412, height: 915 },
});
const page = await context.newPage();
const respuestasMalas = [];
page.on('response', (r) => { if (r.status() >= 400) respuestasMalas.push(`${r.status()} ${r.url()}`); });

/** Lo que cada tarjeta terminó mostrando, leído del DOM ya pintado. */
const leerTarjetas = () => page.evaluate(() => [...document.querySelectorAll('.thumb')].map((thumb) => {
  const img = thumb.querySelector('img');
  const caja = img?.getBoundingClientRect();
  const tarjeta = thumb.closest('.product-card, .home-catalog-card, .recommendation-card, .cart-item, .modal-media, article, li');
  const texto = (tarjeta?.textContent || '').replace(/\s+/g, ' ').trim();
  const marco = thumb.getBoundingClientRect();
  return {
    alto: caja ? Math.round(caja.height) : 0,
    ancho: caja ? Math.round(caja.width) : 0,
    aria: thumb.getAttribute('aria-label') || '',
    clases: thumb.className,
    completa: Boolean(img?.complete),
    // La caja del `img` y la del `.thumb` NO son la misma: la hoja de estilos
    // agranda el packshot un 6% dentro del marco. Lo que tiene que entrar
    // entero es el envase DENTRO DEL MARCO, así que hacen falta las dos.
    marco: { alto: Math.round(marco.height), ancho: Math.round(marco.width) },
    marcoX: caja && marco ? Math.round(caja.left - marco.left) : 0,
    marcoY: caja && marco ? Math.round(caja.top - marco.top) : 0,
    naturalAlto: img?.naturalHeight || 0,
    naturalAncho: img?.naturalWidth || 0,
    objectFit: img ? getComputedStyle(img).objectFit : '',
    src: img?.currentSrc || img?.src || '',
    texto: texto.slice(0, 140),
  };
}));

console.log(`\nTIENDA PUBLICADA · ${HOST}\n`);

// ---------------------------------------------------------------- 1 · home
const respuesta = await page.goto(HOST, { waitUntil: 'domcontentloaded', timeout: 90_000 });
medir('la home responde 200', respuesta?.status() === 200, String(respuesta?.status()));
// Contar, no esperar visibilidad: la primera tarjeta puede nacer dentro de un
// carrusel fuera de pantalla, y eso no significa que la vitrina no cargó.
await page.waitForFunction(() => document.querySelectorAll('.thumb').length > 0, null, { timeout: 60_000 });
await page.waitForTimeout(6000);

const home = await leerTarjetas();
medir('la home dibuja tarjetas', home.length > 0, `${home.length}`);
medir('ninguna imagen rota en la home',
  home.every((t) => !t.completa || t.naturalAncho > 0),
  home.filter((t) => t.completa && !t.naturalAncho).map((t) => t.src).slice(0, 3).join(' '));
await page.screenshot({ path: path.join(SALIDA, '01-home.png') });

const textoHome = await page.locator('body').innerText();
medir('la sección Recomendados del local está en la home', textoHome.includes('Recomendados del local'));
medir('la sección Gaseosas está en la home', textoHome.includes('Gaseosas'));

// ------------------------------------------------- 2 · catálogo completo
// «Todas» es la puerta a la góndola entera; los «Ver todos» de la home abren
// una sección sola y dejarían la mayoría de los SKU sin mirar.
const todas = page.locator('.home-category-card', { hasText: 'Todas' }).first();
if (await todas.count()) {
  await todas.click();
  await page.waitForTimeout(4000);
}
await page.evaluate(async () => {
  // Las tarjetas cargan en diferido: sin recorrer la página, `currentSrc` de
  // las de más abajo está vacío y no se puede afirmar nada sobre ellas.
  for (let y = 0; y < document.body.scrollHeight; y += 600) {
    window.scrollTo(0, y);
    await new Promise((listo) => setTimeout(listo, 120));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(2500);
const catalogo = await leerTarjetas();
medir('el catálogo completo dibuja las 33 tarjetas comprables',
  catalogo.length >= auditoria.totalVisibles, `${catalogo.length}/${auditoria.totalVisibles}`);
await page.screenshot({ path: path.join(SALIDA, '02-catalogo.png') });

// -------------------------------------------- 3 · cada SKU con SU imagen
const vistos = [];
const desconocidos = [];
for (const tarjeta of catalogo) {
  const esperado = esperadoParaTarjeta(tarjeta.texto);
  if (!esperado) {
    desconocidos.push(tarjeta.texto);
    continue;
  }
  const usaPlaceholder = tarjeta.src.includes(PLACEHOLDER);
  const archivo = tarjeta.src.split('/').pop()?.split('?')[0] || '';
  vistos.push({ archivo, esperado: esperado.tipo, sku: esperado.sku, usaPlaceholder });

  if (esperado.tipo === 'REAL') {
    // El thumbnail vive al lado del master y comparte el prefijo del SKU: que
    // el archivo empiece con el SKU normalizado es lo que prueba que la tarjeta
    // no se comió el packshot del producto de al lado.
    medir(`${esperado.sku} muestra SU packshot`,
      !usaPlaceholder && archivo.startsWith(esperado.sku), archivo);
  } else {
    medir(`${esperado.sku} muestra el recurso propio de TABA`, usaPlaceholder, archivo);
  }
}
medir('todas las tarjetas del catálogo se reconocieron contra la auditoría',
  desconocidos.length === 0, desconocidos.slice(0, 3).join(' | '));

// ------------------------------------------- 4 · el envase entra entero
const geometria = catalogo.filter((t) => t.ancho > 0 && t.alto > 0);
const noCuadradas = geometria.filter((t) => Math.abs(t.marco.ancho - t.marco.alto) > 2);
medir('cada marco de miniatura es cuadrado',
  noCuadradas.length === 0,
  noCuadradas.map((t) => `${t.marco.ancho}x${t.marco.alto} (${t.clases.split(' ').pop()})`).slice(0, 4).join(' '));
medir('ninguna miniatura deforma el envase (object-fit: contain)',
  geometria.every((t) => t.objectFit === 'contain'),
  [...new Set(geometria.map((t) => t.objectFit))].join(' '));

/*
 * El recorte, medido donde importa. `object-fit: contain` escala el envase para
 * que entre en la caja del `img`; lo que hay que comprobar es que ese render,
 * corrido a las coordenadas del marco, no se salga del marco —que es lo que el
 * marco recorta con `overflow: hidden`—.
 */
const recorte = (t) => {
  if (!t.naturalAncho || !t.naturalAlto) return null;
  const escala = Math.min(t.ancho / t.naturalAncho, t.alto / t.naturalAlto);
  const ancho = t.naturalAncho * escala;
  const alto = t.naturalAlto * escala;
  const izquierda = t.marcoX + (t.ancho - ancho) / 2;
  const arriba = t.marcoY + (t.alto - alto) / 2;
  return {
    abajo: Math.round((arriba + alto - t.marco.alto) * 10) / 10,
    arriba: Math.round(-arriba * 10) / 10,
    derecha: Math.round((izquierda + ancho - t.marco.ancho) * 10) / 10,
    izquierda: Math.round(-izquierda * 10) / 10,
  };
};
// Un píxel de tolerancia: la grilla redondea, y dos columnas que miden 167 y 169
// son el redondeo, no una botella cortada.
const recortadas = geometria
  .map((t) => ({ recorte: recorte(t), tarjeta: t }))
  .filter(({ recorte: r }) => r && Math.max(r.abajo, r.arriba, r.derecha, r.izquierda) > 1);
medir('el envase entra entero en su marco: ninguna botella queda cortada',
  recortadas.length === 0,
  recortadas.map(({ recorte: r, tarjeta }) => (
    `${tarjeta.texto.slice(0, 34)} [${[r.izquierda, r.arriba, r.derecha, r.abajo].join('/')}]`
  )).slice(0, 3).join(' | '));
medir('cada tarjeta sin foto se anuncia con palabras',
  catalogo.filter((t) => t.clases.includes('uses-placeholder')).every((t) => t.aria.length > 0));

// --------------------------------------------- 5 · ficha de un producto
await page.locator('.thumb').first().click();
await page.waitForTimeout(2500);
const ficha = await leerTarjetas();
medir('la ficha del producto abre con imagen', ficha.length > 0);
medir('la imagen de la ficha no está rota',
  ficha.every((t) => !t.completa || t.naturalAncho > 0));
await page.screenshot({ path: path.join(SALIDA, '03-ficha.png') });

// ------------------------------------------------------------ 6 · carrito
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
const agregar = page.locator('.home-add-button, button:has-text("Agregar")').filter({ visible: true }).first();
if (await agregar.count()) {
  await agregar.scrollIntoViewIfNeeded();
  await agregar.click();
  await page.waitForTimeout(2000);
}
const irAlCarrito = page.locator('[data-open-cart], .topbar-cart, header .primary-button').filter({ visible: true }).first();
if (await irAlCarrito.count()) {
  await irAlCarrito.click();
  await page.waitForTimeout(2500);
}
const carrito = await leerTarjetas();
medir('el carrito dibuja la miniatura del producto', carrito.length > 0, `${carrito.length}`);
medir('la miniatura del carrito no está rota',
  carrito.every((t) => !t.completa || t.naturalAncho > 0));
await page.screenshot({ path: path.join(SALIDA, '04-carrito.png') });

// ------------------------- 7 · un asset inexistente cae al respaldo
const roto = await page.evaluate(() => new Promise((resolve) => {
  const img = document.createElement('img');
  img.className = 'thumb-img';
  const shell = document.createElement('span');
  shell.className = 'thumb has-photo';
  shell.append(img);
  document.body.append(shell);
  img.addEventListener('error', () => setTimeout(() => resolve({
    clases: shell.className,
    src: img.getAttribute('src') || '',
  }), 120), { once: true });
  img.src = 'assets/products/no-existe-este-packshot.webp';
  setTimeout(() => resolve({ clases: shell.className, src: img.getAttribute('src') || '' }), 4000);
}));
medir('un packshot inexistente cae al recurso propio de TABA',
  roto.src.includes(PLACEHOLDER) && roto.clases.includes('uses-placeholder'),
  `${roto.src} · ${roto.clases}`);

// ------------------------- 8 · nada de terceros sigue publicado
const AJENAS = [
  '/assets/catalog/products/gaseosas/coca-cola-original-2250ml-local-master.webp',
  '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/product.webp',
];
for (const ruta of AJENAS) {
  const r = await context.request.get(HOST + ruta);
  const tipo = r.headers()['content-type'] || '';
  medir(`no se sirve ${ruta.split('/').slice(-2).join('/')}`, !tipo.startsWith('image/'), tipo.split(';')[0]);
}
const propia = await context.request.get(`${HOST}/assets/products/${PLACEHOLDER}`);
medir('el recurso propio de TABA sí se sirve',
  (propia.headers()['content-type'] || '').startsWith('image/'), propia.headers()['content-type']);

/*
 * El corte es por ASSET, no por respuesta. La tienda le pregunta a la base si
 * Mercado Pago está disponible y sin sesión eso contesta 401: es el permiso
 * funcionando, no una imagen rota, y meterlo en el mismo cajón haría que esta
 * verificación diera rojo para siempre por algo que no mira. Las demás quedan
 * a la vista igual, como aviso.
 */
const ASSET = /\.(webp|png|svg|jpe?g|avif|css|js)(\?|$)/i;
const assetsEnError = respuestasMalas.filter((linea) => ASSET.test(linea));
medir('ningún asset del sitio responde con error',
  assetsEnError.length === 0, assetsEnError.slice(0, 3).join(' · '));
const otrosErrores = respuestasMalas.filter((linea) => !ASSET.test(linea));
if (otrosErrores.length) {
  console.log(`  aviso  ${otrosErrores.length} respuesta(s) de error ajenas a las imágenes · ${otrosErrores.slice(0, 2).join(' · ')}`);
}

/*
 * ------------------------- 9 · la góndola en un iPhone de verdad
 *
 * El recorrido de arriba mide en 412x915, que es el Android del comercio. Un
 * iPhone no es ese teléfono más angosto: tiene otro ancho, otra densidad y —lo
 * que importa acá— otra forma de resolver el encuadre si la página no declara
 * su viewport. Un contexto con `isMobile` NO equivale a un viewport de iPhone,
 * y esa confusión ya costó dos pruebas que afirmaban geometrías que en el
 * runner no ocurrían.
 *
 * Así que esto hace las dos cosas por separado: comprueba que la página
 * SERVIDA trae el meta viewport contractual, y después mide las cajas reales
 * que quedaron pintadas con el viewport de un iPhone 13.
 */
const iphone = await browser.newContext({
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'allow',
  /*
   * Este pase entra como quien YA respondió a la invitación de instalar. En un
   * iPhone sin decidir la tienda ofrece una hoja MODAL a los pocos segundos, y
   * esa hoja tapa la góndola: las cajas se miden igual detrás, pero la captura
   * —que es la evidencia visual— queda mostrando el aviso en vez del catálogo.
   * `TABA_INSTALL_PROMPT_V1` no es un interruptor de prueba: es el estado que
   * deja alguien que tocó «Ahora no», que es la mayoría de las visitas. La
   * primera visita sin decidir sigue cubierta por el recorrido de arriba, que
   * abre con sesión limpia.
   */
  storageState: {
    cookies: [],
    origins: [{
      localStorage: [{
        name: 'TABA_INSTALL_PROMPT_V1',
        value: JSON.stringify({
          at: '2026-01-01T00:00:00.000Z', decision: 'declined', platform: 'ios', v: 1,
        }),
      }],
      origin: HOST,
    }],
  },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    + ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
});
const movil = await iphone.newPage();
await movil.goto(HOST, { waitUntil: 'domcontentloaded', timeout: 90_000 });

const metaViewport = await movil.evaluate(
  () => document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
);
medir('la página servida declara el meta viewport contractual',
  /width=device-width/.test(metaViewport) && /initial-scale=1/.test(metaViewport),
  metaViewport || '(no hay meta viewport)');

await movil.waitForFunction(() => document.querySelectorAll('.thumb').length > 0, null, { timeout: 60_000 });
await movil.waitForTimeout(6000);

const enIphone = await movil.evaluate(() => [...document.querySelectorAll('.thumb')].map((thumb) => {
  const img = thumb.querySelector('img');
  const caja = img?.getBoundingClientRect();
  const marco = thumb.getBoundingClientRect();
  return {
    alto: caja ? Math.round(caja.height) : 0,
    ancho: caja ? Math.round(caja.width) : 0,
    marcoAlto: Math.round(marco.height),
    marcoAncho: Math.round(marco.width),
    objectFit: img ? getComputedStyle(img).objectFit : '',
    sobresale: caja && marco
      ? Math.round(Math.max(0, marco.left - caja.left, marco.top - caja.top,
        caja.right - marco.right, caja.bottom - marco.bottom))
      : 0,
  };
}));
medir('el iPhone dibuja la góndola completa', enIphone.length > 0, `${enIphone.length} miniaturas`);
medir('cada marco sigue siendo cuadrado en iPhone',
  enIphone.every((t) => Math.abs(t.marcoAncho - t.marcoAlto) <= 1),
  enIphone.filter((t) => Math.abs(t.marcoAncho - t.marcoAlto) > 1)
    .map((t) => `${t.marcoAncho}x${t.marcoAlto}`).slice(0, 3).join(' '));
medir('ninguna miniatura deforma el envase en iPhone',
  enIphone.every((t) => t.objectFit === 'contain'),
  [...new Set(enIphone.map((t) => t.objectFit))].join(','));
/*
 * El packshot se agranda un 6% dentro del marco a propósito, así que sobresalir
 * un par de píxeles es el diseño y no un defecto. Lo que no puede pasar es que
 * el envase se salga tanto que quede cortado.
 */
medir('el envase entra en su marco en iPhone: ninguna botella cortada',
  enIphone.every((t) => t.sobresale <= Math.ceil(t.marcoAncho * 0.06) + 2),
  `sobresale máx ${Math.max(0, ...enIphone.map((t) => t.sobresale))}px`);
/* Nada puede empujar el documento a lo ancho: eso es scroll horizontal. */
const anchoDoc = await movil.evaluate(() => ({
  cliente: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
}));
medir('la góndola no desborda a lo ancho en iPhone',
  anchoDoc.scroll <= anchoDoc.cliente + 1,
  `scroll ${anchoDoc.scroll} vs viewport ${anchoDoc.cliente}`);
await movil.screenshot({ path: path.join(SALIDA, '05-iphone.png') });
await iphone.close();

await fs.writeFile(
  path.join(SALIDA, 'resultado.json'),
  `${JSON.stringify({
    host: HOST, iphone: enIphone.length, metaViewport, tarjetas: vistos, verificadoEl: new Date().toISOString(),
  }, null, 2)}\n`,
  'utf8',
);

console.log('');
console.log(`Capturas y detalle: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
console.log(rojo === 0 ? 'IMÁGENES EN VIVO: VERDE' : `IMÁGENES EN VIVO: ${rojo} en rojo`);
await browser.close();
process.exit(rojo === 0 ? 0 : 1);
