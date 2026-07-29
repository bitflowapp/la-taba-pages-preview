export const ADDRESS_SOURCE = Object.freeze({
  PROFILE_DEFAULT: 'profile_default',
  SAVED_ADDRESS_SELECTED: 'saved_address_selected',
  MANUAL_ENTRY: 'manual_entry',
  GUEST_ENTRY: 'guest_entry',
});

export const ADDRESS_HYDRATION_ACTION = Object.freeze({
  APPLY_DEFAULT: 'apply_default',
  REAPPLY_SELECTION: 'reapply_selection',
  PRESERVE: 'preserve',
  MANUAL_ENTRY: 'manual_entry',
});

// A late profile response may refresh only an untouched default. A saved
// selection or manual input always belongs to the current checkout session.
export function resolveAddressHydration({
  selectedAddressId = '',
  selectedAddressExists = false,
  defaultAddressId = '',
  addressSource = ADDRESS_SOURCE.PROFILE_DEFAULT,
  addressFormDirty = false,
  userInteractedWhileLoading = false,
} = {}) {
  if (selectedAddressId && !selectedAddressExists) {
    return defaultAddressId ? ADDRESS_HYDRATION_ACTION.APPLY_DEFAULT : ADDRESS_HYDRATION_ACTION.MANUAL_ENTRY;
  }

  if (addressSource === ADDRESS_SOURCE.PROFILE_DEFAULT && !addressFormDirty) {
    return defaultAddressId ? ADDRESS_HYDRATION_ACTION.APPLY_DEFAULT : ADDRESS_HYDRATION_ACTION.MANUAL_ENTRY;
  }

  if (
    addressSource === ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED
    && selectedAddressExists
    && !addressFormDirty
    && !userInteractedWhileLoading
  ) {
    return ADDRESS_HYDRATION_ACTION.REAPPLY_SELECTION;
  }

  return ADDRESS_HYDRATION_ACTION.PRESERVE;
}
