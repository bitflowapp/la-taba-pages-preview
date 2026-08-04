import { classifyRpcError } from './supabase-business-repository.js';

// Estado y ajustes de cobro para el panel. El Access Token no pasa por acá:
// vive en el servidor de pagos y el panel sólo ve evidencia de que funciona.
const ALLOWED_SETTINGS = Object.freeze([
  'collector_id', 'application_id', 'installments_limit', 'preference_expiration_minutes',
  'reserve_stock', 'enabled',
]);

export function createSupabasePaymentsRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function') throw new Error('Cliente Supabase inválido.');
  if (!businessId) throw new Error('El estado de cobros requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    return error ? classifyRpcError(error, status) : { ok: true, data };
  }

  return Object.freeze({
    getActivationStatus: () => rpc('get_mercadopago_activation_status', { p_business_id: businessId }),
    configureSettings(settings = {}) {
      const payload = {};
      for (const key of ALLOWED_SETTINGS) {
        if (Object.hasOwn(settings, key) && settings[key] !== undefined && settings[key] !== '') {
          payload[key] = settings[key];
        }
      }
      // Segunda barrera del lado del cliente: si aparece algo fuera de la lista, no se envía nada.
      const unexpected = Object.keys(settings).filter((key) => !ALLOWED_SETTINGS.includes(key));
      if (unexpected.length) {
        return Promise.resolve({ ok: false, code: 'SETTINGS_NOT_ALLOWED', message: 'Esos datos no se configuran desde el panel.' });
      }
      return rpc('configure_mercadopago_settings', { p_business_id: businessId, p_settings: payload });
    },
  });
}
