import { normalizeCustomerAddress } from '../core/customer-addresses.js';
import {
  isValidArgentinePhone,
  normalizeArgentinePhone,
  normalizeCustomerName,
  sanitizeText,
  validateCustomerName,
} from '../core/validators.js';

export function createSupabaseCustomerProfileRepository({ client, authService } = {}) {
  if (!client || typeof client.rpc !== 'function') {
    throw new Error('El repositorio de perfil requiere un cliente Supabase válido.');
  }
  if (!authService || typeof authService.ensureCustomerSession !== 'function') {
    throw new Error('El repositorio de perfil requiere una sesión de cliente.');
  }

  async function withSession(callback) {
    const session = await authService.ensureCustomerSession();
    if (!session.ok) {
      return failure(
        session.message || 'No pudimos validar tu sesión.',
        isOffline() ? 'offline' : 'session_expired',
      );
    }
    try {
      return await callback();
    } catch (_) {
      return failure(
        'No pudimos conectar tus datos guardados. Podés continuar con los datos ingresados.',
        isOffline() ? 'offline' : 'network',
      );
    }
  }

  async function load() {
    return withSession(async () => {
      const { data, error } = await client.rpc('get_current_customer_profile');
      if (error) {
        return queryFailure(
          error,
          'No pudimos recuperar tus datos guardados. Podés completar el pedido manualmente.',
        );
      }
      const profile = normalizeProfilePayload(data);
      return { ok: true, profile, addresses: profile.addresses };
    });
  }

  async function saveProfile({ name, phone } = {}) {
    const nameValidation = validateCustomerName(name);
    if (!nameValidation.ok) return failure(nameValidation.message, 'validation');
    const normalizedPhone = normalizeArgentinePhone(phone);
    if (!isValidArgentinePhone(normalizedPhone)) {
      return failure('Ingresá un teléfono argentino válido, con código de área.', 'validation');
    }
    const payload = {
      p_name: nameValidation.name,
      p_phone: normalizedPhone,
    };
    return withSession(async () => {
      const { data, error } = await client.rpc('upsert_current_customer_profile', payload);
      if (error) {
        return queryFailure(error, 'No pudimos guardar tus datos. El pedido se puede realizar igualmente.');
      }
      return { ok: true, profile: normalizeProfile(data) };
    });
  }

  async function saveAddress(address, { allowDuplicate = false } = {}) {
    const { lastUsedAt, ...normalizedAddress } = normalizeCustomerAddress(address);
    const payload = { ...normalizedAddress, allowDuplicate: Boolean(allowDuplicate) };
    return withSession(async () => {
      const { data, error } = await client.rpc('upsert_current_customer_address', { p_address: payload });
      if (error) {
        return queryFailure(
          error,
          'No pudimos guardar la dirección. Podés continuar con los datos ingresados.',
        );
      }
      if (data?.ok === false && data?.code === 'duplicate') {
        return {
          ok: false,
          code: 'duplicate',
          duplicate: normalizeCustomerAddress(data.address || {}),
          message: 'Ya tenés una dirección parecida guardada.',
        };
      }
      return { ok: true, address: normalizeCustomerAddress(data?.address || data || {}) };
    });
  }

  async function setDefault(addressId) {
    return invokeAddressRpc('set_current_customer_default_address', addressId, 'No pudimos cambiar la dirección principal.');
  }

  async function archive(addressId) {
    return invokeAddressRpc('archive_current_customer_address', addressId, 'No pudimos eliminar la dirección.');
  }

  async function invokeAddressRpc(name, addressId, failureMessage) {
    const id = sanitizeText(addressId, { fallback: '', maxLength: 80 });
    if (!id) return failure('Dirección no encontrada.');
    return withSession(async () => {
      const { data, error } = await client.rpc(name, { p_address_id: id });
      if (error) return queryFailure(error, failureMessage);
      return { ok: true, result: data || null };
    });
  }

  return { load, saveProfile, saveAddress, setDefault, archive };
}

function normalizeProfilePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const addresses = Array.isArray(source.addresses)
    ? source.addresses.map(normalizeCustomerAddress).filter((address) => address.id || address.formattedAddress)
    : [];
  return { ...normalizeProfile(source.profile), addresses };
}

function normalizeProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: sanitizeText(source.id, { fallback: '', maxLength: 80 }),
    name: normalizeCustomerName(source.name),
    phone: normalizeArgentinePhone(source.phone),
    updatedAt: sanitizeText(source.updatedAt ?? source.updated_at, { fallback: '', maxLength: 40 }),
  };
}

function queryFailure(error, message) {
  if (isOffline()) return failure('Sin conexión. Revisá internet y volvé a intentar.', 'offline');
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || '').trim();
  if ([401, 403].includes(status) || code === '42501' || /jwt|session/i.test(String(error?.message || ''))) {
    return failure('Tu sesión venció. Actualizá la página para volver a ingresar.', 'session_expired');
  }
  return failure(message, 'network');
}

function failure(message, code = 'unknown') {
  return { ok: false, code, message };
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
