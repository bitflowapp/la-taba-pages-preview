// El Panel del negocio, medido y fotografiado en los anchos donde se usa.
//
// `business-panel-screenshots.mjs` ya fotografiaba ocho pantallas del centro
// operativo a 1280px. Esto hace las tres cosas que faltaban:
//
//   1. entra por el camino de PRODUCCION -el workspace que ve un comercio real,
//      no el panel de demostracion-, y con pedidos adentro, que es cuando el
//      tablero significa algo
//   2. recorre los anchos de telefono de verdad (360…430), la tablet y los tres
//      anchos de escritorio, no un unico 1280
//   3. MIDE en cada combinacion: desborde horizontal, que elemento lo causa,
//      blancos de area tactil y contraste de la tinta contra su superficie
//
// Sin la medida las capturas son una opinion. Con la medida, el reporte dice
// que ancho esta roto y por que elemento, que es lo unico accionable.
//
//   node scripts/business-panel-responsive.mjs --out artifacts/... --label antes
//
// No toca Supabase, Mercado Pago ni ARCA: intercepta las llamadas del cliente y
// responde con datos de prueba. Ninguna captura contiene datos reales.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { instalarDatosDePrueba } from './lib/business-panel-fixtures.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const PORT = Number.parseInt(arg('port', process.env.TABA_PANEL_SHOT_PORT || '8152'), 10);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(arg('out', 'artifacts/taba2-business-commercial-mobile/capturas'));
const LABEL = arg('label', 'estado');
const ONLY = arg('only', '');


// Los anchos donde el Panel se usa de verdad. Los seis primeros son los que
// pidio la mision; el resto cubre tablet y los tres escritorios habituales.
const VIEWPORTS = [
  { name: '360x740', width: 360, height: 740, clase: 'movil' },
  { name: '375x812', width: 375, height: 812, clase: 'movil' },
  { name: '390x844', width: 390, height: 844, clase: 'movil' },
  { name: '393x851', width: 393, height: 851, clase: 'movil' },
  { name: '412x915', width: 412, height: 915, clase: 'movil' },
  { name: '430x932', width: 430, height: 932, clase: 'movil' },
  { name: '844x390-landscape', width: 844, height: 390, clase: 'movil-apaisado' },
  { name: '768x1024', width: 768, height: 1024, clase: 'tablet' },
  { name: '1366x768', width: 1366, height: 768, clase: 'escritorio' },
  { name: '1440x900', width: 1440, height: 900, clase: 'escritorio' },
  { name: '1920x1080', width: 1920, height: 1080, clase: 'escritorio' },
];

// Las superficies del Panel, por el nombre real de su vista.
const PANTALLAS = [
  { id: 'login', vista: null, titulo: 'Ingreso' },
  { id: 'operation-center', vista: 'operation-center', titulo: 'Qué pasa' },
  { id: 'orders', vista: 'orders', titulo: 'Pedidos' },
  { id: 'payments', vista: 'payments', titulo: 'Pagos' },
  { id: 'day-open', vista: 'day-open', titulo: 'Abrir el negocio' },
  { id: 'product-create', vista: 'product-create', titulo: 'Alta de producto' },
  { id: 'inventory-receive', vista: 'inventory-receive', titulo: 'Recepción de stock' },
  { id: 'pos', vista: 'pos', titulo: 'Mostrador' },
  { id: 'fiscal-status', vista: 'fiscal-status', titulo: 'Comprobantes' },
  { id: 'devices', vista: 'devices', titulo: 'Dispositivos' },
  { id: 'day-close', vista: 'day-close', titulo: 'Cerrar el día' },
];

const pantallasPedidas = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;
const pantallas = pantallasPedidas
  ? PANTALLAS.filter((p) => pantallasPedidas.has(p.id))
  : PANTALLAS;

fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
const medidas = [];

try {
  await esperarServidor();

  for (const viewport of VIEWPORTS) {
    const opcionesContexto = {
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      hasTouch: viewport.clase.startsWith('movil'),
      isMobile: viewport.clase.startsWith('movil'),
    };

    // El ingreso necesita un contexto SIN sesión: la sesión se siembra en un
    // `addInitScript`, que no se puede desinstalar una vez puesto.
    const contextoLogin = await browser.newContext(opcionesContexto);
    const paginaLogin = await contextoLogin.newPage();
    await instalarDatosDePrueba(paginaLogin, { conSesion: false });

    const context = await browser.newContext(opcionesContexto);
    const page = await context.newPage();
    await instalarDatosDePrueba(page, { conSesion: true });

    for (const pantalla of pantallas) {
      const hoja = pantalla.vista === null ? paginaLogin : page;
      try {
        await abrir(hoja, pantalla);
        // Volver arriba: navegar conserva el scroll de la vista anterior y la
        // captura saldria del medio de la pagina, que no es lo que ve alguien
        // que entra a esa pantalla.
        await hoja.evaluate(() => globalThis.scrollTo(0, 0));
        await hoja.waitForTimeout(220);
        const archivo = path.join(OUT, `${LABEL}-${viewport.name}-${pantalla.id}.png`);
        await hoja.screenshot({ path: archivo, fullPage: false });
        medidas.push({
          label: LABEL,
          viewport: viewport.name,
          viewportClass: viewport.clase,
          width: viewport.width,
          height: viewport.height,
          screen: pantalla.id,
          title: pantalla.titulo,
          // Relativo al DIRECTORIO DE SALIDA y no al cwd: con `--out` apuntando
          // a otra unidad, `path.relative` desde el cwd devuelve una ruta
          // absoluta con la letra de disco de esta máquina, y eso viaja al
          // repositorio. El gate de higiene lo marcó -122 hallazgos
          // `local-drive-path`- y tenía razón: el nombre del archivo, al lado
          // de su reporte, identifica la captura igual y no dice en qué
          // computadora se corrió.
          shot: path.relative(OUT, archivo).replaceAll('\\', '/'),
          ...(await medir(hoja)),
        });
      } catch (error) {
        medidas.push({
          label: LABEL,
          viewport: viewport.name,
          viewportClass: viewport.clase,
          screen: pantalla.id,
          error: String(error.message || error).slice(0, 200),
        });
      }
    }
    await context.close();
    await contextoLogin.close();
  }
} finally {
  await browser.close();
  server.kill();
}

// ---------- reporte ----------

const conDesborde = medidas.filter((m) => m.horizontalOverflow);
const conTactilChico = medidas.filter((m) => (m.smallTargets?.length || 0) > 0);
const conContrasteBajo = medidas.filter((m) => (m.lowContrast?.length || 0) > 0);
const conError = medidas.filter((m) => m.error);

const reporte = {
  schemaVersion: 1,
  label: LABEL,
  generatedAtUtc: new Date().toISOString(),
  viewports: VIEWPORTS.length,
  screens: pantallas.length,
  combinations: medidas.length,
  summary: {
    horizontalOverflow: conDesborde.length,
    smallTouchTargets: conTactilChico.length,
    lowContrastPairs: conContrasteBajo.length,
    errors: conError.length,
    density: densidadResumen(medidas),
  },
  measurements: medidas,
};
fs.writeFileSync(path.join(OUT, `REPORTE-${LABEL}.json`), `${JSON.stringify(reporte, null, 2)}\n`, 'utf8');

const lineas = [
  `# Panel del negocio · responsive (${LABEL})`,
  '',
  `${medidas.length} combinaciones: ${VIEWPORTS.length} anchos × ${pantallas.length} pantallas.`,
  '',
  `- desborde horizontal: **${conDesborde.length}**`,
  `- áreas táctiles por debajo de 44px: **${conTactilChico.length}** combinaciones`,
  `- pares de contraste por debajo de 4,5:1: **${conContrasteBajo.length}** combinaciones`,
  `- errores de navegación: **${conError.length}**`,
  '',
];
const densidad = reporte.summary.density;
if (densidad.length) {
  lineas.push('## Densidad del tablero de pedidos', '',
    '| ancho | chrome antes del 1er pedido | alto de tarjeta | pedidos enteros a la vista |',
    '|---|---|---|---|');
  for (const d of densidad) {
    lineas.push([
      '| `' + d.viewport + '` ',
      '| ' + d.chromeBeforeFirstOrder + 'px ',
      '| ' + d.orderCardHeight + 'px ',
      '| ' + d.ordersFullyVisible + ' |',
    ].join(''));
  }
  lineas.push('');
}
if (conDesborde.length) {
  lineas.push('## Desborde horizontal', '');
  for (const m of conDesborde) {
    lineas.push(`- \`${m.viewport}\` · ${m.screen}: ${m.scrollWidth}px sobre ${m.width}px — culpables: ${(m.overflowCulprits || []).join(', ') || 'sin identificar'}`);
  }
  lineas.push('');
}
if (conTactilChico.length) {
  lineas.push('## Áreas táctiles chicas', '');
  for (const m of conTactilChico) {
    lineas.push(`- \`${m.viewport}\` · ${m.screen}: ${m.smallTargets.length} — ${m.smallTargets.slice(0, 4).join(' · ')}`);
  }
  lineas.push('');
}
if (conContrasteBajo.length) {
  lineas.push('## Contraste por debajo de 4,5:1', '');
  for (const m of conContrasteBajo) {
    lineas.push(`- \`${m.viewport}\` · ${m.screen}: ${m.lowContrast.slice(0, 4).join(' · ')}`);
  }
  lineas.push('');
}
fs.writeFileSync(path.join(OUT, `REPORTE-${LABEL}.md`), `${lineas.join('\n')}\n`, 'utf8');

console.log(`capturas: ${medidas.filter((m) => m.shot).length} · desborde: ${conDesborde.length} · táctil: ${conTactilChico.length} · contraste: ${conContrasteBajo.length} · errores: ${conError.length}`);
console.log(`reporte: ${path.relative(process.cwd(), OUT)}`);
process.exitCode = conError.length ? 1 : 0;

// ---------- navegación ----------

async function abrir(page, pantalla) {
  if (pantalla.vista === null) {
    await page.goto(`${BASE}/#business`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-production-auth-card="business"]').waitFor({ state: 'visible', timeout: 20_000 });
    return;
  }
  if (!page.url().includes('#business')) {
    await page.goto(`${BASE}/#business`, { waitUntil: 'domcontentloaded' });
  }
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });

  // El mismo destino existe en DOS navegaciones -la fila de escritorio y la
  // barra inferior del telefono- y solo una esta visible a la vez. Se navega por
  // la que se VE, que es la que tiene una persona delante; si el destino no esta
  // en ninguna de las dos, en telefono vive en la hoja de «Mas».
  const selector = pantalla.vista === 'orders'
    ? '[data-production-orders-view]'
    : `[data-business-ops-view="${pantalla.vista}"]`;

  const visible = page.locator(`${selector}:visible`).first();
  if (await visible.count()) {
    await visible.click();
  } else {
    const mas = page.locator('[data-panel-more-toggle]:visible').first();
    if (!(await mas.count())) throw new Error(`el destino ${pantalla.vista} no es alcanzable en este ancho`);
    await mas.click();
    const enLaHoja = page.locator(`[data-panel-more-sheet] ${selector}`).first();
    await enLaHoja.waitFor({ state: 'visible', timeout: 10_000 });
    await enLaHoja.click();
  }

  const destino = pantalla.vista === 'orders'
    ? '.production-order-list'
    : `[data-business-ops-center="${pantalla.vista}"]`;
  await page.locator(destino).waitFor({ state: 'visible', timeout: 15_000 });
}

// ---------- medición ----------

async function medir(page) {
  return page.evaluate(() => {
    const raiz = document.querySelector('[data-view="business"]') || document.body;
    const ancho = window.innerWidth;

    // 1 · desborde horizontal, y QUIEN lo causa.
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      raiz.scrollWidth,
    );
    const culpables = [];
    if (scrollWidth > ancho + 1) {
      for (const nodo of raiz.querySelectorAll('*')) {
        const r = nodo.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right <= ancho + 1) continue;
        // Un contenedor que scrollea a proposito no es un desborde de pagina.
        const estilo = getComputedStyle(nodo);
        if (estilo.overflowX === 'auto' || estilo.overflowX === 'scroll') continue;
        let padre = nodo.parentElement;
        let dentroDeCarril = false;
        while (padre && padre !== raiz) {
          const pe = getComputedStyle(padre);
          if (pe.overflowX === 'auto' || pe.overflowX === 'scroll') { dentroDeCarril = true; break; }
          padre = padre.parentElement;
        }
        if (dentroDeCarril) continue;
        culpables.push(`${nodo.tagName.toLowerCase()}${nodo.className && typeof nodo.className === 'string' ? `.${nodo.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''} (${Math.round(r.right)}px)`);
        if (culpables.length >= 6) break;
      }
    }

    // 2 · areas tactiles. 44px es el minimo de WCAG 2.5.8 / iOS HIG.
    const chicos = [];
    const interactivos = raiz.querySelectorAll('button, a[href], select, input:not([type="hidden"]), textarea, [role="button"], [tabindex]:not([tabindex="-1"])');
    for (const nodo of interactivos) {
      if (nodo.disabled) continue;
      const r = nodo.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(nodo).visibility === 'hidden') continue;
      if (r.height >= 44 && r.width >= 44) continue;
      // Una casilla de verificacion nativa se toca por su etiqueta.
      if (nodo.type === 'checkbox' || nodo.type === 'radio') continue;
      const etiqueta = (nodo.textContent || nodo.getAttribute('aria-label') || nodo.tagName).trim().slice(0, 28);
      chicos.push(`${etiqueta || nodo.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (chicos.length >= 12) break;
    }

    // 3 · contraste de la tinta contra la superficie que efectivamente tiene
    //     detras. Se resuelve subiendo por los ancestros hasta el primer fondo
    //     opaco, porque el fondo de un nodo suele ser transparente.
    const srgb = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
    const parse = (valor) => {
      const m = String(valor).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const partes = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { rgb: partes.slice(0, 3), a: partes.length > 3 ? partes[3] : 1 };
    };
    const fondoDe = (nodo) => {
      let actual = nodo;
      while (actual && actual !== document.documentElement) {
        const c = parse(getComputedStyle(actual).backgroundColor);
        if (c && c.a >= 0.95) return c.rgb;
        actual = actual.parentElement;
      }
      const c = parse(getComputedStyle(document.body).backgroundColor);
      return c ? c.rgb : [255, 255, 255];
    };
    const razon = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    const bajos = [];
    const conTexto = raiz.querySelectorAll('p, span, strong, dt, dd, h1, h2, h3, li, label, small, button, a');
    let mirados = 0;
    for (const nodo of conTexto) {
      if (mirados > 400) break;
      const texto = (nodo.textContent || '').trim();
      if (!texto || nodo.children.length) continue;
      const r = nodo.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      mirados += 1;
      const estilo = getComputedStyle(nodo);
      const tinta = parse(estilo.color);
      if (!tinta || tinta.a < 0.9) continue;
      const razonada = razon(tinta.rgb, fondoDe(nodo));
      const tam = Number.parseFloat(estilo.fontSize);
      const grande = tam >= 24 || (tam >= 18.66 && Number(estilo.fontWeight) >= 700);
      const minimo = grande ? 3 : 4.5;
      if (razonada + 0.005 < minimo) {
        bajos.push(`"${texto.slice(0, 22)}" ${razonada.toFixed(2)}:1`);
        if (bajos.length >= 8) break;
      }
    }

    // 4 · densidad del tablero. Es la medida que decide si el rediseno sirvio:
    //     cuanto chrome hay antes del primer pedido, cuanto mide una tarjeta, y
    //     cuantos pedidos entran ENTEROS en la pantalla. Sin esto, «ahora entran
    //     dos» seria una opinion sobre una captura.
    const tarjetas = [...raiz.querySelectorAll(".production-order-card")];
    const alto = window.innerHeight;
    let densidad = null;
    if (tarjetas.length) {
      const primera = tarjetas[0].getBoundingClientRect();
      const barra = raiz.querySelector("[data-panel-bottom-nav]");
      const estorbo = barra && getComputedStyle(barra).display !== "none"
        ? barra.getBoundingClientRect().height
        : 0;
      const utiles = alto - estorbo;
      densidad = {
        chromeBeforeFirstOrder: Math.round(primera.top + window.scrollY),
        orderCardHeight: Math.round(primera.height),
        ordersFullyVisible: tarjetas.filter((t) => {
          const r = t.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= utiles;
        }).length,
        bottomNavHeight: Math.round(estorbo),
      };
    }

    return {
      scrollWidth,
      horizontalOverflow: scrollWidth > ancho + 1,
      overflowCulprits: culpables,
      smallTargets: chicos,
      lowContrast: bajos,
      ...(densidad ? { density: densidad } : {}),
    };
  });
}

/** La densidad del tablero, por ancho, para poder comparar antes y despues. */
function densidadResumen(todas) {
  return todas
    .filter((m) => m.screen === 'orders' && m.density)
    .map((m) => ({ viewport: m.viewport, ...m.density }));
}

// ---------- servidor ----------

async function esperarServidor() {
  for (let intento = 0; intento < 60; intento += 1) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch (_) { /* todavia no acepta conexiones */ }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  throw new Error('el servidor local no respondió a tiempo');
}
