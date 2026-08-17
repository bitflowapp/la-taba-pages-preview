import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateBusinessOperations,
  allowedBusinessOperationViews,
  BUSINESS_OPERATION_VIEWS,
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';

/*
 * La bandeja como una vista más del centro de operación.
 *
 * El módulo de pantalla ya se prueba solo. Lo que falta acá es la integración:
 * que la vista exista con su permiso, que cargue sola al abrirse, y que apretar
 * «Aprobar» llame al servidor con el id y el rol que la tarjeta muestra —no con
 * otros—.
 */

const SOLICITUD = Object.freeze({
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

test('la vista existe y sólo la ofrece el rol que puede usarla', () => {
  assert.ok(BUSINESS_OPERATION_VIEWS.includes('team-access'));
  assert.ok(allowedBusinessOperationViews('owner').includes('team-access'));
  assert.ok(allowedBusinessOperationViews('admin').includes('team-access'));
  assert.ok(!allowedBusinessOperationViews('staff').includes('team-access'));
  assert.ok(!allowedBusinessOperationViews('rider').includes('team-access'));
});

test('abrir la vista carga las solicitudes una sola vez', async () => {
  const llamadas = [];
  const { render } = montar({
    role: 'owner',
    listAccessRequests: async (status) => {
      llamadas.push(status);
      return { ok: true, data: [SOLICITUD] };
    },
  });

  activateBusinessOperations('team-access');
  await tick();
  activateBusinessOperations('team-access');
  await tick();

  assert.deepEqual(llamadas, ['pending']);
  const markup = render();
  assert.match(markup, /Solicitudes de acceso/);
  assert.match(markup, /Pedro Panel/);
});

test('aprobar manda el id y el rol de esa tarjeta, y relee', async () => {
  const decisiones = [];
  const { render } = montar({
    role: 'owner',
    listAccessRequests: async () => ({ ok: true, data: [SOLICITUD] }),
    reviewAccessRequest: async (input) => {
      decisiones.push(input);
      return { ok: true, data: { ok: true, code: 'approved', granted_role: input.role } };
    },
  });
  activateBusinessOperations('team-access');
  await tick();
  render();

  const result = await handleBusinessOperationsAction(
    approveTarget(SOLICITUD.request_id, 'admin'),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(decisiones, [{
    requestId: SOLICITUD.request_id, decision: 'approve', role: 'admin',
  }]);
  assert.match(result.message, /encargado/i);
});

test('rechazar no manda ningún rol', async () => {
  const decisiones = [];
  montar({
    role: 'owner',
    listAccessRequests: async () => ({ ok: true, data: [SOLICITUD] }),
    reviewAccessRequest: async (input) => {
      decisiones.push(input);
      return { ok: true, data: { ok: true, code: 'rejected' } };
    },
  });
  activateBusinessOperations('team-access');
  await tick();

  const result = await handleBusinessOperationsAction(rejectTarget(SOLICITUD.request_id));

  assert.equal(result.ok, true);
  assert.deepEqual(decisiones, [{
    requestId: SOLICITUD.request_id, decision: 'reject', role: null,
  }]);
});

test('lo que el servidor rechaza se dice con palabras, no con un código', async () => {
  for (const [code, patron] of [
    ['self_review', /tu propia solicitud/i],
    ['already_member', /ya pertenece al equipo/i],
    ['already_decided', /ya estaba decidida/i],
    ['role_above_actor', /lo otorga el dueño/i],
    ['invalid_role', /no corresponde/i],
  ]) {
    resetBusinessOperationsForTests();
    montar({
      role: 'owner',
      listAccessRequests: async () => ({ ok: true, data: [SOLICITUD] }),
      reviewAccessRequest: async () => ({ ok: true, data: { ok: false, code } }),
    });
    activateBusinessOperations('team-access');
    await tick();

    const result = await handleBusinessOperationsAction(approveTarget(SOLICITUD.request_id, 'staff'));
    assert.equal(result.ok, false, code);
    assert.match(result.message, patron, code);
    assert.doesNotMatch(result.message, /PGRST|42501|policy|JWT/i, code);
  }
});

test('un error de lectura se muestra sin filtrar el mensaje crudo del motor', async () => {
  const { render } = montar({
    role: 'owner',
    listAccessRequests: async () => ({
      ok: false,
      code: 'FORBIDDEN',
      message: 'permission denied for table business_access_requests',
    }),
  });
  activateBusinessOperations('team-access');
  await tick();

  const markup = render();
  assert.doesNotMatch(markup, /permission denied/i);
  assert.match(markup, /solicitudes de acceso/i);
});

test('cambiar de pestaña relee con el estado que se pidió', async () => {
  const llamadas = [];
  montar({
    role: 'owner',
    listAccessRequests: async (status) => {
      llamadas.push(status);
      return { ok: true, data: [] };
    },
  });
  activateBusinessOperations('team-access');
  await tick();

  await handleBusinessOperationsAction(filterTarget('approved'));
  // Un estado inventado cae en 'pending' en vez de viajar al servidor.
  await handleBusinessOperationsAction(filterTarget('cancelled'));

  assert.deepEqual(llamadas, ['pending', 'approved', 'pending']);
});

// ── Arnés ──────────────────────────────────────────────────────────────────

function montar(context) {
  resetBusinessOperationsForTests();
  configureBusinessOperations({ onChange() {}, ...context });
  return { render: () => renderBusinessOperations('team-access') };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function approveTarget(requestId, role) {
  const select = { value: role };
  const node = {
    dataset: { accessRequestApprove: requestId },
    closest(selector) {
      if (selector === '[data-access-request-approve]') return node;
      if (selector === '[data-business-ops-center]') {
        return { querySelector: (query) => (query.includes(requestId) ? select : null) };
      }
      return null;
    },
  };
  return node;
}

function rejectTarget(requestId) {
  const node = {
    dataset: { accessRequestReject: requestId },
    closest: (selector) => (selector === '[data-access-request-reject]' ? node : null),
  };
  return node;
}

function filterTarget(filter) {
  const node = {
    dataset: { accessInboxFilter: filter },
    closest: (selector) => (selector === '[data-access-inbox-filter]' ? node : null),
  };
  return node;
}
