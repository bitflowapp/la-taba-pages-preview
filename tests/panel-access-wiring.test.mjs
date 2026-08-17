import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAccessRegistrationStateForTests,
  handleProductionAuthSubmit,
  handleProductionOperationsAction,
  initProductionOperations,
  resetProductionOperationsForTests,
} from '../js/production-operations.js';
import {
  resetRepositoryFactoryForTests,
} from '../js/repositories/repository_factory.js';
import {
  getSupabaseClient,
  resetSupabaseClientForTests,
} from '../js/services/supabase-client.js';

/*
 * El cableado del alta en el Panel productivo.
 *
 * Los dos módulos de pantalla ya se prueban solos, y el contrato de base se
 * prueba en la base. Lo que falta cubrir es el pegamento: qué pantalla queda
 * después de cada respuesta del servidor. Ahí es donde una máquina de estados se
 * rompe sin que ninguna de las otras dos suites lo note.
 */

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

const RUNTIME = Object.freeze({
  mode: 'production',
  repository: Object.freeze({
    provider: 'supabase',
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_panel-access-wiring-test',
    businessId: BUSINESS_ID,
    pollMs: 60_000,
  }),
});

test('crear la cuenta deja a la persona frente al formulario de pedido', async () => {
  await withPanel({ accessRequest: { ok: true, code: 'none', status: null, is_member: false } }, async ({ client }) => {
    const result = await handleProductionAuthSubmit(signUpForm('nueva@lataba.test', 'contrasena-larga'));

    assert.equal(result.ok, true);
    assert.equal(getAccessRegistrationStateForTests().step, 'request');
    // Crear la cuenta no llamó a ninguna RPC de identidad.
    assert.deepEqual(client.calls.rpc.map(([name]) => name).filter((n) => n.startsWith('identity_')), []);
  });
});

test('si Auth exige confirmar el correo, vuelve al ingreso con el aviso', async () => {
  await withPanel({ signUpSession: null }, async () => {
    const result = await handleProductionAuthSubmit(signUpForm('nueva@lataba.test', 'contrasena-larga'));

    assert.equal(result.ok, true);
    const state = getAccessRegistrationStateForTests();
    assert.equal(state.step, 'sign_in');
    assert.match(state.message, /confirmar la cuenta/i);
  });
});

test('pedir acceso deja la pantalla de espera', async () => {
  await withPanel({
    accessRequest: { ok: true, code: 'none', status: null, is_member: false },
    requestResponse: {
      ok: true, code: 'pending', request_id: 'req-1', status: 'pending',
      requested_access: 'panel', requested_at: '2026-08-17T10:00:00Z',
    },
  }, async () => {
    await handleProductionAuthSubmit(signUpForm('nueva@lataba.test', 'contrasena-larga'));
    const result = await handleProductionAuthSubmit(requestForm('Pedro Panel', '2996000010'));

    assert.equal(result.ok, true);
    const state = getAccessRegistrationStateForTests();
    assert.equal(state.step, 'pending');
    assert.equal(state.request.id, 'req-1');
  });
});

test('una validación rechazada no expulsa a la persona del formulario', async () => {
  // El error que esto previene: «falta el teléfono» devolviéndola al ingreso, con
  // lo que la solicitud a medio escribir se pierde.
  await withPanel({
    accessRequest: { ok: true, code: 'none', status: null, is_member: false },
    requestResponse: { ok: false, code: 'phone_required' },
  }, async () => {
    await handleProductionAuthSubmit(signUpForm('nueva@lataba.test', 'contrasena-larga'));
    await handleProductionAuthSubmit(requestForm('Pedro Panel', ''));

    const state = getAccessRegistrationStateForTests();
    assert.equal(state.step, 'request');
    assert.match(state.message, /teléfono/i);
    // Y lo que ya había escrito vuelve al formulario.
    assert.equal(state.request.fullName, 'Pedro Panel');
  });
});

test('entrar con la cuenta pendiente muestra la espera y no cierra la sesión', async () => {
  await withPanel({
    registerSession: { ok: false, code: 'not_authorized' },
    accessRequest: {
      ok: true, code: 'pending', status: 'pending', request_id: 'req-1',
      requested_access: 'panel', requested_at: '2026-08-17T10:00:00Z', is_member: false,
    },
  }, async ({ client }) => {
    const result = await handleProductionAuthSubmit(signInForm('pide@lataba.test', 'x'));

    assert.equal(result.ok, false);
    assert.equal(result.awaitingAccess, true);
    assert.equal(getAccessRegistrationStateForTests().step, 'pending');
    assert.equal(client.calls.signOut, 0);
  });
});

test('actualizar el estado con la aprobación ya hecha reactiva el acceso', async () => {
  await withPanel({
    registerSession: { ok: false, code: 'not_authorized' },
    accessRequest: {
      ok: true, code: 'pending', status: 'pending', request_id: 'req-1',
      requested_access: 'panel', is_member: false,
    },
  }, async ({ client }) => {
    await handleProductionAuthSubmit(signInForm('pide@lataba.test', 'x'));
    assert.equal(getAccessRegistrationStateForTests().step, 'pending');

    // El comercio aprueba mientras la pantalla está abierta.
    client.setAccessRequest({
      ok: true, code: 'approved', status: 'approved', request_id: 'req-1',
      granted_role: 'staff', is_member: true,
    });
    const result = await handleProductionOperationsAction(target('[data-panel-access-refresh]'));

    assert.equal(result.handled, true);
    // Vuelve al estado limpio: la pantalla de espera ya no corresponde.
    assert.equal(getAccessRegistrationStateForTests().step, 'sign_in');
  });
});

test('actualizar sin novedad lo dice, y no borra la espera', async () => {
  await withPanel({
    registerSession: { ok: false, code: 'not_authorized' },
    accessRequest: {
      ok: true, code: 'pending', status: 'pending', request_id: 'req-1',
      requested_access: 'panel', is_member: false,
    },
  }, async () => {
    await handleProductionAuthSubmit(signInForm('pide@lataba.test', 'x'));
    await handleProductionOperationsAction(target('[data-panel-access-refresh]'));

    const state = getAccessRegistrationStateForTests();
    assert.equal(state.step, 'pending');
    assert.match(state.message, /sigue esperando/i);
  });
});

test('el paso entre ingresar y crear cuenta es un acto de la persona', async () => {
  await withPanel({}, async () => {
    assert.equal(getAccessRegistrationStateForTests().step, 'sign_in');
    await handleProductionOperationsAction(target('[data-panel-access-goto]', { panelAccessGoto: 'sign_up' }));
    assert.equal(getAccessRegistrationStateForTests().step, 'sign_up');
    await handleProductionOperationsAction(target('[data-panel-access-goto]', { panelAccessGoto: 'sign_in' }));
    assert.equal(getAccessRegistrationStateForTests().step, 'sign_in');
  });
});

test('un paso inventado no abre una pantalla que no existe', async () => {
  await withPanel({}, async () => {
    await handleProductionOperationsAction(target('[data-panel-access-goto]', { panelAccessGoto: 'approved' }));
    assert.equal(getAccessRegistrationStateForTests().step, 'sign_in');
  });
});

test('cerrar sesión desde la espera limpia la pantalla', async () => {
  await withPanel({
    registerSession: { ok: false, code: 'not_authorized' },
    accessRequest: {
      ok: true, code: 'pending', status: 'pending', request_id: 'req-1',
      requested_access: 'panel', is_member: false,
    },
  }, async ({ client }) => {
    await handleProductionAuthSubmit(signInForm('pide@lataba.test', 'x'));
    assert.equal(getAccessRegistrationStateForTests().step, 'pending');

    await handleProductionOperationsAction(target('[data-panel-access-signout]'));

    assert.equal(getAccessRegistrationStateForTests().step, 'sign_in');
    assert.equal(getAccessRegistrationStateForTests().request, null);
    assert.equal(client.calls.signOut, 1);
  });
});

// ── Arnés ──────────────────────────────────────────────────────────────────

async function withPanel(options, body) {
  const client = createPanelClient(options);
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalRuntime = globalThis.__LA_TABA_RUNTIME_CONFIG__;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://app.example.test/#business'),
  });
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = RUNTIME;

  try {
    resetProductionOperationsForTests();
    resetRepositoryFactoryForTests();
    resetSupabaseClientForTests();
    getSupabaseClient(RUNTIME.repository, { storage: null, createClientImpl: () => client });
    initProductionOperations();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await body({ client });
  } finally {
    resetProductionOperationsForTests();
    resetRepositoryFactoryForTests();
    resetSupabaseClientForTests();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
    if (originalRuntime === undefined) delete globalThis.__LA_TABA_RUNTIME_CONFIG__;
    else globalThis.__LA_TABA_RUNTIME_CONFIG__ = originalRuntime;
  }
}

/**
 * Formularios sin DOM: alcanza `matches`, `elements` y `dataset`, que es lo que
 * el panel lee de verdad. El ingreso además usa FormData sobre el formulario
 * real, así que ese camino se ejercita con su propio `dataset` y con el mismo
 * `elements` que ahora leen los dos handlers nuevos.
 */
function fakeForm(selector, values, dataset = {}) {
  const elements = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { value }]),
  );
  return {
    matches: (query) => query.split(',').some((part) => part.trim() === selector),
    elements,
    dataset,
    reset() {
      for (const field of Object.values(elements)) field.value = '';
    },
  };
}

const signUpForm = (email, password) => fakeForm('[data-panel-signup-form]', { email, password });
const requestForm = (fullName, phone) => fakeForm('[data-panel-request-form]', { fullName, phone });
const signInForm = (email, password) => fakeForm(
  '[data-production-auth-form]',
  { email, password },
  { productionAuthForm: 'business' },
);

function target(selector, dataset = {}) {
  const node = { dataset };
  node.closest = (query) => (query === selector ? node : null);
  return node;
}

function createPanelClient({
  signUpSession = { user: { id: 'team-nueva', email: 'nueva@lataba.test' } },
  registerSession = { ok: true, code: 'registered', session_id: 'session-1', role: 'staff' },
  context = {
    user_id: 'team-1', business_id: BUSINESS_ID, role: 'staff',
    session_id: 'session-1', permissions: ['orders.read'],
  },
  accessRequest = { ok: true, code: 'none', status: null, is_member: false },
  requestResponse = null,
} = {}) {
  const calls = { rpc: [], signOut: 0 };
  let currentAccessRequest = accessRequest;
  let session = null;

  return {
    calls,
    setAccessRequest(next) { currentAccessRequest = next; },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      async signUp() {
        session = signUpSession;
        return { data: { session: signUpSession, user: signUpSession?.user || null }, error: null };
      },
      async signInWithPassword() {
        session = { user: { id: 'team-1', email: 'pide@lataba.test' } };
        return { data: { session, user: session.user }, error: null };
      },
      async signOut() { calls.signOut += 1; session = null; return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    async rpc(name, params) {
      calls.rpc.push([name, params]);
      if (name === 'identity_register_session') return { data: registerSession, error: null, status: 200 };
      if (name === 'identity_current_context') return { data: context, error: null, status: 200 };
      if (name === 'get_my_business_access_request') return { data: currentAccessRequest, error: null, status: 200 };
      if (name === 'request_business_access') {
        return { data: requestResponse || currentAccessRequest, error: null, status: 200 };
      }
      if (name === 'identity_close_own_session') return { data: { ok: true }, error: null, status: 200 };
      return { data: [], error: null, status: 200 };
    },
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return query;
    },
    channel() {
      return {
        on() { return this; },
        subscribe(callback) { callback('SUBSCRIBED'); return this; },
        unsubscribe() {},
      };
    },
    removeChannel: async () => {},
  };
}
