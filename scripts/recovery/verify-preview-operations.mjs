// ¿Lo que el Panel le DICE al comercio, en un teléfono, coincide con lo que pasa? Preview de QA, dinero ficticio.
//
//   node scripts/recovery/verify-preview-operations.mjs [--origin <preview>] [--out <directorio nuevo>]
//        [--cancel-refunded <código>]      cancela ESE pedido de QA si su pago ya fue devuelto (escritura en QA)
//
// La dueña de QA (identidad de prueba del Administrador de credenciales, tipeada en el login de La Taba, nunca en
// Mercado Pago) abre el centro de operación en 390×844: cuenta las alertas por gravedad y lee sus textos y el titular.
// Con --cancel-refunded hace lo que haría el encargado con un pedido reembolsado: Pedidos → detalle → motivo →
// «Cancelar con motivo», y vuelve a mirar el centro de operación. Sin esa bandera no escribe nada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { passPreviewGate } from './preview-gate-login.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const origin = new URL(arg('--origin', 'https://recovery-20261020.taba2-staging.pages.dev')).origin;
assert.match(origin, /^https:\/\/[a-z0-9-]+\.taba2-staging\.pages\.dev$/, 'QA previews only');
const out = path.resolve(arg('--out', ''));
assert.ok(arg('--out') && !fs.existsSync(out), '--out must be a new directory');
fs.mkdirSync(out, { recursive: true });
const cancelCode = arg('--cancel-refunded');
assert.ok(!cancelCode || /^LT-\d{4}$/.test(cancelCode), 'order code like LT-0087');
const owner = leerSecreto('RECOVERY QA OWNER A');
assert.ok(owner?.usuario && owner?.secreto, 'QA owner credential unavailable');
const gate = leerSecreto('RECOVERY PREVIEW ACCESS');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
  ...(gate?.usuario && gate?.secreto ? { httpCredentials: { username: gate.usuario, password: gate.secreto, origin } } : {}),
});
await passPreviewGate(context, origin, gate);
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('dialog', (d) => { void d.dismiss(); });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const evidence = { origin, at: new Date().toISOString(), viewport: '390x844' };

async function openView(view) {
  const target = page.locator(`[data-business-ops-view="${view}"]`);
  for (let i = 0; i < await target.count(); i += 1) {
    if (await target.nth(i).isVisible()) { await target.nth(i).click(); return true; }
  }
  // En el teléfono algunas vistas viven en «Más».
  const more = page.getByRole('button', { name: /^Más/ });
  if (await more.count()) { await more.first().click(); await page.waitForTimeout(400); }
  for (let i = 0; i < await target.count(); i += 1) {
    if (await target.nth(i).isVisible()) { await target.nth(i).click(); return true; }
  }
  return false;
}

async function readOperationCenter(label) {
  assert.ok(await openView('operation-center'), 'operation center not reachable');
  await page.locator('article.operation-alert, .operation-center-empty, [data-operation-center-refresh]').first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    headline: document.querySelector('.operation-summary h3, .operation-summary strong, [data-operation-summary] h3')?.textContent?.trim() || '',
    alerts: [...document.querySelectorAll('article.operation-alert')].map((a) => ({
      severity: [...a.classList].find((c) => c.startsWith('severity-'))?.slice(9) || '',
      label: a.querySelector('.operation-alert-severity')?.textContent?.trim() || '',
      happened: a.querySelector('h4')?.textContent?.trim() || '',
      action: a.querySelector('[data-business-ops-view]')?.textContent?.trim() || '',
    })),
    bodyHasStop: /Frená y resolvé ahora|cosas? para frenar/.test(document.body.innerText),
    metrics: Object.fromEntries([...document.querySelectorAll('[data-operation-metric]')].map((card) => [
      card.getAttribute('data-operation-metric'), Number((card.textContent.match(/\d+/) || ['NaN'])[0])])),
  }));
  await page.screenshot({ path: path.join(out, `${label}-centro-de-operacion.png`), fullPage: false });
  evidence[label] = state;
  return state;
}

try {
  await page.goto(`${origin}/#business`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const form = page.locator('[data-production-auth-form="business"]');
  await form.waitFor({ state: 'visible', timeout: 45000 });
  await form.locator('input[name="email"]').fill(owner.usuario);
  await form.locator('input[name="password"]').fill(owner.secreto);
  await form.locator('button[type="submit"]').click();
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 60000 });
  check('panel login with the QA owner on a phone', true);
  evidence.version = await page.evaluate(() => fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null));

  const before = await readOperationCenter('antes');
  const abandoned = before.alerts.filter((a) => /empezó a pagar en Mercado Pago y no terminó/.test(a.happened));
  const reversed = before.alerts.filter((a) => /pago ya se le devolvió/.test(a.happened));
  check('abandoned Mercado Pago checkouts are information, not an emergency', abandoned.length > 0 && abandoned.every((a) => a.severity === 'info'), `${abandoned.length} INFO`);
  check('no alert asks to stop selling', !before.bodyHasStop && !before.alerts.some((a) => a.severity === 'critical'), before.headline);
  check('the refunded open order asks to cancel it, from Pedidos', reversed.length === (cancelCode ? 1 : reversed.length) && reversed.every((a) => a.severity === 'action_required' && /Pedidos/.test(a.action)),
    `${reversed.length} ${reversed[0]?.label || ''}`);
  if (reversed.length) {
    // 20261024020000: el mismo pedido no puede ser a la vez «cancelalo» y «esperando que lo aceptes» o «demorado».
    check('the refunded order is not counted as new or delayed', before.metrics.new_orders === 0 && before.metrics.delayed_orders === 0,
      JSON.stringify({ new_orders: before.metrics.new_orders, delayed_orders: before.metrics.delayed_orders }));
  }

  if (cancelCode) {
    assert.ok(await openView('orders'), 'orders view not reachable');
    const card = page.locator('.production-order-card', { hasText: cancelCode }).first();
    await card.waitFor({ state: 'visible', timeout: 45000 });
    await card.screenshot({ path: path.join(out, 'pedido-reembolsado-tarjeta.png') });
    check('the order card says the money went back', /Pago devuelto/.test(await card.innerText()));
    const summary = card.locator('summary').first();
    if (await summary.count()) await summary.click();
    const reason = card.locator('[data-production-cancel-reason]');
    await reason.waitFor({ state: 'visible', timeout: 15000 });
    await reason.fill('Pago devuelto al cliente (QA)');
    await card.locator('[data-production-business-cancel]').click();
    // La alerta se resuelve en la próxima reconciliación (el barrido corre cada minuto; «Actualizar» la pide ya).
    // Medido en QA el 24/10: cancelado 00:39:11, resuelta 00:40:00. Se espera hasta 120 s, pidiendo actualizar.
    let after = await readOperationCenter('despues');
    for (let i = 0; i < 8 && after.alerts.some((a) => /pago ya se le devolvió/.test(a.happened)); i += 1) {
      await page.waitForTimeout(15000);
      const refresh = page.locator('[data-operation-center-refresh]').first();
      if (await refresh.isVisible().catch(() => false)) await refresh.click().catch(() => {});
      after = await readOperationCenter('despues');
    }
    check('after cancelling, the refunded-order alert is gone', !after.alerts.some((a) => /pago ya se le devolvió/.test(a.happened)), `${after.alerts.length} alerts`);
  }
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  evidence.consoleErrors = consoleErrors;
  evidence.checks = checks;
  evidence.passed = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
  console.log(JSON.stringify({ passed: evidence.passed, failed: checks.filter((c) => !c.ok).map((c) => c.name) }));
  if (!evidence.passed) process.exitCode = 1;
}
