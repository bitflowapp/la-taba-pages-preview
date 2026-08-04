import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_CAPABILITIES,
  can,
  capabilitiesForRole,
  describeRoleScope,
  isElevated,
  normalizeRole,
  requireCapability,
  roleLabel,
} from '../js/business/business-capabilities.js';

test('el equipo opera el día a día sin tocar dinero ni precios', () => {
  for (const capability of ['orders.view', 'orders.advance', 'packing.run', 'scanner.use', 'printing.run', 'devices.test', 'payments.view', 'day.open', 'products.draft']) {
    assert.equal(can('staff', capability), true, `staff debería poder ${capability}`);
  }
  for (const capability of ['products.publish', 'products.price', 'payments.refund', 'payments.reconcile', 'fiscal.configure', 'fiscal.authorize', 'day.close', 'team.manage']) {
    assert.equal(can('staff', capability), false, `staff no debería poder ${capability}`);
  }
});

test('dueño y encargado tienen exactamente las mismas atribuciones', () => {
  assert.deepEqual([...capabilitiesForRole('owner')], [...capabilitiesForRole('admin')]);
  assert.equal(capabilitiesForRole('owner').length, BUSINESS_CAPABILITIES.length);
});

test('un rol desconocido no recibe ninguna atribución', () => {
  assert.deepEqual([...capabilitiesForRole('rider')], []);
  assert.deepEqual([...capabilitiesForRole('')], []);
  assert.equal(normalizeRole('OWNER'), 'owner');
  assert.equal(normalizeRole('cliente'), '');
  assert.equal(isElevated('staff'), false);
  assert.equal(isElevated('admin'), true);
  assert.equal(roleLabel('rider'), 'Sin acceso');
});

test('cuando falta permiso se explica el motivo, no un código de error', () => {
  const refund = requireCapability('staff', 'payments.refund');
  assert.equal(refund.allowed, false);
  assert.match(refund.message, /irreversible/i);
  assert.match(refund.message, /dueño o el encargado/i);

  const publish = requireCapability('staff', 'products.publish');
  assert.match(publish.message, /a la venta en la web/i);

  assert.deepEqual(requireCapability('owner', 'payments.refund'), { allowed: true, message: '' });
});

test('el panel puede mostrarle a cada persona qué hace y qué necesita autorización', () => {
  const staff = describeRoleScope('staff');
  assert.equal(staff.label, 'Equipo');
  assert.ok(staff.canDo.includes('packing.run'));
  assert.ok(staff.needsOwner.includes('day.close'));
  assert.equal(staff.needsOwner.includes('packing.run'), false);

  const owner = describeRoleScope('owner');
  assert.deepEqual([...owner.needsOwner], []);
});
