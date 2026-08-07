/**
 * Puentes del canal de WhatsApp con el runtime del servidor.
 *
 * Acá vive lo único que el canal no puede resolver en JavaScript puro: leer
 * secretos del entorno, hablar con la Admin API de Supabase y crear la
 * preferencia de Mercado Pago. La conversación entera —catálogo, carrito,
 * cotización, checkout— vive en `_shared/whatsapp/*.js` y no toca nada de esto.
 *
 * El enlace de pago NO se arma acá: se delega en `_shared/mercadopago.ts`, que
 * es exactamente el módulo que usa el checkout de la web. La preferencia de un
 * pedido de WhatsApp y la de un pedido del navegador salen del mismo código,
 * con el mismo `external_reference` y el mismo `notification_url`.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.8';
import { getRequiredEnv, optionalEnv, sha256Hex } from './payment-runtime.ts';
import {
  createPreference,
  findPreferenceByExternalReference,
  MercadoPagoApiError,
  type PreferencePreparation,
} from './mercadopago.ts';

export type WhatsAppConfig = {
  businessId: string;
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  hashSalt: string;
};

export function whatsappConfig(): WhatsAppConfig {
  return {
    businessId: getRequiredEnv('WHATSAPP_BUSINESS_ID'),
    appSecret: getRequiredEnv('WHATSAPP_APP_SECRET'),
    verifyToken: getRequiredEnv('WHATSAPP_VERIFY_TOKEN'),
    accessToken: getRequiredEnv('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: getRequiredEnv('WHATSAPP_PHONE_NUMBER_ID'),
    apiVersion: optionalEnv('WHATSAPP_GRAPH_API_VERSION') || 'v21.0',
    hashSalt: getRequiredEnv('PAYMENT_LOG_HASH_SALT'),
  };
}

/**
 * `rpc(name, args)` tal como lo espera el canal: devuelve el dato o lanza. El
 * cliente es el de service_role, igual que en el resto de las funciones de
 * borde; ninguna de estas RPC es alcanzable desde un navegador.
 */
export function serviceRpc(service: SupabaseClient) {
  return async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await service.rpc(name, args);
    if (error) throw new Error(`${name}:${error.code || 'rpc_failed'}`);
    return data;
  };
}

/**
 * Un número de WhatsApp que todavía no es cliente del comercio se da de alta con
 * la Admin API, con el teléfono como identidad. Si ese teléfono YA existe,
 * `whatsapp_find_customer_by_phone` lo encontró antes y esta función no corre:
 * no se parte el historial de nadie en dos cuentas.
 */
export function createCustomerProvisioner(service: SupabaseClient) {
  return async ({ waId, displayName }: { waId: string; displayName: string }): Promise<string> => {
    const { data, error } = await service.auth.admin.createUser({
      phone: waId,
      phone_confirm: true,
      user_metadata: {
        channel: 'whatsapp',
        ...(displayName ? { full_name: displayName.slice(0, 80) } : {}),
      },
    });
    if (!error && data?.user?.id) return data.user.id;
    // Carrera con otro mensaje del mismo cliente: gana el primero y el segundo
    // vuelve a leer en vez de crear un duplicado.
    const existing = await service.rpc('whatsapp_find_customer_by_phone', { p_phone: waId });
    if (existing.data) return String(existing.data);
    throw new Error('customer_provisioning_failed');
  };
}

/**
 * Enlace de pago. Es la misma secuencia del checkout web —preparar el intento,
 * recuperar por `external_reference` antes de reintentar, persistir lo creado—
 * ejecutada con el cliente de servidor en vez de con el JWT del navegador.
 */
export function createPaymentLinkFactory(service: SupabaseClient) {
  return async ({ checkoutSessionId, customerId }: { checkoutSessionId: string; customerId: string }) => {
    const { data, error } = await service.rpc('prepare_mercadopago_preference', {
      p_checkout_session_id: checkoutSessionId,
      p_customer_id: customerId,
      p_new_attempt: false,
    });
    if (error || !data) return { initPoint: '', message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.' };
    const preparation = data as PreferencePreparation;

    const stored = selectedInitPoint(preparation);
    if (preparation.attempt_status === 'created' && stored) return { initPoint: stored };

    const existing = await findPreferenceByExternalReference(preparation.external_reference);
    if (existing) {
      const preferenceId = String(existing.id || '').trim();
      const initPoint = String(existing.init_point || '').trim();
      if (preferenceId && initPoint) {
        const persisted = await service.rpc('record_mercadopago_preference_created', {
          p_payment_attempt_id: preparation.payment_attempt_id,
          p_preference_id: preferenceId,
          p_init_point: initPoint,
          p_sandbox_init_point: String(existing.sandbox_init_point || '').trim() || null,
          p_response_hash: await sha256Hex(JSON.stringify(existing)),
          p_provider_request_id: null,
        });
        if (!persisted.error) return { initPoint };
      }
    }

    if (preparation.attempt_status === 'ambiguous' || preparation.attempt_status === 'request_sent') {
      return { initPoint: '', message: 'Estamos verificando la preparación de tu pago. No vuelvas a pagar todavía.' };
    }

    try {
      const created = await createPreference(preparation);
      const persisted = await service.rpc('record_mercadopago_preference_created', {
        p_payment_attempt_id: preparation.payment_attempt_id,
        p_preference_id: created.preferenceId,
        p_init_point: created.initPoint,
        p_sandbox_init_point: created.sandboxInitPoint || null,
        p_response_hash: created.responseHash,
        p_provider_request_id: created.requestId || null,
      });
      if (persisted.error) return { initPoint: '', message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.' };
      return { initPoint: created.initPoint };
    } catch (error) {
      if (error instanceof MercadoPagoApiError && error.status >= 400 && error.status < 500) {
        await service.rpc('record_mercadopago_preference_failed', {
          p_payment_attempt_id: preparation.payment_attempt_id,
          p_response_hash: error.responseHash,
          p_error_code: String(error.status),
        });
        return { initPoint: '', message: 'No pudimos preparar Mercado Pago. Conservamos tu carrito para que vuelvas a intentar.' };
      }
      await service.rpc('record_mercadopago_preference_uncertain', {
        p_payment_attempt_id: preparation.payment_attempt_id,
        p_request_hash: await sha256Hex(JSON.stringify({ checkoutSessionId, attempt: preparation.payment_attempt_id })),
        p_error_code: error instanceof MercadoPagoApiError ? String(error.status) : 'network_or_timeout',
      });
      return { initPoint: '', message: 'Estamos verificando la preparación de tu pago. No vuelvas a pagar todavía.' };
    }
  };
}

function selectedInitPoint(preparation: PreferencePreparation): string {
  // Mismo criterio que el checkout web: `sandbox_init_point` es el host viejo
  // de Mercado Pago y rechaza pagos de prueba que `init_point` sí completa. El
  // entorno lo determinan las credenciales, no el host.
  return String(preparation.init_point || preparation.sandbox_init_point || '').trim();
}

export function createServiceClientForChannel(): SupabaseClient {
  return createClient(
    getRequiredEnv('SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
