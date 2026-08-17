import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseAuthService, TEAM_ACCESS_STATE } from '../js/services/supabase-auth.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

test('crear la cuenta no pide rol ni negocio: sólo identidad', async () => {
  const client = createMock();
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signUpTeam({ email: 'nueva@lataba.test', password: 'contrasena-larga' });

  assert.equal(result.ok, true);
  const [payload] = client.calls.signUp;
  assert.deepEqual(Object.keys(payload).sort(), ['email', 'options', 'password']);
  assert.equal(payload.options.data.taba_actor, 'team');
  // Lo que importa: crear la cuenta no llamó a ninguna RPC de identidad.
  assert.deepEqual(client.calls.rpc, []);
});

test('un correo ya registrado no se confirma ni se desmiente', async () => {
  // FASE 40: el alta no puede convertirse en un buscador de correos con cuenta.
  const client = createMock({ signUpError: { message: 'User already registered', status: 400 } });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signUpTeam({ email: 'existe@lataba.test', password: 'contrasena-larga' });

  assert.equal(result.ok, false);
  assert.match(result.message, /Si ya tenés una cuenta/i);
  assert.doesNotMatch(result.message, /registrad[oa]|already|existe/i);
});

test('si Auth exige confirmar el correo, se dice en vez de fingir que entró', async () => {
  const client = createMock({ signUpSession: null });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signUpTeam({ email: 'nueva@lataba.test', password: 'contrasena-larga' });

  assert.equal(result.ok, true);
  assert.equal(result.needsEmailConfirmation, true);
  assert.match(result.message, /confirmar la cuenta/i);
});

test('pedir acceso no manda user_id ni rol: los pone el servidor', async () => {
  const client = createMock();
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.requestTeamAccess({ access: 'panel', fullName: 'Pedro Panel', phone: '2996000010' });

  assert.equal(result.ok, true);
  const [name, params] = client.calls.rpc.at(-1);
  assert.equal(name, 'request_business_access');
  assert.deepEqual(Object.keys(params).sort(), ['p_access', 'p_business_id', 'p_contact_phone', 'p_full_name']);
  assert.equal(params.p_business_id, BUSINESS_ID);
});

test('un tipo de acceso inventado no llega al servidor', async () => {
  const client = createMock();
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.requestTeamAccess({ access: 'owner', fullName: 'Pedro Panel' });

  assert.equal(result.ok, false);
  assert.deepEqual(client.calls.rpc, []);
});

test('el Rider necesita teléfono antes de gastar un viaje de red', async () => {
  const client = createMock();
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.requestTeamAccess({ access: 'rider', fullName: 'Ramiro Rider', phone: '' });

  assert.equal(result.ok, false);
  assert.match(result.message, /teléfono/i);
  assert.deepEqual(client.calls.rpc, []);
});

test('los códigos del backend se traducen a frases, sin filtrar nada técnico', async () => {
  for (const [code, pattern] of [
    ['not_available', /no está recibiendo solicitudes/i],
    ['phone_required', /teléfono/i],
    ['retry_later', /rechazada/i],
    ['contact_business', /Hablá con el comercio/i],
  ]) {
    const client = createMock({ requestResponse: { ok: false, code, retry_at: '2026-08-18T10:00:00Z' } });
    const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });
    const result = await auth.requestTeamAccess({ access: 'panel', fullName: 'Pedro Panel' });

    assert.equal(result.ok, false, code);
    assert.match(result.message, pattern, code);
    assert.doesNotMatch(result.message, /PGRST|42501|policy|JWT/i, code);
  }
});

test('entrar con la cuenta aprobada todavía pendiente conserva la sesión', async () => {
  // Cerrar sesión acá sería el error: sin sesión la persona no puede ni ver su
  // estado ni cerrar sesión a propósito. Las credenciales estaban bien.
  const client = createMock({
    registerSession: { ok: false, code: 'not_authorized' },
    accessRequest: {
      ok: true, status: 'pending', request_id: 'req-1', requested_access: 'panel',
      requested_at: '2026-08-17T10:00:00Z', is_member: false,
    },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signInTeam({ email: 'pide@lataba.test', password: 'x' });

  assert.equal(result.ok, false);
  assert.equal(result.awaitingAccess, true);
  assert.equal(result.accessState, TEAM_ACCESS_STATE.PENDING);
  assert.equal(result.accessRequest.id, 'req-1');
  assert.equal(client.calls.signOut, 0);
});

test('quien tiene cuenta y todavía no pidió nada va al formulario, no a un error', async () => {
  const client = createMock({
    registerSession: { ok: false, code: 'not_authorized' },
    accessRequest: { ok: true, code: 'none', status: null, is_member: false },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signInTeam({ email: 'nueva@lataba.test', password: 'x' });

  assert.equal(result.awaitingAccess, true);
  assert.equal(result.accessState, TEAM_ACCESS_STATE.NONE);
  assert.equal(client.calls.signOut, 0);
});

test('si no se puede saber el estado, la sesión se cierra: no se inventa una espera', async () => {
  const client = createMock({
    registerSession: { ok: false, code: 'not_authorized' },
    accessRequestError: { message: 'sin red' },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signInTeam({ email: 'pide@lataba.test', password: 'x' });

  assert.equal(result.ok, false);
  assert.equal(result.awaitingAccess, undefined);
  assert.equal(client.calls.signOut, 1);
});

test('volver a abrir el Panel esperando aprobación devuelve la espera, no el login', async () => {
  // FASE 53: cerrar y reabrir conserva el estado. Es lo que hace que la
  // solicitud no se sienta perdida.
  const client = createMock({
    context: { role: null, permissions: [] },
    accessRequest: {
      ok: true, status: 'pending', request_id: 'req-1', requested_access: 'panel', is_member: false,
    },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.getTeamAccess();

  assert.equal(result.ok, false);
  assert.equal(result.awaitingAccess, true);
  assert.equal(result.accessState, TEAM_ACCESS_STATE.PENDING);
});

test('quien fue aprobado ve member y el Panel puede seguir su camino normal', async () => {
  const client = createMock({
    accessRequest: {
      ok: true, status: 'approved', request_id: 'req-1', granted_role: 'staff', is_member: true,
    },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const state = await auth.readTeamAccessState();

  assert.equal(state.state, TEAM_ACCESS_STATE.MEMBER);
});

test('aprobada sin membresía viva no se muestra como espera', async () => {
  // Es un caso administrativo: la membresía se borró después. Decir "esperando"
  // sería mentir; queda sin acceso y el comercio lo resuelve.
  const client = createMock({
    accessRequest: {
      ok: true, status: 'approved', request_id: 'req-1', granted_role: 'staff', is_member: false,
    },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const state = await auth.readTeamAccessState();

  assert.equal(state.state, TEAM_ACCESS_STATE.NONE);
});

function createMock({
  signUpError = null,
  signUpSession = { user: { id: 'team-nueva', email: 'nueva@lataba.test' } },
  registerSession = { ok: true, code: 'registered', session_id: 'session-1', role: 'staff' },
  context = {
    user_id: 'team-1', business_id: BUSINESS_ID, role: 'staff', session_id: 'session-1', permissions: ['orders.read'],
  },
  accessRequest = { ok: true, code: 'pending', status: 'pending', request_id: 'req-1', requested_access: 'panel', is_member: false },
  accessRequestError = null,
  requestResponse = null,
} = {}) {
  const calls = { rpc: [], signUp: [], signOut: 0 };
  return {
    calls,
    auth: {
      async getSession() {
        return { data: { session: { user: { id: 'team-1', email: 'team@lataba.test' } } }, error: null };
      },
      async signUp(payload) {
        calls.signUp.push(payload);
        if (signUpError) return { data: null, error: signUpError };
        return { data: { session: signUpSession, user: signUpSession?.user || { id: 'team-nueva' } }, error: null };
      },
      async signInWithPassword() {
        return { data: { session: { user: { id: 'team-1' } }, user: { id: 'team-1', email: 'team@lataba.test' } }, error: null };
      },
      async signOut() {
        calls.signOut += 1;
        return { error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    async rpc(name, params) {
      calls.rpc.push([name, params]);
      if (name === 'identity_register_session') return { data: registerSession, error: null };
      if (name === 'identity_current_context') return { data: context, error: null };
      if (name === 'get_my_business_access_request') {
        return accessRequestError
          ? { data: null, error: accessRequestError }
          : { data: accessRequest, error: null };
      }
      if (name === 'request_business_access') {
        return { data: requestResponse || accessRequest, error: null };
      }
      if (name === 'identity_close_own_session') return { data: { ok: true }, error: null };
      return { data: null, error: { code: '42883' } };
    },
    from() {
      throw new Error('El alta no puede tocar tablas directamente.');
    },
  };
}
