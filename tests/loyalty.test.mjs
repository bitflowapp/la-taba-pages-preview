import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateLoyaltyProgress,
  loyaltyProgressCopy,
  normalizeLoyaltyConfig,
} from '../js/core/loyalty.js';

test('loyalty: calcula progreso hacia 5 pedidos', () => {
  const progress = calculateLoyaltyProgress(2);

  assert.equal(progress.completed, 2);
  assert.equal(progress.remaining, 3);
  assert.equal(progress.benefitAvailable, false);
  assert.match(loyaltyProgressCopy(progress), /2 de 5/);
});

test('loyalty: detecta beneficio disponible al llegar al hito', () => {
  const progress = calculateLoyaltyProgress(5);

  assert.equal(progress.completed, 5);
  assert.equal(progress.remaining, 0);
  assert.equal(progress.benefitAvailable, true);
  assert.match(loyaltyProgressCopy(progress), /Beneficio disponible/);
});

test('loyalty: permite configuracion local minima sin romper tipos invalidos', () => {
  const config = normalizeLoyaltyConfig({ milestoneOrders: '3', benefitLabel: 'Beneficio del local' });
  const invalid = normalizeLoyaltyConfig({ milestoneOrders: 0, benefitLabel: '' });

  assert.equal(config.milestoneOrders, 3);
  assert.equal(config.benefitLabel, 'Beneficio del local');
  assert.equal(invalid.milestoneOrders, 5);
  assert.equal(invalid.benefitLabel, 'Beneficio disponible');
});
