/*
 * Qué cuesta abrir la tienda, con el service worker ACTIVO.
 *
 * `measure-local-rc-performance.mjs` mide con `serviceWorkers: 'block'`, así que
 * no ve nada de lo que decide el worker: ni el precache, ni el contraste de
 * tipo, ni el plazo contra una red muda. Este mide lo otro.
 *
 * Tres visitas, que es como se usa de verdad:
 *   fria       sin worker y sin caché (cliente nuevo)
 *   caliente   worker activo y precache completo (cliente recurrente)
 *   recarga    la misma pestaña recargada, que es el camino del retorno de pago
 *
 * Y en cada una: cuánto tarda en estar usable, cuántos pedidos salen, cuántos
 * bytes se transfieren, cuánta memoria queda, y cuántos oyentes y temporizadores
 * vivos dejó la aplicación —que es lo único que delata una fuga de a poco—.
 *
 * Uso:
 *   node scripts/measure-customer-performance.mjs [--repeticiones=5] [--salida=archivo.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argumento = (nombre, porDefecto) => {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3) : porDefecto;
};
const PUERTO = Number(process.env.TABA_E2E_HTTP_PORT || 8123);
const BASE = `http://127.0.0.1:${PUERTO}`;
const REPETICIONES = Number(argumento('repeticiones', '5'));
const SALIDA = argumento('salida', '');

/*
 * Se cuentan los oyentes y los temporizadores que la aplicación deja VIVOS.
 * `addEventListener` y `setInterval` se envuelven antes de que corra una sola
 * línea del cliente, y se descuentan los que se dan de baja: lo que queda es lo
 * que sobrevive a la vista, que es lo que se acumula visita tras visita.
 */
const INSTRUMENTO = () => {
  const vivos = { oyentes: new Map(), intervalos: new Set(), timeouts: new Set() };
  const addOriginal = EventTarget.prototype.addEventListener;
  const removeOriginal = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function envuelto(tipo, fn, opciones) {
    vivos.oyentes.set(`${tipo}`, (vivos.oyentes.get(`${tipo}`) || 0) + 1);
    return addOriginal.call(this, tipo, fn, opciones);
  };
  EventTarget.prototype.removeEventListener = function envuelto(tipo, fn, opciones) {
    if (vivos.oyentes.has(`${tipo}`)) vivos.oyentes.set(`${tipo}`, Math.max(0, vivos.oyentes.get(`${tipo}`) - 1));
    return removeOriginal.call(this, tipo, fn, opciones);
  };
  const setIntervalOriginal = window.setInterval;
  const clearIntervalOriginal = window.clearInterval;
  window.setInterval = function envuelto(...args) {
    const id = setIntervalOriginal.apply(this, args);
    vivos.intervalos.add(id);
    return id;
  };
  window.clearInterval = function envuelto(id) {
    vivos.intervalos.delete(id);
    return clearIntervalOriginal.call(this, id);
  };
  const setTimeoutOriginal = window.setTimeout;
  const clearTimeoutOriginal = window.clearTimeout;
  window.setTimeout = function envuelto(fn, ms, ...resto) {
    const id = setTimeoutOriginal.call(this, (...a) => { vivos.timeouts.delete(id); return fn?.(...a); }, ms, ...resto);
    vivos.timeouts.add(id);
    return id;
  };
  window.clearTimeout = function envuelto(id) {
    vivos.timeouts.delete(id);
    return clearTimeoutOriginal.call(this, id);
  };
  window.__tabaVivos = () => ({
    oyentes: [...vivos.oyentes.values()].reduce((a, b) => a + b, 0),
    tiposDeOyente: [...vivos.oyentes.entries()].filter(([, n]) => n > 0).length,
    intervalos: vivos.intervalos.size,
    timeouts: vivos.timeouts.size,
  });
  performance.mark('taba-instrumento');
};

async function medirPagina(page, { esperarWorker = false } = {}) {
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
  if (esperarWorker) {
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  }
  // Se deja asentar el reemplazo del esqueleto de la home por los carruseles.
  await page.waitForTimeout(1_500);

  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const recursos = performance.getEntriesByType('resource');
    const usable = performance.getEntriesByName('taba-startup-ready')[0]?.startTime
      ?? nav.domContentLoadedEventEnd
      ?? 0;
    const suma = (campo) => recursos.reduce((total, r) => total + (r[campo] || 0), 0);
    const porTipo = {};
    recursos.forEach((r) => {
      const tipo = r.initiatorType || 'otro';
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    });
    return {
      usableMs: Math.round(usable),
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || 0),
      pedidos: recursos.length,
      pedidosPorTipo: porTipo,
      transferidoKb: Math.round(suma('transferSize') / 1024),
      decodificadoKb: Math.round(suma('decodedBodySize') / 1024),
      memoriaMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      ...(window.__tabaVivos ? window.__tabaVivos() : {}),
      workerControlando: !!navigator.serviceWorker.controller,
    };
  });
}

function resumir(muestras) {
  const claves = ['usableMs', 'domContentLoadedMs', 'loadMs', 'pedidos', 'transferidoKb', 'decodificadoKb', 'memoriaMb', 'oyentes', 'intervalos', 'timeouts'];
  const salida = { muestras: muestras.length };
  for (const clave of claves) {
    const valores = muestras.map((m) => m[clave]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (!valores.length) continue;
    salida[clave] = {
      mediana: valores[Math.floor(valores.length / 2)],
      min: valores[0],
      max: valores[valores.length - 1],
    };
  }
  return salida;
}

const navegador = await chromium.launch();
const informe = { base: BASE, repeticiones: REPETICIONES, escenarios: {} };

for (const escenario of ['fria', 'caliente', 'recarga']) {
  const muestras = [];
  for (let i = 0; i < REPETICIONES; i += 1) {
    // Contexto nuevo por repetición: el worker y la caché son del perfil, así
    // que reutilizarlo mezclaría «cliente nuevo» con «cliente recurrente».
    const contexto = await navegador.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'allow',
      locale: 'es-AR',
    });
    await contexto.addInitScript(INSTRUMENTO);
    const page = await contexto.newPage();
    try {
      await page.goto(`${BASE}/?demo=1#home`, { waitUntil: 'load' });
      if (escenario !== 'fria') {
        // Cliente recurrente de verdad: worker activo y precache terminado.
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
        await page.waitForFunction(async () => {
          const claves = await caches.keys();
          if (!claves.length) return false;
          const cache = await caches.open(claves[0]);
          return (await cache.keys()).length > 100;
        }, null, { timeout: 40_000 });
        if (escenario === 'recarga') await page.reload({ waitUntil: 'load' });
        else {
          const otra = await contexto.newPage();
          await page.close();
          await otra.goto(`${BASE}/?demo=1#home`, { waitUntil: 'load' });
          muestras.push(await medirPagina(otra, { esperarWorker: true }));
          await contexto.close();
          continue;
        }
      }
      muestras.push(await medirPagina(page, { esperarWorker: escenario !== 'fria' }));
    } finally {
      await contexto.close().catch(() => undefined);
    }
  }
  informe.escenarios[escenario] = { resumen: resumir(muestras), muestras };
}

await navegador.close();

const texto = JSON.stringify(informe, null, 2);
if (SALIDA) {
  fs.mkdirSync(path.dirname(path.resolve(ROOT, SALIDA)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, SALIDA), texto);
}
for (const [nombre, datos] of Object.entries(informe.escenarios)) {
  const r = datos.resumen;
  console.log(
    `${nombre.padEnd(9)} usable=${r.usableMs?.mediana}ms  load=${r.loadMs?.mediana}ms  `
    + `pedidos=${r.pedidos?.mediana}  transferido=${r.transferidoKb?.mediana}KB  `
    + `decodificado=${r.decodificadoKb?.mediana}KB  memoria=${r.memoriaMb?.mediana}MB  `
    + `oyentes=${r.oyentes?.mediana}  intervalos=${r.intervalos?.mediana}  timeouts=${r.timeouts?.mediana}`,
  );
}
