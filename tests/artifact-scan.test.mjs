// El escaneo del paquete web, con sus controles negativos.
//
// Un escaneo que devuelve OK sólo vale si se demuestra que sabe fallar. Estos
// casos construyen paquetes de mentira con el defecto adentro y comprueban que
// lo encuentra; y el mismo defecto dentro de un comentario, para comprobar que
// distingue evidencia inerte de configuración operativa.
//
// La regla que se está fijando: un secreto lo es donde sea —también en un
// comentario, porque el comentario viaja al navegador igual—; un valor de
// configuración sólo configura si es código.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RULES, stripComments } from '../scripts/scan-production-artifacts.mjs';

const SCANNER = path.join(import.meta.dirname, '..', 'scripts', 'scan-production-artifacts.mjs');
const STAGING_REF = 'ukxqbgswjlibmnjemrzd';
const PRODUCTION_HOST = 'wwcpogltfgzgkrlilbcd.supabase.co';

/** Corre el escáner sobre un paquete de mentira y devuelve su informe. */
function scan(files, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-artifact-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const reportPath = path.join(dir, '_report.json');
    let code = 0;
    try {
      execFileSync(process.execPath, [SCANNER, dir, '--report', reportPath, ...extraArgs], { stdio: 'pipe' });
    } catch (e) {
      code = e.status ?? 1;
    }
    return { code, report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const rulesOf = (list) => [...new Set(list.map((f) => f.rule))].sort();

test('un paquete sin defectos pasa', () => {
  const { code, report } = scan({ 'app.js': 'export const x = 1;\n' });
  assert.equal(code, 0);
  assert.deepEqual(report.findings, []);
  assert.equal(report.clean, true);
});

test('el escáner ve algo: hay reglas y encuentran su propia forma', () => {
  // Sin esto, romper una expresión regular deja el gate en verde para siempre.
  assert.ok(RULES.length >= 12);
  const { report } = scan({ 'a.js': `const k = "sb_secret_${'A'.repeat(20)}";\n` });
  assert.ok(report.findings.length > 0);
});

test('BLOQUEA una clave secreta, aunque esté en un comentario', () => {
  // Es la diferencia que importa: el comentario viaja al navegador igual.
  const { code, report } = scan({
    'a.js': `// pegado sin querer: sb_secret_${'B'.repeat(20)}\nexport const x = 1;\n`,
  });
  assert.equal(code, 1);
  assert.ok(rulesOf(report.findings).includes('supabase-secret-key'));
  assert.equal(report.info.length, 0);
});

test('BLOQUEA un JWT con role service_role', () => {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64url');
  const { code, report } = scan({ 'a.js': `const t = "${head}.${body}.aaaaaaaaaaaa";\n` });
  assert.equal(code, 1);
  assert.ok(rulesOf(report.findings).includes('supabase-service-role-jwt'));
});

test('PERMITE un JWT con role anon: es la clave pública', () => {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url');
  const { code, report } = scan({ 'a.js': `const t = "${head}.${body}.aaaaaaaaaaaa";\n` });
  assert.equal(code, 0, JSON.stringify(report.findings));
});

test('BLOQUEA el ref de staging cuando es código', () => {
  const { code, report } = scan({ 'cfg.js': `const url = "https://${STAGING_REF}.supabase.co";\n` });
  assert.equal(code, 1);
  assert.ok(rulesOf(report.findings).includes('staging-backend-reference'));
});

test('el MISMO ref de staging en un comentario es info, no hallazgo', () => {
  const { code, report } = scan({ 'cfg.js': `// el de staging es ${STAGING_REF}, este no lo usa\nexport const x = 1;\n` });
  assert.equal(code, 0);
  assert.deepEqual(report.findings, []);
  assert.ok(report.info.some((i) => i.rule === 'staging-backend-reference'));
});

test('BLOQUEA un endpoint de desarrollo en código propio', () => {
  const { code, report } = scan({ 'net.js': 'const relay = "http://127.0.0.1:18787";\n' });
  assert.equal(code, 1);
  assert.ok(rulesOf(report.findings).includes('developer-endpoint'));
});

test('el mismo endpoint dentro de js/vendor es info', () => {
  // Un SDK trae su URL por omisión y el cliente la reemplaza. Lo que decide a
  // qué backend habla el artefacto es endpoint-identity, no esta heurística.
  const { code, report } = scan({ 'js/vendor/sdk.js': 'var D="http://localhost:9999";\n' });
  assert.equal(code, 0);
  assert.ok(report.info.some((i) => i.rule === 'developer-endpoint' && i.entry.includes('js/vendor/')));
});

test('una credencial dentro de js/vendor SIGUE siendo P0', () => {
  // La rebaja de severidad es sólo para el endpoint. No importa quién escribió
  // el archivo: una clave secreta no viaja.
  const { code, report } = scan({ 'js/vendor/sdk.js': `var k="sb_secret_${'C'.repeat(20)}";\n` });
  assert.equal(code, 1);
  assert.ok(rulesOf(report.findings).includes('supabase-secret-key'));
});

test('BLOQUEA el businessId de plantilla cuando es código', () => {
  const { code, report } = scan({ 'cfg.js': "const businessId = '00000000-0000-4000-8000-000000000000';\n" });
  assert.equal(code, 1);
  assert.ok(rulesOf(report.findings).includes('template-business-id'));
});

test('BLOQUEA un token de Mercado Pago', () => {
  const token = ['APP_USR', '123456789012', '010101', 'd'.repeat(32), '123456'].join('-');
  const { code, report } = scan({ 'pago.js': `const t = "${token}";\n` });
  assert.equal(code, 1);
  assert.ok(rulesOf(report.findings).includes('mercadopago-token'));
});

test('endpoint-identity exige el host esperado y niega cualquier otro', () => {
  const conEsperado = scan(
    { 'cfg.js': `const u = "https://${PRODUCTION_HOST}";\n` },
    ['--expect-host', PRODUCTION_HOST],
  );
  assert.equal(conEsperado.code, 0, JSON.stringify(conEsperado.report.findings));

  const sinEsperado = scan({ 'cfg.js': 'export const x = 1;\n' }, ['--expect-host', PRODUCTION_HOST]);
  assert.equal(sinEsperado.code, 1);
  assert.ok(sinEsperado.report.findings.some((f) => /falta el host esperado/.test(f.detail || '')));

  const conOtro = scan(
    { 'cfg.js': `const u = "https://${STAGING_REF}.supabase.co";\n` },
    ['--expect-host', PRODUCTION_HOST],
  );
  assert.equal(conOtro.code, 1);
  assert.ok(conOtro.report.findings.some((f) => /host inesperado/.test(f.detail || '')));
});

test('business-identity exige el declarado y niega el de plantilla', () => {
  const canonico = '00000000-0000-4000-8000-000000000001';
  const ok = scan({ 'cfg.js': `const businessId = '${canonico}';\n` }, ['--business-id', canonico]);
  assert.equal(ok.code, 0, JSON.stringify(ok.report.findings));

  const falta = scan({ 'cfg.js': 'export const x = 1;\n' }, ['--business-id', canonico]);
  assert.equal(falta.code, 1);
  assert.ok(falta.report.findings.some((f) => /falta el businessId esperado/.test(f.detail || '')));
});

test('stripComments borra comentarios sin mover las líneas', () => {
  const src = 'const a = 1; // ${STAGING}\n/* bloque\n   dos lineas */\nconst b = 2;\n';
  const out = stripComments(src);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(out.includes('const a = 1;'));
  assert.ok(out.includes('const b = 2;'));
  assert.ok(!out.includes('STAGING'));
  assert.ok(!out.includes('bloque'));
});

test('stripComments no confunde el // de una URL con un comentario', () => {
  const out = stripComments('const u = "https://x.supabase.co/rest";\n');
  assert.ok(out.includes('https://x.supabase.co/rest'));
});
