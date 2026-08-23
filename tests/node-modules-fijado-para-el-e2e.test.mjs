import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * LOS NAVEGADORES QUE DESCARGA CI TIENEN QUE SER LOS QUE PIDE EL PLAYWRIGHT QUE CORRE.
 *
 * El 2026-08-23, reparados los otros defectos, el job web llegó por primera vez
 * en días al E2E y perdió 460 de 462 pruebas con este mensaje:
 *
 *     Error: browserType.launch: Executable doesn't exist at
 *     <cache de Playwright del runner>/chromium_headless_shell-1234/...
 *
 * El paso que descarga navegadores había terminado en verde, bajando los del
 * Playwright fijado: chromium-headless-shell v1223, webkit v2287. Entre un paso
 * y el otro `node_modules` cambió: `npm run test:webhook` corría Deno con
 * `--node-modules-dir=auto`, que resuelve los RANGOS de package.json contra el
 * registro —el lockfile no lo lee— y subía @playwright/test de 1.60.0 a 1.62.1.
 *
 * npm ni se enteraba: su `node_modules/.package-lock.json` seguía diciendo
 * 1.60.0 con 1.62.1 en el disco. Por eso el síntoma aparecía ocho minutos
 * después, en un paso que no habla de webhooks, como si faltaran navegadores.
 */

test('el paso de Deno no materializa node_modules', () => {
  const guion = fs.readFileSync(path.join(root, 'scripts/run-mercadopago-webhook-tests.mjs'), 'utf8');
  const invocacion = guion.match(/\['npx',[\s\S]*?\]\],/);
  assert.ok(invocacion, 'no se encontró la invocación a Deno');
  assert.match(invocacion[0], /--node-modules-dir=none/);
  assert.doesNotMatch(
    invocacion[0],
    /--node-modules-dir=auto/,
    'con `auto` Deno reinstala node_modules desde los rangos de package.json y rompe el E2E',
  );
});

test('la única dependencia npm de esas pruebas viene clavada en el import', () => {
  // Por eso `none` alcanza: no hay especificador desnudo que resolver contra
  // package.json. Si alguien agregara uno, esto avisa antes que Deno.
  const fuente = fs.readFileSync(path.join(root, 'supabase/functions/_shared/mercadopago-webhook-signature.ts'), 'utf8');
  assert.match(fuente, /from 'npm:mercadopago@3\.2\.1'/);
});

test('ninguna dependencia declara un rango: un rango es una versión distinta cada día', () => {
  /*
   * `@playwright/test` era `^1.60.0`, y era el único rango del archivo. Un
   * rango basta para que cualquier herramienta que re-resuelva se lleve otra
   * versión —y con Playwright, otra versión son otros navegadores—.
   */
  const paquete = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declarados = { ...paquete.dependencies, ...paquete.devDependencies };
  const conRango = Object.entries(declarados).filter(([, version]) => !/^\d+\.\d+\.\d+/.test(version));
  assert.deepEqual(conRango, [], 'las versiones se fijan exactas');
  assert.equal(declarados['@playwright/test'], '1.60.0');
});

test('el Playwright fijado y los navegadores que pide son los mismos que instala CI', () => {
  // El eje exacto del defecto: el paso de instalación y el que corre las
  // pruebas usan el mismo Playwright, así que piden las mismas revisiones.
  const bloqueo = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const fijado = bloqueo.packages['node_modules/playwright-core'].version;
  const enDisco = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules/playwright-core/package.json'), 'utf8'),
  ).version;
  assert.equal(enDisco, fijado, 'playwright-core en disco no es el del lockfile: algo pisó node_modules');

  const navegadores = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules/playwright-core/browsers.json'), 'utf8'),
  ).browsers;
  for (const nombre of ['chromium', 'chromium-headless-shell', 'webkit']) {
    const entrada = navegadores.find((navegador) => navegador.name === nombre);
    assert.ok(entrada, `browsers.json no declara ${nombre}`);
    assert.match(String(entrada.revision), /^\d+$/);
  }
});

test('CI comprueba el árbol instalado entre el paso de Deno y el E2E', () => {
  /*
   * El orden importa: la guardia tiene que correr DESPUÉS de lo que pisaba el
   * árbol y ANTES de lo que se rompía. Puesta en `npm run check` —paso 8— pasaba
   * siempre, porque el pisotón venía en el 14.
   */
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  // Buscando por `run:`, no por el nombre suelto: el workflow menciona
  // `npm run test:e2e` en un comentario mucho más arriba.
  const paso = (guion) => {
    const encontrado = workflow.match(new RegExp(`^\\s+run: ${guion}`, 'm'));
    assert.ok(encontrado, `el workflow no corre ${guion}`);
    return encontrado.index;
  };
  const webhook = paso('npm run test:webhook');
  const guardia = paso('npm run deps:pinned:check');
  const e2e = paso('npm run test:e2e');
  assert.ok(webhook < guardia, 'la guardia tiene que correr después del paso que pisaba node_modules');
  assert.ok(guardia < e2e, 'y antes del E2E, que es lo que se rompía');
  assert.match(workflow, /playwright install --with-deps chromium webkit/);
});

test('la guardia pasa con el árbol como lo dejó npm ci', () => {
  const resultado = spawnSync(process.execPath, ['scripts/check-node-modules-pinned.mjs'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(resultado.status, 0, `${resultado.stdout}${resultado.stderr}`);
  assert.match(resultado.stdout, /coincide con package-lock\.json/);
});

test('la guardia rechaza una versión pisada, y dice cómo se vuelve', () => {
  /*
   * El escenario real reproducido en chico: el lockfile dice una versión, el
   * disco tiene otra. Si esto no fallara, el pisotón volvería a cobrarse en el
   * E2E ocho minutos después.
   */
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-pin-'));
  try {
    fs.writeFileSync(path.join(temporal, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'prueba' },
        'node_modules/@playwright/test': { version: '1.60.0' },
        'node_modules/@img/sharp-darwin-arm64': { version: '0.35.3', optional: true, os: ['darwin'] },
      },
    }));

    const paquete = path.join(temporal, 'node_modules/@playwright/test');
    fs.mkdirSync(paquete, { recursive: true });
    fs.writeFileSync(path.join(paquete, 'package.json'), JSON.stringify({ name: '@playwright/test', version: '1.62.1' }));

    const correr = () => spawnSync(process.execPath, ['scripts/check-node-modules-pinned.mjs', temporal], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
    });

    const pisado = correr();
    assert.equal(pisado.status, 1);
    const salida = `${pisado.stdout}${pisado.stderr}`;
    assert.match(salida, /@playwright\/test/);
    assert.match(salida, /1\.60\.0/);
    assert.match(salida, /1\.62\.1/);
    assert.match(salida, /npm ci/, 'tiene que decir cómo se vuelve al estado fijado');
    assert.doesNotMatch(salida, /sharp-darwin-arm64/, 'un opcional de otra plataforma no está pisado: falta a propósito');

    fs.writeFileSync(path.join(paquete, 'package.json'), JSON.stringify({ name: '@playwright/test', version: '1.60.0' }));
    const sano = correr();
    assert.equal(sano.status, 0, `${sano.stdout}${sano.stderr}`);
  } finally {
    fs.rmSync(temporal, { force: true, recursive: true });
  }
});
