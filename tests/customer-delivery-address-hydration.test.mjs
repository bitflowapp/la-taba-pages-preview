import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADDRESS_HYDRATION_ACTION,
  ADDRESS_SOURCE,
  resolveAddressHydration,
} from '../js/core/customer-delivery-address-hydration.js';

test('customer delivery hydration updates only an untouched profile default', () => {
  assert.equal(resolveAddressHydration({
    selectedAddressId: 'casa',
    selectedAddressExists: true,
    defaultAddressId: 'trabajo',
  }), ADDRESS_HYDRATION_ACTION.APPLY_DEFAULT);
});

test('customer delivery hydration preserves explicit selections and manual entries', () => {
  assert.equal(resolveAddressHydration({
    selectedAddressId: 'trabajo',
    selectedAddressExists: true,
    defaultAddressId: 'casa',
    addressSource: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED,
    userInteractedWhileLoading: true,
  }), ADDRESS_HYDRATION_ACTION.PRESERVE);
  assert.equal(resolveAddressHydration({
    defaultAddressId: 'casa',
    addressSource: ADDRESS_SOURCE.MANUAL_ENTRY,
    addressFormDirty: true,
  }), ADDRESS_HYDRATION_ACTION.PRESERVE);
});

test('customer delivery hydration never keeps archived selections and leaves guests manual', () => {
  assert.equal(resolveAddressHydration({
    selectedAddressId: 'archivada',
    selectedAddressExists: false,
    defaultAddressId: 'casa',
    addressSource: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED,
  }), ADDRESS_HYDRATION_ACTION.APPLY_DEFAULT);
  assert.equal(resolveAddressHydration({
    addressSource: ADDRESS_SOURCE.GUEST_ENTRY,
  }), ADDRESS_HYDRATION_ACTION.PRESERVE);
});
