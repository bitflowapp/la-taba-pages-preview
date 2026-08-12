import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdentityAdminService } from '../js/services/identity-admin.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

test('lista el equipo con lo que el dueño necesita ver', async () => {
  const client = createRpcMock({
    identity_list_members: [
      { user_id: USER_ID, role: 'rider', is_active: true, full_name: 'Ana', active_sessions: 2 },
    ],
  });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.listMembers();

  assert.equal(result.ok, true);
  assert.equal(result.members[0].active_sessions, 2);
  assert.deepEqual(client.calls[0], ['identity_list_members', { p_business_id: BUSINESS_ID }]);
});

test('cerrar una sesión no toca las demás de esa persona', async () => {
  const client = createRpcMock({ identity_revoke_session: { ok: true, code: 'revoked' } });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.revokeSession('33333333-3333-4333-8333-333333333333');

  assert.equal(result.ok, true);
  assert.equal(result.code, 'revoked');
  const [name, params] = client.calls[0];
  assert.equal(name, 'identity_revoke_session');
  // Sólo viaja la sesión: el backend deduce a quién pertenece y decide si
  // quien llama puede cerrarla.
  assert.deepEqual(Object.keys(params), ['p_session_id']);
});

test('dar de baja devuelve cuántas sesiones se cerraron', async () => {
  const client = createRpcMock({
    identity_set_member_active: { ok: true, is_active: false, sessions_revoked: 3 },
  });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.setMemberActive({ userId: USER_ID, isActive: false, reason: 'dejó el trabajo' });

  assert.equal(result.ok, true);
  assert.equal(result.sessionsRevoked, 3);
});

test('el último dueño no se puede quedar sin comercio y se dice por qué', async () => {
  const client = createRpcMock({ identity_set_member_active: { ok: false, code: 'last_owner' } });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.setMemberActive({ userId: USER_ID, isActive: false });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'last_owner');
  assert.match(result.message, /sin ningún dueño activo/i);
});

test('una negativa del backend se muestra como falta de permiso, no como error raro', async () => {
  const client = createRpcMock({}, { code: '42501', message: 'identity: no autorizado' });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.listMembers();

  assert.equal(result.ok, false);
  assert.match(result.message, /no tenés permiso/i);
  // Y el mensaje crudo del motor no llega a la pantalla.
  assert.ok(!result.message.includes('identity:'));
});

test('la invitación devuelve el token una sola vez y lo dice quien la emite', async () => {
  const client = createRpcMock({
    identity_create_invitation: {
      ok: true,
      invitation_id: '44444444-4444-4444-8444-444444444444',
      token: 'a'.repeat(64),
      expires_at: '2026-08-19T00:00:00Z',
      invited_role: 'rider',
    },
  });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.createInvitation({
    email: 'nueva@lataba.test',
    role: 'rider',
    fullName: 'Nueva Rider',
  });

  assert.equal(result.ok, true);
  assert.equal(result.token.length, 64);
  assert.equal(result.role, 'rider');
});

test('un admin que intenta invitar a un dueño recibe el motivo exacto', async () => {
  const client = createRpcMock({ identity_create_invitation: { ok: false, code: 'role_above_actor' } });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.createInvitation({
    email: 'otro@lataba.test',
    role: 'owner',
    fullName: 'Otro Dueño',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /dueño del comercio/i);
});

test('la auditoría se lee por RPC y no expone la tabla', async () => {
  const client = createRpcMock({
    identity_list_audit_events: [
      { event_type: 'session_revoked', occurred_at: '2026-08-12T00:00:00Z', metadata: {} },
    ],
  });
  const admin = createIdentityAdminService({ client, businessId: BUSINESS_ID });

  const result = await admin.listAuditEvents({ limit: 50 });

  assert.equal(result.ok, true);
  assert.equal(result.events[0].event_type, 'session_revoked');
  assert.deepEqual(client.calls[0], [
    'identity_list_audit_events',
    { p_business_id: BUSINESS_ID, p_limit: 50 },
  ]);
});

test('exige un cliente y un comercio antes de dejar llamar a nada', () => {
  assert.throws(() => createIdentityAdminService({ client: {}, businessId: BUSINESS_ID }), /cliente Supabase/);
  assert.throws(() => createIdentityAdminService({ client: { rpc() {} } }), /businessId/);
});

function createRpcMock(responses = {}, error = null) {
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push([name, params]);
      if (error) return { data: null, error };
      return { data: responses[name] ?? null, error: null };
    },
  };
}
