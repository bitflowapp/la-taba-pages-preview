/*
 * B4 · Una query no convierte producción en simulación.
 *
 * `?demo=1` y `?showcase=1` sirven una tienda completa con datos locales y
 * confirman pedidos con el mismo texto que la real, sin tocar el backend. En el
 * artefacto de previsualización eso es lo correcto. En el dominio comercial es
 * una trampa, y antes de este gate la bandera ganaba siempre.
 *
 * La matriz completa: qué configuración, qué query, qué modo queda.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  APP_MODE_DEMO,
  APP_MODE_PRODUCTION,
  APP_MODE_PUBLIC,
  APP_MODE_UNAVAILABLE,
  getAppMode,
  isDemoMode,
  isDemoQueryIgnored,
  isDemoQueryRequested,
  isOperationalView,
  isShowcaseMode,
} from '../js/core/app-mode.js';
import {
  RUNTIME_CONFIG_GLOBAL_KEY,
  isProductionDeployment,
} from '../js/core/runtime-config.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

const repositoryFor = (deploymentEnvironment) => ({
  provider: 'supabase',
  supabaseUrl: 'https://ukxqbgswjlibmnjemrzd.supabase.co',
  publishableKey: 'sb_publishable_9c2f4a1e7d3b5a8e2f',
  businessId: BUSINESS_ID,
  pollMs: 5000,
  ...(deploymentEnvironment ? { deploymentEnvironment } : {}),
});

const PRODUCTION = { mode: 'production', repository: repositoryFor('production') };
const STAGING = { mode: 'production', repository: repositoryFor('staging') };
const LOCAL = { mode: 'local-staging', repository: repositoryFor('local') };
// Sin `deploymentEnvironment` declarado y contra un host remoto: el normalizador
// lo deduce como producción.
const PRODUCTION_IMPLICITA = { mode: 'production', repository: repositoryFor(null) };

function deploy(config) {
  if (config === undefined) delete globalThis[RUNTIME_CONFIG_GLOBAL_KEY];
  else globalThis[RUNTIME_CONFIG_GLOBAL_KEY] = config;
}

afterEach(() => {
  delete globalThis[RUNTIME_CONFIG_GLOBAL_KEY];
  delete globalThis.location;
});

// ── Lo que el gate tiene que impedir ────────────────────────────────────────

test('producción + ?demo=1 sigue siendo producción: la query se ignora', () => {
  deploy(PRODUCTION);
  assert.equal(isDemoQueryRequested('?demo=1'), true, 'la URL la pidió');
  assert.equal(isDemoMode('?demo=1'), false, 'y el despliegue la rechazó');
  assert.equal(getAppMode('?demo=1'), APP_MODE_PRODUCTION);
  assert.equal(isDemoQueryIgnored('?demo=1'), true, 'el rechazo se puede decir en voz alta');
});

test('producción + ?showcase=1 tampoco entra en presentación', () => {
  deploy(PRODUCTION);
  assert.equal(isShowcaseMode('?showcase=1'), false);
  assert.equal(isDemoMode('?showcase=1'), false);
  assert.equal(getAppMode('?showcase=1'), APP_MODE_PRODUCTION);
});

test('producción DEDUCIDA —sin deploymentEnvironment declarado— también rechaza la demo', () => {
  deploy(PRODUCTION_IMPLICITA);
  assert.equal(isProductionDeployment(), true);
  assert.equal(isDemoMode('?demo=1'), false);
  assert.equal(getAppMode('?demo=1'), APP_MODE_PRODUCTION);
});

test('las dos banderas juntas no se suman para ganarle a producción', () => {
  deploy(PRODUCTION);
  assert.equal(getAppMode('?demo=1&showcase=1'), APP_MODE_PRODUCTION);
});

// ── Lo que el gate NO puede romper ──────────────────────────────────────────

test('sin configuración, ?demo=1 sigue siendo la demo: ése es el artefacto de previsualización', () => {
  deploy(undefined);
  assert.equal(isProductionDeployment(), false);
  assert.equal(isDemoMode('?demo=1'), true);
  assert.equal(getAppMode('?demo=1'), APP_MODE_DEMO);
});

test('staging + ?demo=1 conserva la demo', () => {
  deploy(STAGING);
  assert.equal(isProductionDeployment(), false);
  assert.equal(isDemoMode('?demo=1'), true);
  assert.equal(getAppMode('?demo=1'), APP_MODE_DEMO);
  assert.equal(isShowcaseMode('?showcase=1'), true);
});

test('local + ?demo=1 conserva la demo', () => {
  deploy(LOCAL);
  assert.equal(isDemoMode('?demo=1'), true);
  assert.equal(getAppMode('?demo=1'), APP_MODE_DEMO);
});

test('sin query, cada configuración resuelve su modo de siempre', () => {
  deploy(PRODUCTION);
  assert.equal(getAppMode(''), APP_MODE_PRODUCTION);
  deploy(STAGING);
  assert.equal(getAppMode(''), APP_MODE_PRODUCTION, 'staging también sirve una tienda real');
  deploy(undefined);
  assert.equal(getAppMode(''), APP_MODE_PUBLIC);
});

// ── Configuración rota ──────────────────────────────────────────────────────

test('una configuración ilegible falla cerrado: no se le concede la demo', () => {
  for (const roto of [{}, { mode: 'production' }, { mode: 'production', repository: {} }, 'texto', 42, []]) {
    deploy(roto);
    assert.equal(
      isProductionDeployment(),
      true,
      `una configuración que no puede decir dónde está se trata como producción: ${JSON.stringify(roto)}`,
    );
    assert.equal(isDemoMode('?demo=1'), false);
    assert.equal(getAppMode('?demo=1'), APP_MODE_UNAVAILABLE);
  }
});

test('un staging DECLARADO conserva su demo aunque el resto de la configuración esté rota', () => {
  deploy({ mode: 'production', repository: { provider: 'supabase', deploymentEnvironment: 'staging' } });
  assert.equal(isProductionDeployment(), false, 'lo declarado manda');
  assert.equal(isDemoMode('?demo=1'), true);
  assert.equal(getAppMode('?demo=1'), APP_MODE_DEMO);
});

test('un deploymentEnvironment inventado no sirve para escaparse de producción', () => {
  deploy({ mode: 'production', repository: { ...repositoryFor(null), deploymentEnvironment: 'preprod' } });
  assert.equal(isProductionDeployment(), true);
  assert.equal(isDemoMode('?demo=1'), false);
});

// ── Rutas operativas ────────────────────────────────────────────────────────

test('la demo ya no abre las vistas operativas en un despliegue productivo', () => {
  deploy(PRODUCTION);
  // En producción siguen abiertas porque el modo es productivo, no por la demo.
  assert.equal(isOperationalView('business', '?demo=1'), false);
  deploy({ mode: 'production', repository: {} });
  assert.equal(
    isOperationalView('business', '?demo=1'),
    true,
    'con configuración rota, ?demo=1 ya no alcanza para entrar al Panel',
  );
});

test('sin location legible no explota y no concede nada de más', () => {
  deploy(PRODUCTION);
  assert.equal(isDemoMode(undefined), false);
  assert.equal(isDemoQueryRequested(null), false);
});
