import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runtimeDeclarado, sello } from '../scripts/deploy/sellar-version.mjs';
import { revisarRuntimeConfig, revisarServiceWorker, verificar } from '../scripts/deploy/verificar-publicado.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-production.yml'), 'utf8');

/*
 * MAIN Y PRODUCCIÓN, ACOPLADOS POR UNA SOLA RUTA.
 *
 * El 2026-08-24 `main` tenía el runtime v85 y la web pública servía el v84. El
 * despliegue era Direct Upload desde una máquina, así que los dos se
 * desacoplaban con sólo no ejecutar un comando, y nada avisaba.
 */

test('el proyecto y la rama son los de PRODUCCIÓN, no los de staging', () => {
  // `taba2-staging` es otro proyecto de Cloudflare, con otra base. Publicar el
  // artefacto de producción ahí —o al revés— cambia de entorno sin que nadie lo
  // decida.
  assert.match(workflow, /PAGES_PROJECT: la-taba$/m);
  assert.match(workflow, /PAGES_BRANCH: main$/m);
  assert.doesNotMatch(workflow, /taba2-staging/);
});

test('nunca se despliega un SHA sin certificar', () => {
  // Se dispara por el gate obligatorio y toma SU head_sha, no la punta de la
  // rama en el momento del build.
  assert.match(workflow, /workflows:\s*\['Validate release candidate'\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/);
  // Y el disparo manual comprueba el verde por su cuenta.
  assert.match(workflow, /Comprobar que ese SHA tiene CI verde/);
  assert.match(workflow, /No se despliega un SHA sin certificar/);
});

test('producción no puede retroceder', () => {
  /*
   * El escenario: entra el merge A, entra el merge B, y el despliegue de A
   * termina después del de B. Producción quedaría en A —vieja— sin que nadie lo
   * note. Dos defensas: la concurrencia cancela la corrida vieja, y el paso
   * comprueba que el SHA siga siendo la punta antes de publicar.
   */
  assert.match(workflow, /group: deploy-production/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /No retroceder/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /merge-base --is-ancestor/);
});

test('el gate caro no se repite sobre los mismos bytes', () => {
  // El E2E son 28 a 33 minutos y ya corrió sobre este SHA exacto en el gate
  // obligatorio. Repetirlo no agrega información y retrasa el despliegue.
  assert.doesNotMatch(workflow, /npm run test:e2e/);
  assert.doesNotMatch(workflow, /playwright install/);
});

test('el token de Cloudflare se pide con el mínimo privilegio, y se dice cuál', () => {
  assert.match(workflow, /Account · Cloudflare Pages · Edit/);
  assert.match(workflow, /No hace falta DNS, ni Workers, ni facturación, ni un Global API Key/);
  assert.match(workflow, /DEPLOY CONFIGURATION MISSING: \$\{nombre\}|DEPLOY CONFIGURATION MISSING/);
});

test('el workflow no lleva ninguna credencial escrita', () => {
  // Todo por `secrets.`; ni un token, ni un account id, ni una clave.
  //
  // Los `uses:` llevan el SHA fijado de cada action —el repositorio lo exige, y
  // es lo contrario de un riesgo— así que la búsqueda de hexadecimales largos
  // los saltea; en cualquier OTRA línea, un hexadecimal de 32+ huele a token o
  // a identificador de cuenta pegado a mano.
  const sinActions = workflow
    .split('\n')
    .filter((linea) => !/^\s*(uses:|#)/.test(linea))
    .join('\n');
  assert.doesNotMatch(sinActions, /[0-9a-f]{32,}/, 'un hexadecimal largo huele a token o account id');
  assert.doesNotMatch(workflow, /sb_(publishable|secret)_/);
  for (const nombre of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'SUPABASE_PUBLISHABLE_KEY']) {
    assert.ok(workflow.includes(`secrets.${nombre}`), `${nombre} tiene que venir de secrets`);
  }
});

test('el artefacto se construye con la cadena de siempre, sin saltear la compuerta', () => {
  const guion = fs.readFileSync(path.join(root, 'scripts/deploy/preparar-artefacto.mjs'), 'utf8');
  for (const paso of [
    'vendor:build',
    'create-release-folder.mjs',
    'build-production-runtime-config.mjs',
    'sellar-version.mjs',
    'scan-production-artifacts.mjs',
  ]) assert.ok(guion.includes(paso), `falta el paso ${paso}`);
  // El runtime-config se DERIVA. Escribirlo a mano es por donde entró un ref de
  // staging la última vez.
  assert.doesNotMatch(guion, /globalThis\.__LA_TABA_RUNTIME_CONFIG__\s*=/);
  assert.match(workflow, /preparar-artefacto\.mjs/);
});

test('el sello de versión no lleva secretos y exige un commit real', () => {
  const marca = sello({ commit: 'a'.repeat(40), runtime: 'la-taba-runtime-v85', construidoEn: '2026-08-24T00:00:00Z' });
  assert.deepEqual(Object.keys(marca).sort(), ['builtAt', 'commit', 'runtime']);
  assert.throws(() => sello({ commit: '', runtime: 'x', construidoEn: 'y' }), /commit inválido/);
  assert.throws(() => sello({ commit: 'no-es-un-sha', runtime: 'x', construidoEn: 'y' }), /commit inválido/);
});

test('el runtime publicado se lee del propio sw.js', () => {
  assert.equal(runtimeDeclarado("const CACHE_NAME = 'la-taba-runtime-v85-x';"), 'la-taba-runtime-v85-x');
  assert.throws(() => runtimeDeclarado('// sin cache'), /no declara CACHE_NAME/);
});

test('el smoke rechaza un runtime-config vacío, de staging o de otro negocio', () => {
  const fallidas = (revisiones) => revisiones.filter((r) => !r.pasa).map((r) => r.nombre);

  assert.deepEqual(fallidas(revisarRuntimeConfig('// todo comentado')), ['runtime-config no está vacío']);

  const staging = `supabaseUrl: 'https://ukxqbgswjlibmnjemrzd.supabase.co',
    publishableKey: 'sb_publishable_x', businessId: '00000000-0000-4000-8000-000000000001',`;
  const malStaging = fallidas(revisarRuntimeConfig(staging));
  assert.ok(malStaging.includes('Supabase es el de producción'));
  assert.ok(malStaging.includes('no apunta a staging'));

  const otroNegocio = `supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
    publishableKey: 'sb_publishable_x', businessId: '99999999-9999-4999-8999-999999999999',`;
  assert.ok(fallidas(revisarRuntimeConfig(otroNegocio)).includes('negocio canónico'));

  const claveSecreta = `supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
    publishableKey: 'sb_secret_peligrosa', businessId: '00000000-0000-4000-8000-000000000001',`;
  assert.ok(fallidas(revisarRuntimeConfig(claveSecreta)).includes('la clave es publicable'));
});

test('el smoke detecta un worker que no coincide con lo que dice el sello', () => {
  const revisiones = revisarServiceWorker("const CACHE_NAME = 'v84';", 'v85');
  assert.ok(revisiones.some((r) => !r.pasa && /coincide con version\.json/.test(r.nombre)));
});

test('el smoke falla si el commit publicado no es el que se desplegó', async () => {
  const buscar = async (url) => {
    const texto = {
      '/': '<html><main data-app-main></main></html>',
      '/version.json': JSON.stringify({ commit: 'b'.repeat(40), runtime: 'v85', builtAt: 'x' }),
      '/runtime-config.js': `supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
        publishableKey: 'sb_publishable_x', businessId: '00000000-0000-4000-8000-000000000001',`,
      '/sw.js': "const CACHE_NAME = 'v85';",
    }[new URL(url, 'https://x').pathname] ?? '[]';
    return { ok: true, status: 200, text: async () => texto };
  };
  const { sano, revisiones } = await verificar({ host: 'https://x', esperarCommit: 'a'.repeat(40), buscar });
  assert.equal(sano, false);
  assert.ok(revisiones.some((r) => !r.pasa && /commit publicado/.test(r.nombre)));
});

test('un version.json ausente llega como HTML por el fallback de Pages, y no es un defecto', async () => {
  /*
   * Cloudflare Pages contesta el shell de la aplicación a cualquier ruta que no
   * existe: un archivo ausente da 200 con HTML, no 404. Medido contra
   * producción. Confundirlo con «corrupto» haría fallar la verificación de todo
   * despliegue anterior al sello.
   */
  const buscar = async (url) => {
    const ruta = new URL(url, 'https://x').pathname;
    const texto = {
      '/': '<html><main data-app-main></main></html>',
      '/version.json': '<!doctype html><html><main data-app-main></main></html>',
      '/runtime-config.js': `supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
        publishableKey: 'sb_publishable_x', businessId: '00000000-0000-4000-8000-000000000001',`,
      '/sw.js': "const CACHE_NAME = 'v84';",
    }[ruta] ?? '[{"sku":"x"}]';
    return { ok: true, status: 200, text: async () => texto };
  };
  const { sano, revisiones } = await verificar({ host: 'https://x', buscar });
  assert.equal(sano, true, JSON.stringify(revisiones.filter((r) => !r.pasa)));
  assert.ok(revisiones.some((r) => r.pasa && /anterior al sello/.test(r.detalle)));
});
