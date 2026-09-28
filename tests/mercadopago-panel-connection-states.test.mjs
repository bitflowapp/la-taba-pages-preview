import test from 'node:test';
import assert from 'node:assert/strict';
import { mercadoPagoSellerState, renderPaymentsSetupSurface } from '../js/business/business-panel-render.js';

const ENABLED = Object.freeze({ enabled: true, environment: 'production', production_review_status: 'approved' });
const card = (connection, role = 'owner', { activation = null, busy = false } = {}) => renderPaymentsSetupSurface({
  role, connection, activation, busy,
});
const status = (html) => /<p role="status"[^>]*><strong>([^<]*)<\/strong><\/p>/.exec(html)?.[1];
const actions = (html) => [...html.matchAll(/data-mp-connection-action="([a-z]+)"/g)].map((m) => m[1]);

test('conectado y habilitado: «Conectado», sin mostrar el número de cuenta', () => {
  const html = card({ status: 'connected', seller_id: '3594962708', connected_at: '2026-09-25T17:43:16Z' }, 'owner', { activation: ENABLED });
  assert.equal(status(html), 'Conectado');
  assert.doesNotMatch(html, /3594962708|Cuenta:/, 'el Panel no muestra identificadores técnicos');
  assert.deepEqual(actions(html), ['verify', 'disconnect']);
  assert.match(html, /data-mp-seller-state="connected"/);
});

test('conectado sin la habilitación de la plataforma: «Bloqueado», y lo explica', () => {
  for (const activation of [null, { enabled: false }, { enabled: true, environment: 'production', production_review_status: 'pending' }]) {
    const html = card({ status: 'connected', seller_id: '3594962708' }, 'owner', { activation });
    assert.equal(status(html), 'Bloqueado');
    assert.match(html, /plataforma todavía no habilitó el cobro online/);
    assert.match(html, /efectivo o por transferencia/);
  }
});

test('desconectado: no finge nada y ofrece conectar', () => {
  for (const connection of [{ status: 'disconnected', seller_id: '3594962708' }, undefined]) {
    const html = card(connection);
    assert.equal(status(html), 'No conectado');
    assert.deepEqual(actions(html), ['connect']);
    assert.doesNotMatch(html, /Cuenta:|3594962708/);
  }
});

test('necesita reconexión: lo pide con su propio botón', () => {
  const html = card({ status: 'requires_reauthorization', seller_id: '3594962708' });
  assert.equal(status(html), 'Requiere reconexión');
  assert.deepEqual(actions(html), ['connect']);
  assert.match(html, />Reconectar</);
  assert.doesNotMatch(html, />Conectado</);
});

test('conectando: mientras se espera a Mercado Pago lo dice', () => {
  const html = card({ status: 'disconnected' }, 'owner', { busy: true });
  assert.equal(status(html), 'Conectando');
  assert.match(html, /aria-busy="true"/);
});

test('problema de conexión: se muestra en rojo y no como conectado', () => {
  const html = card({ status: 'unavailable' });
  assert.equal(status(html), 'No pudimos verificar la conexión');
  assert.match(html, /tone-critical/);
});

test('los cinco estados del dueño salen de una sola función', () => {
  const labels = [
    mercadoPagoSellerState({ status: 'disconnected' }).label,
    mercadoPagoSellerState({ status: 'disconnected' }, null, { busy: true }).label,
    mercadoPagoSellerState({ status: 'connected' }, ENABLED).label,
    mercadoPagoSellerState({ status: 'requires_reauthorization' }).label,
    mercadoPagoSellerState({ status: 'connected' }, { enabled: false }).label,
  ];
  assert.deepEqual(labels, ['No conectado', 'Conectando', 'Conectado', 'Requiere reconexión', 'Bloqueado']);
});

test('el Panel nunca muestra material de credenciales aunque viniera en la respuesta', () => {
  // Armado en tiempo de ejecución: un literal con forma de token real haría
  // saltar, con razón, el escáner de secretos del repositorio.
  const tokenConFormaReal = ['APP', 'USR'].join('_') + '-' + '1'.repeat(16) + '-092517-' + 'ab'.repeat(16) + '-3594962708';
  const html = card({
    status: 'connected', seller_id: '3594962708', connected_at: '2026-09-25T17:43:16Z',
    access_token: tokenConFormaReal,
    refresh_token: 'TG-fixture-refresh', protected_tokens: 'v1.fixture.ciphertext', client_secret: 'fixture-client-secret',
  }, 'owner', { activation: ENABLED });
  assert.doesNotMatch(html, /APP_USR|TG-fixture|v1\.fixture|fixture-client-secret|access_token|refresh_token/);
});

test('staff no ve botones de conexión: la conexión la hace el dueño o el encargado', () => {
  const html = card({ status: 'connected', seller_id: '3594962708' }, 'staff');
  assert.deepEqual(actions(html), []);
  assert.match(html, /dueño o el encargado/);
});
