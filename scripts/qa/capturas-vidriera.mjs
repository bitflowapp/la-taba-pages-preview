/*
 * La vidriera, fotografiada donde el cliente la mira.
 *
 * QUÉ MIDE QUE UN TEST NO PUEDE
 * -----------------------------
 * Un test dice si el nodo existe. Esto dice si la góndola SE VE bien: cuántos
 * productos entran antes del pliegue, qué fracción de la tarjeta ocupa la foto,
 * y si el nombre entra sin cortarse. Son las siete superficies que el cliente
 * recorre para comprar, en los tres anchos reales de un teléfono.
 *
 * NO ESCRIBE NADA en la tienda: el carrito vive en el almacenamiento del
 * navegador y sumar una unidad no crea ningún pedido. No inicia sesión.
 *
 *   node scripts/qa/capturas-vidriera.mjs --salida artifacts/x --origen https://la-taba.pages.dev
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

const ORIGEN = arg('--origen', process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev');
const SALIDA = path.resolve(ROOT, arg('--salida', 'artifacts/taba-premium-catalog/capturas'));
const ETIQUETA = arg('--etiqueta', 'captura');

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANCHOS = [
  { id: 'iphone-se', width: 320, height: 568 },
  { id: 'iphone-14', width: 390, height: 844 },
  { id: 'iphone-plus', width: 430, height: 932 },
];

const informe = { origen: ORIGEN, etiqueta: ETIQUETA, superficies: [], medidas: {}, errores: [] };

async function nuevaPagina(navegador, { width, height }) {
  const contexto = await navegador.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent: IPHONE,
    serviceWorkers: 'allow',
    locale: 'es-AR',
  });
  const pagina = await contexto.newPage();
  pagina.on('console', (m) => {
    if (m.type() === 'error') informe.errores.push(`[${width}] ${m.text().slice(0, 200)}`);
  });
  pagina.on('pageerror', (e) => informe.errores.push(`[${width}] pageerror ${String(e).slice(0, 200)}`));
  return { contexto, pagina };
}

async function abrir(pagina, { conInvitacion = false } = {}) {
  await pagina.goto(ORIGEN, { waitUntil: 'networkidle', timeout: 120_000 });
  await pagina.waitForSelector('[data-add-product]', { timeout: 60_000 });
  await pagina.waitForTimeout(2200);
  // La invitación a instalar es un <dialog> que se abre sola en la primera
  // visita y cubre el tercio inferior, barra de navegación incluida. Se anota
  // si apareció —es un hecho de la tienda— y se cierra para poder recorrerla.
  const hoja = pagina.locator('[data-install-sheet][open], dialog.install-sheet[open]');
  const apareció = (await hoja.count()) > 0;
  informe.medidas.invitacion_instalar_en_primera_visita = apareció;
  if (apareció && !conInvitacion) {
    for (const cerrar of ['[data-install-close]', '[data-install-decline]', '[data-install-done]']) {
      const b = pagina.locator(`${cerrar}:visible`).first();
      if (await b.count()) {
        await b.click({ timeout: 5000 }).catch(() => {});
        break;
      }
    }
    await pagina.keyboard.press('Escape').catch(() => {});
    await pagina.waitForTimeout(700);
  }
}

async function capturar(pagina, nombre, { completa = false } = {}) {
  const archivo = path.join(SALIDA, `${nombre}.png`);
  await fs.mkdir(path.dirname(archivo), { recursive: true });
  await pagina.screenshot({ path: archivo, fullPage: completa });
  informe.superficies.push({ nombre, archivo: path.relative(ROOT, archivo).replaceAll('\\', '/'), completa });
  console.log(`  > ${nombre}`);
}

/** El pliegue: cuántas tarjetas y cuántos precios se ven SIN scrollear. */
async function medirPliegue(pagina) {
  return pagina.evaluate(() => {
    const alto = window.innerHeight;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.top < alto && r.bottom > 0 && r.width > 0;
    };
    const tarjetas = [...document.querySelectorAll('[data-add-product]')].map(
      (b) => b.closest('article, li, .product-card, .home-best-card, .offer-card') || b.parentElement,
    );
    const unicas = [...new Set(tarjetas.filter(Boolean))];
    const enPliegue = unicas.filter(visible);
    const precios = enPliegue.filter((c) => /\$\s?\d/.test(c.textContent || ''));
    const imagenes = [...document.querySelectorAll('img')].filter(visible);
    return {
      alturaViewport: alto,
      tarjetasEnPliegue: enPliegue.length,
      preciosEnPliegue: precios.length,
      imagenesEnPliegue: imagenes.length,
      desbordeHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

/** Qué fracción de la tarjeta ocupa la foto, y si el nombre se corta. */
async function medirTarjetas(pagina) {
  return pagina.evaluate(() => {
    const grid = document.querySelector('[data-product-grid]');
    if (!grid) return null;
    const tarjetas = [...grid.querySelectorAll('[data-add-product]')]
      .map((b) => b.closest('article, li, .product-card'))
      .filter(Boolean);
    const muestras = [...new Set(tarjetas)].slice(0, 12).map((c) => {
      const rc = c.getBoundingClientRect();
      const media = c.querySelector('img, [class*="media"]');
      const rm = media ? media.getBoundingClientRect() : null;
      const nombre = c.querySelector('h3, h4, [class*="name"], [class*="title"]');
      const cortado = nombre ? nombre.scrollHeight > nombre.clientHeight + 1 : null;
      return {
        alto: Math.round(rc.height),
        ancho: Math.round(rc.width),
        altoMedia: rm ? Math.round(rm.height) : 0,
        fraccionMedia: rm && rc.height ? Number((rm.height / rc.height).toFixed(3)) : 0,
        nombreCortado: cortado,
        texto: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      };
    });
    const r = grid.getBoundingClientRect();
    return {
      columnas: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      anchoGrilla: Math.round(r.width),
      muestras,
    };
  });
}

/** Metadata técnica que el cliente nunca debería leer. */
const FEA = String.raw`botella-pet|pet-\d|lata-\d|packaging_type|variant_code|sold_as_pack|units_per_pack|-\d{3,4}ml|TABA2`;
async function buscarMetadataTecnica(pagina, superficie) {
  const hallazgos = await pagina.evaluate((patron) => {
    const re = new RegExp(patron, 'i');
    const salidas = [];
    const raiz = document.querySelector('main') || document.body;
    const paseo = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = paseo.nextNode())) {
      const t = (n.nodeValue || '').trim();
      if (!t || t.length > 200) continue;
      if (!n.parentElement || n.parentElement.offsetParent === null) continue;
      if (re.test(t)) salidas.push(t.slice(0, 120));
    }
    const etiquetas = [...document.querySelectorAll('[aria-label]')]
      .filter((e) => e.offsetParent !== null && re.test(e.getAttribute('aria-label')))
      .map((e) => `aria-label: ${e.getAttribute('aria-label').slice(0, 120)}`);
    return [...new Set([...salidas, ...etiquetas])];
  }, FEA);
  if (hallazgos.length) informe.medidas[`metadata_tecnica_${superficie}`] = hallazgos;
  return hallazgos;
}

// La navegación existe seis veces en el DOM (barra superior, barra inferior,
// atajos). En un teléfono sólo una es visible: pedir la primera a secas clickea
// la de escritorio, que está oculta, y la espera se agota.
async function irA(pagina, vista) {
  const movil = pagina.locator(`.mobile-nav [data-nav-view="${vista}"]`).first();
  const destino = (await movil.count()) ? movil : pagina.locator(`[data-nav-view="${vista}"]:visible`).first();
  await destino.click({ timeout: 20_000 });
  await pagina.waitForTimeout(1100);
}

/** Una superficie que falla no puede llevarse puesto el informe entero. */
async function paso(nombre, fn) {
  try {
    await fn();
  } catch (error) {
    informe.errores.push(`paso «${nombre}»: ${String(error).split('\n')[0].slice(0, 200)}`);
    console.log(`  ! ${nombre}: ${String(error).split('\n')[0].slice(0, 120)}`);
  }
}

const navegador = await chromium.launch();
try {
  console.log(`\n-- VIDRIERA · ${ORIGEN} · ${ETIQUETA}`);

  // Los tres anchos: home, sin scrollear y entera.
  for (const ancho of ANCHOS) {
    const { contexto, pagina } = await nuevaPagina(navegador, ancho);
    await abrir(pagina);
    await capturar(pagina, `${ETIQUETA}-01-home-${ancho.id}-pliegue`);
    if (ancho.id === 'iphone-14') await capturar(pagina, `${ETIQUETA}-01-home-${ancho.id}-completa`, { completa: true });
    informe.medidas[`pliegue_${ancho.id}`] = await medirPliegue(pagina);
    await buscarMetadataTecnica(pagina, `home_${ancho.id}`);
    await contexto.close();
  }

  // El recorrido de compra, en el ancho de referencia.
  const { contexto, pagina } = await nuevaPagina(navegador, ANCHOS[1]);
  await abrir(pagina);

  // 2 · Recomendados del local
  await paso('recomendados', async () => {
  const rail = pagina.locator('[data-home-best-sellers]').first();
  if (await rail.count()) {
    await rail.scrollIntoViewIfNeeded();
    await pagina.waitForTimeout(600);
    await capturar(pagina, `${ETIQUETA}-02-recomendados`);
    informe.medidas.recomendados = await rail.evaluate((el) => ({
      cantidad: el.querySelectorAll('[data-add-product]').length,
      titulos: [...el.querySelectorAll('[data-add-product]')]
        .slice(0, 14)
        .map((b) => (b.closest('article, li, .home-best-card') || b.parentElement)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 70)),
    }));
  }
  });

  // 3 y 4 · Categorías comerciales
  await paso('catalogo', async () => {
  await irA(pagina, 'catalog');
  await pagina.waitForTimeout(800);
  await capturar(pagina, `${ETIQUETA}-03-catalogo-todas`);
  informe.medidas.tarjetas_catalogo = await medirTarjetas(pagina);
  await buscarMetadataTecnica(pagina, 'catalogo');
  });

  for (const [orden, categoria] of [
    ['03b', 'Gaseosas'],
    ['04', 'Energizantes'],
  ]) {
    await paso(`categoria ${categoria}`, async () => {
    const chip = pagina.getByRole('button', { name: categoria, exact: true }).filter({ visible: true }).first();
    if (await chip.count()) {
      await chip.click();
      await pagina.waitForTimeout(900);
      await capturar(pagina, `${ETIQUETA}-${orden}-${categoria.toLowerCase()}`);
      informe.medidas[`tarjetas_${categoria.toLowerCase()}`] = await medirTarjetas(pagina);
    } else {
      informe.errores.push(`no se encontró el filtro «${categoria}»`);
    }
    });
  }

  // 5 · Ficha de Coca-Cola
  await paso('ficha', async () => {
  const chipTodas = pagina.getByRole('button', { name: 'Todas', exact: true }).filter({ visible: true }).first();
  if (await chipTodas.count()) {
    await chipTodas.click();
    await pagina.waitForTimeout(700);
  }
  // Acotado a la GRILLA: `[data-product-detail]` existe también en los rieles
  // de la home, que están en el DOM y ocultos. Pedir el primero a secas elegía
  // uno invisible y la espera se agotaba sin abrir ninguna ficha.
  const enGrilla = pagina.locator('[data-product-grid] [data-product-detail]');
  const objetivo = enGrilla.first();
  if (await objetivo.count()) {
    await objetivo.click();
    await pagina.waitForTimeout(1100);
    await capturar(pagina, `${ETIQUETA}-05-ficha-coca-cola`);
    await buscarMetadataTecnica(pagina, 'ficha');
    informe.medidas.ficha = await pagina.evaluate(() => {
      const hoja =
        document.querySelector('[data-bottom-sheet]:not([hidden]), [data-product-sheet], dialog[open]') ||
        document.querySelector('main');
      return { texto: (hoja?.innerText || '').replace(/\s+/g, ' ').slice(0, 700) };
    });
    await pagina.keyboard.press('Escape').catch(() => {});
    await pagina.waitForTimeout(500);
  }
  });

  // 6 · Búsqueda «zero»
  await paso('busqueda', async () => {
  const buscador = pagina.locator('[data-search-input]:visible').first();
  if (await buscador.count()) {
    await buscador.fill('zero');
    await pagina.waitForTimeout(1200);
    await capturar(pagina, `${ETIQUETA}-06-busqueda-zero`);
    informe.medidas.busqueda_zero = await pagina.evaluate(() => {
      const grid = document.querySelector('[data-product-grid]');
      return {
        resultados: grid ? grid.querySelectorAll('[data-add-product]').length : 0,
        nombres: grid
          ? [...grid.querySelectorAll('[data-add-product]')].map((b) =>
              (b.closest('article, li, .product-card') || b.parentElement)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 70),
            )
          : [],
      };
    });
    await buscador.fill('');
    await pagina.waitForTimeout(700);
  }
  });

  // 7 · Carrito con producto
  await paso('carrito', async () => {
  const agregar = pagina.locator('[data-product-grid] [data-add-product]').first();
  if (await agregar.count()) {
    await agregar.click();
    await pagina.waitForTimeout(900);
  }
  const agregar2 = pagina.locator('[data-product-grid] [data-add-product]').nth(2);
  if (await agregar2.count()) {
    await agregar2.click();
    await pagina.waitForTimeout(900);
  }
  await irA(pagina, 'cart');
  await pagina.waitForTimeout(900);
  await capturar(pagina, `${ETIQUETA}-07-carrito`);
  await capturar(pagina, `${ETIQUETA}-07-carrito-completo`, { completa: true });
  await buscarMetadataTecnica(pagina, 'carrito');
  informe.medidas.carrito = await pagina.evaluate(() => {
    const lista = document.querySelector('[data-cart-list]');
    return { lineas: lista ? [...lista.children].map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)) : [] };
  });
  });

  await contexto.close();
} finally {
  await navegador.close();
}

await fs.mkdir(SALIDA, { recursive: true });
await fs.writeFile(path.join(SALIDA, `${ETIQUETA}-informe.json`), `${JSON.stringify(informe, null, 2)}\n`, 'utf8');
console.log(`\n${informe.superficies.length} capturas · ${informe.errores.length} errores de consola`);
console.log(`informe: ${path.relative(ROOT, path.join(SALIDA, `${ETIQUETA}-informe.json`))}`);
