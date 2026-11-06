import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.8';
import { LedgerError, type ClaimedJob, type LedgerPort, type PreparedCheckout } from './handlers.ts';

/**
 * `LedgerPort` over the service-role client. Every call is one RPC of 20261103010000_mobbex_checkout_foundation.sql:
 * the Edge Function never writes a table and never computes an amount.
 */
export function supabaseLedger(service: SupabaseClient): LedgerPort {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await service.rpc(name, args);
    if (error) throw new LedgerError(String(error.message ?? 'rpc error'));
    return data as T;
  }
  return {
    availability: (businessId) => rpc('get_mobbex_checkout_availability', { p_business_id: businessId }).then((data) => ({
      available: (data as { available?: boolean } | null)?.available === true,
      environment: (data as { environment?: string } | null)?.environment,
    })),
    createSession: (userId, payload) => rpc('create_mobbex_checkout_session', { p_customer_id: userId, p_payload: payload }),
    prepareCheckout: (sessionId, userId) => rpc<PreparedCheckout>('mobbex_prepare_checkout', { p_checkout_session_id: sessionId, p_customer_id: userId }),
    recordCheckoutCreated: async (intentId, checkoutId, url, responseHash) => {
      await rpc('mobbex_record_checkout_created', { p_intent_id: intentId, p_checkout_id: checkoutId, p_url: url, p_response_hash: responseHash });
    },
    recordCheckoutFailed: async (intentId, code, responseHash) => {
      await rpc('mobbex_record_checkout_failed', { p_intent_id: intentId, p_code: code, p_response_hash: responseHash });
    },
    recordCheckoutUncertain: async (intentId, code) => {
      await rpc('mobbex_record_checkout_uncertain', { p_intent_id: intentId, p_code: code });
    },
    recordWebhookReceipt: (input) => rpc('mobbex_record_webhook_receipt', {
      p_environment: input.environment, p_reference: input.reference, p_payload_hash: input.payloadHash,
      p_hint_status_code: input.hintStatusCode, p_hint_payment_id: input.hintPaymentId,
    }),
    recordSnapshot: (intentId, snapshot, source) => rpc('mobbex_record_provider_snapshot', { p_intent_id: intentId, p_snapshot: snapshot, p_source: source }),
    recordNoOperation: (intentId, code) => rpc('mobbex_record_no_operation', { p_intent_id: intentId, p_code: code }),
    claimJobs: (owner, limit, leaseSeconds) => rpc<ClaimedJob[]>('mobbex_claim_jobs', { p_owner: owner, p_limit: limit, p_lease_seconds: leaseSeconds }),
    finishJob: (jobId, owner, outcome, delaySeconds, error) => rpc<string>('mobbex_finish_job', {
      p_job_id: jobId, p_owner: owner, p_outcome: outcome, p_delay_seconds: delaySeconds, p_error: error,
    }),
    sweep: () => rpc('mobbex_sweep', { p_limit: 100 }),
  };
}
