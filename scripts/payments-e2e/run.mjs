/*
 * BANCO DE COBROS DE PUNTA A PUNTA (sin red, sin dinero)
 *
 *   node scripts/payments-e2e/run.mjs                         # entorno de prueba (binding de QA, integradora ≠ vendedor)
 *   node scripts/payments-e2e/run.mjs --environment production # ensayo de producción sobre un ref FICTICIO
 *   node scripts/payments-e2e/run.mjs --report <archivo.json> --only apro,refunds
 *
 * Qué es real y qué no:
 *   REAL      el código de las funciones Edge (cada index.ts en su isolate, Deno 2.6.1), supabase-js, PostgREST,
 *             PostgreSQL con las 174 migraciones del repositorio, RLS, grants, disparadores, la cola y el worker.
 *   EMULADO   Mercado Pago (scripts/payments-e2e/mp-emulator.mjs) y la verificación del JWT de Supabase Auth.
 *   NO PRUEBA que Mercado Pago se comporte como el emulador: eso lo prueba scripts/payments-e2e/sandbox.mjs contra la
 *   API real con credenciales de prueba.
 *
 * Requisitos: Docker y Node 22. Baja (una vez) la imagen fijada de Postgres de Supabase y la de PostgREST.
 * Salida 0 = todos los escenarios pasaron. 1 = alguno falló (el informe dice cuál y por qué).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { ROOT } from '../release-v5/model.mjs';
import { bindSellerOauth, addRefToList, FILES, PRODUCTION_CLIENT_ID } from '../production/bind-production.mjs';
import { PUBLISH_PORTS, startPaymentStack } from './stack.mjs';
import { MercadoPagoEmulator } from './mp-emulator.mjs';
import { FunctionsClient, signJwt } from './lib.mjs';
import { fixtureIds, seedSql } from './seed.mjs';
import { SCENARIOS } from './scenarios.mjs';

const RECOVERY_TEST_APPLICATION_ID = '4861627125869370';
const FUNCTIONS = [
  'mercadopago-connect', 'mercadopago-oauth-callback', 'mercadopago-create-checkout-session',
  'mercadopago-create-preference', 'mercadopago-checkout-status', 'mercadopago-webhook',
  'mercadopago-payment-worker', 'mercadopago-refund', 'mercadopago-cancel-payment',
];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export async function runBench({ environment = 'test', only = null, log = console.log } = {}) {
  assert.ok(['test', 'production'].includes(environment), 'environment: test | production');
  // Un ref ficticio: nunca el de QA ni uno de producción. Ningún pedido sale del banco.
  const ref = environment === 'test' ? 'paymentsbenchtestref' : 'paymentsbenchprodref';
  const origin = environment === 'test' ? 'https://payments-bench.taba2-staging.pages.dev' : 'https://la-taba.pages.dev';
  const clientId = environment === 'test' ? RECOVERY_TEST_APPLICATION_ID : PRODUCTION_CLIENT_ID;
  const cleanups = [];
  const report = {
    generated_at: new Date().toISOString(), environment, project_ref: `${ref} (ficticio)`, provider: 'emulador (mp-emulator.mjs)',
    real_money: false, network: PUBLISH_PORTS
      ? 'Docker Desktop: puertos sólo en 127.0.0.1 y contenedores sin DNS externo; fetch del host limitado a PostgREST, Auth local y el emulador'
      : 'red interna de Docker sin salida; fetch del host limitado a PostgREST, Auth local y el emulador',
    scenarios: [],
  };
  try {
    const t0 = Date.now();
    const stack = await startPaymentStack({ log });
    cleanups.push(() => stack.close());
    report.stack = { postgres: 'public.ecr.aws/supabase/postgres:17.6.1.166 (digest de CI)', postgrest: 'v12.2.12', seconds: Math.round((Date.now() - t0) / 1000) };

    // Funciones: las del repositorio en prueba; en producción una COPIA con el binding que escribirá bind-production.mjs.
    let functionsDir = path.join(ROOT, 'supabase', 'functions');
    if (environment === 'production') {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-pay-bench-'));
      cleanups.push(() => fs.rmSync(temp, { recursive: true, force: true }));
      fs.cpSync(functionsDir, path.join(temp, 'supabase', 'functions'), { recursive: true });
      const rewrite = (file, transform) => {
        const target = path.join(temp, file);
        fs.writeFileSync(target, transform(fs.readFileSync(target, 'utf8')), 'utf8');
      };
      rewrite(FILES.sellerOauth, (source) => bindSellerOauth(source, { ref, origin, at: new Date().toISOString() }));
      rewrite(FILES.recoveryDeployment, (source) => addRefToList(source, 'RECOVERY_FORBIDDEN_REFS = new Set([', ref, 'recovery-deployment.ts'));
      functionsDir = path.join(temp, 'supabase', 'functions');
    }

    const application = {
      clientId, clientSecret: randomBytes(24).toString('base64url'), webhookSecret: randomBytes(32).toString('hex'),
      // El dueño de la integradora es una cuenta DISTINTA de todo vendedor (producción: La Taba; prueba: el dueño de TestApp).
      ownerId: environment === 'test' ? 3594962708 : 721168650,
    };
    const users = [
      { id: application.ownerId, nickname: 'LATABA_INTEGRADORA', email: 'integradora@bench.invalid', kind: 'owner' },
      { id: 4100000101, nickname: 'VENDEDOR_A', email: 'vendedor-a@bench.invalid', kind: 'seller' },
      { id: 4100000102, nickname: 'VENDEDOR_B', email: 'vendedor-b@bench.invalid', kind: 'seller' },
      { id: 4100000201, nickname: 'COMPRADOR_1', email: 'comprador-1@bench.invalid', kind: 'buyer' },
      { id: 4100000202, nickname: 'COMPRADOR_2', email: 'comprador-2@bench.invalid', kind: 'buyer' },
    ];
    let gateway = '';
    const emulator = new MercadoPagoEmulator({
      environment, application, users,
      // Las notificaciones van a la notification_url pública de la preferencia; acá llegan al gateway del banco.
      deliver: (url, init) => {
        const target = new URL(url);
        assert.equal(target.origin, `https://${ref}.supabase.co`, 'notificación a un host ajeno');
        return fetch(`${gateway}${target.pathname}${target.search}`, { ...init, headers: { ...init.headers, 'x-forwarded-for': '54.88.218.97' } });
      },
    });
    await emulator.start();
    cleanups.push(() => emulator.stop());

    const serviceKey = signJwt({ role: 'service_role' }, stack.jwtSecret, 86400);
    const anonKey = signJwt({ role: 'anon' }, stack.jwtSecret, 86400);
    const workerSecret = randomBytes(32).toString('hex');
    const env = {
      SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_ANON_KEY: anonKey,
      MERCADOPAGO_CREDENTIAL_MODE: 'oauth', MERCADOPAGO_ENVIRONMENT: environment, MERCADOPAGO_OAUTH_ENVIRONMENT: environment,
      TABA_DEPLOYMENT_ENV: environment === 'test' ? 'staging' : 'production', MERCADOPAGO_OAUTH_PROJECT_REF: ref,
      MERCADOPAGO_OAUTH_PANEL_URL: `${origin}/`, MERCADOPAGO_CLIENT_ID: clientId, MERCADOPAGO_CLIENT_SECRET: application.clientSecret,
      MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64url'), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: application.webhookSecret,
      MERCADOPAGO_WEBHOOK_SECRET: randomBytes(16).toString('hex'), PAYMENT_LOG_HASH_SALT: randomBytes(16).toString('hex'),
      PAYMENT_WORKER_SECRET: workerSecret, TABA_CHECKOUT_BASE_URL: origin, TABA_ALLOWED_ORIGINS: origin,
      ...(environment === 'test'
        ? { TABA_RECOVERY_PROJECT_REF: ref, TABA_RECOVERY_CHECKOUT_ORIGIN: origin }
        // Ensayo de producción: la revisión aprobada y la llave final SÓLO en este proceso local, con un ref ficticio
        // y el emulador. Es el camino de código del cobro real, sin un solo peso real.
        : { MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved', MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE' }),
    };
    // Como URL de archivo: una ruta de Windows (D:...) no es un especificador de módulo para el import dinámico del Worker.
    const hostConfig = { ref, restUrl: stack.restUrl, jwtSecret: stack.jwtSecret, providerUrl: emulator.url, functionsDir: pathToFileURL(functionsDir).href, functions: FUNCTIONS };
    const host = await startEdgeHost(hostConfig, env, log);
    cleanups.push(() => host.stop());
    gateway = host.gateway;

    const ids = fixtureIds();
    await stack.query(seedSql(ids));
    const functions = new FunctionsClient({ gateway, anonKey, origin });
    const context = {
      environment, ref, origin, clientId, application, users, ids, stack, emulator, functions, workerSecret, env, log,
      sellers: { A: 4100000101, B: 4100000102 }, buyers: { one: 4100000201, two: 4100000202 },
    };
    for (const scenario of SCENARIOS) {
      if (only && !only.includes(scenario.id)) continue;
      if (scenario.environments && !scenario.environments.includes(environment)) continue;
      const started = Date.now();
      const entry = { id: scenario.id, title: scenario.title, ok: false };
      try {
        entry.evidence = await scenario.run(context);
        entry.ok = true;
      } catch (error) {
        entry.error = String(error?.stack || error).split('\n').slice(0, 6).join('\n');
      }
      entry.ms = Date.now() - started;
      report.scenarios.push(entry);
      log(`${entry.ok ? 'PASS' : 'FAIL'} ${environment} ${scenario.id} (${entry.ms} ms)${entry.ok ? '' : `\n${entry.error}`}`);
      if (!entry.ok && scenario.required !== false && scenario.stopOnFailure) break;
    }
    report.provider_calls = summarizeCalls(emulator.calls);
    report.notifications = emulator.deliveries.map(({ at, type, dataId, shape, status, userId }) => ({ at, type, data_id: dataId, shape, status, user_id: userId }));
    report.host_log_tail = host.tail();
    report.ok = report.scenarios.length > 0 && report.scenarios.every((scenario) => scenario.ok);
    return report;
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch { /* seguir limpiando */ }
    }
  }
}

function summarizeCalls(calls) {
  const summary = {};
  for (const call of calls) {
    const key = `${call.method} ${call.path.replace(/\d{6,}/g, ':id').replace(/\/[0-9]+-[0-9a-f-]{36}$/, '/:preference')}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  return summary;
}

async function startEdgeHost(config, env, log) {
  const windows = process.platform === 'win32';
  const child = spawn(windows ? 'npx.cmd' : 'npx', ['--yes', 'deno@2.6.1', 'run', '--node-modules-dir=none', '--allow-net', '--allow-env', '--allow-read',
    path.join(ROOT, 'scripts', 'payments-e2e', 'edge-host.ts')], {
    cwd: ROOT, env: { ...process.env, ...env, TABA_BENCH_HOST: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'pipe'],
    // Grupo de procesos propio: npx → lanzador de Node → binario de Deno; se termina el grupo entero (en Windows, con taskkill /T).
    detached: !windows, shell: windows, windowsHide: true,
  });
  const killGroup = (signal) => {
    try {
      if (windows) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, signal);
    } catch { /* ya terminó */ }
  };
  process.once('exit', () => killGroup('SIGKILL'));
  const lines = [];
  const remember = (line) => { lines.push(line); if (lines.length > 400) lines.shift(); };
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`EDGE_HOST_TIMEOUT\n${lines.slice(-30).join('\n')}`)), Number(process.env.TABA_BENCH_HOST_TIMEOUT_MS || 240_000));
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      remember(line);
      const match = /^BENCH_HOST_READY (\d+)$/.exec(line);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    readline.createInterface({ input: child.stderr }).on('line', remember);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`EDGE_HOST_EXITED ${code}\n${lines.slice(-30).join('\n')}`)); });
  });
  log(`EDGE_HOST_READY ${config.functions.length} funciones reales en isolates (puerto ${port})`);
  return {
    gateway: `http://127.0.0.1:${port}`,
    tail: () => lines.filter((line) => !/^\s*$/.test(line)).slice(-60),
    stop: () => new Promise((resolve) => {
      child.once('exit', resolve);
      killGroup('SIGTERM');
      setTimeout(() => { killGroup('SIGKILL'); resolve(); }, 3000);
    }),
  };
}

// pathToFileURL: en Windows `file://${argv[1]}` nunca coincide con import.meta.url y el banco salía con 0 sin correr nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const environments = (option('--environment', 'test,production')).split(',');
  const only = option('--only', null)?.split(',') ?? null;
  const reportPath = option('--report', null);
  const reports = [];
  for (const environment of environments) reports.push(await runBench({ environment, only }));
  // Un banco que no ejecutó ningún escenario no certifica nada.
  const ok = reports.length > 0 && reports.every((report) => report.ok && report.scenarios.length > 0);
  const output = { ok, generated_at: new Date().toISOString(), runs: reports };
  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), JSON.stringify(output, null, 2) + '\n');
  }
  for (const report of reports) {
    const passed = report.scenarios.filter((scenario) => scenario.ok).length;
    console.log(`BANCO ${report.environment}: ${passed}/${report.scenarios.length} escenarios en verde`);
  }
  process.exitCode = ok ? 0 : 1;
}
