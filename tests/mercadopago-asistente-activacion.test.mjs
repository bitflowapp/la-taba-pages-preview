import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readEnvironments } from '../scripts/lib/environments.mjs';
import {
  bindingState, checklist, integratorCheck, networkChecks, PROBE_SELLER, resolveTarget, rollbackPlan, signedProbe,
  webhookSecretCheck,
} from '../scripts/mercadopago/asistente-activacion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTIVE = readEnvironments(path.join(ROOT, 'tests/fixtures/environments.production-active.json'));
const target = resolveTarget('production', ACTIVE);
const supabase = `https://${target.ref}.supabase.co`;

// Un despliegue sano, con las respuestas que dan las funciones reales (medidas en el banco de cobros).
function healthy(overrides = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.origin}${u.pathname}${u.search}`;
    if (overrides[key]) return overrides[key](init);
    if (u.origin === target.origin) {
      if (u.pathname === '/runtime-config.js') return new Response(`window.TABA = { supabaseUrl: '${supabase}' };`);
      if (u.pathname === '/release-identity.json') return Response.json({ cacheName: 'la-taba-runtime-v168-pago-retorno' });
      return new Response('<!doctype html>');
    }
    if (u.pathname === '/functions/v1/mercadopago-oauth-callback') {
      return new Response(null, { status: 303, headers: { location: `${target.origin}/?mp_connection=error#business` } });
    }
    if (u.pathname === '/functions/v1/mercadopago-webhook') {
      if ((init.method || 'GET') === 'GET') return new Response(null, { status: 405 });
      if (u.searchParams.get('topic') === 'payment') return Response.json({ ok: true, ignored: 'legacy_ipn' });
      return Response.json({ ok: true, seller_authorization: 'not_connected' });
    }
    if (u.pathname === '/functions/v1/mercadopago-create-checkout-session') {
      const origin = new Headers(init.headers).get('origin');
      return origin === target.origin
        ? new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin } })
        : Response.json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' }, { status: 403 });
    }
    if (u.pathname === '/functions/v1/mercadopago-payment-worker') return Response.json({ ok: false }, { status: 401 });
    throw new Error(`sin respuesta para ${key}`);
  };
}

test('sin proyecto de producción el destino lo dice y el checklist arranca por P1', () => {
  const now = resolveTarget('production');
  assert.equal(now.provisioned, false);
  assert.equal(now.status, 'not_provisioned');
  const steps = checklist(now, bindingState(now.ref));
  assert.equal(steps[0].id, 'P1');
  assert.equal(steps[0].state, 'pendiente');
  assert.equal(steps.find((step) => step.id === 'P2').state, 'pendiente');
  assert.ok(steps.some((step) => step.id === 'P10' && step.who.includes('Walter')));
});

test('el binding se detecta en el código de las funciones, sin leer secretos', () => {
  assert.equal(bindingState('wwcpogltfgzgkrlilbcd').bound, true);
  assert.equal(bindingState(target.ref).bound, false);
  assert.match(bindingState(target.ref).reason, /bind-production/);
});

test('red: un despliegue sano pasa las nueve comprobaciones', async () => {
  const result = await networkChecks(target, healthy());
  assert.equal(result.ok, true, JSON.stringify(result.rows.filter((row) => !row.ok)));
  assert.deepEqual(result.rows.map((row) => row.id), ['sitio_https', 'sitio_apunta_al_proyecto', 'sitio_identidad', 'callback_oauth',
    'webhook_metodo', 'webhook_configurado', 'cors_tienda', 'cors_ajeno', 'worker_firma']);
});

test('red: cada falla dice qué falta', async () => {
  const result = await networkChecks(target, healthy({
    [`GET ${target.origin}/runtime-config.js`]: () => new Response("window.TABA = { supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co' };"),
    [`GET ${supabase}/functions/v1/mercadopago-oauth-callback`]: () => Response.json({ ok: false }, { status: 503 }),
    [`POST ${supabase}/functions/v1/mercadopago-webhook?topic=payment&id=1`]: () => Response.json({ ok: false, code: 'PAYMENT_UNAVAILABLE' }, { status: 503 }),
    [`OPTIONS ${supabase}/functions/v1/mercadopago-create-checkout-session`]: (init) => new Response(null, { status: 204,
      headers: { 'access-control-allow-origin': new Headers(init.headers).get('origin') } }),
  }));
  const failed = Object.fromEntries(result.rows.filter((row) => !row.ok).map((row) => [row.id, row.fix]));
  assert.equal(result.ok, false);
  assert.match(failed.sitio_apunta_al_proyecto, /otra base/);
  assert.match(failed.callback_oauth, /secretos OAuth/);
  assert.match(failed.webhook_configurado, /MERCADOPAGO_OAUTH_WEBHOOK_SECRET/);
  assert.match(failed.cors_ajeno, /TABA_ALLOWED_ORIGINS/);
  assert.equal(failed.cors_tienda, undefined);
});

test('red: un sitio protegido con contraseña (QA) no se cuenta como falla, pero tampoco como verificado', async () => {
  const qa = { ...target, name: 'qa', siteAccess: 'basic-auth' };
  const result = await networkChecks(qa, healthy({
    [`GET ${target.origin}/`]: () => new Response('auth', { status: 401 }),
    [`GET ${target.origin}/runtime-config.js`]: () => new Response('auth', { status: 401 }),
    [`GET ${target.origin}/release-identity.json`]: () => new Response('auth', { status: 401 }),
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.filter((row) => row.skipped).map((row) => row.id), ['sitio_apunta_al_proyecto', 'sitio_identidad']);
});

test('la sonda firmada es la receta oficial: id;request-id;ts con HMAC-SHA256 y un vendedor inexistente', () => {
  const now = 1_790_000_000_000;
  const probe = signedProbe(target, 'clave-de-prueba-de-32-caracteres!', { now, requestId: 'req-1' });
  const ts = String(Math.floor(now / 1000));
  const expected = createHmac('sha256', 'clave-de-prueba-de-32-caracteres!').update(`id:${PROBE_SELLER};request-id:req-1;ts:${ts};`).digest('hex');
  assert.equal(probe.init.headers['x-signature'], `ts=${ts},v1=${expected}`);
  assert.equal(new URL(probe.url).searchParams.get('type'), 'mp-connect');
  assert.equal(JSON.parse(probe.init.body).user_id, Number(PROBE_SELLER));
});

test('webhook-firma: sólo una respuesta positiva prueba que la clave coincide', async () => {
  assert.equal((await webhookSecretCheck(target, 'x'.repeat(32), healthy())).verdict, 'clave_coincide');
  const wrong = await webhookSecretCheck(target, 'x'.repeat(32), healthy({
    [`POST ${supabase}/functions/v1/mercadopago-webhook?data.id=${PROBE_SELLER}&type=mp-connect`]: () => Response.json({ ok: false, code: 'INVALID_WEBHOOK' }, { status: 401 }),
  }));
  assert.equal(wrong.verdict, 'clave_distinta');
  assert.match(wrong.fix, /UNA fila rejected_signature/);
  // Sin la revisión productiva cargada la firma no se evalúa: un 503 NUNCA se informa como clave correcta.
  const unconfigured = await webhookSecretCheck(target, 'x'.repeat(32), healthy({
    [`POST ${supabase}/functions/v1/mercadopago-webhook?data.id=${PROBE_SELLER}&type=mp-connect`]: () => Response.json({ ok: false }, { status: 503 }),
  }));
  assert.equal(unconfigured.verdict, 'configuracion');
  assert.equal(unconfigured.ok, false);
  const noFunction = await webhookSecretCheck(target, 'x'.repeat(32), healthy({
    [`POST ${supabase}/functions/v1/mercadopago-webhook?topic=payment&id=1`]: () => new Response('not found', { status: 404 }),
  }));
  assert.equal(noFunction.verdict, 'configuracion');
});

test('integradora: en producción la dueña es una cuenta real; en QA, un usuario de prueba', async () => {
  const provider = (tags) => async (url) => {
    const u = new URL(url);
    if (u.pathname === '/oauth/token') return Response.json({ access_token: 'APP_USR-fixture', user_id: 721168650, live_mode: true });
    if (u.pathname === '/users/me') return Response.json({ id: 721168650, site_id: 'MLA', tags });
    throw new Error('inesperado');
  };
  assert.equal((await integratorCheck(target, 's'.repeat(32), provider(['normal']))).ok, true);
  const testOwner = await integratorCheck(target, 's'.repeat(32), provider(['normal', 'test_user']));
  assert.equal(testOwner.ok, false);
  assert.match(testOwner.fix, /cuenta real/);
  assert.equal((await integratorCheck({ ...target, name: 'qa' }, 's'.repeat(32), provider(['normal', 'test_user']))).ok, true);
  const refused = await integratorCheck(target, 's'.repeat(32), async () => Response.json({ error: 'invalid_client' }, { status: 400 }));
  assert.equal(refused.step, 'client_credentials');
});

test('reversión: siete niveles, del apagado del comercio a la restauración', () => {
  const plan = rollbackPlan({ business: '00000000-0000-4000-8000-000000000001', slug: 'la-taba' });
  assert.deepEqual(plan.map((step) => step.level), [1, 2, 3, 4, 5, 6, 7]);
  assert.match(plan[0].action, /cobro-negocio\.mjs apagar --target=production --business=00000000-0000-4000-8000-000000000001 --confirmar=la-taba/);
  assert.match(plan[1].action, /MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION/);
});

test('CLI: mientras producción no exista, estado y red salen 2 sin tocar la red', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/mercadopago/asistente-activacion.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9' } });
  const estado = run('estado', '--json');
  assert.equal(estado.status, 2);
  assert.equal(JSON.parse(estado.stdout).steps[0].state, 'pendiente');
  const red = run('red');
  assert.equal(red.status, 2);
  assert.match(red.stderr, /PRODUCCIÓN NO EXISTE TODAVÍA/);
  const firma = run('webhook-firma');
  assert.equal(firma.status, 2);
});
