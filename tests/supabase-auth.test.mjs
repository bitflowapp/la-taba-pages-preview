import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseAuthService } from '../js/services/supabase-auth.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

test('reutiliza una sesión existente al crear un pedido', async () => {
  const client = createAuthMock({
    session: { user: { id: 'customer-1' } },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.ensureCustomerSession();

  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'customer-1');
  assert.equal(client.calls.anonymous, 0);
});

test('crea sesión anónima persistente cuando el cliente todavía no tiene una', async () => {
  const client = createAuthMock({ session: null });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.ensureCustomerSession();

  assert.equal(result.ok, true);
  assert.equal(result.anonymous, true);
  assert.equal(result.user.id, 'anonymous-1');
  assert.equal(client.calls.anonymous, 1);
});

test('una sesión anónima de cliente no se confunde con acceso fallido del equipo', async () => {
  const client = createAuthMock({
    session: {
      user: {
        id: 'anonymous-1',
        is_anonymous: true,
        user_metadata: { taba_actor: 'customer' },
      },
    },
    membership: null,
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.getTeamAccess();

  assert.equal(result.ok, false);
  assert.equal(result.customerSession, true);
  assert.equal(result.user.id, 'anonymous-1');
  assert.equal(client.calls.filters.length, 0);
  assert.equal(client.calls.rpc.length, 0);
});

test('autoriza owner/admin/staff/rider sólo con membresía activa del comercio', async () => {
  const client = createAuthMock({
    membership: {
      business_id: BUSINESS_ID,
      user_id: 'team-1',
      role: 'staff',
      is_active: true,
    },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signInTeam({
    email: 'equipo@lataba.test',
    password: 'not-logged',
    expectedRole: 'staff',
  });

  assert.equal(result.ok, true);
  assert.equal(result.membership.role, 'staff');
  assert.deepEqual(
    client.calls.rpc.map(([name]) => name),
    ['identity_current_context', 'identity_register_session'],
  );
  assert.equal(client.calls.filters.length, 0);
  assert.equal(client.calls.signOut, 0);
});

test('acepta admin como rol operativo del negocio', async () => {
  const client = createAuthMock({
    membership: {
      business_id: BUSINESS_ID,
      user_id: 'team-1',
      role: 'admin',
      is_active: true,
    },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signInTeam({
    email: 'admin@lataba.test',
    password: 'not-logged',
    expectedRole: 'admin',
  });

  assert.equal(result.ok, true);
  assert.equal(result.membership.role, 'admin');
});

test('cierra localmente la sesión si el rol no habilita la vista', async () => {
  const client = createAuthMock({
    membership: {
      business_id: BUSINESS_ID,
      user_id: 'team-1',
      role: 'rider',
      is_active: true,
    },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signInTeam({
    email: 'rider@lataba.test',
    password: 'not-logged',
    expectedRole: 'staff',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /rol requerido/i);
  assert.equal(client.calls.signOut, 1);
  assert.deepEqual(client.calls.signOutOptions, { scope: 'local' });
});

test('no autoriza una cuenta sin membresía activa', async () => {
  const client = createAuthMock({ membership: null });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signInTeam({
    email: 'outside@lataba.test',
    password: 'not-logged',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /membresía activa/i);
  assert.equal(client.calls.signOut, 1);
});

test('token expirado no autoriza la bandeja ni intenta resolver una membership', async () => {
  const client = createAuthMock({
    session: null,
    getSessionError: { status: 401, message: 'JWT expired' },
  });
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.getTeamAccess();

  assert.equal(result.ok, false);
  assert.equal(result.customerSession, undefined);
  assert.equal(client.calls.filters.length, 0);
});

test('expone suscripción Auth desmontable', () => {
  const client = createAuthMock();
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });
  const events = [];

  const stop = auth.onAuthStateChange((event) => events.push(event.event));
  client.emitAuth('SIGNED_IN', { user: { id: 'team-1' } });
  stop();

  assert.deepEqual(events, ['SIGNED_IN']);
  assert.equal(client.calls.unsubscribe, 1);
});

function createAuthMock({
  session = { user: { id: 'team-1' } },
  getSessionError = null,
  membership = {
    business_id: BUSINESS_ID,
    user_id: 'team-1',
    role: 'owner',
    is_active: true,
  },
} = {}) {
  let authCallback = () => {};
  const calls = {
    anonymous: 0,
    filters: [],
    rpc: [],
    signOut: 0,
    signOutOptions: null,
    unsubscribe: 0,
  };
  const query = {
    select() {
      return this;
    },
    eq(field, value) {
      calls.filters.push([field, value]);
      return this;
    },
    async maybeSingle() {
      return { data: membership, error: null };
    },
  };

  return {
    calls,
    auth: {
      async getSession() {
        return { data: { session }, error: getSessionError };
      },
      async signInAnonymously() {
        calls.anonymous += 1;
        return {
          data: {
            session: { user: { id: 'anonymous-1', is_anonymous: true } },
          },
          error: null,
        };
      },
      async signInWithPassword() {
        return {
          data: {
            session: { user: { id: 'team-1' } },
            user: { id: 'team-1' },
          },
          error: null,
        };
      },
      async signOut(options) {
        calls.signOut += 1;
        calls.signOutOptions = options;
        return { error: null };
      },
      onAuthStateChange(callback) {
        authCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe() {
                calls.unsubscribe += 1;
              },
            },
          },
        };
      },
    },
    emitAuth(event, nextSession) {
      authCallback(event, nextSession);
    },
    async rpc(name, params) {
      calls.rpc.push([name, params]);
      if (name === 'identity_current_context') {
        if (!membership) return { data: { role: null, permissions: [] }, error: null };
        return {
          data: {
            user_id: membership.user_id,
            business_id: membership.business_id,
            role: membership.role,
            session_id: 'session-1',
            permissions: ['orders.read'],
          },
          error: null,
        };
      }
      if (name === 'identity_register_session') {
        return { data: { ok: true, code: 'registered', session_id: 'session-1', role: membership?.role || null }, error: null };
      }
      if (name === 'identity_close_own_session') {
        return { data: { ok: true, code: 'closed' }, error: null };
      }
      return { data: null, error: { code: '42883' } };
    },
    from(table) {
      assert.equal(table, 'business_members');
      return query;
    },
  };
}

test('cerrar sesión termina la cadena de refresh antes de vaciar el navegador', async () => {
  const client = createAuthMock();
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signOut();

  assert.equal(result.ok, true);
  assert.deepEqual(client.calls.rpc, [
    ['identity_close_own_session', { p_business_id: BUSINESS_ID }],
  ]);
  assert.equal(client.calls.signOut, 1);
});

test('si el cierre remoto falla igual se vacía el navegador', async () => {
  const client = createAuthMock();
  client.rpc = async () => { throw new Error('sin red'); };
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.signOut();

  assert.equal(result.ok, true);
  assert.equal(client.calls.signOut, 1);
});

test('una sesión revocada deja de autorizar el Panel con el mismo token', async () => {
  const client = createAuthMock();
  client.rpc = async (name) => {
    if (name === 'identity_current_context') {
      return { data: { role: null, permissions: [] }, error: null };
    }
    return { data: null, error: null };
  };
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.getTeamAccess();

  assert.equal(result.ok, false);
  assert.match(result.message, /membresía activa/i);
});

test('el ingreso del equipo registra la sesión de este navegador', async () => {
  const client = createAuthMock({
    membership: {
      business_id: BUSINESS_ID,
      user_id: 'team-1',
      role: 'owner',
      is_active: true,
    },
  });
  const auth = createSupabaseAuthService({
    client,
    businessId: BUSINESS_ID,
    deviceLabel: 'Chrome · Windows',
    appVersion: 'v62',
  });

  const result = await auth.signInTeam({
    email: 'duenia@lataba.test',
    password: 'not-logged',
  });

  assert.equal(result.ok, true);
  const [, params] = client.calls.rpc.find(([name]) => name === 'identity_register_session');
  assert.equal(params.p_client, 'panel_web');
  assert.equal(params.p_device_label, 'Chrome · Windows');
  assert.equal(params.p_app_version, 'v62');
  assert.equal(params.p_device_key_hash, null);
});

test('el Panel falla cerrado si la sesión no queda registrada y revocable', async (t) => {
  for (const registration of [
    { data: null, error: { message: 'sin red' } },
    { data: { ok: true, code: 'no_session_claim', session_id: null }, error: null },
    { data: { ok: false, code: 'not_authorized' }, error: null },
  ]) {
    await t.test(registration.data?.code || 'rpc error', async () => {
      const client = createAuthMock();
      const originalRpc = client.rpc.bind(client);
      client.rpc = async (name, params) => (
        name === 'identity_register_session' ? registration : originalRpc(name, params)
      );
      const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

      const result = await auth.signInTeam({
        email: 'duenia@lataba.test',
        password: 'not-logged',
      });

      assert.equal(result.ok, false);
      assert.match(result.message, /registrar esta sesión/i);
      assert.equal(client.calls.signOut, 1);
      assert.deepEqual(client.calls.signOutOptions, { scope: 'local' });
    });
  }
});

test('los permisos los declara el backend, no la vista', async () => {
  const client = createAuthMock();
  const auth = createSupabaseAuthService({ client, businessId: BUSINESS_ID });

  const result = await auth.getTeamAccess();

  assert.equal(result.ok, true);
  assert.deepEqual(result.permissions, ['orders.read']);
});
