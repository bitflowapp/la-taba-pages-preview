import test from 'node:test';
import assert from 'node:assert/strict';

import {
  backOfficePresente,
  handleProductionAuthSubmit,
  initProductionOperations,
} from '../js/back-office.js';
import { getSupabaseClient, resetSupabaseClientForTests } from '../js/services/supabase-client.js';
import { resetRepositoryFactoryForTests } from '../js/repositories/repository_factory.js';

/*
 * El formulario de ingreso del Panel está en el documento ANTES de que llegue
 * el código del back office (se difiere para no cargarle 759 KB a quien compra).
 * Un «Ingresar» que llegaba primero recibía `{ handled: false }`: `app.js` ya
 * había hecho `preventDefault()`, así que el envío se perdía sin un solo
 * mensaje. Visto en el preview QA: el primer clic no hacía nada y el segundo sí.
 * El envío espera al panel y lo atiende el módulo real.
 */

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const RUNTIME = Object.freeze({
  mode: 'production',
  repository: Object.freeze({
    provider: 'supabase',
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_back-office-first-submit',
    businessId: BUSINESS_ID,
    pollMs: 60_000,
  }),
});

test('el primer «Ingresar» antes de que llegue el panel no se pierde: espera y lo atiende el módulo real', async () => {
  const calls = { signIn: 0 };
  let session = null;
  const client = {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      async signInWithPassword() {
        calls.signIn += 1;
        session = { user: { id: 'team-1', email: 'duena@lataba.test' } };
        return { data: { session, user: session.user }, error: null };
      },
      async signOut() { session = null; return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    async rpc(name) {
      if (name === 'identity_register_session') return { data: { ok: true, code: 'registered', session_id: 's-1', role: 'owner' }, error: null, status: 200 };
      if (name === 'identity_current_context') {
        return { data: { user_id: 'team-1', business_id: BUSINESS_ID, role: 'owner', session_id: 's-1', permissions: ['orders.read'] }, error: null, status: 200 };
      }
      if (name === 'get_my_business_access_request') return { data: { ok: true, code: 'none', status: null, is_member: true }, error: null, status: 200 };
      return { data: [], error: null, status: 200 };
    },
    from() {
      const query = { select: () => query, eq: () => query, order: () => query,
        limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    },
    channel() { return { on() { return this; }, subscribe(callback) { callback('SUBSCRIBED'); return this; }, unsubscribe() {} }; },
    removeChannel: async () => {},
  };
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://app.example.test/#business') });
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = RUNTIME;
  getSupabaseClient(RUNTIME.repository, { storage: null, createClientImpl: () => client });
  // app.js pide el arranque de producción al iniciar (con sus callbacks); con el panel ausente queda pendiente.
  initProductionOperations({ onChange() {}, onOrderAlert() {} });
  assert.equal(backOfficePresente(), false, 'el panel todavía no entró');

  const form = {
    matches: (query) => query.split(',').some((part) => part.trim() === '[data-production-auth-form]'),
    elements: { email: { value: 'duena@lataba.test' }, password: { value: 'una-clave-larga' } },
    dataset: { productionAuthForm: 'business' },
    reset() { this.elements.email.value = ''; this.elements.password.value = ''; },
  };
  try {
    const result = await handleProductionAuthSubmit(form);

    assert.equal(backOfficePresente(), true, 'el envío trajo el panel');
    assert.equal(result.handled, true, 'el módulo real atendió el envío');
    assert.equal(calls.signIn, 1, 'y el ingreso se intentó una vez, sin un segundo clic');
  } finally {
    // El panel real arma temporizadores y suscripciones: se apagan como en el resto de las pruebas del Panel.
    if (backOfficePresente()) {
      const { resetProductionOperationsForTests } = await import('../js/production-operations.js');
      resetProductionOperationsForTests();
    }
    resetRepositoryFactoryForTests();
    resetSupabaseClientForTests();
    delete globalThis.location;
    delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
  }
});
