import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accessRequestActions,
  normalizeAccessFilter,
  normalizeAccessRequests,
  renderAccessInboxSurface,
} from '../js/business/business-access-inbox.js';

const PENDING_PANEL = Object.freeze({
  request_id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  email: 'pide@lataba.test',
  full_name: 'Pedro Panel',
  contact_phone: '2996000010',
  requested_access: 'panel',
  status: 'pending',
  attempt_count: 1,
  requested_at: '2026-08-17T10:00:00Z',
  is_member: false,
  roles_grantable: ['staff', 'admin'],
});

test('el rol que se puede otorgar lo dice el servidor, no la pantalla', () => {
  // Un encargado recibe `roles_grantable: ['staff']` porque no puede crear otro
  // encargado. La pantalla ofrece lo que llegó, sin agregar nada por su cuenta.
  const [comoEncargado] = normalizeAccessRequests([{ ...PENDING_PANEL, roles_grantable: ['staff'] }]);
  const markup = renderAccessInboxSurface({ requests: [{ ...PENDING_PANEL, roles_grantable: ['staff'] }], role: 'admin' });

  assert.deepEqual(comoEncargado.rolesGrantable, ['staff']);
  assert.match(markup, /<option value="staff"/);
  assert.doesNotMatch(markup, /<option value="admin"/);
});

test('un rol inventado por el servidor no llega a la pantalla', () => {
  const [row] = normalizeAccessRequests([{ ...PENDING_PANEL, roles_grantable: ['owner', 'staff'] }]);
  assert.deepEqual(row.rolesGrantable, ['staff']);
});

test('quien no administra el equipo no ve botones de decisión', () => {
  const [row] = normalizeAccessRequests([PENDING_PANEL]);
  const actions = accessRequestActions(row, 'staff');

  assert.equal(actions.canApprove, false);
  assert.equal(actions.canReject, false);
  assert.match(actions.reason, /dueño o el encargado/i);

  const markup = renderAccessInboxSurface({ requests: [PENDING_PANEL], role: 'staff' });
  assert.doesNotMatch(markup, /data-access-request-approve/);
  assert.doesNotMatch(markup, /data-access-request-reject/);
});

test('el dueño puede aprobar y rechazar', () => {
  const [row] = normalizeAccessRequests([PENDING_PANEL]);
  const actions = accessRequestActions(row, 'owner');
  assert.equal(actions.canApprove, true);
  assert.equal(actions.canReject, true);

  const markup = renderAccessInboxSurface({ requests: [PENDING_PANEL], role: 'owner' });
  assert.match(markup, /data-access-request-approve="11111111-1111-4111-8111-111111111111"/);
  assert.match(markup, /data-access-request-reject="11111111-1111-4111-8111-111111111111"/);
});

test('a quien ya entró por otra vía no se le ofrece aprobar', () => {
  // Aprobarlo pisaría el rol que ya tiene; el servidor lo rechaza. La pantalla
  // lo explica antes en vez de ofrecer un botón que va a fallar.
  const [row] = normalizeAccessRequests([{ ...PENDING_PANEL, is_member: true }]);
  const actions = accessRequestActions(row, 'owner');

  assert.equal(actions.canApprove, false);
  assert.equal(actions.canReject, true);
  assert.match(actions.reason, /ya pertenece al equipo/i);
});

test('una solicitud ya decidida no ofrece decidirla otra vez', () => {
  const [row] = normalizeAccessRequests([{
    ...PENDING_PANEL, status: 'approved', granted_role: 'staff', decided_at: '2026-08-17T12:00:00Z',
  }]);
  const actions = accessRequestActions(row, 'owner');
  assert.equal(actions.canApprove, false);
  assert.equal(actions.canReject, false);

  const markup = renderAccessInboxSurface({
    requests: [{ ...PENDING_PANEL, status: 'approved', granted_role: 'staff' }],
    role: 'owner',
    filter: 'approved',
  });
  assert.doesNotMatch(markup, /data-access-request-approve/);
});

test('una solicitud de Rider sólo se puede aprobar como Rider', () => {
  const markup = renderAccessInboxSurface({
    requests: [{ ...PENDING_PANEL, requested_access: 'rider', roles_grantable: ['rider'] }],
    role: 'owner',
  });
  assert.match(markup, /<option value="rider"/);
  assert.doesNotMatch(markup, /<option value="staff"/);
  assert.doesNotMatch(markup, /<option value="admin"/);
});

test('la bandeja vacía dice qué está mirando, no un error', () => {
  assert.match(renderAccessInboxSurface({ requests: [], role: 'owner' }), /No hay solicitudes esperando/);
  assert.match(
    renderAccessInboxSurface({ requests: [], role: 'owner', filter: 'rejected' }),
    /No rechazaste ninguna/,
  );
});

test('el filtro sólo acepta los tres estados que existen', () => {
  assert.equal(normalizeAccessFilter('approved'), 'approved');
  assert.equal(normalizeAccessFilter('cancelled'), 'pending');
  assert.equal(normalizeAccessFilter(''), 'pending');
});

test('el contador de intentos aparece recién cuando hay más de uno', () => {
  assert.doesNotMatch(renderAccessInboxSurface({ requests: [PENDING_PANEL], role: 'owner' }), /Intentos/);
  assert.match(
    renderAccessInboxSurface({ requests: [{ ...PENDING_PANEL, attempt_count: 3 }], role: 'owner' }),
    /Intentos/,
  );
});

test('los datos de la persona no pueden inyectar HTML en la bandeja', () => {
  const markup = renderAccessInboxSurface({
    requests: [{ ...PENDING_PANEL, full_name: '<script>alert(1)</script>' }],
    role: 'owner',
  });
  assert.doesNotMatch(markup, /<script>alert/);
  assert.match(markup, /&lt;script&gt;/);
});

test('una fila sin identificador no se dibuja', () => {
  assert.deepEqual(normalizeAccessRequests([{ full_name: 'Sin id' }, null, 'texto']), []);
});
