// Navegador real contra el host canonico de produccion.
//
// Recorre el camino que hace una persona: portada -> catalogo completo -> ficha
// de un producto. Mide que la tienda venda, que las tarjetas SIN foto se vean
// dignas (sin icono roto ni salto de maquetacion) y que ninguna imagen de
// tercero siga siendo alcanzable en el sitio publicado.
import { chromium } from 'playwright';

const HOST = 'https://la-taba.pages.dev';
const paso = (n, ok, d = '') => {
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${n}${d ? ` · ${d}` : ''}`);
  return ok;
};
let rojo = 0;
const medir = (n, ok, d = '') => { if (!paso(n, ok, d)) rojo += 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const fallidas = [];
page.on('requestfailed', (r) => fallidas.push(r.url()));
const errores = [];
page.on('response', (r) => { if (r.status() >= 400) errores.push(`${r.status()} ${r.url()}`); });

await page.goto(HOST, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);

// 1 · la persiana esta abierta
const portada = await page.locator('body').innerText();
medir('la tienda se anuncia abierta', portada.includes('Pedidos online habilitados'),
  portada.includes('no disponibles') ? 'dice NO disponibles' : '');
medir('la direccion del comercio esta publicada', portada.includes('Mendoza 827'));

// 2 · el catalogo completo
const verTodo = page.locator('text=Ver catálogo completo').first();
if (await verTodo.count()) await verTodo.click();
else await page.locator('[data-view="catalogo"], text=Catálogo').first().click();
await page.waitForTimeout(3000);

const tarjetas = await page.locator('.thumb').count();
medir('la vitrina dibuja tarjetas', tarjetas > 0, `${tarjetas}`);

const texto = await page.locator('body').innerText();
for (const nombre of ['Coca-Cola Original', 'Coca-Cola Zero', 'Sprite', 'Fanta Naranja']) {
  medir(`aparece ${nombre}`, texto.includes(nombre));
}
medir('se ven los cuatro precios autorizados', texto.includes('17.100') && texto.includes('19.999'), texto.includes('Precio pendiente') ? 'dice Precio pendiente' : '');

// 3 · las tarjetas sin foto se ven dignas
// Cuantas tarjetas llevan foto y cuantas el recurso propio de TABA es un dato
// del catalogo, no una constante: el dia que se publique un packshot mas, este
// numero cambia sin que nada este mal. Lo que si tiene que valer siempre es que
// cada tarjeta caiga de un lado o del otro, y ninguna quede sin ninguno de los
// dos. Que muestre la foto de SU producto lo mide
// scripts/verificar-imagenes-en-vivo.mjs, contra la auditoria versionada.
const placeholders = await page.locator('.thumb.uses-placeholder').count();
const conFoto = await page.locator('.thumb.has-photo').count();
medir('cada tarjeta declara si lleva foto o el recurso propio de TABA',
  placeholders + conFoto === tarjetas,
  `placeholder ${placeholders} · con foto ${conFoto} · tarjetas ${tarjetas}`);

const rotas = await page.evaluate(() => [...document.querySelectorAll('img')]
  .filter((i) => i.complete && i.naturalWidth === 0)
  .map((i) => i.currentSrc || i.src));
medir('ninguna imagen rota', rotas.length === 0, rotas.slice(0, 3).join(' '));

const medir1 = async () => page.evaluate(() => [...document.querySelectorAll('.thumb-img')]
  .map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
const antesDeEsperar = await medir1();
await page.waitForTimeout(1500);
const despues = await medir1();
// Un salto de maquetacion es que el hueco CAMBIE de tamano una vez cargado. Que
// dos columnas midan 167 y 169 es el redondeo de la grilla, no un salto.
medir('las miniaturas no cambian de tamano al cargar (sin salto de maquetacion)',
  JSON.stringify(antesDeEsperar) === JSON.stringify(despues),
  JSON.stringify(despues.slice(0, 2)));
medir('cada miniatura es cuadrada',
  despues.every(([w, h]) => Math.abs(w - h) <= 2),
  despues.map((m) => m.join('x')).join(' '));

const etiquetas = await page.locator('.thumb.uses-placeholder[aria-label]').count();
medir('cada tarjeta sin foto se anuncia con palabras', etiquetas === placeholders, `${etiquetas}/${placeholders}`);

await page.screenshot({ path: 'vitrina-catalogo.png', fullPage: false });

// 4 · la ficha de un producto
await page.locator('.thumb').first().click();
await page.waitForTimeout(1500);
const ficha = await page.locator('body').innerText();
medir('la ficha del producto abre con su precio', ficha.includes('17.100') || ficha.includes('19.999'));
await page.screenshot({ path: 'vitrina-ficha.png', fullPage: false });

// 5 · ninguna foto de tercero sigue publicada
// Pages contesta 200 con el index.html para lo que no existe: lo que decide es
// el tipo de contenido, no el codigo de estado.
const AJENAS = [
  '/assets/catalog/products/gaseosas/sprite-sin-azucar-600ml-master.webp',
  '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/product.webp',
];
for (const ruta of AJENAS) {
  const r = await page.request.get(HOST + ruta);
  const tipo = r.headers()['content-type'] || '';
  medir(`ya no se sirve ${ruta.split('/').pop()}`, !tipo.startsWith('image/'), tipo.split(';')[0]);
}
const propia = await page.request.get(`${HOST}/assets/products/beverage-placeholder.svg`);
medir('el recurso propio de TABA si se sirve',
  (propia.headers()['content-type'] || '').startsWith('image/'), propia.headers()['content-type']);

medir('sin respuestas de error', errores.length === 0, errores.slice(0, 2).join(' · '));
medir('sin pedidos de red fallidos', fallidas.length === 0, fallidas.slice(0, 2).join(' '));

console.log(rojo === 0 ? '\nVITRINA PRODUCTIVA: VERDE' : `\nVITRINA PRODUCTIVA: ${rojo} en rojo`);
await browser.close();
process.exit(rojo === 0 ? 0 : 1);
