import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TARGETS } from '../scripts/production-health-check.mjs';
import { parseAuthHealthArgs, runAuthHealthCheck, runAuthHealthCli } from '../scripts/production-auth-health.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/production-auth-health.mjs', import.meta.url));
const BUSINESS = '00000000-0000-4000-8000-000000000001';
const config = {
  smtp_host: 'mail.fixture.invalid', smtp_admin_email: 'qa@fixture.invalid',
  smtp_sender_name: 'QA', rate_limit_email_sent: 100, mailer_autoconfirm: false,
  site_url: 'https://store.fixture.invalid', smtp_pass: 'never-include-this-fixture-password',
};

function answer(query) {
  if (query.includes('from auth.users')) return [{ total: 4, anonimas: 2, con_correo: 2, ultima_hora: 0,
    ultimo_dia: 0, anonimas_hora: 0, correo_hora: 0, sin_confirmar: 0, sin_confirmar_viejas: 0 }];
  if (query.includes('from public.business_access_requests')) return [{ pendientes: 0, pendientes_rider: 0,
    espera_maxima_horas: 0, aprobadas: 0, rechazadas: 0 }];
  if (query.includes('as equipo')) return [{ equipo: 1, owners: 1, sesiones_vivas: 0, ordering: false }];
  if (query.includes('from public.identity_audit_events')) return [{ total: 0, ultimo_dia: 0 }];
  throw new Error('unexpected fixture query');
}

function dependencies() {
  const calls = [];
  const lines = [];
  const errors = [];
  const written = [];
  return {
    calls, lines, errors, written,
    env: { SUPABASE_ACCESS_TOKEN: 'fixture-management-token' },
    stdout: (line) => lines.push(line), stderr: (line) => errors.push(line),
    readFile: () => 'fixture-public-key',
    writeFile: (file, content) => written.push({ file, report: JSON.parse(content) }),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/config/auth')) return { ok: true, json: async () => config };
      if (url.endsWith('/auth/v1/settings')) return { ok: true, status: 200 };
      assert.ok(url.endsWith('/database/query/read-only'));
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ['query']);
      assert.match(body.query, /^\s*select\b/i);
      return { ok: true, text: async () => JSON.stringify(answer(body.query)) };
    },
  };
}

test('DIAG-10: production y CP usan el mismo catálogo explícito de destinos que la sonda de base', () => {
  for (const target of ['production', 'controlled-production']) {
    const options = parseAuthHealthArgs(['--target', target]);
    assert.equal(options.ref, TARGETS[target].ref);
    assert.equal(options.canonicalBusiness, TARGETS[target].canonicalBusiness);
  }
  const deploy = JSON.parse(fs.readFileSync(new URL('../deploy/controlled-production.json', import.meta.url)));
  assert.equal(parseAuthHealthArgs(['--target', 'controlled-production']).canonicalBusiness, deploy.businessId);
  assert.equal(parseAuthHealthArgs(['--ref', TARGETS.production.ref]).target, 'production');
});

test('staging requiere un negocio explícito; no hereda el negocio de producción', () => {
  assert.throws(() => parseAuthHealthArgs(['--target', 'staging']), /--business-id requerido/);
  const options = parseAuthHealthArgs(['--target', 'staging', '--business-id', BUSINESS]);
  assert.equal(options.ref, TARGETS.staging.ref);
  assert.equal(options.canonicalBusiness, BUSINESS);
});

test('faltantes, destinos desconocidos, ref cruzado y UUID inválido fallan cerrados', () => {
  const invalid = [[], ['--target'], ['--target', 'unexpected'], ['--ref', 'unknown'],
    ['--target', 'controlled-production', '--ref', TARGETS.production.ref],
    ['--target', 'staging', '--business-id', "x'; delete from auth.users; --"],
    ['--target', 'production', '--fix'], ['--target', 'production', '--target', 'staging'],
    ['--target', 'production', '--key-file'],
    ['--target', 'production', '--key', 'fixture', '--key-file', 'fixture-file']];
  for (const argv of invalid) assert.throws(() => parseAuthHealthArgs(argv));
});

test('importar la sonda no consulta servicios ni ejecuta CLI, aun con argumentos aparentes', () => {
  const url = new URL('../scripts/production-auth-health.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `globalThis.fetch=()=>{throw Error('network-on-import')};
     process.argv.push('--target','production','--key-file','must-not-read');
     const m=await import(${JSON.stringify(url)});
     if(typeof m.runAuthHealthCli!=='function') throw Error('missing-export');`],
  { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('CLI sin destino o sin token devuelve 2 antes de leer una clave o consultar', async () => {
  for (const args of [[], ['--target', 'controlled-production', '--key-file', 'must-not-read']]) {
    const deps = dependencies();
    deps.env = {};
    deps.readFile = () => { throw new Error('key-file-was-read'); };
    assert.equal(await runAuthHealthCli(args, deps), 2);
    assert.equal(deps.calls.length, 0);
    assert.ok(!deps.errors.join('\n').includes('key-file-was-read'));
  }
});

test('argumentos de destino inválidos no imprimen valores opacos ni consultan servicios', async () => {
  const opaque = 'credential-fixture-must-not-echo';
  for (const args of [['--target', opaque], ['--ref', opaque], [opaque]]) {
    const deps = dependencies();
    assert.equal(await runAuthHealthCli(args, deps), 2);
    assert.equal(deps.calls.length, 0);
    assert.ok(!deps.errors.join('\n').includes(opaque));
  }
});

test('help no necesita credenciales, no lee claves y no consulta servicios', async () => {
  const deps = dependencies();
  deps.env = {};
  assert.equal(await runAuthHealthCli(['--help'], deps), 0);
  assert.equal(deps.calls.length, 0);
  assert.match(deps.lines.join('\n'), /Destino explícito/);
});

test('CP consulta sólo su ref y su negocio; SQL usa el endpoint con rol de sólo lectura', async () => {
  const deps = dependencies();
  const result = await runAuthHealthCli(['--target', 'controlled-production', '--key-file', 'fixture-file', '--report', 'fixture.json'], deps);
  assert.equal(result, 0, deps.errors.join('\n'));
  assert.equal(deps.calls.length, 6);
  const sqlCalls = deps.calls.filter((call) => call.url.endsWith('/database/query/read-only'));
  assert.equal(sqlCalls.length, 4);
  for (const call of deps.calls) assert.ok(call.url.includes(TARGETS['controlled-production'].ref));
  for (const call of sqlCalls.filter((call) => !JSON.parse(call.init.body).query.includes('from auth.users')
      && !JSON.parse(call.init.body).query.includes('identity_audit_events'))) {
    assert.ok(JSON.parse(call.init.body).query.includes(TARGETS['controlled-production'].canonicalBusiness));
  }
  assert.equal(deps.written[0].report.target, 'controlled-production');
  assert.equal(deps.written[0].report.businessId, TARGETS['controlled-production'].canonicalBusiness);
  const output = JSON.stringify(deps.written) + deps.lines.join('\n');
  for (const secret of ['fixture-management-token', 'fixture-public-key', config.smtp_pass]) assert.ok(!output.includes(secret));
});

test('staging queda aislado: cuatro SELECT y un GET de Auth para el negocio indicado', async () => {
  const deps = dependencies();
  assert.equal(await runAuthHealthCli(['--target', 'staging', '--business-id', BUSINESS], deps), 0);
  assert.equal(deps.calls.length, 5);
  assert.ok(deps.calls.every((call) => call.url.includes(TARGETS.staging.ref)));
  assert.ok(!deps.lines.join('\n').includes(TARGETS.production.ref));
});

test('alertas de Auth conservan salida 1, y una respuesta pública de Auth fallida genera aviso', async () => {
  const options = parseAuthHealthArgs(['--target', 'controlled-production']);
  const result = await runAuthHealthCheck({ options,
    sql: async (query) => query.includes('as equipo') ? [{ equipo: 0, owners: 0, sesiones_vivas: 0, ordering: false }] : answer(query),
    configAuth: async () => ({ ...config, smtp_host: null, site_url: 'http://localhost:3000' }),
    probeAuth: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.avisos.length, 4);
});

test('fallo de consulta devuelve 2 sin guardar reporte ni imprimir tokens/keys del error', async () => {
  const deps = dependencies();
  const normal = deps.fetchImpl;
  deps.fetchImpl = async (url, init) => url.endsWith('/database/query/read-only')
    ? { ok: false, status: 403, text: async () => 'fixture-management-token fixture-public-key' }
    : normal(url, init);
  assert.equal(await runAuthHealthCli(['--target', 'controlled-production', '--key', 'fixture-public-key', '--report', 'fixture.json'], deps), 2);
  assert.equal(deps.written.length, 0);
  assert.ok(!deps.errors.join('\n').includes('fixture-management-token'));
  assert.ok(!deps.errors.join('\n').includes('fixture-public-key'));
  assert.match(deps.errors.join('\n'), /403/);
});
