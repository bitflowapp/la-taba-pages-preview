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

test('un perfil que llega tarde no borra lo que la persona está escribiendo', () => {
  // El caso exacto: se abre el checkout sin dirección elegida, la respuesta del
  // perfil tarda, la persona empieza a tipear, y la respuesta llega. Lo que
  // había escrito gana. Es la carrera que no puede perderse: perder texto ya
  // tipeado en un checkout es perder el pedido.
  assert.equal(resolveAddressHydration({
    selectedAddressId: '',
    selectedAddressExists: false,
    defaultAddressId: 'casa',
    addressSource: ADDRESS_SOURCE.PROFILE_DEFAULT,
    addressFormDirty: true,
  }), ADDRESS_HYDRATION_ACTION.PRESERVE);

  // Y el mismo instante sin que nadie haya tocado nada: ahí sí corresponde
  // precargar, porque no hay nada que pisar.
  assert.equal(resolveAddressHydration({
    selectedAddressId: '',
    selectedAddressExists: false,
    defaultAddressId: 'casa',
    addressSource: ADDRESS_SOURCE.PROFILE_DEFAULT,
    addressFormDirty: false,
  }), ADDRESS_HYDRATION_ACTION.APPLY_DEFAULT);

  // Sin predeterminada y con el formulario intacto, queda en carga manual: no
  // se inventa una dirección.
  assert.equal(resolveAddressHydration({
    defaultAddressId: '',
    addressSource: ADDRESS_SOURCE.PROFILE_DEFAULT,
    addressFormDirty: false,
  }), ADDRESS_HYDRATION_ACTION.MANUAL_ENTRY);
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
