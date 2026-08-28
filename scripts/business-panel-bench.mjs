// La bandeja del Panel, cronometrada con cientos de pedidos.
//
// POR QUÉ EXISTE ESTE GUION
// -------------------------
// «La bandeja va rápida» es una opinión sobre una pantalla con seis pedidos. El
// comercio que la va a usar tiene turnos con cientos, y el repositorio sirve
// hasta 500 antes de truncar (`MAX_BUSINESS_INBOX_ORDERS`). Lo que hay que
// medir es eso.
//
// Mide cuatro cosas, todas del lado del navegador y sobre el camino real de
// produccion (workspace autenticado, no la demostracion):
//
//   1. `msHastaLaBandeja` — desde que se toca «Pedidos» hasta que las N
//      tarjetas estan en el DOM. Es lo que espera una persona.
//   2. `repintados30s`    — cuantas veces se reemplaza el DOM del workspace en
//      treinta segundos SIN que el servidor cambie nada. Con el reloj vivo en
//      la tarjeta («hace 9 min») este numero es el que se puede arruinar sin
//      darse cuenta: si el minuto que pasa cuenta como un cambio del marcado,
//      el tablero entero se reemplaza una vez por minuto debajo del dedo de
//      quien esta por tocar «Aceptar pedido».
//   3. `nodos` y `bytes`  — el tamano del DOM que hay que mantener.
//   4. `msPorRepintado`   — cuanto cuesta volver a armar el marcado.
//
// No toca Supabase, Mercado Pago ni ARCA: intercepta las llamadas del cliente y
// responde con datos inventados.
//
//   node scripts/business-panel-bench.mjs --pedidos 200 --label despues

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { BUSINESS_ID, SUPABASE_URL, instalarDatosDePrueba, pedidos } from './lib/business-panel-fixtures.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const PORT = Number.parseInt(arg('port', '8199'), 10);
const BASE = `http://127.0.0.1:${PORT}`;
const CUANTOS = Number.parseInt(arg('pedidos', '200'), 10);
const LABEL = arg('label', 'estado');
const OUT = path.resolve(arg('out', 'artifacts/taba2-panel-operativo-movil'));
const VENTANA_MS = Number.parseInt(arg('ventana', '30000'), 10);
const VIEWPORT = { width: 390, height: 844 };

/** N pedidos derivados de los seis de la biblioteca, con identidad propia. */
function muchosPedidos(cuantos) {
  const base = pedidos();
  const salida = [];
  for (let i = 0; i < cuantos; i += 1) {
    const molde = base[i % base.length];
    const n = String(i + 1).padStart(4, '0');
    salida.push({
      ...molde,
      id: `00000000-0000-4000-8000-0000000${n}`,
      public_code: `LT-9${n}`,
      revision: (i % 7) + 1,
      order_items: molde.order_items.map((item, j) => ({ ...item, id: `${n}-${j}` })),
    });
  }
  return salida;
}

fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
let medida = null;

try {
  await esperarServidor();
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await instalarDatosDePrueba(page, { conSesion: true });

  const lista = muchosPedidos(CUANTOS);
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/rest/v1/orders')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lista) });
    }
    return route.fallback();
  });
  // Sondeo corto a proposito: es el ritmo al que el Panel se repregunta por la
  // bandeja cuando realtime no esta. Con 60s el punto 2 no mediria nada.
  await page.addInitScript(() => {
    const config = globalThis.__LA_TABA_RUNTIME_CONFIG__;
    if (config?.repository) config.repository.pollMs = 2000;
    try { delete globalThis.__TAURI__; } catch (_) { globalThis.__TAURI__ = undefined; }
  });

  await page.goto(`${BASE}/#business`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 60_000 });

  // 1 · desde el toque hasta las N tarjetas.
  await page.evaluate(() => { globalThis.__benchInicio = performance.now(); });
  await page.locator('[data-production-orders-view]:visible').first().click();
  await page.locator('.production-order-card').nth(CUANTOS - 1).waitFor({ state: 'attached', timeout: 60_000 });
  const msHastaLaBandeja = await page.evaluate(() => performance.now() - globalThis.__benchInicio);

  // 2 · cuantas veces se reemplaza el DOM del workspace sin novedades.
  await page.evaluate(() => {
    const raiz = document.querySelector('[data-production-workspace="business"]');
    globalThis.__benchRepintados = 0;
    globalThis.__benchObserver = new MutationObserver((mutaciones) => {
      for (const m of mutaciones) {
        // Un reemplazo del workspace saca y pone su hijo directo. El reloj vivo
        // escribe en un nodo de TEXTO y no cuenta: eso es exactamente lo que se
        // quiere distinguir.
        if (m.type === 'childList' && m.target === raiz && m.addedNodes.length) {
          globalThis.__benchRepintados += 1;
        }
      }
    });
    globalThis.__benchObserver.observe(raiz, { childList: true, subtree: false });
  });
  await page.waitForTimeout(VENTANA_MS);
  const repintados30s = await page.evaluate(() => {
    globalThis.__benchObserver.disconnect();
    return globalThis.__benchRepintados;
  });

  // 3 · el tamano del DOM que hay que mantener.
  const { nodos, bytes, tarjetas } = await page.evaluate(() => {
    const raiz = document.querySelector('[data-production-workspace="business"]');
    return {
      nodos: raiz.querySelectorAll('*').length,
      bytes: raiz.innerHTML.length,
      tarjetas: raiz.querySelectorAll('.production-order-card').length,
    };
  });

  // 4 · cuanto cuesta un repintado, medido como el tiempo entre que se pide un
  //     cambio de vista y el DOM nuevo esta puesto. Se promedian cinco idas y
  //     vueltas para que el numero no sea una sola muestra.
  const msPorRepintado = await medirRepintado(page, 5);

  medida = {
    label: LABEL,
    generatedAtUtc: new Date().toISOString(),
    businessId: BUSINESS_ID,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    pedidosServidos: CUANTOS,
    tarjetasEnElDom: tarjetas,
    msHastaLaBandeja: Math.round(msHastaLaBandeja),
    repintadosSinNovedades: repintados30s,
    ventanaMs: VENTANA_MS,
    nodosDelWorkspace: nodos,
    bytesDeMarcado: bytes,
    msPorRepintado: Math.round(msPorRepintado),
  };

  await context.close();
} finally {
  await browser.close();
  server.kill();
}

const archivo = path.join(OUT, `BENCH-${LABEL}.json`);
fs.writeFileSync(archivo, `${JSON.stringify(medida, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(medida, null, 2));
console.log(`\nbenchmark: ${path.relative(process.cwd(), archivo)}`);

/**
 * Ida y vuelta entre «Que pasa» y «Pedidos», que fuerza dos repintados.
 *
 * Se navega por el destino que SE VE. En telefono «Que pasa» esta en la barra
 * inferior, no en la hoja de «Mas», y abrir la hoja tapaba la barra: el click
 * quedaba interceptado por el dialogo. Es el mismo criterio que usa el guion de
 * capturas.
 */
async function medirRepintado(page, vueltas) {
  const muestras = [];
  for (let i = 0; i < vueltas; i += 1) {
    const aQuePasa = page.locator('[data-business-ops-view="operation-center"]:visible').first();
    const inicio = await page.evaluate(() => performance.now());
    await aQuePasa.click();
    await page.locator('[data-business-ops-center="operation-center"]').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('[data-production-orders-view]:visible').first().click();
    await page.locator('.production-order-card').nth(CUANTOS - 1).waitFor({ state: 'attached', timeout: 60_000 });
    muestras.push(await page.evaluate((t0) => performance.now() - t0, inicio));
  }
  muestras.sort((a, b) => a - b);
  return muestras[Math.floor(muestras.length / 2)];
}

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
