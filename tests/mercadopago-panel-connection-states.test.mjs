import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPaymentsSetupSurface } from '../js/business/business-panel-render.js';

const card = (connection, role = 'owner') => renderPaymentsSetupSurface({ role, connection });
const status = (html) => /<p role="status"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
const actions = (html) => [...html.matchAll(/data-mp-connection-action="([a-z]+)"/g)].map((m) => m[1]);

test('conectado: lo dice, muestra la cuenta y ofrece verificar o desconectar', () => {
  const html = card({ status: 'connected', seller_id: '3594962708', connected_at: '2026-09-25T17:43:16Z' });
  assert.equal(status(html), '✓ Mercado Pago conectado correctamente');
  assert.match(html, /Cuenta: 3594962708/);
  assert.deepEqual(actions(html), ['verify', 'disconnect']);
  assert.doesNotMatch(html, /Conectá tu cuenta/);
});

test('desconectado: no finge nada y ofrece conectar', () => {
  for (const connection of [{ status: 'disconnected', seller_id: '3594962708' }, undefined]) {
    const html = card(connection);
    assert.equal(status(html), 'No conectado');
    assert.deepEqual(actions(html), ['connect']);
    assert.doesNotMatch(html, /Cuenta:/);
  }
});

test('necesita reconexión: lo pide con su propio botón', () => {
  const html = card({ status: 'requires_reauthorization', seller_id: '3594962708' });
  assert.equal(status(html), 'Necesitamos volver a conectar Mercado Pago.');
  assert.deepEqual(actions(html), ['connect']);
  assert.match(html, />Reconectar</);
  assert.doesNotMatch(html, /conectado correctamente/);
});

test('problema de conexión: se muestra en rojo y no como conectado', () => {
  const html = card({ status: 'unavailable' });
  assert.equal(status(html), 'No pudimos verificar la conexión. Intentá nuevamente.');
  assert.match(html, /tone-critical/);
  assert.doesNotMatch(html, /conectado correctamente/);
});

test('el Panel nunca muestra material de credenciales aunque viniera en la respuesta', () => {
  const html = card({
    status: 'connected', seller_id: '3594962708', connected_at: '2026-09-25T17:43:16Z',
    access_token: 'APP_USR-1111111111111111-092517-0123456789abcdef0123456789abcdef-3594962708',
    refresh_token: 'TG-fixture-refresh', protected_tokens: 'v1.fixture.ciphertext', client_secret: 'fixture-client-secret',
  });
  assert.doesNotMatch(html, /APP_USR|TG-fixture|v1\.fixture|fixture-client-secret|access_token|refresh_token/);
});

test('staff no ve botones de conexión: la conexión la hace el dueño o el encargado', () => {
  const html = card({ status: 'connected', seller_id: '3594962708' }, 'staff');
  assert.deepEqual(actions(html), []);
  assert.match(html, /dueño o el encargado/);
});
