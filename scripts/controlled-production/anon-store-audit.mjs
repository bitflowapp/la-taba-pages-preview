// La tienda de CONTROLLED_PRODUCTION vista por un visitante anónimo, EN VIVO:
// cada ruta pública en tres combinaciones de motor y tamaño (Chromium de
// escritorio, Chrome Android y Safari de iPhone). Sólo lee: sin sesión, sin
// formularios, sin pedidos.
//
//   node scripts/controlled-production/anon-store-audit.mjs [--out report.json]
//
// Una ruta está limpia si carga, no tira errores de JavaScript y no recibe
// ninguna respuesta 4xx/5xx del sitio ni de Supabase fuera de las esperadas
// (EXPECTED_ERRORS, cada una con su motivo). Además, con la clave publicable,
// ningún tenant expone catálogo que no deba.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, webkit, devices } from '@playwright/test';
import { foreignPublicTenants, publicCatalogTenants, REAL_BUSINESS } from './qa-window.mjs';

const ORIGIN = 'https://la-taba-commercial-pilot.pages.dev';
const CP_REF = 'tkanbadcglszlcyfjvpv';
export const ROUTES = Object.freeze(['/#home', '/#catalog', '/#cart', '/#profile', '/#tracking', '/#business',
  '/cuenta/', '/pago/resultado/', '/pago/error/', '/pago/pendiente/']);
// Respuestas de error que la tienda recibe a propósito, sin sesión.
export const EXPECTED_ERRORS = Object.freeze([
  {
    status: 401,
    pattern: /\/rest\/v1\/rpc\/get_mercadopago_checkout_availability$/,
    // Contrato: un visitante anónimo no puede sondear la disponibilidad de Mercado
    // Pago (mercadopago_availability_requires_seller.local.sql). Sin sesión la
    // tienda lo trata como «no disponible» y vuelve a preguntar en cuanto empieza
    // la sesión del cliente.
    reason: 'MP_AVAILABILITY_IS_AUTHENTICATED_ONLY',
  },
]);
const args = process.argv.slice(2);
const out = (() => { const i = args.indexOf('--out'); return i < 0 ? '' : args[i + 1]; })();

export function isExpected(entry) {
  return EXPECTED_ERRORS.some((rule) => rule.status === entry.status && rule.pattern.test(entry.url));
}

async function main() {
  const version = await (await fetch(`${ORIGIN}/version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
  const runtimeText = await (await fetch(`${ORIGIN}/runtime-config.js?t=${Date.now()}`, { cache: 'no-store' })).text();
  const key = /sb_publishable_[A-Za-z0-9_-]+/.exec(runtimeText)?.[0];
  assert.ok(key, 'PUBLISHABLE_KEY_NOT_IN_RUNTIME');
  const anon = createClient(`https://${CP_REF}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const tenants = await publicCatalogTenants(anon);
  // Los instaladores del equipo viven en un bucket privado: un anónimo no lista la
  // carpeta del comercio ni firma links de lo que hay adentro.
  const listed = await anon.storage.from('team-apps').list(REAL_BUSINESS, { limit: 10 });
  const signed = await anon.storage.from('team-apps').createSignedUrl(`${REAL_BUSINESS}/manifest.json`, 60);
  const teamApps = { listed: (listed.data || []).length, signed: Boolean(signed.data?.signedUrl) };

  const results = [];
  for (const [label, engine, device] of [['chromium', chromium, { viewport: { width: 1366, height: 768 } }],
    ['chrome_android', chromium, devices['Pixel 7']], ['webkit_iphone', webkit, devices['iPhone 13']]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const route of ROUTES) {
        const context = await browser.newContext({ ...device, serviceWorkers: 'block' });
        const page = await context.newPage();
        const pageErrors = [];
        const badResponses = [];
        page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 160)));
        page.on('response', (response) => {
          const url = response.url();
          if (response.status() >= 400 && (url.startsWith(ORIGIN) || url.includes(`${CP_REF}.supabase.co`))) {
            badResponses.push({ status: response.status(), url: url.replace(/[?#].*$/, '').slice(0, 160) });
          }
        });
        const response = await page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForTimeout(1500);
        const unexpected = badResponses.filter((entry) => !isExpected(entry));
        results.push({ engine: label, route, status: response?.status() ?? 0, pageErrors, unexpected,
          expected: badResponses.length - unexpected.length,
          clean: (response?.status() ?? 0) < 400 && pageErrors.length === 0 && unexpected.length === 0 });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }

  const clean = results.filter((r) => r.clean).length;
  const report = { at: new Date().toISOString(), origin: ORIGIN, served: { commit: version.commit, runtime: version.runtime },
    publicCatalogTenants: tenants.length, foreignPublicTenants: foreignPublicTenants(tenants, REAL_BUSINESS).length,
    realBusinessCatalogPublic: tenants.includes(REAL_BUSINESS), routes: `${clean}/${results.length}`, teamApps,
    verdict: clean === results.length && foreignPublicTenants(tenants, REAL_BUSINESS).length === 0
      && teamApps.listed === 0 && !teamApps.signed ? 'PASS' : 'FAIL',
    results: results.filter((r) => !r.clean || r.expected), };
  if (out) { mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`); }
  console.log(JSON.stringify({ verdict: report.verdict, routes: report.routes, served: report.served,
    foreignPublicTenants: report.foreignPublicTenants, realBusinessCatalogPublic: report.realBusinessCatalogPublic, teamApps,
    notClean: results.filter((r) => !r.clean) }, null, 1));
  if (report.verdict !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  await main();
}
