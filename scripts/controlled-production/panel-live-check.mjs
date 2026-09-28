// El Panel EN VIVO de CONTROLLED_PRODUCTION con la sesión del dueño técnico del
// comercio real: «Preparar apertura», «Equipo» e «Impresora del local» en
// escritorio (Chromium) y en un teléfono (Chrome Android, Pixel 7).
//
//   node scripts/controlled-production/panel-live-check.mjs [--out report.json]
//
// Lo que se compara: los pasos pendientes que muestra el Panel son EXACTAMENTE
// los que devuelve `get_store_opening_readiness` para el comercio real. Entra
// por el formulario del Panel, como una persona (así se registra la sesión de
// identidad) y sale con «Cerrar sesión». Sólo lee. No imprime correos ni tokens.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, devices } from '@playwright/test';
import { loadTargetKeys } from './target-keys.mjs';
import { REAL_BUSINESS } from './qa-window.mjs';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const ORIGIN = 'https://la-taba-commercial-pilot.pages.dev/';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const args = process.argv.slice(2);
const out = (() => { const i = args.indexOf('--out'); return i < 0 ? '' : args[i + 1]; })();

const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const readiness = (await admin.rpc('get_store_opening_readiness', { p_business_id: REAL_BUSINESS, p_min_products: 1 })).data;
assert.ok(readiness?.pending, 'READINESS_UNAVAILABLE');
const served = await (await fetch(`${ORIGIN}version.json?t=${Date.now()}`, { cache: 'no-store' })).json();

const stored = leerSecreto('CP OWNER MARCO PANEL');
assert.ok(stored?.usuario && stored?.secreto, 'OWNER_CREDENTIAL_REQUIRED');

const checks = [];
const check = (id, ok, detail = '') => {
  checks.push({ id, ok: Boolean(ok), detail: String(detail ?? '').slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` · ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
try {
  for (const [name, device] of [['escritorio', { viewport: { width: 1366, height: 768 } }], ['telefono', devices['Pixel 7']]]) {
    const context = await browser.newContext({ ...device, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Como una persona: se escribe cuando el Panel terminó de arrancar (el formulario se
    // vuelve a dibujar cuando termina de mirar si ya había una sesión).
    await page.goto(`${ORIGIN}#business`, { waitUntil: 'networkidle' });
    const form = page.locator('[data-production-auth-form]:visible').first();
    await form.waitFor({ timeout: 45_000 });
    await form.locator('[name="email"]').fill(stored.usuario);
    await form.locator('[name="password"]').fill(stored.secreto);
    await form.locator('button[type="submit"]').click();
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 45_000 });
    check(`${name}:INGRESO_POR_FORMULARIO`, true);
    const phone = name === 'telefono';
    const go = async (view) => {
      if (phone) {
        await page.locator('[data-panel-more-toggle]').click();
        await page.locator(`[data-panel-more-sheet] [data-business-ops-view="${view}"]`).click();
      } else {
        await page.locator(`nav.production-operations-shortcuts [data-business-ops-view="${view}"]`).click();
      }
    };

    await go('store-opening');
    await page.getByRole('heading', { name: 'Preparar apertura' }).waitFor({ timeout: 30_000 });
    await page.locator('[data-opening-code]').first().waitFor({ timeout: 30_000 });
    const shown = await page.locator('[data-opening-code].is-blocking:not(.is-pass)').evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-opening-code')).sort());
    const expected = [...readiness.pending].sort();
    check(`${name}:APERTURA_MISMOS_PASOS_QUE_EL_SERVIDOR`, JSON.stringify(shown) === JSON.stringify(expected), shown.join(','));
    const summary = await page.getByText(/Faltan \d+ pasos? para abrir/).first().textContent().catch(() => '');
    check(`${name}:APERTURA_CUENTA`, summary.includes(`Faltan ${expected.length - (expected.includes('PLATFORM_VERIFICATION') ? 1 : 0)}`)
      || summary.includes(`Faltan ${expected.length}`), summary.trim());
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    check(`${name}:SIN_DESBORDE`, overflow <= 1, `${overflow}px`);

    await go('team');
    await page.getByRole('heading', { name: 'Equipo' }).waitFor({ timeout: 30_000 });
    // La lista llega aparte: se cuenta cuando terminó de cargar («Actualizar» habilitado).
    await page.locator('[data-team-refresh]:not([disabled])').first().waitFor({ timeout: 30_000 });
    await page.locator('[data-team-member]').first().waitFor({ timeout: 30_000 }).catch(() => {});
    const members = await page.locator('[data-team-member]').count();
    check(`${name}:EQUIPO_LISTA`, members >= 1, `${members} integrantes`);

    await go('print-agent');
    await page.getByRole('heading', { name: 'Impresora del local' }).waitFor({ timeout: 30_000 });
    const agentState = await page.locator('[data-print-agent-state]').first().getAttribute('data-print-agent-state');
    check(`${name}:IMPRESORA_ESTADO`, Boolean(agentState), agentState);

    check(`${name}:SIN_ERRORES_JS`, errors.length === 0, errors.join(' | '));
    await page.locator('[data-production-sign-out]:visible').first().click();
    await page.locator('[data-production-auth-form]:visible').first().waitFor({ timeout: 30_000 });
    check(`${name}:CERRAR_SESION`, true);
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
const report = { at: new Date().toISOString(), target: 'controlled-production', business: 'la-taba-cp (sólo lectura)',
  served: { commit: served.commit, runtime: served.runtime }, pending: readiness.pending,
  verdict: failed.length ? 'FAIL' : 'PASS', passed: checks.length - failed.length, total: checks.length, checks };
if (out) { mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`); }
console.log(`\nPANEL_LIVE: ${report.verdict} (${report.passed}/${report.total}) · sirve ${served.commit?.slice(0, 7)} ${served.runtime}`);
if (failed.length) process.exitCode = 1;
