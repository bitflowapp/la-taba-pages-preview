import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runtimeDeclarado, sello } from '../scripts/deploy/sellar-version.mjs';
import { esperarConvergencia, revisarRuntimeConfig, revisarServiceWorker, verificar } from '../scripts/deploy/verificar-publicado.mjs';

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

/*
 * LA PROPAGACIÓN DE CLOUDFLARE NO ES UN DEFECTO, Y VENCER EL PLAZO SÍ.
 *
 * El 2026-08-27 `Deploy production` publicó bien `820ad4e`/v91 y quedó ROJO: el
 * smoke corrió un segundo después de publicar y leyó el alias todavía en
 * `31c900b`/v90. Correr el mismo guion a mano, minutos más tarde y sin cambiar
 * nada, daba verde. Un despliegue sano no puede depender de con cuánta suerte
 * cae la consulta.
 */
const respuestasDe = (version) => async (url) => {
  const texto = {
    '/': '<html><main data-app-main></main></html>',
    '/version.json': JSON.stringify(version),
    '/runtime-config.js': `supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
      publishableKey: 'sb_publishable_x', businessId: '00000000-0000-4000-8000-000000000001',`,
    '/sw.js': `const CACHE_NAME = '${version.runtime}';`,
  }[new URL(url, 'https://x').pathname] ?? '[{"sku":"x"}]';
  return { ok: true, status: 200, text: async () => texto };
};

const VIEJO = { commit: '3'.repeat(40), runtime: 'la-taba-runtime-v90', builtAt: 'x' };
const NUEVO = { commit: '8'.repeat(40), runtime: 'la-taba-runtime-v91', builtAt: 'x' };

/** Reloj y espera falsos: el test mide la lógica, no aguanta el reloj real. */
function relojFalso() {
  let t = 0;
  return { ahora: () => t, dormir: async (ms) => { t += ms; } };
}

test('el smoke espera la propagación: dos veces el SHA viejo, a la tercera el bueno', async () => {
  const { ahora, dormir } = relojFalso();
  /*
   * El alias cambia ENTRE consultas, nunca en el medio de una: el borde sirve
   * un despliegue entero y coherente consigo mismo. Por eso la vuelta se decide
   * al empezar el intento —en `/`, la primera peticion— y queda fija para el
   * sello, el runtime-config y el worker de ESE intento.
   */
  let vuelta = 0;
  let actual = VIEJO;
  const buscar = async (url, opciones) => {
    if (new URL(url, 'https://x').pathname === '/') {
      vuelta += 1;
      actual = vuelta >= 3 ? NUEVO : VIEJO;
    }
    return respuestasDe(actual)(url, opciones);
  };

  const registro = [];
  const resultado = await esperarConvergencia({
    host: 'https://x',
    esperarCommit: NUEVO.commit,
    esperarRuntime: NUEVO.runtime,
    intervaloMs: 5_000,
    timeoutMs: 180_000,
    buscar,
    ahora,
    dormir,
    registrar: (linea) => registro.push(linea),
  });

  assert.equal(resultado.sano, true, JSON.stringify(resultado.revisiones.filter((r) => !r.pasa)));
  assert.equal(resultado.agotado, false);
  assert.equal(resultado.intentos, 3, 'tenía que converger recién en el tercer intento');
  // Y el registro tiene que dejar por escrito qué se vio y cuándo, que es lo
  // único que permite distinguir después una propagación de una regresión.
  assert.equal(registro.length, 3);
  assert.equal(registro[0].commitObservado, VIEJO.commit);
  assert.equal(registro[0].commitEsperado, NUEVO.commit);
  assert.equal(registro[0].transcurridoMs, 0);
  assert.equal(registro[2].commitObservado, NUEVO.commit);
  assert.equal(registro[2].transcurridoMs, 10_000);
  assert.ok(registro[0].fallidas.includes('el commit publicado es el esperado'));
  assert.deepEqual(registro[2].fallidas, []);
});

test('si producción sigue vieja al vencer el plazo, es un FALLO real y no un verde por cansancio', async () => {
  const { ahora, dormir } = relojFalso();
  const resultado = await esperarConvergencia({
    host: 'https://x',
    esperarCommit: NUEVO.commit,
    esperarRuntime: NUEVO.runtime,
    intervaloMs: 5_000,
    timeoutMs: 60_000,
    buscar: respuestasDe(VIEJO),
    ahora,
    dormir,
  });

  assert.equal(resultado.sano, false, 'vencer el timeout NO puede dar verde');
  assert.equal(resultado.agotado, true);
  assert.equal(resultado.intentos, 12, '60s con intervalo de 5s son 12 vueltas, y ni una más');
  assert.ok(resultado.revisiones.some((r) => !r.pasa && /commit publicado/.test(r.nombre)));
  assert.equal(resultado.version.commit, VIEJO.commit);
});

test('un defecto que esperar no arregla no gasta el plazo: falla en el primer intento', async () => {
  /*
   * Reintentar por propagación no puede volverse reintentar por cualquier cosa.
   * Un artefacto que apunta a staging va a apuntar a staging para siempre:
   * esperarlo tres minutos sólo retrasa el rojo y esconde el motivo.
   */
  const { ahora, dormir } = relojFalso();
  const buscar = async (url, opciones) => {
    if (new URL(url, 'https://x').pathname === '/runtime-config.js') {
      return {
        ok: true,
        status: 200,
        text: async () => `supabaseUrl: 'https://ukxqbgswjlibmnjemrzd.supabase.co',
          publishableKey: 'sb_publishable_x', businessId: '00000000-0000-4000-8000-000000000001',`,
      };
    }
    return respuestasDe(NUEVO)(url, opciones);
  };

  const resultado = await esperarConvergencia({
    host: 'https://x',
    esperarCommit: NUEVO.commit,
    intervaloMs: 5_000,
    timeoutMs: 180_000,
    buscar,
    ahora,
    dormir,
  });

  assert.equal(resultado.sano, false);
  assert.equal(resultado.agotado, false, 'no llegó al techo: cortó por defecto duro');
  assert.equal(resultado.intentos, 1, 'un defecto duro no se reintenta');
  assert.equal(resultado.transcurridoMs, 0);
  assert.ok(resultado.revisiones.some((r) => !r.pasa && /apunta a staging/.test(r.nombre)));
});

test('el runtime esperado se comprueba aparte del commit', async () => {
  // Un artefacto con el commit correcto y la caché vieja se publica sin que
  // nadie lo note: al visitante le sigue llegando lo que ya tenía guardado.
  const { sano, revisiones } = await verificar({
    host: 'https://x',
    esperarCommit: NUEVO.commit,
    esperarRuntime: 'la-taba-runtime-v91',
    buscar: respuestasDe({ ...NUEVO, runtime: 'la-taba-runtime-v90' }),
  });
  assert.equal(sano, false);
  assert.ok(revisiones.some((r) => !r.pasa && /runtime publicado es el esperado/.test(r.nombre)));
});

test('el paso de smoke espera la propagación en vez de mirar una sola vez', () => {
  // El contrato del pipeline, fijado acá para que no se caiga sin que nadie lo
  // note: el paso tiene que pedir commit Y runtime, y tiene que traer techo.
  assert.match(workflow, /--esperar-commit/);
  assert.match(workflow, /--esperar-runtime/);
  assert.match(workflow, /--intervalo-ms/);
  assert.match(workflow, /--timeout-ms/);
  // Un `sleep` fijo paga el peor caso en CADA release y no garantiza nada: si
  // la propagación tarda un segundo más que el número elegido, vuelve el rojo.
  assert.doesNotMatch(workflow, /^\s*sleep\s+\d/m);
});
