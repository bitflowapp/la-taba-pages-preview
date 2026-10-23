import { classifyRpcError } from './supabase-business-repository.js';
import { readFunctionFailure } from './function-failure.js';

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

  async function invokeConnect(action, confirmation) {
    const { data, error } = await client.functions.invoke('mercadopago-connect', { body: { business_id: businessId, action, confirmation } });
    if (!error && data?.ok) return { ok: true, data };
    const failure = error ? await readFunctionFailure(error) : { code: String(data?.code || ''), status: 0, body: data };
    return { ok: false, code: failure.code, status: failure.status, data: failure.body };
  }

  async function connectionAction(action, confirmation) {
    try {
      // El servidor revalida esta sesión cuando la persona vuelve de Mercado
      // Pago: se empieza con la sesión recién renovada para que no venza en el
      // medio del consentimiento.
      if (action === 'connect') await client.auth?.refreshSession?.();
      let response = await invokeConnect(action, confirmation);
      if (!response.ok && response.code === 'SESSION_REFRESH_REQUIRED' && typeof client.auth?.refreshSession === 'function') {
        await client.auth.refreshSession();
        response = await invokeConnect(action, confirmation);
      }
      if (response.ok) return response;
      return { ok: false, code: response.code, data: response.data, message: 'No pudimos conectar con Mercado Pago. Intentá nuevamente.' };
    } catch (_) { return { ok: false, code: 'NETWORK', message: 'No pudimos verificar la conexión. Intentá nuevamente.' }; }
  }

  return Object.freeze({
    connectionAction,
    getActivationStatus: () => rpc('get_mercadopago_activation_status', { p_business_id: businessId }),
    // Apagar el cobro online lo puede hacer el dueño o el encargado en cualquier
    // entorno; prenderlo sigue siendo una decisión aparte de la plataforma.
    pauseOnlinePayments: () => rpc('pause_mercadopago_payments', { p_business_id: businessId }),
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
