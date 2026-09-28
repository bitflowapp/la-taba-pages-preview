// Mercado Pago para un cliente NUEVO: la disponibilidad se pregunta con la sesión
// del cliente (la RPC es sólo de `authenticated`, por contrato). El repositorio
// avisa cuando esa sesión empieza o termina, para que el carrito vuelva a preguntar
// sin que la persona tenga que salir y volver.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseOrderRepository } from '../js/repositories/supabase_order_repository.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

function fakeAuth() {
  const listeners = new Set();
  return {
    emit(event, user = null) { for (const listener of [...listeners]) listener({ event, session: user ? { user } : null, user }); },
    size: () => listeners.size,
    onAuthStateChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async ensureCustomerSession() { return { ok: true, absent: true, session: null, user: null }; },
    async getSession() { return { ok: true, session: null, user: null }; },
  };
}

const client = {
  from() { throw new Error('no se consulta en esta prueba'); },
  async rpc() { return { data: null, error: { code: '42501', message: 'permission denied' } }; },
};

test('avisa cuando la sesión del cliente empieza o termina, y nada más', () => {
  const auth = fakeAuth();
  const repository = createSupabaseOrderRepository({ client, businessId: BUSINESS_ID, authService: auth });
  const seen = [];
  const stop = repository.onCustomerSessionChange((change) => seen.push(change));
  auth.emit('INITIAL_SESSION');
  auth.emit('SIGNED_IN', { id: 'cliente', is_anonymous: true });
  auth.emit('TOKEN_REFRESHED', { id: 'cliente', is_anonymous: true });
  auth.emit('SIGNED_OUT');
  assert.deepEqual(seen, [{ event: 'SIGNED_IN', signedIn: true }, { event: 'SIGNED_OUT', signedIn: false }]);
  stop();
  assert.equal(auth.size(), 0, 'dejar de escuchar suelta la suscripción');
  auth.emit('SIGNED_IN', { id: 'otro' });
  assert.equal(seen.length, 2);
});

test('sin sesión, la disponibilidad es «no disponible» y no crea identidad', async () => {
  const auth = fakeAuth();
  const repository = createSupabaseOrderRepository({ client, businessId: BUSINESS_ID, authService: auth });
  const result = await repository.getMercadoPagoCheckoutAvailability();
  assert.equal(result.available, false);
});

test('sin servicio de sesión que avise, no rompe: devuelve un «dejar de escuchar» vacío', () => {
  const repository = createSupabaseOrderRepository({ client, businessId: BUSINESS_ID,
    authService: { async ensureCustomerSession() { return { ok: true, absent: true }; } } });
  const stop = repository.onCustomerSessionChange(() => {});
  assert.equal(typeof stop, 'function');
  stop();
});

test('el carrito vuelve a preguntar cuando la sesión cambia (cableado de la tienda)', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /onCustomerSessionChange\?\.\(\(\) => \{\s*if \(activeView === 'cart'\) refreshMercadoPagoCheckoutAvailability\(\);/);
});
