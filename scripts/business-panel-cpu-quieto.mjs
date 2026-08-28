/*
 * EL COSTO DE UN SONDEO QUE NO TRAE NADA.
 * ===========================================================================
 * `business-tray-scale-bench.mjs` mide qué cuesta un CAMBIO. Este guion mide lo
 * contrario: qué cuesta NO cambiar. Con la bandeja llena y el servidor quieto,
 * el Panel sigue sondeando, y cada vuelta vuelve a preguntarse si algo cambió.
 *
 * Se mide tiempo de TAREA LARGA del hilo principal, que es lo que se siente:
 * mientras el hilo está ocupado, el toque en «Aceptar pedido» espera. No se
 * mide el heap ni los nodos —de eso se ocupa el otro banco— sino cuánto del
 * teléfono se lleva el Panel sin hacer nada.
 *
 * Corre igual en cualquier rama, y esa es la gracia: es el número que permite
 * comparar la integración contra `main` sin discutir de arquitectura.
 *
 *   node scripts/business-panel-cpu-quieto.mjs 500
 *
 * El intervalo de sondeo se fuerza a 1200 ms para que la ventana de 32 segundos
 * contenga unas 26 vueltas. En producción el valor por defecto es 5000 ms, así
 * que el costo real es del orden de una cuarta parte del que se lee acá.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { SUPABASE_URL, instalarDatosDePrueba, pedidosSinteticos } from './lib/business-panel-fixtures.mjs';

const CUANTOS = Number(process.argv[2] || 500);
const PORT = Number(process.argv[3] || 8241);
const BASE = `http://127.0.0.1:${PORT}`;
const datosDePrueba = (n) => pedidosSinteticos(n, { prefijo: 'LT-6' });

const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
await new Promise((r) => setTimeout(r, 1500));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await instalarDatosDePrueba(page, { conSesion: true });
const datos = datosDePrueba(CUANTOS);
await page.route(`${SUPABASE_URL}/**`, async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.includes('/rest/v1/orders')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) });
  return route.fallback();
});
await page.addInitScript(() => {
  const c = globalThis.__LA_TABA_RUNTIME_CONFIG__;
  if (c?.repository) c.repository.pollMs = 1200;
  try { delete globalThis.__TAURI__; } catch (_) { globalThis.__TAURI__ = undefined; }
});
await page.goto(`${BASE}/#business`, { waitUntil: 'domcontentloaded' });
await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 60_000 });
await page.locator('[data-production-orders-view]:visible').first().click();
await page.locator('.production-order-card').nth(CUANTOS - 1).waitFor({ state: 'attached', timeout: 180_000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  globalThis.__cpu = 0; globalThis.__max = 0;
  globalThis.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { globalThis.__cpu += e.duration; globalThis.__max = Math.max(globalThis.__max, e.duration); } });
  globalThis.__po.observe({ entryTypes: ['longtask'] });
});
await page.waitForTimeout(32_000);
const r = await page.evaluate(() => { globalThis.__po.disconnect(); return { cpu: Math.round(globalThis.__cpu), max: Math.round(globalThis.__max), tarjetas: document.querySelectorAll('.production-order-card').length }; });
console.log(JSON.stringify({ pedidos: CUANTOS, ...r, ventanaMs: 32000, porcentajeDeUnNucleo: `${(r.cpu / 320).toFixed(1)}%` }));
await browser.close(); server.kill();
